# -*- coding: utf-8 -*-
"""补抓「附件是旧版 .doc」的法规。

flk 上少数老法规挂的是 Word 97-2003 的 .doc（OLE2 复合文档），不是 docx，
魔数校验（PK）会判定失败。办法：先用 Word COM（本机装有 Microsoft Word）
把它转成 .docx，再复用 finish_flk 的解析规则切章节。

用法：python tools/fetch_flk_doc.py
"""
import sys, os, re, json, time
sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")
BASE = "https://flk.npc.gov.cn"

sys.path.insert(0, TOOLS)
from finish_flk import docx_lines, split_sections, pick_preamble  # noqa: E402

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def word_convert(src, dst):
    """用 Word COM 把 .doc 转成 .docx。"""
    import win32com.client as win32
    word = win32.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    doc = None
    try:
        doc = word.Documents.Open(os.path.abspath(src), ReadOnly=True, AddToRecentFiles=False)
        # 16 = wdFormatXMLDocument（.docx）
        doc.SaveAs2(os.path.abspath(dst), FileFormat=16)
        doc.Close(SaveChanges=0)
        doc = None
        return True
    except Exception as e:
        print("  !! Word 转换失败 %r" % e)
        if doc is not None:
            try:
                doc.Close(SaveChanges=0)
            except Exception:
                pass
        return False
    finally:
        try:
            word.Quit()
        except Exception:
            pass


def main():
    import requests
    meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
    todo = []
    for m in meta:
        d = os.path.join(CACHE, m["bbbs"] + ".docx")
        j = os.path.join(CACHE, m["bbbs"] + ".json")
        if os.path.exists(d) or os.path.exists(j):
            continue
        todo.append(m)
    print("待补（无 docx 无 json）：%d 篇" % len(todo))
    if not todo:
        return

    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": BASE, "Referer": BASE + "/index",
    })

    ok = 0
    for m in todo:
        bbbs = m["bbbs"]
        raw = os.path.join(CACHE, bbbs + ".rawdoc")
        url = BASE + "/law-search/download/mobile?format=docx&bbbs=" + bbbs + "&fileId="
        try:
            r = s.get(url, timeout=120, allow_redirects=True)
        except Exception as e:
            print("  !! 下载失败 %s %r" % (bbbs[:12], e))
            continue
        if r.content[:8] != OLE_MAGIC:
            print("  !! 不是 .doc，跳过 %s（%d 字节）" % (bbbs[:12], len(r.content)))
            continue
        with open(raw, "wb") as f:
            f.write(r.content)
        print("  ~ 下载 .doc %d 字节：%s" % (len(r.content), m["title"][:30]))

        conv = os.path.join(CACHE, bbbs + ".docx")
        if not os.path.exists(conv):
            if not word_convert(raw, conv):
                continue
        try:
            lines = docx_lines(open(conv, "rb").read())
        except Exception as e:
            print("  !! 解析失败 %s %r" % (bbbs[:12], e))
            continue
        if not lines:
            print("  !! 无正文 %s" % bbbs[:12])
            continue
        sections = split_sections(lines)
        rec = dict(m)
        rec["sections"] = sections
        rec["preamble"] = pick_preamble(lines)
        rec["chars"] = sum(len(x["text"].replace(" ", "")) for x in sections)
        rec["lines"] = len(lines)
        rec["fromDoc"] = True
        json.dump(rec, open(os.path.join(CACHE, bbbs + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
        ok += 1
        print("  + %s %s（%d 段，%d 字）" % (bbbs[:12], m["title"][:24], rec["lines"], rec["chars"]))

    print("旧版 .doc 补抓完成：%d / %d" % (ok, len(todo)))


if __name__ == "__main__":
    main()
