/* ============================================================================
 * 鼠鼠桌宠 · core/settings.js
 * 设置面板：导入/导出桌宠包、绑定角色、重置位置。挂在 window.PetSettings
 * 只做 UI 和数据组织，具体刷新交给 boot.js 注册的回调。
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;
  var R = window.PetRegistry;

  var PANEL_ID = 'shushu-pet-panel';
  var BTN_ID = 'shushu-pet-open';

  var handlers = { onChange: null, onReset: null, getAvatar: null };
  var state = { open: false, watching: false };

  function on(ev, fn) { if (ev in handlers) handlers[ev] = fn; }

  function currentAvatar() {
    try { return handlers.getAvatar ? handlers.getAvatar() : null; } catch (e) { return null; }
  }

  function fireChange() {
    try { if (handlers.onChange) handlers.onChange(); } catch (e) { U.warn(e); }
  }

  /* ---------------- 悬浮按钮 ---------------- */
  /* 样式全部带 !important：酒馆主题和别的扩展经常写 `div { ... }` 这种宽选择器，
     这个按钮是裸 div，很容易被顺手改掉。 */
  var BTN_CSS =
    'position:fixed !important;left:6px !important;top:120px !important;' +
    'z-index:9001 !important;background:rgba(120,80,160,.92) !important;color:#fff !important;' +
    'padding:7px 10px !important;border-radius:9px !important;margin:0 !important;' +
    'width:auto !important;height:auto !important;min-width:0 !important;max-width:none !important;' +
    'font:600 12px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif !important;' +
    'text-align:center !important;box-shadow:0 3px 10px rgba(0,0,0,.35) !important;' +
    'cursor:pointer !important;pointer-events:auto !important;user-select:none !important;' +
    'display:block !important;visibility:visible !important;opacity:1 !important;';

  function makeButton(doc) {
    var b = doc.createElement('div');
    b.id = BTN_ID;
    b.textContent = '鼠鼠桌宠';
    b.title = '鼠鼠桌宠设置（点一下打开）';
    b.style.cssText = BTN_CSS;
    b.onclick = function () { toggle(); };
    return b;
  }

  /* 按钮在不在。注意：不能只看元素存不存在——
     被主题 display:none 或者被别的浮层盖住，元素也还在，用户一样看不见。 */
  function buttonOk(doc) {
    var b = doc.getElementById(BTN_ID);
    if (!b || !b.isConnected) return false;
    try {
      if (!b.offsetWidth || !b.offsetHeight) return false;   /* 被 display:none 或尺寸压成 0 */
      if (doc.defaultView.getComputedStyle(b).visibility === 'hidden') return false;
    } catch (e) { return true; }
    return true;
  }

  function installButton(doc) {
    if (buttonOk(doc)) return;
    var old = doc.getElementById(BTN_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var b = makeButton(doc);
    try { (doc.body || doc.documentElement).appendChild(b); } catch (e) {}
  }

  /* 保活：主题重绘 / 别的扩展清 DOM 时把按钮补回来 */
  function startButtonWatch(doc) {
    if (state.watching) return;
    state.watching = true;
    try {
      doc.defaultView.setInterval(function () { installButton(doc); }, 2000);
    } catch (e) {}
  }

  /* ---------------- 面板 ---------------- */
  function close(doc) {
    var p = doc.getElementById(PANEL_ID);
    if (p && p.parentNode) p.parentNode.removeChild(p);
    state.open = false;
  }
  function toggle() { if (state.open) close(document); else open(document); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function open(doc) {
    close(doc);
    if (window.PetDemo && window.PetDemo.isActive()) {
      try { window.PetDemo.stop(doc); } catch (e) {}
    }
    var avatar = currentAvatar();
    var pkgs = R.listPackages();
    var bindings = R.getBindings();
    var defId = R.getDefaultId();
    var boundId = avatar ? bindings[avatar] : null;

    var wrap = doc.createElement('div');
    wrap.id = PANEL_ID;
    wrap.style.cssText =
      'position:fixed;left:8px;right:8px;top:8px;bottom:8px;z-index:99998;background:#16161a;color:#e8e8e8;' +
      'border-radius:12px;padding:14px;overflow:auto;font:13px/1.6 -apple-system,"PingFang SC",sans-serif;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.6);';

    var rows = pkgs.map(function (p) {
      var isBound = boundId === p.id;
      var isDefault = defId === p.id;
      return '' +
        '<div style="border:1px solid #333;border-radius:10px;padding:10px;margin-bottom:8px;background:#1d1d22;">' +
          '<div style="font-weight:700;margin-bottom:2px;">' + esc(p.name) +
            '<span style="font-weight:400;color:#888;font-size:11px;">  [' + p.source + '] ' + esc(p.id) + '</span></div>' +
          '<div style="color:#aaa;font-size:11px;margin-bottom:8px;">' + esc((p.pkg.contract && p.pkg.contract.tag) || '?') +
            ' · 字段 ' + (((p.pkg.contract && p.pkg.contract.fields) || []).length) +
            ' · 图层 ' + ((p.pkg.layers || []).length) +
            ' · 动作 ' + Object.keys(p.pkg.motions || {}).length + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
            '<button data-act="bind" data-id="' + esc(p.id) + '" style="' + btnStyle(isBound ? '#2e7d32' : '#333') + '">' +
              (isBound ? '已绑定当前角色' : '绑定当前角色') + '</button>' +
            '<button data-act="default" data-id="' + esc(p.id) + '" style="' + btnStyle(isDefault ? '#1565c0' : '#333') + '">' +
              (isDefault ? '已是默认' : '设为默认') + '</button>' +
            '<button data-act="edit" data-id="' + esc(p.id) + '" style="' + btnStyle('#6a4a9a') + '">可视化编辑</button>' +
            '<button data-act="export" data-id="' + esc(p.id) + '" style="' + btnStyle('#333') + '">导出</button>' +
            '<button data-act="exportRegex" data-id="' + esc(p.id) + '" style="' + btnStyle('#2b5a7f') + '">导出正则</button>' +
            (p.source === 'user'
              ? '<button data-act="del" data-id="' + esc(p.id) + '" style="' + btnStyle('#7f2b2b') + '">删除</button>'
              : '') +
          '</div>' +
        '</div>';
    }).join('');

    wrap.innerHTML = '' +
      '<div style="display:flex;gap:8px;align-items:center;position:sticky;top:-14px;background:#16161a;' +
        'padding:6px 0 12px;border-bottom:1px solid #333;margin-bottom:12px;">' +
        '<div style="flex:1;font-weight:700;">鼠鼠桌宠 · 设置</div>' +
        '<button data-act="create" style="' + btnStyle('#6a4a9a') + '">+ 新建桌宠包</button>' +
        '<button data-act="import" style="' + btnStyle('#2e7d32') + '">导入 JSON</button>' +
        '<button data-act="reset" style="' + btnStyle('#7f6a2b') + '">重置位置</button>' +
        '<button data-act="close" style="' + btnStyle('#444') + '">关闭</button>' +
      '</div>' +
      '<div style="color:#aaa;font-size:12px;margin-bottom:10px;">' +
        '当前角色：<b style="color:#e8e8e8;">' + esc(avatar || '(未选择角色)') + '</b>' +
        (boundId ? ' · 已绑定包 <b style="color:#8bc34a;">' + esc(boundId) + '</b>' : ' · 未绑定（将使用默认包）') +
      '</div>' +

      /* 帮助区：怎么用 + 怎么彻底清掉本机数据 */
      '<div style="background:#12121a;border:1px solid #2c2c36;border-radius:10px;padding:10px;margin-bottom:12px;">' +
        '<div style="font-weight:700;margin-bottom:6px;">快速上手</div>' +
        '<div style="color:#9a9aa8;font-size:12px;line-height:1.7;">' +
          '1. 点下面 <b style="color:#8bc34a;">「+ 新建桌宠包」</b>，填名字、贴底图 URL<br>' +
          '2. 加几个字段（如"眼睛"），每个取值贴一张图 URL<br>' +
          '3. 点 <b style="color:#8bc34a;">「▶ 演示」</b> 看效果，满意后 <b style="color:#8bc34a;">「保存并启用」</b><br>' +
          '4. 保存时弹出的<b>提示词</b>复制进角色卡，模型就会输出标签驱动桌宠' +
        '</div>' +
      '</div>' +

      '<div style="background:#1a1216;border:1px solid #3a2c36;border-radius:10px;padding:10px;margin-bottom:12px;">' +
        '<div style="font-weight:700;margin-bottom:6px;color:#e57373;">清理本机数据</div>' +
        '<div style="color:#9a9aa8;font-size:12px;line-height:1.7;margin-bottom:8px;">' +
          '本机导入/编辑过的包存在浏览器 localStorage 里，<b>不在服务端</b>。' +
          '换电脑或清浏览器数据就会丢。想清空就点下面。' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<button data-act="clearUser" style="' + btnStyle('#7f3a3a') + '">清空本机桌宠包</button>' +
          '<button data-act="clearAll" style="' + btnStyle('#7f2b2b') + '">清空全部本地数据</button>' +
          '<button data-act="diagnose" style="' + btnStyle('#3a5a7f') + '">出问题了？点这里自检</button>' +
        '</div>' +
      '</div>' +

      (rows || '<div style="color:#888;">本机还没有桌宠包。点「+ 新建桌宠包」或「导入 JSON」。</div>') +
      '<div style="color:#666;font-size:11px;margin-top:14px;border-top:1px solid #2a2a2a;padding-top:10px;">' +
        '作者只需要提供：<b>标签名</b> + <b>字段契约</b> + <b>立绘素材</b>。' +
        '包格式见扩展目录下的 <code>docs/包格式.md</code>。' +
      '</div>';

    wrap.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      var id = b.getAttribute('data-id');
      handleAction(doc, act, id, avatar);
    });

    doc.body.appendChild(wrap);
    state.open = true;
  }

  function btnStyle(bg) {
    return 'padding:7px 11px;border:none;border-radius:8px;background:' + bg +
      ';color:#fff;font-size:12px;font-weight:600;cursor:pointer;';
  }

  function handleAction(doc, act, id, avatar) {
    try {
      if (act === 'close') return close(doc);

      if (act === 'create') {
        close(doc);
        if (window.PetEditor) window.PetEditor.open(doc, null);
        return;
      }

      if (act === 'edit') {
        var target = R.getPackage(id);
        if (!target) { alert('找不到这个包。'); return; }
        close(doc);
        if (window.PetEditor) window.PetEditor.open(doc, target);
        return;
      }

      if (act === 'clearUser') {
        var userPkgs = R.listPackages().filter(function (p) { return p.source === 'user'; });
        if (!userPkgs.length) { alert('本机没有导入/编辑过的包，没什么可清的（内置模板不会被清掉）。'); return; }
        if (!confirm('清空本机 ' + userPkgs.length + ' 个桌宠包？\n\n' +
                     userPkgs.map(function (p) { return '· ' + p.name; }).join('\n') +
                     '\n\n（内置模板包会保留）')) return;
        userPkgs.forEach(function (p) { try { R.removePackage(p.id); } catch (e) {} });
        U.log('已清空本机 ' + userPkgs.length + ' 个包');
        fireChange();
        return open(doc);
      }

      if (act === 'clearAll') {
        if (!confirm('清空全部本地数据？\n\n' +
                     '· 删除本机所有桌宠包（含内置模板的本地副本）\n' +
                     '· 清空角色绑定、默认包、桌宠位置\n\n' +
                     '只影响浏览器本地，扩展文件不受影响。')) return;
        [R.LS_PACKAGES, R.LS_BINDINGS, R.LS_DEFAULT, 'shushu-pet:state'].forEach(function (k) {
          try { localStorage.removeItem(k); } catch (e) {}
        });
        U.log('已清空全部本地数据');
        fireChange();
        return open(doc);
      }

      if (act === 'diagnose') {
        if (window.PetDiagnose) { window.PetDiagnose.show(doc); }
        else { alert('自检模块 core/diagnose.js 没加载上——这本身就说明扩展文件不完整，请重新完整下载一次。'); }
        return;
      }

      if (act === 'reset') {
        if (handlers.onReset) handlers.onReset();
        U.store.del('shushu-pet:state');
        U.log('已重置位置');
        fireChange();
        return open(doc);
      }

      if (act === 'bind') {
        if (!avatar) { alert('先选一个角色再绑定。'); return; }
        var cur = R.getBindings()[avatar];
        R.bind(avatar, cur === id ? null : id);
        fireChange();
        return open(doc);
      }

      if (act === 'default') {
        R.setDefaultId(R.getDefaultId() === id ? null : id);
        fireChange();
        return open(doc);
      }

      if (act === 'del') {
        if (!confirm('删除桌宠包「' + id + '」？')) return;
        R.removePackage(id);
        fireChange();
        return open(doc);
      }

      if (act === 'exportRegex') {
        var rp = R.getPackage(id);
        if (!rp) { alert('找不到这个包。'); return; }
        downloadJson(id + '-regex.json', buildRegexScripts(rp));
        U.log('已导出正则：' + id + '-regex.json');
        alert('已导出「' + (rp.name || id) + '-regex.json」\n\n' +
              '用法：酒馆 → 扩展 → 正则 → 点「导入」选中这个文件。\n\n' +
              '它包含两条正则：\n' +
              '  1. ' + (rp.name || id) + '桌宠 —— 把标签从聊天里隐藏（显示层）\n' +
              '  2. 不发送 —— 发给模型时去掉标签，省 token（生成层）\n\n' +
              '这两条都是可选的：桌宠不依赖正则也能跑，加了只是让聊天干净些。');
        return;
      }

      if (act === 'export') {
        var pkg = R.getPackage(id);
        downloadJson(id + '.json', pkg);
        return;
      }

      if (act === 'import') {
        pickJsonFile(function (text, filename) {
          try {
            var pkg = JSON.parse(text);
            if (!pkg.id) pkg.id = String(filename || '').replace(/\.json$/i, '') || ('pkg-' + Date.now().toString(36));
            var newId = R.addPackage(pkg);
            U.log('已导入桌宠包：' + newId);
            if (avatar) R.bind(avatar, newId);   /* 导入后直接绑给当前角色，省一步 */
            fireChange();
            open(doc);
          } catch (err) {
            alert('导入失败：\n' + (err && err.message ? err.message : err));
          }
        });
        return;
      }
    } catch (e) {
      alert('操作失败：' + (e && e.message ? e.message : e));
    }
  }

  /* 下载文件。传 raw 就是原样下载文本（用于导出 .js），否则序列化成 JSON */
  function downloadJson(filename, obj, raw) {
    try {
      var isRaw = (typeof raw === 'string');
      var type = isRaw ? 'text/javascript;charset=utf-8' : 'application/json';
      var body = isRaw ? raw : JSON.stringify(obj, null, 2);
      var blob = new Blob([body], { type: type });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { alert('下载失败：' + e.message); }
  }

  function pickJsonFile(cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.style.display = 'none';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { cb(String(fr.result || ''), f.name); };
      fr.readAsText(f);
      setTimeout(function () { inp.remove(); }, 1000);
    };
    document.body.appendChild(inp);
    inp.click();
  }

  /* 生成可直接被酒馆「正则」面板导入的 JSON。
     两条：一条管显示（藏标签），一条管发给模型（省 token）。
     placement [2] = AI 输出；markdownOnly 管显示层，promptOnly 管生成层。 */
  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function buildRegexScripts(pkg) {
    var tag = (pkg.contract && pkg.contract.tag) || 'PetState';
    var safe = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /* 转义斜杠是为了兼容把整个字符串当正则字面量处理的解析方式；
       标准 RegExp 的 source 里 `\/` 也合法，两种都认。 */
    var find = '/<' + safe + '>[\\s\\S]*?<\\/' + safe + '>/';
    var name = pkg.name || '桌宠';
    /* 包名里已经带"桌宠"就不重复加，避免出现「示例桌宠桌宠」 */
    var base = /桌宠\s*$/.test(name) ? name : (name + '桌宠');
    return [
      {
        id: uuid(),
        scriptName: base,
        description: '把 <' + tag + '> 标签从聊天里隐藏（只影响显示，不改动聊天数据）',
        findRegex: find,
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: 2
      },
      {
        id: uuid(),
        scriptName: base + '不发送',
        description: '发给模型时去掉 <' + tag + '> 标签，省 token',
        findRegex: find,
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: 0,
        maxDepth: null
      }
    ];
  }

  window.PetSettings = {
    on: on,
    open: open,
    close: close,
    toggle: toggle,
    installButton: installButton,
    startButtonWatch: startButtonWatch,
    downloadJson: downloadJson,
    buildRegexScripts: buildRegexScripts
  };
})();
