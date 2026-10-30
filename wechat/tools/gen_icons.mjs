/**
 * 生成 tabBar 与页面内使用的 PNG 图标（无第三方依赖）。
 *
 * 做法：在 24×24 网格上用「有向距离场」描述线性图标，
 * 再用 3×3 超采样光栅化成抗锯齿位图，最后手写 PNG 编码（IHDR/IDAT/IEND + CRC32）。
 *
 * 为什么不用 emoji / 字符图标：用户明确要求「图标统一走图形」，
 * 而且字符图标在不同系统上字形不一致。
 *
 * 运行： node tools/gen_icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'images');

const TAB_SIZE = 81;   // tabBar 图标推荐 81×81
const IC_SIZE = 48;    // 页面内图标

const COLOR_TAB = '#5b6472';
const COLOR_TAB_ACTIVE = '#c8102e';
const COLOR_IC = '#5b6472';

/* ============================================================ 几何 */

/** 点到线段的距离 */
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const dx = wx - t * vx;
  const dy = wy - t * vy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 点到圆的「环」距离 */
function sdCircle(px, py, cx, cy, r) {
  return Math.abs(Math.hypot(px - cx, py - cy) - r);
}

/** 点到圆角矩形边框的距离 */
function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  const dx = Math.max(Math.abs(px - cx) - hw, 0);
  const dy = Math.max(Math.abs(py - cy) - hh, 0);
  const outside = Math.hypot(dx, dy) - r;
  const inside = Math.min(Math.max(Math.abs(px - cx) - hw, Math.abs(py - cy) - hh), 0);
  return outside + inside;
}

