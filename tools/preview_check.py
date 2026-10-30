# -*- coding: utf-8 -*-
"""核对：Word 预览分片里的 id ↔ 站点数据里的 id ↔ 标题 是否一致（防张冠李戴）"""
import os, sys, json, re

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_dataset as BD

corpus = BD.load_flk_corpus()
man = json.load(open('tools/word_manifest.json', encoding='utf-8'))
out = open('tools/preview_check.txt', 'w', encoding='utf-8')
bad = 0
miss = 0
for i, c in enumerate(corpus):
    rid = 'n%04d' % (i + 1)
    title = (c.get('title') or '').strip()
    wm = man.get(rid)
    if not wm:
        miss += 1
        continue
    if wm.get('title') != title:
        bad += 1
        if bad < 10:
            out.write('不一致 %s  预览=%s  站点=%s\n' % (rid, wm.get('title'), title))
out.write('\n语料 %d 条，预览清单 %d 条，标题不一致 %d，缺预览 %d\n'
          % (len(corpus), len(man), bad, miss))
out.close()
print('bad=%d miss=%d' % (bad, miss))
