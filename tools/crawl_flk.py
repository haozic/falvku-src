# -*- coding: utf-8 -*-
"""
抓取国家法律法规数据库（flk.npc.gov.cn）到本地。

范围：宪法、法律、行政法规、监察法规
排除：地方法规、司法解释（按需求排除）

产物：
    tools/flk_meta.json    列表元数据（bbbs / 标题 / 日期 / 机关 / 效力级别 …）
    tools/flk_cache/<bbbs>.json  单篇正文缓存（可续跑）
    tools/flk_corpus.json  汇总后的全文语料

用法：
    python tools/crawl_flk.py --stage list
    python tools/crawl_flk.py --stage text --workers 6
    python tools/crawl_flk.py --stage all --workers 6
"""
import sys, os, re, io, json, time, zipfile, argparse, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")
BASE = "https://flk.npc.gov.cn"

# --------------------------------------------------------------- 门类定义
# codeId -> (一级门类, 二级门类)
LEAF = {
    100: ("宪法", "宪法"),
    110: ("法律", "宪法相关法"),
    120: ("法律", "民法商法"),
    130: ("法律", "行政法"),
    140: ("法律", "经济法"),
    150: ("法律", "社会法"),
    155: ("法律", "生态环境法"),
    160: ("法律", "刑法"),
    170: ("法律", "诉讼与非诉讼程序法"),
    180: ("法律", "法律解释"),
    190: ("法律", "有关法律问题和重大问题的决定"),
    195: ("法律", "修正案"),
    200: ("法律", "修改、废止的决定"),
    210: ("行政法规", "行政法规"),
    215: ("行政法规", "修改、废止的决定"),
    220: ("监察法规", "监察法规"),
}
# 明确排除
EXCLUDED = {
    230: "地方性法规", 260: "自治条例", 270: "单行条例", 290: "经济特区法规",
    295: "浦东新区法规", 300: "海南自由贸易港法规", 305: "法规性决定",
    310: "修改、废止的决定（地方）",
    320: "高法司法解释", 330: "高检司法解释", 340: "联合发布司法解释",
    350: "修改、废止的决定（司法解释）",
}

# 效力级别 sxx
SXX = {1: "已废止", 2: "未修改", 3: "有效", 4: "尚未生效"}

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

_lock = threading.Lock()
_stats = {"list": 0, "text": 0, "ok": 0, "fail": 0, "bytes": 0}


def log(*a):
    with _lock:
        print(*a, flush=True)


def new_session():
    """flk 前置 WAF：必须先 POST 一次 search/list 拿到 wzws_cid Cookie。"""
    import requests
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Origin": BASE,
        "Referer": BASE + "/index",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    })
    body = {
        "searchRange": 1, "sxrq": [], "gbrq": [], "searchType": 2, "sxx": [],
        "gbrqYear": [], "flfgCodeId": [100], "zdjgCodeId": [], "searchContent": "",
        "orderByParam": {"order": "-1", "sort": ""}, "pageNum": 1, "pageSize": 1,
    }
    for i in range(4):
        try:
            s.post(BASE + "/law-search/search/list", json=body, timeout=25)
            break
        except Exception:
            time.sleep(1.2 * (i + 1))
    return s


def list_body(cid, page, size=100):
    return {
        "searchRange": 1, "sxrq": [], "gbrq": [], "searchType": 2, "sxx": [],
        "gbrqYear": [], "flfgCodeId": [cid], "zdjgCodeId": [], "searchContent": "",
        "orderByParam": {"order": "-1", "sort": ""}, "pageNum": page, "pageSize": size,
    }


def fetch_list(s, cid, page, tries=4):
    for i in range(tries):
        try:
            r = s.post(BASE + "/law-search/search/list", json=list_body(cid, page), timeout=30)
            j = r.json()
            if j.get("code") == 200:
                return j.get("rows") or [], j.get("total") or 0
        except Exception:
            pass
        time.sleep(1.0 * (i + 1))
    return [], 0


