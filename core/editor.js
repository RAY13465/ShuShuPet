/* ============================================================================
 * 鼠鼠桌宠 · core/editor.js
 * 可视化包编辑器：填表 + 贴图片 URL → 自动生成规范的桌宠包。
 *
 * 设计前提：
 *   - 代码全部由引擎生成，用户没有写代码/改结构的入口，从根上避免出错
 *   - 图片只接受 URL（导出包时本地文件会失效）
 *   - 带实时预览：换一张图、切一个取值，立刻能看到桌宠长什么样
 * 挂在 window.PetEditor
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;
  var Dom = window.PetDom;
  var R = window.PetRegistry;

  var PANEL_ID = 'shushu-pet-editor';
  var handlers = { onChange: null };

  /* 动作预设：只给名字和参数，keyframes 由编辑器生成，用户改不坏 */
  var MOTION_PRESETS = {
    still:   { label: '不动', kf: null },
    breathe: { label: '呼吸', kf: { '0%,100%': 'transform:scale(1)', '50%': 'transform:scale(1.025)' }, duration: '4s', timing: 'ease-in-out', iteration: 'infinite' },
    bounce:  { label: '跳跃', kf: { '0%,100%': 'transform:translateY(0)', '50%': 'transform:translateY(-15px)' }, duration: '.5s', iteration: '2' },
    jump:    { label: '大跳', kf: { '0%': 'transform:translateY(0)', '35%': 'transform:translateY(-28px) scaleX(-1)', '60%': 'transform:translateY(-28px) scaleX(-1)', '100%': 'transform:translateY(0) scaleX(1)' }, duration: '.72s', iteration: '1' },
    swing:   { label: '摇摆', kf: { '0%,100%': 'transform:rotate(-6deg)', '50%': 'transform:rotate(6deg)' }, duration: '1.1s', iteration: '3' },
    nod:     { label: '点头', kf: { '0%,100%': 'transform:translateY(0) scaleY(1)', '50%': 'transform:translateY(5px) scaleY(.93)' }, duration: '.5s', iteration: '2' },
    pulse:   { label: '心跳', kf: { '0%,100%': 'transform:scale(1)', '50%': 'transform:scale(1.07)' }, duration: '1.25s', iteration: '3' },
    spin:    { label: '转圈', kf: { '0%': 'transform:rotate(0)', '100%': 'transform:rotate(360deg)' }, duration: '.85s', iteration: '1' },
    shake:   { label: '摇头', kf: { '0%,100%': 'transform:translateX(0)', '18%': 'transform:translateX(-6px)', '38%': 'transform:translateX(6px)', '58%': 'transform:translateX(-5px)', '78%': 'transform:translateX(4px)' }, duration: '.45s', iteration: '1' },
    shiver:  { label: '发抖', kf: { '0%': 'transform:translateX(0)', '25%': 'transform:translateX(-1.6px)', '75%': 'transform:translateX(1.6px)', '100%': 'transform:translateX(0)' }, duration: '.16s', timing: 'linear', iteration: '18' },
    droop:   { label: '垂头', kf: { '0%': 'transform:translateY(0) scaleY(1)', '100%': 'transform:translateY(8px) scaleY(.95)' }, duration: '.6s', timing: 'ease-out', iteration: '1', fill: 'forwards' },
    tilt:    { label: '歪头', kf: { '0%': 'transform:rotate(0)', '100%': 'transform:rotate(-11deg)' }, duration: '.5s', timing: 'ease-out', iteration: '1', fill: 'forwards' }
  };

  /* 编辑器状态（一份草稿） */
  function blankDraft() {
    return {
      id: '',
      name: '',
      tag: 'PetState',
      size: '25.5vh',
      zIndex: 3500,
      base: '',
      fields: [
        { name: 'eyes', label: '眼睛', type: 'enum', override: '', values: [{ key: 'normal', url: '' }, { key: 'happy', url: '' }] },
        { name: 'mouth', label: '嘴巴', type: 'enum', override: '', values: [{ key: 'cat', url: '' }, { key: 'open', url: '' }] },
        { name: 'blackface', label: '黑脸覆盖', type: 'enum', override: '', values: [{ key: '', url: '' }, { key: 'smug', url: '' }] },
        { name: 'motion', label: '动作', type: 'enum', override: '', values: [{ key: 'still', url: '' }, { key: 'bounce', url: '' }] }
      ],
      accessories: { name: 'accessories', label: '配饰', items: [] },
      speechName: 'speech',
      speechDefault: '在的。',
      motions: ['still', 'bounce', 'breathe'],
      fieldNotes: {},
      bubble: (function () {
        /* 直接用 Dom 的默认值（自带一条贴图尾巴），保证预览和实际渲染一致。
           之前自己拼一份，结果和 Dom 的默认对不上，尾巴在预览里就不见了。 */
        return JSON.parse(JSON.stringify(Dom.BUBBLE_DEFAULTS));
      })()
    };
  }

  var draft = blankDraft();
  var editingId = null;

  function on(ev, fn) { if (ev in handlers) handlers[ev] = fn; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ==================== 草稿 → 规范包（引擎负责正确性） ==================== */
  function buildPackage(d) {
    /* 草稿里可能没有 bubble（旧草稿/外部调用），兜一份默认值 */
    if (!d.bubble) d.bubble = JSON.parse(JSON.stringify(Dom.BUBBLE_DEFAULTS));
    var fields = [];
    var layers = [{ type: 'base', z: 10, asset: d.base || '' }];
    var z = 20;

    d.fields.forEach(function (f) {
      if (!f.name) return;
      /* 关键："" 是合法取值（如 blackface 的"不用"），不能当假值丢掉，
         否则契约里就没有空这个选项，用户永远切不回去 */
      var valid = f.values.filter(function (v) { return v.key !== undefined && v.key !== null; });
      if (!valid.length) return;
      /* 取值的「中文说明」要带进契约，提示词生成时用得上 */
      var vNotes = {};
      valid.forEach(function (v) { if (v.note) vNotes[v.key] = v.note; });
      var fld = {
        name: f.name,
        type: 'enum',
        label: f.label || f.name,
        values: valid.map(function (v) { return v.key; }),
        default: valid[0].key
      };
      if (Object.keys(vNotes).length) fld.valueNotes = vNotes;
      fields.push(fld);
      var map = {};
      var tfMap = {};
      var hasTf = false;
      valid.forEach(function (v) {
        if (v.url) map[v.key] = v.url;
        if (v.tf) {
          var t = cleanTf(v.tf);
          if (t) { tfMap[v.key] = t; hasTf = true; }
        }
      });
      if (Object.keys(map).length) {
        var layer = { type: 'enum', z: z++, field: f.name, map: map };
        if (hasTf) layer.transforms = tfMap;
        /* 覆盖关系：被覆盖方"有值"时，本字段整层不显示。
           典型用途：blackface 是整脸替换图，一旦有值就不该再叠眉/眼/嘴。 */
        var ov = (f.override || '').trim();
        if (ov && ov !== f.name) layer.skipWhen = ov;
        layers.push(layer);
      }
    });

    if (d.accessories.name && d.accessories.items.length) {
      var accs = d.accessories.items.filter(function (a) { return a.key; });
      if (accs.length) {
        var accField = {
          name: d.accessories.name,
          type: 'list',
          label: d.accessories.label || d.accessories.name,
          values: accs.map(function (a) { return a.key; }),
          valueNotes: (function () { var vn = {}; accs.forEach(function (a) { if (a.note) vn[a.key] = a.note; }); return vn; })(),
          default: []
        };
        /* 默认不设上限：作者想加多少配件就加多少。
           只有显式填了「同时最多几个」才限制。 */
        var cap = parseInt(d.accessories.maxItems, 10);
        if (cap > 0) accField.maxItems = cap;
        fields.push(accField);
        var amap = {};
        var atf = {};
        var aHasTf = false;
        accs.forEach(function (a) {
          if (a.url) amap[a.key] = a.url;
          if (a.tf) {
            var t = cleanTf(a.tf);
            if (t) { atf[a.key] = t; aHasTf = true; }
          }
        });
        if (Object.keys(amap).length) {
          var accLayer = { type: 'list', z: z++, field: d.accessories.name, map: amap };
          if (aHasTf) accLayer.transforms = atf;
          layers.push(accLayer);
        }
      }
    }

    if (d.speechName) {
      fields.push({ name: d.speechName, type: 'text', label: '台词', default: d.speechDefault || '' });
    }

    var motions = {};
    d.motions.forEach(function (name) {
      var p = MOTION_PRESETS[name];
      if (!p) return;
      motions[name] = p.kf
        ? { keyframes: p.kf, duration: p.duration || '1s', timing: p.timing || 'ease-in-out', iteration: p.iteration || '1', fill: p.fill || 'both' }
        : {};
    });
    if (!motions.still) motions.still = {};

    /* 动作名必须出现在 motion 字段的取值里，否则模型写了也被过滤 */
    var motionField = fields.filter(function (f) { return f.name === 'motion'; })[0];
    if (motionField) {
      Object.keys(motions).forEach(function (m) {
        if (motionField.values.indexOf(m) < 0) motionField.values.push(m);
      });
    }

    var defaults = {};
    fields.forEach(function (f) { if (f.default !== undefined) defaults[f.name] = f.default; });

    return {
      id: d.id,
      name: d.name,
      version: '1.0.0',
      description: '由鼠鼠桌宠可视化编辑器生成',
      contract: {
        tag: d.tag || 'PetState',
        lookback: 10,
        prompt: buildPrompt(d, fields),
        defaults: defaults,
        fields: fields,
        fieldNotes: d.fieldNotes || {}
      },      render: {
        size: d.size || '25.5vh',
        zIndex: d.zIndex || 3500,
        startRight: '1vh',
        startBottom: '6vh',
        bubbleBg: d.bubble.bg,
        bubbleColor: d.bubble.color,
        bubble: d.bubble
      },
      layers: layers,
      motions: motions
    };
  }

  /* 清掉全默认的微调参数，避免包里塞一堆没用的 0 */
  function cleanTf(tf) {
    if (!tf) return null;
    var o = {};
    var any = false;
    ['x', 'y', 'scale', 'rotate', 'opacity'].forEach(function (k) {
      var v = tf[k];
      if (v === undefined || v === null || v === '') return;
      var n = Number(v);
      if (isNaN(n)) return;
      var dflt = (k === 'scale' || k === 'opacity') ? 1 : 0;
      if (n !== dflt) any = true;
      o[k] = n;
    });
    return any ? o : null;
  }

  /* 顺手生成给模型看的提示词，作者直接复制进角色卡 */
  /* 生成给模型看的提示词，格式对齐「世界书条目」那种写法：
       - 开头一段总规则（严禁照搬照抄 / 单行紧凑 JSON / 禁注释换行 / 双引号转义 / 标签名不可改）
       - 一个合法的示例块
       - 每个取值带中文说明（作者填了才有） */
  function buildPrompt(d, fields) {
    var tag = d.tag || 'PetState';
    var shape = {};
    fields.forEach(function (f) {
      if (f.type === 'enum') shape[f.name] = (f['default'] !== undefined) ? f['default'] : (f.values[0] || '');
      else if (f.type === 'list') shape[f.name] = [];
      else shape[f.name] = f['default'] || '';
    });
    var example = JSON.stringify(shape);
    var name = d.name || '桌宠';

    var lines = [];
    lines.push('【' + name + '状态输出规则】');
    lines.push('AI生成的所有内容最后都必须附带以下格式, 严禁照搬照抄, 根据剧情发展实时变更, ' +
      '表情/动作要贴合当前剧情情绪, 实际生成时严禁输出任何注释和换行, ' +
      '只输出单行紧凑 JSON, 标签名不可改, JSON 内出现双引号一律转义为 \\"：');
    lines.push('<' + tag + '>' + example + '</' + tag + '>');
    lines.push('');
    lines.push('各字段说明：');

    fields.forEach(function (f) {
      var notes = f.valueNotes || {};
      var parts = [];
      if (f.type === 'enum') {
        parts.push('取一个: ' + f.values.map(function (v) {
          if (v === '' || v === undefined) return '""(不用)';
          return notes[v] ? (v + '(' + notes[v] + ')') : v;
        }).join('/'));
      } else if (f.type === 'list') {
        parts.push('数组可空可多选: ' + f.values.map(function (v) {
          return notes[v] ? (v + '(' + notes[v] + ')') : v;
        }).join('/'));
        if (f.maxItems > 0) parts.push('最多 ' + f.maxItems + ' 个');
      } else {
        /* 文本字段：作者写了补充说明就以它为准，避免两句话叠在一起 */
        var tn = (d.fieldNotes && d.fieldNotes[f.name]) ? d.fieldNotes[f.name] : '';
        if (!tn) parts.push('一句话, ' + (f.maxLen ? (f.maxLen + ' 字以内') : '简短即可'));
      }
      var extra = (d.fieldNotes && d.fieldNotes[f.name]) ? d.fieldNotes[f.name] : '';
      if (extra) parts.push(extra);
      lines.push('  "' + f.name + '": ' + parts.join('; '));
    });

    return lines.join('\n');
  }

  /* ==================== 实时预览 ====================
     和正式渲染用同一套规则（尺寸、动作 class、生成的 keyframes），
     所以预览里能动，实际挂上去就能动。 */
  /* 预览与演示共用这一份「当前选中」——点一边，另一边立刻跟着变 */
  var previewSel = {};

  function previewMotionFor(keys) {
    var cur = previewSel.motion;
    if (cur && keys.indexOf(cur) >= 0) return cur;
    /* 默认挑第一个真正有动画的（跳过「不动」） */
    var animated = keys.filter(function (k) { return MOTION_PRESETS[k] && MOTION_PRESETS[k].kf; });
    return animated[0] || keys[0];
  }

  function previewMotion() {
    var mf = draft.fields.filter(function (f) { return f.name === 'motion'; })[0];
    if (!mf) return null;
    var keys = mf.values.filter(function (v) { return v.key !== undefined && v.key !== null; }).map(function (v) { return v.key; });
    if (!keys.length) return null;
    return previewMotionFor(keys);
  }

  /* 字段结构变了（改名/增删取值）时，把选中值收敛到合法范围，尽量保留用户已选的 */
  function syncSel() {
    var keep = previewSel;
    var next = {};
    draft.fields.forEach(function (f) {
      var keys = f.values.filter(function (v) { return v.key !== undefined && v.key !== null; }).map(function (v) { return v.key; });
      if (!f.name || !keys.length) return;
      next[f.name] = (keys.indexOf(keep[f.name]) >= 0) ? keep[f.name]
        : (f.name === 'motion' ? previewMotionFor(keys) : keys[0]);
    });
    if (draft.accessories.name) {
      var akeys = draft.accessories.items.filter(function (a) { return a.key; }).map(function (a) { return a.key; });
      var prev = Array.isArray(keep[draft.accessories.name]) ? keep[draft.accessories.name] : [];
      next[draft.accessories.name] = prev.filter(function (k) { return akeys.indexOf(k) >= 0; });
    }
    if (draft.speechName) {
      next[draft.speechName] = (keep[draft.speechName] != null) ? keep[draft.speechName] : (draft.speechDefault || '');
    }
    previewSel = next;
    return next;
  }

  function previewData() {
    syncSel();
    return previewSel;
  }

  /* 预览要显示的台词（取当前预览选中的那份） */
  function previewSpeech(pkg, data) {
    var sf = ((pkg.contract && pkg.contract.fields) || []).filter(function (f) { return f.type === 'text'; })[0];
    if (!sf) return '';
    var v = data && data[sf.name];
    if (v === undefined || v === null) return sf['default'] || '';
    return String(v);
  }

  /* 演示那边改了选中值 → 回写到这里，预览就会跟着变 */
  function setSelection(data) {
    if (!data || typeof data !== 'object') return;
    Object.keys(data).forEach(function (k) { previewSel[k] = data[k]; });
  }

  function renderPreview(doc, host) {
    var box = host.querySelector('[data-role="preview"]');
    if (!box) return;
    var pkg;
    try { pkg = buildPackage(draft); }
    catch (e) { box.innerHTML = '<div style="color:#e57373;font-size:12px;">生成失败：' + esc(e.message) + '</div>'; return; }

    var data = previewData();
    var layers = Dom.resolveLayers(pkg, data);
    if (!layers.length) {
      box.innerHTML = '<div style="color:#888;padding:24px 8px;text-align:center;font-size:12px;">贴一张「底图」URL 就能看到预览</div>';
      return;
    }

    var size = (pkg.render && pkg.render.size) || '25.5vh';
    var mc = Dom.motionClass(pkg, data.motion);

    /* 用和正式渲染完全一致的类名 + 基础 CSS，
       否则动作选择器（.pet-wrap.pet-m-x .pet-stack）会对不上。 */
    var html =
      '<style>' + Dom.baseCss(pkg) + '\n' + Dom.buildMotionCss(pkg) + '\n' + Dom.buildBubbleShowCss() +
      '.pet-preview-viewport{height:260px;display:flex;align-items:flex-end;justify-content:center;' +
        'overflow:visible;position:relative;padding-top:70px;box-sizing:border-box;}' +
      '.pet-preview-viewport .pet-wrap{margin:0 auto;}' +
      '.pet-preview-viewport .pet-bubble.pet-show{opacity:1 !important;transform:none !important;}' +
      '</style>' +
      '<div class="pet-preview-viewport">' +
        '<div class="pet-wrap ' + mc + '" data-pet-drag="1">' +
          '<div class="pet-bubble pet-show">' + esc(previewSpeech(pkg, data)) + Dom.buildTailHtml(pkg) + '</div>' +
          '<div class="pet-stack">' +
            layers.map(function (L) { return Dom.imgTag(L.src, L.z, L.tf); }).join('') +
          '</div>' +
        '</div>' +
      '</div>';

    box.innerHTML = html +
      '<div style="text-align:center;color:#888;font-size:11px;margin-top:6px;">' +
        layers.length + ' 层 · 尺寸 ' + esc(size) +
      '</div>' +
      '<div style="text-align:center;color:#6a9a6a;font-size:11px;margin-top:2px;" data-role="selLine">' +
        esc(selSummary(pkg, data)) +
      '</div>' +
      '<div data-role="motionRow" style="margin-top:6px;text-align:center;"></div>';
  }

  /* 把「当前选中了什么」写成人话，方便对照预览 */
  function selSummary(pkg, data) {
    var parts = [];
    ((pkg.contract && pkg.contract.fields) || []).forEach(function (f) {
      var v = data[f.name];
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
      if (f.type === 'text') return;
      parts.push((f.label || f.name) + '=' + (Array.isArray(v) ? v.join('+') : v));
    });
    return parts.length ? '当前：' + parts.join('，') : '';
  }

  /* 预览里的动作切换行（点一下就能看这个动作长什么样） */
  function renderMotionRow(host) {
    var row = host.querySelector('[data-role="motionRow"]');
    if (!row) return;
    var mf = draft.fields.filter(function (f) { return f.name === 'motion'; })[0];
    if (!mf) { row.innerHTML = ''; return; }
    var valid = mf.values.filter(function (v) { return v.key !== undefined && v.key !== null; }).map(function (v) { return v.key; });
    var cur = previewMotion();
    row.innerHTML = '<div style="color:#777;font-size:11px;margin-bottom:4px;">试动作</div>' +
      valid.map(function (k) {
        var on = k === cur;
        var label = (MOTION_PRESETS[k] && MOTION_PRESETS[k].label) || k;
        return '<button data-act="preview-motion" data-m="' + esc(k) + '" style="margin:2px;padding:3px 7px;' +
          'border:none;border-radius:6px;font-size:11px;cursor:pointer;background:' + (on ? '#6a4a9a' : '#333') +
          ';color:#fff;">' + esc(label) + '</button>';
      }).join('');
  }

  /* 统一入口：预览 + 动作切换行一起刷 */
  function renderAll(doc, host) {
    renderPreview(doc, host);
    renderMotionRow(host);
  }

  /* ==================== 渲染编辑器 UI ==================== */
  function input(style) {
    return 'background:#101014;border:1px solid #3a3a44;border-radius:6px;color:#e8e8e8;' +
      'padding:6px 8px;font-size:12px;width:100%;box-sizing:border-box;' + (style || '');
  }
  function fieldRow(label, value, act, extra, dataAttrs) {
    return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
      '<div style="width:88px;flex:none;color:#9a9aa8;font-size:12px;">' + esc(label) + '</div>' +
      '<input value="' + esc(value) + '" data-act="' + act + '" ' + (dataAttrs || '') + ' style="' + input(extra) + '">' +
      '</div>';
  }
  function btn(label, act, bg, dataAttrs) {
    return '<button data-act="' + act + '" ' + (dataAttrs || '') + ' style="padding:5px 9px;border:none;' +
      'border-radius:6px;background:' + bg + ';color:#fff;font-size:11px;font-weight:600;cursor:pointer;">' +
      esc(label) + '</button>';
  }

  /* 「被覆盖时隐藏」下拉：列出现有字段供选择 */
  function overrideOptions(cur) {
    var opts = ['<option value=""' + (!cur ? ' selected' : '') + '>（不设置）</option>'];
    draft.fields.forEach(function (f) {
      if (!f.name) return;
      opts.push('<option value="' + esc(f.name) + '"' + (cur === f.name ? ' selected' : '') + '>' +
        esc((f.label || f.name) + ' (' + f.name + ')') + '</option>');
    });
    return opts.join('');
  }

  /* 图层微调用的小数字输入 */
  function tfNum(fi, vi, key, label, val, min, max, step) {
    return '<label style="display:flex;align-items:center;gap:3px;font-size:10px;color:#9a9aa8;">' +
      esc(label) +
      '<input type="number" data-act="tf" data-f="' + fi + '" data-v="' + vi + '" data-k="' + key + '" ' +
        'value="' + (val === undefined || val === null ? '' : val) + '" ' +
        'min="' + min + '" max="' + max + '" step="' + step + '" ' +
        'style="width:58px;background:#101014;border:1px solid #3a3a44;border-radius:5px;color:#e8e8e8;' +
        'padding:3px 5px;font-size:11px;">' +
    '</label>';
  }
  function hasTfValue(tf) {
    if (!tf) return false;
    return (Number(tf.x) || 0) !== 0 || (Number(tf.y) || 0) !== 0 ||
           (tf.scale !== undefined && Number(tf.scale) !== 1) ||
           (Number(tf.rotate) || 0) !== 0 ||
           (tf.opacity !== undefined && Number(tf.opacity) !== 1);
  }

  /* 尾巴列表：每条独立控制，可以加任意多条。
     标签内部结构要和 Dom.buildTailHtml 完全一致——
     之前这里自己拼了一份，两处结构一旦不同步尾巴就会静默不显示。 */
  function tailBlocks() {
    var list = draft.bubble.tails || [];
    if (!list.length) {
      return '<div style="color:#777;font-size:11px;margin-bottom:8px;">还没有尾巴。点下面按钮加一条。</div>';
    }
    return list.map(function (t, i) {
      var n = function (label, key, min, max, step) {
        return '<label style="display:flex;align-items:center;gap:4px;font-size:10px;color:#9a9aa8;margin:0 8px 4px 0;">' +
          esc(label) +
          '<input type="number" data-act="tail" data-i="' + i + '" data-k="' + key + '" value="' +
            (t[key] === undefined ? '' : t[key]) + '" min="' + min + '" max="' + max + '" step="' + step + '" ' +
            'style="width:56px;background:#101014;border:1px solid #3a3a44;border-radius:5px;color:#e8e8e8;' +
            'padding:3px 5px;font-size:11px;">' +
        '</label>';
      };
      return '<div style="border:1px solid #2c2c36;border-radius:8px;padding:8px;margin-bottom:8px;background:#0c0c10;">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">' +
          '<span style="color:#8bc34a;font-size:11px;font-weight:700;">尾巴 ' + (i + 1) + '</span>' +
          '<select data-act="tail" data-i="' + i + '" data-k="mode" style="' + input('width:120px;') + '">' +
            '<option value="image"' + (t.mode === 'image' ? ' selected' : '') + '>贴图</option>' +
            '<option value="css"' + (t.mode === 'css' ? ' selected' : '') + '>纯色小三角</option>' +
            '<option value="none"' + (t.mode === 'none' ? ' selected' : '') + '>不用这条</option>' +
          '</select>' +
          btn('删掉', 'tail-del', '#5a2a2a', 'data-i="' + i + '"') +
        '</div>' +
        (t.mode === 'image'
          ? '<input data-act="tail" data-i="' + i + '" data-k="image" value="' + esc(t.image || '') + '" ' +
              'placeholder="https://...尾巴贴图URL" style="' + input('width:100%;margin-bottom:6px;') + '">'
          : '') +
        '<div style="display:flex;flex-wrap:wrap;">' +
          n('宽', 'width', 4, 400, 1) + n('高', 'height', 4, 400, 1) +
          n('右移', 'right', -300, 100, 1) + n('下移', 'bottom', -300, 100, 1) +
          n('旋转', 'rotate', -180, 180, 1) +
          n('左右微调', 'offsetX', -200, 200, 1) + n('上下微调', 'offsetY', -200, 200, 1) +
          n('不透明%', 'opacity', 0, 100, 5) +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ==================== 气泡（桌宠消息框）样式面板 ====================
     全部是可视化控件，作者不用写 CSS。 */
  function bubbleSection() {
    var b = draft.bubble;
    var D = Dom.BUBBLE_DEFAULTS;
    var num = function (label, key, min, max, step, unit) {
      return '<label style="display:flex;align-items:center;gap:6px;margin:0 10px 8px 0;font-size:11px;color:#9a9aa8;">' +
        esc(label) +
        '<input type="range" data-act="bub" data-k="' + key + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" ' +
          'value="' + b[key] + '" style="width:96px;accent-color:#6a4a9a;">' +
        '<span data-bubval="' + key + '" style="color:#e8e8e8;min-width:44px;">' + b[key] + (unit || '') + '</span>' +
      '</label>';
    };
    var color = function (label, key) {
      return '<label style="display:flex;align-items:center;gap:6px;margin:0 10px 8px 0;font-size:11px;color:#9a9aa8;">' +
        esc(label) +
        '<input type="color" data-act="bub" data-k="' + key + '" value="' + esc(b[key] || '#000000') + '" ' +
          'style="width:34px;height:22px;background:#101014;border:1px solid #3a3a44;border-radius:5px;padding:0;">' +
      '</label>';
    };
    var textRow = function (label, key, ph) {
      return '<label style="display:flex;align-items:center;gap:6px;margin:0 10px 8px 0;font-size:11px;color:#9a9aa8;">' +
        esc(label) +
        '<input data-act="bub" data-k="' + key + '" value="' + esc(b[key] || '') + '" placeholder="' + esc(ph || '') + '" ' +
          'style="' + input('width:150px;') + '">' +
      '</label>';
    };

    return '<div style="font-weight:700;margin:20px 0 8px;">⑧ 消息框（气泡）美化</div>' +
      '<div style="color:#6f6f7a;font-size:11px;margin-bottom:10px;">' +
        '这就是桌宠说话时头顶那个框。改完立刻能在上面预览里看到。' +
      '</div>' +

      '<div style="background:#101014;border:1px solid #2c2c36;border-radius:8px;padding:10px;margin-bottom:10px;">' +
        '<div style="color:#8bc34a;font-size:11px;font-weight:700;margin-bottom:8px;">配色</div>' +
        '<div style="display:flex;flex-wrap:wrap;">' +
          color('底色', 'bg') + color('渐变第二色', 'bg2') + color('字色', 'color') +
        '</div>' +
        '<div style="color:#555;font-size:10px;margin-bottom:8px;">渐变第二色留黑即不用渐变；点右侧小方块改颜色。</div>' +

        '<div style="color:#8bc34a;font-size:11px;font-weight:700;margin:8px 0;">圆角与留白</div>' +
        '<div style="display:flex;flex-wrap:wrap;">' +
          num('圆角', 'radius', 0, 40, 1, 'px') +
          num('上下内边距', 'paddingY', 0, 30, 1, 'px') +
          num('左右内边距', 'paddingX', 0, 40, 1, 'px') +
        '</div>' +

        '<div style="color:#8bc34a;font-size:11px;font-weight:700;margin:8px 0;">文字</div>' +
        '<div style="display:flex;flex-wrap:wrap;align-items:center;">' +
          num('字号', 'fontSize', 10, 24, 1, 'px') +
          num('行高', 'lineHeight', 1, 2.4, 0.1, '') +
          num('字距', 'letterSpacing', -1, 4, 0.1, 'px') +
          '<label style="display:flex;align-items:center;gap:6px;margin:0 10px 8px 0;font-size:11px;color:#9a9aa8;">粗细' +
            '<select data-act="bub" data-k="fontWeight" style="' + input('width:96px;') + '">' +
              ['normal', 'bold', '600', '500', '300'].map(function (w) {
                return '<option value="' + w + '"' + (String(b.fontWeight) === w ? ' selected' : '') + '>' + w + '</option>';
              }).join('') +
            '</select></label>' +
        '</div>' +

        '<div style="color:#8bc34a;font-size:11px;font-weight:700;margin:8px 0;">边框与阴影</div>' +
        '<div style="display:flex;flex-wrap:wrap;">' +
          num('边框粗', 'borderWidth', 0, 6, 1, 'px') +
          color('边框色', 'borderColor') +
          num('阴影', 'shadow', 0, 60, 1) +
          num('不透明度', 'opacity', 20, 100, 5, '%') +
        '</div>' +

        '<div style="color:#8bc34a;font-size:11px;font-weight:700;margin:8px 0;">位置与宽度</div>' +
        '<div style="display:flex;flex-wrap:wrap;">' +
          num('左移', 'offsetX', -80, 40, 1, 'px') +
          num('上移', 'offsetY', -60, 30, 1, 'px') +
          num('最窄', 'minWidth', 40, 200, 5, 'px') +
          textRow('最宽', 'maxWidth', 'min(170px,40vw)') +
        '</div>' +

        '<div style="color:#8bc34a;font-size:11px;font-weight:700;margin:8px 0;">材质</div>' +
        '<div style="display:flex;flex-wrap:wrap;align-items:center;">' +
          '<label style="display:flex;align-items:center;gap:6px;margin:0 10px 8px 0;font-size:11px;color:#9a9aa8;">预设' +
            '<select data-act="bub-mat" style="' + input('width:130px;') + '">' +
              '<option value="">（当前自定义）</option>' +
              Object.keys(Dom.MATERIAL_PRESETS).map(function (n) {
                return '<option value="' + esc(n) + '">' + esc(n) + '</option>';
              }).join('') +
            '</select></label>' +
          num('毛玻璃', 'blur', 0, 40, 1, 'px') +
          num('饱和度+', 'saturate', 0, 200, 5, '%') +
          num('内发光', 'glow', 0, 40, 1, 'px') +
          color('发光色', 'glowColor') +
        '</div>' +
        '<div style="color:#555;font-size:10px;margin-bottom:8px;">毛玻璃要配合半透明底色才看得出效果（底色可以用 rgba）。</div>' +

        '<div style="color:#8bc34a;font-size:11px;font-weight:700;margin:8px 0;">小尾巴（可以加多个）</div>' +
        tailBlocks() +
        '<div style="margin-bottom:6px;">' + btn('+ 加一条尾巴', 'tail-add', '#2e5d3a') + '</div>' +

        '<div style="margin-top:6px;">' + btn('恢复默认', 'bub-reset', '#444') + '</div>' +
      '</div>';
  }

  function open(doc, pkg) {
    close(doc);
    previewSel = {};                 /* 换包时重置选中值 */
    if (pkg) {
      editingId = pkg.id;
      draft = fromPackage(pkg);
    } else {
      editingId = null;
      draft = blankDraft();
    }
    var wrap = doc.createElement('div');
    wrap.id = PANEL_ID;
    wrap.style.cssText = 'position:fixed;inset:8px;z-index:99999;background:#16161a;color:#e8e8e8;' +
      'border-radius:12px;padding:14px;overflow:auto;font:13px/1.6 -apple-system,"PingFang SC",sans-serif;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.6);';
    wrap.innerHTML = shell();
    doc.body.appendChild(wrap);
    bind(wrap, doc);
    renderAll(doc, wrap);

    /* 演示控制条改了选中值 → 预览跟着刷新（双向同步） */
    if (window.PetDemo) {
      window.PetDemo.on('change', function (data) {
        setSelection(data);
        var cur = doc.getElementById(PANEL_ID);
        if (cur) renderAll(doc, cur);
      });
    }
  }

  function close(doc) {
    if (window.PetDemo && window.PetDemo.isActive()) {
      try { window.PetDemo.stop(doc); } catch (e) {}
    }
    var p = doc.getElementById(PANEL_ID);
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }

  function shell() {
    var d = draft;
    var fieldBlocks = d.fields.map(function (f, fi) {
      var valRows = f.values.map(function (v, vi) {
        var tf = v.tf || {};
        var tfOpen = !!f._tfOpen;
        var tfRow = tfOpen ? (
          '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 6px 0;' +
            'background:#0c0c10;border:1px solid #2c2c36;border-radius:6px;padding:6px;">' +
            tfNum(fi, vi, 'x', '左右%', tf.x, -100, 100, 1) +
            tfNum(fi, vi, 'y', '上下%', tf.y, -100, 100, 1) +
            tfNum(fi, vi, 'scale', '缩放', tf.scale === undefined ? 1 : tf.scale, 0.1, 3, 0.05) +
            tfNum(fi, vi, 'rotate', '旋转°', tf.rotate, -180, 180, 1) +
            tfNum(fi, vi, 'opacity', '不透明', tf.opacity === undefined ? 1 : tf.opacity, 0, 1, 0.05) +
            btn('重置', 'tf-reset', '#444', 'data-f="' + fi + '" data-v="' + vi + '"') +
          '</div>'
        ) : '';
        return '<div style="margin-bottom:5px;">' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<input value="' + esc(v.key) + '" data-act="fv-key" data-f="' + fi + '" data-v="' + vi + '" placeholder="取值名" style="' + input('width:110px;flex:none;') + '">' +
            '<input value="' + esc(v.url) + '" data-act="fv-url" data-f="' + fi + '" data-v="' + vi + '" placeholder="https://...图片URL" style="' + input('flex:1;') + '">' +
            '<input value="' + esc(v.note || '') + '" data-act="fv-note" data-f="' + fi + '" data-v="' + vi + '" placeholder="说明(给AI看)" style="' + input('width:120px;flex:none;') + '">' +
            '<img src="' + esc(v.url || '') + '" data-preview="' + fi + '-' + vi + '" style="width:26px;height:26px;object-fit:contain;flex:none;opacity:' + (v.url ? 1 : 0.2) + ';">' +
            '<button data-act="tf-toggle" data-f="' + fi + '" style="padding:4px 7px;border:none;border-radius:6px;' +
              'background:' + (tfOpen ? '#6a4a9a' : (hasTfValue(tf) ? '#2e5d3a' : '#333')) + ';color:#fff;font-size:11px;cursor:pointer;">微调</button>' +
            btn('×', 'fv-del', '#4a2a2a', 'data-f="' + fi + '" data-v="' + vi + '"') +
          '</div>' + tfRow + '</div>';
      }).join('');
      return '<div style="border:1px solid #2c2c36;border-radius:10px;padding:10px;margin-bottom:10px;">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">' +
          '<input value="' + esc(f.label) + '" data-act="f-label" data-f="' + fi + '" placeholder="显示名（如 眼睛）" style="' + input('width:110px;flex:none;') + '">' +
          '<input value="' + esc(f.name) + '" data-act="f-name" data-f="' + fi + '" placeholder="字段名（英文，如 eyes）" style="' + input('width:110px;flex:none;') + '">' +
          '<span style="color:#9a9aa8;font-size:11px;flex:none;">被覆盖时隐藏：</span>' +
          '<select data-act="f-override" data-f="' + fi + '" style="' + input('width:120px;flex:none;') + '">' +
            overrideOptions(f.override) +
          '</select>' +
          '<input value="' + esc((d.fieldNotes && d.fieldNotes[f.name]) || '') + '" data-act="f-note" data-f="' + fi + '" placeholder="字段补充说明(给AI看)" style="' + input('width:160px;flex:none;') + '">' +
          btn('加取值', 'fv-add', '#2e5d3a', 'data-f="' + fi + '"') +
          btn('删字段', 'f-del', '#5a2a2a', 'data-f="' + fi + '"') +
        '</div>' +
        '<div style="color:#6f6f7a;font-size:11px;margin:-4px 0 8px;">' +
          '「被覆盖时隐藏」：当上面选的字段**有值**时，本字段整层不显示。' +
          '典型用法——眉眼嘴都选 <b>blackface</b>，这样黑脸一出就不会再叠出第二张脸。' +
        '</div>' +
        valRows + '</div>';
    }).join('');

    var accRows = draft.accessories.items.map(function (a, ai) {
      return '<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px;">' +
        '<input value="' + esc(a.key) + '" data-act="acc-key" data-a="' + ai + '" placeholder="取值名" style="' + input('width:110px;flex:none;') + '">' +
        '<input value="' + esc(a.url) + '" data-act="acc-url" data-a="' + ai + '" placeholder="https://...图片URL" style="' + input('flex:1;') + '">' +
        btn('×', 'acc-del', '#4a2a2a', 'data-a="' + ai + '"') +
        '</div>';
    }).join('');

    var motionBoxes = Object.keys(MOTION_PRESETS).map(function (m) {
      var on = draft.motions.indexOf(m) >= 0;
      return '<label style="display:inline-block;margin:0 8px 6px 0;font-size:12px;color:' + (on ? '#e8e8e8' : '#777') + ';">' +
        '<input type="checkbox" data-act="motion" data-m="' + m + '" ' + (on ? 'checked' : '') +
        ' style="accent-color:#6a4a9a;vertical-align:middle;"> ' + MOTION_PRESETS[m].label + '</label>';
    }).join('');

    return '' +
      '<div style="display:flex;gap:8px;align-items:center;position:sticky;top:-14px;background:#16161a;' +
        'padding:6px 0 12px;border-bottom:1px solid #333;margin-bottom:12px;z-index:2;">' +
        '<div style="flex:1;font-weight:700;">' + (editingId ? '编辑桌宠包' : '新建桌宠包') + '</div>' +
        btn('▶ 演示', 'demo', '#8a4a2a') +
        btn('保存并启用', 'save', '#2e7d32') +
        btn('导出 JSON', 'export', '#1565c0') +
        btn('导出独立脚本', 'exportScript', '#7a3a8a') +
        btn('取消', 'cancel', '#444') +
      '</div>' +

      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">' +

        '<div style="flex:1 1 380px;min-width:320px;">' +

          '<div style="font-weight:700;margin:0 0 8px;">① 基本信息</div>' +
          fieldRow('桌宠名字', draft.name, 'name') +
          fieldRow('唯一 ID', draft.id, 'id', '', 'placeholder="英文，如 zaopet"') +
          fieldRow('标签名', draft.tag, 'tag', '', 'placeholder="模型输出用的标签，如 PetState"') +

          '<div style="font-weight:700;margin:16px 0 8px;">② 底图（必填）</div>' +
          fieldRow('底图 URL', draft.base, 'base', '', 'placeholder="https://.../base.png"') +

          '<div style="font-weight:700;margin:16px 0 8px;">③ 表情 / 状态字段</div>' +
          '<div style="color:#888;font-size:11px;margin-bottom:8px;">' +
            '每个字段 = 一组可切换的图片。例如「眼睛」有 normal / happy 两个取值，各贴一张 URL。' +
            '取值名要和模型输出的一致。</div>' +
          fieldBlocks +
          '<div style="margin-bottom:16px;">' + btn('+ 新增字段', 'f-add', '#3a3a6a') + '</div>' +

          '<div style="font-weight:700;margin:16px 0 8px;">④ 配饰（可叠加，可选）</div>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
            '<input value="' + esc(draft.accessories.label) + '" data-act="acc-label" placeholder="显示名（如 配饰）" style="' + input('width:120px;flex:none;') + '">' +
            '<input value="' + esc(draft.accessories.name) + '" data-act="acc-name" placeholder="字段名（如 accessories）" style="' + input('flex:1;') + '">' +
            '<input value="' + esc(draft.accessories.maxItems === undefined ? '' : draft.accessories.maxItems) + '" data-act="acc-max" placeholder="最多几个(留空=不限)" style="' + input('width:130px;flex:none;') + '">' +
            btn('加配饰', 'acc-add', '#2e5d3a') +
          '</div>' +
          '<div style="color:#6f6f7a;font-size:11px;margin:-4px 0 8px;">' +
            '配饰数量默认不限，想加多少加多少。只有填了「最多几个」才会限制。' +
          '</div>' + accRows +

          '<div style="font-weight:700;margin:16px 0 8px;">⑤ 台词（可选）</div>' +
          fieldRow('字段名', draft.speechName, 'speech-name') +
          fieldRow('默认台词', draft.speechDefault, 'speech-default') +

          '<div style="font-weight:700;margin:16px 0 8px;">⑥ 动作（勾选可用动作）</div>' +
          '<div>' + motionBoxes + '</div>' +

          '<div style="font-weight:700;margin:16px 0 8px;">⑦ 外观</div>' +
          fieldRow('尺寸', draft.size, 'size', '', 'placeholder="25.5vh"') +

          bubbleSection() +

        '</div>' +

        '<div style="flex:0 0 220px;position:sticky;top:60px;">' +
          '<div style="font-weight:700;margin:0 0 8px;">实时预览</div>' +
          '<div style="border:1px solid #2c2c36;border-radius:10px;padding:12px;background:#101014;">' +
            '<div data-role="preview"></div>' +
          '</div>' +
          '<div style="color:#777;font-size:11px;margin-top:8px;">' +
            '预览显示的是「每个字段的第一个取值」。贴了图才会出现对应图层。' +
          '</div>' +
        '</div>' +

      '</div>' +
      '<div style="color:#666;font-size:11px;margin-top:16px;border-top:1px solid #2a2a2a;padding-top:10px;">' +
        '代码和结构由引擎固定生成，你只需要填表和贴图片 URL。' +
      '</div>';
  }

  /* ==================== 交互 ==================== */
  function bind(wrap, doc) {
    function refresh() {
      wrap.innerHTML = shell();
      renderAll(doc, wrap);
    }
    wrap.addEventListener('input', function (e) {
      var t = e.target;
      var act = t.getAttribute && t.getAttribute('data-act');
      if (!act) return;
      var f = parseInt(t.getAttribute('data-f'), 10);
      var v = parseInt(t.getAttribute('data-v'), 10);
      var a = parseInt(t.getAttribute('data-a'), 10);
      var val = t.type === 'checkbox' ? t.checked : t.value;

      switch (act) {
        case 'name': draft.name = val; break;
        case 'id': draft.id = val; break;
        case 'tag': draft.tag = val; break;
        case 'base': draft.base = val; break;
        case 'size': draft.size = val; break;
        case 'bub':
          var bk = t.getAttribute('data-k');
          var bv = val;
          if (t.type === 'range' || t.type === 'color' || t.type === 'number') {
            bv = parseFloat(val);
            if (isNaN(bv)) bv = val;
          }
          draft.bubble[bk] = bv;
          var lbl = wrap.querySelector('[data-bubval="' + bk + '"]');
          if (lbl) {
            var unit = (bk === 'lineHeight') ? '' : (bk === 'opacity' ? '%' : (bk === 'tailRotate' ? '°' : 'px'));
            lbl.textContent = bv + unit;
          }
          /* 尾巴样式会影响下面显示哪些参数，需要重建面板 */
          if (bk === 'tailMode') {
            draft.bubble[bk] = bv;
            wrap.innerHTML = shell();
            renderAll(doc, wrap);
            if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
            return;
          }
          break;
        case 'speech-name': draft.speechName = val; break;
        case 'speech-default': draft.speechDefault = val; break;
        case 'acc-label': draft.accessories.label = val; break;
        case 'acc-name': draft.accessories.name = val; break;
        case 'acc-max':
          if (val === '') delete draft.accessories.maxItems;
          else {
            var mv = parseInt(val, 10);
            if (mv > 0) draft.accessories.maxItems = mv; else delete draft.accessories.maxItems;
          }
          break;
        case 'f-label': draft.fields[f].label = val; break;
        case 'f-name': draft.fields[f].name = val; break;
        case 'f-note':
          if (!draft.fieldNotes) draft.fieldNotes = {};
          draft.fieldNotes[draft.fields[f].name] = val;
          break;
        case 'fv-note': draft.fields[f].values[v].note = val; break;
        case 'f-override':
          draft.fields[f].override = val;
          break;
        case 'fv-key': draft.fields[f].values[v].key = val; break;
        case 'fv-url': draft.fields[f].values[v].url = val; break;
        case 'tf':
          var tk = t.getAttribute('data-k');
          var nv = parseFloat(val);
          var tv = draft.fields[f].values[v];
          if (!tv.tf) tv.tf = {};
          if (val === '' || isNaN(nv)) delete tv.tf[tk];
          else tv.tf[tk] = nv;
          break;
        case 'acc-key': draft.accessories.items[a].key = val; break;
        case 'acc-url': draft.accessories.items[a].url = val; break;
        case 'tail':
          var ti = parseInt(t.getAttribute('data-i'), 10);
          var tl = (draft.bubble.tails || [])[ti];
          var tk2 = t.getAttribute('data-k');
          if (!tl) break;
          if (t.type === 'number') {
            var tn = parseFloat(val);
            if (val === '' || isNaN(tn)) delete tl[tk2]; else tl[tk2] = tn;
          } else {
            tl[tk2] = val;
            /* 切换模式会改变下面显示哪些参数，需要重建面板 */
            if (tk2 === 'mode') {
              wrap.innerHTML = shell();
              renderAll(doc, wrap);
              if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
              return;
            }
          }
          break;
        case 'bub-mat':
          var mat = Dom.MATERIAL_PRESETS[val];
          if (mat) {
            Object.keys(mat).forEach(function (mk) { draft.bubble[mk] = mat[mk]; });
            wrap.innerHTML = shell();
            renderAll(doc, wrap);
            if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
            return;
          }
          break;
        case 'motion':
          var i = draft.motions.indexOf(t.getAttribute('data-m'));
          if (val && i < 0) draft.motions.push(t.getAttribute('data-m'));
          if (!val && i >= 0) draft.motions.splice(i, 1);
          break;
      }
      /* 预览跟着变；缩略图跟着变 */
      if (act === 'fv-url') {
        var im = wrap.querySelector('[data-preview="' + f + '-' + v + '"]');
        if (im) { im.src = val; im.style.opacity = val ? 1 : 0.2; }
      }
      renderAll(doc, wrap);
      /* 演示进行中，改动立刻反映到页面上的桌宠 */
      if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
    });

    wrap.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      var f = parseInt(b.getAttribute('data-f'), 10);
      var v = parseInt(b.getAttribute('data-v'), 10);
      var a = parseInt(b.getAttribute('data-a'), 10);
      var needRebuild = false;

      switch (act) {
        case 'cancel': close(doc); return;
        case 'f-add':
          draft.fields.push({ name: '', label: '', type: 'enum', values: [{ key: '', url: '' }] });
          needRebuild = true; break;
        case 'f-del':
          if (confirm('删除这个字段？')) { draft.fields.splice(f, 1); needRebuild = true; }
          break;
        case 'fv-add':
          draft.fields[f].values.push({ key: '', url: '' });
          needRebuild = true; break;
        case 'fv-del':
          draft.fields[f].values.splice(v, 1);
          needRebuild = true; break;
        case 'acc-add':
          draft.accessories.items.push({ key: '', url: '' });
          needRebuild = true; break;
        case 'acc-del':
          draft.accessories.items.splice(a, 1);
          needRebuild = true; break;
        case 'export': doExport(); return;
        case 'tail-add':
          if (!draft.bubble.tails) draft.bubble.tails = [];
          draft.bubble.tails.push(Dom.assignTailDefaults({ mode: 'image', image: '', width: 80, height: 80, right: -10, bottom: -60, rotate: 0 }));
          wrap.innerHTML = shell();
          renderAll(doc, wrap);
          if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
          return;
        case 'tail-del':
          var di = parseInt(b.getAttribute('data-i'), 10);
          if (draft.bubble.tails) draft.bubble.tails.splice(di, 1);
          wrap.innerHTML = shell();
          renderAll(doc, wrap);
          if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
          return;
        case 'tf-toggle':
          draft.fields[f]._tfOpen = !draft.fields[f]._tfOpen;
          wrap.innerHTML = shell();
          renderAll(doc, wrap);
          return;
        case 'tf-reset':
          if (draft.fields[f] && draft.fields[f].values[v]) draft.fields[f].values[v].tf = null;
          wrap.innerHTML = shell();
          renderAll(doc, wrap);
          if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
          return;
        case 'bub-reset':
          draft.bubble = JSON.parse(JSON.stringify(Dom.BUBBLE_DEFAULTS));
          renderAll(doc, wrap);
          if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.update();
          return;
        case 'exportScript': doExportStandalone(doc); return;
        case 'save': doSave(doc); return;
        case 'preview-motion':
          previewSel.motion = b.getAttribute('data-m');
          renderAll(doc, wrap);
          /* 演示正在跑的话，页面上的桌宠也跟着换动作 */
          if (window.PetDemo && window.PetDemo.isActive()) window.PetDemo.setData(previewData());
          return;
        case 'demo':
          if (!window.PetDemo) { alert('演示模块没加载成功。'); return; }
          if (window.PetDemo.isActive()) {
            window.PetDemo.stop(doc);
          } else {
            try {
              window.PetDemo.start(doc, draft, buildPackage, previewData());
            } catch (e) {
              alert('无法开始演示：\n' + (e && e.message ? e.message : e));
            }
          }
          return;
      }
      if (needRebuild) {
        wrap.innerHTML = shell();
        renderAll(doc, wrap);
      }
    });
  }

  /* ==================== 导出：独立酒馆助手脚本 ====================
     把「包数据 + 独立运行时」拼成一个自包含的 .js，
     用户把它导入酒馆助手的脚本库就能用，**不需要装本扩展**。
     运行时源码不在这里重复实现——直接取 core/standalone-runtime.js，
     保证导出的行为和扩展里一模一样。 */
  var RUNTIME_URL = 'core/standalone-runtime.js';
  var runtimeCache = null;

  function fetchRuntime() {
    if (runtimeCache) return Promise.resolve(runtimeCache);
    var base = (window.__SHUSHU_PET__ && window.__SHUSHU_PET__.base) || '';
    /* 用相对自身脚本的路径兜底，避免 base 推断失败 */
    var urls = [base + RUNTIME_URL, 'scripts/extensions/third-party/shushu-pet/' + RUNTIME_URL];
    return urls.reduce(function (p, u) {
      return p.then(function (src) {
        if (src) return src;
        return fetch(u, { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.text() : null; })
          .catch(function () { return null; });
      });
    }, Promise.resolve(null)).then(function (src) {
      if (!src) throw new Error('取不到运行时源码（' + RUNTIME_URL + '），检查扩展文件是否完整');
      runtimeCache = src;
      return src;
    });
  }

  function buildStandaloneScript(pkg, runtimeSrc) {
    /* 动作 CSS 在导出时就算好，运行时不需要再生成 */
    var style = buildPackageStyle(pkg);
    var finalPkg = {};
    Object.keys(pkg).forEach(function (k) { finalPkg[k] = pkg[k]; });
    finalPkg.base = '';
    finalPkg.style = style;

    var header = [
      '/* ============================================================================',
      ' * ' + (pkg.name || pkg.id) + ' · 独立桌宠脚本（鼠鼠桌宠导出）',
      ' * ----------------------------------------------------------------------------',
      ' * 这个文件是自包含的，不依赖任何扩展。',
      ' *',
      ' * 【怎么用】',
      ' *   酒馆助手 → 脚本库 → 全局脚本（或角色脚本）→ 新建',
      ' *   名字随便起，把本文件全部内容粘进去 → 保存 → 启用',
      ' *',
      ' * 【桌宠怎么动】',
      ' *   模型在回复里输出标签 <' + ((pkg.contract && pkg.contract.tag) || 'PetState') + '>{...}</' +
             ((pkg.contract && pkg.contract.tag) || 'PetState') + '>，',
      ' *   桌宠就会跟着变脸/做动作/说话。',
      ' *',
      ' * 【一定要做的】把下面这段提示词加进角色卡，否则模型不知道该输出什么：',
      ' * ----------------------------------------------------------------------------',
      (pkg.contract && pkg.contract.prompt ? pkg.contract.prompt : '').split('\n').map(function (l) {
        return ' * ' + l;
      }).join('\n'),
      ' * ----------------------------------------------------------------------------',
      ' * 生成时间：' + new Date().toLocaleString(),
      ' * ========================================================================== */',
      '',
      '(function () {',
      '  var __PET_PKG__ = ' + JSON.stringify(finalPkg, null, 2).split('\n').join('\n  ') + ';'
    ].join('\n');

    /* 运行时源码本身就是一个完整的 IIFE，而且会从闭包里读 __PET_PKG__。
       所以最省事也最不容易出错的做法：不剥它的壳，直接拼成
          (function(){ var __PET_PKG__ = {...};  <运行时原文>  })();
       运行时在外层 IIFE 内部，能通过闭包读到 __PET_PKG__。 */
    var strict = /^\s*\(function\s*\(\)\s*\{\s*'use strict';/.test(runtimeSrc.trim());
    return [
      header,
      strict ? "  'use strict';" : '',
      '',
      runtimeSrc.trim(),
      '',
      '})();',
      ''
    ].filter(function (l, i) { return !(l === '' && i === 1); }).join('\n');
  }

  /* 生成包专属样式：气泡 + 显示过渡 + 动作，导出时一并算好塞进包里 */
  function buildPackageStyle(pkg) {
    return [
      Dom.buildBubbleCss(pkg),
      Dom.buildBubbleShowCss(),
      Dom.buildMotionCss(pkg)
    ].join('\n');
  }

  function doExportStandalone(doc) {
    var pkg;
    try {
      pkg = buildPackage(draft);
      if (!pkg.name) { alert('先填个桌宠名字。'); return; }
      if (!pkg.id) pkg.id = 'pet-' + Date.now().toString(36);
      R.validate(pkg);                    /* 先校验，避免导出个坏包 */
    } catch (e) {
      alert('导出失败（包本身有问题）：\n' + (e && e.message ? e.message : e));
      return;
    }
    var btn = null;
    fetchRuntime().then(function (src) {
      var code = buildStandaloneScript(pkg, src);
      window.PetSettings.downloadJson(pkg.id + '-standalone.js', null, code);
      U.log('已导出独立脚本：' + pkg.id + '-standalone.js（' + code.length + ' 字符）');
      alert('已导出「' + pkg.name + '-standalone.js」\n\n' +
            '用法：酒馆助手 → 脚本库 → 新建 → 把文件内容粘进去 → 保存启用。\n' +
            '不需要装鼠鼠桌宠扩展也能跑。\n\n' +
            '文件开头附带了要贴进角色卡的提示词，直接复制即可。');
    }).catch(function (e) {
      alert('导出失败：\n' + (e && e.message ? e.message : e));
    });
  }

  function doExport() {
    try {
      var pkg = buildPackage(draft);
      if (!pkg.name) { alert('先填个桌宠名字。'); return; }
      if (!pkg.id) pkg.id = 'pet-' + Date.now().toString(36);
      window.PetSettings.downloadJson(pkg.id + '.json', pkg);
    } catch (e) { alert('导出失败：' + e.message); }
  }

  function doSave(doc) {
    try {
      var pkg = buildPackage(draft);
      if (!pkg.name) { alert('先填个桌宠名字。'); return; }
      if (!pkg.id) pkg.id = 'pet-' + Date.now().toString(36);
      if (editingId && editingId !== pkg.id) R.removePackage(editingId);
      R.validate(pkg);                       /* 引擎再兜一次，出错会给出明确原因 */
      var id = R.addPackage(pkg);
      U.log('桌宠包已保存：' + id);
      close(doc);
      if (handlers.onChange) handlers.onChange();
      var prompt = pkg.contract.prompt;
      alert('已保存并启用：「' + pkg.name + '」\n\n下面这段提示词请复制进角色卡（已同时复制到剪贴板）：\n\n' + prompt);
      try { navigator.clipboard.writeText(prompt); } catch (e) {}
    } catch (e) {
      alert('保存失败：\n' + (e && e.message ? e.message : e));
    }
  }

  /* ==================== 已存在的包 → 草稿 ==================== */
  function fromPackage(pkg) {
    var d = blankDraft();
    d.id = pkg.id || '';
    d.name = pkg.name || '';
    d.tag = (pkg.contract && pkg.contract.tag) || 'PetState';
    d.size = (pkg.render && pkg.render.size) || '25.5vh';
    d.zIndex = (pkg.render && pkg.render.zIndex) || 3500;
    d.bubble = JSON.parse(JSON.stringify(Dom.BUBBLE_DEFAULTS));
    var savedBubble = (pkg.render && pkg.render.bubble) || null;
    if (savedBubble) {
      Object.keys(savedBubble).forEach(function (k) { d.bubble[k] = savedBubble[k]; });
    } else {
      /* 老包没存 bubble 对象，用旧的两个字段时间兜一下 */
      if (pkg.render && pkg.render.bubbleBg) d.bubble.bg = pkg.render.bubbleBg;
      if (pkg.render && pkg.render.bubbleColor) d.bubble.color = pkg.render.bubbleColor;
    }

    var baseLayer = (pkg.layers || []).filter(function (L) { return L.type === 'base'; })[0];
    d.base = (baseLayer && baseLayer.asset) || '';

    d.fieldNotes = (pkg.contract && pkg.contract.fieldNotes) ? JSON.parse(JSON.stringify(pkg.contract.fieldNotes)) : {};
    d.fields = [];
    d.accessories = { name: 'accessories', label: '配饰', items: [] };
    d.speechName = '';
    d.speechDefault = '';

    var layerByField = {};
    (pkg.layers || []).forEach(function (L) {
      if (L.field) layerByField[L.field] = L;
    });

    ((pkg.contract && pkg.contract.fields) || []).forEach(function (f) {
      if (f.type === 'enum') {
        var L = layerByField[f.name];
        d.fields.push({
          name: f.name, label: f.label || f.name, type: 'enum',
          override: (L && typeof L.skipWhen === 'string') ? L.skipWhen : '',
          values: (f.values || []).map(function (k) {
            return {
              key: k,
              url: (L && L.map && L.map[k]) || '',
              note: (f.valueNotes && f.valueNotes[k]) || '',
              tf: (L && L.transforms && L.transforms[k]) ? JSON.parse(JSON.stringify(L.transforms[k])) : null
            };
          })
        });
      } else if (f.type === 'list') {
        var L2 = layerByField[f.name];
        d.accessories = {
          name: f.name, label: f.label || f.name,
          items: (f.values || []).map(function (k) {
            return {
              key: k,
              url: (L2 && L2.map && L2.map[k]) || '',
              note: (f.valueNotes && f.valueNotes[k]) || '',
              tf: (L2 && L2.transforms && L2.transforms[k]) ? JSON.parse(JSON.stringify(L2.transforms[k])) : null
            };
          })
        };
        if (f.maxItems > 0) d.accessories.maxItems = f.maxItems;
      } else if (f.type === 'text') {
        d.speechName = f.name;
        d.speechDefault = f.default || '';
      }
    });

    d.motions = Object.keys(pkg.motions || {}).filter(function (m) { return MOTION_PRESETS[m]; });
    if (!d.motions.length) d.motions = ['still'];
    return d;
  }

  window.PetEditor = {
    on: on,
    open: open,
    close: close,
    buildPackage: buildPackage,
    fromPackage: fromPackage,
    buildStandaloneScript: buildStandaloneScript,
    fetchRuntime: fetchRuntime,
    dumpDraft: function () { return JSON.parse(JSON.stringify(draft)); },
    MOTION_PRESETS: MOTION_PRESETS
  };
})();
