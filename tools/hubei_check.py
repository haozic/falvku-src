# -*- coding: utf-8 -*-
"""体检：湖北抓取结果的目录剥离、章节层级、标题一致性与空正文。"""
import os, sys, json, collections
sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "hubei_cache")

files = sorted(f for f in os.listdir(CACHE) if f.endswith(".json"))
recs = [json.load(open(os.path.join(CACHE, f), encoding="utf-8")) for f in files]
print("条数：%d" % len(recs))
print("区域分布：", dict(collections.Counter(r["region"] for r in recs)))
print("门类分布：", dict(collections.Counter(r["cat"] for r in recs)))
print("时效性：", dict(collections.Counter(r.get("effect", "") for r in recs)))
print("有公布机关：%d / %d" % (sum(1 for r in recs if r.get("issuer")), len(recs)))
print("有通过日期：%d / %d" % (sum(1 for r in recs if r.get("adopted")), len(recs)))
print("有施行日期：%d / %d" % (sum(1 for r in recs if r.get("effective")), len(recs)))
print("空正文：%d" % sum(1 for r in recs if r["chars"] == 0))
print("标题不一致：%d" % sum(1 for r in recs if r.get("titleMismatch")))

lv = collections.Counter()
phantom = 0
phantom_ex = []
for r in recs:
    names = [s["name"] for s in r["sections"] if s["name"]]
    for s in r["sections"]:
        lv[s["level"]] += 1
    # 「正文没有的章」：目录里出现过但正文里没有同名标题
    toc = r.get("tocEntries") or []
    body_names = {n.replace(" ", "") for n in names}
    for t in toc:
        if t.replace(" ", "") not in body_names:
            phantom += 1
            if len(phantom_ex) < 5:
                phantom_ex.append((r["title"], t))
print("章节层级分布：", dict(lv))
print("「正文没有的章」：%d" % phantom, phantom_ex)
print("总字数：%s" % format(sum(r["chars"] for r in recs), ","))

r = recs[0]
print("\n--- 样例：%s ---" % r["title"])
print("机关：%s | 通过：%s | 公布：%s | 施行：%s | 时效：%s"
      % (r["issuer"], r["adopted"], r["published"], r["effective"], r["effect"]))
for s in r["sections"][:6]:
    print("  [L%d] %-22s %s" % (s["level"], s["name"], s["text"][:50].replace("\n", " ")))
print("  … 共 %d 节" % len(r["sections"]))
