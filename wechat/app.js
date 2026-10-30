/**
 * 法规库 · 原生微信小程序
 *
 * 全局职责：
 *  1. 后端地址常量（唯一需要改的地方）+ 全局数据缓存；
 *  2. 主题（跟随系统 / 手动浅色 / 手动深色）；
 *  3. 正文字号；
 *  4. /api/meta 的一次性拉取与缓存。
 *
 * 所有业务数据都来自同源 API（服务端持有全量语料），小程序本地只存
 * 收藏 / 批注 / 最近浏览 / 设置 / 自建条目。
 *
 * 兼容性：目标基础库 2.9+，不使用可选链、空值合并等 3.x 语法。
 */

// 后端地址：改成你自己的部署地址。微信正式版要求 HTTPS 且域名已在小程序后台配置白名单。
const API_BASE = 'http://127.0.0.1:8765';

const api = require('./utils/api.js');
const store = require('./utils/store.js');

/** 读取系统主题（浅色 / 深色）。老基础库没有 theme 字段时回退到浅色。 */
function detectSystemTheme() {
  try {
    const info = wx.getSystemInfoSync();
    if (info && info.theme) return info.theme === 'dark' ? 'dark' : 'light';
  } catch (e) {
    /* 基础库过老或调用失败，回退浅色 */
  }
  return 'light';
}

App({
  globalData: {
    apiBase: API_BASE,
    /* 主题：auto=跟随系统 / light / dark */
    themeMode: 'auto',
    systemTheme: 'light',
    /* 生效主题与对应 class（页面根节点挂 theme-light / theme-dark） */
    theme: 'light',
    themeClass: 'theme-light',
    fontSize: 15,
    /* /api/meta 缓存 */
    meta: null,
    metaLoading: false,
    /* 检索页共享状态 */
    lastQuery: '',
    /* 从体系页跳转检索页时携带的门类 */
    pendingCat: '',
    /* 首页体系卡片跳「体系」页时携带的体系 id */
    pendingGroup: ''
  },

  onLaunch() {
    const s = store.settings.all();
    this.globalData.fontSize = s.fontSize || 15;
    this.globalData.themeMode = s.themeMode || 'auto';
    this.globalData.systemTheme = detectSystemTheme();
    this.applyTheme(this.globalData.themeMode);

    /* 系统深浅色切换（基础库 2.9+ 提供 onThemeChange） */
    if (typeof wx.onThemeChange === 'function') {
      wx.onThemeChange((res) => {
        this.globalData.systemTheme = res && res.theme === 'dark' ? 'dark' : 'light';
        if (this.globalData.themeMode === 'auto') this.applyTheme('auto');
      });
    }
  },

  /**
   * 应用主题。
   * @param {'auto'|'light'|'dark'} mode
   */
  applyTheme(mode) {
    const g = this.globalData;
    g.themeMode = mode;
    const eff = mode === 'auto' ? g.systemTheme : mode;
    g.theme = eff;
    g.themeClass = eff === 'dark' ? 'theme-dark' : 'theme-light';

    /* 导航栏跟着换色（原生导航栏不受 WXSS 变量控制） */
    try {
      wx.setNavigationBarColor({
        frontColor: eff === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: eff === 'dark' ? '#1c1f24' : '#ffffff',
        animation: true
      });
    } catch (e) {
      /* 页面尚未创建时会失败，忽略即可 */
    }

    /* 通知所有在栈页面刷新根节点的 theme class */
    const pages = getCurrentPages();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (p && typeof p.onThemeChange === 'function') p.onThemeChange(g.themeClass);
    }
  },

  /**
   * 拉取（并缓存）/api/meta。
   * 多个页面同时要 meta 时排队等同一个请求，不会互相把对方判成失败。
   * @param {(meta: object|null, err?: Error) => void} callback
   */
  ensureMeta(callback) {
    if (this.globalData.meta) {
      callback(this.globalData.meta);
      return;
    }
    if (!this.globalData.metaLoading) {
      this.globalData.metaLoading = true;
      this._metaWaiters = [];
      const self = this;
      api.getMeta().then(function (meta) {
        self.globalData.metaLoading = false;
        self.globalData.meta = meta;
        const waiters = self._metaWaiters || [];
        self._metaWaiters = [];
        for (let i = 0; i < waiters.length; i++) waiters[i](meta);
      }).catch(function (err) {
        self.globalData.metaLoading = false;
        const waiters = self._metaWaiters || [];
        self._metaWaiters = [];
        for (let i = 0; i < waiters.length; i++) waiters[i](null, err);
      });
    }
    if (!this._metaWaiters) this._metaWaiters = [];
    this._metaWaiters.push(callback);
  },

  /**
   * 切换正文字号（15 / 16 / 17 / 18 / 20 循环）。
   * @returns {number} 新字号
   */
  cycleFontSize() {
    const sizes = [15, 16, 17, 18, 20];
    const cur = this.globalData.fontSize || 15;
    let idx = sizes.indexOf(cur);
    if (idx < 0) idx = 0;
    const next = sizes[(idx + 1) % sizes.length];
    this.globalData.fontSize = next;
    store.settings.set('fontSize', next);
    return next;
  }
});
