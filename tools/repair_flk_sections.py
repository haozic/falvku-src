# -*- coding: utf-8 -*-
"""用新解析规则重算 flk 全部 1596 条的章节结构。

数据来源优先级：
  1) 有合法 docx 的：重新解析 docx（目录完整、顺序正确）
  2) 只有 .json 的：从 .json 还原行序列再重算

安全护栏：重算只会删掉「标题行」，非标题行（正文条文）必须逐行保持一致，
否则说明源文件被误伤，记录下来不写入。

用法：
    python tools/repair_flk_sections.py --dry-run   # 只报告，不写盘
    python tools/repair_flk_sections.py             # 写回 <bbbs>.json
"""
import os, sys, io, re, json, zipfile, argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import section_parser as SP

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")


def docx_lines(raw):
    """解析 docx 成行序列（统一走 section_parser 的 OOXML 结构解析）。

    早期版本用「正则剥标签 + 按 \\n 切行」，而 flk 导出的 docx 是美化过的 XML，
    标签之间带 CRLF 缩进，剥完标签后每个 run 边界都残留换行，
    「第一条」（黑体）和后面的正文（仿宋）就被拆成了两行。
    """
    return SP.docx_lines(raw)


def body_lines(lines):
    """非标题行序列（正文条文），用于一致性校验。"""
    return [x for x in lines if not SP.is_heading(x) and not SP.TOC_MARK_RE.match(x.strip())]


def body_key(lines):
    """正文内容指纹：去掉所有空白后拼接。

    换行位置会随解析方式变化（run 边界合并等），逐行比对太脆；
    指纹比对既能发现「正文丢了 / 重复了」，又不受换行位置影响。
    """
    return re.sub(r"\s+", "", "".join(body_lines(lines)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
    n_docx = n_json = n_skip = 0
    changed = 0
    toc_records = 0
    toc_entries = 0
    phantom_removed = 0
    mismatch = []
    src_diff = []
    samples = []

    for m in meta:
        bbbs = m["bbbs"]
        jp = os.path.join(CACHE, bbbs + ".json")
        dp = os.path.join(CACHE, bbbs + ".docx")
        if not os.path.exists(jp):
            n_skip += 1
            continue
        try:
            rec = json.load(open(jp, encoding="utf-8"))
        except Exception as e:
            n_skip += 1
            continue

        old_lines = SP.restore_lines(rec.get("sections"))
        src = "json"
        lines = old_lines
        if os.path.exists(dp):
            try:
                lines = docx_lines(open(dp, "rb").read())
                src = "docx"
                n_docx += 1
            except Exception:
                lines = old_lines
                src = "json"
                n_json += 1
        else:
            n_json += 1

        # docx 与 json 的正文内容必须一致，否则两个来源有出入
        if src == "docx":
            a = body_key(lines)
            b = body_key(old_lines)
            if a != b:
                src_diff.append((m["title"], len(a), len(b)))

        secs, toc = SP.build_sections(lines)
        toc_records += 1 if toc else 0
        toc_entries += len(toc)

        old_sections = rec.get("sections") or []
        old_named = len([s for s in old_sections if (s.get("name") or "").strip()])
        new_named = len([s for s in secs if (s.get("name") or "").strip()])
        if new_named != old_named:
            phantom_removed += old_named - new_named
            changed += 1

        # 护栏：重算后的正文内容必须与源行序列一致（只允许删掉目录标题行）
        orig_body = body_key(lines)
        new_body = re.sub(r"\s+", "", "".join(s["text"] for s in secs))
        if new_body != orig_body:
            mismatch.append((m["title"], len(new_body), len(orig_body)))

        if len(samples) < 6 and toc:
            samples.append((m["title"], toc, [s["name"] for s in secs if s["name"]][:12]))

        if not args.dry_run:
            rec["sections"] = [{"name": s["name"], "text": s["text"], "level": s["level"]} for s in secs]
            rec["chars"] = sum(len(s["text"].replace(" ", "")) for s in secs)
            rec["lines"] = len(lines)
            tmp = jp + ".tmp"
            json.dump(rec, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
            os.replace(tmp, jp)

    out = os.path.join(TOOLS, "repair_report.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("来源 docx %d / json %d / 跳过 %d\n" % (n_docx, n_json, n_skip))
        f.write("有目录块的记录 %d，剥离目录条目 %d 条\n" % (toc_records, toc_entries))
        f.write("章节结构有变化的记录 %d，减少的标题条目 %d\n" % (changed, phantom_removed))
        f.write("正文行校验不一致 %d\n" % len(mismatch))
        for t in mismatch[:20]:
            f.write("   !! %s\n" % (t,))
        f.write("docx 与 json 正文不一致 %d\n" % len(src_diff))
        for t in src_diff[:20]:
            f.write("   ~ %s  docx %d 行 / json %d 行\n" % (t[0], t[1], t[2]))
        f.write("\n--- 样例 ---\n")
        for title, toc, names in samples:
            f.write("\n%s\n  目录条目(%d): %s\n  正文标题: %s\n"
                    % (title, len(toc), " / ".join(toc[:8]), " | ".join(names)))
    print("来源 docx %d / json %d；剥离目录条目 %d；结构变化 %d 篇；校验不一致 %d"
          % (n_docx, n_json, toc_entries, changed, len(mismatch)))


if __name__ == "__main__":
    main()
