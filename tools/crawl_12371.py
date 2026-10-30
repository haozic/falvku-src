# -*- coding: utf-8 -*-
"""抓取共产党员网（12371.cn）「党章党规」专页的条目清单。

栏目结构（2026-10 实测）：
  门类页  /special/dnfg/{zz,tl,gd,bf,gz,xz}/  与 /special/zggcdzc/（党章）、/special/zcwj/（规范性文件）
  体系页  /special/dnfg/{zzfg,ldfg,zsjs,jdbz}/  （党的组织/领导/自身建设/监督保障法规）
  汇总页  /special/dnfg/
条目数据不是渲染好的 HTML，而是页面里的 JS 数组 `itemELMT<id>=[{link_add,title,content,brief},...]`。

用法：
  python tools/crawl_12371.py --list    # 抓分类页 -> tools/12371_meta.json
  python tools/crawl_12371.py --docs    # 抓正文   -> tools/12371_cache/<id>.json
"""
import os, re, sys, json, time, argparse, urllib.request, gzip, hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from js_literal import find_array_blob, parse_js_array_at

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, "tools", "12371_meta.json")
CACHE = os.path.join(ROOT, "tools", "12371_cache")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# 分类页：kind=cat 表示这是「门类」归属，kind=sys 表示只是「体系」（体系页里的条目门类可能另有出处）
# 注意：党章的 9 个版本（1982/1987/1992/1997/2002/2007/2012/2017/2022）只出现在
# 汇总页 /special/dnfg/ 的条目数组里；/special/zggcdzc/ 是「党章解读」专题，没有正文条目。
PAGES = [
    ("https://www.12371.cn/special/dnfg/", "党章", "cat"),
    ("https://www.12371.cn/special/dnfg/zz/", "准则", "cat"),
    ("https://www.12371.cn/special/dnfg/tl/", "条例", "cat"),
    ("https://www.12371.cn/special/dnfg/gd/", "规定", "cat"),
    ("https://www.12371.cn/special/dnfg/bf/", "办法", "cat"),
    ("https://www.12371.cn/special/dnfg/gz/", "规则", "cat"),
    ("https://www.12371.cn/special/dnfg/xz/", "细则", "cat"),
    ("https://www.12371.cn/special/zcwj/", "规范性文件", "cat"),
    ("https://www.12371.cn/special/dnfg/zzfg/", "党的组织法规", "sys"),
    ("https://www.12371.cn/special/dnfg/ldfg/", "党的领导法规", "sys"),
    ("https://www.12371.cn/special/dnfg/zsjs/", "党的自身建设法规", "sys"),
    ("https://www.12371.cn/special/dnfg/jdbz/", "党的监督保障法规", "sys"),
]


def fetch(url, retries=3, sleep=1.2):
    """抓一个页面，返回 HTML 文本。失败重试。"""
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate",
                "Accept-Language": "zh-CN,zh;q=0.9",
                "Referer": "https://www.12371.cn/special/dnfg/",
            })
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", "replace")
        except Exception as e:      # noqa: BLE001
            last = e
            time.sleep(2 + 2 * i)
    raise RuntimeError("抓取失败 %s: %s" % (url, last))


def extract_items(html):
    """从页面里取出所有 `itemELMT<id>=[...]` 数组。

    值里常带 HTML（brief 字段的 <a href="...">），不是合法 JSON，
    所以用 tools/js_literal.py 的 JS 字面量解析器，不能 json.loads。
    """
    out = []
    seen_spans = []
    for m in re.finditer(r"itemELMT\d+\s*=\s*\[", html):
        start = html.index("[", m.start())
        if any(a <= start < b for a, b in seen_spans):
            continue
        try:
            blob = find_array_blob(html, start)
        except Exception:
            continue
        seen_spans.append((start, start + len(blob)))
        try:
            data = parse_js_array_at(blob, 0)
        except Exception:
            continue
        if isinstance(data, list):
            for d in data:
                if isinstance(d, dict) and d.get("link_add"):
                    out.append(d)
    return out


def crawl_list():
    items = {}          # url -> 记录
    order = []          # 保持发现顺序
    for url, cat, kind in PAGES:
        try:
            html = fetch(url)
        except Exception as e:      # noqa: BLE001
            print("  !! %s %s" % (cat or "汇总", e))
            continue
        got = extract_items(html)
        print("  %-16s %-3d 条" % (cat or "汇总页", len(got)))
        for d in got:
            link = d["link_add"].strip()
            if link.startswith("//"):
                link = "https:" + link
            if link.startswith("http://"):
                link = "https://" + link[7:]
            title = re.sub(r"\s+", " ", (d.get("title") or "")).strip()
            if not title:
                continue
            rec = items.get(link)
            if rec is None:
                rec = {"url": link, "title": title, "cats": [], "sys": []}
                items[link] = rec
                order.append(link)
            if cat and kind == "cat" and cat not in rec["cats"]:
                rec["cats"].append(cat)
            if cat and kind == "sys" and cat not in rec["sys"]:
                rec["sys"].append(cat)
        time.sleep(1.0)

    recs = [items[u] for u in order]
    meta = {
        "source": "https://www.12371.cn/special/dnfg/",
        "fetched_at": time.strftime("%Y-%m-%d"),
        "count": len(recs),
        "items": recs,
    }
    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    # 统计
    print()
    print("合计去重条目：%d" % len(recs))
    from collections import Counter
    c = Counter()
    for r in recs:
        for x in r["cats"]:
            c[x] += 1
    print("按门类：", dict(c))
    nocat = [r for r in recs if not r["cats"]]
    print("无门类归属：%d" % len(nocat))
    for r in nocat[:10]:
        print("   ", r["title"])
    print("written", META)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list:
        crawl_list()
    else:
        print(__doc__)
        print("请用 --list")
