# -*- coding: utf-8 -*-
"""抓取 12371.cn 详情页正文。

页面结构（2026-10 实测）：
  正文容器  <div class="con"><div class="word"> ... <p>段落 </p> ... </div></div>
  文档标题  <p style="text-align:center;"><strong>中国共产党工作机关条例</strong></p>
  分段标题  <p><strong>第一章 总则</strong></p>、<p><strong>一、总体要求</strong></p>
  日期行    <p>（2016年11月30日中共中央政治局会议审议批准 2017年3月1日中共中央发布）</p>

分段标题在源页面里是**整段加粗**的独立段落，正文段不加粗 ——
所以用「加粗 + 短 + 不含句读」就能把「第X章」「一、xxx」都切出来，
这比 tools/section_parser.py 更适合党内法规（后者只认「第X章/第X节」，
因为国家法律法规的正文都是「第X章」体例）。

缓存里同时保存正文片段（con_html），改动解析逻辑后不必重新抓网页。

用法：
  python tools/crawl_12371_docs.py --docs        # 抓正文（跳过已缓存的）
  python tools/crawl_12371_docs.py --docs --force # 重抓
  python tools/crawl_12371_docs.py --reparse      # 只按缓存里的 con_html 重算
"""
import os, re, sys, json, time, html as htmlmod, hashlib, argparse
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crawl_12371 import fetch, META, CACHE

sys.stdout.reconfigure(encoding="utf-8")

P_RE = re.compile(r"<p([^>]*)>(.*?)</p>", re.S | re.I)
STRONG_RE = re.compile(r"<strong[^>]*>(.*?)</strong>", re.S | re.I)
B_RE = re.compile(r"<b[^>]*>(.*?)</b>", re.S | re.I)
CON_RE = re.compile(r'<div class="con"[^>]*>', re.S)

CN_NUM = "一二三四五六七八九十百零〇两"
# 第X章 / 第X节 / 第X编 / 第X篇
SEC_HEAD_RE = re.compile(r"^第[" + CN_NUM + r"\d]+(?:分)?[编章篇节卷部]")
# 一、xxx / 二、xxx（中文数字分段）
CN_SEG_RE = re.compile(r"^[" + CN_NUM + r"]+、")
# 「（2025年11月28日发布）」这类目录里的日期版本后缀
VER_SUFFIX_RE = re.compile(r"[（(]\s*((?:19|20)\d{2}\s*年[^）)]{0,24})[）)]")
# 「（自2019年6月1日起施行）」——施行日期，不该留在标题里
EFFECT_SUFFIX_RE = re.compile(r"[（(]\s*(自[^）)]{4,40}起施行)[）)]")
# 日期行：整段被括号包住
DATE_LINE_RE = re.compile(r"^[（(][^（）()]{4,140}[）)]$")
# 独立的纯日期段落，如「2023年4月1日」
PURE_DATE_RE = re.compile(r"^[（(]?\s*((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^）)]{0,40})[）)]?$")
# 明显不是法规标题的段落（专题页/视频页）
JUNK_TITLE_RE = re.compile(r"(点击此处?观看?视频|延伸阅读|目\s*录|相关链接|视频|图片|专题|进入《|查看《)")

SECTION_RE = re.compile(r"^第[" + CN_NUM + r"\d]+(?:分)?[编章篇卷部]")
# 12371 文章 URL 里的发布日期：/2023/04/18/ARTI…
URL_DATE_RE = re.compile(r"/(\d{4})/(\d{2})/(\d{2})/")
# 正文里的发布事件：「2025年11月28日中共中央发布」
PUBLISH_EVENT_RE = re.compile(
    r"((?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日"
    r"[^，。；\n]{0,12}?"
    r"(?:中共中央办公厅|中共中央|国务院办公厅|国务院|中央办公厅|中央"
    r"|全国人民代表大会常务委员会|中央纪律检查委员会|中央组织部|中央政法委员会)"
    r"[^，。；\n]{0,8}?"
    r"(?:政治局会议审议批准|政治局会议批准|审议批准|批准|发布|印发|公布|颁布|修订|修正|施行))")


