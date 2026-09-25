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
  var state = { open: false };

  function on(ev, fn) { if (ev in handlers) handlers[ev] = fn; }

  function currentAvatar() {
    try { return handlers.getAvatar ? handlers.getAvatar() : null; } catch (e) { return null; }
  }

  function fireChange() {
    try { if (handlers.onChange) handlers.onChange(); } catch (e) { U.warn(e); }
  }

  /* ---------------- 悬浮按钮 ---------------- */
  function installButton(doc) {
    if (doc.getElementById(BTN_ID)) return;
    var b = doc.createElement('div');
    b.id = BTN_ID;
    b.textContent = '鼠鼠桌宠';
    b.title = '鼠鼠桌宠设置';
    b.style.cssText =
      'position:fixed;left:6px;top:120px;z-index:9001;background:rgba(120,80,160,.92);color:#fff;' +
      'padding:7px 10px;border-radius:9px;font:600 12px/1 -apple-system,"PingFang SC",sans-serif;' +
      'box-shadow:0 3px 10px rgba(0,0,0,.35);cursor:pointer;pointer-events:auto;user-select:none;';
    b.onclick = function () { toggle(); };
    doc.body.appendChild(b);
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
      (rows || '<div style="color:#888;">还没有任何桌宠包。点「导入 JSON」添加。</div>') +
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

  window.PetSettings = {
    on: on,
    open: open,
    close: close,
    toggle: toggle,
    installButton: installButton,
    downloadJson: downloadJson
  };
})();
