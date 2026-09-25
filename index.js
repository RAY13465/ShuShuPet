/* ============================================================================
 * 鼠鼠桌宠 · 入口
 * ----------------------------------------------------------------------------
 * 酒馆加载本扩展时只跑这一个文件。它负责按顺序把 core 下的脚本注入进来，
 * 然后启动引擎。分文件是为了可维护，不依赖打包器。
 * ========================================================================== */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var FOLDER = 'shushu-pet';   /* 扩展目录名（英文，避免 URL 编码问题） */

  /* 当前扩展目录：从自己的 <script src> 反推，兼容任意部署路径 */
  var BASE = (function () {
    try {
      var scripts = document.querySelectorAll('script[src]');
      for (var i = scripts.length - 1; i >= 0; i--) {
        var s = scripts[i].getAttribute('src') || '';
        if (s.indexOf(FOLDER) >= 0) {
          return s.replace(/index\.js.*$/, '');
        }
      }
    } catch (e) {}
    return '/scripts/extensions/third-party/' + FOLDER + '/';
  })();

  var CORE = [
    'core/util.js',
    'core/dom.js',
    'core/position.js',
    'core/engine.js',
    'core/adapter.js',
    'core/registry.js',
    'core/settings.js',
    'core/editor.js',
    'core/demo.js',
    'core/boot.js'
  ];

  window.__SHUSHU_PET__ = {
    name: '鼠鼠桌宠',
    version: VERSION,
    folder: FOLDER,
    base: BASE,
    ready: false,
    error: null
  };

  function loadOne(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error('加载失败: ' + src)); };
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
        console.log('[鼠鼠桌宠] v' + VERSION + ' 已启动');
      } else {
        throw new Error('core/boot.js 没有注册 PetEngine');
      }
    } catch (e) {
      window.__SHUSHU_PET__.error = String((e && e.message) || e);
      console.error('[鼠鼠桌宠] 启动失败：', e);
    }
  })();
})();