def fetch_details(s, bbbs, tries=4):
    for i in range(tries):
        try:
            r = s.get(BASE + "/law-search/search/flfgDetails", params={"bbbs": bbbs}, timeout=30)
            j = r.json()
            if j.get("code") == 200 and j.get("data"):
                return j["data"]
        except Exception:
            pass
        time.sleep(1.0 * (i + 1))
    return None


def fetch_docx(s, bbbs, tries=4):
    """返回 docx 原始字节；失败返回 None。"""
    for i in range(tries):
        try:
            r = s.get(BASE + "/law-search/download/mobile",
                      params={"format": "docx", "bbbs": bbbs, "fileId": ""}, timeout=60)
            if r.status_code == 200 and r.content[:2] == b"PK":
                return r.content
        except Exception:
            pass
        time.sleep(1.2 * (i + 1))
    return None


# --------------------------------------------------------------- 正文解析
def docx_lines(raw):
    z = zipfile.ZipFile(io.BytesIO(raw))
    xml = z.read("word/document.xml").decode("utf-8")
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    xml = re.sub(r"</w:tc>", "\t", xml)
    xml = re.sub(r"</w:p>", "\n", xml)
    txt = re.sub(r"<[^>]+>", "", xml)
    txt = (txt.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
              .replace("&quot;", '"').replace("&apos;", "'"))
    out = []
    for ln in txt.split("\n"):
        t = ln.replace("\u3000", " ").replace("\xa0", " ").strip()
        t = re.sub(r"\s{2,}", " ", t)
        if t:
            out.append(t)
    return out


CHAPTER_RE = re.compile(r"^(第[一二三四五六七八九十百零〇\d]+[编章篇]\s*[^\d]{0,40})$")
SECTION_RE = re.compile(r"^(第[一二三四五六七八九十百零〇\d]+节\s*\S{0,30})$")
PREAMBLE_RE = re.compile(r"^[（(].{2,200}[)）]$")


def split_sections(lines):
    """把正文切成章节结构；无法切分时返回单节。"""
    sections = []
    cur_name = ""
    cur = []
    for ln in lines:
        if CHAPTER_RE.match(ln) or SECTION_RE.match(ln):
            if cur:
                sections.append({"name": cur_name, "text": "\n".join(cur)})
            cur_name = ln
            cur = []
        else:
            cur.append(ln)
    if cur:
        sections.append({"name": cur_name, "text": "\n".join(cur)})
    if not sections:
        sections = [{"name": "", "text": "\n".join(lines)}]
    # 首节（标题+说明）单独成节，正文从第一章开始
    return sections


def pick_preamble(lines):
    for ln in lines[:8]:
        if PREAMBLE_RE.match(ln):
            return ln
    return ""


