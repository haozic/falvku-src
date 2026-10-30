/* Markdown 渲染器自测（node 环境，模拟 window） */
'use strict';
global.window = global;
require('../assets/js/markdown.js');

var cases = [
  ['# 一级标题\n\n正文一段。', '标题+段落'],
  ['**第一条** 为了保护当事人的合法权益，制定本法。', '条文加粗'],
  ['- 一、甲项\n- 二、乙项', '无序列表'],
  ['1. 第一项\n2. 第二项', '有序列表'],
  ['> 这是引用内容。', '引用'],
  ['```\nvar a = 1;\n```', '代码块'],
  ['| 名称 | 效力 |\n| --- | --- |\n| 宪法 | 最高 |', '表格'],
  ['[链接](https://flk.npc.gov.cn) 与 `代码`', '行内'],
  ['---', '分隔线'],
  ['第一行\n第二行', '软换行'],
  ['段落一\n\n段落二', '两个段落']
];

cases.forEach(function (c) {
  var out = window.FGMarkdown.render(c[0]);
  console.log('== ' + c[1] + ' ==');
  console.log(out);
  console.log('');
});
