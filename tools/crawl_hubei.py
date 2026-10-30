# -*- coding: utf-8 -*-
"""抓取湖北法规库（http://119.36.213.154:8088/fgk/）。

站点结构
--------
    index.jsp                     首页，左侧是分类树，右侧 iframe 装列表
    RulesList.jsp?...&nowPage=N   列表页：每页 20 条，底部有总条数与总页数
    index_xq.jsp?Rileid=<id>      详情页：元信息表 + <pre> 正文
    fujianlist.jsp?RuleId=<id>    附件列表（.doc 原件，另有 accdownload.jsp 下载）

分类维度（ExtendNum1 / ExtendNum2）
---------------------------------
    1 地方性法规 法规性决定：1 省本级 + 2..14 全省 13 个市州
    2 自治条例 单行条例：15 恩施州 / 16 五峰县 / 17 长阳县

用法：
    python tools/crawl_hubei.py --list-only      # 只抓列表
    python tools/crawl_hubei.py                  # 列表 + 详情正文
    python tools/crawl_hubei.py --limit 20       # 试跑
"""
import os, sys, re, io, json, time, argparse, html as htmlmod
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import section_parser as SP

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
CACHE = os.path.join(TOOLS, "hubei_cache")
BASE = "http://119.36.213.154:8088/fgk/"

# (ExtendNum1, ExtendNum2, 区域名, 门类id)
CATS = [
    (1, 1, "湖北省本级", "dfg"),
    (1, 2, "武汉市", "dfg"),
    (1, 3, "宜昌市", "dfg"),
    (1, 4, "襄阳市", "dfg"),
    (1, 5, "黄石市", "dfg"),
    (1, 6, "十堰市", "dfg"),
    (1, 7, "荆州市", "dfg"),
    (1, 8, "荆门市", "dfg"),
    (1, 9, "鄂州市", "dfg"),
    (1, 10, "孝感市", "dfg"),
    (1, 11, "黄冈市", "dfg"),
    (1, 12, "咸宁市", "dfg"),
    (1, 13, "随州市", "dfg"),
    (1, 14, "恩施土家族苗族自治州", "dfg"),
    (2, 15, "恩施土家族苗族自治州", "zxzd"),
    (2, 16, "五峰土家族自治县", "zxzd"),
    (2, 17, "长阳土家族自治县", "zxzd"),
]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

ROW_RE = re.compile(
    r"index_xq\.jsp\?Rileid=(\d+)\"[^>]*>(.*?)</a></td>\s*"
    r"<td class=\"lbtd\">(.*?)</td>\s*"
    r"<td class=\"lbtd\">(.*?)</td>\s*"
    r"<td class=\"lbtd\">(.*?)</td>\s*"
    r"<td class=\"lbtd\">(.*?)</td>", re.S)
TOTAL_RE = re.compile(r"共\s*<span>(\d+)</span>\s*条")
PAGES_RE = re.compile(r"第\s*<span>\d+</span>/\s*<span>(\d+)</span>\s*页")
PRE_RE = re.compile(r'<div class="con">\s*<pre>(.*?)</pre>', re.S)
TITLE_RE = re.compile(r'<div class="tit">\s*<h2>(.*?)</h2>', re.S)
META_RE = re.compile(r'<td[^>]*align="right">\s*([^:：<]+?)\s*[:：]\s*</td>\s*'
                     r'<td[^>]*align="left">\s*(.*?)\s*</td>', re.S)


def session():
    import requests
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    return s


def clean(s):
    s = htmlmod.unescape(s or "")
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    s = re.sub(r"[﻿\u200b-\u200f\ufeff]", "", s)   # 零宽字符/BOM 会污染检索与摘要
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def iso_date(s):
    """把 2026年09月24日 / 2026-09-24 统一成 2026-09-24。"""
    s = clean(s)
    if not s:
        return ""
    m = re.search(r"(\d{4})\s*[-年]\s*(\d{1,2})\s*[-月]\s*(\d{1,2})", s)
    if not m:
        return ""
    return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))


def fetch_list_pages(s, e1, e2, limit=0):
    """翻页抓某个分类的列表，返回 [(rileid, rowmeta...)]。"""
    out = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        if e2:
            url = "%sRulesList.jsp?ExtendNum1=%d&ExtendNum2=%d&Effective=1&nowPage=%d" % (BASE, e1, e2, page)
        else:
            url = "%sRulesList.jsp?ExtendNum1=%d&Effective=1&nowPage=%d" % (BASE, e1, page)
        r = s.get(url, timeout=40)
        r.encoding = "utf-8"
        t = r.text
        if page == 1:
            pm = PAGES_RE.search(t)
            total_pages = int(pm.group(1)) if pm else 1
        rows = []
        for m in ROW_RE.finditer(t):
            rows.append({
                "rileid": m.group(1),
                "title": clean(m.group(2)),
                "published": iso_date(m.group(3)),
                "adopted": iso_date(m.group(4)),
                "effective": iso_date(m.group(5)),
                "effect": clean(m.group(6)),
            })
        out.extend(rows)
        if limit and len(out) >= limit:
            return out[:limit]
        page += 1
        time.sleep(0.15)
    return out