/** 采样三次贝塞尔成折线点 */
function bezPoints(p0, p1, p2, p3, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

/** 折线（开放）距离 */
function sdPoly(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = sdSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/** 闭合路径（开放描边，不闭合） */
function sdClosedPath(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = sdSegment(px, py, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

/** 点是否在多边形内 */
function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    const hit = (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/* ============================================================ 图标定义 */

/** 星形 10 点 */
function starPoints(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (-Math.PI / 2) + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

const CRESCENT = [
  ...bezPoints([16.8, 4.2], [8.6, 4.6], [5.2, 10.6], [5.2, 17.4], 16),
  ...bezPoints([5.2, 17.4], [11.4, 16.4], [16.8, 13.4], [16.8, 4.2], 16)
];

const SUN_RAYS = (() => {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    rays.push([[12 + c * 6.3, 12 + s * 6.3], [12 + c * 8.8, 12 + s * 8.8]]);
  }
  return rays;
})();

/**
 * 每个图标是一组图元：
 *   {t:'poly', pts, w, close?}   折线描边
 *   {t:'circle', cx, cy, r, w}   圆环
 *   {t:'rrect', x, y, w, h, r, sw} 圆角矩形
 *   {t:'fill', pts}              实心多边形
 */
const ICONS = {
  home: [
    { t: 'poly', pts: [[3, 10.6], [12, 3.2], [21, 10.6]], w: 1.8 },
    { t: 'poly', pts: [[5.6, 9.2], [5.6, 20.6], [18.4, 20.6], [18.4, 9.2]], w: 1.8 }
  ],
  search: [
    { t: 'circle', cx: 10.6, cy: 10.6, r: 6.4, w: 1.8 },
    { t: 'poly', pts: [[15.4, 15.4], [20.6, 20.6]], w: 1.8 }
  ],
  tree: [
    { t: 'rrect', x: 3.2, y: 3.2, w: 7.2, h: 7.2, r: 1.8, sw: 1.7 },
    { t: 'rrect', x: 13.6, y: 3.2, w: 7.2, h: 7.2, r: 1.8, sw: 1.7 },
    { t: 'rrect', x: 3.2, y: 13.6, w: 7.2, h: 7.2, r: 1.8, sw: 1.7 },
    { t: 'rrect', x: 13.6, y: 13.6, w: 7.2, h: 7.2, r: 1.8, sw: 1.7 }
  ],
  timeline: [
    { t: 'circle', cx: 12, cy: 12, r: 8.2, w: 1.8 },
    { t: 'poly', pts: [[12, 6.8], [12, 12], [15.6, 14.3]], w: 1.8 }
  ],
  me: [
    { t: 'circle', cx: 12, cy: 8.2, r: 3.6, w: 1.8 },
    { t: 'poly', pts: bezPoints([4.8, 20], [4.8, 16.6], [8, 14.4], [12, 14.4], 14), w: 1.8 },
    { t: 'poly', pts: bezPoints([12, 14.4], [16, 14.4], [19.2, 16.6], [19.2, 20], 14), w: 1.8 }
  ],
  star: [
    { t: 'poly', pts: starPoints(12, 12.2, 9.2, 4.0), w: 1.7, close: true }
  ],
  'star-fill': [
    { t: 'fill', pts: starPoints(12, 12.2, 9.2, 4.0) }
  ],
  pen: [
    { t: 'poly', pts: [[16.4, 3.6], [20.4, 7.6], [8.4, 19.6], [3.6, 20.4], [4.4, 15.6], [16.4, 3.6]], w: 1.7, close: true },
    { t: 'poly', pts: [[14.4, 5.6], [18.4, 9.6]], w: 1.7 }
  ],
  download: [
    { t: 'poly', pts: [[12, 3.6], [12, 15.2]], w: 1.8 },
    { t: 'poly', pts: [[7.2, 10.6], [12, 15.4], [16.8, 10.6]], w: 1.8 },
    { t: 'poly', pts: [[4.6, 19.6], [19.4, 19.6]], w: 1.8 }
  ],
  chevron: [
    { t: 'poly', pts: [[9.5, 5], [16.5, 12], [9.5, 19]], w: 2 }
  ],
  'chevron-down': [
    { t: 'poly', pts: [[5, 9.5], [12, 16.5], [19, 9.5]], w: 2 }
  ],
  plus: [
    { t: 'poly', pts: [[12, 5], [12, 19]], w: 2 },
    { t: 'poly', pts: [[5, 12], [19, 12]], w: 2 }
  ],
  trash: [
    { t: 'poly', pts: [[4.5, 6.5], [19.5, 6.5]], w: 1.7 },
    { t: 'poly', pts: [[9, 6.5], [9, 4.6], [15, 4.6], [15, 6.5]], w: 1.7 },
    { t: 'poly', pts: [[6.5, 6.5], [7.4, 20.2], [16.6, 20.2], [17.5, 6.5]], w: 1.7 }
  ],
  text: [
    { t: 'poly', pts: [[3.6, 19], [9.6, 4.8], [15.6, 19]], w: 1.8 },
    { t: 'poly', pts: [[5.8, 14], [13.4, 14]], w: 1.8 },
    { t: 'poly', pts: [[17.6, 19], [17.6, 11.6]], w: 1.8 }
  ],
  moon: [
    { t: 'poly', pts: CRESCENT, w: 1.7, close: true }
  ],
  sun: [
    { t: 'circle', cx: 12, cy: 12, r: 4.2, w: 1.7 },
    ...SUN_RAYS.map((pts) => ({ t: 'poly', pts, w: 1.7 }))
  ],
  none: [
    { t: 'circle', cx: 12, cy: 12, r: 8.4, w: 1.8 },
    { t: 'poly', pts: [[6.6, 6.6], [17.4, 17.4]], w: 1.8 }
  ]
};

/* ============================================================ 光栅化 */

const GRID = 24;
const SS = 3; // 每像素每轴超采样次数

/** 图元在点上的距离（<= w/2 视为落在笔画上） */
function distAt(prim, gx, gy) {
  switch (prim.t) {
    case 'poly':
      return prim.close
        ? sdClosedPath(gx, gy, prim.pts)
        : sdPoly(gx, gy, prim.pts);
    case 'circle':
      return sdCircle(gx, gy, prim.cx, prim.cy, prim.r);
    case 'rrect':
      return sdRoundRect(gx, gy, prim.x, prim.y, prim.w, prim.h, prim.r);
    default:
      return Infinity;
  }
}

function widthOf(prim) {
  if (prim.t === 'circle') return prim.w;
  if (prim.t === 'rrect') return prim.sw;
  return prim.w;
}

/** 光栅化一个图标 -> RGBA 像素缓冲 */
function rasterize(name, size) {
  const prims = ICONS[name];
  if (!prims) throw new Error('未定义的图标: ' + name);
  const buf = Buffer.alloc(size * size * 4);
  const step = GRID / size;
  const total = SS * SS;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const gx = (px + (sx + 0.5) / SS) * step;
          const gy = (py + (sy + 0.5) / SS) * step;

          let ink = false;
          for (let k = 0; k < prims.length; k++) {
            const prim = prims[k];
            if (prim.t === 'fill') {
              if (pointInPolygon(gx, gy, prim.pts)) {
                ink = true;
                break;
              }
              continue;
            }
            const d = distAt(prim, gx, gy);
            if (d <= widthOf(prim) / 2) {
              ink = true;
              break;
            }
          }
          if (ink) hits++;
        }
      }
      const o = (py * size + px) * 4;
      buf[o] = 0;
      buf[o + 1] = 0;
      buf[o + 2] = 0;
      buf[o + 3] = Math.round((hits / total) * 255);
    }
  }
  return buf;
}

/* ============================================================ PNG 编码 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 把 RGBA 缓冲编码成 PNG */
function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  /* 每行前置一个 filter 字节（0 = None） */
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const dst = y * (size * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, y * size * 4, (y + 1) * size * 4);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ============================================================ 上色输出 */

/** 解析 #rrggbb */
function parseHex(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ];
}

