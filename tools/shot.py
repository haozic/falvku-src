# -*- coding: utf-8 -*-
"""批量截图：node/py 均不依赖，直接调 headless Chrome。

用法: python tools/shot.py <输出名> <url> [宽] [高]
"""
import os, sys, subprocess, time, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'tools', 'shots')
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE = os.path.join(ROOT, 'tools', 'chrome-profile')

# 复用同一个 profile 会命中磁盘缓存，截图可能是旧样式；每次先清缓存
for _sub in ('Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Cache', 'Code Cache'):
    _p = os.path.join(PROFILE, _sub)
    if os.path.isdir(_p):
        shutil.rmtree(_p, ignore_errors=True)

# 连 localStorage 一起清：这个 profile 只服务于截图/自检，
# 留着上一轮的主题偏好会让每次截图在深浅之间跳变（之前就因此截出「深色首页」）。
for _sub in ('Default/Local Storage', 'Default/Session Storage', 'Local Storage', 'Session Storage'):
    _p = os.path.join(PROFILE, _sub)
    if os.path.isdir(_p):
        shutil.rmtree(_p, ignore_errors=True)

name = sys.argv[1]
url = sys.argv[2]
w = sys.argv[3] if len(sys.argv) > 3 else '1440'
h = sys.argv[4] if len(sys.argv) > 4 else '1050'
os.makedirs(SHOTS, exist_ok=True)
out = os.path.join(SHOTS, name if name.endswith('.png') else name + '.png')
args = [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
        '--user-data-dir=' + PROFILE, '--hide-scrollbars',
        '--virtual-time-budget=60000', '--window-size=%s,%s' % (w, h),
        # --virtual-time-budget 只快进定时器，不推进 compositor 驱动的 CSS 动画，
        # 于是 .view 的入场动画（fgEnter）被截在早期帧（opacity≈0.25），
        # 深色页整块正文会显得发灰发暗 —— 那是截图时机问题，不是样式问题。
        # 强制 prefers-reduced-motion: reduce，让动画直接不播，截到稳定态。
        '--force-prefers-reduced-motion',
        '--screenshot=' + out, url]
p = subprocess.run(args, capture_output=True)
print('saved', out, os.path.getsize(out) if os.path.exists(out) else 'MISSING')
