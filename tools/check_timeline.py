# -*- coding: utf-8 -*-
"""找时间轴上的时间显示异常：分组年份与显示日期不一致 / 日期格式非 ISO / 空日期。"""
import os, sys, json, glob, collections, re

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

recs = []
d = json.load(open(os.path.join(ROOT, "data", "regulations.json"), encoding="utf-8"))
recs += d["records"]
for f in sorted(glob.glob(os.path.join(ROOT, "data", "flk_*.js"))):
    s = open(f, encoding="utf-8").read()
    i = s.index("window.FG_FLK.push(")
    recs += json.loads(s[i + len("window.FG_FLK.push("):].rstrip().rstrip(";").rstrip(")"))
for f in sorted(glob.glob(os.path.join(ROOT, "data", "hubei_*.js"))):
    s = open(f, encoding="utf-8").read()
    i = s.index("window.FG_HUBEI.push(")
    recs += json.loads(s[i + len("window.FG_HUBEI.push("):].rstrip().rstrip(";").rstrip(")"))

print("总条目 %d" % len(recs))

ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
bad_fmt, no_date, mismatch = [], [], []
for r in recs:
    y, a = r.get("year"), r.get("adopted")
    if y and not a:
        no_date.append(r)
        continue
    if a and not ISO.match(a):
        bad_fmt.append(r)
        continue
    if a and y and int(a[:4]) != int(y):
        mismatch.append(r)

print("\n有 year 但无 adopted：%d 条" % len(no_date))
for r in no_date[:10]:
    print("   id=%s year=%s title=%s" % (r["id"], r["year"], r["title"][:44]))
print("\nadopted 非 ISO 格式：%d 条" % len(bad_fmt))
for r in bad_fmt[:10]:
    print("   id=%s adopted=%r title=%s" % (r["id"], r.get("adopted"), r["title"][:44]))
print("\nyear 与 adopted 年份不一致：%d 条" % len(mismatch))
for r in mismatch[:15]:
    print("   id=%s year=%s adopted=%s | %s" % (r["id"], r["year"], r["adopted"], r["title"][:44]))

# 年份分布（看有没有奇怪年份）
yc = collections.Counter(int(r["year"]) for r in recs if r.get("year"))
print("\n年份分布（前后各 12 个）：", dict(sorted(yc.items())[:12]), "...", dict(sorted(yc.items())[-12:]))
print("最早年份:", min(yc) if yc else None, "最晚:", max(yc) if yc else None)
