/**
 * 法规库小程序 · 通用工具
 *
 * 只做纯函数与少量 UI 辅助，不依赖业务状态。
 * 兼容性：ES5 风格写法，不用可选链 / 空值合并。
 */

/** ISO 日期 -> 中文日期。2016-10-27 -> 2016年10月27日 */
function fmtDate(iso) {
  if (!iso) return '';
  const p = String(iso).split('-');
  if (p.length === 3) return p[0] + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
  if (p.length === 2) return p[0] + '年' + parseInt(p[1], 10) + '月';
  if (p.length === 1 && /^\d{4}$/.test(p[0])) return p[0] + '年';
  return String(iso);
}

/** 字数 -> 人类可读。13266732 -> 1326.7万字 */
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万字';
  return n + '字';
}

/** 时间戳 -> 简短日期。2026-10-29 */
function fmtDateShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/** 防抖：连续触发只在停止 wait 毫秒后执行一次 */
function debounce(fn, wait) {
  let t = null;
  return function () {
    const args = arguments;
    const self = this;
    if (t) clearTimeout(t);
    t = setTimeout(function () {
      t = null;
      fn.apply(self, args);
    }, wait || 150);
  };
}

/** 节流：wait 毫秒内最多执行一次 */
function throttle(fn, wait) {
  let last = 0;
  let timer = null;
  return function () {
    const self = this;
    const args = arguments;
    const now = Date.now();
    if (now - last >= (wait || 200)) {
      last = now;
      fn.apply(self, args);
      return;
    }
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      last = Date.now();
      fn.apply(self, args);
    }, wait || 200);
  };
}

/** 轻提示 */
function toast(title, icon) {
  wx.showToast({
    title: String(title || ''),
    icon: icon || 'none',
    duration: 1800
  });
}

/**
 * 给服务端返回的 <mark> 加内联样式。
 * rich-text 不认 WXSS 里的 class 选择器，只认内联 style，所以必须在这里改写。
 * @param {string} html 服务端已转义好的 HTML
 * @param {boolean} dark 是否深色主题
 */
function styleMarks(html, dark) {
  if (!html) return '';
  const bg = dark ? '#6b5518' : '#ffe58a';
  const fg = dark ? '#ffeec2' : '#4a3600';
  return String(html).replace(
    /<mark>/g,
    '<mark style="background:' + bg + ';color:' + fg + ';border-radius:2px;">'
  );
}

/** 截断长文本，保留开头 */
function excerpt(text, len) {
  const s = String(text || '');
  const n = len || 120;
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

/** 生成一个短 id（不依赖 crypto） */
function uid(prefix) {
  return (prefix || 'm') + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * 安全的 decodeURIComponent。
 * 小程序路由的 onLoad 参数通常已经解码过，这里再解一次对普通文本是恒等的；
 * 真出现非法百分号序列（比如正文里的 "50%增长"）时不能让整个页面挂掉。
 */
function safeDecode(s) {
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return String(s);
  }
}

/** 导出文件名（服务端不返回文件名，这里自己生成） */
function exportName(fmt, stamp) {
  const d = stamp || fmtDateShort(Date.now());
  const map = { txt: 'txt', md: 'md', json: 'json', csv: 'csv', html: 'html' };
  if (fmt === 'csv') return '法规目录_' + d + '.csv';
  return '法规汇编_' + d + '.' + (map[fmt] || 'txt');
}

module.exports = {
  fmtDate: fmtDate,
  fmtNum: fmtNum,
  fmtDateShort: fmtDateShort,
  debounce: debounce,
  throttle: throttle,
  toast: toast,
  styleMarks: styleMarks,
  excerpt: excerpt,
  uid: uid,
  safeDecode: safeDecode,
  exportName: exportName
};
