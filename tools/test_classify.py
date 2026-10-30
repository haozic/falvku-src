# -*- coding: utf-8 -*-
"""1) Word HTML 的内联样式去重能省多少  2) WPS COM 能不能开 .wps/.doc"""
import os, sys, re, glob, shutil, tempfile, collections

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
ENC_MAP = {"x-cp20936": "gb18030", "gb2312": "gb18030", "gbk": "gb18030"}


def read_html(path):
    raw = open(path, "rb").read()
    m = re.search(r'charset=["\']?([\w-]+)', raw[:2048].decode("ascii", "ignore"), re.I)
    enc = ENC_MAP.get((m.group(1) if m else "gbk").lower(), "gb18030")
    return raw.decode(enc, "replace")


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


files = sorted(glob.glob(os.path.join(CACHE, "*.docx")), key=os.path.getsize)
picks = [files[len(files) // 2], files[len(files) // 3], files[0]]

tot_raw = tot_cls = tot_css = 0
for p in picks:
    outdir = tempfile.mkdtemp(prefix="cls-")
    try:
        h = read_html(export_one(p, outdir))
        m = re.search(r"(?is)<body[^>]*>(.*)</body>", h)
        body = m.group(1) if m else h
        raw = len(h.encode("utf-8"))

        styles = re.findall(r'(?i)style="([^"]*)"', body)
        uniq = sorted(set(s.strip() for s in styles if s.strip()))
        css = "".join(".w%d{%s}" % (i, s) for i, s in enumerate(uniq))
        idx = {s: i for i, s in enumerate(uniq)}

        def repl(mm):
            s = mm.group(1).strip()
            return 'class="w%d"' % idx[s] if s in idx else mm.group(0)

        body2 = re.sub(r'(?i)style="([^"]*)"', repl, body)
        body2 = re.sub(r'(?i)\s*class="([^"]*)"', lambda mm: ' class="%s"' % mm.group(1), body2)
        out = body2 + "\n<style>" + css + "</style>"
        cl = len(out.encode("utf-8"))
        tot_raw += raw
        tot_cls += cl
        tot_css += len(css.encode("utf-8"))
        print("%s  原始 %6.1f KB → 去重后 %6.1f KB（内联样式 %d 种，CSS %d B）"
              % (os.path.basename(p)[:10], raw / 1024.0, cl / 1024.0, len(uniq), len(css.encode("utf-8"))))
    finally:
        shutil.rmtree(outdir, ignore_errors=True)

n = len(picks)
print("\n平均：原始 %.1f KB → 去重后 %.1f KB" % (tot_raw / 1024.0 / n, tot_cls / 1024.0 / n))
print("全量外推：原始 %.0f MB → 去重后 %.0f MB（共用 CSS 再省 %.0f MB）"
      % (tot_raw / 1024.0 / n * 2102 / 1024.0, tot_cls / 1024.0 / n * 2102 / 1024.0,
         tot_css / 1024.0 / n * 2102 / 1024.0))

# ---- WPS COM 探测 ----
print("\n=== WPS COM 探测 ===")
for prog in ("Kwps.Application", "wps.Application", "Ket.Application"):
    try:
        import win32com.client as win32
        app = win32.Dispatch(prog)
        print("  %s -> 可用：%s" % (prog, app))
        try:
            app.Quit()
        except Exception:
            pass
    except Exception as e:
        print("  %s -> 不可用：%s" % (prog, str(e)[:90]))
