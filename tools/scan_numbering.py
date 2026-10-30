# -*- coding: utf-8 -*-
"""统计全库正文里「行首序号」的形态：看哪些会被 sectionMarkdown 改写。
用法: python tools\\scan_numbering.py"""
import sys, os, json, glob, re, collections
sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_js(pattern, var):
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, "data", pattern))):
        s = open(f, encoding="utf-8").read()
        if var + ".push(" in s:
            i = s.index(var + ".push(")
            out.extend(json.loads(s[i + len(var) + len(".push("):].rstrip().rstrip(";").rstrip(")")))
        else:
            i = s.index(var + " =")
            out.extend(json.loads(s[i + len(var) + len(" ="):].rstrip().rstrip(";").rstrip(")")))
    return out


bodies = load_js("party_*.js", "window.FG_PARTY") + load_js("flk_*.js", "window.FG_FLK") \
    + load_js("hubei_*.js", "window.FG_HUBEI")

PATS = [
    ("第X条", re.compile(r"^第[一二三四五六七八九十百零〇两]+条")),
    ("（一）全角", re.compile(r"^[（(][一二三四五六七八九十百零〇两\d]+[)）]")),
    ("一、顿号", re.compile(r"^[一二三四五六七八九十百零〇两]+、")),
    ("1. 数字点", re.compile(r"^\d+[.．]\s*\S")),
    ("1、 数字顿号", re.compile(r"^\d+、\s*\S")),
    ("① 圈号", re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]")),
    ("(1) 半角括号数字", re.compile(r"^\(\d+\)")),
    ("◆/●/■ 符号", re.compile(r"^[◆●■▲•·]")),
    ("- 连字符", re.compile(r"^[-*]\s+\S")),
    ("【】", re.compile(r"^【[^】]{1,30}】")),
]

cnt = collections.Counter()
docs = collections.defaultdict(set)
examples = collections.defaultdict(list)

for b in bodies:
    for s in b.get("sections", []):
        for line in (s.get("text") or "").split("\n"):
            t = line.strip()
            if not t:
                continue
            for name, rx in PATS:
                if rx.match(t):
                    cnt[name] += 1
                    docs[name].add(b["id"])
                    if len(examples[name]) < 3:
                        examples[name].append("%s | %s" % (b["id"], t[:60]))
                    break
            else:
                cnt["（其他）"] += 1

print("行首序号形态统计：")
for name, _ in PATS:
    if cnt.get(name):
        print("  %-16s %6d 行 / %4d 部法规   例: %s" %
              (name, cnt[name], len(docs[name]), examples[name][0]))
print("  %-16s %6d 行" % ("（其他）", cnt.get("（其他）", 0)))

# 「一、」行的长度分布：短的多半是真标题，长的可能是条目正文
buckets = collections.Counter()
samples = []
for b in bodies:
    for s in b.get("sections", []):
        for line in (s.get("text") or "").split("\n"):
            t = line.strip()
            m = re.match(r"^[一二三四五六七八九十百零〇两]+、", t)
            if not m:
                continue
            n = len(t)
            if n <= 20:
                buckets["<=20"] += 1
            elif n <= 30:
                buckets["21-30"] += 1
            elif n <= 45:
                buckets["31-45"] += 1
            else:
                buckets[">45"] += 1
            if n > 45 and len(samples) < 5:
                samples.append("%s | %s" % (b["id"], t[:70]))
print()
print("「一、」行长度分布：", dict(buckets))
for s in samples:
    print("  长例: " + s)

# 命中「（一）」但所属 section name 是空/无标题的（说明它其实是正文里的层级）
print()
print("含「（一）」序号且一级标题为「一、」的法规（前 12 部）：")
n = 0
for b in bodies:
    hit = False
    for s in b.get("sections", []):
        nm = (s.get("name") or "")
        if re.match(r"^[一二三四五六七八九十百零〇两]+、", nm) and \
           any(re.match(r"^[（(][一二三四五六七八九十百零〇两\d]+[)）]", l.strip())
               for l in (s.get("text") or "").split("\n")):
            hit = True
    if hit:
        n += 1
        if n <= 12:
            print("  %s" % b["id"])
print("  合计 %d 部" % n)
