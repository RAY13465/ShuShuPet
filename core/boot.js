/* ============================================================================
 * 鼠鼠桌宠 · core/boot.js
 * 总装：把适配层、注册表、渲染实例、设置面板串起来。挂在 window.PetEngine.boot
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;
  var A = window.PetAdapter;
  var R = window.PetRegistry;
  var S = window.PetSettings;
  var P = window.PetPos;

  var win = window;
  var doc = win.document;

  /* 内置包清单。想加内置包就放进 builtin/ 目录并在这里登记。 */
  var BUILTIN_FILES = ['builtin/example.json'];

  var CFG = {
    pollMs: 1200,          /* 兜底轮询：没绑到事件时靠它 */
    refreshDebounceMs: 220,
    hideWhenAbsent: true,  /* 当前聊天没有桌宠数据时隐藏 */
    fixRootContainingBlock: true
  };

  var inst = null;
  var currentPkgId = null;
  var timer = null;
  var running = false;

  function base() {
    try { return (win.__SHUSHU_PET__ && win.__SHUSHU_PET__.base) || ''; } catch (e) { return ''; }
  }

  /* ---------------- 加载内置包 ---------------- */
  async function loadBuiltins() {
    for (var i = 0; i < BUILTIN_FILES.length; i++) {
      var rel = BUILTIN_FILES[i];
      var url = base() + rel;
      try {
        var res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var pkg = await res.json();
        var id = pkg.id || rel.replace(/^builtin\//, '').replace(/\.json$/, '');
        pkg.base = url.replace(/[^/]*$/, '');      /* 让包内相对素材路径可解析 */
        R.registerBuiltin(id, pkg);
        U.log('内置包已注册：' + id);
      } catch (e) {
        U.warn('内置示例包没加载成功（不影响使用，导入自己的包即可）：' + rel);
      }
    }
  }

  /* ---------------- 当前角色 ---------------- */
  function currentAvatar() {
    try {
      var c = A.getContext(win);
      if (!c) return null;
      var ch = c.characters && c.characters[c.characterId];
      return ch ? ch.avatar : null;
    } catch (e) { return null; }
  }

  /* ---------------- 核心刷新 ---------------- */
  function refresh() {
    if (!running) return;
    try {
      var pkg = R.resolveFor(currentAvatar());
      if (!pkg) { if (inst) inst.hide(); return; }

      /* 换包 → 重建实例 */
      if (currentPkgId !== pkg.id) {
        if (inst) inst.destroy();
        inst = new win.PetEngine.Instance(win, pkg, {});
        currentPkgId = pkg.id;
        U.log('切换到桌宠包：' + pkg.id);
      }

      var data = A.currentData(win, pkg);
      if (data) {
        inst.mount(data);
      } else if (CFG.hideWhenAbsent) {
        if (inst.isMounted()) inst.hide();
      }
    } catch (e) {
      U.warn('刷新出错：' + (e && e.message ? e.message : e));
    }
  }

  var debounce = null;
  function schedule() {
    if (debounce) win.clearTimeout(debounce);
    debounce = win.setTimeout(refresh, CFG.refreshDebounceMs);
  }

  /* ---------------- 保活：host 被别处拆了就重建 ---------------- */
  function keepAlive() {
    if (!running) return;
    try {
      if (inst && inst.isMounted()) return;      /* 在，什么都不用做 */
      if (doc.getElementById(win.PetEngine.HOST_ID)) return;
      schedule();
    } catch (e) {}
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    win.PetEngine = win.PetEngine || {};
    if (win.PetEngine.__booted) return;
    win.PetEngine.__booted = true;
    win.PetEngine.boot = boot;
    win.PetEngine.getState = function () {
      return {
        running: running,
        packageId: currentPkgId,
        mounted: !!(inst && inst.isMounted()),
        avatar: currentAvatar(),
        instance: inst
      };
    };
    win.PetEngine.refresh = schedule;
    win.PetEngine.PetPos = P;

    /* 1) 修根元素包含块：这一步决定了 position:fixed 是否可用 */
    if (CFG.fixRootContainingBlock) {
      A.startRootFixLoop(win, doc);
      U.log('已接管根元素包含块修复（transform/perspective → none）');
    }

    /* 2) 内置包 */
    await loadBuiltins();

    /* 3) 设置面板接线 */
    S.on('getAvatar', currentAvatar);
    S.on('onChange', function () { currentPkgId = null; refresh(); });
    S.on('onReset', function () { if (inst) inst.resetState(); });
    if (win.PetEditor) {
      win.PetEditor.on('onChange', function () { currentPkgId = null; refresh(); });
    }

    /* 4) 等酒馆就绪 */
    var tries = 0;
    await new Promise(function (resolve) {
      var iv = win.setInterval(function () {
        tries++;
        if (doc.body && doc.getElementById('chat')) { win.clearInterval(iv); resolve(); }
        else if (tries >= 60) { win.clearInterval(iv); resolve(); }
      }, 250);
    });

    running = true;
    S.installButton(doc);

    /* 5) 事件 + 轮询 */
    var l = A.listen(win, schedule);
    U.log('事件订阅：' + (l.bound ? '酒馆事件' : '轮询兜底'));
    try { win.setInterval(keepAlive, 1000); } catch (e) {}
    if (timer) win.clearInterval(timer);
    try { timer = win.setInterval(schedule, CFG.pollMs); } catch (e) {}

    refresh();
    U.log('就绪。角色=' + (currentAvatar() || '(未选)') + ' 包=' + (currentPkgId || '(无)'));
  }

  win.PetEngine = win.PetEngine || {};
  win.PetEngine.boot = boot;
  win.PetEngine.CFG = CFG;
  win.PetEngine.loadBuiltins = loadBuiltins;
  win.PetEngine.currentAvatar = currentAvatar;
  win.PetEngine.refreshNow = refresh;
})();
