# -*- coding: utf-8 -*-
"""核对重建后的关键条目：版本保留、日期字段。"""
import os, sys, re, json, glob

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

recs = []
d = json.load(open(os.path.join(ROOT, "data", "regulations.json"), encoding="utf-8"))
recs.extend(d["records"])
for f in sorted(glob.glob(os.path.join(ROOT, "data", "flk_*.js"))):
    s = open(f, encoding="utf-8").read()
    i = s.index("window.FG_FLK.push(")
    body = s[i + len("window.FG_FLK.push("):]
    body = body.rstrip().rstrip(";").rstrip(")")
    recs.extend(json.loads(body))

print("站点总条目：%d（党内 %d / flk %d）"
      % (len(recs), len(d["records"]), len(recs) - len(d["records"])))

for kw in ("网络安全法", "村民委员会组织法", "农业法", "野生动物保护法", "大气污染防治法",
           "事业单位人事管理条例", "烈士纪念日"):
    hits = [r for r in recs if kw in r["title"]]
    print("\n《%s》 %d 条" % (kw, len(hits)))
    for r in hits:
        print("   id=%-6s title=%-44s" % (r["id"], r["title"][:44]))
        print("       adopted=%s revised=%s effective=%s effect=%s chars=%s lsyg=%d"
              % (r.get("adopted"), r.get("revised"), r.get("effective"), r.get("effect"),
                 r.get("chars"), len(r.get("lsyg") or [])))
        if r.get("lsyg"):
            print("       沿革: " + " | ".join("%s(%s)" % (x.get("title", "")[:26], x.get("date"))
                                                for x in r["lsyg"][:6]))
