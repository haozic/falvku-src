# -*- coding: utf-8 -*-
"""查一篇法规的原始章节结构（看 sections 的 name/text），用于核对序号格式。
用法: python tools\\peek_doc.py <标题关键词>"""
import sys, os, json, glob, re
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

hits = [b for b in bodies if kw in json.dumps(b.get("sections", []), ensure_ascii=False)]
print("命中 %d 条" % len(hits))
for b in hits[:3]:
    secs = b.get("sections", [])
    print("=" * 70)
    print("id=%s  章节数=%d" % (b["id"], len(secs)))
    for i, s in enumerate(secs[:40]):
        name = s.get("name") or ""
        text = s.get("text") or ""
        lines = [l for l in text.split("\n") if l.strip()]
        print("  [%d] level=%s name=%r" % (i, s.get("level"), name[:40]))
        for l in lines[:6]:
            print("       | " + l[:88])
        if len(lines) > 6:
            print("       | ... 共 %d 行" % len(lines))
