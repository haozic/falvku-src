/* 轻量 Markdown 渲染器（无第三方依赖，兼容 Chrome 69）。
 *
 * 用法：FGMarkdown.render(src, { hl: function(text){ return html; } })
 *   hl 用于给纯文本片段加检索高亮；不传则原样转义输出。
 *
 * 支持：ATX 标题、无序/有序列表、引用、围栏代码、水平线、GFM 表格、
 *       段落内的 **粗体** / *斜体* / `代码` / ~~删除~~ / [链接](url)。
 */
(function (w) {
  'use strict';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 行内解析：文本片段交给 hl，其余按 Markdown 规则转成 HTML */
  var INLINE_RE = new RegExp(
    '(`+)([\\s\\S]*?)\\1' +              // 行内代码
    '|\\*\\*([\\s\\S]+?)\\*\\*' +        // 粗体
    '|\\*([^*\\n]+?)\\*' +              // 斜体
    '|~~([\\s\\S]+?)~~' +               // 删除线
    '|\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+"[^"]*")?\\)' + // 链接
    '|\\\\([\\\\`*_{}\\[\\]()#+\\-.!])' + // 转义
    'g');

  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^(javascript|vbscript|data):/i.test(u)) return '';
    return u;
  }

  function inline(s, hl) {
    s = String(s === null || s === undefined ? '' : s);
    /* 递归调用（粗体里再解析行内）会打乱全局正则的 lastIndex，这里每次用独立实例 */
    var re = new RegExp(INLINE_RE.source, 'g');
    var out = '', last = 0, m;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) out += hl(s.slice(last, m.index));
      if (m[2] !== undefined) {                 // 行内代码
        out += '<code>' + esc(m[2]) + '</code>';
      } else if (m[3] !== undefined) {          // 粗体
        out += '<strong>' + inline(m[3], hl) + '</strong>';
      } else if (m[4] !== undefined) {          // 斜体
        out += '<em>' + inline(m[4], hl) + '</em>';
      } else if (m[5] !== undefined) {          // 删除线
        out += '<del>' + inline(m[5], hl) + '</del>';
      } else if (m[6] !== undefined) {          // 链接
        var url = safeUrl(m[7]);
        out += url ? '<a href="' + esc(url) + '" rel="noreferrer">' + inline(m[6], hl) + '</a>'
                   : inline(m[6], hl);
      } else if (m[8] !== undefined) {          // 转义
        out += esc(m[8]);
      }
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < s.length) out += hl(s.slice(last));
    return out;
  }

  function isBlank(s) { return !String(s || '').trim(); }

  /* 法条段：**第X条** 开头。条号加粗，正文按中文公文规范首行缩进两字。 */
  var CLAUSE_RE = /^\*\*(第[一二三四五六七八九十百零〇两]+条)\*\*/;

  /* 说明段：以「（」起、「）」止的立法说明 / 沿革说明。
     湖北法规库用的是半角括号，人民网站用全角，两种都要认。 */
  var NOTE_RE = /^[（(][\s\S]{16,}[）)][。；;]?$/;

  function paraKind(raw) {
    var t = String(raw || '').trim();
    if (CLAUSE_RE.test(t)) return 'clause';
    if (NOTE_RE.test(t)) return 'note';
    return '';
  }

  function renderPara(raw, hl) {
    var t = String(raw === null || raw === undefined ? '' : raw);
    var kind = paraKind(t);
    var cls = 'md-p' + (kind ? ' md-' + kind : '');
    var m = CLAUSE_RE.exec(t.trim());
    if (m) {
      var rest = t.trim().slice(m[0].length);
      return '<p class="' + cls + '"><span class="md-no">' + hl(m[1]) + '</span>' +
             inline(rest, hl) + '</p>';
    }
    return '<p class="' + cls + '">' + inline(t, hl) + '</p>';
  }

  function startsBlock(s) {
    return /^\s{0,3}(#{1,6}\s|>|```|~~~|\*\s|-\s|\+\s|\d+[.)]\s)/.test(s) ||
           /^\s*([-*_])\s*(\1\s*){2,}$/.test(s);
  }

  function render(src, opts) {
    opts = opts || {};
    var hl = opts.hl || function (t) { return esc(t); };
    var lines = String(src === null || src === undefined ? '' : src)
      .replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      /* 围栏代码 */
      var fence = /^\s*(```|~~~)\s*([\w-]*)\s*$/.exec(line);
      if (fence) {
        var mark = fence[1], buf = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + mark).test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        i++;
        out.push('<pre class="md-pre"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      /* 水平线 */
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { out.push('<hr class="md-hr">'); i++; continue; }

      /* 标题 */
      var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) {
        var lv = h[1].length;
        out.push('<h' + lv + ' class="md-h md-h' + lv + '">' + inline(h[2], hl) + '</h' + lv + '>');
        i++;
        continue;
      }

      /* 引用 */
      if (/^\s*>/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote class="md-quote">' + render(q.join('\n'), opts) + '</blockquote>');
        continue;
      }

      /* 表格：| a | b |  +  | --- | --- | */
      if (line.indexOf('|') >= 0 && i + 1 < lines.length &&
          /^\s*\|?[\s:\-|]+\|[\s:\-|]*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        var head = splitRow(line);
        var align = splitRow(lines[i + 1]).map(function (c) {
          var l = c.charAt(0) === ':', r = c.charAt(c.length - 1) === ':';
          return l && r ? 'center' : (r ? 'right' : (l ? 'left' : ''));
        });
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && !isBlank(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var th = '<tr>' + head.map(function (c, k) {
          return '<th' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' +
                 inline(c, hl) + '</th>';
        }).join('') + '</tr>';
        var tb = rows.map(function (r) {
          return '<tr>' + r.map(function (c, k) {
            return '<td' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' +
                   inline(c, hl) + '</td>';
          }).join('') + '</tr>';
        }).join('');
        out.push('<div class="md-tablewrap"><table class="md-table"><thead>' + th +
                 '</thead><tbody>' + tb + '</tbody></table></div>');
        continue;
      }

      /* 列表（支持一层缩进子列表） */
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        var html = renderList(lines, i, hl, opts);
        out.push(html.html);
        i = html.next;
        continue;
      }

      /* 段落 */
      var para = [];
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      if (para.length) out.push(renderPara(para.join('\n'), hl));
      else { i++; }
    }
    return out.join('');
  }

  function splitRow(s) {
    s = String(s || '').trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    var cells = [], cur = '';
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
      if (s.charAt(i) === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += s.charAt(i);
    }
    cells.push(cur.trim());
    return cells;
  }

  function renderList(lines, start, hl, opts) {
    var items = [];       // {ordered:bool, text:string, sub:[]}
    var i = start;
    var ordered = /^\s*\d+[.)]\s+/.test(lines[i]);
    while (i < lines.length) {
      var line = lines[i];
      if (isBlank(line)) {
        /* 空行后若还是列表则继续，否则结束 */
        var j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[j])) { i = j; continue; }
        break;
      }
      var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (!m) break;
      var indent = m[1].replace(/\t/g, '  ').length;
      var cur = items;
      var lvl = 0;
      while (indent >= 2 && cur.length) {
        var last = cur[cur.length - 1];
        if (!last.sub) { last.sub = []; }
        cur = last.sub;
        lvl++;
        indent -= 2;
      }
      cur.push({ text: m[3], sub: [] });
      i++;
      /* 同一列表项的续行（缩进但不是新项） */
      while (i < lines.length && !isBlank(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items[items.length - 1].text += ' ' + lines[i].trim();
        i++;
      }
    }
    function build(list, ord) {
      var s = '<ul class="md-list">';
      list.forEach(function (it) {
        s += '<li>' + inline(it.text, hl);
        if (it.sub && it.sub.length) s += build(it.sub, false);
        s += '</li>';
      });
      return s + '</ul>';
    }
    function buildOl(list) {
      var s = '<ol class="md-list md-ol">';
      list.forEach(function (it) {
        s += '<li>' + inline(it.text, hl);
        if (it.sub && it.sub.length) s += build(it.sub, false);
        s += '</li>';
      });
      return s + '</ol>';
    }
    return { html: ordered ? buildOl(items) : build(items), next: i };
  }

  w.FGMarkdown = { render: render, inline: inline, esc: esc };
})(window);
