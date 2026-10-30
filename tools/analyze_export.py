# -*- coding: utf-8 -*-
"""分析 Word filtered HTML 的体积构成，并试算「剥冗余 + 共用 CSS」后的体积。"""
import os, sys, re, glob, time, shutil, tempfile, base64

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")

ENC_MAP = {"x-cp20936": "gb18030", "gb2312": "gb18030", "gbk": "gb18030",
           "x-cp936": "gb18030", "utf-8": "utf-8"}


def read_html(path):
    raw = open(path, "rb").read()
    m = re.search(r'charset=["\']?([\w-]+)', raw[:2048].decode("ascii", "ignore"), re.I)
    enc = (m.group(1) if m else "gbk").lower()
    enc = ENC_MAP.get(enc, enc)
    try:
        return raw.decode(enc, "replace")
    except LookupError:
        return raw.decode("gb18030", "replace")


def export_one(path, outdir):
    import win32com.client as win32
    word = win32.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        doc = word.Documents.Open(path, ReadOnly=True)
        htm = os.path.join(outdir, "t.htm")
        doc.SaveAs2(htm, FileFormat=10)
        doc.Close(False)
    finally:
        word.Quit()
    return htm


def strip_word_junk(html):
    """剥掉 Word 的条件注释、XML 声明、meta，保留 body 内容和样式类。"""
    h = re.sub(r"(?is)<!--\[if[^\]]*\]>.*?<!\[endif\]-->", "", html)
    h = re.sub(r"(?is)<!--.*?-->", "", h)
    h = re.sub(r"(?is)<\?xml[^>]*\?>", "", h)
    h = re.sub(r"(?is)<meta[^>]*>", "", h)
    h = re.sub(r"(?is)<link[^>]*>", "", h)
    return h


def body_only(html):
    m = re.search(r"(?is)<body[^>]*>(.*)</body>", html)
    return m.group(1) if m else html


def head_only(html):
    m = re.search(r"(?is)<head[^>]*>(.*?)</head>", html)
    return m.group(1) if m else ""


files = sorted(glob.glob(os.path.join(CACHE, "*.docx")), key=os.path.getsize)
picks = [files[len(files) // 2], files[len(files) // 3], files[0]]

tot_raw = tot_strip = tot_body = tot_css = 0
for p in picks:
    outdir = tempfile.mkdtemp(prefix="an-")
    try:
        htm = export_one(p, outdir)
        h = read_html(htm)
        raw = len(h.encode("utf-8"))
        s = strip_word_junk(h)
        st = len(s.encode("utf-8"))
        b = body_only(s)
        bl = len(b.encode("utf-8"))
        head = head_only(s)
        hl = len(head.encode("utf-8"))
        css = 0
        for m in re.finditer(r"(?is)<style[^>]*>(.*?)</style>", head):
            css += len(m.group(1).encode("utf-8"))
        tot_raw += raw
        tot_strip += st
        tot_body += bl
        tot_css += css
        print("%s  原始 %6.1f KB → 剥冗余 %6.1f KB → 只留 body %6.1f KB（其中 CSS %5.1f KB）"
              % (os.path.basename(p)[:10], raw / 1024.0, st / 1024.0, bl / 1024.0, css / 1024.0))
    finally:
        shutil.rmtree(outdir, ignore_errors=True)

n = len(picks)
print("\n平均：原始 %.1f KB，剥冗余后 %.1f KB，body %.1f KB（CSS %.1f KB）"
      % (tot_raw / 1024.0 / n, tot_strip / 1024.0 / n, tot_body / 1024.0 / n, tot_css / 1024.0 / n))
print("全量 2102 篇外推：原始 %.0f MB，剥冗余后 %.0f MB，body 共用 CSS 后 %.0f MB"
      % (tot_raw / 1024.0 / n * 2102 / 1024.0, tot_strip / 1024.0 / n * 2102 / 1024.0,
         (tot_body - tot_css) / 1024.0 / n * 2102 / 1024.0))
