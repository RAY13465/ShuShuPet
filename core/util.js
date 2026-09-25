/* ============================================================================
 * 鼠鼠桌宠 · core/util.js
 * 基础工具：日志、事件、存储、深合并。挂在 window.PetUtil
 * ========================================================================== */
(function () {
  'use strict';

  var LOG_PREFIX = '[鼠鼠桌宠]';

  function log() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(LOG_PREFIX);
      console.log.apply(console, a);
    } catch (e) {}
  }
  function warn() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(LOG_PREFIX);
      console.warn.apply(console, a);
    } catch (e) {}
  }

  /* ---------- 深合并：用 patch 覆盖 base，返回新对象 ---------- */
  function isPlain(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function deepMerge(base, patch) {
    var out = Array.isArray(base) ? base.slice() : assign({}, base || {});
    if (!isPlain(patch)) return out;
    Object.keys(patch).forEach(function (k) {
      var pv = patch[k], bv = out[k];
      if (isPlain(pv) && isPlain(bv)) out[k] = deepMerge(bv, pv);
      else out[k] = pv;
    });
    return out;
  }
  function assign(t) {
    for (var i = 1; i < arguments.length; i++) {
      var s = arguments[i];
      if (!s) continue;
      Object.keys(s).forEach(function (k) { t[k] = s[k]; });
    }
    return t;
  }
  function clone(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  /* ---------- 安全存储（localStorage 可能被禁用） ---------- */
  var mem = {};
  var store = {
    get: function (k, dflt) {
      try {
        var s = localStorage.getItem(k);
        if (s === null || s === undefined) return k in mem ? mem[k] : dflt;
        return JSON.parse(s);
      } catch (e) {
        return k in mem ? mem[k] : dflt;
      }
    },
    set: function (k, v) {
      mem[k] = v;
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) {
      delete mem[k];
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  /* ---------- 极简事件总线 ---------- */
  function Emitter() {
    this._h = {};
  }
  Emitter.prototype.on = function (ev, fn) {
    (this._h[ev] = this._h[ev] || []).push(fn);
    return this;
  };
  Emitter.prototype.off = function (ev, fn) {
    var l = this._h[ev];
    if (!l) return this;
    this._h[ev] = l.filter(function (f) { return f !== fn; });
    return this;
  };
  Emitter.prototype.emit = function (ev) {
    var args = Array.prototype.slice.call(arguments, 1);
    (this._h[ev] || []).slice().forEach(function (f) {
      try { f.apply(null, args); } catch (e) { warn('事件回调出错', ev, e); }
    });
    return this;
  };

  /* ---------- 杂项 ---------- */
  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  /* 解析 CSS 长度成像素（支持 % / px / vh / vw） */
  function parseLen(val, ref) {
    if (isFiniteNum(val)) return val;
    if (typeof val !== 'string') return NaN;
    var s = val.trim();
    var m = /^(-?[\d.]+)\s*(px|%|vh|vw|em|rem)?$/.exec(s);
    if (!m) return NaN;
    var n = parseFloat(m[1]);
    if (isNaN(n)) return NaN;
    var unit = m[2] || 'px';
    var vw = (ref && ref.vw) || 0, vh = (ref && ref.vh) || 0;
    switch (unit) {
      case 'px': return n;
      case '%': return vh * n / 100;       /* 垂直方向默认按高度 */
      case 'vh': return vh * n / 100;
      case 'vw': return vw * n / 100;
      case 'em':
      case 'rem': return n * 16;
      default: return n;
    }
  }

  window.PetUtil = {
    log: log,
    warn: warn,
    deepMerge: deepMerge,
    assign: assign,
    clone: clone,
    store: store,
    Emitter: Emitter,
    isPlain: isPlain,
    isFiniteNum: isFiniteNum,
    parseLen: parseLen
  };
})();
