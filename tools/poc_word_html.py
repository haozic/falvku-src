# -*- coding: utf-8 -*-
"""原型：用 Word COM 把 docx 导出成「筛选过的网页 HTML」，并排对比现有预览。"""
import os, sys, re, glob, base64, shutil, tempfile, zipfile, io

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
CACHE = os.path.join(TOOLS, "flk_cache")
OUT = os.path.join(TOOLS, "poc")
os.makedirs(OUT, exist_ok=True)


def pick_with_table():
    for p in sorted(glob.glob(os.path.join(CACHE, "*.docx"))):
        try:
            with zipfile.ZipFile(p) as z:
                xml = z.read("word/document.xml").decode("utf-8", "ignore")
            if xml.count("<w:tbl>") >= 2:
                return p
        except Exception:
            pass
    return None


def export_filtered_html(path, outdir):
    import win32com.client as win32
    word = win32.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        doc = word.Documents.Open(path, ReadOnly=True)
        htm = os.path.join(outdir, "t.htm")
        doc.SaveAs2(htm, FileFormat=10)      # wdFormatFilteredHTML
        doc.Close(False)
    finally:
        word.Quit()
    return htm


def read_html(path):
    """Word 导出的是系统代码页（GBK），要按 meta charset 解码。"""
    raw = open(path, "rb").read()
    head = raw[:1024].decode("ascii", "ignore")
    m = re.search(r'charset=["\']?([\w-]+)', head, re.I)
    enc = (m.group(1) if m else "gbk").lower()
    if enc in ("gb2312", "gbk", "gb18030"):
        enc = "gb18030"
    try:
        return raw.decode(enc, "replace")
    except LookupError:
        return raw.decode("gb18030", "replace")


def inline_assets(htm_path):
    """把 t_files 里的图片转成 data URI 内联，输出单文件 HTML（保留 head 里的样式）。"""
    html = read_html(htm_path)
    d = os.path.dirname(htm_path)
    aux = os.path.join(d, "t_files")
    if os.path.isdir(aux):
        for r, _, fs in os.walk(aux):
            for f in fs:
                fp = os.path.join(r, f)
                rel = os.path.relpath(fp, d).replace("\\", "/")
                ext = os.path.splitext(f)[1].lower()
                mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                        "gif": "image/gif", "bmp": "image/bmp", "emf": "", "wmf": ""}.get(ext.lstrip("."), "")
                if not mime:
                    continue
                b = base64.b64encode(open(fp, "rb").read()).decode("ascii")
                html = html.replace(rel, "data:%s;base64,%s" % (mime, b))
    return html


srcs = [pick_with_table()]
srcs = [s for s in srcs if s]
if not srcs:
    srcs = [sorted(glob.glob(os.path.join(CACHE, "*.docx")), key=os.path.getsize)[len(glob.glob(os.path.join(CACHE, "*.docx"))) // 2]]

blocks = []
for p in srcs:
    outdir = tempfile.mkdtemp(prefix="poc-")
    try:
        htm = export_filtered_html(p, outdir)
        h = inline_assets(htm)
        # 保留 Word 的 <style>（mso- 类全在里面），但换成 UTF-8 声明
        h = re.sub(r'(?i)charset=["\']?[\w-]+', 'charset=utf-8', h)
        h = re.sub(r"(?is)<body[^>]*>", '<div class="wdoc">', h)
        h = re.sub(r"(?is)</body>", "</div>", h)
        blocks.append((os.path.basename(p), h, os.path.getsize(p)))
    finally:
        shutil.rmtree(outdir, ignore_errors=True)

page = """<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>Word 导出的 HTML 效果原型</title>
<style>
body{margin:0;padding:20px 24px;background:#f4f5f7;color:#16181d;
 font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:14px;}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#5b6472;margin-bottom:16px}
.box{background:#fff;border:1px solid #dfe3e8;border-radius:8px;padding:18px 22px;margin-bottom:18px;
 box-shadow:0 1px 2px rgba(0,0,0,.05)}
.tag{display:inline-block;background:#c8102e;color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;
 margin-bottom:10px}
.wdoc{background:#fff}
</style></head><body>
<h1>Word COM 导出的「筛选过的网页 HTML」</h1>
<div class="sub">Word 自己排的版（字号/字体/颜色/表格边框都保留），浏览器直接渲染</div>
%s
</body></html>""" % ("".join(
    '<div class="box"><span class="tag">%s</span>%s</div>' % (n, h)
    for n, h, sz in blocks))

outp = os.path.join(OUT, "word_export.html")
io.open(outp, "w", encoding="utf-8").write(page)
print("written", outp, os.path.getsize(outp), "bytes")
for n, h, sz in blocks:
    print("   样本 %s (docx %d KB) -> html %d KB" % (n[:12], sz // 1024, len(h.encode("utf-8")) // 1024))