def parse_detail(html):
    """从详情页抽出标题、元信息与正文。"""
    rec = {}
    m = TITLE_RE.search(html)
    rec["title"] = clean(m.group(1)) if m else ""
    m = PRE_RE.search(html)
    rec["body"] = htmlmod.unescape(m.group(1)) if m else ""
    meta = {}
    for m in META_RE.finditer(html):
        k = clean(m.group(1)).replace(" ", "")
        v = clean(m.group(2))
        if k and v and k not in meta:
            meta[k] = v
    rec["issuer"] = meta.get("公布机关", "")
    rec["adopted"] = iso_date(meta.get("通过日期", ""))
    rec["published"] = iso_date(meta.get("公布日期", ""))
    rec["effective"] = iso_date(meta.get("施行日期", ""))
    rec["effect"] = meta.get("时效性", "")
    return rec


def fetch_detail(s, rileid):
    url = "%sindex_xq.jsp?Rileid=%s" % (BASE, rileid)
    r = s.get(url, timeout=40)
    r.encoding = "utf-8"
    return parse_detail(r.text)


def split_sections(body):
    """正文 → 章节结构（剥离源文档开头的「目 录」块，标注两级层级）。

    湖北条例的正文首行是「（2026年9月24日……通过）」说明段，
    紧接着可能是一整块「目  录」，再往后才是正文标题。
    section_parser 的目录判定规则正是为此设计。
    """
    lines = []
    for ln in body.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        t = ln.replace("\u3000", " ").replace("\xa0", " ")
        t = re.sub(r"[﻿\u200b-\u200f\ufeff]", "", t)
        t = re.sub(r"[ \t]{2,}", " ", t).strip()
        if t:
            lines.append(t)
    secs, toc = SP.build_sections(lines)
    return secs, toc, lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--reparse", action="store_true",
                    help="只按缓存里的原始正文重算章节结构，不重新抓取")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)

    if args.reparse:
        n = 0
        for fn in sorted(os.listdir(CACHE)):
            if not fn.endswith(".json"):
                continue
            p = os.path.join(CACHE, fn)
            rec = json.load(open(p, encoding="utf-8"))
            body = rec.get("body") or ""
            if not body:
                continue
            secs, toc, lines = split_sections(body)
            rec["sections"] = secs
            rec["tocEntries"] = toc
            rec["body"] = "\n".join(lines)     # 清洗后的正文（零宽字符已剔除）
            rec["chars"] = sum(len(x["text"].replace(" ", "")) for x in secs)
            json.dump(rec, open(p, "w", encoding="utf-8"), ensure_ascii=False)
            n += 1
        print("重算章节结构：%d 条" % n)
        return

    s = session()

    # ---- 1) 列表 ----
    items = {}
    for e1, e2, region, cat in CATS:
        try:
            rows = fetch_list_pages(s, e1, e2, args.limit)
        except Exception as e:
            print("  !! 列表失败 %s/%s %r" % (e1, e2, e))
            continue
        n_new = 0
        for r in rows:
            rid = r["rileid"]
            if rid in items:
                # 同一条法规可能落在多个分类里，保留先遇到的
                continue
            r["region"] = region
            r["cat"] = cat
            items[rid] = r
            n_new += 1
        print("  分类 %-14s %3d 条（新增 %d）" % (region, len(rows), n_new), flush=True)
        time.sleep(0.2)

    print("列表合计：%d 条" % len(items))
    json.dump(items, open(os.path.join(TOOLS, "hubei_meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    if args.list_only:
        return

    # ---- 2) 详情 ----
    # 已有缓存且带原始正文（body）的跳过；没有 body 的补抓一次，便于以后本地重算
    def cached_ok(rid):
        p = os.path.join(CACHE, rid + ".json")
        if not os.path.exists(p):
            return False
        try:
            return bool(json.load(open(p, encoding="utf-8")).get("body"))
        except Exception:
            return False

    todo = [rid for rid in items if not cached_ok(rid)]
    print("需要抓详情：%d 条（已有 %d）" % (len(todo), len(items) - len(todo)))
    done = 0
    bad = []

    def one(rid):
        try:
            return rid, fetch_detail(s, rid), None
        except Exception as e:
            return rid, None, e

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for rid, rec, err in ex.map(one, todo):
            done += 1
            if err:
                bad.append((rid, repr(err)[:80]))
                continue
            it = items[rid]
            body = rec.get("body") or ""
            secs, toc, lines = split_sections(body)
            out = dict(it)
            out["issuer"] = rec.get("issuer") or ""
            out["adopted"] = rec.get("adopted") or it.get("adopted") or ""
            out["published"] = rec.get("published") or it.get("published") or ""
            out["effective"] = rec.get("effective") or it.get("effective") or ""
            out["effect"] = rec.get("effect") or it.get("effect") or ""
            out["title"] = rec.get("title") or it.get("title") or ""
            out["sections"] = secs
            out["tocEntries"] = toc
            out["body"] = body          # 保留原始正文，改解析逻辑后可本地重算
            out["chars"] = sum(len(x["text"].replace(" ", "")) for x in secs)
            out["url"] = BASE + "index_xq.jsp?Rileid=" + rid
            # 标题对不上就记下来（列表页标题可能有前后空格或换行）
            if out["title"].replace(" ", "") != it.get("title", "").replace(" ", ""):
                out["titleMismatch"] = [it.get("title", ""), out["title"]]
            json.dump(out, open(os.path.join(CACHE, rid + ".json"), "w", encoding="utf-8"),
                      ensure_ascii=False)
            if done % 50 == 0:
                print("  已抓 %d/%d" % (done, len(todo)), flush=True)
    print("详情完成：%d 条，失败 %d" % (done - len(bad), len(bad)))
    for b in bad[:10]:
        print("  !!", b)


if __name__ == "__main__":
    main()
