# -*- coding: utf-8 -*-
"""串档归属判定：提取 docx 的「标题行区」（遇到说明段即停），谁的名字在前谁就是主人。"""
import os, sys, re, json, glob, zipfile, collections

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
punct = re.compile(r"[^一-鿿0-9A-Za-z]")


def norm(s):
    s = (s or "").replace("﻿", "")
    return re.sub(r"[\s　]+", "", punct.sub("", s))


def docx_lines(bbbs, n=6):
    p = os.path.join(CACHE, bbbs + ".docx")
    if not os.path.exists(p):
        return []
    try:
        with zipfile.ZipFile(p) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
    except Exception:
        return []
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    return [l.strip() for l in xml.split("\n") if l.strip()][:n]


def doc_title(bbbs):
    """标题行区：从首行起逐行累加，遇到说明段（以「（」开头）或章节标题即停。"""
    lines = docx_lines(bbbs, 6)
    buf = ""
    for l in lines:
        s = l.replace("﻿", "").strip()
        if not s:
            continue
        if s.startswith("（") or s.startswith("("):
            break
        if s.startswith("目") and "录" in s[:3]:
            break
        if re.match(r"^第[一二三四五六七八九十百]+[编章]", s):
            break
        buf += s
    return norm(buf)


recs = {}
for f in glob.glob(os.path.join(CACHE, "*.json")):
    r = json.load(open(f, encoding="utf-8"))
    recs[r["bbbs"]] = r


def body_text(r):
    buf = [r.get("preamble") or ""]
    for s in r.get("sections") or []:
        buf.append(s.get("name") or "")
        buf.append(s.get("text") or "")
    return norm("".join(buf))


groups = collections.defaultdict(list)
for bbbs, r in recs.items():
    b = body_text(r)
    if len(b) >= 50:
        groups[b].append(bbbs)

wrong = []
for b, v in groups.items():
    if len(v) < 2:
        continue
    if len({norm(recs[x]["title"]) for x in v}) < 2:
        continue
    # 该组共用同一份文档，用第一条的 docx 判定主人
    dt = doc_title(v[0])
    owner, best = None, 0
    for y in v:
        t = norm(recs[y]["title"])
        if not t:
            continue
        # 完整标题出现在文档标题区 → 这条才是主人（取最长的那个）
        if t in dt and len(t) > best:
            owner, best = y, len(t)
    if not owner:
        for y in v:
            t = norm(recs[y]["title"])
            if t and dt.startswith(t[:min(len(t), 14)]) and len(t) > best:
                owner, best = y, len(t)
    print("组：docx标题区=%s" % dt[:60])
    for x in v:
        mark = "  ← 主人" if x == owner else "  ← 串档（内容是别人的）"
        print("   %s %-46s%s" % (x[:8], recs[x]["title"][:46], mark))
    for x in v:
        if owner and x != owner:
            wrong.append({"bbbs": x, "title": recs[x]["title"], "owner": owner,
                          "owner_title": recs[owner]["title"]})

print("\n=== 串档 %d 条 ===" % len(wrong))
for w in wrong:
    print("   %s %-46s （实为 %s）" % (w["bbbs"][:8], w["title"][:46], w["owner_title"][:40]))
json.dump(wrong, open(os.path.join(TOOLS, "flk_wrong.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
