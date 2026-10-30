# -*- coding: utf-8 -*-
"""把 PDF 逐页渲染成 PNG，便于目检（文本抽取不能替代目检）。"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
import fitz

src = sys.argv[1]
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
doc = fitz.open(src)
for i in range(doc.page_count):
    pix = doc[i].get_pixmap(dpi=110)
    p = os.path.join(out, "p%02d.png" % (i + 1))
    pix.save(p)
print("渲染 %d 页 -> %s" % (doc.page_count, out))
