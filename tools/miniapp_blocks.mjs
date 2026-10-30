// 分析正文排版模式：确定「块」的切分规则（两端渲染共用）
import fs from 'node:fs';
import path from 'node:path';

const DATA = 'data';
const files = fs.readdirSync(DATA).filter((f) => /^(party|flk|hubei)_\d+\.js$/.test(f)).sort();
const docs = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(DATA, f), 'utf8');
  const i = raw.indexOf('.push(');
  const s = raw.indexOf('[', i);
  const e = raw.lastIndexOf(']');
  docs.push(...JSON.parse(raw.slice(s, e + 1)));
}

const stat = {
  clause: 0, item: 0, note: 0, para: 0,
  otherHeading: 0, blank: 0, mdish: 0,
};
const otherSamples = [];
const mdSamples = [];
let secLevels = {};
let noName = 0, nameLevel1 = 0;

for (const d of docs) {
  const secs = d.sections || [];
  for (const sec of secs) {
    secLevels[sec.level] = (secLevels[sec.level] || 0) + 1;
    if (!sec.name) noName++;
    else if (sec.level === 1) nameLevel1++;
    const text = sec.text || '';
    for (const line of text.split(/\n+/)) {
      const t = line.trim();
      if (!t) { stat.blank++; continue; }
      if (/^(第[一二三四五六七八九十百零〇两]+条)/.test(t)) { stat.clause++; continue; }
      if (/^([（(][一二三四五六七八九十百零〇两\d]+[)）])\s*/.test(t)) { stat.item++; continue; }
      if (/^[（(][\s\S]{16,}[）)][。；;]?$/.test(t)) { stat.note++; continue; }
      // 中文数字分段（党内法规顶层）
      if (/^[一二三四五六七八九十]+、/.test(t)) { stat.otherHeading++; if (otherSamples.length < 8) otherSamples.push(t.slice(0, 40)); continue; }
      if (/[*_`#>|\[\]]/.test(t)) { stat.mdish++; if (mdSamples.length < 10) mdSamples.push(t.slice(0, 60)); continue; }
      stat.para++;
    }
  }
}
console.log('section level 分布:', JSON.stringify(secLevels));
console.log('无标题节(通常是文首标题段):', noName, ' 一级标题节:', nameLevel1);
console.log('行类型统计:', JSON.stringify(stat));
console.log('中文数字分段样例:', otherSamples);
console.log('疑似 markdown 行样例:', mdSamples);

// 一级标题（level=1）名称样式统计
const h1 = new Map();
for (const d of docs) {
  for (const sec of d.sections || []) {
    if (sec.level !== 1 || !sec.name) continue;
    const shape = sec.name.replace(/[一二三四五六七八九十百零〇两\d]+/g, '#').replace(/\s+/g, ' ').trim();
    h1.set(shape, (h1.get(shape) || 0) + 1);
  }
}
const top = [...h1.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log('\n一级标题形态 Top25:');
for (const [k, v] of top) console.log('  ', v, k);
