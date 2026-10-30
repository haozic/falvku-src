# -*- coding: utf-8 -*-
"""生成待下载清单（items.json）。

    python tools/make_flk_items.py              # 缺 docx 且缺 json 的才列
    python tools/make_flk_items.py --docx-only  # 只要 docx 缺就列（补抓正文用）
"""
import sys, os, json, argparse
sys.stdout.reconfigure(encoding="utf-8")

TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
BASE = "https://flk.npc.gov.cn"

ap = argparse.ArgumentParser()
ap.add_argument("--docx-only", action="store_true",
                help="只按 docx 是否存在判断（已有 .json 但缺 docx 的也要补抓）")
args = ap.parse_args()

meta = json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))
files = os.listdir(CACHE)
have_docx = set(f.rsplit(".", 1)[0] for f in files if f.endswith(".docx"))
have_json = set(f.rsplit(".", 1)[0] for f in files if f.endswith(".json"))
have = have_docx if args.docx_only else (have_docx | have_json)

items = []
for m in meta:
    if m["bbbs"] in have:
        continue
    items.append({
        "bbbs": m["bbbs"],
        "title": m.get("title", ""),
        "url": BASE + "/law-search/download/mobile?format=docx&bbbs=" + m["bbbs"] + "&fileId="
    })

out = os.path.join(TOOLS, "flk_items.json")
json.dump(items, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print("待下载 %d 篇 -> %s" % (len(items), out))
