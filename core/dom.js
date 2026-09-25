/* ============================================================================
 * 鼠鼠桌宠 · core/dom.js
 * 图层合成：把「数据 + 包契约」翻译成一组 <img> 图层和动作 CSS。
 * 挂在 window.PetDom
 *
 * 图层解析规则（数据驱动，作者不用写代码）：
 *   { type:'base',  asset:'base.png' }                     恒定最底层
 *   { type:'enum',  field:'eyes',  map:{...} }             取 data[field] 当键
 *   { type:'list',  field:'accessories', map:{...} }       遍历 data[field] 每个元素
 *   { type:'bool',  field:'blush', map:{ 'true':'...' } }  取 true/false
 *
 * 任意图层都可以加 skipWhen 做条件显示（作者用得上的一组通用开关）：
 *   { skipWhen:'blackface' }            data.blackface 有值 → 跳过本层
 *   { skipWhen:{ field:'mood', equals:['angry'] } }  取值命中 → 跳过
 *   { skipWhen:{ field:'mood', notEquals:['calm'] } } 取值不含 → 跳过
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;

  function isAbsUrl(s) {
    return /^(https?:)?\/\//i.test(s) || /^data:/i.test(s) || /^blob:/i.test(s);
  }

  /* 把包内相对路径解析成可访问 URL */
  function resolveAsset(src, pkg) {
    if (!src) return '';
    if (isAbsUrl(src)) return src;
    var base = (pkg && pkg.base) || '';
    if (!base) return src;
    if (base.charAt(base.length - 1) !== '/') base += '/';
    return base + String(src).replace(/^\.?\//, '');
  }

  /* 判断某图层是否该被跳过（条件显示） */
  function shouldSkip(L, data) {
    var sw = L && L.skipWhen;
    if (!sw) return false;
    var d = data || {};

    if (typeof sw === 'string') {
      /* 简写：该字段"有值"就跳过（空串/空数组/false/null 都算没值） */
      var v = d[sw];
      return !(v === undefined || v === null || v === '' || v === false ||
               (Array.isArray(v) && v.length === 0));
    }

    var arr;
    if (sw.equals !== undefined) {
      arr = Array.isArray(sw.equals) ? sw.equals : [sw.equals];
      if (arr.indexOf(d[sw.field]) >= 0) return true;
    }
    if (sw.notEquals !== undefined) {
      arr = Array.isArray(sw.notEquals) ? sw.notEquals : [sw.notEquals];
      if (arr.indexOf(d[sw.field]) < 0) return true;
    }
    if (sw.empty === true && !d[sw.field]) return true;
    if (sw.notEmpty === true && d[sw.field]) return true;
    return false;
  }

  /* 核心：算出这一帧该显示哪些图层（数组顺序 = 叠放顺序，后面的在上面） */
  function resolveLayers(pkg, data) {
    var out = [];
    var defs = (pkg && pkg.layers) || [];
    var d = data || {};
    for (var i = 0; i < defs.length; i++) {
      var L = defs[i] || {};
      if (shouldSkip(L, d)) continue;
      var z = (typeof L.z === 'number') ? L.z : (i + 1) * 10;
      var src = null;

      if (L.type === 'base' || (!L.type && L.asset)) {
        src = L.asset || (L.map && L.map.default) || null;

      } else if (L.type === 'enum') {
        var v = d[L.field];
        if (v !== undefined && v !== null && L.map && L.map[v] !== undefined) src = L.map[v];

      } else if (L.type === 'bool') {
        var b = !!d[L.field];
        if (L.map && L.map[b ? 'true' : 'false'] !== undefined) src = L.map[b ? 'true' : 'false'];

      } else if (L.type === 'list') {
        var arr = d[L.field];
        if (Array.isArray(arr)) {
          for (var j = 0; j < arr.length; j++) {
            var k = arr[j];
            if (L.map && L.map[k] !== undefined) {
              out.push({
                src: resolveAsset(L.map[k], pkg),
                z: z,
                tf: (L.transforms && L.transforms[k]) || L.tf || null
              });
            }
          }
        }
        continue;
      } else if (L.type === 'exists') {
        /* 字段有值就显示固定图 */
        if (d[L.field]) src = L.asset || (L.map && L.map.default) || null;
      }

      if (src) {
        /* enum/base 图层：可以按取值分别给微调参数，也可以整层一个 */
        var tfv = (L.transforms && d[L.field] !== undefined && L.transforms[d[L.field]]) || L.tf || null;
        out.push({ src: resolveAsset(src, pkg), z: z, tf: tfv });
      }
    }
    out.sort(function (a, b) { return a.z - b.z; });
    return out;
  }

  /* ---------- 动作 ---------- */
  function motionClass(pkg, name) {
    var m = pkg && pkg.motions;
    if (!m || !name || !m[name]) return '';
    return m[name].className || ('pet-m-' + name);
  }

  /* 生成包自带动作的 CSS（作者只写声明，不用碰 CSS 文件） */
  function buildMotionCss(pkg) {
    var m = (pkg && pkg.motions) || {};
    var out = [];
    Object.keys(m).forEach(function (name) {
      var def = m[name] || {};
      var cls = def.className || ('pet-m-' + name);
      var suffix = def.className ? '' : ('-' + name);
      var kf = def.keyframes || def.keyframe;
      if (kf) {
        var steps = Object.keys(kf).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
        out.push('@keyframes ' + (def.animationName || ('pet-kf' + suffix)) + '{' +
          steps.map(function (s) { return s + '{' + kf[s] + '}'; }).join('') + '}');
      }
      var anim = def.animation;
      if (!anim && kf) {
        anim = (def.animationName || ('pet-kf' + suffix)) + ' ' +
               (def.duration || '1s') + ' ' + (def.timing || 'ease-in-out') + ' ' +
               (def.iteration || '1') + ' ' + (def.direction || 'normal') + ' ' + (def.fill || 'both');
      }
      if (!anim) return;
      out.push('.pet-wrap.' + cls + ' .pet-stack{animation:' + anim + ';}');
      if (def.stackClass) out.push('.pet-wrap.' + cls + ' .pet-stack{' + def.stackClass + '}');
    });
    return out.join('\n');
  }

  /* ---------- 图层微调（位置/大小/旋转/透明度）----------
     所有图尺寸一致时靠 object-fit 对齐；但配件往往是作者随手画的，
     直接叠上去位置会很怪。所以每个图层（以及 list 的每个取值）都能单独调。
     作者在编辑器里可视化调，这里只负责把参数翻成 CSS。 */
  var TF_DEFAULTS = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };

  function layerTransform(tf) {
    if (!tf) return '';
    var x = Number(tf.x) || 0;
    var y = Number(tf.y) || 0;
    var sc = (tf.scale === undefined || tf.scale === null || tf.scale === '') ? 1 : Number(tf.scale);
    var rot = Number(tf.rotate) || 0;
    var op = (tf.opacity === undefined || tf.opacity === null || tf.opacity === '') ? 1 : Number(tf.opacity);
    if (!x && !y && sc === 1 && !rot && op === 1) return '';
    var parts = [];
    if (x || y) parts.push('translate(' + x + '%,' + y + '%)');
    if (sc !== 1) parts.push('scale(' + sc + ')');
    if (rot) parts.push('rotate(' + rot + 'deg)');
    var css = 'transform:' + parts.join(' ') + ';';
    /* 旋转/缩放都绕图层中心，这样调位置最直观 */
    if (parts.length) css += 'transform-origin:center center;';
    if (op !== 1) css += 'opacity:' + op + ';';
    return css;
  }
  function hasTransform(tf) {
    return !!layerTransform(tf);
  }

  function imgTag(src, z, tf) {
    return '<img class="pet-layer" style="z-index:' + z + ';' + layerTransform(tf) + '" src="' +
      escapeAttr(src) + '" alt="">';
  }

  /* ---------- 组装 Shadow DOM 内容 ---------- */
  function buildShellHtml(pkg, data, opts) {
    opts = opts || {};
    var layers = resolveLayers(pkg, data);
    var mc = motionClass(pkg, data && data.motion);
    var speech = (data && data.speech != null) ? String(data.speech) : '';
    var open = !!opts.open;

    var imgs = layers.map(function (L) {
      return imgTag(L.src, L.z, L.tf);
    }).join('');

    return '' +
      '<style>' + baseCss(pkg) + '\n' + buildMotionCss(pkg) + '\n' + buildBubbleShowCss() + '</style>' +
      '<div class="pet-wrap ' + mc + '" data-pet-drag="1">' +
        '<div class="pet-bubble' + (open ? ' pet-show' : '') + '">' +
          escapeHtml(speech) + buildTailHtml(pkg) +
        '</div>' +
        '<div class="pet-stack">' + imgs + '</div>' +
      '</div>';
  }

  function baseCss(pkg) {
    var size = (pkg && pkg.render && pkg.render.size) || '25.5vh';
    return [
      ':host{all:initial;display:block;pointer-events:auto;}',
      '.pet-wrap{position:relative;width:' + size + ';height:' + size + ';',
      '  cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;',
      '  transform-origin:bottom center;will-change:transform;}',
      '.pet-wrap.pet-dragging{cursor:grabbing;}',
      '.pet-stack{position:absolute;inset:0;transform-origin:bottom center;',
      '  opacity:1;transition:opacity .1s linear;will-change:transform,opacity;}',
      '.pet-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;',
      '  -webkit-user-drag:none;pointer-events:none;}'
    ].join('\n') + '\n' + buildBubbleCss(pkg);
  }

  /* ==================== 气泡样式 ====================
     作者在编辑器里能可视化调这些参数；没配就用一份默认值。
     正式渲染、演示、独立导出三条路都调这个函数，保证一致。 */
  var BUBBLE_DEFAULTS = {
    bg: '#1c1c1c',
    bg2: '',
    color: '#e0e0e0',
    fontSize: 13,
    lineHeight: 1.6,
    fontWeight: 'normal',
    radius: 14,
    paddingX: 13,
    paddingY: 10,
    maxWidth: 'min(170px,40vw)',
    minWidth: 100,
    borderWidth: 0,
    borderColor: '#ffffff',
    shadow: 26,
    opacity: 100,
    letterSpacing: 0.2,
    offsetX: -35,
    offsetY: -20,
    /* 材质 / 质感 */
    blur: 0,              /* 毛玻璃：背景模糊强度(px) */
    saturate: 0,          /* 毛玻璃：饱和度加成(%) */
    glow: 0,              /* 内发光强度(px) */
    glowColor: '#ffffff',
    /* 尾巴：现在是可以加多个的数组，每项独立控制。
       默认给一条——就是小早原来那张贴图，保证没配置过的包不会突然没尾巴。 */
    tails: [{
      mode: 'image',
      image: 'https://free.picui.cn/free/2025/09/03/68b852d0aaf53.png',
      width: 120, height: 120, right: -15, bottom: -102, rotate: -5,
      offsetX: 0, offsetY: 0, opacity: 100, color: ''
    }]
  };

  /* 单个尾巴的默认值 */
  var TAIL_DEFAULTS = {
    mode: 'image',        /* image | css | none */
    image: '',
    width: 120,
    height: 120,
    right: -15,
    bottom: -102,
    rotate: -5,
    offsetX: 0,
    offsetY: 0,
    opacity: 100,
    color: ''             /* css 模式下的颜色，留空则跟随气泡底色 */
  };

  /* 材质预设：一键切换整体质感，之后还能逐项微调 */
  var MATERIAL_PRESETS = {
    '默认深色': { bg: '#1c1c1c', bg2: '', color: '#e0e0e0', blur: 0, saturate: 0, glow: 0, borderWidth: 0, opacity: 100, shadow: 26 },
    '毛玻璃':   { bg: 'rgba(28,28,32,.55)', bg2: '', color: '#f0f0f0', blur: 10, saturate: 140, glow: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,.28)', opacity: 100, shadow: 22 },
    '和纸':     { bg: 'rgba(247,240,226,.96)', bg2: 'rgba(233,222,202,.96)', color: '#3a3226', blur: 0, saturate: 0, glow: 0, borderWidth: 1, borderColor: 'rgba(160,140,105,.5)', opacity: 100, shadow: 14 },
    '描边透明': { bg: 'rgba(0,0,0,0)', bg2: '', color: '#ffffff', blur: 0, saturate: 0, glow: 0, borderWidth: 2, borderColor: '#ffffff', opacity: 100, shadow: 0 },
    '霓虹发光': { bg: 'rgba(20,10,40,.85)', bg2: 'rgba(60,10,80,.85)', color: '#ffd6ff', blur: 4, saturate: 120, glow: 18, glowColor: '#ff5cf0', borderWidth: 1, borderColor: 'rgba(255,120,255,.55)', opacity: 100, shadow: 30 },
    '金属':     { bg: '#8d9299', bg2: '#e8ecef', color: '#22262b', blur: 0, saturate: 0, glow: 6, glowColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(255,255,255,.7)', opacity: 100, shadow: 18 },
    '淡色纸卡': { bg: '#fdfcf8', bg2: '#f2ede2', color: '#33302a', blur: 0, saturate: 0, glow: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,.12)', opacity: 100, shadow: 10 }
  };

  /* 给一条尾巴补默认值（编辑器用） */
  function assignTailDefaults(t) {
    var o = {};
    Object.keys(TAIL_DEFAULTS).forEach(function (k) {
      o[k] = (t && t[k] !== undefined && t[k] !== null && t[k] !== '') ? t[k] : TAIL_DEFAULTS[k];
    });
    /* 数值字段允许 0 */
    Object.keys(TAIL_DEFAULTS).forEach(function (k) {
      if (typeof TAIL_DEFAULTS[k] === 'number' && t && t[k] === 0) o[k] = 0;
    });
    return o;
  }

  /* 兼容：旧的单尾巴字段 → 数组
     注意：只有"没有 tails 字段"时才走旧格式。
     编辑器永远会写 tails（哪怕是空数组），所以空数组 = 确实不要尾巴。 */
  function tailsOf(c) {
    if (Array.isArray(c.tails)) {
      /* 空数组就是不要尾巴，但仍要把每项补齐默认值 */
      if (!c.tails.length) return [];
      return c.tails.map(function (t) { return assignTailDefaults(t); });
    }
    /* 旧格式：单张 tailImage + tailMode */
    if (c.tailImage || (c.tailMode && c.tailMode !== 'none')) {
      return [assignTailDefaults({
        mode: c.tailMode || 'image',
        image: c.tailImage || '',
        width: c.tailWidth, height: c.tailHeight,
        right: c.tailRight, bottom: c.tailBottom, rotate: c.tailRotate
      })];
    }
    return [];
  }

  function bubbleCfg(pkg) {
    var c = (pkg && pkg.render && pkg.render.bubble) || {};
    var out = {};
    Object.keys(BUBBLE_DEFAULTS).forEach(function (k) {
      out[k] = (c[k] === undefined || c[k] === null || c[k] === '') ? BUBBLE_DEFAULTS[k] : c[k];
    });
    /* 数字字段允许显式传 0，上面的空值判断会误伤，这里补回来 */
    Object.keys(BUBBLE_DEFAULTS).forEach(function (k) {
      if (typeof BUBBLE_DEFAULTS[k] === 'number' && c[k] === 0) out[k] = 0;
    });
    /* tails 是数组，要区分三种情况：
         ① 配置里没有 tails 键  → 用默认（小早那条）
         ② 配置里 tails 是数组  → 用配置的（空数组 = 确实不要尾巴）
         ③ 配置里 tails 是 null/'' → 交给下面的旧格式 tailImage 兼容分支
       注意不能无脑 delete，否则默认尾巴会丢。 */
    if (!('tails' in c)) {
      /* 走默认；但如果这是旧格式包（有 tailImage），要让旧分支接管 */
      if (c.tailImage || c.tailMode) delete out.tails;
    } else if (Array.isArray(c.tails)) {
      out.tails = c.tails;
    } else {
      delete out.tails;
    }
    /* 旧格式的单尾巴字段原样带过去，交给 tailsOf 转换 */
    ['tailMode', 'tailImage', 'tailWidth', 'tailHeight', 'tailRight', 'tailBottom', 'tailRotate']
      .forEach(function (k) { if (c[k] !== undefined) out[k] = c[k]; });
    return out;
  }

  function buildBubbleCss(pkg) {
    var c = bubbleCfg(pkg);
    var bg = c.bg2 ? ('linear-gradient(180deg,' + c.bg + ',' + c.bg2 + ')') : c.bg;
    var alpha = Math.max(0, Math.min(100, Number(c.opacity))) / 100;

    /* 材质：毛玻璃用 backdrop-filter，内发光用 inset 阴影叠在投影上 */
    var filters = [];
    if (Number(c.blur) > 0) filters.push('blur(' + c.blur + 'px)');
    if (Number(c.saturate) > 0) filters.push('saturate(' + (100 + Number(c.saturate)) + '%)');
    var shadows = ['0 6px ' + c.shadow + 'px rgba(0,0,0,.28)'];
    if (Number(c.glow) > 0) {
      shadows.push('inset 0 0 ' + c.glow + 'px ' + c.glowColor);
    }

    var out = [
      '.pet-bubble{position:absolute;z-index:0;display:inline-block;text-align:left;',
      '  bottom:calc(100% + ' + c.offsetY + 'px);right:auto;left:' + c.offsetX + 'px;',
      '  min-width:' + c.minWidth + 'px;max-width:' + c.maxWidth + ';',
      '  background:' + bg + ' !important;',
      '  background-image:' + (c.bg2 ? ('linear-gradient(180deg,' + c.bg + ',' + c.bg2 + ')') : 'none') + ' !important;',
      '  color:' + c.color + ' !important;',
      '  -webkit-text-fill-color:' + c.color + ' !important;',
      '  border-radius:' + c.radius + 'px !important;',
      '  padding:' + c.paddingY + 'px ' + c.paddingX + 'px !important;',
      '  font-weight:' + c.fontWeight + ' !important;',
      '  font-size:' + c.fontSize + 'px;line-height:' + c.lineHeight + ';',
      '  letter-spacing:' + c.letterSpacing + 'px;',
      '  font-family:\'PingFang SC\',\'Noto Sans SC\',sans-serif;',
      '  border:' + (c.borderWidth > 0 ? (c.borderWidth + 'px solid ' + c.borderColor) : 'none') + ';',
      '  opacity:' + (alpha) + ';',
      '  box-shadow:' + shadows.join(',') + ';',
      '  transform-origin:bottom left;',
      '  transform:translateY(6px) scale(.94);',
      '  transition:opacity .26s cubic-bezier(.22,.61,.36,1),transform .26s cubic-bezier(.22,.61,.36,1);}'
    ];
    if (filters.length) {
      out.push('.pet-bubble{-webkit-backdrop-filter:' + filters.join(' ') + ';' +
        'backdrop-filter:' + filters.join(' ') + ';}');
    }

    /* ---------- 尾巴：可以有多个，每个独立控制 ---------- */
    var tails = tailsOf(c);
    for (var i = 0; i < tails.length; i++) {
      var t = tails[i];
      var sel = '.pet-bubble .pet-tail-' + i;
      if (t.mode === 'none') continue;
      if (t.mode === 'css') {
        var tc = t.color || c.bg;
        out.push(sel + '{display:block;position:absolute;width:14px;height:14px;background:' + tc + ';' +
          'right:' + Math.max(6, -Number(t.right)) + 'px;bottom:' + (Number(t.bottom) + 95) + 'px;' +
          'transform:rotate(45deg) translate(' + t.offsetX + 'px,' + t.offsetY + 'px);' +
          'border-radius:2px;z-index:-1;pointer-events:none;' +
          'opacity:' + (Number(t.opacity) / 100) + ';}');
      } else {
        out.push(sel + '{display:block;position:absolute;' +
          'right:' + t.right + 'px;bottom:' + t.bottom + 'px;' +
          'width:' + t.width + 'px;height:' + t.height + 'px;' +
          (t.image ? ('background-image:url(\'' + t.image + '\');') : '') +
          'background-size:contain;background-repeat:no-repeat;' +
          'transform:translate(' + t.offsetX + 'px,' + t.offsetY + 'px) rotate(' + t.rotate + 'deg);' +
          'opacity:' + (Number(t.opacity) / 100) + ';' +
          'z-index:-1;pointer-events:none !important;}');
      }
      /* 尾巴要能被看到，气泡本体不能裁掉它 */
      out.push('.pet-bubble{overflow:visible;}');
    }
    return out.join('\n');
  }

  /* 气泡里要插的尾巴元素（有几个生成几个） */
  function buildTailHtml(pkg) {
    var c = bubbleCfg(pkg);
    var tails = tailsOf(c);
    var out = '';
    for (var i = 0; i < tails.length; i++) {
      if (tails[i].mode === 'none') continue;
      out += '<i class="pet-tail pet-tail-' + i + '"></i>';
    }
    return out;
  }

  /* 气泡显示/隐藏的过渡（与基础样式分开，方便预览复用） */
  function buildBubbleShowCss() {
    return '.pet-bubble.pet-show{opacity:1 !important;transform:translateY(0) scale(1) !important;}';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  window.PetDom = {
    resolveAsset: resolveAsset,
    resolveLayers: resolveLayers,
    shouldSkip: shouldSkip,
    motionClass: motionClass,
    buildShellHtml: buildShellHtml,
    baseCss: baseCss,
    buildBubbleCss: buildBubbleCss,
    buildBubbleShowCss: buildBubbleShowCss,
    buildTailHtml: buildTailHtml,
    tailsOf: tailsOf,
    assignTailDefaults: assignTailDefaults,
    bubbleCfg: bubbleCfg,
    BUBBLE_DEFAULTS: BUBBLE_DEFAULTS,
    TAIL_DEFAULTS: TAIL_DEFAULTS,
    MATERIAL_PRESETS: MATERIAL_PRESETS,
    layerTransform: layerTransform,
    hasTransform: hasTransform,
    imgTag: imgTag,
    TF_DEFAULTS: TF_DEFAULTS,
    buildMotionCss: buildMotionCss,
    escapeHtml: escapeHtml
  };
})();
