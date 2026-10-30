# -*- coding: utf-8 -*-
"""在 PDF 里定位某个关键词所在的页码（只用于找页，判读仍靠看图）。"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
import fitz

src = sys.argv[1]
needle = sys.argv[2]
doc = fitz.open(src)
for i in range(doc.page_count):
    t = doc[i].get_text()
    if needle in t:
        print("page %d: %s" % (i + 1, needle))
