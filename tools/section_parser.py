# -*- coding: utf-8 -*-
"""章节解析核心：识别标题行、剥离源文档「目 录」块、判定一级/二级层级。

背景
----
国家法律法规数据库（flk.npc.gov.cn）导出的 docx，正文开头常常带一段「目 录」。
目录里的条目长得和正文标题一模一样（「第八章 其他规定」「第一节 一般规定」），
早期解析器把目录条目当成了正文切分点，于是：
  * 目录里出现「正文里根本没有的章节」（目录条目本身没有正文，被后面的条目顶掉）；
  * 目录条目重复出现（目录一份 + 正文一份）；
  * 正文顶部混进「分 则 / 附 则 / 总 则」这类目录残留。

判定「目录条目」的规则
----------------------
目录块 = 「目 录」标记之后连续的标题行。目录里的条目在正文里还会再出现一次，
而正文真正的第一个标题通常不会在它后面再出现。因此：
    目录块 = 从标记后第一行开始、每个条目名都在更靠后位置再次出现的**最长前缀**。
剩下的一段就是正文自己的开头标题（它之后不再出现同名标题）。

层级
----
    一级：第X编 / 第X篇 / 第X分编 / 第X章 / 第X卷 / 第X部，以及「总则 / 分则 / 附则 / 序言」
    二级：第X节

被 tools/finish_flk.py（docx → json）与 tools/repair_flk_sections.py（用缓存 json 重算）共用。
"""
import re, io, zipfile, html as htmlmod

CN_NUM = "一二三四五六七八九十百零〇两"

# 第X编 / 第X分编 / 第X章 / 第X篇 / 第X节 / 第X卷 / 第X部
HEAD_RE = re.compile(r"^第[" + CN_NUM + r"\d]+(?:分)?[编章篇节卷部]")
# 总则 / 分则 / 附则 / 附录 / 序言（老法典常用裸标题）
BARE_RE = re.compile(r"^(总\s*则|分\s*则|附\s*则|附\s*录|序\s*言)$")
# 「目 录」标记
TOC_MARK_RE = re.compile(r"^目\s*录$")
# 条文行（第X条）
ART_RE = re.compile(r"^第[" + CN_NUM + r"\d]+条")


def is_heading(line):
    """是否是标题行（第X章 / 第X节 / 总则 …）。"""
    if not line:
        return False
    s = line.strip()
    return bool(HEAD_RE.match(s) or BARE_RE.match(s))


def heading_kind(line):
    """标题类别：part / chapter / section / bare；不是标题返回 ''。"""
    s = (line or "").strip()
    if not s:
        return ""
    if not is_heading(s):
        return ""
    if SECTION_RE.match(s):
        return "section"
    if BARE_RE.match(s):
        return "bare"
    if CHAPTERLIKE_RE.match(s):
        return "chapter"
    return "part"


SECTION_RE = re.compile(r"^第[" + CN_NUM + r"\d]+节")
CHAPTERLIKE_RE = re.compile(r"^第[" + CN_NUM + r"\d]+(?:分)?[编章篇卷部]")


def heading_level(line):
    """1 = 一级（编/篇/章/总则…），2 = 二级（节），0 = 不是标题。"""
    k = heading_kind(line)
    if k == "section":
        return 2
    if k:
        return 1
    return 0


def norm_heading(s):
    """标题名归一化：去空格与全角空格，用于同名比对。"""
    if not s:
        return ""
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"\s+", "", s)
    return s


# 枚举项行：「一、」「（一）」「1.」「(1)」
ENUM_RE = re.compile(r"^[（(]?[一二三四五六七八九十百零〇两\d]+[）)、.．]")


def is_heading_continuation(line):
    """这一行是不是「标题的续行」。

    湖北法规库（以及不少公文排版）里过长的标题会被折成两行，例如：
        第一节  人民代表大会及其常务委员会有关人员
        的任免
    不合并的话，标题被截断成前半截，后半截变成正文，
    目录里的条目名也跟正文对不上（目录块剥离随之失效）。

    注意：本身是标题的行（下一章/下一节）不能算续行，
    否则「第一章 总 则」会把「第二章 …」吞进来。
    """
    s = (line or "").strip()
    if not s or len(s) > 12:
        return False
    if is_heading(s):
        return False
    if ART_RE.match(s) or ENUM_RE.match(s):
        return False
    if s[-1] in "。；！？，、：":
        return False
    return True


