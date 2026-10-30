# -*- coding: utf-8 -*-
"""实测：用本机 Word COM 把 docx 导出为 PDF 与「筛选过的网页 HTML」，量体积。"""
import os, sys, glob, zipfile, shutil, tempfile

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")


def docx_profile(path):
    """看 docx 里有没有图片/表格。"""
    info = {"media": 0, "media_bytes": 0}
    try:
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.startswith("word/media/"):
                    info["media"] += 1
                    info["media_bytes"] += z.getinfo(n).file_size
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
            info["tables"] = xml.count("<w:tbl>")
    except Exception as e:
        info["err"] = str(e)
    return info


def export(path, outdir):
    import win32com.client as win32
    word = win32.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    out = {}
    try:
        doc = word.Documents.Open(path, ReadOnly=True)
        pdf = os.path.join(outdir, "t.pdf")
        doc.SaveAs2(pdf, FileFormat=17)        # wdFormatPDF
        out["pdf"] = os.path.getsize(pdf)
        htm = os.path.join(outdir, "t.htm")
        doc.SaveAs2(htm, FileFormat=10)        # wdFormatFilteredHTML
        out["html"] = os.path.getsize(htm)
        # 附带资源文件夹大小
        aux = 0
        for d in os.listdir(outdir):
            dp = os.path.join(outdir, d)
            if os.path.isdir(dp) and d.startswith("t_files"):
                for r, _, fs in os.walk(dp):
                    for f in fs:
                        aux += os.path.getsize(os.path.join(r, f))
        out["html_aux"] = aux
        out["pages"] = doc.ComputeStatistics(2)   # wdStatisticPages
        doc.Close(False)
    finally:
        word.Quit()
    return out


samples = sys.argv[1:] or []
if not samples:
    # 取 3 个代表：中等大小、含表、含图
    files = sorted(glob.glob(os.path.join(CACHE, "*.docx")), key=lambda p: os.path.getsize(p))
    picks = [files[len(files) // 2], files[len(files) // 4]]
    withimg = []
    for p in files:
        pr = docx_profile(p)
        if pr.get("media"):
            withimg.append((pr["media_bytes"], p))
            if len(withimg) >= 2:
                break
    picks += [p for _, p in withimg]
    samples = picks[:4]

for p in samples:
    pr = docx_profile(p)
    outdir = tempfile.mkdtemp(prefix="w2exp-")
    try:
        r = export(p, outdir)
        print("\n%s" % os.path.basename(p))
        print("   源 docx : %8.1f KB" % (os.path.getsize(p) / 1024.0))
        print("   表格 %d 个 / 图片 %d 张(%d KB)" % (pr.get("tables", 0), pr.get("media", 0),
                                                pr.get("media_bytes", 0) // 1024))
        print("   -> PDF  : %8.1f KB（%d 页）" % (r["pdf"] / 1024.0, r["pages"]))
        print("   -> HTML : %8.1f KB + 资源 %8.1f KB" % (r["html"] / 1024.0, r["html_aux"] / 1024.0))
    except Exception as e:
        print("\n%s  导出失败：%s" % (os.path.basename(p), e))
    finally:
        shutil.rmtree(outdir, ignore_errors=True)
