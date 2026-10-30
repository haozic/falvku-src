# -*- coding: utf-8 -*-
"""对比 .doc 转出的 docx 标题序列 与 站点 sections 的标题序列。

两者一致 -> Word 预览的锚点可以直接沿用 secN 序号；
不一致 -> 目录跳转要改成按标题名匹配。
"""
import os, sys, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
import section_parser as SP

TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "hubei_cache")

same = 0
diff = 0
shown = 0
for f in sorted(glob.glob(os.path.join(CACHE, "*.docx")))[:40]:
    rileid = os.path.basename(f)[:-5]
    jp = os.path.join(CACHE, rileid + ".json")
    if not os.path.exists(jp):
        continue
    rec = json.load(open(jp, encoding="utf-8"))
    site = [s["name"].replace(" ", "") for s in rec["sections"] if s.get("name")]
    try:
        lines = SP.docx_lines(open(f, "rb").read())
    except Exception as e:
        print("  !! 解析失败", rileid, e)
        continue
    secs, toc = SP.build_sections(lines)
    doc = [s["name"].replace(" ", "") for s in secs if s.get("name")]
    if site == doc:
        same += 1
    else:
        diff += 1
        if shown < 5:
            shown += 1
            print("!! %s %s" % (rileid, rec["title"][:26]))
            print("   站点(%d): %s" % (len(site), site[:8]))
            print("   文档(%d): %s" % (len(doc), doc[:8]))
print("标题序列一致 %d / 不一致 %d" % (same, diff))