def merge_heading_continuations(lines):
    """把跨行的标题合并成一行（标题行 + 其后的短续行）。"""
    out = []
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        if is_heading(ln) and i + 1 < n and is_heading_continuation(lines[i + 1]):
            out.append(ln.rstrip() + lines[i + 1].strip())
            i += 2
            continue
        out.append(ln)
        i += 1
    return out


def find_toc_marker(lines, limit=60):
    """找「目 录」标记行号，找不到返回 -1。只在前若干行里找，避免正文里提到「目录」被误判。"""
    for i, ln in enumerate(lines[:limit]):
        if TOC_MARK_RE.match(ln.strip()):
            return i
    return -1


def split_toc(lines):
    """剥离「目 录」块。

    返回 (正文行列表, 被剥离的目录条目列表)。
    """
    m = find_toc_marker(lines)
    if m < 0:
        return list(lines), []
    e = m + 1
    while e < len(lines) and is_heading(lines[e]):
        e += 1
    if e == m + 1:
        # 只有「目 录」标记，后面没有标题行：标记本身是残留
        return list(lines[:m]) + list(lines[m + 1:]), []
    # later[i] = 该标题名在更靠后的位置是否再次出现
    later = {}
    seen = set()
    for i in range(len(lines) - 1, m, -1):
        if is_heading(lines[i]):
            nm = norm_heading(lines[i])
            later[i] = nm in seen
            seen.add(nm)
    p = m + 1
    while p < e and later.get(p, False):
        p += 1
    toc = list(lines[m + 1:p])
    body = list(lines[:m]) + list(lines[p:])
    return body, toc


def split_sections(lines):
    """把行序列切成章节。

    返回 [{'name': 标题, 'text': 正文, 'level': 1|2|0}]。
    「有标题但正文为空」的章节要保留：章标题后面常常紧跟节标题，
    章本身没有正文，丢掉它目录里就少一章。
    """
    sections = []
    cur_name = ""
    cur_level = 0
    cur = []
    for ln in lines:
        if is_heading(ln):
            if cur or cur_name:
                sections.append({"name": cur_name, "text": "\n".join(cur), "level": cur_level})
            cur_name = ln.strip()
            cur_level = heading_level(cur_name)
            cur = []
        else:
            cur.append(ln)
    if cur or cur_name:
        sections.append({"name": cur_name, "text": "\n".join(cur), "level": cur_level})
    if not sections:
        sections = [{"name": "", "text": "\n".join(lines), "level": 0}]
    return sections


def restore_lines(sections):
    """由旧版 sections 反推原始行序列（旧 sections 只有 name/text，没有 level）。"""
    lines = []
    for s in sections or []:
        name = (s.get("name") or "").strip()
        if name:
            lines.append(name)
        for ln in (s.get("text") or "").split("\n"):
            if ln.strip():
                lines.append(ln.strip())
    return lines


def build_sections(lines):
    """完整流程：剥离目录块 → 切章节。

    注意：**不能**丢弃「有标题但正文为空」的章节。
    「第二章 自然人」后面紧跟「第一节 …」时，第二章本来就没有正文，
    如果按空正文丢掉，这一章就从目录里消失了（正是「正文没有第X章」的另一种表现）。

    返回 (sections, toc_entries)。
    """
    body, toc = split_toc(merge_heading_continuations(lines))
    secs = [s for s in split_sections(body) if s["text"].strip() or s["name"].strip()]
    if not secs:
        secs = [{"name": "", "text": "\n".join(body), "level": 0}]
    return secs, toc


# ===========================================================================
# docx 解析
# ===========================================================================
# flk 导出的 docx 是「美化过」的 XML：标签之间带 CRLF 缩进。
# 早期解析用「正则剥标签 → 按 \n 切行」，剥完标签后每个 run 边界都残留 \r\n，
# 于是「第一条」（黑体 run）和后面的正文（仿宋 run）被拆成两行，
# Markdown 视图里条号就单独成段了。
# 这里按 OOXML 结构解析：段落边界只认 <w:p>，段内换行只认 <w:br/>。


def _unescape(s):
    """还原 docx XML 实体（&amp; &lt; &#8220; …）。"""
    return htmlmod.unescape(s or "")


