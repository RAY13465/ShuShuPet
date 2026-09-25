/* ============================================================================
 * 鼠鼠桌宠 · core/position.js
 * 位置管理：保证桌宠「整只」留在可见区内；装不下就等比缩放；窄屏自动夹回。
 * 挂在 window.PetPos
 *
 * 关键教训（上一版踩过的坑，这里都规避了）：
 *   1) 不能信 host.getBoundingClientRect() —— 祖先若有 transform/perspective，
 *      它给出的坐标会被整体平移。尺寸一律用 offsetWidth/offsetHeight。
 *   2) 边界一律用视口尺寸（documentElement.clientWidth/Height）。
 *   3) 桌宠比视口还大时，按比例 scale 缩小，而不是把它推出屏幕。
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;

  var CFG = {
    edgeInsetPx: 6,          /* 四周至少留出的空隙 */
    bottomZonePct: 60,       /* 默认只允许待在屏幕下 60% 以内（避免贴到顶栏） */
    allowTopZone: false,     /* true = 不限制纵向，只保证整只可见 */
    minScale: 0.25
  };

  function viewSize(win) {
    win = win || window;
    var de = win.document && win.document.documentElement;
    return {
      vw: win.innerWidth || (de && de.clientWidth) || 0,
      vh: win.innerHeight || (de && de.clientHeight) || 0
    };
  }

  /* 尺寸：优先 offsetWidth/Height（不受祖先 transform 影响） */
  function elementSize(host) {
    if (!host) return { w: 0, h: 0 };
    var w = host.offsetWidth || 0, h = host.offsetHeight || 0;
    if ((!w || !h) && host._petShadow) {
      var wrap = host._petShadow.querySelector('.pet-wrap');
      if (wrap) { w = w || wrap.offsetWidth || 0; h = h || wrap.offsetHeight || 0; }
    }
    return { w: w, h: h };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* 当前读数：当前位置(px)、尺寸、视口 */
  function read(host) {
    var v = viewSize(host && host.ownerDocument && host.ownerDocument.defaultView);
    var s = elementSize(host);
    var st = host ? host.style : {};
    var right = U.parseLen(st.right, v);
    var bottom = U.parseLen(st.bottom, v);
    return {
      vw: v.vw, vh: v.vh,
      w: s.w, h: s.h,
      right: isFinite(right) ? right : clamp(6, 0, v.vw),
      bottom: isFinite(bottom) ? bottom : 6
    };
  }

  /* 计算最终的 right/bottom/scale，保证整只可见 */
  function compute(host, opts) {
    opts = opts || {};
    var r = read(host);
    var inset = CFG.edgeInsetPx;
    var availW = r.vw - inset * 2;
    var availH = r.vh - inset * 2;
    if (availW <= 0 || availH <= 0) return { right: inset, bottom: inset, scale: 1, w: r.w, h: r.h };

    /* 装不下就等比缩放 */
    var scale = 1;
    if (r.w > 0 && r.w > availW) scale = Math.min(scale, availW / r.w);
    if (r.h > 0 && r.h > availH) scale = Math.min(scale, availH / r.h);
    scale = clamp(scale, CFG.minScale, 1);

    var ew = r.w * scale, eh = r.h * scale;

    var minR = inset, maxR = Math.max(inset, r.vw - ew - inset);
    var minB = inset, maxB = Math.max(inset, r.vh - eh - inset);

    /* 可选：只准待在下方区域，避免盖住聊天顶栏 */
    if (!CFG.allowTopZone && !opts.allowTopZone) {
      var zoneTopY = r.vh * (1 - CFG.bottomZonePct / 100);
      var bLimit = r.vh - zoneTopY - eh;
      if (bLimit < maxB) { if (bLimit >= minB) maxB = bLimit; }
    }

    return {
      right: clamp(r.right, minR, maxR),
      bottom: clamp(r.bottom, minB, maxB),
      scale: scale,
      w: r.w, h: r.h,
      clamped: false
    };
  }

  /* 应用（写回 style），返回计算结果 */
  function apply(host, opts) {
    if (!host) return null;
    var res = compute(host, opts);
    var rp = res.right.toFixed(1) + 'px';
    var bp = res.bottom.toFixed(1) + 'px';
    if (host.style.right !== rp) host.style.right = rp;
    if (host.style.bottom !== bp) host.style.bottom = bp;
    var tf = res.scale >= 0.999 ? '' : 'scale(' + res.scale.toFixed(4) + ')';
    if (host.style.transform !== tf) host.style.transform = tf;
    /* 给包里的 CSS 一个可用的缩放变量 */
    try { host.style.setProperty('--pet-scale', String(res.scale)); } catch (e) {}
    return res;
  }

  /* 位置是否已经"跑出可见区"（用于自愈判断） */
  function isOutOfView(host) {
    if (!host) return false;
    var v = viewSize();
    var res = compute(host, {});
    /* 若当前位置和夹取后的位置差很多，说明越界了 */
    var r = read(host);
    return Math.abs(r.right - res.right) > 2 || Math.abs(r.bottom - res.bottom) > 2;
  }

  /* 监听尺寸变化，自动重新夹取 */
  function watch(host, onChange) {
    var win = (host && host.ownerDocument && host.ownerDocument.defaultView) || window;
    var scheduled = false;
    function fire() {
      if (scheduled) return;
      scheduled = true;
      var run = function () {
        scheduled = false;
        var res = apply(host);
        if (typeof onChange === 'function') onChange(res);
      };
      try { win.requestAnimationFrame(run); } catch (e) { win.setTimeout(run, 30); }
    }
    try { win.addEventListener('resize', fire); } catch (e) {}
    try { win.addEventListener('orientationchange', fire); } catch (e) {}
    try {
      if (win.visualViewport) {
        win.visualViewport.addEventListener('resize', fire);
        win.visualViewport.addEventListener('scroll', fire);
      }
    } catch (e) {}
    try {
      if (win.ResizeObserver) new win.ResizeObserver(fire).observe(host);
    } catch (e) {}
    var iv = null;
    try { iv = win.setInterval(fire, 1000); } catch (e) {}
    return {
      fire: fire,
      stop: function () { try { if (iv) win.clearInterval(iv); } catch (e) {} }
    };
  }

  window.PetPos = {
    CFG: CFG,
    viewSize: viewSize,
    elementSize: elementSize,
    read: read,
    compute: compute,
    apply: apply,
    isOutOfView: isOutOfView,
    watch: watch
  };
})();