# --------------------------------------------------------------- 阶段一：列表
def stage_list():
    s = new_session()
    meta = []
    seen = set()
    for cid, (l1, l2) in LEAF.items():
        page, total = 1, None
        got = 0
        while True:
            rows, tot = fetch_list(s, cid, page)
            if total is None:
                total = tot
            if not rows:
                break
            for r in rows:
                b = r.get("bbbs")
                if not b or b in seen:
                    continue
                seen.add(b)
                meta.append({
                    "bbbs": b,
                    "codeId": cid,
                    "cat": l1,
                    "sub": l2,
                    "title": re.sub(r"<[^>]+>", "", r.get("title") or ""),
                    "gbrq": r.get("gbrq") or "",
                    "sxrq": r.get("sxrq") or "",
                    "sxx": r.get("sxx"),
                    "zdjgName": r.get("zdjgName") or "",
                    "flxz": r.get("flxz") or l2,
                    "zdjgCodeId": r.get("zdjgCodeId"),
                })
                got += 1
            _stats["list"] += len(rows)
            log("  [%s/%s] 第%d页 %d 条（本类 %d / 预计 %d）"
                % (l1, l2, page, len(rows), got, total))
            if len(rows) < 100 or got >= total:
                break
            page += 1
            time.sleep(0.5)
        time.sleep(0.4)

    path = os.path.join(TOOLS, "flk_meta.json")
    json.dump(meta, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log("列表完成：%d 条 -> %s" % (len(meta), path))
    return meta


# --------------------------------------------------------------- 阶段二：正文
def one_doc(item, get_sess):
    bbbs = item["bbbs"]
    cpath = os.path.join(CACHE, bbbs + ".json")
    if os.path.exists(cpath):
        try:
            json.load(open(cpath, encoding="utf-8"))
            with _lock:
                _stats["text"] += 1
            return True
        except Exception:
            pass

    s = get_sess()
    det = fetch_details(s, bbbs)
    time.sleep(0.15)
    raw = fetch_docx(s, bbbs)
    if raw is None:
        with _lock:
            _stats["fail"] += 1
        log("  !! 抓取失败 %s %s" % (bbbs, item["title"][:30]))
        return False

    lines = docx_lines(raw)
    sections = split_sections(lines)
    rec = dict(item)
    rec["sections"] = sections
    rec["preamble"] = pick_preamble(lines)
    rec["chars"] = sum(len(x["text"].replace(" ", "")) for x in sections)
    rec["lines"] = len(lines)
    if det:
        rec["xfFlag"] = det.get("xfFlag")
        rec["flfgHistory"] = det.get("flfg")
        rec["lsyg"] = det.get("lsyg")
        rec["xgwj"] = det.get("xgwj")
        rec["xgzlCount"] = len(det.get("xgzl") or [])
        rec["ossPdf"] = (det.get("ossFile") or {}).get("ossPdfPath") or ""
    tmp = cpath + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False)
    os.replace(tmp, cpath)
    with _lock:
        _stats["text"] += 1
        _stats["ok"] += 1
        _stats["bytes"] += len(raw)
    return True


def stage_text(limit=None, workers=6):
    meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
    if limit:
        meta = meta[:limit]
    os.makedirs(CACHE, exist_ok=True)
    log("待抓取 %d 篇，并发 %d" % (len(meta), workers))

    local = threading.local()

    def get_sess():
        """每个工作线程复用一个会话（会话内已带 WAF Cookie），避免打爆对方。"""
        s = getattr(local, "s", None)
        if s is None:
            s = new_session()
            local.s = s
        return s

    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one_doc, it, get_sess): it for it in meta}
        for fu in as_completed(futs):
            done += 1
            try:
                fu.result()
            except Exception as e:
                log("  !! %s" % repr(e)[:100])
            if done % 25 == 0:
                el = time.time() - t0
                log("  进度 %d/%d  成功 %d 失败 %d  已下载 %.1f MB  用时 %.0fs"
                    % (done, len(meta), _stats["ok"], _stats["fail"],
                       _stats["bytes"] / 1048576, el))
    log("正文阶段结束：成功 %d 失败 %d" % (_stats["ok"], _stats["fail"]))
    return True


# --------------------------------------------------------------- 阶段三：汇总
def stage_merge():
    meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
    corpus = []
    miss = []
    for m in meta:
        p = os.path.join(CACHE, m["bbbs"] + ".json")
        if os.path.exists(p):
            try:
                corpus.append(json.load(open(p, encoding="utf-8")))
                continue
            except Exception:
                pass
        miss.append(m)
    out = os.path.join(TOOLS, "flk_corpus.json")
    json.dump(corpus, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    total = sum(c.get("chars", 0) for c in corpus)
    log("汇总：%d 篇（缺 %d 篇），总字数 %s -> %s"
        % (len(corpus), len(miss), format(total, ","), out))
    if miss:
        log("  缺失样例:", [m["title"][:24] for m in miss[:8]])
    return corpus


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="all", choices=["list", "text", "merge", "all"])
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    if args.stage in ("list", "all"):
        log("== 阶段一：抓取列表 ==")
        stage_list()
    if args.stage in ("text", "all"):
        log("== 阶段二：抓取正文 ==")
        stage_text(limit=args.limit or None, workers=args.workers)
    if args.stage in ("merge", "all"):
        log("== 阶段三：汇总 ==")
        stage_merge()


if __name__ == "__main__":
    main()
