# -*- coding: utf-8 -*-
"""合并最终删除清单：版本去重 + 串档。输出 tools/drop_plan.json"""
import os, sys, re, json, glob, collections

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
punct = re.compile(r"[^一-鿿0-9A-Za-z]")


def norm(s):
    s = (s or "").replace("﻿", "")
    return re.sub(r"[\s　]+", "", punct.sub("", s))


recs = {}
for f in glob.glob(os.path.join(CACHE, "*.json")):
    r = json.load(open(f, encoding="utf-8"))
    recs[r["bbbs"]] = r

# ---------- 1. 版本去重（沿革簇） ----------
parent = {b: b for b in recs}


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[ra] = rb


for bbbs, r in recs.items():
    for h in r.get("lsyg") or []:
        hb = h.get("bbbs")
        if hb and hb in recs:
            union(bbbs, hb)

clusters = collections.defaultdict(list)
for bbbs in recs:
    clusters[find(bbbs)].append(bbbs)

SXX = {1: "已废止", 2: "已修改", 3: "有效", 4: "尚未生效"}
ver_drop = {}
for root, members in clusters.items():
    if len(members) < 2:
        continue
    eff = [m for m in members if recs[m].get("sxx") == 3]
    fut = [m for m in members if recs[m].get("sxx") == 4]
    if eff or fut:
        keep = set(eff) | set(fut)
    else:
        keep = {sorted(members, key=lambda m: (recs[m].get("gbrq") or ""), reverse=True)[0]}
    for m in members:
        if m not in keep:
            ver_drop[m] = {"reason": "历史版本", "sxx": SXX.get(recs[m].get("sxx")),
                           "gbrq": recs[m].get("gbrq"), "title": recs[m]["title"]}

# ---------- 2. 串档（沿用 wrong_owner.py 的判定结果）----------
wrong = json.load(open(os.path.join(TOOLS, "flk_wrong.json"), encoding="utf-8"))
wrong_map = {w["bbbs"]: w for w in wrong}

print("=== 版本去重：删 %d 条历史版 ===" % len(ver_drop))
print("=== 串档：%d 条 ===" % len(wrong))
for w in wrong:
    tag = "（版本去重已覆盖）" if w["bbbs"] in ver_drop else "（需单独处理）"
    print("   %s %-44s %s" % (w["bbbs"][:8], w["title"][:44], tag))

# ---------- 3. 合并 ----------
flk_drop = dict(ver_drop)
for w in wrong:
    flk_drop.setdefault(w["bbbs"], {"reason": "正文串档", "sxx": SXX.get(recs[w["bbbs"]].get("sxx")),
                                    "gbrq": recs[w["bbbs"]].get("gbrq"), "title": w["title"]})
overlap = set(ver_drop) & set(wrong_map)
need_fix = [w for w in wrong if w["bbbs"] not in ver_drop]
print("\nflk 删除合计 %d 条（版本 %d + 串档 %d - 重叠 %d）"
      % (len(flk_drop), len(ver_drop), len(wrong), len(overlap)))
print("其中需单独修复/删除的串档条目：%d 条" % len(need_fix))
for w in need_fix:
    print("   %s %s" % (w["bbbs"][:8], w["title"][:48]))

json.dump({"flk_drop": flk_drop, "flk_wrong": wrong, "need_fix": need_fix,
           "flk_keep": len(recs) - len(flk_drop)},
          open(os.path.join(TOOLS, "drop_plan.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n写入 tools/drop_plan.json")
print("flk：%d → %d" % (len(recs), len(recs) - len(flk_drop)))
