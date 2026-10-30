# -*- coding: utf-8 -*-
"""12371 新抓数据与现有党内法规的去重比对（出报告，不改数据）。

比对口径：
  1) 标题归一化：去掉空白与标点，并剥离「（2025年11月28日发布）」这类日期版本后缀
     —— 12371 的条例目录标题带发布日期后缀，与人民网的裸标题其实是同一部法规。
  2) 正文相似度：头尾各取 1200 字比对（版本对共享长前缀）。

用法：python tools/dedup_12371.py [--json 输出文件]
"""
import os, re, sys, json, glob, argparse, collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_dataset import _norm_key, _norm_body, _body_sim

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 目录标题里的日期版本后缀：「（2025年11月28日发布）」「（2019年3月14日修订）」
VER_SUFFIX_RE = re.compile(r"[（(]\s*(?:19|20)\d{2}\s*年[^）)]{0,24}[）)]")


def norm_title(t):
    t = VER_SUFFIX_RE.sub("", t or "")
    t = re.sub(r"[（(]\s*(?:试行|暂行|修订|修正|修改|印发|通知)\s*[）)]", "", t)
    return _norm_key(t)


def body_of(sections):
    return _norm_body("\n".join(s.get("text") or "" for s in (sections or [])))


def party_records():
    """现有党内法规记录（人民网 raw_corpus + supplement）。"""
    out = []
    raw = json.load(open(os.path.join(ROOT, "tools", "raw_corpus.json"), encoding="utf-8"))
    for r in raw:
        if r.get("status") != "ok":
            continue
        out.append({
            "title": r["title"],
            "cat": r["category"],
            "summary": r.get("summary", ""),
            "url": r.get("url", ""),
            "chars": len(body_of(r.get("sections"))),
            "body": body_of(r.get("sections")),
            "src": "人民网",
        })
    supp = json.load(open(os.path.join(ROOT, "tools", "supplement_final.json"), encoding="utf-8"))
    for title, v in (supp or {}).items():
        if not v:
            continue
        out.append({
            "title": title, "cat": "办法", "summary": "", "url": v.get("url", ""),
            "chars": len(body_of([{"text": v.get("text", "")}])),
            "body": body_of([{"text": v.get("text", "")}]),
            "src": "人民网补抓",
        })
    return out


def new_records():
    out = []
    for p in glob.glob(os.path.join(ROOT, "tools", "12371_cache", "*.json")):
        d = json.load(open(p, encoding="utf-8"))
        d["body"] = body_of(d.get("sections"))
        d["chars"] = len(d["body"])
        d["src"] = "12371"
        out.append(d)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    old = party_records()
    new = new_records()
    old_by = collections.defaultdict(list)
    for r in old:
        old_by[norm_title(r["title"])].append(r)

    print("现有党内法规：%d 条   12371 新抓：%d 条" % (len(old), len(new)))

    same_title = []     # 归一化标题相同
    diff_title = []     # 标题不同但正文高度相似
    brand_new = []      # 完全没匹配上
    for r in new:
        key = norm_title(r["title"])
        cands = old_by.get(key) or []
        if cands:
            best = max(cands, key=lambda x: len(x["body"]))
            sim = _body_sim(r["body"], best["body"]) if (r["body"] and best["body"]) else 0.0
            same_title.append((r, best, sim))
            continue
        # 标题对不上，用正文指纹找。
        # 先按正文长度粗筛：同一部法规的长度不会差太远，
        # 否则 715×394 次两两比对要跑很久。
        hit = None
        if r["body"]:
            n = len(r["body"])
            for o in old:
                on = len(o["body"])
                if not on:
                    continue
                if abs(on - n) > max(800, int(n * 0.35)):
                    continue
                if _body_sim(r["body"], o["body"]) >= 0.8:
                    hit = o
                    break
        if hit:
            diff_title.append((r, hit, 1.0))
        else:
            brand_new.append(r)

    print()
    print("== 归一化标题相同：%d ==" % len(same_title))
    hi = [x for x in same_title if x[2] >= 0.6]
    lo = [x for x in same_title if x[2] < 0.6]
    print("   正文相似 ≥0.6（同一篇）：%d" % len(hi))
    print("   正文相似 <0.6（疑似不同版本）：%d" % len(lo))
    for r, o, sim in lo[:25]:
        print("   [%.2f] 12371: %-44s | 人民网: %s" % (sim, r["title"][:42], o["title"][:40]))

    print()
    print("== 标题不同但正文相同（改名/带后缀）：%d ==" % len(diff_title))
    for r, o, sim in diff_title[:20]:
        print("   12371: %-46s | 人民网: %s" % (r["title"][:44], o["title"][:40]))

    print()
    print("== 全新（站内没有）：%d ==" % len(brand_new))
    bycat = collections.Counter(r.get("cat") or "?" for r in brand_new)
    print("   按门类：", dict(bycat))
    short = [r for r in brand_new if r["chars"] < 300]
    nohead = [r for r in brand_new if not any(
        re.match(r"^第[一二三四五六七八九十百零〇两]+[章编篇]", (s.get("name") or "").strip())
        for s in (r.get("sections") or []))]
    print("   其中正文 <300 字（疑似解读/消息）：%d" % len(short))
    for r in short[:15]:
        print("      %-46s %d 字" % (r["title"][:44], r["chars"]))
    print("   其中没有章标题（疑似非法规文本）：%d" % len(nohead))
    for r in nohead[:15]:
        print("      %-46s %d 字" % (r["title"][:44], r["chars"]))

    if args.json:
        rep = {
            "same_title": [{"new": r["title"], "new_cat": r.get("cat"), "old": o["title"],
                            "old_cat": o.get("cat"), "sim": round(sim, 3),
                            "new_chars": r["chars"], "old_chars": o["chars"]}
                           for r, o, sim in same_title],
            "diff_title": [{"new": r["title"], "old": o["title"]} for r, o, _ in diff_title],
            "brand_new": [{"title": r["title"], "cat": r.get("cat"), "chars": r["chars"],
                           "url": r["url"], "summary": r.get("summary", "")} for r in brand_new],
        }
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
        print("\n报告已写入", args.json)


if __name__ == "__main__":
    main()