def strip_tags(frag):
    """把一小段 HTML 剥成纯文本。

    不把 <strong> 转成 Markdown 的 `**`：
    数据层一律存纯文本（条号加粗由前端 sectionMarkdown 统一处理），
    而且源页面里存在嵌套的 <strong>，转成 `**` 会拼出 `****xxx**` 这种脏标题。
    """
    frag = re.sub(r"<br\s*/?>", "\n", frag)
    frag = re.sub(r"<[^>]+>", "", frag)
    frag = htmlmod.unescape(frag)
    frag = frag.replace("\u200b", "").replace("\ufeff", "")
    frag = frag.replace("\xa0", " ").replace("\u3000", " ")
    frag = re.sub(r"[ \t]{2,}", " ", frag)
    return frag.strip()


def extract_con(html):
    """取出 <div class="con"> ... </div> 的内部 HTML（按标签配对）。"""
    m = CON_RE.search(html)
    if not m:
        return ""
    rest = html[m.end():]
    depth = 1
    for tm in re.finditer(r"<(/?)div\b[^>]*>", rest):
        if tm.group(1) == "/":
            depth -= 1
            if depth == 0:
                return rest[:tm.start()]
        else:
            depth += 1
    return rest


def is_strong_only(inner):
    """整段是否都在 <strong>/<b> 里（源页面用加粗标记标题）。"""
    s = inner.strip()
    if not s:
        return False
    s2 = STRONG_RE.sub("", s)
    s2 = B_RE.sub("", s2)
    s2 = re.sub(r"<[^>]+>", "", s2)
    return not s2.strip()


def is_seg_heading(text):
    """是不是一个分段标题行。"""
    t = (text or "").strip()
    if not t or len(t) > 40:
        return False
    if JUNK_TITLE_RE.search(t):
        return False
    if SEC_HEAD_RE.match(t) or CN_SEG_RE.match(t):
        return True
    # 裸标题：短、无句读
    if len(t) >= 4 and not re.search(r"[，,。；;：:！!？?]", t):
        return True
    return False


def level_of(name):
    """一级 = 第X编/篇/章/卷/部、中文数字分段；二级 = 第X节。"""
    s = (name or "").strip()
    if re.match(r"^第[" + CN_NUM + r"\d]+(?:分)?节", s):
        return 2
    return 1


# 裸标题：前言 / 序言 / 总则 / 分则 / 附则
BARE_HEAD_RE = re.compile(r"^(前言|序言|总则|分则|附则)$")


def strip_toc_block(items):
    """剥掉源文档开头的「目 录」块。

    规划纲要类的正文前面带一段目录，目录条目（第一章 发展背景 / 第一节 发展基础）
    和正文标题长得一模一样 —— 混进正文会让目录里出现「正文根本没有的章」，
    摘要里也会塞进一串目录文字。
    """
    for i, it in enumerate(items):
        t = it["text"].strip().strip("*").strip()
        if t.replace(" ", "") != "目录":
            continue
        j = i + 1
        while j < len(items):
            tt = items[j]["text"].strip().strip("*").strip()
            if (SEC_HEAD_RE.match(tt) or BARE_HEAD_RE.match(tt)
                    or (len(tt) <= 24 and not re.search(r"[。；，,]", tt))):
                j += 1
                continue
            break
        if j - i >= 3:          # 后面确实连着多条目录条目，才当目录块
            return items[:i] + items[j:]
        return items
    return items


