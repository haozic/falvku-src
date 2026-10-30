# -*- coding: utf-8 -*-
"""
补齐 flk 语料：
    1) 把浏览器下载的 <bbbs>.docx 解析成章节结构，写入 <bbbs>.json
    2) 逐篇拉取 flfgDetails 元数据（效力级别、时效性、制定机关、历史沿革等）并合并
    3) 汇总为 tools/flk_corpus.json

用法：
    python tools/finish_flk.py --docs
    python tools/finish_flk.py --details
    python tools/finish_flk.py --merge
"""
import sys, os, re, io, json, time, zipfile, argparse, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import section_parser as SP

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")
BASE = "https://flk.npc.gov.cn"

_lock = threading.Lock()
_stats = {"docs": 0, "detail_ok": 0, "detail_fail": 0}

CHAPTER_RE = re.compile(r"^(第[一二三四五六七八九十百零〇\d]+[编章篇]\s*[^\d]{0,40})$")
SECTION_RE = re.compile(r"^(第[一二三四五六七八九十百零〇\d]+节\s*\S{0,30})$")
PREAMBLE_RE = re.compile(r"^[（(].{2,200}[)）]$")


def split_sections(lines):
    """切成章节：剥离源文档开头的「目 录」块，并标记一级/二级层级。

    早期版本直接把目录条目当正文切分点，于是目录里会出现「正文根本没有的章」
    （如合同法的「第八章 其他规定」），正文顶部还会混进「分 则 / 附 则」等残留。
    现在统一走 section_parser：目录条目按「同名标题在正文再次出现」判定并剥离。
    """
    secs, toc = SP.build_sections(lines)
    return secs, toc


def log(*a):
    with _lock:
        print(*a, flush=True)


# --------------------------------------------------------------- docx 解析
def docx_lines(raw):
    """解析 docx 成行序列（统一走 section_parser 的 OOXML 结构解析）。

    早期版本用「正则剥标签 + 按 \\n 切行」，而 flk 导出的 docx 是美化过的 XML，
    标签之间带 CRLF 缩进，剥完标签后每个 run 边界都残留换行，
    「第一条」（黑体）和后面的正文（仿宋）就被拆成了两行。
    """
    return SP.docx_lines(raw)


def pick_preamble(lines):
    for ln in lines[:8]:
        if PREAMBLE_RE.match(ln):
            return ln
    return ""


def _norm(s):
    if not s:
        return ""
    s = re.sub(r"[﻿\u200b-\u200f\ufeff]", "", s)
    s = re.sub(r"[\s　]+", "", s)
    return re.sub(r"[《》（）()、，,。.:：;；\"'“”‘’\[\]【】\-—_0-9A-Za-z]", "", s)


def title_ok(title, lines):
    """flk 的 title 字段被截断到约 39 字，故比对前 12 字（去标点后）。"""
    if not lines:
        return False
    head = _norm("".join(lines[:4]))
    t = _norm(title)
    if not t or not head:
        return False
    if t in head:
        return True
    return head.startswith(t[:min(12, len(t))])


def stage_docs():
    meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
    n = 0
    miss = 0
    for m in meta:
        cpath = os.path.join(CACHE, m["bbbs"] + ".json")
        dpath = os.path.join(CACHE, m["bbbs"] + ".docx")
        if os.path.exists(cpath):
            continue
        if not os.path.exists(dpath):
            miss += 1
            continue
        try:
            lines = docx_lines(open(dpath, "rb").read())
        except Exception as e:
            log("  !! 解析失败 %s %s" % (m["bbbs"], repr(e)[:60]))
            miss += 1
            continue
        # 护栏：正文与编号必须对得上（多 worker 下载曾发生过张冠李戴）
        if not title_ok(m.get("title", ""), lines):
            log("  !! 标题不符，跳过 %s | 期望 %s | 实得 %s"
                % (m["bbbs"], m.get("title", "")[:20], "".join(lines[:2])[:30]))
            miss += 1
            continue
        sections, toc = split_sections(lines)
        rec = dict(m)
        rec["sections"] = sections
        rec["preamble"] = pick_preamble(lines)
        rec["chars"] = sum(len(x["text"].replace(" ", "")) for x in sections)
        rec["lines"] = len(lines)
        json.dump(rec, open(cpath, "w", encoding="utf-8"), ensure_ascii=False)
        n += 1
        if n % 100 == 0:
            log("  docx->json: %d（尚缺 %d）" % (n, miss))
    log("docx 解析完成：%d 篇，仍缺 %d 篇" % (n, miss))
    return n


