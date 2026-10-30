# -*- coding: utf-8 -*-
"""按标题关键词找法规 id。
用法: python tools\\find_doc.py <标题关键词>"""
import sys, os, json, glob
sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
kw = sys.argv[1] if len(sys.argv) > 1 else "新质生产力"


def load_js(pattern, var):
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", pattern))):
        s = open(f, encoding="utf-8").read()
        if var + ".push(" in s:
            i = s.index(var + ".push(")
            out.extend(json.loads(s[i + len(var) + len(".push("):].rstrip().rstrip(";").rstrip(")")))
        else:
            i = s.index(var + " =")
            out.extend(json.loads(s[i + len(var) + len(" ="):].rstrip().rstrip(";").rstrip(")")))
    return out


bodies = load_js("party_*.js", "window.FG_PARTY") + load_js("flk_*.js", "window.FG_FLK") \
    + load_js("hubei_*.js", "window.FG_HUBEI")
for b in bodies:
    secs = b.get("sections") or []
    first = (secs[0].get("name") if secs else "") or ""
    if kw in first:
        print("id=%s | %s" % (b["id"], first[:60]))
