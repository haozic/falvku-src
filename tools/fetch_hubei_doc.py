# -*- coding: utf-8 -*-
"""下载湖北法规库的 .doc 原件并转成 .docx（供 Word 原文预览用）。

附件链路：
    fujianlist.jsp?RuleId=<id>            -> 附件列表（accdownload.jsp?Param=<十六进制>）
    accdownload.jsp?Param=<hex>           -> .doc（Word 97-2003，OLE2 复合文档）
    Word COM 转 .docx                      -> tools/hubei_cache/<rileid>.docx

用法：
    python tools/fetch_hubei_doc.py --limit 5      # 试跑
    python tools/fetch_hubei_doc.py                # 全量
"""
import os, sys, re, json, time, argparse

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "hubei_cache")
BASE = "http://119.36.213.154:8088/fgk/"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def make_session():
    import requests
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    return s


def attach_url(s, rileid):
    """取附件下载链接；没有附件返回 None。"""
    r = s.get(BASE + "fujianlist.jsp?RuleId=" + rileid, timeout=40)
    r.encoding = "utf-8"
    m = re.search(r"accdownload\.jsp\?Param=([0-9A-Fa-f]+)", r.text)
    return (BASE + "accdownload.jsp?Param=" + m.group(1)) if m else None


def download_doc(s, rileid):
    """下载 .doc 原文，返回字节；无附件返回 None。"""
    url = attach_url(s, rileid)
    if not url:
        return None
    r = s.get(url, timeout=120, allow_redirects=True)
    data = r.content
    if data[:8] != OLE_MAGIC:
        # 有些附件其实是 docx（PK）
        if data[:2] == b"PK":
            return data
        return None
    return data


class WordBatch:
    """批量 .doc -> .docx 转换（复用同一个 Word 实例，比逐个启停快很多）。"""

    def __init__(self):
        import win32com.client as win32
        self.word = win32.DispatchEx("Word.Application")
        self.word.Visible = False
        self.word.DisplayAlerts = 0

    def convert(self, src, dst):
        doc = None
        try:
            doc = self.word.Documents.Open(os.path.abspath(src), ReadOnly=True,
                                           AddToRecentFiles=False)
            doc.SaveAs2(os.path.abspath(dst), FileFormat=16)   # 16 = wdFormatXMLDocument
            doc.Close(SaveChanges=0)
            doc = None
            return True
        except Exception as e:
            print("  !! Word 转换失败 %r" % (e,))
            if doc is not None:
                try:
                    doc.Close(SaveChanges=0)
                except Exception:
                    pass
            return False

    def close(self):
        try:
            self.word.Quit()
        except Exception:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    files = sorted(f for f in os.listdir(CACHE) if f.endswith(".json"))
    if args.limit:
        files = files[:args.limit]
    todo = [f[:-5] for f in files
            if not os.path.exists(os.path.join(CACHE, f[:-5] + ".docx"))]
    print("待下载附件：%d 篇（共 %d）" % (len(todo), len(files)))
    if not todo:
        return

    s = make_session()
    batch = None
    ok = 0
    noatt = 0
    fail = 0
    try:
        for i, rileid in enumerate(todo):
            docx = os.path.join(CACHE, rileid + ".docx")
            rawp = os.path.join(CACHE, rileid + ".doc")
            try:
                data = download_doc(s, rileid)
            except Exception as e:
                print("  !! 下载失败 %s %r" % (rileid, e))
                fail += 1
                continue
            if data is None:
                noatt += 1
                continue
            with open(rawp, "wb") as f:
                f.write(data)
            if data[:2] == b"PK":          # 本身就是 docx
                os.replace(rawp, docx)
                ok += 1
                continue
            if batch is None:
                batch = WordBatch()
            if not batch.convert(rawp, docx):
                fail += 1
                continue
            try:
                os.remove(rawp)           # 转换完就删掉中间文件，省磁盘
            except Exception:
                pass
            ok += 1
            if ok % 25 == 0:
                print("  已转换 %d / %d（无附件 %d，失败 %d）" % (ok, len(todo), noatt, fail),
                      flush=True)
    finally:
        if batch is not None:
            batch.close()

    print("附件处理完成：成功 %d，无附件 %d，失败 %d" % (ok, noatt, fail))


if __name__ == "__main__":
    main()
