# -*- coding: utf-8 -*-
r"""读取 Chrome dump-dom 输出中的自检结果。

用法：python tools\read_test.py <dump-dom 输出文件>
（自检页本身由 tools\make_selftest.py 生成，走 HTTP 打开后 dump-dom 另存一份。）
"""
import re, io, sys
sys.stdout.reconfigure(encoding='utf-8')
if len(sys.argv) < 2:
    print('用法: python tools\\read_test.py <dump-dom 输出文件>')
    raise SystemExit(1)
path = sys.argv[1]
s = io.open(path, encoding='utf-8', errors='replace').read()
m = re.search(r'<pre id="testout">(.*?)</pre>', s, re.S)
if m:
    print(m.group(1))
else:
    print('NO TEST OUTPUT (len=%d)' % len(s))
    print(s[:800])
