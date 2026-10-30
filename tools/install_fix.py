# -*- coding: utf-8 -*-
"""把重抓修好的 docx 装回 flk_cache（覆盖串档的旧文件）。"""
import os, sys, json, shutil

sys.stdout.reconfigure(encoding="utf-8")
TOOLS = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(TOOLS, "flk_cache")
FIX = os.path.join(TOOLS, "flk_fix")

res = json.load(open(os.path.join(TOOLS, "flk_fix_result.json"), encoding="utf-8"))
fixed = list(res.get("fixed") or [])
# 重试后新增成功的也一并算上
for b in (res.get("missing") or []) + (res.get("still_bad") or []):
    if os.path.exists(os.path.join(FIX, b + ".docx")):
        fixed.append(b)

n = 0
for b in fixed:
    src = os.path.join(FIX, b + ".docx")
    dst = os.path.join(CACHE, b + ".docx")
    if not os.path.exists(src):
        continue
    shutil.copyfile(src, dst)
    n += 1
    print("  已替换 %s" % b)
print("共替换 %d 个 docx" % n)
