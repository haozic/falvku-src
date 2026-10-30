# -*- coding: utf-8 -*-
"""
构建站点数据集。

输入：
    tools/raw_corpus.json        人民网党章党规书架抓取结果
    tools/supplement_final.json   补充抓取的 5 篇公务员管理办法
    tools/flk_cache/*.json       国家法律法规数据库（flk.npc.gov.cn）抓取结果
输出：
    data/regulations.js          window.FG_DATA = {...}（党内法规 + 门类 + 分组）
    data/regulations.json        同内容（JSON 版，便于二次开发）
    data/flk_01.js ...            window.FG_FLK 分片（国家法律法规正文，体积大故分片）
"""
import sys, os, re, json, collections, html as htmlmod, glob, shutil, difflib, hashlib
from datetime import date
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import section_parser as SP
except Exception:      # 解析模块缺失时退化为「全部一级」
    SP = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')


def section_level(name, fallback=0):
    """章节层级：1 = 一级（第X章 / 编 / 总则…），2 = 二级（第X节）。"""
    if not name:
        return fallback
    if SP is not None:
        lv = SP.heading_level(name)
        if lv:
            return lv
    return 1 if fallback != 2 else 2

# ---------------------------------------------------------------- 分类定义
# tone 用于首页门类卡片的配色变体：'' / gold / blue / teal / purple / slate
CATEGORIES = [
    {'id': 'xianfa', 'name': '宪法', 'group': '国家法律法规', 'color': '#d4a017', 'tone': 'gold',
     'desc': '国家的根本法，规定国家性质、根本制度与公民基本权利义务。', 'level': 24},
    {'id': 'falv', 'name': '法律', 'group': '国家法律法规', 'color': '#c8102e', 'tone': '',
     'desc': '由全国人民代表大会及其常务委员会制定的规范性法律文件。', 'level': 23},
    {'id': 'xingzheng', 'name': '行政法规', 'group': '国家法律法规', 'color': '#b03030', 'tone': 'blue',
     'desc': '国务院制定颁布的法律性文件，效力低于法律。', 'level': 22},
    {'id': 'jiancha', 'name': '监察法规', 'group': '国家法律法规', 'color': '#8a4b9c', 'tone': 'purple',
     'desc': '国家监察委员会及相关监察机关制定的规范性文件。', 'level': 21},
    {'id': 'dangzhang', 'name': '党章', 'group': '党内法规', 'color': '#c8102e',
     'desc': '党的根本大法，是全党必须遵循的总章程。', 'level': 1},
    {'id': 'zhunze', 'name': '准则', 'group': '党内法规', 'color': '#e07b39',
     'desc': '党内政治生活的基本准则，确立党内政治生活的根本原则。', 'level': 2},
    {'id': 'tiaoli', 'name': '条例', 'group': '党内法规', 'color': '#2f6feb',
     'desc': '规范某一方面党内工作的基本制度，体系主体。', 'level': 3},
    {'id': 'guiding', 'name': '规定', 'group': '党内法规', 'color': '#4c5fd7',
     'desc': '对特定事项作出的具体制度安排。', 'level': 4},
    {'id': 'guize', 'name': '规则', 'group': '党内法规', 'color': '#0f9b8e',
     'desc': '规范工作程序与操作要求的制度。', 'level': 5},
    {'id': 'banfa', 'name': '办法', 'group': '党内法规', 'color': '#7c4dff',
     'desc': '办理具体事务、明确操作流程的办法。', 'level': 6},
    {'id': 'xize', 'name': '细则', 'group': '党内法规', 'color': '#2e9e4b',
     'desc': '对法规条文具体化、细则化的配套文件。', 'level': 7},
    {'id': 'guifanxing', 'name': '规范性文件', 'group': '党内法规', 'color': '#a97142',
     'desc': '中央办公厅、国务院办公厅印发的政策性文件。', 'level': 8},
    {'id': 'zugong', 'name': '组工文件', 'group': '党务资料', 'color': '#8a6d3b', 'tone': 'teal',
     'desc': '中央组织部印发的组织工作文件与工作通知。', 'level': 9},
    {'id': 'dangwu', 'name': '党务知识', 'group': '党务资料', 'color': '#d1477a',
     'desc': '党务工作实务问答，覆盖党员、党组织、干部、纪律等主题。', 'level': 10},
    {'id': 'local', 'name': '本机自建', 'group': '本机数据', 'color': '#6b7a99', 'tone': 'slate',
     'desc': '本机手工录入的法规、地方规定与学习笔记。', 'level': 11},
    {'id': 'dfg', 'name': '地方性法规', 'group': '湖北地方法规', 'color': '#1f7a5a', 'tone': 'teal',
     'desc': '湖北省本级及各市州人民代表大会常务委员会制定的地方性法规与法规性决定。', 'level': 12},
    {'id': 'zxzd', 'name': '自治条例单行条例', 'group': '湖北地方法规', 'color': '#3a7d44', 'tone': 'teal',
     'desc': '民族自治地方人民代表大会制定的自治条例与单行条例。', 'level': 13},
]

# 法规体系（分组）：用于侧栏、首页卡片与检索范围
GROUPS = [
    {'id': 'guojia', 'name': '国家法律法规', 'color': '#c8102e', 'tone': '',
     'cats': ['xianfa', 'falv', 'xingzheng', 'jiancha'],
     'desc': '宪法、法律、行政法规与监察法规，收录自国家法律法规数据库（flk.npc.gov.cn）。'},
    {'id': 'dangnei', 'name': '党内法规', 'color': '#b03030', 'tone': '',
     'cats': ['dangzhang', 'zhunze', 'tiaoli', 'guiding', 'guize', 'banfa', 'xize', 'guifanxing'],
     'desc': '党章、准则、条例、规定、办法、规则、细则与配套规范性文件，收录自人民网党建频道与共产党员网「党章党规」专页。'},
    {'id': 'dangwu', 'name': '党务资料', 'color': '#8a6d3b', 'tone': 'teal',
     'cats': ['zugong', 'dangwu'],
     'desc': '中央组织部印发的组织工作文件与党务工作实务知识。'},
    {'id': 'local', 'name': '本机数据', 'color': '#6b7a99', 'tone': 'slate',
     'cats': ['local'],
     'desc': '本机手工录入的法规、地方规定与学习笔记。'},
    {'id': 'hubei', 'name': '湖北地方法规', 'color': '#1f7a5a', 'tone': 'slate',
     'cats': ['dfg', 'zxzd'],
     'desc': '湖北省本级、武汉等 13 个市州的地方性法规与法规性决定，以及恩施州、五峰县、长阳县的自治条例与单行条例，收录自湖北法规库。'},
]

# flk 一级门类 -> 本站分类 id
FLK_CAT_ID = {'宪法': 'xianfa', '法律': 'falv', '行政法规': 'xingzheng', '监察法规': 'jiancha'}

# 共产党员网「党章党规」专页的门类 -> 本站分类 id
# （该站的门类划分与人民网党建频道一致：党章/准则/条例/规定/办法/规则/细则/规范性文件）
X12371_CAT_ID = {
    '党章': 'dangzhang', '准则': 'zhunze', '条例': 'tiaoli', '规定': 'guiding',
    '规则': 'guize', '办法': 'banfa', '细则': 'xize', '规范性文件': 'guifanxing',
}

# flk 时效性代码
# 注意：sxx=2 表示该版本已被后续修订取代（flk 标记为「已修改」），
#       历史版本与现行版本标题完全相同，站点里必须靠这个标签区分。
FLK_SXX = {1: '已废止', 2: '已修改', 3: '有效', 4: '尚未生效'}

CAT_ID_BY_NAME = {c['name']: c['id'] for c in CATEGORIES}
CAT_BY_ID = {c['id']: c for c in CATEGORIES}

DAZHANG_ZHENGWU = ('党章党规',)
DAWU_SUBS = ('党员', '党的组织', '党的干部', '党的纪律', '党的知识')

