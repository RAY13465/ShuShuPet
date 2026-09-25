/* ============================================================================
 * 鼠鼠桌宠 · core/diagnose.js
 * ----------------------------------------------------------------------------
 * 一键自检：把「为什么我这儿没反应」需要的信息全捞出来，生成一段可复制的文本。
 * 排查桌宠不显示 / 按钮不出现时，让用户点一下、把文本发过来即可。
 * 这个文件必须在 boot.js **之前** 加载：boot 失败时它仍然可用。
 * ========================================================================== */
(function () {
  'use strict';

  /* 期望存在的文件清单。core 下那部分直接问 index.js 要（它挂在 __SHUSHU_PET__.core），
     避免两处清单写岔；index.js 自己没跑起来时用这份兜底。 */
  var FALLBACK_CORE = [
    'core/util.js',
    'core/placeholder.js',
    'core/dom.js',
    'core/position.js',
    'core/engine.js',
    'core/adapter.js',
    'core/registry.js',
    'core/settings.js',
    'core/editor.js',
    'core/demo.js',
    'core/diagnose.js',
    'core/standalone-runtime.js',
    'core/boot.js'
  ];

  var EXPECTED = ['index.js', 'style.css', 'manifest.json', 'builtin/example.json']
    .concat((function () {
      try {
        var c = window.__SHUSHU_PET__ && window.__SHUSHU_PET__.core;
        if (c && c.length) {
          /* 独立脚本导出的运行时不在启动清单里，但自检也该确认它在 */
          return c.indexOf('core/standalone-runtime.js') < 0
            ? c.concat(['core/standalone-runtime.js']) : c.slice();
        }
      } catch (e) {}
      return FALLBACK_CORE;
    })());

  var PANEL_ID = 'shushu-pet-diag';

  function yes(b) { return b ? '是' : '否'; }

  function base() {
    try { return (window.__SHUSHU_PET__ && window.__SHUSHU_PET__.base) || ''; }
    catch (e) { return ''; }
  }

  /* 从加载本文件的 <script> 反推目录，base 推断失败时用 */
  function guessBase() {
    try {
      var ss = document.querySelectorAll('script[src]');
      for (var i = ss.length - 1; i >= 0; i--) {
        var s = ss[i].getAttribute('src') || '';
        var m = s.match(/^(.*\/)core\/[^/]+\.js(\?.*)?$/);
        if (m) return m[1];
      }
    } catch (e) {}
    return '';
  }

  function browser() {
    try {
      var u = navigator.userAgent || '';
      var m = u.match(/(Chrome|Firefox|Edg|Safari)\/([\d.]+)/);
      var name = m ? m[1] : '未知';
      if (/Edg\//.test(u)) name = 'Edge';
      /* 酒馆常被塞进 Electron / 手机 WebView，这两种最容易出兼容问题 */
      var shell = /Electron/i.test(u) ? 'Electron 外壳' : (/(iPhone|iPad|Android)/.test(u) ? '手机 WebView' : '普通浏览器');
      return name + (m ? ' ' + m[2].split('.')[0] : '') + ' / ' + shell;
    } catch (e) { return '未知'; }
  }

  /* 探测一个文件在不在：用 HEAD 拿状态码，比直接 GET 轻 */
  function probe(url) {
    return fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { return r.ok ? 'OK' : ('HTTP ' + r.status); })
      .catch(function (e) { return '取不到(' + ((e && e.message) || '网络错误') + ')'; });
  }

  /* 判断自检跑在哪儿：扩展宿主页（酒馆主界面）还是扩展目录下的独立自检页。
     两种环境能查的东西不一样，必须标出来，否则独立页上"模块全缺"会被误读成故障。 */
  function contextKind() {
    try {
      if (window.SillyTavern || document.getElementById('chat') ||
          document.getElementById('send_but') || document.getElementById('chat_history')) {
        return 'tavern';
      }
    } catch (e) {}
    return 'standalone';
  }

  function collect() {
    var L = [];
    var P = window.__SHUSHU_PET__ || {};
    var b = P.base || guessBase();
    var body = document.body;
    var kind = contextKind();
    /* 结论：只放"确定是问题"和"值得注意"的，正常的不用写，免得报告太长 */
    var verdicts = [];
    function flag(lv, msg) { verdicts.push({ lv: lv, msg: msg }); }

    /* ---------------- 环境 ---------------- */
    L.push('===== 鼠鼠桌宠 自检报告 =====');
    L.push('生成时间：' + new Date().toLocaleString());
    L.push('检测位置：' + (kind === 'tavern'
      ? '酒馆主界面（扩展理应在这里运行）'
      : '扩展目录下的独立自检页（这里查不到模块和本地数据，属正常）'));
    L.push('');
    L.push('【环境】');
    L.push('  页面地址：' + location.href);
    L.push('  浏览器：' + browser());
    L.push('  视口：' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight);
    L.push('  扩展目录：' + (P.folder || '(未取到)'));
    L.push('  目录完整路径：' + (b || '(未取到)'));
    L.push('  扩展版本：' + (P.version || '(未取到)'));
    L.push('  启动完成(ready)：' + yes(!!P.ready));
    L.push('  启动报错：' + (P.error ? P.error : '(无)'));

    if (kind === 'tavern') {
      if (!window.__SHUSHU_PET__) {
        flag('✗', '扩展根本没启动（window.__SHUSHU_PET__ 不存在）。' +
                  '说明酒馆没加载到这个扩展：检查目录是否放在 data/default-user/extensions/ 下、' +
                  '里面是否有 index.js 和 manifest.json，然后在「扩展」面板点一次刷新。');
      } else if (P.error) {
        flag('✗', '扩展启动到一半失败了：' + P.error);
      } else if (!P.ready) {
        flag('!', '扩展还在启动中或卡住了（ready 一直为否）。核对下面【文件完整性】有没有缺文件。');
      }
    }

    /* 酒馆版本：脚本里现成的 /version 接口 */
    return fetch('/version', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) {
        L.push('  酒馆版本：' + (v && v.pkgVersion ? v.pkgVersion + ' (' + (v.gitRevision || '') + ')' : '(取不到)'));

        /* 酒馆助手的版本从它自己的 manifest 里读，读不到就算了 */
        return fetch('/scripts/extensions/third-party/JS-Slash-Runner/manifest.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      })
      .then(function (hm) {
        L.push('  酒馆助手：' + (hm && hm.version ? 'v' + hm.version : '(未安装或取不到)'));
        L.push('  酒馆助手 API(getChatMessages)：' + yes(typeof window.getChatMessages === 'function'));

        /* ---------------- 根元素包含块 ---------------- */
        L.push('');
        L.push('【position:fixed 包含块】（html 上有 transform/perspective 会让 fixed 元素整体偏移）');
        var he = document.documentElement;
        var bad = [];
        ['transform', 'perspective'].forEach(function (p) {
          var v = '';
          try { v = he.style.getPropertyValue(p); } catch (e) {}
          if (v && v !== 'none') bad.push(p + '=' + v);
        });
        L.push('  html 内联 transform/perspective：' + (bad.length ? bad.join(', ') : '无'));
        var cs = window.getComputedStyle(he);
        L.push('  html 实际 transform：' + cs.transform);
        L.push('  html 实际 perspective：' + cs.perspective);

        /* ---------------- 文件完整性 ---------------- */
        L.push('');
        L.push('【文件完整性】（缺文件是"什么都没发生"最常见的原因）');
        return Promise.all(EXPECTED.map(function (rel) {
          return probe(b + rel).then(function (st) { return { rel: rel, st: st }; });
        }));
      })
      .then(function (results) {
        var miss = [];
        results.forEach(function (x) {
          if (x.st !== 'OK') miss.push(x.rel + ' → ' + x.st);
        });
        if (!miss.length) {
          L.push('  全部 ' + EXPECTED.length + ' 个文件都在 ✓');
        } else {
          L.push('  ✗ 有 ' + miss.length + ' 个文件取不到：');
          miss.forEach(function (m) { L.push('      ' + m); });
          flag('✗', '扩展文件不完整，缺 ' + miss.length + ' 个文件（见上面列表）。' +
                    '请重新从仓库完整下载后覆盖，注意 core/ 文件夹要一起放进去。');
        }

        /* ---------------- 界面上到底有没有 ---------------- */
        L.push('');
        L.push('【界面元素】');
        var btn = document.getElementById('shushu-pet-open');
        L.push('  主页悬浮按钮 #shushu-pet-open：' + (btn ? '存在' : '不存在 ✗'));
        if (btn) {
          var r = btn.getBoundingClientRect();
          L.push('    文字：' + JSON.stringify(btn.textContent));
          L.push('    位置尺寸：' + Math.round(r.left) + ',' + Math.round(r.top) +
                 '  ' + Math.round(r.width) + 'x' + Math.round(r.height));
          L.push('    display：' + window.getComputedStyle(btn).display +
                 '  visibility：' + window.getComputedStyle(btn).visibility);
          /* 被别的浮层盖住也会"看不见"，所以查一下这个点最上面是谁。
             注意：酒馆自己的欢迎弹窗本来就盖在左上角，那不算故障——
             这里只在"盖住它的元素不透明"时才提示，避免误报。 */
          try {
            var cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
            var top = document.elementFromPoint(cx, cy);
            var onTop = false;
            for (var n = top; n; n = n.parentElement) { if (n === btn) { onTop = true; break; } }
            var note = '';
            if (!onTop && top) {
              var tc = window.getComputedStyle(top).backgroundColor || '';
              var transparent = tc === 'transparent' ||
                /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(tc);
              note = transparent
                ? '（是个透明浮层，不影响点击）'
                : '（不透明，可能真的挡住了）';
            }
            L.push('    该点最上层元素：' + (top ? (top.id || top.tagName) : 'null') +
                   (onTop ? ' ✓ 就是按钮本身' : note));
          } catch (e) {}
          L.push('    在视口内：' + yes(r.width > 0 && r.height > 0 &&
                 r.left >= 0 && r.top >= 0 &&
                 r.right <= document.documentElement.clientWidth &&
                 r.bottom <= document.documentElement.clientHeight));
        }
        var host = document.getElementById('shushu-pet-host');
        L.push('  桌宠元素 #shushu-pet-host：' + (host ? '存在' : '不存在（当前聊天没有桌宠数据时正常）'));
        var panel = document.getElementById(PANEL_ID);
        L.push('  本自检面板：' + (panel ? '存在' : '不存在'));

        if (kind === 'tavern') {
          if (!btn) {
            flag('✗', '扩展启动了但悬浮按钮不见了。请把整份报告发出来——这一般是被主题或别的扩展隐藏/覆盖了。');
          } else if (btn.offsetWidth === 0 || btn.offsetHeight === 0) {
            flag('✗', '悬浮按钮存在但尺寸为 0（被 display:none 之类藏起来了）。');
          }
        }

        /* ---------------- 核心模块有没有挂上 ---------------- */
        L.push('');
        L.push('【核心模块】');
        ['PetUtil', 'PetPlaceholder', 'PetDom', 'PetPos', 'PetEngine', 'PetAdapter',
         'PetRegistry', 'PetSettings', 'PetEditor', 'PetDemo', 'PetDiagnose'].forEach(function (k) {
          L.push('  window.' + k + '：' + (window[k] ? '✓' : '✗ 缺失'));
        });

        /* ---------------- 桌宠包 ---------------- */
        L.push('');
        L.push('【桌宠包】');
        try {
          var R = window.PetRegistry;
          if (!R) {
            L.push('  注册表没挂上，无法列出');
          } else {
            var pkgs = R.listPackages();
            L.push('  共 ' + pkgs.length + ' 个：' + (pkgs.map(function (p) {
              return (p.source || '?') + ':' + p.id + (p.usable === false ? '(素材不可用)' : '');
            }).join(', ') || '(空)'));
            L.push('  默认包：' + (R.getDefaultId() || '(未设置)'));
            var bind = R.getBindings() || {};
            var av = Object.keys(bind);
            L.push('  已绑定角色 ' + av.length + ' 个' + (av.length ? '：' + av.join(', ') : ''));
          }
        } catch (e) {
          L.push('  读取失败：' + ((e && e.message) || e));
        }

        /* ---------------- 当前聊天 ---------------- */
        L.push('');
        L.push('【当前聊天】');
        try {
          var A = window.PetAdapter;
          if (A && A.recentAiTexts) {
            var texts = A.recentAiTexts(window, 3);
            L.push('  取到最近 ' + texts.length + ' 条 AI 消息');
            if (texts[0] && A.extractData) {
              /* 用当前角色实际会用的那个包来解析，才代表真实情况 */
              var cur = null;
              try {
                cur = window.PetRegistry ? window.PetRegistry.resolveFor(
                  window.PetEngine && window.PetEngine.currentAvatar
                    ? window.PetEngine.currentAvatar() : null) : null;
              } catch (e2) {}
              L.push('  当前生效的包：' + (cur ? cur.id : '(无)'));
              var E = cur ? A.extractData(cur, texts[0]) : null;
              L.push('  最后一条能否解析出桌宠标签：' + yes(!!E));
            } else {
              L.push('  最后一条能否解析出桌宠标签：（没有 AI 消息或适配层不完整）');
            }
            if (texts[0]) L.push('  最后一条开头 80 字：' + JSON.stringify(texts[0].slice(0, 80)));
          } else {
            L.push('  适配层没挂上');
          }
        } catch (e) {
          L.push('  读取失败：' + ((e && e.message) || e));
        }

        /* ---------------- localStorage ---------------- */
        L.push('');
        L.push('【本机存储】');
        try {
          ['shushu-pet:packages', 'shushu-pet:bindings', 'shushu-pet:defaultPkg', 'shushu-pet:state']
            .forEach(function (k) {
              var v = null;
              try { v = localStorage.getItem(k); } catch (e) {}
              L.push('  ' + k + '：' + (v == null ? '(无)' : v.length + ' 字符'));
            });
        } catch (e) {
          L.push('  读取失败：' + ((e && e.message) || e));
        }

        /* ---------------- 结论 ---------------- */
        L.push('');
        L.push('【结论】');
        if (verdicts.length) {
          verdicts.forEach(function (v) { L.push('  ' + v.lv + ' ' + v.msg); });
        } else if (kind === 'standalone') {
          L.push('  · 这只是扩展目录下的文件自检页，查不到酒馆里的运行状态。' +
                 '要看运行状态请回酒馆主界面，点「鼠鼠桌宠」→「出问题了？点这里自检」。');
        } else {
          L.push('  ✓ 没发现异常。桌宠不出现的话，多半是当前这条聊天里还没有桌宠标签。');
        }

        L.push('');
        L.push('===== 报告结束 =====');
        return L.join('\n');
      })
      .catch(function (e) {
        L.push('');
        L.push('自检本身出错了：' + ((e && e.message) || e));
        return L.join('\n');
      });
  }

  /* ---------------- 面板 ---------------- */
  function close(doc) {
    var p = doc.getElementById(PANEL_ID);
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function show(doc) {
    close(doc);
    var wrap = doc.createElement('div');
    wrap.id = PANEL_ID;
    wrap.style.cssText =
      'position:fixed;left:10px;right:10px;top:10px;bottom:10px;z-index:100000;' +
      'background:#14141a;color:#e8e8e8;border:1px solid #3a3a46;border-radius:12px;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.6);display:flex;flex-direction:column;' +
      'font:13px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:12px;';
    wrap.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">' +
        '<div style="flex:1;font-weight:700;">鼠鼠桌宠 · 自检报告</div>' +
        '<button data-act="copy" style="padding:7px 12px;border:none;border-radius:8px;' +
          'background:#2e7d32;color:#fff;font-weight:600;cursor:pointer;">复制报告</button>' +
        '<button data-act="refresh" style="padding:7px 12px;border:none;border-radius:8px;' +
          'background:#6a4a9a;color:#fff;font-weight:600;cursor:pointer;">重新检测</button>' +
        '<button data-act="close" style="padding:7px 12px;border:none;border-radius:8px;' +
          'background:#444;color:#fff;font-weight:600;cursor:pointer;">关闭</button>' +
      '</div>' +
      '<div style="color:#9a9aa8;font-size:12px;margin-bottom:8px;">' +
        '桌宠不显示 / 按钮不出来时，点「复制报告」把内容发出来即可定位问题。' +
      '</div>' +
      '<textarea id="shushu-pet-diag-text" readonly style="flex:1;width:100%;box-sizing:border-box;' +
        'background:#0d0d12;color:#c8e6c9;border:1px solid #2c2c36;border-radius:8px;padding:10px;' +
        'font:12px/1.55 Consolas,Menlo,monospace;resize:none;white-space:pre;overflow:auto;"></textarea>' +
      '<div id="shushu-pet-diag-tip" style="color:#8bc34a;font-size:12px;margin-top:8px;height:18px;"></div>';

    wrap.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'close') { close(doc); return; }
      if (act === 'refresh') { show(doc); return; }
      if (act === 'copy') copyReport(doc, wrap);
    });

    doc.body.appendChild(wrap);
    var ta = wrap.querySelector('#shushu-pet-diag-text');
    ta.value = '正在检测……（要发几个请求，稍等一下）';

    collect().then(function (text) {
      /* 面板可能已经被关掉了 */
      if (!doc.getElementById(PANEL_ID)) return;
      ta.value = text;
      copyReport(doc, wrap);
    });
  }

  /* 复制：先试剪贴板 API；酒馆多半在 https 或 localhost 下，一般能成。
     不行就退化成选中文本，让用户自己 Ctrl+C。 */
  function copyReport(doc, wrap) {
    var ta = wrap.querySelector('#shushu-pet-diag-text');
    var tip = wrap.querySelector('#shushu-pet-diag-tip');
    if (!ta) return;
    var text = ta.value || '';
    function ok(msg) { if (tip) { tip.textContent = msg; tip.style.color = '#8bc34a'; } }
    function fallback() {
      try {
        ta.removeAttribute('readonly');
        ta.focus(); ta.select();
        ta.setSelectionRange(0, ta.value.length);
        ta.setAttribute('readonly', 'readonly');
        if (tip) { tip.textContent = '已选中全文，按 Ctrl+C 复制（Mac 用 ⌘+C）'; tip.style.color = '#ffb74d'; }
      } catch (e) {}
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { ok('已复制到剪贴板 ✓'); }, fallback);
        return;
      }
    } catch (e) {}
    fallback();
  }

  window.PetDiagnose = {
    collect: collect,
    show: show,
    close: close,
    EXPECTED: EXPECTED,
    guessBase: guessBase
  };
})();
