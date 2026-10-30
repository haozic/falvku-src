# -*- coding: utf-8 -*-
"""【已停用】把 flk 的 .docx 转成可在网页里直接展示的 HTML 片段（Word 预览）。

停用时间：2026-10-28。本站详情页只保留 Markdown 一种阅读形式，
Word 预览下线（data/word_NN.js 与 word_manifest.json 已删除，
build_dataset.py 不再写 hasWord / wordChunk 字段，更新数据.cmd 也不再调用本脚本）。

原始 .docx 仍完整保留在 tools/flk_cache/ 与 tools/hubei_cache/，
若将来要恢复 Word 预览，直接运行本脚本即可重新生成 data/word_NN.js，
并把 build_dataset.py 里 build_flk_records / build_hubei_records 的
word_manifest 读取逻辑加回去。

为什么要转：Chrome 69 不能原生渲染 .docx（没有内置 Office 阅读器），
离线单文件站点又不能用外部转换服务。docx 里本来也只有段落级排版
（实测无加粗 run、无表格），转成 HTML 后能完整保留：
    * 段落切分与空行（原文的段落边界）
    * 首行缩进 / 左缩进（w:ind 的 leftChars / firstLineChars，单位 1/100 字符）
    * 居中 / 右对齐（w:jc）
    * 加粗、斜体（个别文档有）
    * 表格（个别文档有）

体积优化：正文段落一律输出裸 <p>，靠 .pv-doc 容器选择器给默认样式，
只有需要覆盖的段落才带 class（n/c/r/f1/l1/l2/l4）。30 万段落时，
内联 style 与冗长 class 会让分片凭空多出好几 MB。

用法：
    python tools/word_html.py --sample 100     # 抽样估算体积
    python tools/word_html.py                  # 全量生成 data/word_NN.js
"""
import os, sys, re, io, json, zipfile, argparse, html as htmlmod
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import section_parser as SP
# 语料顺序必须与 build_dataset 完全一致（否则 id 与站点数据对不上，Word 预览会张冠李戴）
import build_dataset as BD

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "flk_cache")
DATA = os.path.join(ROOT, "data")


def esc(s):
    return htmlmod.escape(s or "", quote=False)


# docx 结构解析统一放在 section_parser（段落边界只认 <w:p>，段内换行只认 <w:br/>）
parse_body = SP.docx_blocks
_para_cls = SP._para_cls
_norm_text = SP.norm_text


def block_text(b):
    if b['t'] == 'tbl':
        return ""
    return "\n".join("".join(r[0] for r in seg) for seg in b['segs'])


def norm_line(s):
    return _norm_text(s)


def build_html(blocks):
    """把块转成 HTML 片段；目录块自动剔除，标题与 sections 一一对应（id=secN）。"""
    # 1) 还原成行序列，用来判定目录块范围
    lines = []
    for b in blocks:
        if b['t'] != 'p':
            continue
        for ln in block_text(b).split("\n"):
            t = norm_line(ln)
            if t:
                lines.append(t)
    m = SP.find_toc_marker(lines)
    drop = set()
    if m >= 0:
        e = m + 1
        while e < len(lines) and SP.is_heading(lines[e]):
            e += 1
        if e > m + 1:
            later = {}
            seen = set()
            for i in range(len(lines) - 1, m, -1):
                if SP.is_heading(lines[i]):
                    nm = SP.norm_heading(lines[i])
                    later[i] = nm in seen
                    seen.add(nm)
            p = m + 1
            while p < e and later.get(p, False):
                p += 1
            drop = set(range(m, p))          # 含「目 录」标记本身
        else:
            drop = {m}

    # 2) 逐块输出
    out = []
    li = 0          # 行游标
    sec = 0         # 标题序号
    skipped = 0
    gap = False     # 上一个输出是不是空行
    for b in blocks:
        if b['t'] == 'tbl':
            rows = b['rows']
            if not rows:
                continue
            out.append('<table><tbody>')
            for r in rows:
                out.append('<tr>' + ''.join('<td>' + esc(c) + '</td>' for c in r) + '</tr>')
            out.append('</tbody></table>')
            gap = False
            continue
        cls = b['cls']
        for seg in b['segs']:
            raw = "".join(r[0] for r in seg)
            if not norm_line(raw):
                # 空行：保留一个间隔（<p></p> + .pv-doc p:empty 样式）
                if out and not gap:
                    out.append('<p></p>')
                    gap = True
                continue
            gap = False
            t = norm_line(raw)
            if li in drop:
                li += 1
                skipped += 1
                continue
            if SP.is_heading(t):
                lv = SP.heading_level(t)
                # 一级用 h3、二级用 h4：语义清楚，CSS 不用再带 class
                tag = 'h3' if lv != 2 else 'h4'
                out.append("<%s id='sec%d'>%s</%s>" % (tag, sec, esc(t), tag))
                sec += 1
            else:
                # class 只在需要覆盖默认样式时才带；默认段落输出裸 <p>
                out.append('<p%s>%s</p>' % ((' class="%s"' % cls) if cls else '', runs_html(seg)))
            li += 1
    return "".join(out), sec, skipped


