# -*- coding: utf-8 -*-
"""校验 flk_cache/<bbbs>.docx 是否与 flk_meta.json 中的标题一致。

多 worker 共用一个 Chrome 时 Browser.setDownloadBehavior 是浏览器级命令，
会把别的 worker 的下载文件写进本 worker 目录，导致正文与 bbbs 错配。
本脚本用 docx 正文首行与 meta 标题比对，列出所有错配项。

用法：python tools/verify_flk_mapping.py [--fix-missing]
"""
import sys, os, json, re, zipfile

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")

META = {m["bbbs"]: m for m in json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))}


def docx_text(path):
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
    except Exception as e:
        return None, "zip:" + str(e)
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<[^>]+>", "", xml)
    xml = xml.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    lines = [l.strip() for l in xml.split("\n")]
    lines = [l for l in lines if l]
    return lines, None


def norm(s):
    if not s:
        return ""
    s = s.replace("﻿", "")          # BOM
    s = re.sub(r"[\u200b-\u200f\ufeff]", "", s)
    s = re.sub(r"[\s　]+", "", s)
    s = re.sub(r"[《》（）()、，,。.:：;；\"'“”‘’\[\]【】\-—_0-9A-Za-z\s]", "", s)
    return s


def title_matches(title, lines):
    """flk 的 title 字段被截断到约 39 字，故只比对前 12 字（去标点后）。

    另有一种常见形态：标题带括号补充（宪法（1982年）/（2018年修正文本）），
    正文首行写的是「中华人民共和国宪法（一九八二年十二月四日……通过）」，
    这时改用「括号前的主标题」比对。
    """
    if not lines:
        return False
    head = norm("".join(lines[:4]))
    t = norm(title)
    if not t or not head:
        return False
    if t in head:
        return True
    base = norm(re.split(r"[（(]", title or "")[0])
    if base and len(base) >= 4 and head.startswith(base):
        return True
    return head.startswith(t[:min(12, len(t))])


def main():
    have = sorted(f.rsplit(".", 1)[0] for f in os.listdir(CACHE) if f.endswith(".docx"))
    bad = []
    empty = []
    ok = 0
    for bbbs in have:
        m = META.get(bbbs)
        title = m["title"] if m else ""
        lines, err = docx_text(os.path.join(CACHE, bbbs + ".docx"))
        if lines is None:
            bad.append({"bbbs": bbbs, "title": title, "why": err})
            continue
        if not lines:
            empty.append({"bbbs": bbbs, "title": title})
            continue
        nt = norm(title)
        if title_matches(title, lines):
            ok += 1
            continue
        bad.append({"bbbs": bbbs, "title": title, "why": "title-mismatch",
                    "head": "".join(lines[:3])[:80]})

    print("已下载 docx: %d" % len(have))
    print("  标题匹配: %d" % ok)
    print("  疑似错配: %d" % len(bad))
    print("  空正文  : %d" % len(empty))
    if bad:
        print("\n--- 疑似错配明细（最多 60 条）---")
        for b in bad[:60]:
            print("  %s | 期望: %s | 实得: %s" % (b["bbbs"], b["title"][:40], b.get("head", b.get("why", ""))))

    # ---- 再校验已解析的 json ----
    jbad = []
    jok = 0
    jhave = sorted(f.rsplit(".", 1)[0] for f in os.listdir(CACHE) if f.endswith(".json"))
    for bbbs in jhave:
        m = META.get(bbbs)
        if not m:
            continue
        try:
            rec = json.load(open(os.path.join(CACHE, bbbs + ".json"), encoding="utf-8"))
        except Exception as e:
            jbad.append({"bbbs": bbbs, "why": "json:" + str(e)[:40]})
            continue
        secs = rec.get("sections") or []
        head = [ln for s in secs for ln in (s.get("text") or "").split("\n") if ln.strip()][:4]
        if not head:
            jbad.append({"bbbs": bbbs, "title": m["title"], "why": "empty-sections"})
            continue
        if title_matches(m.get("title", ""), head):
            jok += 1
        else:
            jbad.append({"bbbs": bbbs, "title": m["title"], "why": "title-mismatch",
                         "head": "".join(head[:3])[:80]})
    print("\n已解析 json: %d" % len(jhave))
    print("  标题匹配: %d" % jok)
    print("  疑似错配: %d" % len(jbad))
    for b in jbad[:40]:
        print("  %s | 期望: %s | 实得: %s" % (b["bbbs"], (b.get("title") or "")[:40], b.get("head", b.get("why", ""))))

    with open(os.path.join(TOOLS, "flk_mapping_bad.json"), "w", encoding="utf-8") as f:
        json.dump({"bad": bad, "empty": empty, "json_bad": jbad}, f, ensure_ascii=False, indent=1)
    print("\n明细已写入 tools/flk_mapping_bad.json")


if __name__ == "__main__":
    main()
