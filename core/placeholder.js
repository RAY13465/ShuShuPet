/* ============================================================================
 * 鼠鼠桌宠 · core/placeholder.js
 * 内置占位素材（内联 SVG，data URI）。
 *
 * 为什么需要它：
 *   内置模板包如果直接指向不存在的图片路径，新装用户会看到"什么都没发生"——
 *   元素其实建出来了，只是图 404、整体透明。所以默认包必须指向一张一定能显示的图，
 *   让用户先确认"扩展在工作"，再去配自己的素材。
 * 挂在 window.PetPlaceholder
 * ========================================================================== */
(function () {
  'use strict';

  function svg(inner, w, h) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '">' + inner + '</svg>';
    /* 用 encodeURIComponent 保证任何环境都能安全当 data URI 用 */
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }

  var font = 'font-family="PingFang SC,Noto Sans SC,Microsoft YaHei,sans-serif"';

  /* 底图：一个圆角方框 + 提示文字，明确告诉用户"这里要换成你的立绘" */
  var BASE = svg(
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#3b3b46"/><stop offset="1" stop-color="#26262e"/>' +
    '</linearGradient></defs>' +
    '<rect x="4" y="4" width="392" height="392" rx="28" fill="url(#g)" ' +
      'stroke="#7a5cff" stroke-width="3" stroke-dasharray="14 10"/>' +
    '<circle cx="200" cy="168" r="58" fill="#4a4a58"/>' +
    '<circle cx="180" cy="158" r="7" fill="#8a8a9a"/>' +
    '<circle cx="220" cy="158" r="7" fill="#8a8a9a"/>' +
    '<path d="M172 192 Q200 214 228 192" stroke="#8a8a9a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
    '<text x="200" y="286" text-anchor="middle" fill="#c9c9d8" font-size="26" font-weight="bold" ' + font + '>把这里换成你的立绘</text>' +
    '<text x="200" y="322" text-anchor="middle" fill="#8a8a9a" font-size="19" ' + font + '>打开「鼠鼠桌宠」→ 可视化编辑</text>' +
    '<text x="200" y="352" text-anchor="middle" fill="#8a8a9a" font-size="19" ' + font + '>把底图 URL 换成你自己的图</text>',
    400, 400);

  /* 眼部覆盖层：画一对彩色眼睛，用来演示"图层叠加"这件事 */
  var EYES_HAPPY = svg(
    '<path d="M96 210 Q150 158 204 210" stroke="#ffd166" stroke-width="13" fill="none" stroke-linecap="round"/>' +
    '<path d="M216 210 Q270 158 324 210" stroke="#ffd166" stroke-width="13" fill="none" stroke-linecap="round"/>',
    400, 400);

  var EYES_NORMAL = svg(
    '<ellipse cx="150" cy="204" rx="30" ry="34" fill="#ffd166"/>' +
    '<ellipse cx="270" cy="204" rx="30" ry="34" fill="#ffd166"/>' +
    '<circle cx="150" cy="206" r="14" fill="#22222a"/>' +
    '<circle cx="270" cy="206" r="14" fill="#22222a"/>',
    400, 400);

  var EYES_SAD = svg(
    '<path d="M104 194 Q150 232 196 194" stroke="#7fb3ff" stroke-width="13" fill="none" stroke-linecap="round"/>' +
    '<path d="M224 194 Q270 232 316 194" stroke="#7fb3ff" stroke-width="13" fill="none" stroke-linecap="round"/>',
    400, 400);

  /* 尾巴：一条弯弯的占位尾巴，同样不引用外部素材。
     气泡默认会带一条尾巴，没有它新装的包看起来"少了点什么"。 */
  var TAIL = svg(
    '<path d="M340 300 Q250 250 180 300 Q110 350 60 300" stroke="#7a5cff" stroke-width="34" ' +
      'fill="none" stroke-linecap="round" opacity=".92"/>' +
    '<circle cx="60" cy="300" r="34" fill="#9d7cff"/>',
    400, 400);

  /* 内置模板包是静态 JSON，塞不进这么长的 data URI。
     所以 JSON 里写 @placeholder:base 这类标记，加载时在这里换成真图。 */
  var TOKENS = {
    '@placeholder:base': BASE,
    '@placeholder:eyesHappy': EYES_HAPPY,
    '@placeholder:eyesNormal': EYES_NORMAL,
    '@placeholder:eyesSad': EYES_SAD,
    '@placeholder:tail': TAIL
  };

  function resolveToken(v) {
    return (typeof v === 'string' && TOKENS[v]) ? TOKENS[v] : v;
  }

  /* 就地替换包里的占位标记（图层 + 气泡尾巴都处理） */
  function resolvePackage(pkg) {
    if (!pkg) return pkg;
    (pkg.layers || []).forEach(function (L) {
      if (L.asset) L.asset = resolveToken(L.asset);
      if (L.map) {
        Object.keys(L.map).forEach(function (k) { L.map[k] = resolveToken(L.map[k]); });
      }
    });
    var tails = (pkg.render && pkg.render.tails) ||
                (pkg.render && pkg.render.bubble && pkg.render.bubble.tails);
    if (Array.isArray(tails)) {
      tails.forEach(function (t) { if (t && t.image) t.image = resolveToken(t.image); });
    }
    if (pkg.render && pkg.render.tailImage) {
      pkg.render.tailImage = resolveToken(pkg.render.tailImage);
    }
    return pkg;
  }

  /* 这个包有没有可用的素材（用来判断"值不值得显示出来"） */
  function hasUsableAsset(pkg) {
    var defs = (pkg && pkg.layers) || [];
    for (var i = 0; i < defs.length; i++) {
      var L = defs[i];
      if (L.type === 'base' && L.asset) return true;
      if (L.map) {
        var keys = Object.keys(L.map);
        for (var j = 0; j < keys.length; j++) {
          if (L.map[keys[j]]) return true;
        }
      }
    }
    return false;
  }

  window.PetPlaceholder = {
    resolvePackage: resolvePackage,
    resolveToken: resolveToken,
    hasUsableAsset: hasUsableAsset,
    TOKENS: TOKENS,
    BASE: BASE,
    EYES_HAPPY: EYES_HAPPY,
    EYES_NORMAL: EYES_NORMAL,
    EYES_SAD: EYES_SAD,
    TAIL: TAIL,
    svg: svg
  };
})();