def runs_html(runs):
    """把 run 序列转成 HTML。"""
    if not any(r[1] or r[2] for r in runs):
        t = "".join(r[0] for r in runs)
        return esc(t).lstrip("\u3000 \t")
    out = []
    for text, bold, ital in runs:
        t = esc(text)
        if bold:
            t = "<b>" + t + "</b>"
        if ital:
            t = "<i>" + t + "</i>"
        out.append(t)
    # 原文段落自带全角空格缩进，CSS 里已经有缩进，去掉避免双重缩进
    return "".join(out).replace("\u3000", " ").lstrip(" \t")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--chunk", type=int, default=160)
    args = ap.parse_args()

    # id 与 build_dataset.build_flk_records / build_hubei_records 一致：
    # 同一份语料、同一顺序（两个 loader 都按缓存文件名字典序）
    items = []      # (rid, docx 路径, 标题, 全局序号)
    corpus = BD.load_flk_corpus()
    for i, c in enumerate(corpus):
        title = (c.get("title") or "").strip()
        if not title:
            continue
        dp = os.path.join(CACHE, c["bbbs"] + ".docx")
        if not os.path.exists(dp):
            continue
        items.append(('n%04d' % (i + 1), dp, title, len(items) + 1))
    n_flk = len(items)

    # 湖北地方法规：附件是 .doc，先由 tools/fetch_hubei_doc.py 转成 .docx
    hub = BD.load_hubei_corpus()
    for i, c in enumerate(hub):
        title = (c.get("title") or "").strip()
        if not title:
            continue
        dp = os.path.join(ROOT, "tools", "hubei_cache", (c.get("rileid") or "") + ".docx")
        if not os.path.exists(dp):
            continue
        items.append(('h%04d' % (i + 1), dp, title, len(items) + 1))

    if args.sample:
        items = items[:args.sample]
        total = 0
        n = 0
        for rid, dp, title, seq in items:
            try:
                blocks = parse_body(open(dp, "rb").read())
                html, nsec, skipped = build_html(blocks)
            except Exception as e:
                print("  !! %s %r" % (rid, e))
                continue
            total += len(html)
            n += 1
        print("抽样 %d 篇，HTML 合计 %.1f MB，平均 %.1f KB"
              % (n, total / 1048576.0, total / max(n, 1) / 1024.0))
        return

    # 全量：按 id 顺序分片写 data/word_NN.js（页面按需加载，不进 index.html）
    os.makedirs(DATA, exist_ok=True)
    for old in os.listdir(DATA):
        if old.startswith("word_") and old.endswith(".js"):
            os.remove(os.path.join(DATA, old))

    n = 0
    total = 0
    manifest = {}
    ids = [x[0] for x in items]
    nchunk = ((len(items) // args.chunk) + 1) if items else 0
    handles = []
    for k in range(nchunk):
        fp = open(os.path.join(DATA, "word_%02d.js" % (k + 1)), "w", encoding="utf-8")
        fp.write("window.FG_WORD = window.FG_WORD || {};\n")
        handles.append(fp)

    for rid, dp, title, seq in items:
        k = (seq - 1) // args.chunk
        if k >= len(handles):
            break
        try:
            blocks = parse_body(open(dp, "rb").read())
            html, nsec, skipped = build_html(blocks)
        except Exception as e:
            print("  !! %s %r" % (rid, e))
            continue
        if not html:
            continue
        handles[k].write('window.FG_WORD["%s"]=%s;\n' % (rid, json.dumps(html, ensure_ascii=False)))
        manifest[rid] = {'chunk': k + 1, 'title': title}
        total += len(html)
        n += 1
        if n % 200 == 0:
            print("  已转换 %d 篇，%.1f MB" % (n, total / 1048576.0), flush=True)
    for fp in handles:
        fp.close()
    json.dump(manifest, open(os.path.join(TOOLS, "word_manifest.json"), "w", encoding="utf-8"))
    print("完成：%d 篇（flk %d / 湖北 %d），HTML 合计 %.1f MB，分片 %d 个 -> data/word_NN.js"
          % (n, n_flk, n - n_flk, total / 1048576.0, nchunk))


if __name__ == "__main__":
    main()
