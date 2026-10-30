# -*- coding: utf-8 -*-
"""全库重复分析：跨源 + 源内，找标题/正文重复的条目。"""
import os, sys, re, json, collections, glob

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")

norm_pat = re.compile(r"[\s　《》（）()、，,。.:：;；\"'“”‘’\[\]【】\-—_·・ 　]+")


def norm(s):
    return norm_pat.sub("", s or "")


recs = []
for f in sorted(glob.glob(os.path.join(TOOLS, "flk_cache", "*.json"))):
    r = json.load(open(f, encoding="utf-8"))
    if r.get("title"):
        recs.append(("flk", r["title"], r.get("bbbs"), r.get("chars", 0)))
for f in sorted(glob.glob(os.path.join(TOOLS, "hubei_cache", "*.json"))):
    r = json.load(open(f, encoding="utf-8"))
    if r.get("title"):
        recs.append(("hubei", r["title"], r.get("rileid"), r.get("chars", 0)))
raw = json.load(open(os.path.join(TOOLS, "raw_corpus.json"), encoding="utf-8"))
for r in raw:
    if r.get("status") == "ok" and r.get("title"):
        recs.append(("party", r["title"], "", 0))

print("总条目 %d（flk %d / hubei %d / party %d）"
      % (len(recs),
         sum(1 for x in recs if x[0] == "flk"),
         sum(1 for x in recs if x[0] == "hubei"),
         sum(1 for x in recs if x[0] == "party")))

# ---- 1) 跨源重复（湖北 vs 国家库 / 党内法规）----
by_norm = collections.defaultdict(list)
for src, title, key, chars in recs:
    by_norm[norm(title)].append((src, title, key, chars))

cross = {k: v for k, v in by_norm.items() if len(set(x[0] for x in v)) > 1}
print("\n=== 跨源同标题：%d 组 ===" % len(cross))
for k, v in list(cross.items())[:40]:
    print("  " + " | ".join("%s %s" % (x[0], x[1][:40]) for x in v))

# ---- 2) 源内重复 ----
for src in ("flk", "hubei", "party"):
    sub = collections.defaultdict(list)
    for s, title, key, chars in recs:
        if s == src:
            sub[norm(title)].append((title, key, chars))
    dup = {k: v for k, v in sub.items() if len(v) > 1}
    print("\n=== %s 源内同标题：%d 组 / %d 条 ===" % (src, len(dup), sum(len(v) for v in dup.values())))
    for k, v in list(dup.items())[:25]:
        print("  " + " || ".join("%s(%s)" % (t[:34], k2[:8]) for t, k2, c in v))