# ---------------------------------------------------------------- 主题标签
TAGS = [
    ('组织工作', ['组织', '支部', '党委', '党组', '基层', '党委领导', '组织工作']),
    ('干部人事', ['干部', '选拔任用', '任职', '考核', '编制', '公务员', '领导干部']),
    ('党员管理', ['党员', '党费', '发展党员', '预备党员', '入党', '组织关系']),
    ('纪律处分', ['纪律', '处分', '违纪', '问责', '廉政', '廉洁']),
    ('党内监督', ['监督', '巡视', '巡察', '纪检', '监察', '举报']),
    ('宣传教育', ['宣传', '教育', '理论', '意识形态', '学习', '培训', '新闻', '出版']),
    ('统一战线', ['统战', '统一战线', '民主党派', '民族宗教', '侨', '知识分子']),
    ('机关建设', ['机关', '厉行节约', '公务接待', '会议', '文风', '督查', '调研']),
    ('党建引领', ['党建', '党群', '共建', '共治', '共享', '城市基层', '社区']),
    ('法治建设', ['法治', '依法治国', '政法', '司法', '执法', '法律']),
    ('人才工作', ['人才', '专家', '知识分子', '博士后']),
    ('网络安全', ['保密', '国家安全', '网络', '信息安全', '数据']),
    ('党务公开', ['党务公开', '信息公开', '公开']),
    ('财经审计', ['经济责任审计', '财经', '财务', '审计', '国有资产']),
    ('群团工作', ['工会', '共青团', '团委', '妇女', '群团', '党建带团建']),
    ('作风建设', ['形式主义', '官僚主义', '享乐主义', '奢靡之风', '八项规定', '基层减负', '作风建设']),
    ('保障监督', ['待遇', '工资', '福利', '离退休', '安置']),
]

CHROME_LINES = re.compile(
    r'^(分享|微信分享开始|微信分享结束|扫一扫|X|发布日期|浏览次数|时间|来源|当前位置|'
    r'【.*?】|正文 start|选择字号|打印本页|分享到|字体|字号|返回|上一篇|下一篇)[\s:：|]*$')

