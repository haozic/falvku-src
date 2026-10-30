# -*- coding: utf-8 -*-
"""检查 flk 语料里的重名条目，输出 tools/dup_titles.txt"""
import json, collections, os

TOOLS = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(TOOLS, 'flk_meta.json'), encoding='utf-8'))
c = collections.Counter(m['title'] for m in meta)
dups = {k: v for k, v in c.items() if v > 1}
with open(os.path.join(TOOLS, 'dup_titles.txt'), 'w', encoding='utf-8') as f:
    f.write('语料 %d 条，唯一标题 %d 个，重名 %d 组\n\n' % (len(meta), len(c), len(dups)))
    for k, v in sorted(dups.items(), key=lambda x: -x[1]):
        f.write('== %s (x%d)\n' % (k, v))
        for m in meta:
            if m['title'] == k:
                f.write('   bbbs=%s  公布=%s  施行=%s  效力=%s  机关=%s\n'
                        % (m['bbbs'], m.get('gbrq'), m.get('sxrq'),
                           m.get('sxx'), m.get('zdjgName')))
print('dups', len(dups))