def _para_cls(blk):
    """按 docx 的对齐与缩进算出段落 class。

    约定（与 style.css 的 .pv-doc 规则一一对应）：
        ''   默认：首行缩进 2 字符（公文最常见）
        n    无缩进
        c    居中      r  右对齐
        f1   首行缩进 1 字符
        l1/l2/l4  整段左缩进 1/2/4 字符
    """
    m = re.search(r'<w:jc[^>]*w:val="([^"]+)"', blk)
    jc = m.group(1) if m else ""
    if jc == "center":
        return "c"
    if jc in ("right", "end"):
        return "r"

    im = re.search(r"<w:ind[^>]*>", blk)
    a = im.group(0) if im else ""
    left = 0
    first = None
    lc = re.search(r'w:leftChars="(-?\d+)"', a)
    l2 = re.search(r'w:left="(-?\d+)"', a)
    fc = re.search(r'w:firstLineChars="(-?\d+)"', a)
    f2 = re.search(r'w:firstLine="(-?\d+)"', a)
    if lc:
        left = int(lc.group(1)) // 100
    elif l2:
        left = int(l2.group(1)) // 320
    if fc:
        first = int(fc.group(1)) // 100
    elif f2:
        first = int(f2.group(1)) // 320

    if left >= 4:
        return "l4"
    if left >= 2:
        return "l2"
    if left >= 1:
        return "l1"
    if first is None or first == 0:
        return "n"
    if first == 1:
        return "f1"
    return ""


def docx_blocks(raw):
    """把 .docx 的 document.xml 解析成块列表。

    块类型：
        {'t': 'p',   'segs': [[(text, bold, italic), ...], ...], 'cls': str}
                 —— segs 按段内软换行（<w:br/>）切分
        {'t': 'tbl', 'rows': [[cell_text, ...], ...]}
    """
    z = zipfile.ZipFile(io.BytesIO(raw))
    xml = z.read("word/document.xml").decode("utf-8", "ignore")
    body = re.search(r"<w:body[^>]*>(.*)</w:body>", xml, re.S)
    body = body.group(1) if body else xml
    blocks = []
    pat = re.compile(r"<w:tbl[ >].*?</w:tbl>|<w:p[ >].*?</w:p>|<w:p/>", re.S)
    for m in pat.finditer(body):
        blk = m.group(0)
        if blk.startswith("<w:tbl"):
            rows = []
            for tr in re.findall(r"<w:tr[ >].*?</w:tr>", blk, re.S):
                cells = []
                for tc in re.findall(r"<w:tc[ >].*?</w:tc>", tr, re.S):
                    txt = re.sub(r"<[^>]+>", "", tc)
                    txt = _unescape(txt).replace("\u3000", " ").replace("\xa0", " ").strip()
                    txt = re.sub(r"\s{2,}", " ", txt)
                    cells.append(txt)
                rows.append(cells)
            blocks.append({'t': 'tbl', 'rows': rows})
            continue

        segs = []
        cur = []
        for rm in re.finditer(r"<w:r[ >].*?</w:r>", blk, re.S):
            r = rm.group(0)
            bold = "<w:b/>" in r or "<w:b " in r
            ital = "<w:i/>" in r or "<w:i " in r
            for tm in re.finditer(r"<w:t(?: [^>]*)?>(.*?)</w:t>|<w:tab/>|<w:br/>", r, re.S):
                g = tm.group(0)
                if g.startswith("<w:tab"):
                    txt = "\t"
                elif g.startswith("<w:br"):
                    txt = "\n"
                else:
                    txt = _unescape(tm.group(1))
                if txt == "\n":
                    segs.append(cur)
                    cur = []
                else:
                    cur.append((txt, bold, ital))
        if cur:
            segs.append(cur)
        blocks.append({'t': 'p', 'segs': segs, 'cls': _para_cls(blk)})
    return blocks


def norm_text(s):
    """全角空格/不间断空格归一，连续空白压成一个空格。"""
    t = (s or "").replace("\u3000", " ").replace("\xa0", " ")
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


def docx_lines(raw):
    """把 .docx 解析成行序列（一个段落一行，段内软换行另起一行，表格按行）。"""
    out = []
    for b in docx_blocks(raw):
        if b['t'] == 'tbl':
            for r in b['rows']:
                t = norm_text("\t".join(r))
                if t:
                    out.append(t)
            continue
        for seg in b['segs']:
            t = norm_text("".join(x[0] for x in seg))
            if t:
                out.append(t)
    return out
