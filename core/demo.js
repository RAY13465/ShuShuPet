/* ============================================================================
 * 鼠鼠桌宠 · core/demo.js
 * 演示 / 试跑：把编辑器里正在做的桌宠放到页面上实际跑起来。
 *
 * 与正式实例的区别：
 *   - 立刻可见（不要求聊天里有标签），用编辑器当前草稿生成包
 *   - 带一个控制条：切换每个字段的取值、动作、台词，改完即时生效
 *   - 编辑面板可以临时收起，方便看全貌
 *   - 拖动行为和正式桌宠一致
 * 挂在 window.PetDemo
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;
  var Dom = window.PetDom;
  var P = window.PetPos;

  var HOST_ID = 'shushu-pet-demo';
  var BAR_ID = 'shushu-pet-demo-bar';
  var PANEL_ID = 'shushu-pet-editor';

  /* 演示状态 */
  var st = {
    active: false,
    draft: null,
    data: {},
    hideBase: false,      /* 图层隔离：隐藏底图，只留叠图，方便检查对齐 */
    win: null,
    doc: null,
    host: null,
    inst: null,
    lastSig: null
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 空取值直接显示成空白按钮会让人不知道那是什么，给个好认的标签 */
  function enumLabel(v) {
    if (v === '') return '(不用)';
    if (v === 'still') return '不动';
    return String(v);
  }

  /* ==================== 累积式图层合成 ====================
     正式渲染是"每个字段只出一层"（模型只会给一个值）。
     演示要能同时看到"眼睛=smile + 配饰=帽子"，所以这里把每个字段选中的层
     全部累加起来，z 依次递增。
     opts.hideBase = true 时隐藏底图，方便作者检查自己的叠图有没有对齐。 */
  function buildLayers(pkg, sel, opts) {
    opts = opts || {};
    var layers = [];
    var z = 10;
    if (!opts.hideBase) {
      var base = (pkg.layers || []).filter(function (L) { return L.type === 'base'; })[0];
      if (base) layers.push({ src: Dom.resolveAsset(base.asset, pkg), z: z++ });
    }

    var fields = (pkg.contract && pkg.contract.fields) || [];
    fields.forEach(function (f) {
      /* 覆盖关系要在这里也生效：正式渲染的 resolveLayers 会检查 skipWhen，
         演示是另一套累积逻辑，必须自己检查一遍，否则黑脸和五官会叠成两张脸。 */
      var layerOf = function (name) {
        return (pkg.layers || []).filter(function (x) { return x.field === name; })[0];
      };
      if (f.type === 'enum') {
        var L = layerOf(f.name);
        if (!L || Dom.shouldSkip(L, sel)) return;
        var v = sel[f.name];
        if (v && L.map && L.map[v]) {
          layers.push({
            src: Dom.resolveAsset(L.map[v], pkg),
            z: z++,
            tf: (L.transforms && L.transforms[v]) || L.tf || null
          });
        }
      } else if (f.type === 'list') {
        var L2 = layerOf(f.name);
        if (!L2 || !L2.map) return;
        if (Dom.shouldSkip(L2, sel)) return;
        var arr = sel[f.name] || [];
        (Array.isArray(arr) ? arr : [arr]).forEach(function (k) {
          if (k && L2.map[k]) {
            layers.push({
              src: Dom.resolveAsset(L2.map[k], pkg),
              z: z++,
              tf: (L2.transforms && L2.transforms[k]) || L2.tf || null
            });
          }
        });
      }
    });
    return layers;
  }

  function initialSelection(pkg) {
    var sel = {};
    ((pkg.contract && pkg.contract.fields) || []).forEach(function (f) {
      if (f.type === 'enum') sel[f.name] = f.values && f.values.length ? f.values[0] : '';
      else if (f.type === 'list') sel[f.name] = [];
      else if (f.type === 'text') sel[f.name] = f.default || '演示台词';
      else if (f.type === 'bool') sel[f.name] = false;
    });
    return sel;
  }

  function speechField(pkg) {
    return ((pkg.contract && pkg.contract.fields) || []).filter(function (f) { return f.type === 'text'; })[0];
  }

  function motionField(pkg) {
    return ((pkg.contract && pkg.contract.fields) || []).filter(function (f) { return f.name === 'motion'; })[0];
  }

  /* ==================== 渲染 ==================== */
  function shellHtml(pkg, sel) {
    var layers = buildLayers(pkg, sel, { hideBase: st.hideBase });
    var size = (pkg.render && pkg.render.size) || '25.5vh';
    var mc = Dom.motionClass(pkg, sel.motion);
    var sp = speechField(pkg);
    var speech = sp ? (sel[sp.name] || '') : '';
    var imgs = layers.map(function (L) {
      return Dom.imgTag(L.src, L.z, L.tf);
    }).join('');
    return '' +
      '<style>' +
      ':host{all:initial;display:block;pointer-events:auto;}' +
      '.pet-wrap{position:relative;width:' + size + ';height:' + size + ';cursor:grab;' +
        'user-select:none;-webkit-user-select:none;touch-action:none;transform-origin:bottom center;}' +
      '.pet-stack{position:absolute;inset:0;transform-origin:bottom center;}' +
      '.pet-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
        '-webkit-user-drag:none;pointer-events:none;}' +
      Dom.buildBubbleCss(pkg) + '\n' +
      Dom.buildBubbleShowCss() + '\n' +
      Dom.buildMotionCss(pkg) +
      '</style>' +
      '<div class="pet-wrap ' + mc + '" data-pet-drag="1" data-demo-drag="1">' +
        '<div class="pet-bubble pet-show">' + esc(speech) + '</div>' +
        '<div class="pet-stack">' + imgs + '</div>' +
      '</div>';
  }

  function render() {
    var pkg = st.pkg;
    if (!pkg || !st.host) return;
    var sh = st.host._petShadow || (st.host._petShadow = st.host.attachShadow({ mode: 'open' }));
    sh.innerHTML = shellHtml(pkg, st.data);
    P.apply(st.host, {});
    renderBar();
  }

  /* ==================== 控制条 ==================== */
  function renderBar() {
    var bar = st.doc.getElementById(BAR_ID);
    if (!bar) return;
    var pkg = st.pkg;
    var fields = (pkg.contract && pkg.contract.fields) || [];
    var mf = motionField(pkg);
    var sf = speechField(pkg);
    var motionPresets = window.PetEditor ? Object.keys(window.PetEditor.MOTION_PRESETS) : [];

    var rows = fields.map(function (f) {
      if (f.type === 'text' || f.name === 'motion') return '';
      if (f.type === 'enum') {
        /* 注意：不能过滤掉空字符串——"" 往往是"不用这个效果"的合法取值（如 blackface） */
        var btns = (f.values || []).map(function (v) {
          var on = st.data[f.name] === v;
          return '<button data-demo="set" data-f="' + esc(f.name) + '" data-v="' + esc(v) + '" style="' +
            btnCss(on ? '#2e7d32' : '#333') + '">' + esc(enumLabel(v)) + '</button>';
        }).join('');
        return rowHtml(f.label || f.name, btns);
      }
      if (f.type === 'list') {
        var arr = st.data[f.name] || [];
        var b2 = (f.values || []).map(function (v) {
          var on = arr.indexOf(v) >= 0;
          return '<button data-demo="toggle" data-f="' + esc(f.name) + '" data-v="' + esc(v) + '" style="' +
            btnCss(on ? '#1565c0' : '#333') + '">' + esc(enumLabel(v)) + '</button>';
        }).join('');
        return rowHtml(f.label || f.name, b2);
      }
      return '';
    }).join('');

    var motionRow = mf ? rowHtml('动作', motionPresets.map(function (m) {
      var on = st.data.motion === m;
      return '<button data-demo="set" data-f="motion" data-v="' + esc(m) + '" style="' +
        btnCss(on ? '#6a4a9a' : '#333') + '">' + (window.PetEditor.MOTION_PRESETS[m].label || m) + '</button>';
    }).join('')) : '';

    var speechRow = sf
      ? '<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">' +
          '<div style="width:60px;flex:none;color:#9a9aa8;">台词</div>' +
          '<input data-demo="speech" value="' + esc(st.data[sf.name] || '') + '" ' +
            'style="flex:1;background:#101014;border:1px solid #3a3a44;border-radius:6px;color:#e8e8e8;padding:5px 8px;font-size:12px;">' +
        '</div>'
      : '';

    bar.innerHTML = '' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
        '<div style="flex:1;font-weight:700;">演示中</div>' +
        '<button data-demo="hidePanel" style="' + btnCss('#444') + '">' +
          (st.doc.getElementById(PANEL_ID) ? '收起编辑面板' : '展开编辑面板') + '</button>' +
        '<button data-demo="toggleBase" style="' + btnCss(st.hideBase ? '#1565c0' : '#444') + '">' +
          (st.hideBase ? '底图已隐藏（点开恢复）' : '隐藏底图查对齐') + '</button>' +
        '<button data-demo="reset" style="' + btnCss('#7f6a2b') + '">回到右下角</button>' +
        '<button data-demo="close" style="' + btnCss('#7f2b2b') + '">结束演示</button>' +
      '</div>' +
      '<div style="color:#888;font-size:11px;margin-bottom:8px;">' +
        '这个桌宠是照你当前填的内容生成的，可以直接拖动。改动会立刻反映到这里。' +
        (st.hideBase ? ' <b style="color:#8bc34a;">当前隐藏了底图</b>——正好用来检查五官有没有对齐。' : '') +
      '</div>' +
      rows + motionRow + speechRow;
  }

  function rowHtml(label, btns) {
    return '<div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">' +
      '<div style="width:60px;flex:none;color:#9a9aa8;padding-top:4px;">' + esc(label) + '</div>' +
      '<div style="flex:1;display:flex;flex-wrap:wrap;gap:4px;">' + btns + '</div>' +
      '</div>';
  }
  function btnCss(bg) {
    return 'padding:4px 8px;border:none;border-radius:6px;background:' + bg +
      ';color:#fff;font-size:11px;cursor:pointer;';
  }

  /* ==================== 启动 / 更新 / 结束 ==================== */
  function start(doc, draft, buildPackage, initialData) {
    stop(doc);
    st.win = doc.defaultView || window;
    st.doc = doc;
    st.draft = draft;
    st.build = buildPackage;
    st.pkg = buildPackage(draft);
    /* 用编辑器当前的选中值起步，保证预览和演示看到的是同一只 */
    st.data = initialData && typeof initialData === 'object'
      ? JSON.parse(JSON.stringify(initialData))
      : initialSelection(st.pkg);
    st.active = true;

    /* 演示用的桌宠元素 */
    var host = doc.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99997;width:auto;height:auto;' +
      'background:transparent;border:none;margin:0;padding:0;pointer-events:auto;';
    doc.body.appendChild(host);
    st.host = host;

    /* 控制条 */
    var bar = doc.createElement('div');
    bar.id = BAR_ID;
    bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#1b1b21;' +
      'color:#e8e8e8;border:1px solid #333;border-radius:12px;padding:12px;max-height:46vh;overflow:auto;' +
      'font:12px/1.5 -apple-system,"PingFang SC",sans-serif;box-shadow:0 -6px 30px rgba(0,0,0,.6);';
    doc.body.appendChild(bar);

    bind(bar, doc);
    render();
    bindDrag(doc);
    U.log('演示已开始');
  }

  function update() {
    if (!st.active || !st.pkg) return;
    try {
      st.pkg = st.build(st.draft);
      /* 选中的取值可能因为改字段名而失效，过滤一遍 */
      var fields = (st.pkg.contract && st.pkg.contract.fields) || [];
      var valid = {};
      fields.forEach(function (f) {
        var v = st.data[f.name];
        if (f.type === 'enum') valid[f.name] = (f.values || []).indexOf(v) >= 0 ? v : (f.values || [])[0] || '';
        else if (f.type === 'list') valid[f.name] = (v || []).filter(function (k) { return (f.values || []).indexOf(k) >= 0; });
        else if (f.type === 'text') valid[f.name] = v == null ? (f.default || '') : v;
        else valid[f.name] = v;
      });
      st.data = valid;
      render();
    } catch (e) {
      U.warn('演示更新失败：' + e.message);
    }
  }

  function stop(doc) {
    st.active = false;
    [HOST_ID, BAR_ID].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    st.host = null;
    st.pkg = null;
    st.inst = null;
  }

  /* 选中值变了 → 通知外部（编辑器把预览也刷一遍） */
  var changeHandler = null;
  function on(ev, fn) { if (ev === 'change') changeHandler = fn; }
  function notifyChange() {
    if (typeof changeHandler === 'function') {
      try { changeHandler(getData()); } catch (e) { U.warn('演示变更回调出错：' + e.message); }
    }
  }

  /* ==================== 交互 ==================== */
  function bind(bar, doc) {
    bar.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-demo]') : null;
      if (!b) return;
      var act = b.getAttribute('data-demo');
      var f = b.getAttribute('data-f');
      var v = b.getAttribute('data-v');

      if (act === 'close') return stop(doc);
      if (act === 'toggleBase') { st.hideBase = !st.hideBase; render(); return; }
      if (act === 'set') { st.data[f] = v; render(); notifyChange(); return; }
      if (act === 'toggle') {
        var arr = st.data[f] || [];
        var i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1); else arr.push(v);
        st.data[f] = arr;
        render();
        notifyChange();
        return;
      }
      if (act === 'reset') {
        P.CFG.allowTopZone = false;
        st.host.style.right = '16px';
        st.host.style.bottom = '16px';
        P.apply(st.host, {});
        return;
      }
      if (act === 'hidePanel') {
        var p = doc.getElementById(PANEL_ID);
        if (!p) { alert('编辑面板当前不在这里（可能是用「新建/编辑」的另一个入口打开的）。'); return; }
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
        renderBar();
        return;
      }
    });
    bar.addEventListener('input', function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute('data-demo') === 'speech') {
        var sf = speechField(st.pkg);
        if (sf) st.data[sf.name] = t.value;
        render();
      }
    });
  }

  /* 拖动：和正式桌宠一致，松手自动夹回可见区 */
  function bindDrag(doc) {
    var drag = null;
    var win = st.win;
    function pt(e) {
      if (e.touches) return e.touches[0] ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      return { x: e.clientX, y: e.clientY };
    }
    function down(e) {
      if (!st.host) return;
      /* 只认从演示桌宠里发出的按下 */
      var path = e.composedPath ? e.composedPath() : [];
      var hit = path.some(function (n) { return n === st.host || (n && n.id === HOST_ID); });
      if (!hit && e.target !== st.host && !(e.target.closest && e.target.closest('#' + HOST_ID))) return;
      var p = pt(e);
      if (!p) return;
      drag = { x: p.x, y: p.y, r: parseFloat(st.host.style.right) || 0, b: parseFloat(st.host.style.bottom) || 0 };
      try { e.preventDefault(); } catch (err) {}
    }
    function move(e) {
      if (!drag) return;
      var p = pt(e);
      if (!p) return;
      st.host.style.right = (drag.r - (p.x - drag.x)) + 'px';
      st.host.style.bottom = (drag.b - (p.y - drag.y)) + 'px';
    }
    function up() {
      if (!drag) return;
      drag = null;
      P.apply(st.host, {});
    }
    doc.addEventListener('mousedown', down, true);
    doc.addEventListener('touchstart', down, { passive: false, capture: true });
    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('touchmove', move, { passive: false, capture: true });
    doc.addEventListener('mouseup', up, true);
    doc.addEventListener('touchend', up, true);
  }

  /* 外部（编辑器预览）改了选中值 → 同步到演示 */
  function setData(data) {
    if (!st.active || !data) return;
    st.data = JSON.parse(JSON.stringify(data));
    render();
  }

  /* 演示当前的选中值，供编辑器回读 */
  function getData() {
    return JSON.parse(JSON.stringify(st.data || {}));
  }

  window.PetDemo = {
    start: start,
    update: update,
    stop: stop,
    setData: setData,
    getData: getData,
    on: on,
    isActive: function () { return st.active; },
    HOST_ID: HOST_ID,
    BAR_ID: BAR_ID,
    buildLayers: buildLayers,
    initialSelection: initialSelection
  };
})();
