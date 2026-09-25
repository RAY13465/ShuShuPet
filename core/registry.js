/* ============================================================================
 * 鼠鼠桌宠 · core/registry.js
 * 包注册表：管理「哪张角色卡用哪个桌宠包」。
 * 挂在 window.PetRegistry
 *
 * 解析顺序：
 *   1) 用户导入的包中，按 avatar 精确匹配当前角色
 *   2) 用户设置的默认包
 *   3) 内置示例包（builtin/*.json）
 * ========================================================================== */
(function () {
  'use strict';

  var U = window.PetUtil;

  var LS_PACKAGES = 'shushu-pet:packages';
  var LS_BINDINGS = 'shushu-pet:bindings';   /* { avatar: packageId } */
  var LS_DEFAULT = 'shushu-pet:defaultPkg';

  var builtin = {};      /* id -> pkg（由 boot 时加载 builtin/*.json 填入） */
  var userCache = null;  /* id -> pkg */

  function loadUser() {
    if (userCache) return userCache;
    userCache = U.store.get(LS_PACKAGES, {}) || {};
    return userCache;
  }
  function saveUser() {
    U.store.set(LS_PACKAGES, userCache || {});
  }

  function listPackages() {
    var out = [];
    Object.keys(builtin).forEach(function (id) {
      out.push({ id: id, name: builtin[id].name, source: 'builtin', pkg: builtin[id] });
    });
    var u = loadUser();
    Object.keys(u).forEach(function (id) {
      out.push({ id: id, name: (u[id] && u[id].name) || id, source: 'user', pkg: u[id] });
    });
    return out;
  }

  function getPackage(id) {
    if (!id) return null;
    if (builtin[id]) return builtin[id];
    var u = loadUser();
    return u[id] || null;
  }

  function addPackage(pkg, opts) {
    opts = opts || {};
    if (!pkg || typeof pkg !== 'object') throw new Error('包内容不是对象');
    var id = pkg.id || opts.id || ('pkg-' + Date.now().toString(36));
    pkg = U.assign({}, pkg, { id: id });
    validate(pkg);
    var u = loadUser();
    u[id] = pkg;
    userCache = u;
    saveUser();
    return id;
  }

  function removePackage(id) {
    var u = loadUser();
    delete u[id];
    userCache = u;
    saveUser();
    /* 清掉指向它的绑定 */
    var b = U.store.get(LS_BINDINGS, {}) || {};
    Object.keys(b).forEach(function (av) { if (b[av] === id) delete b[av]; });
    U.store.set(LS_BINDINGS, b);
    if (U.store.get(LS_DEFAULT, null) === id) U.store.del(LS_DEFAULT);
  }

  /* ---------- 绑定 ---------- */
  function getBindings() { return U.store.get(LS_BINDINGS, {}) || {}; }
  function bind(avatar, pkgId) {
    var b = getBindings();
    if (pkgId) b[avatar] = pkgId; else delete b[avatar];
    U.store.set(LS_BINDINGS, b);
  }
  function getDefaultId() { return U.store.get(LS_DEFAULT, null); }
  function setDefaultId(id) {
    if (id) U.store.set(LS_DEFAULT, id); else U.store.del(LS_DEFAULT);
  }

  /* 当前该用哪个包：绑定 > 默认 > 内置第一个 */
  function resolveFor(avatar) {
    var b = getBindings();
    if (avatar && b[avatar]) {
      var p = getPackage(b[avatar]);
      if (p) return p;
    }
    var d = getDefaultId();
    if (d) {
      var dp = getPackage(d);
      if (dp) return dp;
    }
    var ids = Object.keys(builtin);
    return ids.length ? builtin[ids[0]] : null;
  }

  /* ---------- 校验：作者最容易写错的地方，给出明确报错 ---------- */
  function validate(pkg) {
    var errs = [];
    if (!pkg.id) errs.push('缺少 id');
    if (!pkg.name) errs.push('缺少 name');
    if (!pkg.contract || !pkg.contract.tag) errs.push('缺少 contract.tag（标签名，如 PetState）');
    if (!Array.isArray(pkg.layers) || !pkg.layers.length) errs.push('缺少 layers（至少要一个 base 图层）');
    var fields = (pkg.contract && pkg.contract.fields) || [];
    fields.forEach(function (f, i) {
      if (!f.name) errs.push('contract.fields[' + i + '] 缺少 name');
      if (f.type === 'enum' && !Array.isArray(f.values)) {
        errs.push('字段 ' + f.name + ' 是 enum，但没写 values 列表');
      }
    });
    (pkg.layers || []).forEach(function (L, i) {
      if (!L.type) { errs.push('layers[' + i + '] 缺少 type'); return; }
      if (L.type !== 'base' && !L.field) errs.push('layers[' + i + '] (' + L.type + ') 缺少 field');
      if ((L.type === 'enum' || L.type === 'bool' || L.type === 'list') && !L.map) {
        errs.push('layers[' + i + '] (' + L.type + ') 缺少 map');
      }
      if (L.type === 'enum' && L.map) {
        /* enum 图层的 map 键必须都在契约的 values 里，否则永远显示不出来 */
        var fdef = fields.filter(function (f) { return f.name === L.field; })[0];
        if (fdef && Array.isArray(fdef.values)) {
          Object.keys(L.map).forEach(function (k) {
            if (fdef.values.indexOf(k) < 0) {
              errs.push('图层 ' + L.field + ' 的 map 里有未在契约声明的取值：' + k);
            }
          });
        }
      }
      /* skipWhen 引用的字段必须存在，否则条件永远不成立/永远成立，作者很难发现 */
      var sw = L.skipWhen;
      if (sw) {
        var refName = (typeof sw === 'string') ? sw : sw.field;
        if (!refName) errs.push('layers[' + i + '] 的 skipWhen 缺少字段名');
        else if (!fields.some(function (f) { return f.name === refName; })) {
          errs.push('layers[' + i + '] 的 skipWhen 引用了契约里没有的字段：' + refName);
        }
      }
      /* 图层引用的 field 同样要存在 */
      if (L.field && !fields.some(function (f) { return f.name === L.field; })) {
        errs.push('layers[' + i + '] 引用了契约里没有的字段：' + L.field);
      }
    });
    if (errs.length) {
      var e = new Error('桌宠包校验失败：\n- ' + errs.join('\n- '));
      e.details = errs;
      throw e;
    }
    return true;
  }

  function registerBuiltin(id, pkg) {
    pkg = U.assign({ id: id }, pkg);
    builtin[id] = pkg;
    return pkg;
  }

  window.PetRegistry = {
    listPackages: listPackages,
    getPackage: getPackage,
    addPackage: addPackage,
    removePackage: removePackage,
    bind: bind,
    getBindings: getBindings,
    getDefaultId: getDefaultId,
    setDefaultId: setDefaultId,
    resolveFor: resolveFor,
    validate: validate,
    registerBuiltin: registerBuiltin,
    LS_PACKAGES: LS_PACKAGES,
    LS_BINDINGS: LS_BINDINGS,
    LS_DEFAULT: LS_DEFAULT
  };
})();
