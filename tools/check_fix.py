# -*- coding: utf-8 -*-
"""校验重抓的 docx：标题行是否与条目标题一致（flk 服务端会把历史版本附件串档）。"""
import os, sys, re, json, glob, zipfile

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
FIX = os.path.join(TOOLS, "flk_fix")
punct = re.compile(r"[^一-鿿0-9A-Za-z]")


def norm(s):
    s = (s or "").replace("﻿", "")
    return re.sub(r"[\s　]+", "", punct.sub("", s))


def lines_of(path, n=8):
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
    except Exception as e:
        return ["ZIPERR:" + str(e)]
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    return [l.strip() for l in xml.split("\n") if l.strip()][:n]


def doc_title(path):
    buf = ""
    for s in lines_of(path):
        if s.startswith("（") or s.startswith("("):
            break
        if re.match(r"^第[一二三四五六七八九十百]+[编章]", s) or (s.startswith("目") and "录" in s[:3]):
            break
        buf += s
    return norm(buf)


meta = {m["bbbs"]: m for m in json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))}
items = json.load(open(os.path.join(TOOLS, "flk_fix_items.json"), encoding="utf-8"))

print("=== 重抓校验 ===")
ok_fix, still_bad, missing = [], [], []
for it in items:
    b = it["bbbs"]
    fp = os.path.join(FIX, b + ".docx")
    if not os.path.exists(fp):
        missing.append(b)
        print("  [缺失] %s %s" % (b[:10], it["title"][:40]))
        continue
    dt = doc_title(fp)
    t = norm(it["title"])
    good = t in dt
    old = os.path.join(CACHE, b + ".docx")
    odt = doc_title(old) if os.path.exists(old) else ""
    print("  [%s] %s" % ("已修好" if good else "仍串档", it["title"][:44]))
    print("        期望标题=%s" % t[:56])
    print("        新文档  =%s" % dt[:56])
    if not good:
        print("        旧文档  =%s" % odt[:56])
    (ok_fix if good else still_bad).append(b)

print("\n修好 %d / 仍串档 %d / 缺失 %d" % (len(ok_fix), len(still_bad), len(missing)))
json.dump({"fixed": ok_fix, "still_bad": still_bad, "missing": missing},
          open(os.path.join(TOOLS, "flk_fix_result.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
