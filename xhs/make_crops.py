# -*- coding: utf-8 -*-
"""从 tools/shots/ 的整页截图里裁出小红书卡片用的图片。

整页截图是 1440×1050，卡片里的图片框是 900×400（object-fit: contain），
直接塞整页会小到看不清，所以这里按内容裁成约 2.2:1 的横条。
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(os.path.dirname(ROOT), 'tools', 'shots')
OUT = os.path.join(ROOT, 'assets')
os.makedirs(OUT, exist_ok=True)

# (源文件, 左, 上, 右, 下, 输出名)
CROPS = [
    ('xhs_home.png',      0,   0, 1440, 660,  'cover.png'),    # 横幅 + 检索框 + 门类卡片
    ('xhs_browse.png',  245,  85, 1415, 620,  'sources.png'),  # 分类浏览总览：门类 + 条数
    ('xhs_search.png',  255,  85, 1415, 660,  'search.png'),   # 检索结果 + 高亮
    ('xhs_doc.png',     335,  85, 1415, 620,  'doc.png'),      # 详情页：标题卡 + 右侧目录
    ('xhs_export.png',  250, 490, 1150, 800,  'export.png'),   # 导出按钮 + 格式菜单 + 两行完整正文
    ('xhs_timeline.png', 245,  85, 1415, 620,  'timeline.png'), # 立法时间轴
    ('xhs_dark.png',    335,  85, 1415, 620,  'dark.png'),     # 深色模式详情页
]


def main():
    for src, l, t, r, b, name in CROPS:
        p = os.path.join(SHOTS, src)
        im = Image.open(p)
        box = (l, t, min(r, im.width), min(b, im.height))
        crop = im.crop(box).convert('RGB')
        dst = os.path.join(OUT, name)
        crop.save(dst, 'PNG')
        print('%-14s %4dx%-4d -> %s  (%.2f:1)' % (name, crop.width, crop.height,
                                                 os.path.relpath(dst, ROOT),
                                                 crop.width / float(crop.height)))


if __name__ == '__main__':
    main()
