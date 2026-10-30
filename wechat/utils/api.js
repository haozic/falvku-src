/**
 * 法规库小程序 · API 封装
 *
 * 全部接口都是 GET，返回 JSON；导出接口返回文件内容本身（text）。
 * 后端地址取自 app.js 的 API_BASE（可通过 getApp().globalData.apiBase 覆盖）。
 *
 * 服务端契约（miniapps/falv-mini-app/miniapp/node/server.mjs）：
 *   GET /api/meta
 *   GET /api/search?q=&cat=&group=&sort=&page=&size=
 *   GET /api/suggest?q=
 *   GET /api/doc?id=&q=
 *   GET /api/timeline
 *   GET /api/export?ids=&fmt=   -> 返回文件内容（txt/md/json/csv/html）
 */

/** 取后端基址（运行时从 app.js 读，方便部署时统一改） */
function base() {
  let b = '';
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.apiBase) b = app.globalData.apiBase;
  } catch (e) {
    /* app 还没启动时兜底 */
  }
  return (b || 'http://127.0.0.1:8765').replace(/\/+$/, '');
}

/** 拼查询串（空值不参与） */
function qs(params) {
  if (!params) return '';
  const parts = [];
  for (const k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    const v = params[k];
    if (v === null || v === undefined || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/**
 * 底层请求。
 * @param {string} path 例如 /api/search
 * @param {object} params 查询参数
 * @param {object} opts {dataType:'json'|'text', timeout}
 */
function request(path, params, opts) {
  opts = opts || {};
  const url = base() + path + qs(params);
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      /* dataType: json 走 JSON.parse；text 拿原始字符串（csv/md/txt 导出用）。
         注意：不能同时设 responseType:'arraybuffer'，那会让 dataType 失效、拿不到 JSON。 */
      dataType: opts.dataType || 'json',
      timeout: opts.timeout || 20000,
      header: { 'content-type': 'application/json' },
      success: function (res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        resolve(res.data);
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) ? err.errMsg : '网络请求失败'));
      }
    });
  });
}

const api = {
  /** 门类 / 体系 / 统计 */
  getMeta: function () {
    return request('/api/meta');
  },

  /**
   * 全库检索。
   * @param {object} params {q, cat, group, sort, page, size}
   */
  search: function (params) {
    return request('/api/search', params);
  },

  /** 标题联想 */
  suggest: function (q) {
    return request('/api/suggest', { q: q });
  },

  /** 单篇详情（q 用于正文高亮） */
  doc: function (id, q) {
    return request('/api/doc', { id: id, q: q || '' });
  },

  /** 立法时间轴 */
  timeline: function () {
    return request('/api/timeline');
  },

  /**
   * 导出：返回文件内容（不是 JSON）。
   * 服务端只在响应头给 Content-Type，**不返回文件名**，文件名由前端生成。
   * @param {string[]} ids
   * @param {string} fmt txt|md|json|csv|html
   * @returns {Promise<string>}
   */
  exportDoc: function (ids, fmt) {
    const list = (ids || []).join(',');
    return request('/api/export', { ids: list, fmt: fmt }, { dataType: 'text' });
  }
};

module.exports = api;
