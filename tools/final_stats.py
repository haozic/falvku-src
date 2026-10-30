# -*- coding: utf-8 -*-
"""核对首页展示的「总条目/总字数」与数据实际值是否一致。"""
import json, glob, os, re, sys
sys.stdout.reconfigure(encoding="utf-8")

ROOT = r"E:\cursor\法规库"
pat = re.compile(r'\{"id":"n\d+".*?\}\]?\s*$')

# 分片里的 flk 记录：抽 chars 与 cat
n = 0
flk_chars = 0
cats = {}
for f in sorted(glob.glob(os.path.join(ROOT, "data", "flk_*.js"))):
    s = open(f, encoding="utf-8").read()
    for m in re.finditer(r'"id":"(n\d+)"', s):
        n += 1
        seg = s[m.start():m.start() + 4000]
        cm = re.search(r'"cat":"([a-z]+)"', seg)
        hm = re.search(r'"chars":(\d+)', seg)
        if cm:
            cats[cm.group(1)] = cats.get(cm.group(1), 0) + 1
        if hm:
            flk_chars += int(hm.group(1))

d = json.load(open(os.path.join(ROOT, "data", "regulations.json"), encoding="utf-8"))
recs = d["records"]
pc = sum(r.get("chars", 0) for r in recs)
print("党内法规 %d 部 / %s 字" % (len(recs), format(pc, ",")))
print("国家法律法规 %d 部 / %s 字" % (n, format(flk_chars, ",")))
print("合计 %d 部 / %s 字" % (len(recs) + n, format(pc + flk_chars, ",")))
print("flk 门类:", cats)