/** 把 alpha 缓冲着色成 RGBA PNG */
function colorize(alphaBuf, size, hex) {
  const [r, g, b] = parseHex(hex);
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = alphaBuf[i * 4 + 3];
  }
  return out;
}

/* ============================================================ 主流程 */

function write(name, iconName, size, hex) {
  const alpha = rasterize(iconName, size);
  const png = encodePng(colorize(alpha, size, hex), size);
  const path = join(OUT, name);
  writeFileSync(path, png);
  return { name, size, bytes: png.length };
}

mkdirSync(OUT, { recursive: true });

const made = [];

/* tabBar：5 个 tab × 常态 / 选中态 */
const TABS = [
  ['home', 'home'],
  ['search', 'search'],
  ['tree', 'tree'],
  ['timeline', 'timeline'],
  ['mine', 'me']
];
for (const [tab, icon] of TABS) {
  made.push(write(`tab-${tab}.png`, icon, TAB_SIZE, COLOR_TAB));
  made.push(write(`tab-${tab}-active.png`, icon, TAB_SIZE, COLOR_TAB_ACTIVE));
}

/* 页面内图标 */
const PAGES = [
  ['ic-star.png', 'star', COLOR_IC],
  ['ic-star-fill.png', 'star-fill', COLOR_TAB_ACTIVE],
  ['ic-pen.png', 'pen', COLOR_IC],
  ['ic-download.png', 'download', COLOR_IC],
  ['ic-chevron.png', 'chevron', COLOR_IC],
  ['ic-chevron-down.png', 'chevron-down', COLOR_IC],
  ['ic-plus.png', 'plus', COLOR_IC],
  ['ic-trash.png', 'trash', COLOR_IC],
  ['ic-text.png', 'text', COLOR_IC],
  ['ic-moon.png', 'moon', COLOR_IC],
  ['ic-sun.png', 'sun', COLOR_IC],
  ['ic-none.png', 'none', COLOR_IC],
  ['ic-search.png', 'search', COLOR_IC]
];
for (const [file, icon, hex] of PAGES) {
  made.push(write(file, icon, IC_SIZE, hex));
}

for (const m of made) {
  console.log(`${m.name.padEnd(26)} ${m.size}x${m.size}  ${m.bytes} bytes`);
}
console.log(`\n共生成 ${made.length} 个 PNG -> ${OUT}`);
