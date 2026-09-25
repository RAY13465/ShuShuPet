/* ============================================================================
 * 鼠鼠桌宠 · core/adapter.js
 * 与酒馆的接线层：
 *   - 按包契约解析模型输出里的标签
 *   - 读聊天消息（酒馆助手 API 优先，回退 context.chat）
 *   - 订阅酒馆事件触发刷新
 *   - 修复根元素包含块导致的 position:fixed 失效（酒馆 style.css 的 -webkit-perspective）
 *   - 看门狗：脚本被杀/页面卸载时收拾现场
 * 挂在 window.PetAdapter
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;

  var ROOT_FIX_PROPS = [
    'transform', '-webkit-transform',
    'perspective', '-webkit-perspective'
  ];

  /* ===================== 1. 根元素包含块修复 =====================
     酒馆 public/style.css 里给 html 加了 -webkit-perspective:1000，
     它会让 <html> 成为所有 position:fixed 后代的包含块，导致 fixed 元素整体偏移。
     这里运行时覆盖掉（不动酒馆自己的文件）。 */
  function fixRootContainingBlock(doc) {
    try {
      var el = doc.documentElement;
      if (!el || !el.style) return;
      for (var i = 0; i < ROOT_FIX_PROPS.length; i++) {
        var p = ROOT_FIX_PROPS[i];
        if (el.style.getPropertyValue(p) !== 'none') {
          el.style.setProperty(p, 'none', 'important');
        }
      }
    } catch (e) {}
  }
  function injectRootFixCss(doc) {
    try {
      var id = 'shushu-pet-root-fix';
      if (doc.getElementById(id)) return;
      var st = doc.createElement('style');
      st.id = id;
      st.textContent =
        'html, html:root{transform:none !important;-webkit-transform:none !important;' +
        'perspective:none !important;-webkit-perspective:none !important;}';
      (doc.head || doc.documentElement).appendChild(st);
    } catch (e) {}
  }
  function startRootFixLoop(win, doc) {
    fixRootContainingBlock(doc);
    injectRootFixCss(doc);
    try { win.setInterval(function () { fixRootContainingBlock(doc); }, 1000); } catch (e) {}
  }

  /* ===================== 2. 读消息 ===================== */
  function getContext(win) {
    try { return win.SillyTavern.getContext(); } catch (e) { return null; }
  }

  /* 往前取 limit 条 AI 消息原文，最新的排前面 */
  function recentAiTexts(win, limit) {
    var out = [];
    var ctx = getContext(win);

    /* 优先酒馆助手 API */
    try {
      if (typeof win.getChatMessages === 'function' && typeof win.getLastMessageId === 'function') {
        var lastId = win.getLastMessageId();
        for (var i = lastId; i >= 0 && out.length < limit; i--) {
          var arr = win.getChatMessages(String(i));
          var m = arr && arr[0];
          if (m && m.role === 'assistant') out.push(String(m.message || ''));
        }
        if (out.length) return out;
      }
    } catch (e) {}

    /* 回退：酒馆原生 context.chat */
    try {
      var chat = ctx && ctx.chat;
      if (chat && chat.length) {
        for (var j = chat.length - 1; j >= 0 && out.length < limit; j--) {
          var c = chat[j];
          if (c && !c.is_user && !c.is_system) out.push(String(c.mes || ''));
        }
      }
    } catch (e) {}
    return out;
  }

  /* ===================== 3. 解析标签 ===================== */
  function buildTagRegex(tag) {
    var t = String(tag || 'PetState').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('<' + t + '>\\s*([\\s\\S]*?)\\s*</' + t + '>', 'g');
  }

  function stripHtmlEntities(s) {
    return String(s)
      .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }

  function lenientJson(text) {
    var cleaned = String(text)
      .replace(/\/\/[^\n\r]*/g, '')          /* 行注释 */
      .replace(/\/\*[\s\S]*?\*\//g, '')      /* 块注释 */
      .replace(/,\s*([}\]])/g, '$1')         /* 尾逗号 */
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')  /* 裸键名 */
      .replace(/'/g, '"');                   /* 单引号 */
    return JSON.parse(cleaned);
  }

  /* 从一段文本里取出最后一段符合契约的数据 */
  function extractData(pkg, text) {
    if (!text) return null;
    var re = buildTagRegex((pkg.contract && pkg.contract.tag) || 'PetState');
    var m, last = null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) last = m[1];
    if (!last) return null;

    var raw = stripHtmlEntities(last);
    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) {}
    if (!obj) { try { obj = lenientJson(raw); } catch (e) {} }
    if (!obj || typeof obj !== 'object') return null;
    return normalize(pkg, obj);
  }

  /* ===================== 4. 按契约校验/补默认 ===================== */
  function normalize(pkg, data) {
    var c = (pkg && pkg.contract) || {};
    var fields = c.fields || [];
    var defaults = c.defaults || {};
    var out = {};

    /* 先铺默认值 */
    Object.keys(defaults).forEach(function (k) { out[k] = defaults[k]; });
    fields.forEach(function (f) {
      if (f && f.name && f.default !== undefined) out[f.name] = f.default;
    });

    fields.forEach(function (f) {
      if (!f || !f.name) return;
      var v = data[f.name];
      if (v === undefined || v === null) return;

      switch (f.type) {
        case 'enum':
          if (!Array.isArray(f.values) || f.values.indexOf(v) >= 0) out[f.name] = v;
          else U.warn('字段 ' + f.name + ' 收到未定义取值：' + v);
          break;
        case 'bool':
          out[f.name] = (v === true || v === 'true' || v === 1 || v === '1');
          break;
        case 'number':
          var n = Number(v);
          if (isFinite(n)) {
            if (typeof f.min === 'number') n = Math.max(f.min, n);
            if (typeof f.max === 'number') n = Math.min(f.max, n);
            out[f.name] = n;
          }
          break;
        case 'list':
          var arr = Array.isArray(v) ? v : String(v).split(/[,，\s]+/);
          arr = arr.filter(function (x) { return x !== '' && x !== null && x !== undefined; });
          if (Array.isArray(f.values)) {
            arr = arr.filter(function (x) { return f.values.indexOf(x) >= 0; });
          }
          if (typeof f.maxItems === 'number') arr = arr.slice(0, f.maxItems);
          out[f.name] = arr;
          break;
        case 'text':
        default:
          out[f.name] = String(v);
          break;
      }
    });
    return out;
  }

  /* 取当前聊天里最近一条有效数据 */
  function currentData(win, pkg) {
    var limit = (pkg.contract && pkg.contract.lookback) || 10;
    var texts = recentAiTexts(win, limit);
    for (var i = 0; i < texts.length; i++) {
      var d = extractData(pkg, texts[i]);
      if (d) return d;
    }
    return null;
  }

  /* ===================== 5. 事件订阅 ===================== */
  var EVENTS = [
    'MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED',
    'MESSAGE_DELETED', 'CHAT_CHANGED', 'GENERATION_ENDED'
  ];
  function listen(win, handler) {
    var bound = false;
    try {
      if (typeof win.eventOn === 'function' && typeof win.tavern_events !== 'undefined') {
        EVENTS.forEach(function (k) { if (win.tavern_events[k]) win.eventOn(win.tavern_events[k], handler); });
        bound = true;
      }
    } catch (e) {}
    if (!bound) {
      try {
        var ctx = getContext(win);
        if (ctx && ctx.eventSource && ctx.event_types) {
          EVENTS.forEach(function (k) {
            var t = ctx.event_types[k];
            if (t) ctx.eventSource.on(t, handler);
          });
          bound = true;
        }
      } catch (e) {}
    }
    var iv = null;
    if (!bound) { try { iv = win.setInterval(handler, 3000); } catch (e) {} }
    return { bound: bound, interval: iv };
  }

  window.PetAdapter = {
    ROOT_FIX_PROPS: ROOT_FIX_PROPS,
    fixRootContainingBlock: fixRootContainingBlock,
    injectRootFixCss: injectRootFixCss,
    startRootFixLoop: startRootFixLoop,
    getContext: getContext,
    recentAiTexts: recentAiTexts,
    buildTagRegex: buildTagRegex,
    extractData: extractData,
    normalize: normalize,
    currentData: currentData,
    listen: listen,
    EVENTS: EVENTS
  };
})();
