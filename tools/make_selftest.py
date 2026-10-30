# -*- coding: utf-8 -*-
"""生成 tools/selftest.html：在真实 index.html 基础上注入自检脚本。"""
import os, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(ROOT, 'index.html')
dst = os.path.join(ROOT, 'tools', 'selftest.html')

TEST = r"""
<script>
(function(){
  var out = [];
  function ok(name, cond, extra){ out.push((cond?'PASS':'FAIL')+' | '+name+(extra?(' :: '+extra):'')); }
  function has(text, sub){ return String(text).indexOf(sub) !== -1; }

  function run(){
    try{
      ok('FG_DATA 存在', !!window.FG_DATA);
      /* 元信息文件里是全库条目（正文另存在分片里），
         党内法规按 id 前缀 r 统计，flk 是 n、湖北是 h */
      var allN = window.FG_DATA ? window.FG_DATA.records.length : 0;
      var partyN = window.FG_DATA ? window.FG_DATA.records.filter(function(r){
        return String(r.id).charAt(0) === 'r';
      }).length : 0;
      var flkMetaN = window.FG_DATA ? window.FG_DATA.records.filter(function(r){
        return String(r.id).charAt(0) === 'n';
      }).length : 0;
      var hubMetaN = window.FG_DATA ? window.FG_DATA.records.filter(function(r){
        return String(r.id).charAt(0) === 'h';
      }).length : 0;
      // 精确总数由 tools/final_check.py 核对（每次重建都跑）；这里只做量级断言，
      // 否则每加一批数据就要改自检里的硬编码数字。
      ok('党内法规条目数在合理量级 (800~1200)', partyN >= 800 && partyN <= 1200, String(partyN));
      ok('全库元信息已入库 (三个源)', allN >= 2600 && flkMetaN > 1000 && hubMetaN > 400,
         '全库=' + allN + ' 党内=' + partyN + ' 国家库=' + flkMetaN + ' 湖北=' + hubMetaN);
      ok('正文分片清单存在', (window.FG_DATA.bodyFiles || []).length >= 10,
         '分片数=' + (window.FG_DATA.bodyFiles || []).length);
      // 共产党员网来源的条目确实入库了（第三个数据源）
      var srcCount = window.FG_DATA.records.filter(function(r){ return r.source === '共产党员网'; }).length;
      ok('共产党员网来源已入库', srcCount > 400, '条数=' + srcCount);
      var srcBad = window.FG_DATA.records.filter(function(r){
        return r.source === '共产党员网' && !r.sections.some(function(s){ return (s.text||'').length > 100; });
      }).length;
      ok('共产党员网条目正文非空', srcBad === 0, '空正文=' + srcBad);
      ok('门类定义含国家法律法规 4 类', ['xianfa','falv','xingzheng','jiancha'].every(function(id){
        return window.FG_DATA.categories.some(function(c){ return c.id === id; });
      }), String(window.FG_DATA.categories.length));
      ok('分组定义存在', !!(window.FG_DATA.groups && window.FG_DATA.groups.length), String((window.FG_DATA.groups||[]).length));

      var DATA = window.FGApp.mergeData();
      var flkN = DATA.records.length - partyN;
      ok('flk 分片已加载', flkN > 1000, 'flk=' + flkN);
      ok('合并后总条目数一致', DATA.records.length === partyN + flkN, String(DATA.records.length));

      var n = Search.init(DATA);
      ok('Search.init 建立索引', n === DATA.records.length, String(n));

      var r1 = Search.search('纪律处分', {pageSize:10});
      ok('检索「纪律处分」有结果', r1.total > 0, 'total=' + r1.total);
      ok('检索结果含《纪律处分条例》', r1.hits.some(function(h){ return h.doc.title.indexOf('纪律处分条例')>=0; }), r1.hits[0] ? r1.hits[0].doc.title : '');

      var r2 = Search.search('党内政治生活', {pageSize:5});
      ok('检索「党内政治生活」有结果', r2.total > 0, 'total=' + r2.total);

      var r3 = Search.search('发展党员', {sort:'new', pageSize:5});
      ok('排序 new 生效', r3.hits.length > 0 && (r3.hits[0].doc.year||0) >= (r3.hits[r3.hits.length-1].doc.year||0));

      var p = Search.parse('"党内监督" -试行 标题:条例');
      ok('解析短语', p.phrases.length===1 && p.phrases[0]==='党内监督', JSON.stringify(p.phrases));
      ok('解析排除词', p.exclude.length===1 && p.exclude[0]==='试行', JSON.stringify(p.exclude));
      ok('解析字段限定', p.scope==='title', p.scope);

      var sc = Search.search('条例', {scope:'title', pageSize:5});
      ok('限定标题字段检索', sc.total > 0 && sc.hits.every(function(h){ return h.doc.title.indexOf('条例')>=0; }), 'total=' + sc.total);

      var hl = Search.highlight('中国共产党纪律处分条例', ['纪律']);
      ok('高亮输出 <mark>', has(hl, '<mark>'), hl);

      var doc = Search.get('r0001');
      ok('r0001 为党章', !!doc && doc.catName==='党章', doc ? doc.catName : 'null');
      ok('党章有正文章节', !!doc && doc.sections.length > 0, doc ? String(doc.sections.length) : '');
      var t = (doc && doc.sections[0] && doc.sections[0].text) || '';
      ok('党章正文非空', t.length > 200, 'len=' + t.length);

      /* ---- 国家法律法规 ---- */
      var lawDocs = DATA.records.filter(function(x){ return x.cat==='falv' || x.cat==='xingzheng' || x.cat==='xianfa' || x.cat==='jiancha'; });
      ok('国家法律法规条目已入库', lawDocs.length > 1000, String(lawDocs.length));
      var noLaw = DATA.records.filter(function(x){ return x.cat==='dangzhang' || x.cat==='tiaoli' || x.cat==='guiding' || x.cat==='guifanxing'; });
      ok('党内法规仍在库', noLaw.length > 100, String(noLaw.length));
      var badCat = DATA.records.filter(function(x){ return !x.cat || x.cat === 'undefined'; });
      ok('无未分类条目', badCat.length === 0, String(badCat.length));
      var withText = lawDocs.filter(function(x){ return x.sections && x.sections.length && x.chars > 200; });
      ok('法律正文非空', withText.length > 1000, String(withText.length));
      var lawDoc = lawDocs.filter(function(x){ return x.chars > 1000; })[0];
      ok('法律条目有制定机关', !!(lawDoc && lawDoc.issuer), lawDoc ? lawDoc.issuer : 'null');
      ok('法律条目有公布日期', !!(lawDoc && lawDoc.adopted), lawDoc ? lawDoc.adopted : 'null');
      ok('法律条目有来源标记', !!(lawDoc && lawDoc.source === '国家法律法规数据库'), lawDoc ? lawDoc.source : 'null');
      ok('法律条目有时效性', !!(lawDoc && lawDoc.effect), lawDoc ? lawDoc.effect : 'null');
      ok('法律条目有门类细分', !!(lawDoc && lawDoc.sub), lawDoc ? lawDoc.sub : 'null');
      var noSummary = lawDocs.filter(function(x){ return !x.summary || x.summary.length < 10; });
      ok('法律摘要取正文首段', noSummary.length === 0, String(noSummary.length));
      var noSource = DATA.records.filter(function(x){ return !x.source; });
      ok('全部条目有数据来源', noSource.length === 0, String(noSource.length));

      /* ---- 湖北地方法规 ---- */
      var hubDocs = DATA.records.filter(function(x){ return x.cat==='dfg' || x.cat==='zxzd'; });
      ok('湖北地方法规已入库', hubDocs.length > 500, String(hubDocs.length));
      var hubNoText = hubDocs.filter(function(x){
        return !(x.sections||[]).length ||
               !x.sections.some(function(s){ return s.text && s.text.length > 10; });
      });
      ok('湖北条目正文非空', hubNoText.length === 0, String(hubNoText.length));
      var hubNoIssuer = hubDocs.filter(function(x){ return !x.issuer; });
      ok('湖北条目有制定机关', hubNoIssuer.length === 0, String(hubNoIssuer.length));
      var hubNoDate = hubDocs.filter(function(x){ return !x.adopted || !x.effective; });
      ok('湖北条目有通过与施行日期', hubNoDate.length === 0, String(hubNoDate.length));
      var hubNoSub = hubDocs.filter(function(x){ return !x.sub; });
      ok('湖北条目有区域细分', hubNoSub.length === 0, String(hubNoSub.length));
      var hubNoSummary = hubDocs.filter(function(x){ return !x.summary || x.summary.length < 10; });
      ok('湖北摘要取正文首条', hubNoSummary.length === 0, String(hubNoSummary.length));
      var hubNoSrc = hubDocs.filter(function(x){ return x.source !== '湖北法规库'; });
      ok('湖北条目来源标记正确', hubNoSrc.length === 0, String(hubNoSrc.length));
      var hubIds = {};
      var hubDup = 0;
      hubDocs.forEach(function(x){ if (hubIds[x.id]) hubDup++; hubIds[x.id] = 1; });
      ok('湖北条目 id 无重复', hubDup === 0, String(hubDup));

      /* ---- 重复条目清理 ---- */
      function nk(t){
        return String(t||'').replace(/[\s\u3000《》（）()、，,。.:：;；"'“”‘’\[\]【】\-—_·・]+/g, '');
      }
      var titleMap = {};
      var sameTitle = [];
      DATA.records.forEach(function(x){
        var k = nk(x.title);
        if (!k) return;
        if (titleMap[k]) sameTitle.push(x.title + ' ∕ ' + titleMap[k]);
        else titleMap[k] = x.title;
      });
      ok('全库无同标题重复条目', sameTitle.length === 0, sameTitle.length + ' 例: ' + sameTitle.slice(0,3).join(' | '));
      var partyDup2 = DATA.records.filter(function(x){
        return x.source === '人民网党建频道';
      }).filter(function(x, i, arr){
        return arr.findIndex(function(y){ return nk(y.title) === nk(x.title); }) !== i;
      });
      ok('党内法规内部无重复', partyDup2.length === 0, String(partyDup2.length));
      var crossDup = DATA.records.filter(function(x){ return nk(x.title) === nk('事业单位人事管理条例'); });
      ok('跨源重复以国家库为准（仅 1 条）', crossDup.length === 1 && crossDup[0].source === '国家法律法规数据库',
         crossDup.length + ' 条');
      var netSec = DATA.records.filter(function(x){ return nk(x.title) === nk('中华人民共和国网络安全法'); });
      ok('同一部法规的历史版本已去重（网络安全法 1 条）', netSec.length === 1, String(netSec.length));
      var agri = DATA.records.filter(function(x){ return nk(x.title).indexOf(nk('中华人民共和国农业法')) === 0; });
      ok('并存版本带版本后缀以便区分', agri.length >= 2 && agri.every(function(x){
        return /（[^）]+）$/.test(x.title);
      }), agri.length + ' 条: ' + agri.map(function(x){ return x.title; }).join(' | '));
      /* 湖北正文里的章标题不能是「正文没有的章」 */
      var hubPhantom = 0, hubPhantomEx = '';
      hubDocs.forEach(function(x){
        var names = (x.sections || []).filter(function(s){ return s.name; })
                      .map(function(s){ return s.name.replace(/\s+/g,''); });
        var set = {}, seen = {};
        names.forEach(function(n){ set[n] = (set[n] || 0) + 1; });
        names.forEach(function(n){
          seen[n] = (seen[n] || 0) + 1;
          if (seen[n] > set[n]) { hubPhantom++; if (!hubPhantomEx) hubPhantomEx = x.title + ' → ' + n; }
        });
      });
      ok('湖北条目无重复章标题', hubPhantom === 0, hubPhantom + (hubPhantomEx ? (' e.g. ' + hubPhantomEx) : ''));
      var hr = Search.search('历史文化名城', {cats:['dfg'], pageSize:10});
      ok('限定地方性法规门类检索', hr.total > 0 && hr.hits.every(function(h){ return h.doc.cat==='dfg'; }), 'total=' + hr.total);
      var hz = Search.search('环境保护', {cats:['zxzd'], pageSize:10});
      ok('自治条例单行条例可检索', hz.total > 0 && hz.hits.every(function(h){ return h.doc.cat==='zxzd'; }), 'total=' + hz.total);

      /* ---- 章节层级：目录只做两级，且目录条目必须与正文标题一致 ---- */
      var allSections = [];
      DATA.records.forEach(function(x){
        (x.sections || []).forEach(function(s){ if (s.name) allSections.push({doc:x, s:s}); });
      });
      ok('章节条目已入库', allSections.length > 500, String(allSections.length));
      var noLevel = allSections.filter(function(x){ return x.s.level !== 1 && x.s.level !== 2; });
      ok('章节层级已标注(1或2)', noLevel.length === 0, String(noLevel.length));
      var lv2 = allSections.filter(function(x){ return x.s.level === 2; });
      ok('存在二级(第X节)条目', lv2.length > 50, String(lv2.length));
      /* 目录里的条目不能是「正文没有的章」：同一文档内，标题名必须能在正文标题里找到 */
      var phantom = 0, phantomEx = '';
      DATA.records.forEach(function(x){
        var names = (x.sections || []).filter(function(s){ return s.name; })
                      .map(function(s){ return s.name.replace(/\s+/g,''); });
        if (!names.length) return;
        var set = {};
        names.forEach(function(n){ set[n] = (set[n] || 0) + 1; });
        var seen = {};
        names.forEach(function(n){
          seen[n] = (seen[n] || 0) + 1;
          if (seen[n] > set[n]) { phantom++; if (!phantomEx) phantomEx = x.title + ' → ' + n; }
        });
      });
      ok('无重复的「正文没有的章」', phantom === 0, phantom + (phantomEx ? (' e.g. ' + phantomEx) : ''));
      /* Word 原文预览已下线：全库不再有相关字段 */
      var withWord = DATA.records.filter(function(x){ return x.hasWord || x.wordChunk; });
      ok('全库已移除 Word 预览字段', withWord.length === 0, String(withWord.length));
      ok('页面不再引用 Word 预览分片', !window.FG_WORD);

      /* ---- 公布日期（published）：时间轴分组与显示日期必须同源 ---- */
      var pubBad = 0, pubEx = '';
      DATA.records.forEach(function (x) {
        var p = x.published || '';
        if (!p) return;
        var y = parseInt(String(p).slice(0, 4), 10);
        if (x.year && x.year !== y) {
          pubBad++;
          if (!pubEx) pubEx = x.title + ' year=' + x.year + ' published=' + p;
        }
      });
      ok('公布日期年份与条目 year 一致', pubBad === 0, pubBad + (pubEx ? (' e.g. ' + pubEx) : ''));
      var hubNoPub = DATA.records.filter(function(x){ return x.source === '湖北法规库' && !x.published; });
      ok('湖北条目均有公布日期', hubNoPub.length === 0, String(hubNoPub.length));
      var lawNoPub = DATA.records.filter(function(x){ return x.source === '国家法律法规数据库' && !x.published; });
      ok('国家法律法规公布日期基本齐全', lawNoPub.length <= 12, lawNoPub.length + ' 条缺 gbrq');
      var partyNoPub = DATA.records.filter(function(x){
        return x.source === '人民网党建频道' && !x.published && x.year;
      });
      ok('党内法规有年份必有公布日期', partyNoPub.length === 0, String(partyNoPub.length));

      var rl = Search.search('行政处罚', {pageSize:10});
      ok('检索「行政处罚」跨库命中', rl.total > 0, 'total=' + rl.total);
      var rl2 = Search.search('行政处罚', {cats:['falv'], pageSize:10});
      ok('限定法律门类检索', rl2.total > 0 && rl2.hits.every(function(h){ return h.doc.cat==='falv'; }), 'total=' + rl2.total);
      var rx = Search.search('村民委员会', {cats:['falv'], pageSize:5});
      ok('法律正文可检索到', rx.total > 0, 'total=' + rx.total);

      var md = Exporter.toMarkdown([doc]);
      ok('Markdown 导出', has(md, '# 中国共产党章程') && md.length > 500, 'len=' + md.length);
      var csv = Exporter.toCSV([doc]);
      ok('CSV 导出', has(csv, '标题') && csv.length > 100);
      var html = Exporter.toHTML([doc]);
      ok('HTML 导出', has(html, '<h1>中国共产党章程') && has(html, '</html>'), 'len=' + html.length);
      var js = Exporter.toJSON([doc]);
      ok('JSON 导出', has(js, '"records"'));
      if (lawDoc) {
        var ljs = Exporter.toJSON([lawDoc]);
        ok('法律导出含来源字段', has(ljs, '国家法律法规数据库'));
      }

      var f0 = Store.fav.count();
      Store.fav.toggle('r0001');
      ok('收藏切换', Store.fav.count() === f0+1 && Store.fav.has('r0001'));
      Store.fav.toggle('r0001');
      ok('取消收藏', Store.fav.count() === f0);

      var rec = Store.custom.save({title:'自检测试条目', cat:'guifanxing', issuer:'测试机关', adopted:'2024-01-01', text:'第一条 这是自检正文。', summary:'自检'});
      Search.addDoc(FGApp.normalizeCustom(rec));
      var cdoc = Search.get(rec.id);
      ok('自建条目入库', !!cdoc, rec.id);
      var r4 = Search.search('自检测试条目');
      ok('自建条目可被检索', r4.total === 1, 'total=' + r4.total);
      /* 重建索引（加载正文分片后 app.js 会这么做）不能把自建条目冲掉 */
      Search.init(FGApp.mergeData());
      FGApp.indexCustom();
      var r4b = Search.search('自检测试条目');
      ok('重建索引后自建条目仍在', r4b.total === 1, 'total=' + r4b.total);
      Store.custom.remove(rec.id);
      Search.removeDoc(rec.id);

      window.location.hash = '#/home';
      window.FGApp.route();
      var vEl = document.getElementById('view');
      var vh = vEl.innerHTML;
      ok('首页渲染', vh.length > 500, 'viewLen=' + vh.length);
      ok('首页为红金大幅横幅', has(vh, 'flk-hero'));
      ok('首页含国徽 SVG', has(vh, 'flk-emblem'));
      ok('首页含超大检索框', has(vh, 'flk-search'));
      ok('首页含检索范围下拉', has(vh, 'heroScope'));
      ok('首页含门类卡片矩阵', has(vh, 'flk-cat'));
      ok('首页含新法速递面板', has(vh, '新法速递'));
      ok('首页含全库门类面板', has(vh, '全库门类'));
      var cEl = document.getElementById('sideCats');
      /* 侧栏现在是「体系 → 门类」两级手风琴：体系树节点数 = 分组数，
         门类收在展开区里，默认折叠 */
      var treeHeads = document.querySelectorAll('#sideCats .tree-head');
      ok('侧栏法规体系树已生成', treeHeads.length >= 4, '体系数=' + treeHeads.length);
      var treeBodies = document.querySelectorAll('#sideCats .tree-body');
      var subLinks = document.querySelectorAll('#sideCats .tree-body a[data-cat]');
      ok('体系树含门类条目', subLinks.length >= window.FG_DATA.categories.length,
         '门类数=' + subLinks.length);
      ok('体系树默认折叠', treeBodies.length === treeHeads.length &&
         document.querySelectorAll('#sideCats .tree-body:not([hidden])').length === 0,
         '展开数=' + document.querySelectorAll('#sideCats .tree-body:not([hidden])').length);

      // 各路由渲染冒烟测试
      var routes = ['#/home','#/search?q=%E7%BA%AA%E5%BE%8B%E5%A4%84%E5%88%86','#/doc/r0001','#/browse/tiaoli',
                    '#/browse/falv','#/browse/dfg','#/group/guojia','#/group/dangnei','#/group/hubei',
                    '#/doc/h0001','#/favorites','#/custom','#/add',
                    '#/timeline','#/export','#/doc/r999999','#/browse','#/notes'];
      routes.forEach(function(r){
        window.location.hash = r;
        window.FGApp.route();
        var hh = document.getElementById('view').innerHTML;
        var bad = hh.indexOf('页面渲染出错') >= 0;
        var txt = bad ? document.getElementById('view').textContent.slice(0, 160) : '';
        ok('路由渲染 ' + r, hh.length > 50 && !bad, 'len=' + hh.length + (bad ? (' ERR ' + txt) : ''));
      });

      // 分类浏览总览（#/browse 不带门类参数）必须列出全部门类。
      // 早先这里空参数会回退到第一个门类，侧栏「分类浏览」点进去只看到「宪法」一部。
      window.location.hash = '#/browse';
      window.FGApp.route();
      var bIdx = document.querySelectorAll('#view .browse-groups .link-list li').length;
      var bGrp = document.querySelectorAll('#view .browse-groups .panel').length;
      ok('分类浏览总览列出全部门类', bIdx >= window.FG_DATA.categories.length && bGrp >= 4,
         '门类=' + bIdx + ' 体系面板=' + bGrp);
      ok('分类浏览总览不是单个门类的条目列表',
         document.querySelectorAll('#view .doc-list').length === 0);

      // 带查询词的检索路由必须真的出结果。
      // 只测 innerHTML 长度是假阳性：空结果页照样有一万多字符。
      window.location.hash = '#/search?q=' + encodeURIComponent('纪律处分');
      window.FGApp.route();
      var qcards = document.querySelectorAll('#view .result-card').length;
      var qcnt = document.querySelector('#view .result-count');
      var qn = qcnt ? parseInt(String(qcnt.textContent).replace(/[^0-9]/g, ''), 10) : 0;
      ok('检索路由真的出结果', qcards > 0 && qn > 0, 'cards=' + qcards + ' total=' + qn);
      // 收藏按钮用内联 SVG，不是 ★☆ 这类字符图标
      ok('收藏按钮使用 SVG 图标', document.querySelector('#view .fav-btn svg') !== null);

      // 详情页元信息（国家法律法规）
      if (lawDoc) {
        window.location.hash = '#/doc/' + lawDoc.id;
        window.FGApp.route();
        var dh = document.getElementById('view').innerHTML;
        ok('详情页显示效力级别', has(dh, '效力级别'));
        ok('详情页显示数据来源', has(dh, '国家法律法规数据库'));
        ok('详情页显示时效性', has(dh, '时效性'));
        ok('详情页正文按 Markdown 渲染', has(dh, 'md-p'));
      }

      /* 详情页元信息（湖北地方法规） */
      var hubDoc = hubDocs.filter(function(x){ return x.chars > 3000 && (x.sections||[]).length > 2; })[0]
                    || hubDocs[0];
      if (hubDoc) {
        window.location.hash = '#/doc/' + hubDoc.id;
        window.FGApp.route();
        var hh2 = document.getElementById('view').innerHTML;
        ok('湖北详情页显示数据来源', has(hh2, '湖北法规库'));
        ok('湖北详情页显示区域细分', has(hh2, hubDoc.sub));
        ok('湖北详情页正文按 Markdown 渲染', has(hh2, 'md-p'));
        ok('湖北详情页有目录', document.querySelectorAll('.toc a[data-anchor]').length > 0,
           'toc=' + document.querySelectorAll('.toc a[data-anchor]').length);
        var hsec = document.querySelectorAll('.article .sec-h').length;
        var htoc = document.querySelectorAll('.toc a[data-anchor]').length;
        ok('湖北目录条目与正文标题一致', htoc === hsec, 'toc=' + htoc + ' sec=' + hsec);
      }

      /* 目录两级结构：取二级条目最多的一部法规 */
      var lv2Doc = null, lv2Best = 0;
      for (var di = 0; di < DATA.records.length; di++) {
        var dr = DATA.records[di];
        var n2 = (dr.sections || []).filter(function(s){ return s.level === 2; }).length;
        if (n2 > lv2Best) { lv2Best = n2; lv2Doc = dr; }
      }
      if (lv2Doc) {
        window.location.hash = '#/doc/' + lv2Doc.id;
        window.FGApp.route();
        var l1 = document.querySelectorAll('.toc .toc-l1').length;
        var l2 = document.querySelectorAll('.toc .toc-l2').length;
        ok('目录渲染一级条目', l1 > 0, 'lv1=' + l1);
        ok('目录渲染二级条目', l2 > 0, 'lv2=' + l2);
        ok('二级条目嵌在二级列表里', document.querySelectorAll('.toc .toc-sub .toc-l2').length === l2);
        /* 目录条目数必须等于正文标题数（不能多也不能少） */
        var tocN = document.querySelectorAll('.toc a[data-anchor]').length;
        var secN = document.querySelectorAll('.article .sec-h').length;
        ok('目录条目与正文标题一致', tocN === secN, 'toc=' + tocN + ' sec=' + secN);
      }

      /* ---- 立法时间轴：分组年份与卡片显示日期必须一致 ---- */
      window.location.hash = '#/timeline';
      window.FGApp.route();
      var tlGroups = document.querySelectorAll('.tl-year');
      /* 时间轴改成「分批渲染」（低配机器上一次渲染 2,706 张卡片会卡死）：
         首屏只出一批，底部有「再显示更早的年份」按钮。 */
      ok('时间轴渲染出年份分组', tlGroups.length >= 1, 'groups=' + tlGroups.length);
      var tlMore = document.querySelector('#tlList ~ .list-more [data-more], .list-more [data-more="tl"]');
      ok('时间轴分批渲染（带「再显示」按钮）', !!tlMore, tlMore ? tlMore.textContent.trim() : '无按钮');
      var tlGroups0 = tlGroups.length;
      if (tlMore) {
        tlMore.click();
        var tlGroups1 = document.querySelectorAll('.tl-year').length;
        ok('时间轴可追加更早年份', tlGroups1 > tlGroups0, tlGroups0 + ' -> ' + tlGroups1);
      }
      // 卡片是 <a>：必须是 flex/block 盒模型，不能退回 inline（否则背景只画半截）
      var tlCard = document.querySelector('.tl-card');
      var tlDisp = tlCard ? getComputedStyle(tlCard).display : '';
      ok('时间轴卡片是 flex 盒模型', tlDisp.indexOf('flex') >= 0, 'display=' + tlDisp);
      // 轴线与卡片都不能被拉满全宽（980px 封顶，否则右侧空一大片）
      var tlItems = document.querySelector('.tl-items');
      var tlMax = tlItems ? parseInt(getComputedStyle(tlItems).maxWidth, 10) : 0;
      ok('时间轴整条收窄（max-width<=1000）', tlMax > 0 && tlMax <= 1000, 'max-width=' + tlMax + 'px');
      var tlBad = 0, tlEx = '', tlNoDate = 0;
      Array.prototype.forEach.call(tlGroups, function (g) {
        var h = g.querySelector('h3');
        var ym = h ? (h.textContent || '').match(/(\d{4})/) : null;
        if (!ym) return;
        var yy = ym[1];
        Array.prototype.forEach.call(g.querySelectorAll('.tl-card .mm'), function (m) {
          var parts = String(m.textContent || '').split('·');
          var last = (parts[parts.length - 1] || '').trim();
          var dm = last.match(/(\d{4})/);
          if (!dm) { tlNoDate++; return; }
          if (dm[1] !== yy) { tlBad++; if (!tlEx) tlEx = yy + ' 年组 → ' + last; }
        });
      });
      ok('时间轴分组年份与卡片日期一致', tlBad === 0, tlBad + (tlEx ? (' e.g. ' + tlEx) : ''));
      ok('时间轴每张卡片都带日期', tlNoDate === 0, '缺日期 ' + tlNoDate + ' 张');

      /* ---- Markdown 排版：法条首行缩进两字（不做悬挂缩进）/ 说明段独立样式 ---- */
      var mdDoc = DATA.records.filter(function(x){ return x.id === 'n1053' || x.id === 'n0002'; })[0] || lawDoc;
      if (mdDoc) {
        window.location.hash = '#/doc/' + mdDoc.id;
        window.FGApp.route();
        var clauses = document.querySelectorAll('.article p.md-clause');
        var nos = document.querySelectorAll('.article p.md-clause .md-no');
        ok('法条段使用 md-clause 样式', clauses.length > 0, 'clauses=' + clauses.length);
        ok('法条号逐条包裹为行内元素', nos.length === clauses.length,
           'no=' + nos.length + ' clauses=' + clauses.length);
        /* 正文用中文公文规范：首行缩进两字，不做悬挂缩进 */
        var indBad = 0, hangBad = 0, indEx = '';
        for (var ci = 0; ci < clauses.length; ci++) {
          var ccs = getComputedStyle(clauses[ci]);
          var ind = parseFloat(ccs.textIndent) || 0;
          var fs = parseFloat(ccs.fontSize) || 16;
          if (Math.abs(ind - fs * 2) > 1.5) { indBad++; if (!indEx) indEx = 'indent=' + ind.toFixed(1) + ' fs=' + fs; }
          if (parseFloat(ccs.paddingLeft) > 0.5) hangBad++;
        }
        ok('法条首行缩进两字（2em）', indBad === 0, '异常 ' + indBad + ' 段' + (indEx ? ' e.g. ' + indEx : ''));
        ok('法条无悬挂缩进（padding-left 为 0）', hangBad === 0, '异常 ' + hangBad + ' 段');
        /* 条号不得再是定宽块（悬挂缩进时代留下的 inline-block 宽度） */
        var noWide = 0;
        for (var ni = 0; ni < nos.length; ni++) {
          var ncs = getComputedStyle(nos[ni]);
          if (ncs.display === 'inline-block' && ncs.width !== 'auto') noWide++;
        }
        ok('法条号不是定宽块', noWide === 0, '定宽条号 ' + noWide + ' 个');
        ok('详情页已下线 Word 预览切换',
           document.querySelectorAll('#viewCtl, .view-ctl').length === 0,
           'ctl=' + document.querySelectorAll('#viewCtl, .view-ctl').length);
      }

      /* ---- 详情页布局：目录在正文右侧，正文居中，标题卡与正文卡对齐 ---- */
      var tocEl = document.querySelector('.toc');
      var artEl = document.querySelector('.article-box');
      var headEl = document.querySelector('.doc-head');
      if (tocEl && artEl && headEl) {
        var tr2 = tocEl.getBoundingClientRect();
        var ar2 = artEl.getBoundingClientRect();
        var hr2 = headEl.getBoundingClientRect();
        ok('目录排在正文右侧', tr2.left > ar2.left,
           'toc.left=' + Math.round(tr2.left) + ' article.left=' + Math.round(ar2.left));
        ok('标题卡与正文卡左边缘对齐', Math.abs(hr2.left - ar2.left) < 2,
           'head.left=' + Math.round(hr2.left) + ' article.left=' + Math.round(ar2.left));
        /* 正文应落在视口中央附近（目录在右会挤压正文，偏移要小） */
        var off = Math.abs((ar2.left + ar2.right) / 2 - window.innerWidth / 2);
        ok('正文居中（距视口中心 < 60px）', off < 60, '偏移 ' + Math.round(off) + 'px');
      }

      /* ---- 「导出本篇」必须直接导出，不能只跳转到导出中心 ---- */
      var expBtn = document.getElementById('expDocBtn');
      var expMenu = document.getElementById('expDocMenu');
      ok('详情页有「导出本篇」按钮', !!expBtn);
      ok('导出本篇提供格式菜单', !!expMenu && expMenu.querySelectorAll('button[data-fmt]').length >= 5,
         '项数=' + (expMenu ? expMenu.querySelectorAll('button[data-fmt]').length : 0));
      ok('导出本篇不是跳转链接',
         document.querySelectorAll('.doc-actions a[href*="scope=doc"]').length === 0);
      var noteDoc = DATA.records.filter(function(x){
        return (x.sections || []).some(function(s){
          return String(s.text || '').split(/\n+/).some(function (line) {
            var t = line.trim();
            return t.length > 6 && t.charAt(0) === '（' && /）[。；;]?$/.test(t);
          });
        });
      })[0];
      if (noteDoc) {
        window.location.hash = '#/doc/' + noteDoc.id;
        window.FGApp.route();
        var notes = document.querySelectorAll('.article p.md-note');
        ok('立法说明段使用独立样式', notes.length > 0, 'notes=' + notes.length + ' doc=' + noteDoc.id);
      }

      /* ---- 二级序号（一）（二）…：必须保留原文写法 ----
         早先 sectionMarkdown 把「（一）xxx」改写成 Markdown 列表项「- 一、xxx」：
         一是序号与原文对不上，二是渲染出来带一颗黑点（公文里的条目序号没有列表符号）。
         全库约 5.2 万行、1869 部法规走这条路径。 */
      var numDoc = DATA.records.filter(function (x) {
        return (x.sections || []).some(function (s) {
          return String(s.text || '').split(/\n+/).some(function (l) {
            return /^[（(][一二三四五六七八九十百零〇两\d]+[)）]/.test(l.trim());
          });
        });
      })[0];
      if (numDoc) {
        window.location.hash = '#/doc/' + numDoc.id;
        window.FGApp.route();
        var numRe = /^[（(][一二三四五六七八九十百零〇两\d]+[)）]/;
        var lis2 = document.querySelectorAll('.article .md-list li');
        var liWithNum = 0;
        for (var li2 = 0; li2 < lis2.length; li2++) {
          if (numRe.test((lis2[li2].textContent || '').trim())) liWithNum++;
        }
        ok('二级序号没有被渲染成列表项（无黑点）', liWithNum === 0,
           '列表项=' + lis2.length + ' 其中带序号=' + liWithNum + ' doc=' + numDoc.id);
        var subItems = 0, subBold = 0, subRaw = 0;
        var ps2 = document.querySelectorAll('.article p');
        for (var pi = 0; pi < ps2.length; pi++) {
          var tx = (ps2[pi].textContent || '').trim();
          if (!numRe.test(tx)) continue;
          subItems++;
          if (ps2[pi].querySelector('strong')) subBold++;
          /* 序号原文是「（一）」，不能被改成「一、」 */
          if (/^[（(][一二三四五六七八九十百零〇两\d]+[)）]/.test(tx)) subRaw++;
        }
        ok('二级序号保留原文写法', subItems > 0 && subItems === subRaw,
           '命中=' + subItems + ' 原文=' + subRaw + ' doc=' + numDoc.id);
        ok('二级序号已加粗', subItems > 0 && subItems === subBold,
           '命中=' + subItems + ' 加粗=' + subBold);
        /* 导出走数据层纯文本，必须仍是原文 */
        var txtNum = Exporter.fullText(numDoc);
        ok('导出正文保留原文序号',
           /^[（(][一二三四五六七八九十百零〇两\d]+[)）]/m.test(txtNum) &&
           txtNum.indexOf('- 一、') < 0);
      }

      /* ---- 阅读设置：背景 / 字号 / 行距 / 字体 / 版心（全局默认 + 单篇覆盖） ---- */
      var rdDocId = 'r0001';
      window.location.hash = '#/doc/' + rdDocId;
      window.FGApp.route();
      var layEl = document.getElementById('docLayout');
      var rdBtn = document.getElementById('readBtn');
      var rdPanel = document.getElementById('readPanel');
      ok('详情页有阅读设置容器', !!layEl);
      ok('详情页有「Aa」阅读设置按钮', !!rdBtn);
      ok('阅读设置面板默认收起', !!rdPanel && rdPanel.hidden === true);
      if (rdBtn && rdPanel && layEl) {
        rdBtn.click();
        ok('点「Aa」展开阅读设置面板', rdPanel.hidden === false);
        ok('阅读设置提供 6 种背景', rdPanel.querySelectorAll('.rp-theme').length === 6,
           'n=' + rdPanel.querySelectorAll('.rp-theme').length);
        ok('阅读设置含字号/行距/字体/版心四组',
           rdPanel.querySelectorAll('[data-rd-fs]').length === 2 &&
           rdPanel.querySelectorAll('[data-rd-lh]').length === 3 &&
           rdPanel.querySelectorAll('[data-rd-ff]').length === 3 &&
           rdPanel.querySelectorAll('[data-rd-width]').length === 3);
        ok('阅读设置有「本篇单独设置」开关', !!rdPanel.querySelector('#rpOnlyThis'));
        /* 切夜间主题：data-rd 必须落在 .doc-layout 上（正文卡/标题卡/目录卡一起变） */
        var nightBtn = rdPanel.querySelector('[data-rd-theme="night"]');
        if (nightBtn) {
          nightBtn.click();
          var lay2 = document.getElementById('docLayout');
          ok('阅读背景写在 .doc-layout 上', lay2.getAttribute('data-rd') === 'night',
             'data-rd=' + lay2.getAttribute('data-rd'));
          var abox = document.querySelector('.article-box');
          var abg = abox ? getComputedStyle(abox).backgroundColor : '';
          ok('夜间阅读背景真的生效', abg === 'rgb(28, 32, 39)', 'bg=' + abg);
          var artEl2 = document.querySelector('.article');
          var aink = artEl2 ? getComputedStyle(artEl2).color : '';
          ok('夜间阅读正文转为浅色字', aink === 'rgb(217, 222, 230)', 'color=' + aink);
        }
        /* 字号：A+ 把正文字号调大 1px */
        var artNow = document.querySelector('.article');
        var fs0 = artNow ? parseFloat(getComputedStyle(artNow).fontSize) : 0;
        var curFs = parseFloat(Store.settings.get('fontSize')) || 17;
        var fsUp = document.getElementById('readPanel').querySelector('[data-rd-fs="' + (curFs + 1) + '"]');
        if (fsUp) fsUp.click();
        var artNow2 = document.querySelector('.article');
        var fs1 = artNow2 ? parseFloat(getComputedStyle(artNow2).fontSize) : 0;
        ok('字号 A+ 生效', fs1 > fs0, fs0 + ' -> ' + fs1);
        /* 单篇覆盖：勾上「本篇单独设置」再改主题 → readPerDoc 里出现本篇 */
        var only = document.getElementById('rpOnlyThis');
        if (only) {
          only.checked = true;
          only.dispatchEvent(new Event('change', { bubbles: true }));
          var per = Store.settings.get('readPerDoc') || {};
          ok('勾选后本篇进入覆盖模式', !!per[rdDocId], JSON.stringify(Object.keys(per)));
          var greenBtn = document.getElementById('readPanel').querySelector('[data-rd-theme="green"]');
          if (greenBtn) greenBtn.click();
          var per2 = Store.settings.get('readPerDoc') || {};
          ok('单篇覆盖只影响本篇', !!(per2[rdDocId] && per2[rdDocId].theme === 'green'),
             JSON.stringify(per2[rdDocId] || null));
          ok('单篇覆盖不改动全局默认', Store.settings.get('readTheme') === 'night',
             'global=' + Store.settings.get('readTheme'));
          var only2 = document.getElementById('rpOnlyThis');
          if (only2) {
            only2.checked = false;
            only2.dispatchEvent(new Event('change', { bubbles: true }));
            var per3 = Store.settings.get('readPerDoc') || {};
            ok('取消勾选后清除本篇覆盖', !per3[rdDocId], JSON.stringify(Object.keys(per3)));
          }
        }
      }
      /* 还原全局阅读设置，别把测试态留在用户浏览器里 */
      Store.settings.set('readTheme', 'paper');
      Store.settings.set('fontSize', 17);
      Store.settings.set('readLh', 2.02);
      Store.settings.set('readFf', 'serif');
      Store.settings.set('readWidth', 'normal');

      /* ---- 划线与批注：存取、铺回正文、抽屉、我的笔记页 ---- */
      var mk0 = Store.marks.count();
      var mk = Store.marks.add(rdDocId, { s: 0, e: 0, t: '中国共产党', c: 'yellow', n: '自检批注' });
      ok('划线写入本地存储', Store.marks.count() === mk0 + 1 && !!mk.id,
         'count=' + Store.marks.count());
      window.location.hash = '#/doc/' + rdDocId;
      window.FGApp.route();
      var hls = document.querySelectorAll('.article mark.fg-hl');
      ok('划线铺回正文', hls.length >= 1, 'n=' + hls.length);
      ok('划线文字与原文一致', hls.length >= 1 && hls[0].textContent.indexOf('中国共产党') === 0,
         hls.length ? hls[0].textContent.slice(0, 16) : '');
      ok('划线没有嵌套（重复包裹）',
         document.querySelectorAll('.article mark.fg-hl mark.fg-hl').length === 0);
      ok('有批注的划线带标记',
         document.querySelectorAll('.article mark.fg-hl[data-has-note]').length >= 1);
      ok('详情页有笔记抽屉', !!document.getElementById('markDrawer'));
      ok('笔记抽屉列出本文划线', document.querySelectorAll('#markDrawer .md-item').length >= 1);
      /* 浮层必须真的贴在划线上，并且滚动时跟着划线一起走。
         踩过的坑：入场动画 fill-mode 用 both 会让 .doc-layout 的 transform
         停在 matrix(1,0,0,1,0,0)，非 none 的 transform 会劫持 position:fixed
         的包含块 —— 批注框会偏出整整一个文档高度，看上去「框没跟着文本」。 */
      var layCS = getComputedStyle(document.getElementById('docLayout'));
      ok('详情页入场动画不用 forwards/both 填充（否则残留 transform 会劫持 fixed 浮层）',
         layCS.animationFillMode !== 'both' && layCS.animationFillMode !== 'forwards',
         'fill=' + layCS.animationFillMode);
      var hl = document.querySelector('.article mark.fg-hl');
      if (hl) {
        hl.click();
        var edt = document.getElementById('markEdit');
        var mr = hl.getBoundingClientRect();
        var er = edt.getBoundingClientRect();
        /* 框要么贴在划线正上方，要么在正下方（划线太靠上时改放下方） */
        var above = Math.abs((mr.top - 10) - er.bottom) < 6;
        var below = Math.abs((mr.bottom + 10) - er.top) < 6;
        ok('批注框贴着划线', edt.hidden === false && (above || below),
           'above=' + above + ' below=' + below +
           ' mark.top=' + Math.round(mr.top) + ' edt.top=' + Math.round(er.top) +
           ' edt.bottom=' + Math.round(er.bottom));
        ok('批注框与划线左对齐', Math.abs(mr.left - er.left) < 6,
           'mark.left=' + Math.round(mr.left) + ' edt.left=' + Math.round(er.left));
        /* 滚动 300px：框必须与划线同步位移 */
        var beforeM = mr.top, beforeE = er.top;
        window.scrollBy(0, 300);
        var mr2 = hl.getBoundingClientRect();
        var er2 = edt.getBoundingClientRect();
        var dM = mr2.top - beforeM, dE = er2.top - beforeE;
        ok('滚动时批注框跟着划线一起移动', Math.abs(dM - dE) < 3,
           '划线位移=' + dM.toFixed(1) + ' 框位移=' + dE.toFixed(1));
        window.scrollBy(0, -300);
      }
      window.FGApp.refreshCounts();
      ok('侧栏笔记计数同步',
         document.getElementById('marksCountSide').textContent === String(Store.marks.count()),
         '侧栏=' + document.getElementById('marksCountSide').textContent +
         ' 实际=' + Store.marks.count());
      /* 我的笔记页 */
      window.location.hash = '#/notes';
      window.FGApp.route();
      ok('我的笔记页渲染', document.querySelectorAll('#view .notes-group').length >= 1);
      ok('我的笔记页列出划线', document.querySelectorAll('#view .ni-t').length >= 1);
      ok('完整备份含划线数据',
         !!(Store.exportAll().marks && Store.exportAll().marks[rdDocId]));
      Store.marks.clearDoc(rdDocId);
      ok('划线可清除', Store.marks.count() === mk0, 'count=' + Store.marks.count());

      // 检索结果卡片徽章
      window.location.hash = '#/search?q=' + encodeURIComponent('中华人民共和国');
      window.FGApp.route();
      var sh = document.getElementById('view').innerHTML;
      ok('检索结果显示时效性徽章', has(sh, 'tag-ok') || has(sh, 'tag-warn'));
      ok('检索结果显示门类细分徽章', has(sh, 'tag-line'));
      window.location.hash = '#/home';
      window.FGApp.route();

      // Chrome 69 兼容性静态扫描（异步）
      var banned = [
        { re: /\?\.[a-zA-Z_([]/, name: '可选链 ?.' },
        { re: /[^?]\?\?[^?]/, name: '空值合并 ??' },
        { re: /\.replaceAll\(/, name: 'String.replaceAll' },
        { re: /Object\.fromEntries/, name: 'Object.fromEntries' },
        { re: /\.matchAll\(/, name: 'String.matchAll' },
        { re: /structuredClone/, name: 'structuredClone' },
        { re: /\bglobalThis\b/, name: 'globalThis' },
        { re: /allSettled/, name: 'Promise.allSettled' }
      ];
      var cssBanned = ['gap:', 'clamp(', ':is(', ':where(', 'aspect-ratio', 'backdrop-filter', 'inset:'];
      var files = ['assets/js/store.js', 'assets/js/search.js', 'assets/js/exporter.js',
                   'assets/js/markdown.js', 'assets/js/app.js', 'assets/css/style.css'];
      Promise.all(files.map(function (f) {
        return fetch(f + '?compat=' + Date.now()).then(function (r) { return r.text(); });
      })).then(function (srcs) {
        var hits = [];
        srcs.forEach(function (src, i) {
          var code = files[i].indexOf('.css') >= 0 ? src.replace(/\/\*[\s\S]*?\*\//g, '') : src;
          banned.forEach(function (b) { if (b.re.test(code)) hits.push(files[i] + ' -> ' + b.name); });
          if (files[i].indexOf('.css') >= 0) {
            cssBanned.forEach(function (c) {
              if (code.indexOf(c) >= 0) hits.push(files[i] + ' -> CSS ' + c);
            });
          }
        });
        out.push((hits.length ? 'FAIL' : 'PASS') + ' | Chrome 69 兼容性静态扫描 :: ' +
          (hits.length ? hits.join(' / ') : '未发现不兼容特性'));
        /* 入场动画的 fill-mode 检查（读 CSS 源码，不依赖动画时序）：
           forwards/both 会把最后一帧的 transform 留在元素上，
           Chrome 把它算成 matrix(1,0,0,1,0,0)，而任何非 none 的 transform
           都会成为 position:fixed 后代的包含块 —— 浮层会被劫持成相对文档定位。 */
        var cssSrc = '';
        srcs.forEach(function (src, i) { if (files[i].indexOf('.css') >= 0) cssSrc = src; });
        var animRule = cssSrc.match(/animation:\s*fgEnter[^;}]*/);
        var badFill = animRule && /both|forwards/.test(animRule[0]);
        out.push((badFill ? 'FAIL' : 'PASS') +
          ' | 入场动画不用 forwards/both 填充（否则残留 transform 劫持 fixed 浮层） :: ' +
          (animRule ? animRule[0].trim() : '未找到 fgEnter 规则'));
        flush();
      }).catch(function (e) {
        out.push('FAIL | Chrome 69 兼容性静态扫描 :: ' + e.message);
        flush();
      }).then(function () {
        /* 划线浮条必须相对视口定位：包含块一旦被 transform 劫持，
           内联 top 是对的、渲染位置却会偏出整页高度（框不跟着文本跑）。
           浮条现在挂在 #view 下（不在 .doc-layout 里），所以这条与动画时序无关。 */
        return new Promise(function (resolve) {
          /* 切到详情页：先改 hash，等 hashchange 的那次 route() 跑完再渲染一次，
             避免测到的是已被替换的旧 DOM。 */
          window.location.hash = '#/doc/r0001';
          setTimeout(function () {
            window.FGApp.route();
            setTimeout(function () {
              var art = document.getElementById('article');
              var p = art ? art.querySelector('p.md-clause') : null;
              if (!p) { resolve(); return; }
              p.scrollIntoView({ block: 'center' });
              var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false);
              var n, tn = null;
              while ((n = walker.nextNode())) { if (n.nodeValue.length > 10) { tn = n; break; } }
              if (!tn) { resolve(); return; }
              var rg = document.createRange();
              rg.setStart(tn, 0); rg.setEnd(tn, Math.min(12, tn.nodeValue.length));
              var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
              art.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              setTimeout(function () {
                var tip = document.getElementById('markTip');
                var okTip = false, extra = 'no-tip';
                if (tip && !tip.hidden && tip.style.top) {
                  var r = tip.getBoundingClientRect();
                  var st = parseFloat(tip.style.top);
                  okTip = Math.abs(r.top - st) < 2;
                  extra = ' rect.top=' + Math.round(r.top) + ' style.top=' + tip.style.top;
                }
                out.push((okTip ? 'PASS' : 'FAIL') +
                  ' | 划线浮条相对视口定位（包含块未被劫持） ::' + extra);
                resolve();
              }, 250);
            }, 250);
          }, 150);
        });
      }).then(function () { flush(); }).catch(function (e) {
        out.push('FAIL | 浮层包含块检查 :: ' + e.message);
        flush();
      });
    } catch (e) {
      out.push('ERROR | ' + (e && e.stack ? e.stack : e));
    }
    flush();
  }

  function flush() {
    var pre = document.getElementById('testout');
    if (!pre) { pre = document.createElement('pre'); pre.id = 'testout'; document.body.appendChild(pre); }
    pre.textContent = 'TESTS\n' + out.join('\n') + '\nSUMMARY pass=' +
      out.filter(function (x) { return x.indexOf('PASS') === 0; }).length +
      ' fail=' + out.filter(function (x) { return x.indexOf('FAIL') === 0; }).length +
      ' error=' + out.filter(function (x) { return x.indexOf('ERROR') === 0; }).length;
  }

  /* Markdown 排版与时间轴的 DOM 级断言已并入 run()；
     这里不再需要异步加载 Word 预览分片。 */

  /* 正文分片是按需加载的（启动只载元信息），所以先把全部分片挂上来，
     断言才有完整正文可查（检索命中数、章节数、正文非空都依赖它）。 */
  window.addEventListener('load', function () {
    setTimeout(function () {
      var files = (window.FG_DATA && window.FG_DATA.bodyFiles) || [];
      if (!window.FGApp || !files.length) { run(); return; }
      window.FGApp.ensureBodies(files, function () {
        try { Search.init(window.FGApp.mergeData()); } catch (e) { }
        run();
      });
    }, 400);
  });
})();
</script>
"""

html = io.open(src, encoding='utf-8').read()
# 自检页使用独立缓存标识，避免读到旧版脚本
stamp = str(int(__import__('time').time()))
base = __import__('sys').argv[1] if len(__import__('sys').argv) > 1 else '/'
out = __import__('sys').argv[2] if len(__import__('sys').argv) > 2 else dst
html = html.replace('<head>', '<head>\n<base href="%s">' % base, 1)
html = html.replace('<title>', '<title>[SELFTEST] ')
html = html.replace('.js?v=', '.js?vt=').replace('.css?v=', '.css?vt=').replace('?vt=20261028', '?vt=test' + stamp)
html = html.replace('</body>', TEST + '\n</body>')
io.open(out, 'w', encoding='utf-8').write(html)
print('written', out)
