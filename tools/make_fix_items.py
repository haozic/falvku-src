# -*- coding: utf-8 -*-
"""生成串档条目的重抓清单 items.json（给 crawl_flk_ctx.js 用）。"""
import os, sys, json

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
BASE = "https://flk.npc.gov.cn"

wrong = json.load(open(os.path.join(TOOLS, "flk_wrong.json"), encoding="utf-8"))
meta = {m["bbbs"]: m for m in json.load(open(os.path.join(TOOLS, "flk_meta.json"), encoding="utf-8"))}

items = []
for w in wrong:
    b = w["bbbs"]
    t = meta.get(b, {}).get("title") or w["title"]
    items.append({"bbbs": b, "title": t,
                  "url": BASE + "/law-search/download/mobile?format=docx&bbbs=" + b + "&fileId="})

out = os.path.join(TOOLS, "flk_fix_items.json")
json.dump(items, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("写出 %s：%d 条" % (out, len(items)))
for it in items:
    print("   %s %s" % (it["bbbs"][:10], it["title"][:50]))
