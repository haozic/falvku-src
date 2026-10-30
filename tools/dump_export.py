# -*- coding: utf-8 -*-
"""导出一篇并把原始标记前 3000 字符打出来，看清结构。"""
import os, sys, re, glob, shutil, tempfile

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
ENC_MAP = {"x-cp20936": "gb18030", "gb2312": "gb18030", "gbk": "gb18030"}

files = sorted(glob.glob(os.path.join(CACHE, "*.docx")), key=os.path.getsize)
p = files[0]                                     # 最小的一篇
print("样本:", os.path.basename(p), os.path.getsize(p), "bytes")

import win32com.client as win32
word = win32.Dispatch("Word.Application")
word.Visible = False
word.DisplayAlerts = 0
outdir = tempfile.mkdtemp(prefix="dump-")
try:
    doc = word.Documents.Open(p, ReadOnly=True)
    htm = os.path.join(outdir, "t.htm")
    doc.SaveAs2(htm, FileFormat=10)
    doc.Close(False)
finally:
    word.Quit()

raw = open(htm, "rb").read()
m = re.search(r'charset=["\']?([\w-]+)', raw[:2048].decode("ascii", "ignore"), re.I)
enc = ENC_MAP.get((m.group(1) if m else "gbk").lower(), "gb18030")
h = raw.decode(enc, "replace")
print("原始字节 %d，编码 %s" % (len(raw), enc))
print("=" * 70)
i = h.lower().find("<body")
print(h[i:i + 2500] if i >= 0 else h[-2500:])
print("=" * 70)
print("style= 出现次数:", len(re.findall(r'(?i)style=', h)))
print("class= 出现次数:", len(re.findall(r'(?i)class=', h)))
print("<style> 块:", len(re.findall(r'(?i)<style', h)))
cs = sum(len(m.encode("utf-8")) for m in re.findall(r"(?is)<style[^>]*>(.*?)</style>", h))
print("<style> 内容合计: %d bytes" % cs)
print("mso- 类名种类:", sorted(set(re.findall(r'(?i)class=["\']?(Mso\w+)', h)))[:12])
shutil.rmtree(outdir, ignore_errors=True)
