/* ============================================================================
 * 鼠鼠桌宠 · core/engine.js
 * 渲染实例：负责把一个 pet package 画到页面上，并处理拖动/点击/图层淡入。
 * 挂在 window.PetEngine（由 core/boot.js 完成 boot 注册）
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;
  var D$ = window.PetDom;
  var P = window.PetPos;

  var HOST_ID = 'shushu-pet-host';
  var STATE_KEY = 'shushu-pet:state';

  function PetInstance(win, pkg, opts) {
    this.win = win;
    this.doc = win.document;
    this.pkg = pkg;
    this.opts = opts || {};
    this.host = null;
    this.shadow = null;
    this.lastSig = null;
    this._bubbleOpen = false;
    this._watch = null;
    this._drag = null;
    this._boundDrag = false;
  }

  PetInstance.prototype.state = function () {
    var s = U.store.get(STATE_KEY, null);
    if (!s || typeof s !== 'object') s = {};
    return s;
  };
  PetInstance.prototype.saveState = function (patch) {
    var s = U.store.get(STATE_KEY, {}) || {};
    U.store.set(STATE_KEY, U.assign(s, patch));
  };
  PetInstance.prototype.resetState = function () {
    U.store.del(STATE_KEY);
  };

  /* ---------------- 挂载 ---------------- */
  PetInstance.prototype.mount = function (data) {
    var self = this;
    var doc = this.doc;
    var sig = JSON.stringify(data);
    var st = this.state();
    var existing = doc.getElementById(HOST_ID);

    if (existing && existing._petShadow) {
      this.host = existing;
      this.shadow = existing._petShadow;
      /* 位置同步（状态里可能被自愈改过） */
      if (st.right) existing.style.right = st.right;
      if (st.bottom) existing.style.bottom = st.bottom;
      if (this.lastSig !== sig) {
        this.update(data);
        this.lastSig = sig;
      }
      P.apply(existing, this.opts);
      this.show();
      this.bindDrag();
      return;
    }

    var host = doc.createElement('div');
    host.id = HOST_ID;
    var r = st.right || (this.pkg.render && this.pkg.render.startRight) || '1vh';
    var b = st.bottom || (this.pkg.render && this.pkg.render.startBottom) || '6vh';
    host.style.cssText =
      'position:fixed;right:' + r + ';bottom:' + b + ';' +
      'z-index:' + ((this.pkg.render && this.pkg.render.zIndex) || 3500) + ';' +
      'width:auto;height:auto;background:transparent;border:none;margin:0;padding:0;' +
      'pointer-events:auto;';
    doc.body.appendChild(host);

    var shadow = host.attachShadow({ mode: 'open' });
    host._petShadow = shadow;
    this.host = host;
    this.shadow = shadow;

    this._bubbleOpen = !!st.open;
    shadow.innerHTML = D$.buildShellHtml(this.pkg, data, { open: this._bubbleOpen });
    this.lastSig = sig;

    P.apply(host, this.opts);
    this.show();
    this.bindDrag();
    if (this._watch) this._watch.stop();
    this._watch = P.watch(host, function () { self.saveState({ right: host.style.right, bottom: host.style.bottom }); });
    try { this.win.dispatchEvent(new this.win.CustomEvent('shushu-pet:mount', { detail: { pkg: this.pkg.id } })); } catch (e) {}
  };

  /* ---------------- 更新（换脸/换动作/换台词） ---------------- */
  PetInstance.prototype.update = function (data) {
    var sh = this.shadow;
    if (!sh) return;
    var wrap = sh.querySelector('.pet-wrap');
    if (!wrap) return;

    /* 台词 */
    var bubble = sh.querySelector('.pet-bubble');
    if (bubble) {
      var speech = (data && data.speech != null) ? String(data.speech) : '';
      if (bubble.textContent !== speech) bubble.textContent = speech;
      if (this._bubbleOpen) bubble.classList.add('pet-show');
      else bubble.classList.remove('pet-show');
    }

    /* 动作：清掉所有包的 motion class，再加新的 */
    var motions = (this.pkg.motions || {});
    Object.keys(motions).forEach(function (k) {
      var cls = motions[k].className || ('pet-m-' + k);
      wrap.classList.remove(cls);
    });
    void wrap.offsetWidth;                       /* 强制重排，让动画能重播 */
    var mc = D$.motionClass(this.pkg, data && data.motion);
    if (mc) wrap.classList.add(mc);

    /* 图层：新旧交叉淡入，避免闪一下 */
    var oldStack = wrap.querySelector('.pet-stack');
    var newStack = this.doc.createElement('div');
    newStack.className = 'pet-stack';
    newStack.style.opacity = '0';
    var layers = D$.resolveLayers(this.pkg, data);
    var html = layers.map(function (L) {
      return '<img class="pet-layer" style="z-index:' + L.z + '" src="' + D$.escapeHtml(L.src) + '" alt="">';
    }).join('');
    newStack.innerHTML = html;
    wrap.appendChild(newStack);

    var win = this.win;
    win.setTimeout(function () {
      newStack.style.opacity = '1';
      if (oldStack) oldStack.style.opacity = '0';
    }, 20);
    win.setTimeout(function () {
      if (oldStack && oldStack.parentNode) oldStack.parentNode.removeChild(oldStack);
    }, 200);
  };

  PetInstance.prototype.show = function () {
    if (this.host && this.host.style.display !== 'block') this.host.style.display = 'block';
  };
  PetInstance.prototype.hide = function () {
    if (this.host && this.host.style.display !== 'none') this.host.style.display = 'none';
  };
  PetInstance.prototype.isMounted = function () {
    return !!(this.host && this.host.parentNode);
  };
  PetInstance.prototype.destroy = function () {
    if (this._watch) { this._watch.stop(); this._watch = null; }
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
    this.shadow = null;
    this.lastSig = null;
  };

  /* ---------------- 拖动 + 点击气泡 ---------------- */
  PetInstance.prototype.bindDrag = function () {
    var self = this;
    if (this._boundDrag) return;
    var sh = this.shadow, doc = this.doc, win = this.win;
    if (!sh) return;
    this._boundDrag = true;

    var drag = null;
    var lastTouchEnd = 0;

    function pointOf(e) {
      if (e.touches) {
        if (!e.touches[0]) return null;
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      return { x: e.clientX, y: e.clientY };
    }

    function start(e) {
      if (e.type === 'mousedown' && Date.now() - lastTouchEnd < 600) return;
      var t = e.target && e.target.closest ? e.target.closest('[data-pet-drag]') : null;
      if (!t) return;
      var p = pointOf(e);
      if (!p) return;
      var v = P.viewSize(win);
      var host = self.host;
      var st = host.style;
      drag = {
        x: p.x, y: p.y,
        initRight: U.parseLen(st.right, v) || 0,
        initBottom: U.parseLen(st.bottom, v) || 0,
        moved: false
      };
      t.classList.add('pet-dragging');
      try { e.preventDefault(); } catch (err) {}
    }

    function move(e) {
      if (!drag) return;
      var p = pointOf(e);
      if (!p) return;
      var dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) drag.moved = true;
      self.host.style.right = (drag.initRight - dx) + 'px';
      self.host.style.bottom = (drag.initBottom - dy) + 'px';
      try { e.preventDefault(); } catch (err) {}
    }

    function end(e) {
      if (e.type === 'touchend') lastTouchEnd = Date.now();
      if (!drag) return;
      var wrap = sh.querySelector('.pet-wrap');
      if (wrap) wrap.classList.remove('pet-dragging');
      if (drag.moved) {
        P.apply(self.host, self.opts);                       /* 拖完自动夹回可见区 */
        self.saveState({ right: self.host.style.right, bottom: self.host.style.bottom });
      } else {
        var bubble = sh.querySelector('.pet-bubble');
        if (bubble) {
          self._bubbleOpen = bubble.classList.toggle('pet-show');
          self.saveState({ open: self._bubbleOpen });
        }
      }
      drag = null;
    }

    sh.addEventListener('mousedown', start);
    sh.addEventListener('touchstart', start, { passive: false });
    doc.addEventListener('mousemove', move);
    doc.addEventListener('touchmove', move, { passive: false });
    doc.addEventListener('mouseup', end);
    doc.addEventListener('touchend', end);
  };

  window.PetInstance = PetInstance;
  window.PetEngine = window.PetEngine || {};
  window.PetEngine.Instance = PetInstance;
  window.PetEngine.HOST_ID = HOST_ID;
  window.PetEngine.STATE_KEY = STATE_KEY;
})();
