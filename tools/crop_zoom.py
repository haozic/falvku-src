# -*- coding: utf-8 -*-
"""裁切并放大 PNG 的指定区域，用于细节目检。
用法: python tools/crop_zoom.py <png> <out> <x> <y> <w> <h> [scale]"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
x, y, w, h = (int(v) for v in sys.argv[3:7])
scale = float(sys.argv[7]) if len(sys.argv) > 7 else 3.0
im = Image.open(src).convert("RGB")
box = im.crop((x, y, x + w, y + h))
box = box.resize((int(box.width * scale), int(box.height * scale)), Image.LANCZOS)
box.save(out)
print("saved", out, box.size)
