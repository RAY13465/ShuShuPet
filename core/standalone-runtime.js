/* ============================================================================
 * 鼠鼠桌宠 · core/standalone-runtime.js
 * ----------------------------------------------------------------------------
 * 独立运行时：这份代码会被「导出」功能拼进生成的文件里，
 * 让桌宠**不依赖本扩展**也能在酒馆助手的脚本环境里跑起来。
 *
 * 生成的文件结构：
 *   (function(){
 *     var __PET_PKG__ = {...};      // 导出的包数据
 *     ...本文件的内容...             // 解析 + 渲染 + 交互 + 定位 + 保活
 *   })();
 *
 * 本文件**不**由 index.js 加载，只在导出时被读取。
 * 它自带全部实现，不依赖 PetDom / PetPos / PetEngine。
 * ========================================================================== */
(function () {
  'use strict';

  var PKG = (typeof __PET_PKG__ !== 'undefined') ? __PET_PKG__ : null;
  if (!PKG) return;

  var BASE = PKG.base || '';              /* 包所在目录，用于解析相对素材路径 */
  var HOST_ID = 'shushu-standalone-pet';
  var Z = (PKG.render && PKG.render.zIndex) || 3500;
  var SIZE = (PKG.render && PKG.render.size) || '25.5vh';
  var TAG = (PKG.contract && PKG.contract.tag) || 'PetState';
  var LOOKBACK = (PKG.contract && PKG.contract.lookback) || 10;
  var INSET = 6;
  var BOTTOM_ZONE = 60;                   /* 允许待在屏幕下 60% 以内 */

  /* ---------- 找到真正的酒馆页面 ---------- */
  function outerWin() {
    try {
      if (window.parent && window.parent !== window &&
          (window.parent.SillyTavern || window.parent.document.getElementById('chat'))) {
        return window.parent;
      }
    } catch (e) {}
    if (window.SillyTavern || document.getElementById('chat')) return window;
    try { if (window.parent && window.parent !== window) return window.parent; } catch (e) {}
    return null;
  }
  var W = outerWin();
  if (!W) return;
  var D = W.document;

  /* ---------- 素材路径 ---------- */
  function asset(src) {
    if (!src) return '';
    if (/^(https?:)?\/\//i.test(src) || /^data:/i.test(src) || /^blob:/i.test(src)) return src;
    if (!BASE) return src;
    return BASE.replace(/\/?$/, '/') + String(src).replace(/^\.?\//, '');
  }

  /* 图层微调 → CSS（与扩展内同一套规则） */
  function layerTransform(tf) {
    if (!tf) return '';
    var x = Number(tf.x) || 0, y = Number(tf.y) || 0;
    var sc = (tf.scale === undefined || tf.scale === null || tf.scale === '') ? 1 : Number(tf.scale);
    var rot = Number(tf.rotate) || 0;
    var op = (tf.opacity === undefined || tf.opacity === null || tf.opacity === '') ? 1 : Number(tf.opacity);
    if (!x && !y && sc === 1 && !rot && op === 1) return '';
    var parts = [];
    if (x || y) parts.push('translate(' + x + '%,' + y + '%)');
    if (sc !== 1) parts.push('scale(' + sc + ')');
    if (rot) parts.push('rotate(' + rot + 'deg)');
    var css = parts.length ? ('transform:' + parts.join(' ') + ';transform-origin:center center;') : '';
    if (op !== 1) css += 'opacity:' + op + ';';
    return css;
  }

  /* ---------- 图层解析（与扩展内引擎同一套规则） ---------- */
  function hasValue(v) {
    return !(v === undefined || v === null || v === '' || v === false ||
             (Object.prototype.toString.call(v) === '[object Array]' && v.length === 0));
  }
  function skip(layer, d) {
    var sw = layer.skipWhen;
    if (!sw) return false;
    if (typeof sw === 'string') return hasValue(d[sw]);
    if (sw.equals !== undefined) {
      var a = Object.prototype.toString.call(sw.equals) === '[object Array]' ? sw.equals : [sw.equals];
      return a.indexOf(d[sw.field]) >= 0;
    }
    if (sw.notEquals !== undefined) {
      var b = Object.prototype.toString.call(sw.notEquals) === '[object Array]' ? sw.notEquals : [sw.notEquals];
      return b.indexOf(d[sw.field]) < 0;
    }
    if (sw.empty === true) return !d[sw.field];
    if (sw.notEmpty === true) return !!d[sw.field];
    return false;
  }
  function resolveLayers(d) {
    var out = [], defs = PKG.layers || [], i, L, v, arr, j, k;
    for (i = 0; i < defs.length; i++) {
      L = defs[i];
      if (!L || skip(L, d)) continue;
      var z = (typeof L.z === 'number') ? L.z : (i + 1) * 10;
      var src = null, tf = null;
      if (L.type === 'base') { src = L.asset || null; tf = L.tf || null; }
      else if (L.type === 'enum') {
        v = d[L.field];
        if (v && L.map && L.map[v]) {
          src = L.map[v];
          tf = (L.transforms && L.transforms[v]) || L.tf || null;
        }
      }
      else if (L.type === 'bool') {
        v = d[L.field]; k = v ? 'true' : 'false';
        if (L.map && L.map[k]) { src = L.map[k]; tf = (L.transforms && L.transforms[k]) || L.tf || null; }
      }
      else if (L.type === 'exists') { if (d[L.field]) src = L.asset || (L.map && L.map['default']) || null; }
      else if (L.type === 'list') {
        arr = d[L.field];
        if (Object.prototype.toString.call(arr) === '[object Array]' && L.map) {
          for (j = 0; j < arr.length; j++) {
            if (arr[j] && L.map[arr[j]]) {
              out.push({
                src: asset(L.map[arr[j]]),
                z: z,
                tf: (L.transforms && L.transforms[arr[j]]) || L.tf || null
              });
            }
          }
        }
        continue;
      }
      if (src) out.push({ src: asset(src), z: z, tf: tf });
    }
    out.sort(function (a, b) { return a.z - b.z; });
    return out;
  }

  /* ---------- 契约校验（模型乱写时兜住） ---------- */
  function normalize(raw) {
    var c = PKG.contract || {}, fields = c.fields || [], out = {}, i, f, v;
    for (i = 0; i < fields.length; i++) {
      f = fields[i];
      if (f && f.name && f['default'] !== undefined) out[f.name] = f['default'];
    }
    for (i = 0; i < fields.length; i++) {
      f = fields[i];
      if (!f || !f.name) continue;
      v = raw[f.name];
      if (v === undefined || v === null) continue;
      if (f.type === 'enum') { if (!f.values || f.values.indexOf(v) >= 0) out[f.name] = v; }
      else if (f.type === 'bool') out[f.name] = (v === true || v === 'true' || v === 1 || v === '1');
      else if (f.type === 'number') { var n = Number(v); if (isFinite(n)) out[f.name] = n; }
      else if (f.type === 'list') {
        var a = Object.prototype.toString.call(v) === '[object Array]' ? v.slice() : String(v).split(/[,，\s]+/);
        var keep = [];
        for (var j = 0; j < a.length; j++) {
          if (!a[j]) continue;
          if (!f.values || f.values.indexOf(a[j]) >= 0) keep.push(a[j]);
        }
        if (typeof f.maxItems === 'number') keep = keep.slice(0, f.maxItems);
        out[f.name] = keep;
      } else out[f.name] = String(v);
    }
    return out;
  }

  /* ---------- 读聊天里的标签 ---------- */
  function stripEntities(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }
  function lenient(text) {
    return JSON.parse(String(text)
      .replace(/\/\/[^\n\r]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"'));
  }
  var TAG_RE = new RegExp('<' + TAG + '>\\s*([\\s\\S]*?)\\s*</' + TAG + '>', 'g');

  function parseOne(text) {
    if (!text) return null;
    TAG_RE.lastIndex = 0;
    var m, last = null;
    while ((m = TAG_RE.exec(text))) last = m[1];
    if (!last) return null;
    var raw = stripEntities(last), obj = null;
    try { obj = JSON.parse(raw); } catch (e) {}
    if (!obj) { try { obj = lenient(raw); } catch (e2) {} }
    if (!obj || typeof obj !== 'object') return null;
    return normalize(obj);
  }

  function recentTexts(limit) {
    var out = [];
    try {
      if (typeof getChatMessages === 'function' && typeof getLastMessageId === 'function') {
        var lastId = getLastMessageId();
        for (var i = lastId; i >= 0 && out.length < limit; i--) {
          var arr = getChatMessages(String(i));
          var m = arr && arr[0];
          if (m && m.role === 'assistant') out.push(String(m.message || ''));
        }
        if (out.length) return out;
      }
    } catch (e) {}
    try {
      var c = W.SillyTavern.getContext();
      var chat = c && c.chat;
      if (chat && chat.length) {
        for (var j = chat.length - 1; j >= 0 && out.length < limit; j--) {
          var mm = chat[j];
          if (mm && !mm.is_user && !mm.is_system) out.push(String(mm.mes || ''));
        }
      }
    } catch (e3) {}
    return out;
  }

  function currentData() {
    var texts = recentTexts(LOOKBACK);
    for (var i = 0; i < texts.length; i++) {
      var d = parseOne(texts[i]);
      if (d) return d;
    }
    return null;
  }

  /* ==================== 1. 修根元素包含块 ====================
     酒馆 style.css 给 html 加了 -webkit-perspective，
     它会让 position:fixed 的参照系变成 <html>，fixed 元素整体偏移。 */
  var FIX = ['transform', '-webkit-transform', 'perspective', '-webkit-perspective'];
  function fixRoot() {
    try {
      var el = D.documentElement;
      if (!el || !el.style) return;
      for (var i = 0; i < FIX.length; i++) {
        if (el.style.getPropertyValue(FIX[i]) !== 'none') el.style.setProperty(FIX[i], 'none', 'important');
      }
    } catch (e) {}
  }
  fixRoot();
  try { W.setInterval(fixRoot, 1500); } catch (e) {}

  /* ==================== 2. 位置：整只留在可见区 ==================== */
  function viewSize() {
    return {
      vw: W.innerWidth || D.documentElement.clientWidth || 0,
      vh: W.innerHeight || D.documentElement.clientHeight || 0
    };
  }
  function elSize(host) {
    var w = host.offsetWidth || 0, h = host.offsetHeight || 0;
    if ((!w || !h) && host._standaloneShadow) {
      var wrap = host._standaloneShadow.querySelector('.pet-wrap');
      if (wrap) { w = w || wrap.offsetWidth || 0; h = h || wrap.offsetHeight || 0; }
    }
    return { w: w, h: h };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function parsePx(v, vh) {
    if (v === undefined || v === null || v === '') return NaN;
    var s = String(v).trim(), m = /^(-?[\d.]+)\s*(px|%|vh)?$/.exec(s);
    if (!m) return NaN;
    var n = parseFloat(m[1]);
    if (isNaN(n)) return NaN;
    var u = m[2] || 'px';
    return u === 'px' ? n : (u === '%' || u === 'vh') ? vh * n / 100 : n;
  }
  function applyPos(host) {
    try {
      var v = viewSize();
      if (!v.vw || !v.vh) return;
      var s = elSize(host);
      var availW = v.vw - INSET * 2, availH = v.vh - INSET * 2;
      var sc = 1;
      if (s.w > 0 && s.w > availW) sc = Math.min(sc, availW / s.w);
      if (s.h > 0 && s.h > availH) sc = Math.min(sc, availH / s.h);
      sc = clamp(sc, 0.2, 1);
      var tf = sc >= 0.999 ? '' : 'scale(' + sc.toFixed(4) + ')';
      if (host.style.transform !== tf) host.style.transform = tf;
      var ew = s.w * sc, eh = s.h * sc;

      var right = parsePx(host.style.right, v.vh);
      var bottom = parsePx(host.style.bottom, v.vh);
      if (isNaN(right)) right = INSET;
      if (isNaN(bottom)) bottom = INSET;

      var minR = INSET, maxR = Math.max(INSET, v.vw - ew - INSET);
      var minB = INSET, maxB = Math.max(INSET, v.vh - eh - INSET);
      var zoneTop = v.vh * (1 - BOTTOM_ZONE / 100);
      var bLimit = v.vh - zoneTop - eh;
      if (bLimit < maxB && bLimit >= minB) maxB = bLimit;

      host.style.right = clamp(right, minR, maxR).toFixed(1) + 'px';
      host.style.bottom = clamp(bottom, minB, maxB).toFixed(1) + 'px';
    } catch (e) {}
  }
  var raf = null;
  function schedulePos() {
    if (raf) return;
    try { raf = W.requestAnimationFrame(function () { raf = null; var h = D.getElementById(HOST_ID); if (h) applyPos(h); }); }
    catch (e) { raf = null; }
  }
  try { W.addEventListener('resize', schedulePos); } catch (e) {}
  try { if (W.visualViewport) W.visualViewport.addEventListener('resize', schedulePos); } catch (e) {}
  try { W.setInterval(schedulePos, 1000); } catch (e) {}

  /* ==================== 3. 渲染 ==================== */
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function motionClass(name) {
    var m = PKG.motions && PKG.motions[name];
    return (m && m.className) || (name && name !== 'still' ? 'pet-m-' + name : '');
  }
  function buildShell(d, open) {
    var layers = resolveLayers(d);
    var imgs = layers.map(function (L) {
      return '<img class="pet-layer" style="z-index:' + L.z + ';' + layerTransform(L.tf) + '" src="' + escapeHtml(L.src) + '" alt="">';
    }).join('');
    var speech = (d && d.speech != null) ? String(d.speech) : '';
    return '' +
      '<style>' +
      ':host{all:initial;display:block;pointer-events:auto;}' +
      '.pet-wrap{position:relative;width:' + SIZE + ';height:' + SIZE + ';cursor:grab;' +
        'user-select:none;-webkit-user-select:none;touch-action:none;transform-origin:bottom center;}' +
      '.pet-wrap.pet-dragging{cursor:grabbing;}' +
      '.pet-stack{position:absolute;inset:0;transform-origin:bottom center;opacity:1;' +
        'transition:opacity .1s linear;}' +
      '.pet-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
        '-webkit-user-drag:none;pointer-events:none;}' +
      '.pet-bubble{position:absolute;bottom:calc(100% - 20px);left:-35px;z-index:0;display:inline-block;' +
        'text-align:left;min-width:100px;max-width:min(170px,40vw);' +
        'background:' + ((PKG.render && PKG.render.bubbleBg) || '#1c1c1c') + ' !important;' +
        'color:' + ((PKG.render && PKG.render.bubbleColor) || '#e0e0e0') + ' !important;' +
        'border-radius:14px !important;padding:10px 13px !important;font-weight:normal !important;' +
        'background-image:none !important;-webkit-text-fill-color:inherit !important;' +
        'font-family:\'PingFang SC\',\'Noto Sans SC\',sans-serif;font-size:13px;line-height:1.6;' +
        'box-shadow:0 6px 18px rgba(90,80,70,.18);transform-origin:bottom left;' +
        'transform:translateY(6px) scale(.94);pointer-events:none;' +
        'transition:opacity .26s cubic-bezier(.22,.61,.36,1),transform .26s cubic-bezier(.22,.61,.36,1);}' +
      '.pet-bubble.pet-show{opacity:1;transform:translateY(0) scale(1);}' +
      /* 导出时算好的气泡/动作 CSS，覆盖上面那份兜底样式 */
      (PKG.style || '') +
      '</style>' +
      '<div class="pet-wrap ' + motionClass(d && d.motion) + '" data-pet-drag="1">' +
        '<div class="pet-bubble' + (open ? ' pet-show' : '') + '">' + escapeHtml(speech) + '</div>' +
        '<div class="pet-stack">' + imgs + '</div>' +
      '</div>';
  }

  function updatePet(shadow, d, open) {
    var wrap = shadow.querySelector('.pet-wrap');
    if (!wrap) return;
    var bubble = shadow.querySelector('.pet-bubble');
    if (bubble) {
      bubble.textContent = (d && d.speech != null) ? String(d.speech) : '';
      if (open) bubble.classList.add('pet-show'); else bubble.classList.remove('pet-show');
    }
    var m = PKG.motions || {};
    for (var k in m) if (m.hasOwnProperty(k)) wrap.classList.remove(m[k].className || 'pet-m-' + k);
    void wrap.offsetWidth;
    var mc = motionClass(d && d.motion);
    if (mc) wrap.classList.add(mc);

    var oldStack = wrap.querySelector('.pet-stack');
    var ns = D.createElement('div');
    ns.className = 'pet-stack';
    ns.style.opacity = '0';
    var layers = resolveLayers(d);
    ns.innerHTML = layers.map(function (L) {
      return '<img class="pet-layer" style="z-index:' + L.z + ';' + layerTransform(L.tf) + '" src="' + escapeHtml(L.src) + '" alt="">';
    }).join('');
    wrap.appendChild(ns);
    W.setTimeout(function () { ns.style.opacity = '1'; if (oldStack) oldStack.style.opacity = '0'; }, 20);
    W.setTimeout(function () { if (oldStack && oldStack.parentNode) oldStack.parentNode.removeChild(oldStack); }, 200);
  }

  /* ==================== 4. 拖动 / 点击气泡 ==================== */
  var bubbleOpen = false;
  function bindInteraction(shadow, host) {
    if (shadow._standaloneBound) return;
    shadow._standaloneBound = true;
    var drag = null, lastTouchEnd = 0;
    function pt(e) {
      if (e.touches) return e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      return { x: e.clientX, y: e.clientY };
    }
    function down(e) {
      if (e.type === 'mousedown' && Date.now() - lastTouchEnd < 600) return;
      var t = e.target && e.target.closest ? e.target.closest('[data-pet-drag]') : null;
      if (!t) return;
      var p = pt(e); if (!p) return;
      var r = parsePx(host.style.right, viewSize().vh) || 0;
      var b = parsePx(host.style.bottom, viewSize().vh) || 0;
      drag = { x: p.x, y: p.y, r: r, b: b, moved: false };
      t.classList.add('pet-dragging');
      try { e.preventDefault(); } catch (err) {}
    }
    function move(e) {
      if (!drag) return;
      var p = pt(e); if (!p) return;
      var dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) drag.moved = true;
      host.style.right = (drag.r - dx) + 'px';
      host.style.bottom = (drag.b - dy) + 'px';
      try { e.preventDefault(); } catch (err) {}
    }
    function up(e) {
      if (e.type === 'touchend') lastTouchEnd = Date.now();
      if (!drag) return;
      var wrap = shadow.querySelector('.pet-wrap');
      if (wrap) wrap.classList.remove('pet-dragging');
      if (drag.moved) applyPos(host);
      else {
        var bub = shadow.querySelector('.pet-bubble');
        if (bub) bubbleOpen = bub.classList.toggle('pet-show');
      }
      drag = null;
    }
    shadow.addEventListener('mousedown', down);
    shadow.addEventListener('touchstart', down, { passive: false });
    D.addEventListener('mousemove', move);
    D.addEventListener('touchmove', move, { passive: false });
    D.addEventListener('mouseup', up);
    D.addEventListener('touchend', up);
  }

  /* ==================== 5. 挂载 / 刷新 ==================== */
  var lastSig = null;
  function mount(d) {
    var sig = JSON.stringify(d);
    var host = D.getElementById(HOST_ID);
    if (host && host._standaloneShadow) {
      if (sig !== lastSig) { updatePet(host._standaloneShadow, d, bubbleOpen); lastSig = sig; }
      host.style.display = 'block';
      applyPos(host);
      return;
    }
    host = D.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:' +
      ((PKG.render && PKG.render.startRight) || '1vh') + ';bottom:' +
      ((PKG.render && PKG.render.startBottom) || '6vh') + ';z-index:' + Z +
      ';width:auto;height:auto;background:transparent;border:none;margin:0;padding:0;pointer-events:auto;';
    D.body.appendChild(host);
    var shadow = host.attachShadow({ mode: 'open' });
    host._standaloneShadow = shadow;
    shadow.innerHTML = buildShell(d, bubbleOpen);
    lastSig = sig;
    bindInteraction(shadow, host);
    applyPos(host);
  }
  function hide() {
    var h = D.getElementById(HOST_ID);
    if (h) h.style.display = 'none';
  }
  function refresh() {
    try {
      var d = currentData();
      if (d) mount(d);
      else hide();      /* 当前聊天没有桌宠数据 → 按设计隐藏 */
    } catch (e) {}
  }
  var timer = null;
  function schedule() {
    if (timer) W.clearTimeout(timer);
    timer = W.setTimeout(refresh, 250);
  }

  /* 事件订阅：酒馆助手 > 酒馆事件源 > 轮询 */
  (function listen() {
    var EVS = ['MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED',
               'MESSAGE_DELETED', 'CHAT_CHANGED', 'GENERATION_ENDED'];
    var bound = false;
    try {
      if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined') {
        for (var i = 0; i < EVS.length; i++) if (tavern_events[EVS[i]]) eventOn(tavern_events[EVS[i]], schedule);
        bound = true;
      }
    } catch (e) {}
    if (!bound) {
      try {
        var c = W.SillyTavern.getContext();
        if (c && c.eventSource && c.event_types) {
          for (var j = 0; j < EVS.length; j++) if (c.event_types[EVS[j]]) c.eventSource.on(c.event_types[EVS[j]], schedule);
          bound = true;
        }
      } catch (e2) {}
    }
    if (!bound) { try { W.setInterval(schedule, 3000); } catch (e3) {} }
  })();

  /* 等酒馆就绪再启动 */
  var tries = 0;
  var boot = W.setInterval(function () {
    tries++;
    if (D.body && D.getElementById('chat')) {
      W.clearInterval(boot);
      refresh();
    } else if (tries >= 60) {
      W.clearInterval(boot);
    }
  }, 250);

  /* 对外留个调试/手动控制接口，方便排查 */
  try {
    W.__SHUSHU_PET_STANDALONE__ = {
      refresh: refresh,
      mount: mount,
      hide: hide,
      resolveLayers: resolveLayers,
      currentData: currentData,
      pkg: PKG,
      hostId: HOST_ID
    };
  } catch (e) {}

  try { console.log('[鼠鼠桌宠·独立版] 已启动：' + (PKG.name || PKG.id)); } catch (e) {}
})();
