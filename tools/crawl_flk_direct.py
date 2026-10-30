# -*- coding: utf-8 -*-
"""flk 正文附件「直连」下载器（Python requests）。

与 crawl_flk_dl.js（真实 Chrome + CDP）互为备份：
  * 先 POST /law-search/search/list 预热会话，拿到创宇盾下发的 wzws_cid Cookie；
  * GET /law-search/download/mobile?format=docx&bbbs=<bbbs> 取正文附件；
  * 用 PK 魔数 + 正文标题双重校验，确保「下载到的就是这一篇」；
  * 命中 JS 挑战（返回 HTML 而非 zip）时退避 90~180 秒并重新预热会话。

用法：
    python tools/crawl_flk_direct.py                 # 下载全部缺件
    python tools/crawl_flk_direct.py --workers 2 --gap 1.2
    python tools/crawl_flk_direct.py --only <bbbs>   # 只补指定编号
"""
import sys, os, json, re, time, zipfile, io, argparse, threading, random

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")
BASE = "https://flk.npc.gov.cn"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

_lock = threading.Lock()
_stats = {"ok": 0, "fail": 0, "skip": 0}
_local = threading.local()


def log(*a):
    with _lock:
        print(*a, flush=True)


# --------------------------------------------------------------- 标题校验
def docx_head_lines(raw):
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    except Exception:
        return []
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    xml = xml.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    out = []
    for ln in xml.split("\n"):
        t = ln.replace("﻿", "").strip()
        if t:
            out.append(t)
        if len(out) >= 6:
            break
    return out


def norm(s):
    if not s:
        return ""
    s = re.sub(r"[﻿\u200b-\u200f\ufeff]", "", s)
    s = re.sub(r"[\s　]+", "", s)
    s = re.sub(r"[《》（）()、，,。.:：;；\"'“”‘’\[\]【】\-—_0-9A-Za-z]", "", s)
    return s


def title_ok(title, lines):
    """flk 的 title 字段被截断到约 39 字，故比对前 12 字（去标点后）。"""
    if not lines:
        return False
    head = norm("".join(lines[:4]))
    t = norm(title)
    if not t or not head:
        return False
    if t in head:
        return True
    return head.startswith(t[:min(12, len(t))])


# --------------------------------------------------------------- 会话
def warmup():
    """预热会话：拿到 wzws_cid Cookie，规避创宇盾挑战。"""
    import requests
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA, "Origin": BASE, "Referer": BASE + "/index",
        "Accept": "application/json, text/plain, */*", "Accept-Language": "zh-CN,zh;q=0.9",
    })
    body = {"searchRange": 1, "sxrq": [], "gbrq": [], "searchType": 2, "sxx": [], "gbrqYear": [],
            "flfgCodeId": [100], "zdjgCodeId": [], "searchContent": "",
            "orderByParam": {"order": "-1", "sort": ""}, "pageNum": 1, "pageSize": 1}
    for i in range(3):
        try:
            s.post(BASE + "/law-search/search/list", json=body, timeout=25)
            return s
        except Exception:
            time.sleep(1.5 * (i + 1))
    return s


def sess():
    s = getattr(_local, "s", None)
    if s is None:
        s = warmup()
        _local.s = s
    return s


def download(m, gap, max_try=4):
    """下载单篇；返回 'ok' / 'skip' / 'fail'。"""
    bbbs = m["bbbs"]
    dst = os.path.join(CACHE, bbbs + ".docx")
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        with _lock:
            _stats["skip"] += 1
        return "skip"
    url = BASE + "/law-search/download/mobile?format=docx&bbbs=" + bbbs + "&fileId="
    for attempt in range(max_try):
        try:
            r = sess().get(url, timeout=60, allow_redirects=True)
            body = r.content
        except Exception as e:
            time.sleep(2 + attempt * 3)
            continue
        if body[:2] == b"PK" and len(body) > 1000:
            lines = docx_head_lines(body)
            if title_ok(m.get("title", ""), lines):
                with open(dst + ".tmp", "wb") as f:
                    f.write(body)
                os.replace(dst + ".tmp", dst)
                with _lock:
                    _stats["ok"] += 1
                    n = _stats["ok"] + _stats["fail"] + _stats["skip"]
                    if n % 25 == 0:
                        log("  进度 %d（成功 %d 失败 %d）" % (n, _stats["ok"], _stats["fail"]))
                return "ok"
            # 魔数对但标题不符：说明拿错文件，丢弃重试
            log("  !! 标题不符，丢弃重试 %s | 期望 %s" % (bbbs[:12], m.get("title", "")[:24]))
            time.sleep(1.0 + attempt * 1.5)
            continue
        # 非 zip：多半是创宇盾 JS 挑战页
        if attempt == 0:
            log("  .. 遇到风控挑战，退避 90 秒（%s）" % bbbs[:12])
            time.sleep(90)
            try:
                _local.s = warmup()
            except Exception:
                pass
        else:
            time.sleep(6 + attempt * 10)
    with _lock:
        _stats["fail"] += 1
    log("  !! 失败 %s %s" % (bbbs[:12], m.get("title", "")[:26]))
    return "fail"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--gap", type=float, default=1.2)
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
    if args.only:
        want = set(args.only.split(","))
        meta = [m for m in meta if m["bbbs"] in want]
    else:
        todo = []
        for m in meta:
            d = os.path.join(CACHE, m["bbbs"] + ".docx")
            j = os.path.join(CACHE, m["bbbs"] + ".json")
            if os.path.exists(d) and os.path.getsize(d) > 1000:
                continue
            if os.path.exists(j):
                # 已有解析好的 json，可跳过下载
                continue
            todo.append(m)
        meta = todo
    if args.limit:
        meta = meta[:args.limit]

    log("待下载 %d 篇，并发 %d，间隔 %.1fs" % (len(meta), args.workers, args.gap))
    if not meta:
        log("没有待下载项。")
        return

    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = []
        for i, m in enumerate(meta):
            futs.append(ex.submit(download, m, args.gap))
            time.sleep(args.gap * random.random() / max(1, args.workers))
        for fu in as_completed(futs):
            try:
                fu.result()
            except Exception as e:
                with _lock:
                    _stats["fail"] += 1
                log("  !! 异常 %r" % e)
    log("完成：成功 %d，失败 %d，已存在 %d" % (_stats["ok"], _stats["fail"], _stats["skip"]))


if __name__ == "__main__":
    main()