def parse_con(con, rec):
    """把正文片段 HTML 解析成 {title, version, effective, summary, sections}。"""
    items = []
    for attrs, inner in P_RE.findall(con):
        txt = strip_tags(inner)
        if not txt:
            continue
        items.append({
            "text": txt,
            "strong": is_strong_only(inner),
            "center": "text-align:center" in attrs.replace(" ", "").lower(),
        })
    if not items:
        return None
    items = strip_toc_block(items)

    # ---- 标题：目录标题剥掉日期/施行后缀；正文里有居中加粗标题则优先用它
    raw_title = (rec.get("dir_title") or rec.get("title") or "").strip()
    version = ""
    effective = ""
    title = raw_title
    m = EFFECT_SUFFIX_RE.search(title)
    if m:
        effective = m.group(1).strip()
        title = (title[:m.start()] + title[m.end():]).strip()
    mver = VER_SUFFIX_RE.search(title)
    if mver:
        version = mver.group(1).strip()
        title = (title[:mver.start()] + title[mver.end():]).strip()
    for it in items:
        t = it["text"].strip()
        if not (it["center"] and it["strong"]):
            continue
        cand = t.strip("*").strip()
        if not cand or len(cand) > 70:
            continue
        # 不能是章节标题形态（「第一章 总则」「一、总体要求」），也不能是视频/目录占位
        if SEC_HEAD_RE.match(cand) or CN_SEG_RE.match(cand) or JUNK_TITLE_RE.search(cand):
            continue
        title = cand
        break
    if JUNK_TITLE_RE.search(title) or SEC_HEAD_RE.match(title) or CN_SEG_RE.match(title):
        title = raw_title
        # 目录标题也可能带后缀，再剥一次
        m = EFFECT_SUFFIX_RE.search(title)
        if m:
            effective = m.group(1).strip()
            title = (title[:m.start()] + title[m.end():]).strip()
        mver = VER_SUFFIX_RE.search(title)
        if mver:
            version = mver.group(1).strip()
            title = (title[:mver.start()] + title[m.end():]).strip()

    # ---- 日期：括号日期行 > 独立纯日期段落 > 标题版本后缀 > 正文首个发布事件
    summary = ""
    date_idx = -1
    for i, it in enumerate(items):
        t = it["text"].strip()
        if DATE_LINE_RE.match(t):
            summary = t.strip("（）()").strip()
            date_idx = i
            break
    if not summary:
        for i, it in enumerate(items[:14]):
            m = PURE_DATE_RE.match(it["text"].strip())
            if m:
                summary = m.group(1).strip()
                if date_idx < 0:
                    date_idx = i
                break
    if not summary and version:
        summary = version
    if not summary:
        blob = "\n".join(it["text"] for it in items[:14])
        m = PUBLISH_EVENT_RE.search(blob)
        if m:
            summary = m.group(0)
    # 最后的兜底：12371 的文章 URL 里带发布日期（/2023/04/18/ARTI…），
    # 对「新闻通稿」体例的文件（正文里根本没有发文日期）只能用网页发布时间。
    web_date = ""
    if not summary:
        mu = URL_DATE_RE.search(rec.get("url") or "")
        if mu:
            web_date = "%s-%s-%s" % (mu.group(1), mu.group(2), mu.group(3))

    # ---- 正文起点：标题段 / 日期段之后
    start = 0
    for i, it in enumerate(items):
        t = it["text"].strip().strip("*").strip()
        if it["strong"] and t == title:
            start = i
            break
    if date_idx >= 0 and start < date_idx:
        start = date_idx
    head = items[:start + 1]
    body = items[start + 1:] if head else items

    # ---- 切分段
    secs = []
    cur_name = ""
    cur_level = 0
    cur = []
    for it in body:
        t = it["text"]
        if it["strong"] and is_seg_heading(t):
            if cur or cur_name:
                secs.append({"name": cur_name, "text": "\n".join(cur), "level": cur_level})
            cur_name = t.strip().strip("*").strip()
            cur_level = level_of(cur_name)
            cur = []
        else:
            cur.append(t)
    if cur or cur_name:
        secs.append({"name": cur_name, "text": "\n".join(cur), "level": cur_level})
    if not secs:
        secs = [{"name": "", "text": "\n".join(it["text"] for it in body), "level": 0}]

    # ---- 首节：标题 + 前置说明（与人民网口径一致）
    head_text = "\n".join(it["text"].strip().strip("*").strip() for it in head)
    out = []
    if head_text:
        out.append({"name": title, "text": head_text, "level": 0})
    out.extend(secs)

    # 实质正文字数（排除分段标题行与目录条目行）：
    # 少数页面正文是附件（规划纲要、批复），页面上只留目录 —— 这种条目没有可读正文。
    body_chars = 0
    for s in out:
        for ln in s["text"].split("\n"):
            t = ln.strip()
            if not t:
                continue
            if SEC_HEAD_RE.match(t) or CN_SEG_RE.match(t):
                continue
            if len(t) < 30 and not re.search(r"[。；]", t):
                continue            # 目录条目行（如「第一节 发展基础」）
            body_chars += len(t)

    return {
        "title": title,
        "version": version,
        "effective": effective,
        "summary": summary,
        "webDate": web_date,
        "bodyChars": body_chars,
        "url": rec["url"],
        "cat": (rec.get("cats") or [None])[0],
        "sys": rec.get("sys") or [],
        "sections": out,
        "chars": sum(len(s["text"]) for s in out),
        "section_count": len(out),
    }


