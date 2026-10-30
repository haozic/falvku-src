# -*- coding: utf-8 -*-
"""解析 bookData 书架目录（容忍尾随逗号），并统计各分类书目。"""
import sys, re, json
import urllib3
import requests

urllib3.disable_warnings()
sys.stdout.reconfigure(encoding='utf-8')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

URL = 'http://dangjian.people.com.cn/GB/136058/427510/index.html'
r = requests.get(URL, headers=HEADERS, timeout=25, verify=False)
raw = r.content.decode(r.apparent_encoding or 'utf-8', errors='replace')

start = raw.find('var bookData')
brace = raw.index('{', start)
# 手工括号配平
depth, i, end = 0, brace, None
in_str, esc = False, False
while i < len(raw):
    ch = raw[i]
    if in_str:
        if esc:
            esc = False
        elif ch == '\\':
            esc = True
        elif ch == '"':
            in_str = False
    else:
        if ch == '"':
            in_str = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    i += 1
blob = raw[brace:end]
print('bookData blob length =', len(blob))

cleaned = re.sub(r',(\s*[}\]])', r'\1', blob)
cleaned = re.sub(r',(\s*),', r',', cleaned)
cleaned = re.sub(r',(\s*),(\s*),', r',', cleaned)
data = json.loads(cleaned)

with open('tools/bookdata.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=1)

total = 0
for shelf, cats in data.items():
    print(f'\n########## 书架：{shelf} ##########')
    for cat, books in cats.items():
        print(f'\n== 分类：{cat} （{len(books)} 部） ==')
        for b in books:
            total += 1
            print(f"  - {b.get('title','')}  |  {b.get('summary','')}")
            print(f"    {b.get('link','')}")
print('\nTOTAL BOOKS =', total)
