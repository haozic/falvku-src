# -*- coding: utf-8 -*-
"""把 flk 首页的素材处理成本地站点用的图片资源。

来源：https://flk.npc.gov.cn/index 的横幅底图、国徽徽章与页面水印。
处理目标：
  1. 压到合理尺寸（离线单机站点，首屏要快）；
  2. 横幅底部「红→白」渐变改成「红→透明」（原图是为接白底页面做的，
     直接用会在横幅下缘留一条白色硬边）；
  3. 水印的白色底转成透明（否则会盖住纸面底色）。

原件留一份在 tools/_flkraw/，每次都从原件出发，重复运行不会累积处理。

用法：python tools/prep_images.py
"""
import os
import shutil
import sys
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "img")
RAW = os.path.join(ROOT, "tools", "_flkraw")

os.makedirs(RAW, exist_ok=True)


def raw_of(name):
    """原始素材留一份在 tools/_flkraw/，处理总是从原件出发，
    避免重复运行时被上一轮的产物再次处理（会累积渐隐）。"""
    raw = os.path.join(RAW, name)
    if not os.path.exists(raw):
        src = os.path.join(SRC, name)
        if not os.path.exists(src):
            return None
        shutil.copyfile(src, raw)
    return raw


def save_jpeg(src, dst, width, quality=88, crop_bottom=0):
    im = Image.open(src).convert("RGB")
    if crop_bottom:
        # 裁掉底部那段「红 → 白」的渐变：原图是为接白底页面做的，
        # 我们要接的是纸面底色，这段渐变会变成一条白色硬边。
        im = im.crop((0, 0, im.width, im.height - crop_bottom))
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
    return im.size, os.path.getsize(dst)


def save_png_q(src, dst, width, colors=256):
    im = Image.open(src).convert("RGBA")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    q = im.quantize(colors=colors, method=Image.FASTOCTREE)
    q.save(dst, "PNG", optimize=True)
    return q.size, os.path.getsize(dst)


def white_to_transparent(src, dst, width, thresh=242, colors=128):
    """把接近纯白的像素设为透明，只留剪影的浅灰。"""
    im = Image.open(src).convert("RGBA")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if r >= thresh and g >= thresh and b >= thresh:
                px[x, y] = (r, g, b, 0)
    q = im.quantize(colors=colors, method=Image.FASTOCTREE)
    q.save(dst, "PNG", optimize=True)
    return q.size, os.path.getsize(dst)


def fade_bottom(src, dst, width, opaque_frac=0.857, colors=256):
    """把图片底部渐隐成透明。

    原图底部约 15% 是「红 → 白」的渐变（为接白底页面准备的）。
    我们要接的是纸面底色，所以把这段渐变改成「红 → 透明」，
    横幅下缘就能自然融进页面底色，不留白色硬边。"""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    y0 = int(h * opaque_frac)
    alpha = Image.new("L", (1, h))
    ap = alpha.load()
    for y in range(h):
        ap[0, y] = 255 if y < y0 else int(255 * (h - y) / float(h - y0))
    alpha = alpha.resize((w, h))
    im.putalpha(alpha)
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    q = im.quantize(colors=colors, method=Image.FASTOCTREE)
    q.save(dst, "PNG", optimize=True)
    return q.size, os.path.getsize(dst)


jobs = [
    # 原图 2880x525，底部 75px 是「红→白」渐变（为接白底页面准备），改成红→透明
    ("flk-head-bg.png", "flk-head-bg.png", "fade", 1920, 0),
    ("flk-emblem.png", "flk-emblem.png", "png", 180, 0),
    ("flk-bg-bottom.png", "flk-bg-bottom.png", "wm", 1920, 0),
    ("flk-bg-left.png", "flk-bg-left.png", "png", 150, 0),
]

for src_name, dst_name, kind, width, crop in jobs:
    src = raw_of(src_name)
    dst = os.path.join(SRC, dst_name)
    if not src:
        print("缺失源文件：", src_name)
        continue
    if kind == "fade":
        size, n = fade_bottom(src, dst, width)
    elif kind == "jpeg":
        size, n = save_jpeg(src, dst, width, crop_bottom=crop)
    elif kind == "wm":
        size, n = white_to_transparent(src, dst, width)
    else:
        size, n = save_png_q(src, dst, width)
    print("%-22s -> %-22s %dx%d  %6.1f KB" % (src_name, dst_name, size[0], size[1], n / 1024.0))
