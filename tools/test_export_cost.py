# -*- coding: utf-8 -*-
"""测全量成本：抽 20 篇用 Word 导出 filtered HTML，统计平均体积与耗时。"""
import os, sys, re, glob, time, random, shutil, tempfile, io, base64

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
HUBEI = os.path.join(TOOLS, "hubei_cache")


def read_html(path):
    raw = open(path, "rb").read()
    m = re.search(r'charset=["\']?([\w-]+)', raw[:1024].decode("ascii", "ignore"), re.I)
    enc = (m.group(1) if m else "gbk").lower()
    if enc in ("gb2312", "gbk", "gb18030"):
        enc = "gb18030"
    return raw.decode(enc, "replace")


def export_batch(paths, outdir):
    import win32com.client as win32
    word = win32.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    sizes = []
    t0 = time.time()
    try:
        for i, p in enumerate(paths):
            htm = os.path.join(outdir, "t%03d.htm" % i)
            try:
                doc = word.Documents.Open(p, ReadOnly=True)
                doc.SaveAs2(htm, FileFormat=10)
                doc.Close(False)
                h = read_html(htm)
                sizes.append((os.path.getsize(p), len(h.encode("utf-8"))))
            except Exception as e:
                print("   失败 %s : %s" % (os.path.basename(p)[:10], e))
            finally:
                if os.path.exists(htm):
                    os.unlink(htm)
    finally:
        word.Quit()
    return sizes, time.time() - t0


flk = sorted(glob.glob(os.path.join(CACHE, "*.docx")))
hub = sorted(glob.glob(os.path.join(HUBEI, "*.docx")))
random.seed(7)
sample = random.sample(flk, 12) + random.sample(hub, 8)

outdir = tempfile.mkdtemp(prefix="cost-")
try:
    sizes, dt = export_batch(sample, outdir)
finally:
    shutil.rmtree(outdir, ignore_errors=True)

d = sum(s[0] for s in sizes)
h = sum(s[1] for s in sizes)
n = len(sizes)
print("\n样本 %d 篇，耗时 %.1f 秒（%.2f 秒/篇）" % (n, dt, dt / max(1, n)))
print("源 docx 合计 %.1f KB，平均 %.1f KB" % (d / 1024.0, d / 1024.0 / n))
print("导出 HTML 合计 %.1f KB，平均 %.1f KB" % (h / 1024.0, h / 1024.0 / n))
print("放大倍数 %.2fx" % (h / float(d)))
total = 2102
print("\n全量外推（%d 篇）：HTML 约 %.1f MB，耗时约 %.1f 分钟"
      % (total, h / 1024.0 / n * total / 1024.0, dt / max(1, n) * total / 60.0))
