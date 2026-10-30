# -*- coding: utf-8 -*-
"""最终核验：条目总数、id 唯一性、公布日期口径、带版本后缀条目、数据体积。

（原先这里还核验 Word 预览挂载率；Word 预览已于 2026-10 下线，
 data/word_NN.js 与 tools/word_manifest.json 已删除，核验项相应移除。）
"""
import os, sys, json, glob

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_js(pattern, var):
    """读取正文分片：既支持 window.X.push([...])，也支持 window.X = [...]。"""
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", pattern))):
        s = open(f, encoding="utf-8").read()
        if var + ".push(" in s:
            i = s.index(var + ".push(")
            out.extend(json.loads(s[i + len(var + ".push("):].rstrip().rstrip(";").rstrip(")")))
        else:
            i = s.index(var + " =")
            out.extend(json.loads(s[i + len(var + " ="):].rstrip().rstrip(";").rstrip(")")))
    return out


d = json.load(open(os.path.join(ROOT, "data", "regulations.json"), encoding="utf-8"))
records = list(d["records"])
party = [r for r in records if str(r["id"]).startswith("r")]
flk_meta = [r for r in records if str(r["id"]).startswith("n")]
hb_meta = [r for r in records if str(r["id"]).startswith("h")]
# 正文分片（按需加载）：每条只有 id + sections
party_body = load_js("party_*.js", "window.FG_PARTY")
flk = load_js("flk_*.js", "window.FG_FLK")
hb = load_js("hubei_*.js", "window.FG_HUBEI")
print("元信息：党内 %d + 国家库 %d + 湖北 %d = %d" %
      (len(party), len(flk_meta), len(hb_meta), len(records)))
print("正文分片：党内 %d + 国家库 %d + 湖北 %d = %d" %
      (len(party_body), len(flk), len(hb), len(party_body) + len(flk) + len(hb)))

# 元信息与正文的 id 必须一一对应
meta_ids = set(r["id"] for r in records)
body_ids = set(r["id"] for r in party_body + flk + hb)
print("元信息缺正文：%d ；正文多出条目：%d" % (len(meta_ids - body_ids), len(body_ids - meta_ids)))

# id 唯一性
ids = [r["id"] for r in records]
dup = len(ids) - len(set(ids))
print("id 重复：%d" % dup)

# 公布日期口径：year 必须由 published 推导
bad_year = 0
no_pub = 0
for r in records:
    pub = str(r.get("published") or "")
    y = r.get("year") or 0
    if pub:
        if not y:
            no_pub += 1
            continue
        if pub[:4] != str(y):
            bad_year += 1
            if bad_year <= 5:
                print("   !! %s published=%s year=%s" % (r["id"], pub, y))
    else:
        if y:
            bad_year += 1
print("published 与 year 不一致：%d" % bad_year)
print("有 published 但缺 year：%d" % no_pub)
print("无 published（源数据本就无日期）：%d" % sum(1 for r in records if not r.get("published")))

# 正文规模：与站点口径一致（优先用构建期算好的 chars，去空白计）
def body_chars(r):
    if r.get("chars"):
        return r["chars"]
    secs = r.get("sections") or []
    n = sum(len((s.get("text") or "").replace(" ", "").replace("\n", "")) for s in secs)
    return n or len(r.get("text") or "")


for name, rs in (("党内", party), ("flk", flk_meta), ("湖北", hb_meta)):
    print("%s 正文字数：%d" % (name, sum(body_chars(r) for r in rs)))

# 同名但不同内容的文件必须保留（带版本后缀）
suffixed = [r for r in records if "（" in r["title"] and r["title"].endswith("）")]
print("带版本后缀的条目：%d" % len(suffixed))

# Word 预览确实已下线
leftover = [r["id"] for r in records if r.get("hasWord") or r.get("wordChunk")]
print("仍带 Word 预览字段的条目：%d" % len(leftover))
print("data/ 下仍有 word_*.js：%d" % len(glob.glob(os.path.join(ROOT, "data", "word_*.js"))))

# 数据体积
tot = 0
for f in glob.glob(os.path.join(ROOT, "data", "*")):
    tot += os.path.getsize(f)
print("data/ 合计：%.1f MB" % (tot / 1048576.0))
for f in sorted(glob.glob(os.path.join(ROOT, "data", "*.js"))):
    print("   %-18s %8.2f MB" % (os.path.basename(f), os.path.getsize(f) / 1048576.0))
