# -*- coding: utf-8 -*-
"""
抓取人民网党建频道「党章党规」书架全部条目全文。

数据源结构（每页内联脚本）：
    var contentItem = [ { "name": "章节名", "text": "<p>...</p>" }, ... ]

产出：
    tools/cache/<slug>.json   每本书的清洗后内容（可断点续跑）
    data/regulations.json    汇总语料
"""
import os, re, sys, json, time, hashlib
from concurrent.futures import ThreadPoolExecutor

import urllib3
import requests
from lxml import html as LH

urllib3.disable_warnings()
sys.stdout.reconfigure(encoding='utf-8')

BASE = 'http://dangjian.people.com.cn'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'cache')
os.makedirs(CACHE, exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept': 'text/html,application/xhtml+xml',
}

WS = re.compile(r'[\u2002\u2003\u2009\u200a\u3000\xa0]+')


# ---------------------------------------------------------------- 工具
def norm_ws(s):
    """压缩空白但保留段落换行。"""
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    s = re.sub(r'[ \t\u2002\u2003\u2009\u200a\u3000\xa0]+', ' ', s)
    s = re.sub(r' *\n *', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


ENT_FIX = re.compile(r'&(nbsp|emsp|ensp|thinsp|zwnj|zwj|middot|ldquo|rdquo|lsquo|rsquo|hellip|mdash|ndash)'
                      r'(?![a-zA-Z0-9;])')


def html_to_text(html):
    """把 HTML 片段转成保留段落结构的纯文本。"""
    if not html:
        return ''
    # 源页面混用了 &nbsp; 与 &nbsp 两种写法，先补全缺失的分号
    html = ENT_FIX.sub(r'&\1;', html)
    try:
        frag = LH.fragment_fromstring(html, create_parent='div')
    except Exception:
        return norm_ws(re.sub(r'<[^>]+>', '', html))

    out = []

    def walk(el):
        if el.text:
            out.append(el.text)
        for child in el:
            tag = child.tag
            if not isinstance(tag, str):          # 注释
                if child.tail:
                    out.append(child.tail)
                continue
            if tag in ('p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                       'li', 'tr', 'table', 'blockquote'):
                out.append('\n')
                walk(child)
                out.append('\n')
            elif tag == 'br':
                out.append('\n')
            else:
                walk(child)
            if child.tail:
                out.append(child.tail)

    walk(frag)
    text = ''.join(out)
    text = text.replace('\xa0', ' ').replace('\u2003', '　').replace('\u2002', ' ')
    text = re.sub(r'&nbsp;?', ' ', text)
    text = re.sub(r'&(emsp|ensp|thinsp);?', ' ', text)
    return norm_ws(text)


def extract_json_array(raw, varname):
    """提取 `var <varname> = [...]` 的 JS 字面量，交给 Node 求值（兼容单引号/裸换行/尾随逗号）。"""
    key = 'var ' + varname
    pos = raw.find(key)
    if pos < 0:
        return None
    start = raw.find('[', pos)
    if start < 0:
        return None
    depth, i, in_str, quote, esc = 0, start, False, '', False
    blob = None
    while i < len(raw):
        ch = raw[i]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == quote:
                in_str = False
        else:
            if ch in '"\'':
                in_str, quote = True, ch
            elif ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    blob = raw[start:i + 1]
                    break
        i += 1
    if blob is None:
        return None
    return node_eval_array(blob)


def sanitize_js_string(blob):
    """把字符串字面量里的裸控制字符（换行/回车/制表）转义，使 JS 可解析。"""
    out = []
    in_str, quote, esc = False, '', False
    for ch in blob:
        if in_str:
            if esc:
                esc = False
                out.append(ch)
            elif ch == '\\':
                esc = True
                out.append(ch)
            elif ch == quote:
                in_str = False
                out.append(ch)
            elif ch == '\n':
                out.append('\\n')
            elif ch == '\r':
                out.append('\\r')
            elif ch == '\t':
                out.append('\\t')
            else:
                out.append(ch)
        else:
            if ch in '"\'':
                in_str, quote = True, ch
            out.append(ch)
    return ''.join(out)


def node_eval_array(blob):
    """用 Node 解析 JS 数组字面量，返回 Python list。"""
    import subprocess, tempfile
    tmpdir = tempfile.mkdtemp(prefix='fgjs_')
    js_path = os.path.join(tmpdir, 'lit.js')
    blob = sanitize_js_string(blob)
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write('const __lit = ' + blob + ';\n')
        f.write('process.stdout.write(JSON.stringify(__lit));\n')
    try:
        proc = subprocess.run(['node', js_path], capture_output=True, timeout=60)
        out = proc.stdout.decode('utf-8', errors='replace')
        if proc.returncode != 0 or not out.strip():
            sys.stderr.write('[node_eval] ' + proc.stderr.decode('utf-8', 'replace')[:300] + '\n')
            return None
        return json.loads(out)
    except Exception:
        return None
    finally:
        try:
            os.remove(js_path)
            os.rmdir(tmpdir)
        except Exception:
            pass


def fetch(url, tries=3):
    last = None
    for t in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30, verify=False)
            if r.status_code == 200:
                return r.content.decode(r.apparent_encoding or 'utf-8', errors='replace')
            last = f'HTTP {r.status_code}'
        except Exception as e:
            last = f'{type(e).__name__}: {e}'
        time.sleep(1.2 * (t + 1))
    raise RuntimeError(last or 'unknown')


def slug_of(title, idx):
    t = re.sub(r'[^\u4e00-\u9fa5A-Za-z0-9]+', '-', title).strip('-')
    return f'{idx:03d}-{hashlib.md5(title.encode("utf-8")).hexdigest()[:6]}-{t[:24]}'


# ---------------------------------------------------------------- 主流程
def load_catalog():
    path = os.path.join(ROOT, 'tools', 'bookdata.json')
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    items = []
    for shelf, cats in data.items():
        for cat, books in cats.items():
            for b in books:
                link = (b.get('link') or '').strip()
                if link.startswith('/'):
                    link = BASE + link
                items.append({
                    'shelf': shelf,
                    'category': cat,
                    'title': (b.get('title') or '').strip(),
                    'summary': norm_ws(b.get('summary') or ''),
                    'url': link,
                })
    return items


def process(item):
    slug = slug_of(item['title'], item['idx'])
    cpath = os.path.join(CACHE, slug + '.json')
    if os.path.exists(cpath):
        try:
            with open(cpath, encoding='utf-8') as f:
                rec = json.load(f)
            rec['cached'] = True
            return rec
        except Exception:
            pass
    if not item['url'] or '#two' in item['url']:
        return {**item, 'id': slug, 'status': 'no_url', 'sections': [], 'text': ''}

    try:
        raw = fetch(item['url'])
    except Exception as e:
        return {**item, 'id': slug, 'status': f'fetch_fail: {e}', 'sections': [], 'text': ''}

    arr = extract_json_array(raw, 'contentItem')
    if not arr:
        return {**item, 'id': slug, 'status': 'no_contentItem', 'sections': [], 'text': ''}

    sections = []
    for it in arr:
        if not isinstance(it, dict):
            continue
        name = norm_ws(re.sub(r'<[^>]+>', '', str(it.get('name') or '')))
        body = html_to_text(it.get('text') or '')
        if not body and not name:
            continue
        sections.append({'name': name, 'text': body})
    text = '\n\n'.join([s['text'] for s in sections if s['text']])
    rec = {**item, 'id': slug, 'status': 'ok' if text else 'empty',
           'sections': sections, 'text': text}
    try:
        with open(cpath, 'w', encoding='utf-8') as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
    except Exception:
        pass
    return rec


def main():
    items = load_catalog()
    for i, it in enumerate(items):
        it['idx'] = i + 1
    print(f'目录条目：{len(items)} 条，开始抓取…', flush=True)

    done = [0]

    def wrapped(it):
        rec = process(it)
        done[0] += 1
        if done[0] % 10 == 0 or rec.get('status') != 'ok':
            print(f"  [{done[0]:>3}/{len(items)}] {rec.get('status','?'):<18} "
                  f"{rec.get('title','')[:38]}", flush=True)
        return rec

    with ThreadPoolExecutor(max_workers=6) as ex:
        recs = list(ex.map(wrapped, items))

    ok = [r for r in recs if r.get('status') == 'ok']
    print(f'\n抓取完成：成功 {len(ok)} / {len(recs)}')
    from collections import Counter
    print('状态分布：', dict(Counter(r.get('status', '?') for r in recs)))
    print('分类分布：', dict(Counter(r.get('category', '?') for r in ok)))
    total_chars = sum(len(r.get('text', '')) for r in ok)
    print(f'正文总字数：{total_chars:,}')
    with open(os.path.join(ROOT, 'tools', 'raw_corpus.json'), 'w', encoding='utf-8') as f:
        json.dump(recs, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
