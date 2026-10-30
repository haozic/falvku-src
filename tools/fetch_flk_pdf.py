# -*- coding: utf-8 -*-
"""补抓「附件不是 docx」的少数法规：部分老法规在 flk 上挂的是 .doc 或直接是 PDF，
   魔数校验（PK）会把它们挡下来。这里改抓 format=pdf，用 PyMuPDF 抽正文，
   再按 finish_flk 的同一套规则切章节、写 <bbbs>.json。

用法：python tools/fetch_flk_pdf.py [--limit 50]
"""
import sys, os, re, json, time, argparse, threading

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")
BASE = "https://flk.npc.gov.cn"

sys.path.insert(0, TOOLS)
from finish_flk import docx_lines, split_sections, pick_preamble  # noqa: E402

_lock = threading.Lock()


def log(*a):
    with _lock:
        print(*a, flush=True)


def pdf_lines(path):
    import fitz
    out = []
    with fitz.open(path) as doc:
        for page in doc:
            txt = page.get_text("text")
            for ln in txt.split("\n"):
                t = ln.replace("\u3000", " ").replace("\xa0", " ").strip()
                t = re.sub(r"\s{2,}", " ", t)
                if t:
                    out.append(t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--gap", type=float, default=2.5)
    args = ap.parse_args()

    import requests
    meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
    todo = []
    for m in meta:
        d = os.path.join(CACHE, m["bbbs"] + ".docx")
        j = os.path.join(CACHE, m["bbbs"] + ".json")
        if os.path.exists(d) or os.path.exists(j):
            continue
        todo.append(m)
    todo = todo[:args.limit]
    log("待补（无 docx 无 json）：%d 篇" % len(todo))
    if not todo:
        return

    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": BASE, "Referer": BASE + "/index", "Accept-Language": "zh-CN,zh;q=0.9",
    })

    ok = 0
    for m in todo:
        bbbs = m["bbbs"]
        pdf_path = os.path.join(CACHE, bbbs + ".pdf")
        if not os.path.exists(pdf_path):
            url = BASE + "/law-search/download/mobile?format=pdf&bbbs=" + bbbs + "&fileId="
            try:
                r = s.get(url, timeout=90, allow_redirects=True)
            except Exception as e:
                log("  !! 下载失败 %s %r" % (bbbs[:12], e))
                time.sleep(args.gap)
                continue
            if r.content[:4] != b"%PDF":
                log("  !! 非 PDF，跳过 %s %s（%d 字节）" % (bbbs[:12], m["title"][:20], len(r.content)))
                time.sleep(args.gap)
                continue
            with open(pdf_path, "wb") as f:
                f.write(r.content)
            time.sleep(args.gap)

        try:
            lines = pdf_lines(pdf_path)
        except Exception as e:
            log("  !! PDF 解析失败 %s %r" % (bbbs[:12], e))
            continue
        if not lines:
            log("  !! PDF 无文字 %s" % bbbs[:12])
            continue
        sections = split_sections(lines)
        rec = dict(m)
        rec["sections"] = sections
        rec["preamble"] = pick_preamble(lines)
        rec["chars"] = sum(len(x["text"].replace(" ", "")) for x in sections)
        rec["lines"] = len(lines)
        rec["fromPdf"] = True
        json.dump(rec, open(os.path.join(CACHE, bbbs + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
        ok += 1
        log("  + %s %s（%d 段，%d 字）" % (bbbs[:12], m["title"][:24], rec["lines"], rec["chars"]))

    log("PDF 补抓完成：%d / %d" % (ok, len(todo)))


if __name__ == "__main__":
    main()
