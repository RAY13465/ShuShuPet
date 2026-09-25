/* ============================================================================
 * 鼠鼠桌宠 · 入口
 * ----------------------------------------------------------------------------
 * 酒馆加载本扩展时只跑这一个文件。它负责按顺序把 core 下的脚本注入进来，
 * 然后启动引擎。分文件是为了可维护，不依赖打包器。
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var FOLDER = 'shushu-pet';   /* 默认目录名，仅作兜底用 */

  /* 当前扩展目录：**从自己的 <script src> 真实路径反推**。
     不要假设目录名一定是 shushu-pet——解压出来常常带 -master 之类的后缀，
     写死目录名会导致找不到 core/ 从而静默启动失败（按钮也不出现）。 */
  var BASE = (function () {
    try {
      /* 本脚本自己就是最后插入的那个，取最后一个仍带 /index.js 的 src */
      var scripts = document.querySelectorAll('script[src]');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].getAttribute('src') || '';
        if (/index\.js(\?|$)/.test(s)) {
          return s.replace(/index\.js(\?.*)?$/, '');
        }
      }
    } catch (e) {}
    return '/scripts/extensions/third-party/' + FOLDER + '/';
  })();
  /* 目录名也从中提取，供状态显示 */
  var FOLDER_REAL = (BASE.match(/([^/]+)\/$/) || [])[1] || FOLDER;

  var CORE = [
    'core/util.js',
    'core/placeholder.js',
    'core/dom.js',
    'core/position.js',
    'core/engine.js',
    'core/adapter.js',
    'core/registry.js',
    'core/settings.js',
    'core/editor.js',
    'core/demo.js',
    'core/diagnose.js',   /* 必须在 boot.js 之前：boot 失败时自检仍然可用 */
    'core/boot.js'
  ];

  window.__SHUSHU_PET__ = {
    name: '鼠鼠桌宠',
    version: VERSION,
    folder: FOLDER_REAL,
    base: BASE,
    core: CORE,           /* 自检模块拿它核对文件是否齐全，避免两处清单写岔 */
    ready: false,
    error: null
  };

  /* 加载失败要让用户看得见——只在 console 报错的话，
     表现就是"什么都没发生"，非常难排查。 */
  function reportFatal(msg, detail) {
    try {
      window.__SHUSHU_PET__.error = msg;
      console.error('[鼠鼠桌宠] ' + msg, detail || '');
    } catch (e) {}
    try {
      if (typeof toastr !== 'undefined' && toastr.error) {
        toastr.error('鼠鼠桌宠启动失败：' + msg, '鼠鼠桌宠', { timeOut: 20000 });
      }
    } catch (e) {}
  }

  function loadOne(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('取不到文件 → ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  (async function () {
    try {
      for (var i = 0; i < CORE.length; i++) {
        await loadOne(BASE + CORE[i]);
      }
      if (window.PetEngine && typeof window.PetEngine.boot === 'function') {
        await window.PetEngine.boot();
        window.__SHUSHU_PET__.ready = true;
        console.log('[鼠鼠桌宠] v' + VERSION + ' 已启动，目录：' + FOLDER_REAL);
      } else {
        throw new Error('core/boot.js 没有注册 PetEngine');
      }
    } catch (e) {
      var m = String((e && e.message) || e);
      reportFatal(m + '（请确认扩展目录完整、文件是从仓库完整下载的）', e);
    }
  })();
})();
