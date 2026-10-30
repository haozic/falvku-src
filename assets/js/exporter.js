/* ==========================================================================
   exporter.js —— 导出器（Markdown / 纯文本 / JSON / CSV / 单文件 HTML / 打印）
   ========================================================================== */
(function (w) {
  'use strict';

  function escHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fullText(doc) {
    if (doc._text) return doc._text;
    if (doc.sections && doc.sections.length) {
      var out = [];
      for (var i = 0; i < doc.sections.length; i++) {
        if (doc.sections[i].text) out.push(doc.sections[i].text);
      }
      return out.join('\n');
    }
    return doc.text || '';
  }

  function sectionsOf(doc) {
    if (doc.sections && doc.sections.length) {
      /* 有标题的段落即使正文为空也要保留：
         「第二章 自然人」后面常常紧跟「第一节 …」，章本身没有正文，
         若按空正文过滤，目录里就会少掉这一级（正文反而「没有第X章」）。 */
      return doc.sections.filter(function (s) {
        return (s.text || '').trim() || (s.name || '').trim();
      });
    }
    return [{ name: '', text: fullText(doc) }];
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length === 3) return p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
    if (p.length === 2) return p[0] + '年' + parseInt(p[1], 10) + '月';
    if (p.length === 1 && /^\d{4}$/.test(p[0])) return p[0] + '年';
    return iso;
  }

  function num(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function metaLines(doc) {
    var rows = [];
    var isLaw = doc.source === '国家法律法规数据库';
    rows.push(['分类', doc.catName || doc.cat]);
    if (doc.sub) rows.push(['门类细分', doc.sub]);
    if (doc.version) rows.push(['版本', doc.version]);
    if (doc.flxz) rows.push(['效力级别', doc.flxz]);
    if (doc.effect) rows.push(['时效性', doc.effect]);
    rows.push(['制定/发布机关', doc.issuer || '—']);
    var pub = doc.published || '';
    if (pub) rows.push(['公布日期', fmtDate(pub)]);
    if (doc.adopted && doc.adopted !== pub) rows.push([isLaw ? '通过日期' : '首次通过', fmtDate(doc.adopted)]);
    if (doc.revised && doc.revised !== doc.adopted && doc.revised !== pub) rows.push(['最后修订', fmtDate(doc.revised)]);
    if (doc.effective) rows.push(['施行日期', fmtDate(doc.effective)]);
    rows.push(['正文篇幅', num(doc.chars || fullText(doc).replace(/\s/g, '').length) + ' 字']);
    if (doc.tags && doc.tags.length) rows.push(['主题标签', doc.tags.join('、')]);
    if (doc.url) rows.push(['原文链接', doc.url]);
    if (doc.source) rows.push(['数据来源', doc.source]);
    if (doc.custom) rows.push(['条目类型', '自建条目']);
    return rows;
  }

  /* ------------------------------------------------------------ 纯文本 */
  function toText(docs) {
    var out = [];
    (docs || []).forEach(function (doc, idx) {
      out.push('');
      out.push(new Array(40).join('='));
      out.push('【' + (idx + 1) + '】' + doc.title + (doc.version ? '（' + doc.version + '）' : ''));
      out.push(new Array(40).join('='));
      metaLines(doc).forEach(function (r) { out.push(r[0] + '：' + r[1]); });
      out.push('');
      if (doc.summary) { out.push('【摘要】' + doc.summary); out.push(''); }
      sectionsOf(doc).forEach(function (s) {
        if (s.name) { out.push('—— ' + s.name + ' ——'); out.push(''); }
        out.push(s.text);
        out.push('');
      });
    });
    return out.join('\n');
  }

  /* ---------------------------------------------------------- Markdown */
  function toMarkdown(docs) {
    var out = [];
    (docs || []).forEach(function (doc, idx) {
      if (idx > 0) out.push('\n\n---\n');
      out.push('# ' + doc.title + (doc.version ? '（' + doc.version + '）' : ''));
      out.push('');
      metaLines(doc).forEach(function (r) { out.push('- **' + r[0] + '**：' + r[1]); });
      out.push('');
      if (doc.summary) {
        out.push('> ' + doc.summary.replace(/\s+/g, ' '));
        out.push('');
      }
      sectionsOf(doc).forEach(function (s) {
        if (s.name) { out.push('## ' + s.name.replace(/\s+/g, ' ').trim()); out.push(''); }
        var first = true;
        s.text.split(/\n+/).forEach(function (line) {
          var t = line.trim();
          if (!t) return;
          // 跳过与章节名重复的首行
          if (first && s.name && t.replace(/\s/g, '') === s.name.replace(/\s/g, '')) { first = false; return; }
          first = false;
          out.push(t);
          out.push('');
        });
      });
    });
    return out.join('\n');
  }

  /* --------------------------------------------------------------- JSON */
  function toJSON(docs) {
    var list = (docs || []).map(function (doc) {
      return {
        id: doc.id,
        title: doc.title,
        version: doc.version || '',
        category: doc.catName || doc.cat,
        sub: doc.sub || '',
        flxz: doc.flxz || '',
        effect: doc.effect || '',
        issuer: doc.issuer || '',
        adopted: doc.adopted || '',
        published: doc.published || '',
        revised: doc.revised || '',
        effective: doc.effective || '',
        year: doc.year || 0,
        tags: doc.tags || [],
        summary: doc.summary || '',
        chars: doc.chars || 0,
        url: doc.url || '',
        source: doc.source || '',
        custom: !!doc.custom,
        sections: sectionsOf(doc).map(function (s) { return { name: s.name || '', text: s.text }; })
      };
    });
    return JSON.stringify({
      app: '法律法规库',
      exportedAt: new Date().toISOString(),
      count: list.length,
      records: list
    }, null, 2);
  }

  /* ---------------------------------------------------------------- CSV */
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(docs) {
    var head = ['标题', '版本', '分类', '门类细分', '效力级别', '时效性', '制定发布机关', '公布日期', '通过日期', '最后修订', '施行日期', '主题标签', '正文字数', '数据来源', '原文链接', '摘要'];
    var lines = [head.map(csvCell).join(',')];
    (docs || []).forEach(function (doc) {
      lines.push([
        doc.title, doc.version || '', doc.catName || doc.cat, doc.sub || '',
        doc.flxz || '', doc.effect || '', doc.issuer || '',
        fmtDate(doc.published), fmtDate(doc.adopted), fmtDate(doc.revised), fmtDate(doc.effective),
        (doc.tags || []).join('|'),
        doc.chars || 0, doc.source || '', doc.url || '', (doc.summary || '').replace(/\s+/g, ' ')
      ].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  /* --------------------------------------------------------------- HTML */
  function toHTML(docs) {
    var body = [];
    (docs || []).forEach(function (doc, idx) {
      if (idx > 0) body.push('<div class="page-break"></div>');
      body.push('<article class="doc">');
      body.push('<h1>' + escHtml(doc.title) + (doc.version ? '（' + escHtml(doc.version) + '）' : '') + '</h1>');
      body.push('<table class="meta">');
      metaLines(doc).forEach(function (r) {
        body.push('<tr><th>' + escHtml(r[0]) + '</th><td>' + escHtml(r[1]) + '</td></tr>');
      });
      body.push('</table>');
      if (doc.summary) body.push('<p class="summary">' + escHtml(doc.summary) + '</p>');
      sectionsOf(doc).forEach(function (s) {
        if (s.name) body.push('<h2>' + escHtml(s.name.replace(/\s+/g, ' ').trim()) + '</h2>');
        var first = true;
        s.text.split(/\n+/).forEach(function (line) {
          var t = line.trim();
          if (!t) return;
          if (first && s.name && t.replace(/\s/g, '') === s.name.replace(/\s/g, '')) { first = false; return; }
          first = false;
          if (/^(第[一二三四五六七八九十百]+[编章节]|总\s*纲|附\s*则|附件)/.test(t) && t.length < 46) {
            body.push('<h3>' + escHtml(t) + '</h3>');
          } else {
            body.push('<p>' + escHtml(t) + '</p>');
          }
        });
      });
      body.push('</article>');
    });

    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
      '<title>党内法规汇编</title>\n<style>\n' +
      'body{margin:0;padding:38px 46px;background:#fff;color:#16181d;' +
      'font-family:"Songti SC","SimSun","Noto Serif CJK SC",serif;font-size:15px;line-height:1.95;}\n' +
      '.doc{max-width:820px;margin:0 auto 34px;}\n' +
      'h1{font-size:25px;line-height:1.45;margin:0 0 16px;font-family:"Microsoft YaHei",sans-serif;}\n' +
      'h2{font-size:17px;margin:26px 0 12px;padding-left:10px;border-left:3px solid #c8102e;}\n' +
      'h3{font-size:15px;margin:18px 0 8px;font-family:"Microsoft YaHei",sans-serif;}\n' +
      'p{margin:0 0 9px;text-indent:2em;text-align:justify;}\n' +
      'table.meta{border-collapse:collapse;width:100%;margin:0 0 18px;font-family:"Microsoft YaHei",sans-serif;font-size:12.5px;}\n' +
      'table.meta th{text-align:left;padding:6px 12px 6px 0;color:#7b8496;font-weight:600;white-space:nowrap;vertical-align:top;width:120px;}\n' +
      'table.meta td{padding:6px 0;border-bottom:1px solid #eee;word-break:break-all;}\n' +
      'p.summary{background:#f6f7f9;border-left:3px solid #c8102e;padding:10px 14px;margin:0 0 18px;indent:0;text-indent:0;font-size:13px;color:#4b5464;}\n' +
      '.page-break{page-break-before:always;}\n' +
      '@media print{body{padding:0;}.page-break{page-break-before:always;}}\n' +
      '</style>\n</head>\n<body>\n' + body.join('\n') + '\n</body>\n</html>';
  }

  /* ------------------------------------------------------------ 下载 */
  function download(filename, content, mime) {
    try {
      var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1200);
      return true;
    } catch (e) {
      return false;
    }
  }

  function copyText(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function safeName(s) {
    return String(s).replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 80);
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function exportDocs(docs, format, scopeLabel) {
    if (!docs || !docs.length) return { ok: false, msg: '没有可导出的内容' };
    var base = scopeLabel ? safeName(scopeLabel) : '党内法规汇编';
    var name, content, mime;
    switch (format) {
      case 'md':
        name = base + '_' + stamp() + '.md';
        content = toMarkdown(docs);
        mime = 'text/markdown';
        break;
      case 'txt':
        name = base + '_' + stamp() + '.txt';
        content = toText(docs);
        mime = 'text/plain';
        break;
      case 'json':
        name = base + '_' + stamp() + '.json';
        content = toJSON(docs);
        mime = 'application/json';
        break;
      case 'csv':
        name = base + '_' + stamp() + '.csv';
        content = toCSV(docs);
        mime = 'text/csv';
        break;
      case 'html':
        name = base + '_' + stamp() + '.html';
        content = toHTML(docs);
        mime = 'text/html';
        break;
      default:
        return { ok: false, msg: '未知格式' };
    }
    var ok = download(name, content, mime);
    return { ok: ok, name: name, msg: ok ? '已导出 ' + name : '导出失败' };
  }

  w.Exporter = {
    toText: toText,
    toMarkdown: toMarkdown,
    toJSON: toJSON,
    toCSV: toCSV,
    toHTML: toHTML,
    download: download,
    copyText: copyText,
    exportDocs: exportDocs,
    safeName: safeName,
    fmtDate: fmtDate,
    fullText: fullText,
    sectionsOf: sectionsOf
  };
})(window);
