# -*- coding: utf-8 -*-
"""最终补抓：5 篇公务员管理办法（官方/权威转载源），定位正文并清洗。"""
import sys, os, re, json, time
import urllib3
import requests
from lxml import html as LH

urllib3.disable_warnings()
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
     'Accept-Language': 'zh-CN,zh;q=0.9'}

TARGETS = {
    '公务员录用违规违纪行为处理办法': [
        'https://www.shaanxi.gov.cn/xw/ztzl/zxzt/zkzl/2026/2026gwyfj/202601/t20260126_3607904.html',
    ],
    '公务员录用考察办法（试行）': [
        'http://zhengning.gsjgbz.gov.cn/znx2_fzgz/202112/t20211221_220891.html',
        'https://www.peopleapp.com/rmharticle/30024724130',
    ],
    '公务员公开遴选办法': [
        'https://www.tlxfzx.gov.cn/News/Detail?id=b36c9afd-324d-48f8-a240-78d8855d0730&NewsType=1',
        'https://www.peopleapp.com/rmharticle/30024724130',
    ],
    '公务员初任培训办法（试行）': [
        'https://www.jyg.gov.cn/jgswglj/zfxxgk/zfxxgknb/art/2022/art_e51c0d3926f745919dacccff49176965.html',
        'https://www.peopleapp.com/rmharticle/30024724130',
    ],
    '行政执法类公务员培训办法（试行）': [
        'https://www.12371.cn/2021/10/14/ARTI1634170650054847.shtml',
    ],
}

END_MARK = re.compile(r'(责任编辑|扫一扫|打印本页|分享到|上一篇|下一篇|相关链接|附件下载|'
                      r'版权所有|京ICP|网站地图|浏览次数|访问量|当前页码|返回顶部)')


def fetch_lines(url):
    r = requests.get(url, headers=H, timeout=30, verify=False)
    raw = r.content.decode(r.apparent_encoding or 'utf-8', errors='replace')
    doc = LH.fromstring(raw)
    for bad in doc.xpath('//script|//style|//noscript|//iframe'):
        p = bad.getparent()
        if p is not None:
            p.remove(bad)
    body = doc.xpath('//body')
    node = body[0] if body else doc
    parts = []
    for el in node.iter():
        if el.tag in ('p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'td', 'section'):
            parts.append('\n')
        if el.text:
            parts.append(el.text)
        if el.tail:
            parts.append(el.tail)
    text = ''.join(parts).replace('\xa0', ' ').replace('\u3000', ' ')
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r' *\n *', '\n', text)
    lines = [l.strip() for l in text.split('\n')]
    return [l for l in lines if l]


def extract(lines, title):
    core = title.replace('（试行）', '').replace('（试行', '').replace('试行）', '')
    core = core.replace('（', '').replace('）', '').replace(' ', '')
    a = None
    for i, ln in enumerate(lines):
        if '第一条' in ln:
            a = i
            break
    if a is None:
        return ''
    cands = [i for i, ln in enumerate(lines[:a])
             if core[:6] in ln.replace(' ', '') and len(ln) < 120]
    start = max(cands) if cands else max(0, a - 6)
    # 标题行去掉前缀
    if cands:
        ln = lines[start]
        k = ln.replace(' ', '').find(core[:6])
        if k > 0:
            lines[start] = ln.replace(' ', '')[k]
    cut = len(lines)
    for i in range(a + 1, len(lines)):
        if END_MARK.search(lines[i]):
            cut = i
            break
    body = lines[start:cut]
    out = '\n'.join(body)
    out = re.sub(r'\n{2,}', '\n', out)
    return out.strip()


def valid(title, body):
    flat = body.replace(' ', '').replace('\n', '')
    core = title.replace('（试行）', '').replace('（试行', '').replace('试行）', '')
    core = core.replace('（', '').replace('）', '').replace(' ', '')
    return core[:6] in flat[:900] and flat.count('第一条') >= 1 and len(flat) > 600


out = {}
for title, urls in TARGETS.items():
    got = None
    for url in urls:
        try:
            lines = fetch_lines(url)
        except Exception as e:
            print('  ERR', type(e).__name__, url)
            continue
        body = extract(lines, title)
        if valid(title, body):
            got = {'url': url, 'text': body}
            print(f'  ✓ {title}  len={len(body)}  {url}')
            break
        print(f'  · {title} 候选无效 len={len(body)}  {url[:70]}')
        time.sleep(0.5)
    if not got:
        print(f'  ✗ {title}')
    out[title] = got

json.dump(out, open(os.path.join(ROOT, 'tools', 'supplement_final.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('\n补齐：', sum(1 for v in out.values() if v), '/', len(out))
for k, v in out.items():
    if v:
        print('\n---', k, '---')
        print(v['text'][:260].replace('\n', ' | '))