DATE_RE = re.compile(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日')


def iso(d):
    try:
        return '%04d-%02d-%02d' % (int(d[0]), int(d[1]), int(d[2]))
    except Exception:
        return ''


def clean_chrome(lines):
    out = []
    for ln in lines:
        t = ln.strip()
        if not t:
            continue
        if CHROME_LINES.match(t):
            continue
        out.append(t)
    return out


ISSUERS = [
    '中共中央办公厅、国务院办公厅', '中共中央办公厅', '中共中央组织部',
    '中共中央纪律检查委员会', '国家公务员局', '中共中央', '国务院',
    '中共中央组织部、人力资源社会保障部、国家公务员局',
    '中共中央组织部、人力资源社会保障部', '中共中央组织部、教育部党组',
    '中共中央组织部、中央宣传部', '中央纪委机关', '国务院办公厅',
    '中央组织部、教育部党组', '中央组织部、中央宣传部', '中央纪委',
    '中央宣传部', '中央组织部', '中共中央办公厅、国务院', '国家公务员局',
]

# 摘要/标题中常见的"XX印发《…》"句式，用于兜底抽取机关
ISSUER_RE = re.compile(r'([一-龥]{2,14}?(?:办公厅|组织部|宣传部|纪律检查委员会|人事部|'
                        r'社会工作部|统战部|政策研究室|纪律检查委员会|办公厅|部|委|局))'
                        r'(?=印发|发布|下发|转发|制定|修订)')


def guess_issuer(summary, title=''):
    """从摘要/标题推断制定或发布机关。"""
    blob = summary or title
    m = re.search(r'(中国共产党第[一二三四五六七八九十]+次全国代表大会)', blob)
    if m:
        return m.group(1)
    for o in ISSUERS:
        if o in blob:
            return o
    if '中共中央政治局会议审议批准' in blob or '中共中央政治局常委会会议审议批准' in blob:
        return '中共中央'
    if '中办国办' in blob:
        return '中共中央办公厅、国务院办公厅'
    m = ISSUER_RE.search(blob)
    if m:
        cand = m.group(1)
        for o in ISSUERS:
            if cand.startswith(o) or o.startswith(cand):
                return o
        return cand
    return '中共中央'


def parse_dates(summary):
    """从摘要中抽取首次通过、最后修订、施行日期。"""
    ds = DATE_RE.findall(summary)
    adopted = effective = revised = ''
    m = re.search(r'自\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*起施行', summary)
    if m:
        effective = iso(DATE_RE.findall(m.group(1))[0])
    if ds:
        adopted = iso(ds[0])
        revised = iso(ds[-1])
    if not effective and ds:
        effective = iso(ds[-1])
    years = [int(d[0]) for d in ds]
    year = max(years) if years else 0
    return adopted, effective, revised, year


# 摘要里跟在日期后面的事件词：发布/印发/公布/颁布 与 修订/修正/修改
# 都表示「这一版法规对外生效的时刻」，即现行版本的公布日期。
PUBLISH_KW = re.compile(r'(?:发布|印发|公布|颁布)')
REVISE_KW = re.compile(r'(?:修订|修正|修改)')
TAIL_WINDOW = 26


def parse_party_published(summary, adopted='', revised=''):
    """党内法规的「现行版本公布日期」。

    人民网摘要的固定句式是「日期 + 事件」，例如
        「2016年11月30日中共中央政治局会议审议批准
           2017年3月1日中共中央发布
           2025年11月28日中国共产党工作机关修订
           2025年11月28日中共中央发布」
    取最后一个「发布/印发/公布/颁布」或「修订/修正/修改」事件日 —— 与国家
    法律法规库的 gbrq 口径一致（现行版公布日，而非初版通过日）。
    「自X起施行」的施行日不算公布日；找不到事件词时退回最后一次出现的日期。
    """
    s = summary or ''
    # 施行日不作为公布日候选
    eff_span = re.search(r'自\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*起施行', s)
    eff_at = eff_span.start() if eff_span else -1
    cands = []
    for mm in DATE_RE.finditer(s):
        if eff_at >= 0 and mm.start() >= eff_at:
            continue                      # 施行日
        tail = s[mm.end():mm.end() + TAIL_WINDOW]
        kind = 0
        if PUBLISH_KW.search(tail):
            kind = 2
        elif REVISE_KW.search(tail):
            kind = 1
        cands.append((mm.start(), kind, iso(mm.groups())))
    if cands:
        pick = [c for c in cands if c[1] == 2] or [c for c in cands if c[1] == 1]
        if pick:
            return pick[-1][2]
        return cands[-1][2]
    return revised or adopted or ''


def normalize_clauses(text):
    """统一正文里条号的写法：去掉 Markdown 粗体标记，保留纯文本「第X条」。

    数据层一律存纯文本 —— 条号加粗由前端 `sectionMarkdown` 统一处理
    （三个数据源同一套规则），这样纯文本导出里不会出现多余的 `**`。
    共产党员网的源页面把条号排成 <strong>，解析时带了 `**`，这里去掉。
    """
    if not text:
        return text
    return re.sub(r'\*\*(第[一二三四五六七八九十百零〇两\d]+条)\*\*', r'\1', text)


def detect_tags(title, text):
    """按标题命中(权重高)与正文密度综合判定主题标签。"""
    head = text[:6000]
    tags = []
    for name, kws in TAGS:
        score = 0
        t_hit = 0
        for k in kws:
            c = title.count(k)
            t_hit += c
            score += c * 5 + min(head.count(k), 6)
        if t_hit > 0 and score >= 5:
            tags.append((name, score))
        elif score >= 9:
            tags.append((name, score))
    tags.sort(key=lambda x: -x[1])
    return [t[0] for t in tags[:4]]


def version_label(summary, year):
    """为同名不同版本生成区分标签。"""
    if not summary:
        return ''
    if '试行' in summary:
        pass
    m = re.search(r'(第[一二三四五六七八九十]+次修订|修订|修正)', summary)
    year_txt = str(year) if year else ''
    if m and year_txt:
        return '%s年%s' % (year_txt, m.group(1))
    if year_txt:
        return '%s年版' % year_txt
    return ''


def strip_title_prefix(t):
    """去掉'中共中央印发《…》'这类前缀，得到规范标题。"""
    t = t.strip()
    t = re.sub(r'^(中共中央办公厅|中共中央|国务院办公厅|中组部|中央组织部|中央纪委)[^\s]{0,12}'
               r'(印发|发布|下发|转发|决定|追授|通报)', '', t)
    t = re.sub(r'^关于印发', '关于', t)
    t = re.sub(r'《(.+?)》', r'\1', t)
    t = re.sub(r'^[《“"]+|[》”"]+$', '', t)
    return t.strip() or t


def clean_name(s):
    """清理章节名：去标签、解实体、压缩空白。"""
    if not s:
        return ''
    t = re.sub(r'<[^>]+>', '', s)
    t = htmlmod.unescape(t)
    t = t.replace('\xa0', ' ').replace('\u3000', ' ').replace('\u2003', ' ')
    t = re.sub(r'[ \t]{2,}', ' ', t)
    t = re.sub(r'\s*\n\s*', ' ', t)
    return t.strip()


# ---------------------------------------------------------------- 国家法律法规
FLK_TAGS = [
    ('民事', ['民事', '民法', '婚姻', '继承', '侵权', '合同', '物权', '婚姻家庭', '人身损害']),
    ('商事', ['公司', '企业', '合伙', '证券', '保险', '票据', '破产', '清算', '公司法', '合伙企业', '商标']),
    ('行政', ['行政许可', '行政处罚', '行政复议', '行政诉讼', '国家赔偿', '公务员', '行政机关', '政务', '编制', '行政处罚法']),
    ('刑事', ['刑事', '犯罪', '刑罚', '监狱', '看守所', '量刑', '缓刑', '假释', '追诉', '刑法']),
    ('诉讼', ['诉讼', '审判', '检察', '法院', '仲裁', '执行', '证据', '上诉', '再审', '管辖', '程序']),
    ('经济', ['财政', '税收', '金融', '银行', '投资', '价格', '统计', '审计', '国有资产', '产业发展', '市场监督', '增值税']),
    ('农村', ['农村', '农业', '村民委员会', '乡镇', '耕地', '种子', '农产品', '宅基地', '土地管理']),
    ('教育', ['教育', '学校', '教师', '学生', '考试', '学历', '学位', '未成年人', '职业教育', '教师法']),
    ('科技', ['科技', '技术', '信息', '网络', '数据', '电信', '互联网', '人工智能', '知识产权', '专利', '软件', '计算机']),
    ('卫生', ['卫生', '医疗', '疾病', '预防', '药品', '食品', '疫情', '健康', '传染病', '安全生产']),
    ('环保', ['环境', '环保', '污染', '生态', '保护', '资源', '节能', '碳排放', '长江', '黄河', '水污染']),
    ('国防', ['国防', '军队', '武装', '退役', '民兵', '国防动员', '保密', '国家安全']),
    ('社会保障', ['社会保险', '养老', '医疗保障', '就业', '工伤', '职业病', '残疾人', '最低生活保障', '社会救助']),
    ('劳动', ['劳动', '劳动合同', '工资', '工时', '休假', '劳务派遣', '职工', '职工法']),
    ('文化', ['文化', '文物', '出版', '新闻', '广播电视', '电影', '旅游', '体育', '民族', '宗教', '侨务']),
    ('涉外', ['外交', '领事', '条约', '国际', '涉外', '出口管制', '反倾销', '外资', '海关', '出入境', '对外贸易']),
    ('应急', ['应急', '突发事件', '安全生产', '灾害', '防汛', '地震', '救援', '消防', '事故']),
    ('监察', ['监察', '监督', '问责', '廉政', '巡视', '巡察', '违纪违法', '职务犯罪', '反洗钱']),
    ('港澳台', ['香港', '澳门', '台湾', '港澳', '两岸', '归侨', '侨务']),
    ('人大制度', ['人民代表大会', '人大', '选举', '代表', '议案', '常委会', '决定']),
]


def detect_flk_tags(title, text, sub=''):
    """国家法律法规的主题标签：标题命中权重高，正文密度次之。"""
    head = text[:5000]
    tags = []
    for name, kws in FLK_TAGS:
        score = 0
        t_hit = 0
        for k in kws:
            c = title.count(k)
            t_hit += c
            score += c * 5 + min(head.count(k), 5)
        if t_hit > 0 and score >= 5:
            tags.append((name, score))
        elif score >= 10:
            tags.append((name, score))
    tags.sort(key=lambda x: -x[1])
    out = [t[0] for t in tags[:4]]
    if sub and sub not in out:
        out = out[:3] + [sub]
    return out


def parse_flk_dates(preamble, title, gbrq, sxrq):
    """flk 的公布日期/施行日期在列表接口已给出；通过说明段补齐通过与修订日期。"""
    blob = (preamble or '')
    ds = [iso(m) for m in DATE_RE.findall(blob)]
    adopted = ds[0] if ds else ''
    revised = ''
    if len(ds) > 1 and re.search(r'(修订|修正|修改)', blob):
        revised = ds[-1]
    if not adopted:
        adopted = gbrq or ''
    if not revised:
        m = re.search(r'[（(]\s*(\d{4})\s*年', title or '')
        if m and gbrq and m.group(1) == gbrq[:4] and adopted == gbrq:
            revised = gbrq
    effective = sxrq or ''
    year = int(adopted[:4]) if adopted else (int(gbrq[:4]) if gbrq else 0)
    return adopted, revised, effective, year


def _norm_text(s):
    if not s:
        return ''
    s = re.sub(r'[﻿\u200b-\u200f\ufeff]', '', s)
    s = re.sub(r'[\s　]+', '', s)
    return re.sub(r'[《》（）()、，,。.:：;；"\'“”‘’\[\]【】\-—_]', '', s)


FLK_HEAD_RE = re.compile(r'^第[一二三四五六七八九十百零〇\d]+[编章篇节]\s*[^\d]{0,30}$')
FLK_PRE_RE = re.compile(r'^[（(].*[)）]$')
# 说明段：「（2021年8月20日第十三届全国人民代表大会常务委员会第三十次会议通过）」
FLK_META_PAREN_RE = re.compile(r'^[（(].{0,240}[)）]$')
# 说明段常见形态：「2004年3月14日第十届全国人民代表大会」+「第二次会议通过」
FLK_DATE_MEET_RE = re.compile(r'^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*第[一二三四五六七八九十]+届'
                               r'(全国人民代表大会|人民代表大会常务委员会)')


def _strip_paren_block(text):
    """去掉文本开头的括号块（说明段常常跨行，如「（2018年3月11日……\n第一次会议通过）」）。"""
    t = text.lstrip()
    if not t or t[0] not in '（(':
        return t
    depth = 0
    for i, ch in enumerate(t[:4000]):
        if ch in '（(':
            depth += 1
        elif ch in '）)':
            depth -= 1
            if depth == 0:
                return t[i + 1:].lstrip()
    return t


def flk_summary(sections, preamble, title=''):
    """检索摘要：取正文首个实质段落，跳过标题行、说明段、目录与章标题。

    原来的做法是直接用「说明段」（如「1990年6月28日第七届全国人民代表大会
    常务委员会第十四次会议通过 根据2009年8月27日……修正」）当摘要，在检索结果里
    又长又重复；这里改为抓正文第一段，读起来更像「这条法规讲了什么」。

    需要跳过的坑：
      * docx 首行常有一个只含 BOM 的空行；
      * 说明段（通过/修正信息）可能跨行；
      * 目录块里的「第X章」条目与正文标题混在一起。
    """
    lines = []
    for s in sections:
        for ln in (s.get('text') or '').split('\n'):
            t = ln.replace('﻿', '').replace('\u3000', ' ').strip()
            if t:
                lines.append(t)
    if not lines:
        return preamble or ''
    tnorm = _norm_text(title)

    # 1) 去掉开头重复的标题行
    if tnorm and lines:
        nt = _norm_text(lines[0])
        if nt and len(nt) >= 4 and (nt in tnorm or tnorm in nt):
            lines = lines[1:]

    # 2) 去掉紧随其后的说明段（可能跨行，如「（2021年8月20日第十三届全国人民代表大会
    #    常务委员会第三十次会议通过）」）
    if lines:
        rest = _strip_paren_block('\n'.join(lines)).split('\n')
        rest = [l.strip() for l in rest if l.strip()]
        if rest:
            lines = rest

    picked = []
    in_toc = False
    for ln in lines:
        if re.match(r'^目\s*录$', ln):
            in_toc = True
            continue
        if re.match(r'^序\s*言$', ln):
            continue
        if in_toc:
            # 目录块结束标志：出现「第X条」或带句末标点
            if re.match(r'^第[一二三四五六七八九十百零〇\d]+条', ln) or re.search(r'[。；]', ln):
                in_toc = False
            else:
                continue
        if FLK_HEAD_RE.match(ln):
            continue
        if SP is not None and SP.is_heading(ln):
            continue                       # 总则 / 分则 / 附则 / 序言 / 第一分编 等标题
        if FLK_META_PAREN_RE.match(ln) and re.search(r'(通过|修正|修订|公布|施行|发布|会议)', ln):
            continue                       # 说明段
        nt = _norm_text(ln)
        if tnorm and nt and len(nt) >= 2 and (nt in tnorm or tnorm in nt or tnorm.endswith(nt)):
            continue                       # 标题行（含换行拆出来的「决定」等尾字）
        picked.append(ln)
        if len(picked) >= 2:
            break
    if not picked:
        picked = lines[:2] or [preamble or '']
    txt = ' '.join(picked).strip()
    return txt[:160] + ('…' if len(txt) > 160 else '')


def build_flk_records(corpus):
    """把 flk 原始语料转成本站统一结构的记录。"""
    out = []
    for i, c in enumerate(corpus):
        cat_id = FLK_CAT_ID.get(c.get('cat'), 'falv')
        cat = CAT_BY_ID[cat_id]
        title = (c.get('title') or '').strip()
        if not title:
            continue
        preamble = c.get('preamble') or ''
        adopted, revised, effective, year = parse_flk_dates(
            preamble, title, c.get('gbrq') or '', c.get('sxrq') or '')
        sections = []
        for s in (c.get('sections') or []):
            nm = clean_name(s.get('name'))
            tx = s.get('text') or ''
            if not tx and not nm:
                continue
            lv = s.get('level') or 0
            if not lv and nm:
                lv = section_level(nm)
            sections.append({'name': nm, 'text': tx, 'level': lv})
        full = '\n'.join(s['text'] for s in sections if s['text'])
        summary = flk_summary(sections, preamble, title)
        # 修订沿革：flk 的 flfgDetails.lsyg 给出同一部法规的历次版本
        lsyg = []
        for it in (c.get('lsyg') or []):
            if not isinstance(it, dict):
                continue
            lsyg.append({
                'title': (it.get('title') or '').strip(),
                'date': it.get('gbrq') or '',
                'bbbs': it.get('bbbs') or '',
            })
        lsyg = [x for x in lsyg if x['title']]
        rid = 'n%04d' % (i + 1)
        # 公布日期：flk 列表接口给的 gbrq 才是该版本的公布日；
        # preamble 里的首个日期是「通过日」，两者对法律常常相差好几年。
        published = c.get('gbrq') or revised or adopted
        if published:
            year = int(published[:4]) if published[:4].isdigit() else year
        out.append({
            'id': rid,
            'title': title,
            'cat': cat_id,
            'catName': cat['name'],
            'sub': c.get('sub') or '',
            'level': cat['level'],
            'issuer': c.get('zdjgName') or '',
            'adopted': adopted,
            'published': published,
            'revised': revised,
            'effective': effective,
            'year': year,
            'summary': summary,
            'tags': detect_flk_tags(title, full, c.get('sub') or ''),
            'url': 'https://flk.npc.gov.cn/detail?id=' + c.get('bbbs', ''),
            'source': '国家法律法规数据库',
            'effect': FLK_SXX.get(c.get('sxx'), ''),
            'flxz': c.get('flxz') or '',
            'lsyg': lsyg,
            'bbbs': c.get('bbbs', ''),
            'chars': len(full.replace(' ', '')),
            'sections': sections,
        })

    # 同标题仍有多条（同名不同文、或现行版与即将生效版并存）时补版本后缀，
    # 列表里不再出现"标题一模一样看不出区别"的条目。
    tcnt = collections.Counter(r['title'] for r in out)
    for r in out:
        if tcnt[r['title']] > 1:
            r['title'] = r['title'] + flk_version_tag(r)
    return out


CHUNK_CHARS = 600000   # 每个正文分片约 60 万字（UTF-8 约 1.8MB）


def chunk_by_chars(records, per_chars=CHUNK_CHARS):
    """按正文字数切分记录。

    早先按「每片 160 条」切，结果片的大小全看碰上什么法规：
    data/party.js 一片就有 10.8MB（891 条党内法规全在一起），
    打开任意一篇党内法规都得先下载这 10.8MB。
    改成按字数切，每片大小可控，低配机上开详情页的等待能降一个量级。
    """
    groups, cur, n = [], [], 0
    for r in records:
        cur.append(r)
        n += r.get('chars') or 0
        if n >= per_chars:
            groups.append(cur)
            cur, n = [], 0
    if cur:
        groups.append(cur)
    return groups


def write_body_chunks(records, prefix, var, per_chars=CHUNK_CHARS):
    """正文分片写入 data/<prefix>_NN.js（window.<var>，数组的数组）。

    分片里只放「条目 id + 正文」，元信息统一在 data/regulations.js 里；
    每条记录打上 bf 标记（自己的正文在哪个分片），前端据此按需加载。
    """
    data_dir = os.path.join(ROOT, 'data')
    # 用 prefix + '*.js' 而不是 prefix + '_*.js'：早先的 data/party.js（单片 10.8MB）
    # 也得清掉，否则旧文件会一直躺在分发目录里
    for old in glob.glob(os.path.join(data_dir, prefix + '*.js')):
        os.remove(old)
    groups = chunk_by_chars(records, per_chars)
    chunks = []
    for gi, part in enumerate(groups):
        key = '%s_%02d' % (prefix, gi + 1)
        name = key + '.js'
        body = [{'id': r['id'], 'sections': r['sections']} for r in part]
        for r in part:
            r['bf'] = key
        with open(os.path.join(data_dir, name), 'w', encoding='utf-8') as f:
            f.write('/* 自动生成，请勿手工修改；由 tools/build_dataset.py 生成 */\n')
            f.write('window.%s = window.%s || [];\n' % (var, var))
            f.write('window.%s.push(' % var)
            json.dump(body, f, ensure_ascii=False, separators=(',', ':'))
            f.write(');\n')
        chunks.append(name)
    return chunks


def write_flk_chunks(records, per_chunk=160):
    """国家法律法规正文分片（保持旧签名，内部改为按字数切）。"""
    return write_body_chunks(records, 'flk', 'FG_FLK')


def write_party_body(records):
    """党内法规正文分片写入 data/party_NN.js（window.FG_PARTY）。"""
    return write_body_chunks(records, 'party', 'FG_PARTY')


def patch_index_chunks(chunks, version):
    """在 index.html 的标记块内写入分片脚本标签。"""
    p = os.path.join(ROOT, 'index.html')
    s = open(p, encoding='utf-8').read()
    begin = '<!-- FLK-CHUNKS:BEGIN -->'
    end = '<!-- FLK-CHUNKS:END -->'
    if begin not in s or end not in s:
        return False
    tags = '\n'.join('<script src="data/%s?v=%s"></script>' % (c, version.replace('-', '')) for c in chunks)
    block = '%s\n%s\n%s' % (begin, tags, end)
    i = s.index(begin)
    j = s.index(end) + len(end)
    s = s[:i] + block + s[j:]
    open(p, 'w', encoding='utf-8').write(s)
    return True


# =============================================================== 湖北地方法规
HUBEI_SOURCE = '湖北法规库'
# 湖北条例的说明段：「（2022年8月30日荆州市第六届人民代表大会常务委员会第五次会议通过 …）」
HUBEI_META_RE = re.compile(r'^[（(].{0,300}[)）]$')
HUBEI_ART_RE = re.compile(r'^第[一二三四五六七八九十百零〇两\d]+条\s*(.*)$')


def load_hubei_corpus():
    """读取湖北法规库抓取缓存（tools/hubei_cache/<Rileid>.json）。

    顺序按**文件名字典序**（Rileid 是定长十六进制，字典序即数值序），
    id 分配依赖它，改动顺序会让历史 id 全部错位。
    """
    cache = os.path.join(ROOT, 'tools', 'hubei_cache')
    out = []
    if not os.path.isdir(cache):
        return out
    for fn in sorted(os.listdir(cache)):
        if not fn.endswith('.json'):
            continue
        try:
            out.append(json.load(open(os.path.join(cache, fn), encoding='utf-8')))
        except Exception:
            pass
    return out


def _drop_dup_title(text, title):
    """去掉正文开头与法规标题重复的行（详情页正文里标题会再出现一次）。"""
    tnorm = _norm_text(title)
    if not tnorm:
        return text
    lines = (text or '').split('\n')
    while lines:
        t = lines[0].strip()
        if not t:
            lines.pop(0)
            continue
        nt = _norm_text(t)
        if len(nt) >= 4 and (nt in tnorm or tnorm in nt):
            lines.pop(0)
            continue
        break
    return '\n'.join(lines)


def hubei_summary(sections, title=''):
    """检索摘要：取正文第一条的实质内容。

    湖北条例正文开头是说明段（「（2022年8月30日荆州市第六届人民代表大会常务委员会
    第五次会议通过 … 批准）」），可能跨行，要整块剥掉；说明段之后才是条文。
    这样检索结果里显示的是「这条法规讲了什么」，而不是一堆日期。
    """
    tnorm = _norm_text(title)
    lines = []
    for s in sections:
        lines.extend((s.get('text') or '').split('\n'))
    # 剥掉开头的括号说明块（可能跨行）
    rest = [l for l in _strip_paren_block('\n'.join(lines)).split('\n')]
    for t in rest:
        t = t.replace('\u3000', ' ').strip()
        if not t:
            continue
        nt = _norm_text(t)
        if tnorm and len(nt) >= 4 and (nt in tnorm or tnorm in nt):
            continue                      # 标题行
        if SP is not None and SP.is_heading(t):
            continue                      # 章标题
        m = HUBEI_ART_RE.match(t)
        body = (m.group(1).strip() if m else t)
        if body:
            return body[:160] + ('…' if len(body) > 160 else '')
    return ''


def build_hubei_records(corpus):
    """把湖北法规库原始语料转成本站统一结构的记录。"""
    out = []
    for i, c in enumerate(corpus):
        title = (c.get('title') or '').strip()
        if not title:
            continue
        cat_id = c.get('cat') or 'dfg'
        cat = CAT_BY_ID.get(cat_id) or CAT_BY_ID['dfg']
        sections = []
        for s in (c.get('sections') or []):
            nm = clean_name(s.get('name'))
            tx = _drop_dup_title(s.get('text') or '', title)
            if not tx and not nm:
                continue
            lv = s.get('level') or 0
            if not lv and nm:
                lv = section_level(nm)
            sections.append({'name': nm, 'text': tx, 'level': lv})
        full = '\n'.join(s['text'] for s in sections if s['text'])
        adopted = c.get('adopted') or ''
        revised = ''
        # 说明段里的修正日期（详情页显示为「最后修订」）
        m = re.search(r'(?:根据)?\s*(\d{4})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^）]{0,80}'
                      r'(?:修正|修订|修改)', full[:600])
        if m:
            revised = iso(m.groups())
        year = int(adopted[:4]) if adopted else 0
        rid = 'h%04d' % (i + 1)
        # 公布日期：湖北法规库详情页直接给了「公布日期」，与「通过日期」常常相差数年
        # （如《武汉市执法责任制工作条例》公布 2021-02-25 / 通过 1998-10-29）。
        published = c.get('published') or adopted
        if published[:4].isdigit():
            year = int(published[:4])
        out.append({
            'id': rid,
            'title': title,
            'cat': cat_id,
            'catName': cat['name'],
            'sub': c.get('region') or '',
            'level': cat['level'],
            'issuer': c.get('issuer') or '',
            'adopted': adopted,
            'published': published,
            'revised': revised,
            'effective': c.get('effective') or '',
            'year': year,
            'summary': hubei_summary(sections, title),
            'tags': detect_flk_tags(title, full, c.get('region') or ''),
            'url': c.get('url') or '',
            'source': HUBEI_SOURCE,
            'effect': c.get('effect') or '',
            'flxz': '地方性法规',
            'lsyg': [],
            'bbbs': c.get('rileid') or '',
            'chars': len(full.replace(' ', '')),
            'sections': sections,
        })
    return out


def write_hubei_chunks(records, per_chunk=170):
    """湖北正文分片写入 data/hubei_NN.js（window.FG_HUBEI），只放「id + 正文」。"""
    return write_body_chunks(records, 'hubei', 'FG_HUBEI')


def patch_index_chunks(chunks, version):
    """正文分片改为按需加载：index.html 里不再静态引入 flk_*.js / hubei_*.js。

    启动只解析 data/regulations.js 里的元信息（约 2.5MB），
    正文由 assets/js/app.js 在打开详情页 / 检索时动态加载（file:// 下同样可用）。
    这里只负责把旧的静态标签清掉。
    """
    p = os.path.join(ROOT, 'index.html')
    s = open(p, encoding='utf-8').read()
    before = s
    s = re.sub(r'<script src="data/(?:flk|hubei)_\d+\.js\?v=[^"]*"></script>\s*', '', s)
    for begin, end in (('<!-- FLK-CHUNKS:BEGIN -->', '<!-- FLK-CHUNKS:END -->'),
                       ('<!-- HUBEI-CHUNKS:BEGIN -->', '<!-- HUBEI-CHUNKS:END -->')):
        if begin in s and end in s:
            i = s.index(begin)
            j = s.index(end) + len(end)
            s = s[:i] + s[j:]
    s = re.sub(r'\n{3,}', '\n\n', s)
    if s != before:
        open(p, 'w', encoding='utf-8').write(s)
        return True
    return False


def patch_index_hubei(chunks, version):
    """湖北分片同样按需加载，清标签的活由 patch_index_chunks 一起做。"""
    return patch_index_chunks(chunks, version)


def _flk_body(c):
    """flk 条目的正文指纹（去掉标点空白）。"""
    return _norm_body('\n'.join([c.get('preamble') or ''] +
                                 [(s.get('name') or '') + (s.get('text') or '')
                                  for s in (c.get('sections') or [])]))


def _body_sim(a, b):
    """两段正文的相似度：头尾各取 1200 字比对（版本对共享长前缀）。"""
    if not a or not b:
        return 0.0
    s = 0.0
    for x, y in ((a[:1200], b[:1200]), (a[-1200:], b[-1200:])):
        s += difflib.SequenceMatcher(None, x, y).quick_ratio()
    return s / 2.0


def dedup_flk_same_title(corpus):
    """同标题条目清理（沿革簇之外的漏网之鱼）。

    flk 有一部分历史版本之间没有建立「修订沿革」关系，但标题相同、正文高度相似
    （同一部法律的旧版与现行版）。这类条目在站点里表现为同标题多条。

    判定（结合正文比对，不是只看标题）：
      * 同标题组内存在现行有效(sxx=3)/尚未生效(sxx=4)的版本时，
        已被取代的旧版(sxx=1 已废止 / sxx=2 已修改)删除——再要求两版正文相似度
        ≥ 0.5，避免把"同名但不同的文件"误删；
      * 正文逐字相同的，只留一条（优先现行版，其次公布日期新者）；
      * 正文差异大的同名文件（同名不同文，如历年《国务院关于修改和废止部分
        行政法规的决定》）全部保留。
    """
    groups = collections.defaultdict(list)
    for c in corpus:
        groups[_norm_key(c.get('title'))].append(c)

    drop = set()
    for key, items in groups.items():
        if not key or len(items) < 2:
            continue
        live = [c for c in items if c.get('sxx') in (3, 4)]
        dead = [c for c in items if c.get('sxx') in (1, 2)]
        if live and dead:
            for d in dead:
                if any(_body_sim(_flk_body(d), _flk_body(l)) >= 0.5 for l in live):
                    drop.add(d.get('bbbs'))
        # 正文逐字相同 → 只留一条
        bybody = collections.defaultdict(list)
        for c in items:
            b = _flk_body(c)
            if len(b) >= 50:
                bybody[b].append(c)
        for b, same in bybody.items():
            if len(same) < 2:
                continue
            same.sort(key=lambda c: (-(c.get('sxx') in (3, 4)), -(c.get('sxx') or 0),
                                      c.get('gbrq') or ''), reverse=True)
            for c in same[1:]:
                drop.add(c.get('bbbs'))
    if drop:
        print('  flk 同标题去重：再删除 %d 条（旧版/完全重复）' % len(drop))
    return [c for c in corpus if c.get('bbbs') not in drop]


def flk_version_tag(rec):
    """同标题多条时补的版本后缀，让列表里能一眼分清是哪一版。

    用「最后修订日」（没有则用通过/公布日），避免把首次通过日当成版本号。
    """
    day = rec.get('revised') or rec.get('adopted') or ''
    eff = rec.get('effective') or ''
    if not day:
        return ''
    if rec.get('effect') == '尚未生效':
        return '（%s 修订，%s 施行）' % (day, eff) if eff else '（%s 修订）' % day
    if rec.get('effect') in ('有效', '尚未生效'):
        return '（%s 修订）' % day
    return '（%s 公布）' % day


def _norm_key(s):
    """标题归一化键：去掉空白与标点，用于比对「同一部法规」。"""
    return re.sub(r'[\s　《》（）()、，,。.:：;；"\'“”‘’\[\]【】\-—_·・]+', '', s or '')


def _norm_body(s):
    """正文归一化：只留汉字/数字/字母，用于正文级比对。"""
    return re.sub(r'[^一-鿿0-9A-Za-z]', '', s or '')


def dedup_flk_versions(corpus):
    """同一部法规的多个历史版本只保留现行版本。

    flk 检索结果里，同一部法律会同时给出「现行有效」「尚未生效」以及若干历史版本，
    标题完全相同、只是正文不同（个别版本还可能是「修改决定」附件）。
    站点里表现为同标题多条 = 用户看到的「重复条目」。

    判定依据是 flk 的「修订沿革」字段 lsyg（历次版本的 bbbs 链）：
    沿革链上同一个簇即同一部法规的不同版本。
      * 簇内有现行有效(sxx=3)或尚未生效(sxx=4)的 → 只保留这些，历史版本删除；
      * 整簇都已失效 → 只留公布日期最新的一条。
    历史版本的信息不会丢：保留条目的 lsyg 里仍带着历次版本的标题与公布日期，
    详情页照常渲染「修订沿革」。
    """
    idx = {c.get('bbbs'): c for c in corpus if c.get('bbbs')}
    parent = {b: b for b in idx}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for bbbs, c in idx.items():
        for h in (c.get('lsyg') or []):
            hb = h.get('bbbs')
            if hb in idx:
                ra, rb = find(bbbs), find(hb)
                if ra != rb:
                    parent[ra] = rb

    groups = collections.defaultdict(list)
    for bbbs in idx:
        groups[find(bbbs)].append(bbbs)

    drop = set()
    for members in groups.values():
        if len(members) < 2:
            continue
        eff = [m for m in members if idx[m].get('sxx') == 3]
        fut = [m for m in members if idx[m].get('sxx') == 4]
        if eff or fut:
            keep = set(eff) | set(fut)
        else:
            keep = {sorted(members, key=lambda m: (idx[m].get('gbrq') or ''), reverse=True)[0]}
        for m in members:
            if m not in keep:
                drop.add(m)
    if drop:
        print('  flk 版本去重：删除历史版本 %d 条（沿革簇 %d 个）'
              % (len(drop), sum(1 for v in groups.values() if len(v) > 1)))
    return [c for c in corpus if c.get('bbbs') not in drop]


def dedup_party_records(records, flk_corpus=None):
    """清理党内法规内部的重复条目。

    1) 人民网「党章党规」书架与「组工文件 / 党务知识」栏目收录了同一篇法规，
       标题相同、正文基本一致，站点里表现为同标题多条。保留党内法规门类下那一份
       （门类更准确、正文更完整），其余删除。
    2) 跨源重复以国家法律法规库为准（正文比对确认是同一部法规后才删）：
       * 标题完全相同，且正文与国家库那份相似度 ≥ 0.8 → 删党内那份；
       * 标题去掉括号补充后与国家库某条法规同名，且党内这份明显更短
         （是公布消息/摘录而非法规本身）→ 删党内那份。
       正文实质不同的（如「参照《公务员法》管理的单位审批办法」与《公务员法》本身）
       两边都留。
    """
    flk_corpus = flk_corpus or []
    prio = ['dangzhang', 'zhunze', 'tiaoli', 'guiding', 'guize', 'banfa', 'xize',
            'guifanxing', 'zugong', 'dangwu', 'local']

    flk_by = collections.defaultdict(list)
    for c in flk_corpus:
        flk_by[_norm_key(c.get('title'))].append(c)

    def flk_body(c):
        return _norm_body('\n'.join([c.get('preamble') or ''] +
                                     [(s.get('name') or '') + (s.get('text') or '')
                                      for s in (c.get('sections') or [])]))

    def party_body(r):
        return _norm_body('\n'.join(s.get('text') or '' for s in (r.get('sections') or [])))

    groups = collections.defaultdict(list)
    for r in records:
        groups[_norm_key(r['title'])].append(r)

    drop = set()
    n_cross = 0

    # 1) 党内内部同标题
    #    同一部法规的多个来源/版本只留一条：
    #    ① 公布日期准确的优先（正文里有发文日期行）；
    #    ② 日期新的优先（现行版，而不是历史版本）；
    #    ③ 再按门类层级（党章/准则/条例…比组工文件更核心）与正文长度。
    for key, items in groups.items():
        if not key or len(items) < 2:
            continue
        items = sorted(items, key=lambda r: (
            -(r.get('dateExact') or 0),
            -int(re.sub(r'\D', '', (r.get('published') or ''))[:8] or 0),
            prio.index(r['cat']) if r['cat'] in prio else 99,
            -(r.get('chars') or 0)))
        for r in items[1:]:
            drop.add(r['id'])

    # 2) 跨源：以国家库为准
    for r in records:
        if r['id'] in drop:
            continue
        t = _norm_key(r['title'])
        cands = flk_by.get(t) or []
        pb = party_body(r)
        hit = False
        if cands:
            if not pb:
                hit = True                      # 党内这份是空正文
            else:
                for c in cands:
                    fb = flk_body(c)
                    if fb and _body_sim(pb, fb) >= 0.8:
                        hit = True              # 正文与国家库那份是同一部法规
                        break
        if not hit and r['cat'] in ('zugong', 'dangwu'):
            # 标题去掉括号补充后若与国家库某法规同名，且党内这份明显更短 → 是消息/摘录
            base = _norm_key(re.sub(r'[（(][^）)]*[）)]', '', r.get('title') or ''))
            for ft, fls in flk_by.items():
                if len(ft) >= 6 and ft == base:
                    fb = flk_body(fls[0])
                    if fb and len(pb) < len(fb) * 0.5:
                        hit = True
                    break
        if hit:
            drop.add(r['id'])
            n_cross += 1

    if drop:
        print('  党内法规去重：删除 %d 条（其中与国家库重复 %d 条）' % (len(drop), n_cross))
    return [r for r in records if r['id'] not in drop]


def guess_party_cat(title):
    """按标题后缀推断党内法规门类（12371 的「体系」页里有些条目不在门类页上）。"""
    t = title or ''
    for name, cid in (('准则', 'zhunze'), ('条例', 'tiaoli'), ('规定', 'guiding'),
                      ('办法', 'banfa'), ('规则', 'guize'), ('细则', 'xize')):
        if name in t:
            return cid
    return 'guifanxing'


def asset_fingerprint():
    """前端资源指纹（8 位十六进制）。

    覆盖 assets/css/style.css 与 assets/js/*.js。
    参与资源版本号计算：前端代码改动后版本号随之变化，
    浏览器不会继续用旧的 app.js / style.css（离线站点没有服务端兜底刷新）。
    """
    h = hashlib.md5()
    files = []
    css = os.path.join(ROOT, 'assets', 'css', 'style.css')
    if os.path.isfile(css):
        files.append(css)
    jsdir = os.path.join(ROOT, 'assets', 'js')
    if os.path.isdir(jsdir):
        for fn in sorted(os.listdir(jsdir)):
            if fn.endswith('.js'):
                files.append(os.path.join(jsdir, fn))
    for p in files:
        h.update(os.path.basename(p).encode('utf-8'))
        with open(p, 'rb') as f:
            h.update(f.read())
    return h.hexdigest()[:8]


def patch_index_versions(version):
    """把 index.html 里所有本地资源的 ?v= 统一刷成新版本号。

    分片标签由 patch_index_chunks / patch_index_hubei 负责，
    但 regulations.js、style.css 与 assets/js/*.js 的标签是手写的 ——
    数据重建后若不刷新，浏览器会命中旧缓存，页面还显示旧数据。
    """
    p = os.path.join(ROOT, 'index.html')
    s = open(p, encoding='utf-8').read()
    v = version.replace('-', '')

    def repl(m):
        return '%s="%s/%s?v=%s"' % (m.group(1), m.group(2), m.group(3), v)

    s2 = re.sub(r'(src|href)="(assets|data)/([^"?]+)\?v=[^"]*"', repl, s)
    if s2 != s:
        open(p, 'w', encoding='utf-8').write(s2)
        return True
    return False


def load_12371_corpus():
    """读取共产党员网「党章党规」专页的抓取缓存（tools/12371_cache/<sha1>.json）。"""
    cache = os.path.join(ROOT, 'tools', '12371_cache')
    out = []
    if not os.path.isdir(cache):
        return out
    for fn in sorted(os.listdir(cache)):
        if not fn.endswith('.json'):
            continue
        try:
            d = json.load(open(os.path.join(cache, fn), encoding='utf-8'))
        except Exception:
            continue
        d.pop('con_html', None)      # 原始 HTML 片段不入库
        out.append(d)
    return out


def build_12371_records(corpus):
    """把共产党员网的语料转成本站统一结构的记录。"""
    out = []
    for c in corpus:
        cat = X12371_CAT_ID.get(c.get('cat') or '')
        if not cat:
            cat = guess_party_cat(c.get('title') or '')
        sections = [{'name': s.get('name', ''), 'text': s.get('text', '')}
                    for s in (c.get('sections') or [])]
        if not any(s['text'].strip() for s in sections):
            continue
        # 正文是附件、页面上只剩目录的（如规划纲要、批复），没有可读正文，不入库
        if (c.get('bodyChars') or 0) < 100:
            continue
        out.append({
            'title': (c.get('title') or '').strip(),
            'rawTitle': (c.get('title') or '').strip(),
            'cat': cat,
            'sub': '',
            'summary': c.get('summary') or '',
            'webDate': c.get('webDate') or '',
            'url': c.get('url') or '',
            'sections': sections,
            'src': '共产党员网',
            'srcVersion': c.get('version') or '',
            'sys': c.get('sys') or [],
        })
    return out


def load_flk_corpus():
    """从抓取缓存读取 flk 语料（tools/flk_cache/<bbbs>.json）。"""
    cache = os.path.join(ROOT, 'tools', 'flk_cache')
    out = []
    if not os.path.isdir(cache):
        return out
    for fn in sorted(os.listdir(cache)):
        if not fn.endswith('.json'):
            continue
        try:
            out.append(json.load(open(os.path.join(cache, fn), encoding='utf-8')))
        except Exception:
            pass
    out = dedup_flk_versions(out)
    out = dedup_flk_same_title(out)
    return out


def main():
    raw = json.load(open(os.path.join(ROOT, 'tools', 'raw_corpus.json'), encoding='utf-8'))
    supp = json.load(open(os.path.join(ROOT, 'tools', 'supplement_final.json'), encoding='utf-8'))
    supp_by_title = {k: v for k, v in supp.items() if v}

    records = []
    seen_title = collections.Counter()

    for r in raw:
        if r.get('status') != 'ok':
            continue
        title = strip_title_prefix(r['title'])
        cat = r['category']
        shelf = r.get('shelf', '')
        if cat in CAT_ID_BY_NAME:
            cat_id = CAT_ID_BY_NAME[cat]
        elif cat in DAWU_SUBS:
            cat_id = 'dangwu'
        elif shelf == '组工文件':
            cat_id = 'zugong'
        else:
            cat_id = 'guifanxing'
        seen_title[title] += 1
        records.append({
            'title': title,
            'rawTitle': r['title'],
            'cat': cat_id,
            'sub': cat if cat not in CAT_ID_BY_NAME else '',
            'summary': r['summary'],
            'url': r['url'],
            'sections': [{'name': s['name'], 'text': s['text']} for s in r['sections']],
            'src': '人民网党建频道',
            'srcVersion': '',
        })

    # 补充抓取的部分（人民网侧为占位链接）
    for title, v in supp_by_title.items():
        text_lines = clean_chrome(v['text'].split('\n'))
        body = '\n'.join(text_lines)
        records.append({
            'title': title,
            'rawTitle': title,
            'cat': 'banfa',
            'sub': '',
            'summary': '',
            'url': v['url'],
            'sections': [{'name': '', 'text': body}],
            'src': '人民网党建频道',
            'srcVersion': '',
        })

    # 共产党员网「党章党规」专页：门类与人民网一致，内容互补（各有对方没有的条目），
    # 重合的按「同一部法规取公布日期最新的那一份」在去重阶段处理。
    x12371 = build_12371_records(load_12371_corpus())
    print('  共产党员网：%d 条待去重' % len(x12371))
    records.extend(x12371)

    # 整理字段
    out = []
    for i, rec in enumerate(records):
        title = rec['title']
        summary = rec['summary']
        full = '\n'.join(s['text'] for s in rec['sections'] if s['text'])
        adopted, effective, revised, revised_year = parse_dates(summary)
        issuer = guess_issuer(summary, title)
        tags = detect_tags(title, full)
        cat = CAT_BY_ID[rec['cat']]

        # 组工文件：分类名即年份；正文首段再兜底找发布日期
        if rec['cat'] == 'zugong' and rec['sub'].isdigit():
            revised_year = revised_year or int(rec['sub'])
            if not adopted:
                m = DATE_RE.search(full[:400])
                if m:
                    adopted = iso(m.groups())
                    revised = revised or adopted
        if rec['sub'] and rec['sub'] not in tags:
            tags = tags[:3] + [rec['sub']]

        year = revised_year or (int(adopted[:4]) if adopted else 0)
        # 现行版本公布日期（时间轴按它归组并显示）
        published = parse_party_published(summary, adopted, revised)
        # 共产党员网的「新闻通稿」体例文件正文里没有发文日期，用网页发布时间兜底
        if not published and rec.get('webDate'):
            published = rec['webDate']
        if published[:4].isdigit():
            year = int(published[:4])
        elif not published and year:
            published = str(year)      # 只有年份的组工文件，用年份占位
        out.append({
            'id': 'r%04d' % (i + 1),
            'title': title,
            'cat': rec['cat'],
            'catName': cat['name'],
            'level': cat['level'],
            'issuer': issuer,
            'adopted': adopted,
            'published': published,
            'revised': revised,
            'effective': effective,
            'year': year,
            'summary': summary or (full[:160] + ('…' if len(full) > 160 else '')),
            'tags': tags,
            'url': rec['url'],
            'source': rec.get('src') or '人民网党建频道',
            # dateExact=1 表示公布日期来自正文里的发文日期行（准确）；
            # 共产党员网的「新闻通稿」体例文件正文里没有日期，只能用网页发布时间兜底。
            'dateExact': 1 if (adopted or revised) else 0,
            'chars': len(full.replace(' ', '')),
            'sections': [{'name': clean_name(s.get('name')), 'text': normalize_clauses(s.get('text', '')),
                          'level': section_level(clean_name(s.get('name')))}
                         for s in rec['sections']],
        })

    # ---- 国家法律法规（flk）：先装载，跨源去重要以国家库为准 ----
    corpus = load_flk_corpus()

    # ---- 重复条目清理 ----
    # 党内法规内部：同一篇在「党章党规」与「组工文件/党务知识」各存一份；
    # 跨源：标题与国家库重复的，保留国家库那份（正文比对过才删）。
    out = dedup_party_records(out, corpus)

    # 去重后重新编号，保证 id 连续
    for i, r in enumerate(out):
        r['id'] = 'r%04d' % (i + 1)

    # 同名条目（多为「法规本身」与「印发消息」并存）加版本区分
    cnt = collections.Counter(r['title'] for r in out)
    for r in out:
        if cnt[r['title']] > 1:
            r['version'] = ('%d年版' % r['year']) if r['year'] else ''
            r['dup'] = cnt[r['title']]
        else:
            r['version'] = ''
            r['dup'] = 1

    total_chars = sum(r['chars'] for r in out)

    # ---- 国家法律法规（flk）：正文体积大，分片输出 ----
    flk_records = build_flk_records(corpus)
    chunks = write_flk_chunks(flk_records)
    flk_chars = sum(r['chars'] for r in flk_records)

    # ---- 湖北地方法规：单独分片 ----
    hub_corpus = load_hubei_corpus()
    hub_records = build_hubei_records(hub_corpus)
    hub_chunks = write_hubei_chunks(hub_records)
    hub_chars = sum(r['chars'] for r in hub_records)

    # ---- 党内法规正文单独成片 ----
    party_chunks = write_party_body(out)

    # ---- 元信息与正文分离 ----
    # 启动只需要元信息（标题/日期/门类/字数），正文（约 50MB）按需加载：
    # 打开详情页只加载该条目所在的那一个分片，检索才需要全部分片。
    # 低配机器上这一下把启动时的解析量从 52MB 降到 2MB 上下。
    body_files = [c[:-3] for c in (party_chunks + chunks + hub_chunks)]
    all_meta = []
    for r in out + flk_records + hub_records:
        m = dict(r)
        m.pop('sections', None)
        all_meta.append(m)

    payload = {
        'version': date.today().isoformat(),
        'source': '人民网党建频道 · 党章党规（dangjian.people.com.cn）· 共产党员网党章党规专页（12371.cn）',
        'note': '本离线库为个人学习与工作检索使用，条文以官方发布文本为准；如有出入，请以中央正式发布文件为准。',
        'categories': CATEGORIES,
        'groups': GROUPS,
        'records': all_meta,
        'bodyFiles': body_files,
    }
    # 版本号 = 日期 + 内容指纹：数据一变版本号就变，
    # 浏览器不会命中旧缓存（否则重建后还显示旧数据）。
    fingerprint = hashlib.md5(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:8]
    # 前端资源（assets/js/*.js、assets/css/style.css）也算进指纹：
    # 只跟数据挂钩时，改了 app.js 但数据没变 → 版本号不变 → 浏览器命中旧 app.js，
    # 页面看起来「改了没生效」。加上前端指纹后，任何一处改动都会刷新版本号。
    version = '%s-%s%s' % (payload['version'], fingerprint, asset_fingerprint())

    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    with open(os.path.join(ROOT, 'data', 'regulations.json'), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(ROOT, 'data', 'regulations.js'), 'w', encoding='utf-8') as f:
        f.write('/* 自动生成，请勿手工修改；由 tools/build_dataset.py 生成 */\n')
        f.write('window.FG_DATA = ')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')

    # 正文分片改成按需加载：index.html 里不再静态引入这些脚本
    patched = patch_index_chunks(chunks, version)

    # ---- index.html 里其余资源（regulations.js / css / js）的版本号也一起刷新 ----
    ver_patched = patch_index_versions(version)

    print('党内法规条目：', len(out))
    print('党内法规字数：', format(total_chars, ','))
    print('版本号：', version)
    print('index.html 资源版本号：', '已刷新' if ver_patched else '未找到可刷新的链接')
    print('分类分布：', dict(collections.Counter(r['catName'] for r in out)))
    print('带日期：', sum(1 for r in out if r['adopted']))
    print('重复标题：', {k: v for k, v in cnt.items() if v > 1})
    for r in out[:3]:
        print('\n样例:', r['id'], r['title'], '|', r['catName'], '|', r['issuer'],
              '|', r['adopted'], '|', r['tags'])

    print('\n国家法律法规条目：', len(flk_records))
    print('国家法律法规字数：', format(flk_chars, ','))
    print('flk 门类分布：', dict(collections.Counter(r['catName'] for r in flk_records)))
    print('分片：', len(chunks), '个 ->', ', '.join(chunks))
    for r in flk_records[:3]:
        print('\n样例:', r['id'], r['title'], '|', r['catName'], '|', r['issuer'],
              '|', r['adopted'], '|', r['effect'], '|', r['tags'])
    size = os.path.getsize(os.path.join(ROOT, 'data', 'regulations.js'))
    print('\ndata/regulations.js（启动必载·仅元信息）大小：', format(size, ','), 'bytes')
    body_total = 0
    for c in party_chunks + chunks + hub_chunks:
        body_total += os.path.getsize(os.path.join(ROOT, 'data', c))
    print('正文分片合计（按需加载）：', format(body_total, ','), 'bytes')
    print('index.html 静态分片标签：', '已清理' if patched else '本来就没有')

    print('\n湖北地方法规条目：', len(hub_records))
    print('湖北地方法规字数：', format(hub_chars, ','))
    print('湖北门类分布：', dict(collections.Counter(r['catName'] for r in hub_records)))
    print('湖北区域分布：', dict(collections.Counter(r['sub'] for r in hub_records)))
    print('分片：', len(hub_chunks), '个 ->', ', '.join(hub_chunks))
    for r in hub_records[:3]:
        print('\n样例:', r['id'], r['title'], '|', r['catName'], '|', r['sub'], '|', r['issuer'],
              '|', r['adopted'], '|', r['effective'], '|', r['summary'][:50])
    print('\n全库条目：', len(all_meta))


if __name__ == '__main__':
    main()