def cid_of(url):
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]


def save_doc(path, rec, doc, con):
    doc = dict(doc)
    doc["con_html"] = con
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)


def reparse():
    """只按缓存里的 con_html 重算 sections（改了解析逻辑用，不必重抓网页）。

    目录里的原始标题从 tools/12371_meta.json 按 URL 反查
    （缓存里存的是解析后的标题，解析出错时无法自我恢复）。
    """
    meta = json.load(open(META, encoding="utf-8"))
    by_url = {r["url"]: r for r in meta["items"]}
    n = 0
    for p in sorted(os.listdir(CACHE)):
        if not p.endswith(".json"):
            continue
        fp = os.path.join(CACHE, p)
        d = json.load(open(fp, encoding="utf-8"))
        con = d.pop("con_html", None)
        if not con:
            continue
        src = by_url.get(d.get("url")) or {}
        doc = parse_con(con, {"dir_title": src.get("title", d.get("title", "")),
                               "title": d.get("title", ""),
                               "url": d.get("url", ""),
                               "cats": src.get("cats") or ([d.get("cat")] if d.get("cat") else []),
                               "sys": src.get("sys") or d.get("sys") or []})
        if not doc:
            continue
        doc["con_html"] = con
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
        n += 1
    print("重解析 %d 条" % n)


def crawl_docs(force=False, workers=4):
    meta = json.load(open(META, encoding="utf-8"))
    items = meta["items"]
    os.makedirs(CACHE, exist_ok=True)
    todo = []
    skipped = 0
    for rec in items:
        # 党章正文在页面上是 AJAX 动态加载的（div.dyw1006_zz 为空，锚点切换），
        # 且站内已有现行版党章（r0001），历史版本（1982/1987/…/2017）一律不要。
        if (rec.get("cats") or []) == ["党章"]:
            skipped += 1
            continue
        p = os.path.join(CACHE, cid_of(rec["url"]) + ".json")
        if force or not os.path.exists(p):
            todo.append((rec, p))
    print("总条目 %d，需抓取 %d（已缓存 %d，跳过党章 %d）"
          % (len(items), len(todo), len(items) - len(todo) - skipped, skipped))
    if not todo:
        return

    ok = fail = empty = 0
    errs = []

    def one(job):
        rec, path = job
        try:
            html = fetch(rec["url"])
        except Exception as e:      # noqa: BLE001
            return ("fail", rec, str(e))
        con = extract_con(html)
        if not con.strip():
            return ("empty", rec, "正文容器为空")
        d = parse_con(con, rec)
        if not d:
            return ("empty", rec, "正文段落为空")
        save_doc(path, rec, d, con)
        return ("ok", rec, d)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for i, (st, rec, info) in enumerate(ex.map(one, todo), 1):
            if st == "ok":
                ok += 1
            elif st == "empty":
                empty += 1
                errs.append(("EMPTY", rec["title"], rec["url"]))
            else:
                fail += 1
                errs.append(("FAIL", rec["title"], info))
            if i % 50 == 0 or i == len(todo):
                print("  %d/%d  成功 %d  空 %d  失败 %d  (%.0fs)"
                      % (i, len(todo), ok, empty, fail, time.time() - t0))
            time.sleep(0.25)

    print("完成：成功 %d，空 %d，失败 %d" % (ok, empty, fail))
    for t, title, info in errs[:40]:
        print("   %s %s | %s" % (t, title, info))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", action="store_true")
    ap.add_argument("--reparse", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    if args.reparse:
        reparse()
    elif args.docs:
        crawl_docs(force=args.force, workers=args.workers)
    else:
        print(__doc__)
