# -*- coding: utf-8 -*-
"""按标题查条目 id（站点数据），输出 tools/find_id.txt"""
import os, sys, json

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_dataset as BD

corpus = BD.load_flk_corpus()
key = sys.argv[1] if len(sys.argv) > 1 else "民法典"
rows = []
for i, c in enumerate(corpus):
    t = (c.get('title') or '')
    if key in t:
        lv2 = sum(1 for s in (c.get('sections') or []) if s.get('level') == 2)
        rows.append(('n%04d' % (i + 1), t, lv2, len(c.get('sections') or [])))
rows.sort(key=lambda x: -x[2])
with open('tools/find_id.txt', 'w', encoding='utf-8') as f:
    for r in rows[:12]:
        f.write('%s | 二级 %3d | 段 %3d | %s\n' % (r[0], r[2], r[3], r[1]))
print('\n'.join('%s %s lv2=%d' % (r[0], r[1][:20], r[2]) for r in rows[:6]))