# --------------------------------------------------------------- 详情元数据
def new_session():
    import requests
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": BASE, "Referer": BASE + "/index",
        "Accept": "application/json, text/plain, */*", "Accept-Language": "zh-CN,zh;q=0.9",
    })
    body = {"searchRange": 1, "sxrq": [], "gbrq": [], "searchType": 2, "sxx": [], "gbrqYear": [],
            "flfgCodeId": [100], "zdjgCodeId": [], "searchContent": "",
            "orderByParam": {"order": "-1", "sort": ""}, "pageNum": 1, "pageSize": 1}
    for i in range(4):
        try:
            s.post(BASE + "/law-search/search/list", json=body, timeout=25)
            break
        except Exception:
            time.sleep(1.2 * (i + 1))
    return s


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


def stage_details(workers=4, gap=0.7):
    files = [f for f in sorted(os.listdir(CACHE)) if f.endswith(".json")]
    todo = []
    for f in files:
        p = os.path.join(CACHE, f)
        try:
            rec = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        if not rec.get("flxz") or rec.get("xfFlag") is None:
            todo.append(p)
    log("需要补详情元数据：%d / %d" % (len(todo), len(files)))

    local = threading.local()

    def sess():
        s = getattr(local, "s", None)
        if s is None:
            s = new_session()
            local.s = s
        return s

    def one(p):
        rec = json.load(open(p, encoding="utf-8"))
        det = fetch_details(sess(), rec["bbbs"])
        if not det:
            with _lock:
                _stats["detail_fail"] += 1
            return False
        rec["flxz"] = det.get("flxz") or rec.get("flxz") or ""
        rec["zdjgName"] = det.get("zdjgName") or rec.get("zdjgName") or ""
        rec["gbrq"] = det.get("gbrq") or rec.get("gbrq") or ""
        rec["sxrq"] = det.get("sxrq") or rec.get("sxrq") or ""
        rec["sxx"] = det.get("sxx", rec.get("sxx"))
        rec["xfFlag"] = det.get("xfFlag")
        rec["flfgHistory"] = det.get("flfg")
        rec["lsyg"] = det.get("lsyg")
        rec["xgwj"] = det.get("xgwj")
        rec["xgzlCount"] = len(det.get("xgzl") or [])
        tmp = p + ".tmp"
        json.dump(rec, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
        os.replace(tmp, p)
        with _lock:
            _stats["detail_ok"] += 1
        # 限速：风控收紧时整片请求会返回验证页
        time.sleep(gap)
        return True

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(one, p) for p in todo]
        done = 0
        for fu in as_completed(futs):
            done += 1
            try:
                fu.result()
            except Exception:
                pass
            if done % 100 == 0:
                log("  详情 %d/%d 成功 %d 失败 %d" % (done, len(todo), _stats["detail_ok"], _stats["detail_fail"]))
    log("详情完成：成功 %d 失败 %d" % (_stats["detail_ok"], _stats["detail_fail"]))


# --------------------------------------------------------------- 汇总
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
        log("  缺失样例:", [m["title"][:26] for m in miss[:10]])
    return corpus


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", action="store_true")
    ap.add_argument("--details", action="store_true")
    ap.add_argument("--merge", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    if args.docs:
        stage_docs()
    if args.details:
        stage_details(args.workers)
    if args.merge:
        stage_merge()
    if not (args.docs or args.details or args.merge):
        stage_docs(); stage_details(args.workers); stage_merge()


if __name__ == "__main__":
    main()
