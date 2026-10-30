# -*- coding: utf-8 -*-
"""全量统计 docx 里到底有多少富文本（加粗 / 表格 / 斜体），输出 tools/rich_stats.txt"""
import os, sys, io, re, json, zipfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")

n = 0
bold_docs = []
tbl_docs = []
ital_docs = []
runs_with_bold = 0
tables = 0
for f in sorted(os.listdir(CACHE)):
    if not f.endswith(".docx"):
        continue
    try:
        z = zipfile.ZipFile(os.path.join(CACHE, f))
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    except Exception:
        continue
    n += 1
    b = xml.count("<w:b/>") + len(re.findall(r'<w:b [^>]*>', xml))
    t = xml.count("<w:tbl>")
    it = xml.count("<w:i/>")
    if b:
        bold_docs.append((f, b))
        runs_with_bold += b
    if t:
        tbl_docs.append((f, t))
        tables += t
    if it:
        ital_docs.append((f, it))

with open(os.path.join(TOOLS, "rich_stats.txt"), "w", encoding="utf-8") as out:
    out.write("docx 总数 %d\n" % n)
    out.write("含加粗的 docx %d 个（共 %d 处加粗 run）\n" % (len(bold_docs), runs_with_bold))
    out.write("含表格的 docx %d 个（共 %d 个表）\n" % (len(tbl_docs), tables))
    out.write("含斜体的 docx %d 个\n" % len(ital_docs))
    out.write("\n加粗样例:\n")
    for f, b in bold_docs[:15]:
        out.write("  %s  %d 处\n" % (f[:20], b))
    out.write("\n表格样例:\n")
    for f, t in tbl_docs[:15]:
        out.write("  %s  %d 表\n" % (f[:20], t))
print("docs=%d bold=%d tbl=%d ital=%d" % (n, len(bold_docs), len(tbl_docs), len(ital_docs)))
