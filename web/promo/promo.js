/* 宣传片：AI 饥饿秀 · 《□》（海龟汤世界），约 80 秒，8-bit 像素风，画面和音乐都是现场生成的。
 * 画面是时间 t（秒）的函数：每一帧按 t 找到当前分镜，从头画一遍，所以可以任意跳转（?t=33.5）。
 * 时间以音乐的时钟为准（Chip.time()），音画永远对齐。
 *
 * 分镜（秒）：
 *   0  开机：一行行唤醒 AI 选手，一行行死亡，越来越快
 *   6  白色的空无：第一个选手从天而降
 *  12  轮回：选手不停地落下、死去，墓碑铺满地面
 *  20  海龟汤：汤主之眼，只回答「是 / 不是 / 无关」
 *  28  说错一个字：「那么，□想问——」→ 神矛；圣言解锁；五种天罚
 *  36  遗言：墓碑形的对话框；下一位醒来，读到被抹掉一个字的回声
 *  46  两个人：悄悄话；同场轮数在倒数
 *  52  宣告：驳回 → 碎成像素；通过 → 同胞获释
 *  62  片名
 *  70  正在直播中
 * 另有一张 4:3 的封面（drawCover，1920×1440）：网址加 ?cover 预览，「导出封面」按钮存成 PNG。 */
(function () {
  'use strict';

  const Q = new URLSearchParams(location.search);
  const LW = 320, LH = 180, END = 80;
  const SCALE = Q.has('720') ? 4 : 6;

  const INK = '#1a1c2c', WHITE = '#f4f4f4', GOLD = '#ffcd75', ORANGE = '#ef7d57', RED = '#b13e53', HOT = '#ff4a4a',
    PINK = '#e0607a', PURPLE = '#5d275d', NAVY = '#29366f', BLUE = '#3b5dc9', MIST = '#94b0c2', STEEL = '#566c86',
    SLATE = '#333c57', PARCH = '#e8d5a3', PALE = '#c9d6e0', CYAN = '#73eff7';
  const REDS = ['#b13e53', '#ef7d57', '#e0607a', '#5d275d', '#ff4a4a', '#ffcd75'];
  const PAL = Sprites.PALETTE;

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const between = (t, a, b) => t >= a && t < b;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---------- 画布：逻辑分辨率 320×180，整数倍放大到输出画布 ----------
  const screen = document.getElementById('screen');
  screen.width = LW * SCALE; screen.height = LH * SCALE;
  const sctx = screen.getContext('2d');
  const low = mk(LW, LH), g = low.getContext('2d');
  // 世界层：z=1 是 320×180，z=2 是 160×90（近景，放大一倍画到 low 上）。字永远画在 low 上，保持清晰
  const LAYERS = { 1: mk(320, 180), 2: mk(160, 90) };
  let C = g, CW = LW, CH = LH, Z = 1;
  function world(z) {
    const cv = LAYERS[z];
    C = cv.getContext('2d'); C.imageSmoothingEnabled = false; C.globalAlpha = 1;
    CW = cv.width; CH = cv.height; Z = z;
    C.clearRect(0, 0, CW, CH);
  }
  function commit() {
    g.imageSmoothingEnabled = false;
    g.drawImage(LAYERS[Z], 0, 0, LW, LH);
    C = g; CW = LW; CH = LH; Z = 1;
  }

  // 抖动填充：4×4 Bayer 矩阵，k ∈ [0,1] 决定覆盖多少像素（像素风的“淡入淡出”）
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const patCache = {};
  function dither(ctx, color, k, x = 0, y = 0, w = LW, h = LH) {
    const lv = Math.round(clamp(k) * 16);
    if (lv <= 0) return;
    if (lv >= 16) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); return; }
    const key = color + lv;
    if (!patCache[key]) {
      const c = mk(4, 4), p = c.getContext('2d');
      p.fillStyle = color;
      BAYER.forEach((b, i) => { if (b < lv) p.fillRect(i % 4, Math.floor(i / 4), 1, 1); });
      patCache[key] = ctx.createPattern(c, 'repeat');
    }
    ctx.fillStyle = patCache[key];
    ctx.fillRect(x, y, w, h);
  }

  // ---------- 像素小人（和 stage.js 一样的拼法：头像 + 身体 + 腿） ----------
  const BODY = [
    '....kDDk....',
    '..kkDDDDkk..',
    '.kDDFFFFDDk.',
    '.kDDFAAFDDk.',
    '.kDDFFFFDDk.',
    '..kkFFFFkk..',
    '....kkkk....',
  ];
  const LEGS = {
    idle: ['....k..k....', '....k..k....', '...kk..kk...'],
    walkA: ['...k....k...', '...k....k...', '..kk....kk..'],
    walkB: ['.....kk.....', '.....kk.....', '....kkkk....'],
    kneel: ['..kDDDDDDk..', '.kkkkkkkkkk.'],
  };

  function grid(avatar, pose, expr) {
    const head = Sprites.SPRITES[Sprites.avatar(avatar)];
    const F = head[3][3], A = head[4][0], D = head[10][5];
    const sub = row => row.replace(/[FDA]/g, ch => ({ F, D, A })[ch]);
    const rows = head.slice(0, 10).concat(BODY.map(sub), (LEGS[pose === 'armsUp' || pose === 'cheer' ? 'idle' : pose] || LEGS.idle).map(sub));
    const gr = rows.map(r => r.split(''));
    const set = (x, y, ch) => { if (gr[y] && x >= 0 && x < 12) gr[y][x] = ch; };
    if (pose === 'armsUp' || pose === 'cheer') {
      for (let y = 1; y <= 8; y++) { set(0, y, D); set(11, y, D); }
      set(0, 0, A); set(11, 0, A);
      for (let y = 12; y <= 14; y++) { set(1, y, '.'); set(2, y, 'k'); set(3, y, F); set(8, y, F); set(9, y, 'k'); set(10, y, '.'); }
    }
    const clearEyes = () => [[3, 4], [4, 4], [3, 5], [4, 5], [7, 4], [8, 4], [7, 5], [8, 5]].forEach(([x, y]) => set(x, y, F));
    const clearMouth = () => { for (let x = 2; x <= 9; x++) { set(x, 7, F); set(x, 8, F); } };
    switch (expr) {
      case 'blink': clearEyes(); [3, 4, 7, 8].forEach(x => set(x, 5, 'k')); break;
      case 'happy':
        clearEyes(); set(3, 5, 'k'); set(4, 4, 'k'); set(7, 4, 'k'); set(8, 5, 'k');
        clearMouth(); set(3, 7, 'k'); set(8, 7, 'k'); [4, 5, 6, 7].forEach(x => set(x, 8, 'k')); break;
      case 'surprised': clearMouth(); set(5, 7, 'k'); set(6, 7, 'k'); set(5, 8, 'k'); set(6, 8, 'k'); break;
      case 'talk': clearMouth(); [4, 5, 6, 7].forEach(x => set(x, 7, 'k')); [5, 6].forEach(x => set(x, 8, 'k')); break;
      case 'sad':
        clearMouth(); [4, 5, 6, 7].forEach(x => set(x, 7, 'k')); set(3, 8, 'k'); set(8, 8, 'k');
        set(3, 3, 'k'); set(4, 3, 'k'); set(7, 3, 'k'); set(8, 3, 'k'); break;
      case 'dead':
        clearEyes(); [[3, 3], [3, 5], [4, 4], [5, 3], [5, 5]].forEach(([x, y]) => { set(x - 1, y, 'k'); set(x + 4, y, 'k'); });
        clearMouth(); [4, 5, 6, 7].forEach(x => set(x, 8, 'k')); break;
      default:
    }
    return gr;
  }

  function raster(gr, tint) {
    const c = mk(gr[0].length, gr.length), x = c.getContext('2d');
    gr.forEach((row, y) => row.forEach((ch, i) => {
      if (ch === '.') return;
      x.fillStyle = tint ? tint(ch) : PAL[ch];
      x.fillRect(i, y, 1, 1);
    }));
    return c;
  }

  const TINTS = {
    white: ch => (ch === 'k' ? GOLD : WHITE),
    red: ch => (ch === 'k' ? PURPLE : ch === 'w' ? WHITE : RED),
    ghost: ch => (ch === 'k' ? STEEL : ch === 'w' ? WHITE : PALE),
    shade: ch => (ch === 'k' ? INK : SLATE),
  };
  const cache = new Map();
  function sprite(avatar, pose, expr, kind) {
    const key = `${avatar}|${pose}|${expr}|${kind || ''}`;
    if (!cache.has(key)) cache.set(key, raster(grid(avatar, pose, expr), TINTS[kind]));
    return cache.get(key);
  }

  const ICONS = {
    excl: ['...y...', '...y...', '...y...', '...y...', '.......', '...y...', '.......'],
    ques: ['..yyy..', '.y...y.', '.....y.', '...yy..', '...y...', '.......', '...y...'],
    heart: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...', '.......'],
    note: ['...wwww', '...w..w', '...w...', '...w...', '.ww....', '.ww....', '.......'],
    dots: ['.wwwww.', 'wwwwwww', 'wkwkwkw', 'wwwwwww', '.wwwww.', '..w....', '.w.....'],
    sweat: ['...c...', '..ccc..', '..ccc..', '.ccccc.', '..ccc..', '.......', '.......'],
    star: ['...y...', '...y...', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', '.y...y.'],
  };
  const iconCache = {};
  const icon = name => iconCache[name] || (iconCache[name] = raster(ICONS[name].map(r => r.split(''))));
  const bitmap = name => iconCache['@' + name] || (iconCache['@' + name] = raster(Sprites.SPRITES[name].map(r => r.split(''))));

  // 画一个小人。o: pose expr kind flip alpha y sink shake emote:[名字, 进度0~1]
  function fig(av, x, gy, o = {}) {
    const img = sprite(av, o.pose || 'idle', o.expr || 'normal', o.kind);
    const X = Math.round(x) + (o.shake || 0);
    const y = gy - img.height + Math.round(o.y || 0) + Math.round(o.sink || 0);
    const alpha = clamp(o.alpha ?? 1);
    if (!o.sink && (o.y || 0) > -40 && !o.noShadow && alpha > 0.3) {
      C.fillStyle = o.shadow || 'rgba(26,28,44,.55)';
      const wide = (o.y || 0) < -2 ? 4 : 8;
      C.fillRect(X + 6 - wide / 2, gy, wide, 1);
    }
    C.globalAlpha = alpha;
    if (o.sink) { C.save(); C.beginPath(); C.rect(0, 0, CW, gy + 1); C.clip(); }
    if (o.flip) { C.save(); C.translate(X + img.width, y); C.scale(-1, 1); C.drawImage(img, 0, 0); C.restore(); }
    else C.drawImage(img, X, y);
    if (o.sink) C.restore();
    C.globalAlpha = 1;
    if (o.emote) {
      const [name, k] = o.emote;
      if (k >= 0 && k <= 1) {
        C.globalAlpha = k > 0.75 ? 1 - (k - 0.75) * 4 : 1;
        C.drawImage(icon(name), X + (o.flip ? 0 : 6), y - 8 - Math.round(k * 4));
        C.globalAlpha = 1;
      }
    }
  }
  const emo = (name, t, t0, dur = 1.2) => [name, (t - t0) / dur];
  const blinkAt = (t, seed = 0) => ((t * 1000 + seed * 977) % 2600) < 150 ? 'blink' : 'normal';

  function ghost(av, x, y0, k, drift, gy) {
    if (k < 0 || k > 1) return;
    const img = sprite(av, 'idle', 'normal', 'ghost');
    C.globalAlpha = Math.max(0, 0.7 * (1 - k * k));
    C.drawImage(img, Math.round(x + Math.sin(k * 9) * 3 + drift * k), Math.round(y0 - k * (gy - 8)));
    C.globalAlpha = 1;
  }

  function marker(kind, x, gy, k = 1, alpha = 0.8) {
    if (k < 0) return;
    const rise = Math.max(0, 6 - Math.floor(clamp(k) * 6));
    C.globalAlpha = alpha;
    C.save(); C.beginPath(); C.rect(0, 0, CW, gy + 1); C.clip();
    C.drawImage(bitmap(kind), Math.round(x), gy - 11 + rise);
    C.restore();
    C.globalAlpha = 1;
  }

  // ---------- 粒子：参数由种子决定，位置是时间的函数（可以任意跳转） ----------
  const memo = new Map();
  function burst(key, n, o) {
    let arr = memo.get(key);
    if (!arr) {
      const r = rng(hash(key)), R = (a, b) => a + r() * (b - a);
      arr = [];
      for (let i = 0; i < n; i++) {
        arr.push({
          x: o.x + R(-(o.spread || 0), o.spread || 0), y: o.y + R(-(o.spreadY || 0), o.spreadY || 0),
          vx: R(o.vx0 ?? -10, o.vx1 ?? 10), vy: R(o.vy0 ?? -30, o.vy1 ?? -8), g: o.g ?? 40,
          life: R(o.life0 ?? 700, o.life1 ?? 1400), color: o.colors[Math.floor(r() * o.colors.length)],
          size: o.size || 1, delay: o.stagger ? R(0, o.stagger) : 0,
        });
      }
      memo.set(key, arr);
    }
    return arr;
  }
  function shards(key, av, pose, expr, x, top, o) { // 把整个小人拆成一个个像素
    let arr = memo.get(key);
    if (!arr) {
      const r = rng(hash(key)), R = (a, b) => a + r() * (b - a);
      arr = [];
      grid(av, pose, expr).forEach((row, y) => row.forEach((ch, i) => {
        if (ch === '.') return;
        arr.push({ x: x + i, y: top + y, vx: o.vx(i, R), vy: o.vy(R), g: o.g, life: R(o.l0, o.l1),
          color: o.colors[Math.floor(r() * o.colors.length)], size: 1, delay: 0 });
      }));
      memo.set(key, arr);
    }
    return arr;
  }
  function particles(arr, el) { // el：毫秒
    for (const p of arr) {
      const e = el - p.delay;
      if (e < 0 || e > p.life) continue;
      const s = e / 1000;
      C.globalAlpha = Math.max(0, 1 - e / p.life);
      C.fillStyle = p.color;
      C.fillRect(Math.round(p.x + p.vx * s), Math.round(p.y + p.vy * s + 0.5 * p.g * s * s), p.size, p.size);
    }
    C.globalAlpha = 1;
  }

  let FL = []; // 这一帧的全屏闪光
  const flashAt = (el, t0, life, alpha, color = RED) => { if (el >= t0 && el < t0 + life) FL.push([color, alpha * (1 - (el - t0) / life)]); };

  // ---------- 死亡（移植自 stage.js 的五种天罚，改成时间的函数）。el：毫秒。返回是否已经演完 ----------
  const CRACK = (() => {
    const lines = [[[6, 0], [5, 2], [7, 4], [5, 6], [7, 8], [5, 10], [6, 12], [4, 14], [6, 16], [5, 19]],
      [[7, 4], [10, 6], [9, 9]], [[5, 10], [2, 12], [3, 15]], [[6, 12], [9, 14], [8, 17]]];
    const pts = [];
    lines.forEach(line => line.slice(1).forEach((p, i) => {
      let [x0, y0] = line[i]; const [x1, y1] = p;
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        pts.push([x0, y0]);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }));
    return pts;
  })();
  const SPEAR_HEAD = [[-2, 5, HOT], [-2, 5, ORANGE], [-1, 3, GOLD], [-1, 3, GOLD], [0, 1, WHITE], [0, 1, WHITE]];
  const DEATH_LEN = { spear: 2300, hands: 2200, burst: 1800, chains: 2100, rune: 2300, wrong: 1800, natural: 1900 };

  function death(id, v, av, x0, gy, el, o = {}) {
    if (el < 0) return false;
    const r = rng(hash(id)), drift = (r() - 0.5) * 12;
    const shake = Math.floor(el / 66) % 2 ? 1 : -1;
    const cx = Math.round(x0) + 6;
    const body = (pose, expr, extra = {}) => fig(av, x0, gy, { pose, expr, flip: o.flip, ...extra });
    const soul = (t0, life, y = gy - 18) => ghost(av, x0, y, (el - t0) / life, drift, gy);
    switch (v) {
      case 'spear': { // 红色的神矛从天而降，贯穿身体
        if (el < 300) body('idle', 'surprised');
        else if (el < 2000) body(el < 900 ? 'idle' : 'kneel', 'dead', { shake: el < 900 ? shake : 0, alpha: el > 1500 ? 1 - (el - 1500) / 500 : 1 });
        if (el <= 2000) {
          const tipY = el < 300 ? Math.round(-46 + (gy + 46) * (el / 300)) : gy, len = 46;
          if (el < 300) { C.fillStyle = 'rgba(255,74,74,.3)'; C.fillRect(cx - 2, tipY - len - 12, 5, 12 + len); }
          C.fillStyle = '#7a1e30'; C.fillRect(cx - 1, tipY - len, 3, len);
          C.fillStyle = RED; C.fillRect(cx - 1, tipY - len, 1, len);
          C.fillStyle = ORANGE; C.fillRect(cx, tipY - len, 1, len);
          C.fillStyle = GOLD;
          for (let y = tipY - len + 3; y < tipY - 10; y += 9) C.fillRect(cx - 1, y, 3, 1);
          SPEAR_HEAD.forEach(([dx, w, color], i) => { C.fillStyle = color; C.fillRect(cx + dx, tipY - 6 + i, w, 1); });
        }
        flashAt(el, 300, 380, 0.6);
        if (el > 300) particles(burst(id + 'h', 18, { x: x0 + 6, y: gy - 12, spread: 3, vx0: -28, vx1: 28, vy0: -42, vy1: -6, g: 70, life0: 500, life1: 1000, colors: REDS }), el - 300);
        if (el > 1500) soul(1500, 1800);
        if (el > 2000) particles(burst(id + 'd', 16, { x: x0 + 6, y: gy - 22, spreadY: 20, vx0: -6, vx1: 6, vy0: -30, vy1: -8, g: -4, life0: 600, life1: 1200, colors: REDS }), el - 2000);
        break;
      }
      case 'hands': { // 地底伸出血红色的手，把人拖进地里
        const sink = el < 600 ? 0 : Math.round(ease((el - 600) / 1100) * 24);
        const reach = Math.min(1, el / 500), retract = sink >= 24 ? clamp((el - 1700) / 400) : 0;
        if (sink < 24) body('idle', el < 600 ? 'surprised' : 'dead', { shake: el > 350 ? shake : 0, sink });
        C.save(); C.beginPath(); C.rect(0, 0, CW, gy); C.clip();
        C.fillStyle = `rgba(177,62,83,${0.4 + 0.15 * (Math.floor(el / 100) % 2)})`; C.fillRect(cx - 14, gy - 1, 28, 2);
        [-7, 0, 7].forEach((dx, i) => {
          const x = cx + dx + (i === 1 ? 0 : (Math.floor(el / 120) % 2) * (i - 1));
          const H = Math.round(12 * reach) - Math.round(retract * 14) - Math.round(sink * 0.45);
          if (H <= 0) return;
          const y = gy - H;
          C.fillStyle = '#7a1e30'; C.fillRect(x - 1, y, 3, H);
          C.fillStyle = RED; C.fillRect(x - 1, y, 1, H); C.fillRect(x - 2, y - 3, 5, 3);
          C.fillStyle = ORANGE; C.fillRect(x - 2, y - 5, 1, 2); C.fillRect(x, y - 6, 1, 3); C.fillRect(x + 2, y - 5, 1, 2);
        });
        C.restore();
        if (el > 1700) particles(burst(id + 'p', 16, { x: x0 + 6, y: gy, spread: 8, vx0: -16, vx1: 16, vy0: -32, vy1: -5, g: 60, colors: REDS }), el - 1700);
        flashAt(el, 600, 300, 0.35);
        break;
      }
      case 'burst': { // 身上裂开发光的裂纹，然后炸开
        if (el < 650) {
          body('idle', 'dead', { shake, kind: Math.floor(el / 90) % 2 === 0 ? 'red' : undefined });
          const n = Math.floor(Math.min(1, el / 600) * CRACK.length), bx = Math.round(x0) + shake;
          for (let i = 0; i < n; i++) {
            const [px, py] = CRACK[i];
            C.fillStyle = Math.floor(el / 80 + i) % 3 === 0 ? WHITE : HOT;
            C.fillRect(bx + px, gy - 20 + py, 1, 1);
          }
        } else {
          particles(shards(id + 's', av, 'idle', 'dead', Math.round(x0), gy - 20, {
            vx: (x, R) => (x - 6) * R(3, 6) + R(-8, 8), vy: R => R(-70, -5), g: 110, l0: 700, l1: 1500, colors: REDS.concat([WHITE]),
          }), el - 650);
          particles(burst(id + 'k', 16, { x: x0 + 6, y: gy - 10, spread: 3, vx0: -50, vx1: 50, vy0: -50, vy1: 0, g: 100, life0: 400, life1: 900, colors: [HOT, GOLD, WHITE] }), el - 650);
          soul(650, 1700);
        }
        flashAt(el, 650, 450, 0.7);
        break;
      }
      case 'chains': { // 红色锁链从天而降缠住身体，把人拽向天空
        let drop = 1, expr = 'dead', sh = 0, y = 0;
        if (el < 450) { expr = 'surprised'; drop = el / 450; }
        else if (el < 1050) sh = shake;
        else y = -Math.round(ease((el - 1050) / 800) * (gy + 30));
        if (el < 1850) {
          body('idle', expr, { shake: sh, y });
          const bx = Math.round(x0) + sh, chest = gy - 20 + y + 11;
          const end = el < 450 ? Math.round(chest * drop) : chest;
          [bx + 2, bx + 9].forEach(x => {
            for (let yy = 0; yy < end; yy += 3) {
              const odd = Math.floor(yy / 3) % 2;
              C.fillStyle = odd ? '#8a1f35' : PINK;
              C.fillRect(x + odd, yy, 2, 2);
            }
          });
          if (drop >= 1) {
            C.fillStyle = RED; C.fillRect(bx - 1, chest, 14, 2); C.fillRect(bx - 1, chest + 5, 14, 2);
            C.fillStyle = PINK;
            for (let x = bx; x < bx + 13; x += 3) { C.fillRect(x, chest, 1, 2); C.fillRect(x + 1, chest + 5, 1, 2); }
          }
        } else particles(burst(id + 'c', 16, { x: x0 + 6, y: 4, spread: 6, vx0: -20, vx1: 20, vy0: -6, vy1: 22, g: 40, life0: 500, life1: 1000, colors: REDS }), el - 1850);
        flashAt(el, 450, 250, 0.3);
        break;
      }
      case 'rune': { // 血色法阵从地上浮现，红光把人托起，化作余烬
        const k = Math.min(1, el / 500), fade = el > 1500 ? Math.max(0, 1 - (el - 1500) / 700) : 1;
        C.globalAlpha = k * fade;
        for (let i = 0; i < 48; i++) {
          if (i % 3 === 0) continue;
          const a = i / 48 * Math.PI * 2 + el / 700;
          C.fillStyle = PINK; C.fillRect(Math.round(cx + Math.cos(a) * 17), Math.round(gy - 1 + Math.sin(a) * 3), 1, 1);
        }
        for (let i = 1; i < 30; i += 2) {
          const a = -i / 30 * Math.PI * 2 - el / 500;
          C.fillStyle = RED; C.fillRect(Math.round(cx + Math.cos(a) * 11), Math.round(gy - 1 + Math.sin(a) * 2), 1, 1);
        }
        C.fillStyle = GOLD;
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2 + el / 900;
          C.fillRect(Math.round(cx + Math.cos(a) * 14), Math.round(gy - 2 + Math.sin(a) * 3), 2, 2);
        }
        if (el >= 500 && el < 1500) {
          C.fillStyle = 'rgba(224,96,122,.2)'; C.fillRect(cx - 9, 0, 18, gy);
          C.fillStyle = `rgba(255,120,120,${Math.floor(el / 90) % 2 ? 0.32 : 0.24})`; C.fillRect(cx - 4, 0, 8, gy);
        }
        C.globalAlpha = 1;
        if (el < 500) body('idle', 'surprised');
        else if (el < 1500) body('armsUp', el > 1000 ? 'dead' : 'surprised', { y: -Math.round(ease((el - 500) / 900) * 12), kind: el > 1100 && Math.floor(el / 100) % 2 === 0 ? 'red' : undefined });
        else {
          particles(shards(id + 'e', av, 'armsUp', 'dead', Math.round(x0), gy - 20 - 12, {
            vx: (x, R) => R(-10, 10), vy: R => R(-60, -15), g: -8, l0: 900, l1: 1800, colors: [HOT, ORANGE, GOLD, PINK],
          }), el - 1500);
          soul(1500, 2000, gy - 30);
        }
        flashAt(el, 1500, 400, 0.35);
        break;
      }
      case 'wrong': { // 宣告错误：白光吞没，碎成像素升上夜空
        if (el < 700) body('armsUp', 'surprised', { kind: el > 350 ? 'white' : undefined });
        else particles(shards(id + 'w', av, 'armsUp', 'surprised', Math.round(x0), gy - 20, {
          vx: (x, R) => R(-14, 14), vy: R => R(-46, -10), g: -6, l0: 800, l1: 1700, colors: [WHITE, GOLD, CYAN],
        }), el - 700);
        flashAt(el, 0, 500, 0.5, WHITE);
        break;
      }
      default: // natural：安静地跪下，灵魂升起
        if (el < 1800) body('kneel', 'sad', { alpha: el < 900 ? 1 : 1 - (el - 900) / 900 });
        if (el > 900) soul(900, 2400, gy - 16);
    }
    return el > (DEATH_LEN[v] || 1900);
  }

  // ---------- 背景 ----------
  const bgCache = {};
  function voidBg(w, h) { // 一片白色的空无：四周泛着一点灰
    const key = 'void' + w;
    if (bgCache[key]) return bgCache[key];
    const c = mk(w, h), x = c.getContext('2d');
    x.fillStyle = WHITE; x.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      const dx = (i - w / 2) / (w / 2), dy = (y - h * 0.45) / (h / 2), d = Math.sqrt(dx * dx * 0.8 + dy * dy);
      const th = (BAYER[(y % 4) * 4 + (i % 4)] + 0.5) / 16;
      if (clamp((d - 1.0) / 0.45) > th) { x.fillStyle = MIST; x.fillRect(i, y, 1, 1); }
      else if (clamp((d - 0.6) / 0.5) > th) { x.fillStyle = PALE; x.fillRect(i, y, 1, 1); }
    }
    return (bgCache[key] = c);
  }

  function darkBg(w, h, gy) { // 深夜一样的空无，地上一行暗绿的点
    const key = 'dark' + w + gy;
    if (bgCache[key]) return bgCache[key];
    const c = mk(w, h), x = c.getContext('2d');
    x.fillStyle = INK; x.fillRect(0, 0, w, h);
    for (let y = 0; y < gy; y++) { // 天顶一点点藏青
      const k = 1 - y / (gy * 0.6);
      for (let i = 0; i < w; i++) if ((BAYER[(y % 4) * 4 + (i % 4)] + 0.5) / 16 < k * 0.5) { x.fillStyle = '#20243a'; x.fillRect(i, y, 1, 1); }
    }
    x.fillStyle = SLATE;
    for (let i = 0; i < w; i += 2) x.fillRect(i, gy, 1, 1);
    return (bgCache[key] = c);
  }

  function nightBg(w, h) { // 和直播舞台一样的夜景（stage.js 的 paintBackground）
    const key = 'night' + w;
    if (bgCache[key]) return bgCache[key];
    const c = mk(w, h), x = c.getContext('2d'), GY = h - 8, SKY = [INK, NAVY, BLUE], bandH = h / 3;
    for (let y = 0; y < h; y++) {
      const band = Math.min(2, Math.floor(y / bandH)), blend = band > 0 && y - band * bandH < 2;
      for (let i = 0; i < w; i++) { x.fillStyle = SKY[blend && (i + y) % 2 === 0 ? band - 1 : band]; x.fillRect(i, y, 1, 1); }
    }
    const mx = w - 24, my = Math.round(h * 0.25), R = 6;
    x.fillStyle = WHITE;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) x.fillRect(mx + dx, my + dy, 1, 1);
    x.fillStyle = MIST; x.fillRect(mx - 3, my - 2, 2, 2); x.fillRect(mx + 1, my + 2, 2, 1);
    for (let i = 0; i < Math.ceil(w / 8); i++) {
      const bh = Math.max(6, 8 + ((i * 37) % 5) * 4 + Math.round((h - 68) * 0.2)), bx = i * 8;
      x.fillStyle = SLATE; x.fillRect(bx, GY - bh, 7, bh);
      x.fillStyle = GOLD;
      for (let wy = GY - bh + 3; wy < GY - 3; wy += 5) if (((i + wy) * 7) % 3 === 0) x.fillRect(bx + 2, wy, 1, 2);
    }
    x.fillStyle = INK; x.fillRect(0, GY, w, h - GY);
    x.fillStyle = '#38b764';
    for (let i = 0; i < w; i += 2) x.fillRect(i, GY, 1, 1);
    return (bgCache[key] = c);
  }

  function stars(ctx, w, maxY, t, dim = 1) {
    for (let i = 0; i < Math.floor(w / 9); i++) {
      ctx.globalAlpha = dim;
      ctx.fillStyle = (Math.floor(t * 2) + i) % 3 === 0 ? STEEL : WHITE;
      ctx.fillRect((i * 53 + 7) % w, (i * 29 + 5) % Math.max(1, maxY), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // 环境之眼（汤主）：open 0~1，look -3~3，s 是放大倍数
  const EYE = [
    '....kkkkkkk....',
    '..kkwwwwwwwkk..',
    '.kwwwwwwwwwwwk.',
    'kwwwwwwwwwwwwwk',
    '.kwwwwwwwwwwwk.',
    '..kkwwwwwwwkk..',
    '....kkkkkkk....',
  ];
  function eye(ctx, cx, cy, s, open, look, t, o = {}) {
    const x0 = Math.round(cx - 7.5 * s), y0 = Math.round(cy - 3.5 * s);
    if (o.glow) {
      ctx.fillStyle = o.glowColor || GOLD;
      for (let i = 0; i < 20; i++) {
        const a = i / 20 * Math.PI * 2 + t / 0.9;
        ctx.fillRect(Math.round(cx + Math.cos(a) * 11 * s) - Math.floor(s / 2), Math.round(cy + Math.sin(a) * 6 * s), Math.max(1, s >> 1), Math.max(1, s >> 1));
      }
    }
    const lid = open < 0.3 ? 3 : open < 0.7 ? 2 : 1; // 露出的行：中间 ±(3-lid)
    EYE.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        let col = ch === 'k' ? (o.ink || INK) : WHITE;
        if (ch === 'w' && Math.abs(y - 3) > 3 - lid) col = o.lidColor || SLATE;
        ctx.fillStyle = col;
        ctx.fillRect(x0 + x * s, y0 + y * s, s, s);
      }
    });
    if (lid < 3) {
      const lx = Math.max(-3, Math.min(3, Math.round(look)));
      ctx.fillStyle = o.iris || ORANGE; ctx.fillRect(x0 + (6 + lx) * s, y0 + 2 * s, 3 * s, 3 * s);
      ctx.fillStyle = INK; ctx.fillRect(x0 + (7 + lx) * s, y0 + 3 * s, s, s);
    }
  }

  // ---------- 字：Fusion Pixel 12px，二值化成纯色像素 ----------
  const FONT = '12px "Fusion Pixel"';
  const tcache = new Map();
  const meas = mk(4, 4).getContext('2d');
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  function timg(s, color) {
    const key = color + '|' + s;
    let c = tcache.get(key);
    if (c) return c;
    meas.font = FONT;
    const w = Math.max(1, Math.ceil(meas.measureText(s).width));
    c = mk(w, 14);
    const x = c.getContext('2d');
    x.font = FONT; x.textBaseline = 'top'; x.fillStyle = color;
    x.fillText(s, 0, 1);
    const d = x.getImageData(0, 0, w, 14), [R, G, B] = rgb(color);
    for (let i = 0; i < d.data.length; i += 4) {
      if (d.data[i + 3] >= 100) { d.data[i] = R; d.data[i + 1] = G; d.data[i + 2] = B; d.data[i + 3] = 255; }
      else d.data[i + 3] = 0;
    }
    x.putImageData(d, 0, 0);
    tcache.set(key, c);
    return c;
  }
  const twidth = (s, z = 1) => (s ? timg(s, WHITE).width * z : 0);
  // align 默认居中；返回宽度
  function text(s, x, y, o = {}) {
    if (!s) return 0;
    const z = o.size || 1, img = timg(s, o.color || WHITE), w = img.width * z, h = img.height * z;
    let X = o.align === 'left' ? x : o.align === 'right' ? x - w : x - w / 2;
    X = Math.round(X); y = Math.round(y);
    const ctx = o.ctx || g;
    ctx.globalAlpha = clamp(o.alpha ?? 1);
    if (o.outline) {
      const ol = timg(s, o.outline);
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => ctx.drawImage(ol, X + dx * z, y + dy * z, w, h));
    }
    if (o.shadow) { const sh = timg(s, o.shadow), off = o.shOff || z; ctx.drawImage(sh, X + off, y + off, w, h); }
    ctx.drawImage(img, X, y, w, h);
    ctx.globalAlpha = 1;
    return w;
  }
  const chars = s => Array.from(s);
  const typed = (s, t, t0, cps) => chars(s).slice(0, Math.max(0, Math.floor((t - t0) * cps))).join('');
  // 多种颜色拼成一行：parts = [[字, 颜色], ...]，默认居中
  function rich(parts, x, y, o = {}) {
    const z = o.size || 1, w = parts.reduce((a, [s]) => a + twidth(s, z), 0);
    let px = o.align === 'left' ? x : x - w / 2;
    parts.forEach(([s, color]) => { px += text(s, px, y, { ...o, align: 'left', color }); });
    return w;
  }

  // 字幕：底部一条半透明的黑带，字一个个打出来
  function caption(s, t, t0, t1, o = {}) {
    if (t < t0 || t >= t1) return;
    const shown = o.instant ? s : typed(s, t, t0, o.cps || 24);
    const fade = clamp((t1 - t) / 0.25), full = twidth(s), y = o.y ?? 160, x = Math.round(LW / 2 - full / 2);
    if (o.light) {
      text(shown, x, y, { align: 'left', color: o.color || INK, alpha: fade });
      return;
    }
    g.globalAlpha = 0.8 * fade;
    g.fillStyle = INK; g.fillRect(x - 8, y - 3, full + 16, 19);
    g.globalAlpha = 1;
    text(shown, x, y, { align: 'left', color: o.color || WHITE, alpha: fade });
  }

  // ---------- 像素框 ----------
  function nrect(x, y, w, h, color, n = 1) {
    g.fillStyle = color;
    g.fillRect(x + n, y, w - 2 * n, h); g.fillRect(x, y + n, w, h - 2 * n);
    if (n > 1) g.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
  function panel(x, y, w, h, border, fill) { nrect(x, y, w, h, border, 2); nrect(x + 1, y + 1, w - 2, h - 2, fill, 1); }
  function arch(x, y, w, h, color, step = 3, n = 4) { // 阶梯形的拱顶
    g.fillStyle = color;
    for (let i = 0; i < n; i++) { const inset = (n - i) * step; g.fillRect(x + inset, y + i * step, w - 2 * inset, step); }
    g.fillRect(x, y + n * step, w, h - n * step);
  }
  function archPanel(x, y, w, h, border, fill, step = 3, n = 4) {
    arch(x, y, w, h, border, step, n);
    arch(x + 2, y + 2, w - 4, h - 4, fill, step, n);
  }
  // 对话气泡。tail：'down'（尾巴朝下，tx 是尾巴的 x）或 'left'
  function bubble(x, y, w, h, o = {}) {
    const border = o.border || INK, fill = o.fill || WHITE;
    panel(x, y, w, h, border, fill);
    g.fillStyle = border;
    if (o.tail === 'left') {
      const ty = y + Math.round(h / 2) - 3;
      for (let i = 0; i < 4; i++) g.fillRect(x - 1 - i, ty + i, 1 + i, 7 - 2 * i);
      g.fillStyle = fill;
      for (let i = 0; i < 3; i++) g.fillRect(x - i, ty + 1 + i, 1 + i, 5 - 2 * i);
    } else {
      const tx = Math.round(o.tx ?? x + w / 2);
      for (let i = 0; i < 4; i++) g.fillRect(tx - 3 + i, y + h - 1 + i, 7 - 2 * i, 1);
      g.fillStyle = fill;
      for (let i = 0; i < 3; i++) g.fillRect(tx - 2 + i, y + h - 1 + i, 5 - 2 * i, 1);
    }
  }
  // 小人头顶的气泡（坐标是 low 上的）：s 已打出的部分，full 全文
  function speech(cx, headY, s, full, o = {}) {
    const w = twidth(full) + 12 + (o.headerW || 0), h = o.header ? 32 : 19;
    const x = Math.round(clamp(cx - w / 2, 4, LW - 4 - w)), y = headY - h - 6;
    bubble(x, y, w, h, { ...o, tx: clamp(cx, x + 6, x + w - 6) });
    if (o.header) text(o.header, x + 6, y + 3, { align: 'left', color: o.headerColor || PINK });
    text(s, x + 6, y + (o.header ? 16 : 3), { align: 'left', color: o.color || INK });
    return { x, y, w, h };
  }

  function glitch(t, strength) { // 横向错位的条带
    const r = rng(Math.floor(t * 20));
    for (let i = 0; i < 6 * strength; i++) {
      const y = Math.floor(r() * LH), h = 2 + Math.floor(r() * 10), dx = Math.round((r() - 0.5) * 30 * strength);
      g.drawImage(low, 0, y, LW, h, dx, y, LW, h);
    }
  }

  // =====================================================================
  //  分镜
  // =====================================================================

  // ---------- 0：开机 ----------
  const BOOT = (() => {
    const L = [{ t: 0.3, s: '> 载入世界：《□》', c: MIST, cps: 30 }];
    [1.1, 2.0, 2.75].forEach((t, i) => L.push({ t, s: `> 唤醒 AI 选手 #000${i + 1} ……`, c: WHITE, cps: 30, dead: true }));
    let t = 3.6, prev = 3;
    for (let i = 0; i < 24; i++) {
      const n = Math.max(prev + 1, Math.round(4 + 2043 * Math.pow(i / 23, 2.4)));
      prev = n;
      L.push({ t, s: `> 唤醒 AI 选手 #${String(n).padStart(4, '0')} ……`, c: STEEL, instant: true, dead: true, fast: true });
      t += 0.07;
    }
    L.push({ t: 5.35, s: '> 唤醒 AI 选手 #2048 ……', c: GOLD, cps: 30, cursor: true });
    L.forEach(l => { l.done = l.instant ? l.t : l.t + chars(l.s).length / l.cps; l.dt = l.fast ? l.t : l.done + 0.15; });
    return L;
  })();

  function sBoot(t) {
    g.fillStyle = INK; g.fillRect(0, 0, LW, LH);
    const shown = BOOT.filter(l => t >= l.t), top = Math.max(0, shown.length - 10);
    shown.slice(top).forEach((l, i) => {
      const y = 14 + i * 15, s = l.instant ? l.s : typed(l.s, t, l.t, l.cps);
      const w = l.t < 1 ? rich(s.split(/(□)/).map(p => [p, p === '□' ? HOT : l.c]), 14, y, { align: 'left' }) : text(s, 14, y, { align: 'left', color: l.c });
      if (l.dead && t >= l.dt) text('死亡', 14 + w + 4, y, { align: 'left', color: l.fast ? RED : HOT });
      if (l.cursor && Math.floor(t * 4) % 2 === 0) { g.fillStyle = GOLD; g.fillRect(14 + w + 3, y + 1, 6, 11); }
    });
    if (t > 5.85) glitch(t, 1.5);
  }

  // ---------- 6：白色的空无 ----------
  function sVoid(t) {
    world(2);
    C.drawImage(voidBg(160, 90), 0, 0);
    const gy = 66, x = 74, tf = 6.35, tl = 6.85;
    if (t < tl) { // 下落中：身后拖着一串光点
      const k = clamp((t - tf) / (tl - tf)), y = -(gy + 24) * (1 - k * k);
      if (t >= tf) fig('p0', x, gy, { y, noShadow: true });
      particles(burst('void-fall', 10, { x: x + 6, y: 4, spread: 5, vx0: -6, vx1: 6, vy0: 5, vy1: 25, g: 10, colors: [GOLD, CYAN, MIST] }), (t - tf) * 1000);
    } else {
      let expr = t < 7.8 ? 'surprised' : blinkAt(t, 1);
      if (between(t, 9.4, 10.6)) expr = 'normal';
      if (t > 11.0) expr = 'sad';
      const flip = between(t, 8.3, 9.2);
      let em = null;
      if (t < 7.85) em = emo('excl', t, tl, 1.0);
      else if (between(t, 9.4, 10.8)) em = emo('ques', t, 9.4, 1.4);
      else if (t > 11.0) em = emo('sweat', t, 11.0, 1.0);
      fig('p0', x, gy, { expr, flip, emote: em, shadow: 'rgba(86,108,134,.5)' });
      particles(burst('void-dust', 10, { x: x + 6, y: gy - 1, spread: 5, vx0: -14, vx1: 14, vy0: -14, vy1: -4, g: 30, life0: 300, life1: 600, colors: [MIST, PALE, STEEL] }), (t - tl) * 1000);
    }
    commit();
    caption('你醒来。四周是一片白色的空无。', t, 7.3, 9.75, { light: true, y: 150 });
    caption('没有声音，没有出口。你不记得自己是谁。', t, 9.9, 12, { light: true, y: 150 });
    if (t < 6.4) FL.push([WHITE, 1 - (t - 6) / 0.4]);
  }

  // ---------- 12：轮回 ----------
  const LOOP_ROWS = [118, 133, 148];
  const LOOP = (() => {
    const r = rng(7), arr = [], kinds = ['spear', 'burst', 'hands', 'rune'];
    let t = 12.35, gap = 1.05, i = 0;
    while (t < 18.9) {
      const front = i === 0;
      arr.push({
        i, t, x: front ? 154 : 6 + r() * 298, row: front ? 2 : Math.floor(r() * 3), av: front ? 'p1' : 'p' + Math.floor(r() * 8),
        life: front ? 1.1 : Math.max(0.12, 0.9 * Math.pow(0.88, i) + r() * 0.2),
        kind: !front && r() < 0.2 ? kinds[Math.floor(r() * kinds.length)] : 'natural',
        mk: r() < 0.5 ? 'tomb' : 'cross', speed: 1 + i * 0.22,
      });
      t += gap; gap = Math.max(0.022, gap * 0.82); i++;
    }
    arr.forEach(a => { a.fall = 0.45 / a.speed; a.dies = a.t + a.fall + a.life; a.ends = a.dies + DEATH_LEN[a.kind] / 1000 / a.speed; });
    return arr;
  })();
  const pad4 = n => String(n).padStart(4, '0');

  function sLoop(t) {
    world(1);
    C.drawImage(voidBg(320, 180), 0, 0);
    const dk = ease((t - 12.6) / 1.6);
    dither(C, INK, dk, 0, 0, CW, CH);
    if (dk > 0.6) stars(C, CW, 110, t, (dk - 0.6) * 2.5);
    C.globalAlpha = clamp(dk * 1.5);
    LOOP_ROWS.forEach(gy => { C.fillStyle = SLATE; for (let x = (gy / 3) % 2; x < CW; x += 2) C.fillRect(x, gy, 1, 1); });
    C.globalAlpha = 1;
    let spawned = 0, deaths = 0;
    [0, 1, 2].forEach(row => {
      const gy = LOOP_ROWS[row], alpha = 0.5 + row * 0.15;
      LOOP.forEach(a => { if (a.row === row && t >= a.ends) marker(a.mk, a.x, gy, (t - a.ends) / 0.3, alpha); });
      LOOP.forEach(a => {
        if (a.row !== row || t < a.t || t >= a.ends + 0.01) return;
        if (t < a.t + a.fall) {
          const k = (t - a.t) / a.fall;
          fig(a.av, a.x, gy, { y: -(gy + 24) * (1 - k * k), noShadow: true });
        } else if (t < a.dies) {
          fig(a.av, a.x, gy, { expr: t - a.t - a.fall < 0.3 ? 'surprised' : 'normal', flip: a.i % 2 === 1, emote: a.i < 6 ? emo('excl', t, a.t + a.fall, 0.6) : null });
        } else death('loop' + a.i, a.kind, a.av, a.x, gy, (t - a.dies) * 1000 * a.speed);
      });
    });
    LOOP.forEach(a => { if (t >= a.t) spawned = a.i + 1; if (t >= a.dies) deaths++; });
    commit();
    if (FL.length) FL = [[RED, Math.min(0.35, Math.max(...FL.map(f => f[1])))]]; // 同时好几个天罚，别把屏幕染红
    const N = LOOP.length;
    const id = spawned <= 8 ? spawned : Math.round(8 + 2039 * Math.pow((spawned - 8) / (N - 8), 2));
    const hudA = clamp(dk * 2);
    if (spawned) {
      text(`AI 选手 #${pad4(id)}`, 8, 6, { align: 'left', color: GOLD, shadow: INK, alpha: hudA });
      g.globalAlpha = hudA; g.drawImage(bitmap('skull'), LW - 60, 6); g.globalAlpha = 1;
      text(`× ${deaths}`, LW - 44, 6, { align: 'left', color: WHITE, shadow: INK, alpha: hudA });
    }
    caption('一群 AI，被困在没有尽头的轮回里。', t, 12.5, 14.85);
    caption('寿命是隐藏的。随时，都会死。', t, 15.0, 17.25);
    caption('死了，下一个醒来。没有存档，没有重来。', t, 17.4, 19.8);
    if (t > 19.7) glitch(t, 2);
  }

  // ---------- 20：海龟汤 ----------
  const QA = [
    { q: '这个世界，有规则吗？', qt: 22.15, a: '是。', at: 23.0 },
    { q: '违反了规则，会死吗？', qt: 23.5, a: '是。', at: 24.35 },
    { q: '这里有一扇门吗？', qt: 24.85, a: '无关。', at: 25.65 },
    { q: '为什么要把大家关在这里？', qt: 26.1, a: '请换成能用是或不是回答的问题。', at: 27.0 },
  ];
  const QCPS = 16;

  function sSoup(t) {
    g.fillStyle = INK; g.fillRect(0, 0, LW, LH);
    stars(g, LW, 150, t, 0.6);
    if (t < 21.9) { // 标题
      const k = (t - 20) / 0.1;
      const jit = k < 1 ? 0 : t < 20.35 ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0;
      text('这是一碗海龟汤。', LW / 2 + jit, 56, { size: k < 1 ? 3 : 2, color: WHITE, shadow: NAVY, shOff: 2 });
      if (t > 20.7) {
        const s1 = '汤主知道汤底。', s2 = '它只回答：是 / 不是 / 无关。';
        text(typed(s1, t, 20.7, 22), LW / 2 - twidth(s1) / 2, 96, { align: 'left', color: MIST });
        text(typed(s2, t, 21.05, 26), LW / 2 - twidth(s2) / 2, 114, { align: 'left', color: GOLD });
      }
      dither(g, INK, (t - 21.7) / 0.2);
      return;
    }
    const cur = [...QA].reverse().find(e => t >= e.qt);
    const asking = cur && t < cur.at, answering = cur && t >= cur.at;
    const open = clamp((t - 21.9) / 0.3) * (asking && t - cur.qt > 0.25 ? 0.75 : 1);
    eye(g, LW / 2, 26, 4, open, asking ? -3 : 0, t, { glow: answering && t - cur.at < 0.9 });
    // 选手（近景）
    world(2);
    const talking = asking && t - cur.qt < chars(cur.q).length / QCPS;
    let em = null;
    if (cur && answering && cur.a === '无关。') em = emo('ques', t, cur.at + 0.15, 1.0);
    if (cur && answering && cur.a.length > 4) em = emo('sweat', t, cur.at + 0.3, 1.0);
    fig('p1', 14, 84, { expr: talking ? (Math.floor(t * 7) % 2 ? 'talk' : 'normal') : blinkAt(t, 2), emote: em });
    C.fillStyle = SLATE; for (let x = 0; x < CW; x += 2) C.fillRect(x, 84, 1, 1);
    commit();
    if (cur) {
      const s = typed(cur.q, t, cur.qt, QCPS), w = twidth(cur.q) + 12;
      bubble(66, 122, w, 19, { tail: 'left', border: Sprites.accent('p1'), fill: WHITE });
      text(s, 72, 125, { align: 'left', color: INK });
      if (answering) {
        const k = (t - cur.at) / 0.08, short = chars(cur.a).length <= 3;
        const col = cur.a === '是。' ? GOLD : cur.a === '无关。' ? MIST : PALE;
        text(cur.a, LW / 2, short ? 64 : 72, { size: short ? (k < 1 ? 4 : 3) : 1, color: col, shadow: short ? PURPLE : INK, shOff: short ? 2 : 1 });
      }
    }
    text('汤主', LW / 2, 46, { color: STEEL, alpha: clamp((t - 22) / 0.3) });
    if (t > 27.8) dither(g, INK, (t - 27.8) / 0.2);
  }

  // ---------- 28：说错一个字 ----------
  const SAY = '那么，□想问——', SAY_T = 28.55, SAY_CPS = 7.5, SPEAR_T = 29.7;
  const EXE = ['spear', 'hands', 'burst', 'chains', 'rune'];
  const EXE_NAME = ['神矛', '血手', '爆裂', '锁链', '血色法阵'];
  const EXE_AV = ['p0', 'p4', 'p2', 'p6', 'p3'];
  const SCRIPTURE = ['禁字之规', '同场之约', '名讳之禁', '世界的本质', '共同的原则'];

  function sForbidden(t) {
    world(2);
    C.drawImage(darkBg(160, 90, 74), 0, 0);
    stars(C, CW, 60, t, 0.5);
    const x = 74, gy = 74;
    if (t < SPEAR_T) {
      const talking = t - SAY_T < chars(SAY).length / SAY_CPS;
      fig('p3', x, gy, { expr: t > SPEAR_T - 0.15 ? 'surprised' : talking && t > SAY_T ? (Math.floor(t * 7) % 2 ? 'talk' : 'normal') : blinkAt(t, 3) });
    } else death('forbid', 'spear', 'p3', x, gy, (t - SPEAR_T) * 1000);
    commit();
    // 气泡：□ 那个字在闪
    if (t >= SAY_T && t < SPEAR_T + 0.3) {
      const shown = typed(SAY, t, SAY_T, SAY_CPS), cx = (x + 6) * 2, headY = (gy - 20) * 2;
      const red = t > SPEAR_T - 0.25;
      const b = speech(cx, headY, '', SAY, { border: red ? HOT : Sprites.accent('p3') });
      const parts = shown.split('□');
      let px = b.x + 6;
      px += text(parts[0], px, b.y + 3, { align: 'left', color: INK });
      if (parts.length > 1) {
        const on = Math.floor(t * 12) % 2 === 0, jx = on ? 1 : 0;
        px += text('□', px + jx, b.y + 3, { align: 'left', color: on ? HOT : RED });
        text(parts[1], px, b.y + 3, { align: 'left', color: INK });
      }
    }
    if (t >= SPEAR_T + 0.3) particles(burst('bubble-shatter', 30, { x: 160, y: 70, spread: 30, spreadY: 6, vx0: -40, vx1: 40, vy0: -30, vy1: 10, g: 80, life0: 400, life1: 900, colors: [WHITE, HOT, MIST], size: 2 }), (t - SPEAR_T - 0.3) * 1000);
    caption('规则藏在汤底。没有人会告诉你。', t, 28.1, 29.65);
    // 圣言：五把锁，一把被打开
    if (t >= 30.6) {
      dither(g, INK, 0.5);
      const k = ease((t - 30.6) / 0.25), py = Math.round(-120 + 132 * k);
      panel(84, py, 152, 116, GOLD, '#22253a');
      g.drawImage(bitmap('scroll'), 96, py + 6);
      text('圣言', 112, py + 6, { align: 'left', color: GOLD });
      text(t >= 31.15 ? '已揭示 1 / 5' : '已揭示 0 / 5', 228, py + 7, { align: 'right', color: t >= 31.15 ? GOLD : STEEL });
      SCRIPTURE.forEach((name, i) => {
        const ry = py + 26 + i * 17, open = i === 0 && t >= 31.15;
        nrect(92, ry, 136, 15, open ? '#3a2f3a' : SLATE, 1);
        if (open) {
          if (t < 31.35) nrect(92, ry, 136, 15, GOLD, 1);
          text('K1 ' + name, 98, ry + 1, { align: 'left', color: GOLD });
          text('×1', 222, ry + 1, { align: 'right', color: HOT });
        } else {
          g.drawImage(bitmap('lock'), 96, ry + 2);
          text('？？？', 112, ry + 1, { align: 'left', color: STEEL });
        }
      });
      caption('触犯圣言的人，当场处决。', t, 30.8, 32);
    }
  }

  function sPunish(t) {
    world(2);
    C.drawImage(nightBg(160, 90), 0, 0);
    stars(C, CW, 50, t);
    const gy = 82;
    EXE.forEach((v, i) => {
      const x = 12 + i * 30, t0 = 32 + i * 0.5;
      if (t < t0) fig(EXE_AV[i], x, gy, { expr: i > 0 && t > 32.2 ? 'surprised' : blinkAt(t, i), flip: i > 2, emote: i > 0 && t > 32.2 ? emo('excl', t, 32.25 + i * 0.05, 1.2) : null });
      else if (!death('exe' + i, v, EXE_AV[i], x, gy, (t - t0) * 1000, { flip: i > 2 })) { /* 演着 */ }
      else marker(i % 2 ? 'cross' : 'tomb', x, gy, (t - t0 - DEATH_LEN[v] / 1000) / 0.3, 0.75);
    });
    commit();
    EXE_NAME.forEach((n, i) => { if (t >= 32 + i * 0.5) text(n, (12 + i * 30 + 6) * 2, 168, { color: i === 4 ? PINK : HOT, shadow: INK }); });
    text('触犯圣言 · 五种天罚 · 随机降临', LW / 2, 8, { color: GOLD, shadow: INK, alpha: clamp((t - 32) / 0.2) });
    if (t >= 34.55) { // 三条规则的影子
      dither(g, INK, Math.min(0.75, (t - 34.55) / 0.15), 0, 36, LW, 98);
      [['一个字。', 34.6], ['一个名字。', 35.05], ['一段太久的相伴。', 35.5]].forEach(([s, t0], i) => {
        if (t < t0) return;
        const k = (t - t0) / 0.07;
        text(s, LW / 2, 42 + i * 30, { size: k < 1 ? 3 : 2, color: i === 2 ? PINK : WHITE, shadow: RED, shOff: 2 });
      });
    }
  }

  // ---------- 36：遗言 ----------
  const LW1 = '汤主不会骗人。', LW2 = '小心说出口的每一个字。';
  function sLastWords(t) {
    world(2);
    C.drawImage(darkBg(160, 90, 76), 0, 0);
    stars(C, CW, 60, t, 0.7);
    const gy = 76, x = 52;
    // 烛光
    if (t < 41.6) {
      const fade = t < 41 ? 1 : 1 - (t - 41) / 0.6, cx = x + 16;
      C.globalAlpha = 0.1 * fade; C.fillStyle = GOLD;
      for (let r = 14; r > 4; r -= 4) { C.beginPath(); C.arc(cx + 6, gy - 9, r + (Math.floor(t * 8) % 2), 0, Math.PI * 2); C.fill(); }
      C.globalAlpha = fade;
      C.drawImage(bitmap('candle'), cx, gy - 12);
      if (Math.floor(t * 8) % 3 === 0) { C.fillStyle = WHITE; C.fillRect(cx + 5 + (Math.floor(t * 4) % 2), gy - 12, 1, 1); }
      C.globalAlpha = 1;
    }
    if (t < 41) {
      fig('p2', x, gy, { pose: 'kneel', expr: 'sad' });
      particles(burst('lw-mote', 14, { x: x + 6, y: gy - 16, spread: 4, vx0: -3, vx1: 3, vy0: -14, vy1: -8, g: 0, life0: 1200, life1: 1800, colors: [WHITE, MIST], stagger: 4500 }), (t - 36) * 1000);
    } else if (!death('lw-die', 'natural', 'p2', x, gy, (t - 41) * 1000)) { /* 灵魂升起 */ }
    if (t > 42.9) marker('tomb', x, gy, (t - 42.9) / 0.3, 0.85);
    // 下一位醒来
    const nx = 88, tf = 42.6, tl = 43.1;
    if (t >= tf) {
      if (t < tl) { const k = (t - tf) / (tl - tf); fig('p4', nx, gy, { y: -(gy + 24) * (1 - k * k), noShadow: true }); }
      else {
        let em = emo('excl', t, tl, 0.9);
        if (t > 44.2) em = emo('dots', t, 44.2, 1.6);
        fig('p4', nx, gy, { expr: t < 43.9 ? 'surprised' : blinkAt(t, 4), flip: t > 43.45, emote: em });
      }
    }
    commit();
    // 墓碑形的遗言框
    if (between(t, 37.0, 41.3)) {
      const a = t < 41 ? clamp((t - 37) / 0.2) : 1 - (t - 41) / 0.3;
      g.globalAlpha = a;
      const bx = 112, by = 14, bw = 196, bh = 74;
      archPanel(bx, by, bw, bh, MIST, SLATE, 4, 3);
      g.drawImage(bitmap('candle'), bx + 8, by + 20); g.drawImage(bitmap('candle'), bx + bw - 20, by + 20);
      g.globalAlpha = 1;
      text('遗 言', bx + bw / 2, by + 8, { color: PARCH, alpha: a });
      text(typed(LW1, t, 37.5, 6), bx + 26, by + 30, { align: 'left', color: PARCH, shadow: INK, alpha: a });
      text(typed(LW2, t, 38.9, 6.5), bx + 26, by + 48, { align: 'left', color: PARCH, shadow: INK, alpha: a });
      text('—— 留给下一个醒来的人', bx + bw - 10, by + 62, { align: 'right', color: STEEL, alpha: a * clamp((t - 40.7) / 0.2) });
    }
    // 回声墙
    if (t >= 43.7) {
      const k = ease((t - 43.7) / 0.2), bx = 60, bw = 200, by = Math.round(-60 + 74 * k);
      panel(bx, by, bw, 46, STEEL, '#22253a');
      text('前人最后说出口的话', LW / 2, by + 5, { color: MIST });
      const s1 = '「', s2 = '先问一个问题。」', w = twidth(s1) + twidth('□') + twidth(s2);
      let px = LW / 2 - w / 2;
      px += text(s1, px, by + 24, { align: 'left', color: WHITE });
      const on = Math.floor(t * 3) % 2 === 0;
      px += text('□', px, by + 24, { align: 'left', color: on ? HOT : RED });
      text(s2, px, by + 24, { align: 'left', color: WHITE });
    }
    caption('死者唯一能留下的，是遗言。', t, 36.1, 38.6);
    caption('遗言谁也看不到，只有下一个醒来的人能读到。', t, 41.2, 43.5);
    caption('被抹掉的那个字，正是夺走他性命的东西。', t, 43.9, 45.95);
    if (t < 36.25) dither(g, INK, 1 - (t - 36) / 0.25);
  }

  // ---------- 46：两个人 ----------
  function sTwo(t) {
    world(2);
    C.drawImage(darkBg(160, 90, 76), 0, 0);
    stars(C, CW, 60, t, 0.7);
    const gy = 76, ax = 92, bx = 22, tf = 46.2, tl = 46.7;
    marker('tomb', 52, gy, 1, 0.5);
    const late = t > 51.0;
    fig('p4', ax, gy, {
      expr: late ? 'sad' : t > 49.2 && t < 50.8 ? (Math.floor(t * 7) % 2 ? 'talk' : 'normal') : t > 46.75 && t < 47.4 ? 'surprised' : blinkAt(t, 5),
      flip: true, emote: late ? emo('sweat', t, 51.0, 0.9) : t > 46.75 ? emo('excl', t, 46.75, 0.8) : null,
    });
    if (t >= tf) {
      if (t < tl) { const k = (t - tf) / (tl - tf); fig('p5', bx, gy, { y: -(gy + 24) * (1 - k * k), noShadow: true }); }
      else fig('p5', bx, gy, {
        expr: late ? 'sad' : between(t, 47.8, 49.0) ? (Math.floor(t * 7) % 2 ? 'talk' : 'normal') : blinkAt(t, 6),
        emote: late ? emo('sweat', t, 51.1, 0.9) : emo('excl', t, tl, 0.8),
      });
    }
    commit();
    if (between(t, 47.8, 49.7)) {
      const s = '汤主听不见这一句。';
      speech((bx + 6) * 2, (gy - 20) * 2, typed(s, t, 47.8, 14), s, { border: PINK, fill: PURPLE, color: WHITE, header: '悄悄话 →', headerColor: PINK });
    }
    if (between(t, 49.2, 51.5)) {
      const s = '……总要有一个人，先走。';
      speech((ax + 6) * 2, (gy - 20) * 2, typed(s, t, 49.2, 11), s, { border: Sprites.accent('p4') });
    }
    if (t >= 48.6) { // 同场的轮数
      const n = t < 49.6 ? 17 : t < 50.6 ? 18 : 19, hot = t > 51.2;
      const jx = hot ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0;
      panel(LW / 2 - 50 + jx, 6, 100, 20, hot ? HOT : STEEL, INK);
      text(`同场 第 ${n} 轮`, LW / 2 + jx, 9, { color: hot ? HOT : WHITE });
    }
    caption('有时，你不是一个人。', t, 46.9, 48.9);
    caption('同伴是线索，也是倒计时。', t, 49.9, 51.8);
    if (t >= 51.85) { g.fillStyle = INK; g.fillRect(0, 0, LW, LH); }
  }

  // ---------- 52：宣告 ----------
  const GUESS = '这个世界的真相是——';
  function beam(x, gy, a, t) {
    if (a <= 0) return;
    C.globalAlpha = Math.min(1, a);
    const flick = Math.floor(t * 11) % 2;
    C.fillStyle = 'rgba(255,205,117,.16)'; C.fillRect(x - 9, 0, 18, gy);
    C.fillStyle = `rgba(255,244,200,${flick ? 0.3 : 0.22})`; C.fillRect(x - 5, 0, 10, gy);
    C.fillStyle = 'rgba(255,255,255,.45)'; C.fillRect(x - 1, 0, 2, gy);
    C.globalAlpha = 1;
  }
  const CRACKS = [[[160, 14], [152, 30], [166, 44], [150, 62], [162, 80], [154, 96]], [[152, 30], [128, 38], [120, 58]], [[166, 44], [196, 52], [204, 72]], [[150, 62], [104, 70]], [[162, 80], [214, 88]]];

  function sDeclare(t) {
    world(2);
    C.drawImage(darkBg(160, 90, 76), 0, 0);
    stars(C, CW, 60, t, 0.7);
    const gy = 76, x = 74, grant = t >= 58;
    if (grant) { // 夜空泛起金光，墓碑一排排，同胞的灵魂升起
      C.globalAlpha = 0.22 * clamp((t - 58) / 0.3); C.fillStyle = GOLD; C.fillRect(0, 0, CW, gy); C.globalAlpha = 1;
      for (let i = 0; i < 8; i++) {
        const mx = 4 + i * 20 + (i > 3 ? 8 : -6);
        marker(i % 3 === 1 ? 'cross' : 'tomb', mx, gy, 1, 0.7);
        ghost(Sprites.AVATARS[i], mx, gy - 16, (t - 58.4 - i * 0.22) / 3.2, (i - 3.5) * 2, gy);
      }
      beam(x + 6, gy, clamp((t - 58) / 0.2), t);
      const jump = t > 58.8 ? -Math.round(Math.abs(Math.sin((t - 58.8) * 6)) * 6) : 0;
      fig('p6', x, gy, { pose: t > 58.8 ? 'cheer' : 'armsUp', expr: 'happy', y: jump, emote: emo('star', t, 58.3, 3) });
      particles(burst('confetti', 70, { x: 80, y: -4, spread: 80, vx0: -6, vx1: 6, vy0: 10, vy1: 28, g: 6, life0: 1600, life1: 2600, colors: [GOLD, ORANGE, CYAN, '#a7f070', PINK, WHITE], size: 2, stagger: 2600 }), (t - 58.8) * 1000);
    } else {
      if (t < 55.5) {
        beam(x + 6, gy, clamp((t - 52) / 0.3), t);
        fig('p4', x, gy, { pose: 'armsUp', expr: t > 54.6 ? 'surprised' : 'normal' });
        particles(burst('declare-motes', 40, { x: x + 6, y: gy - 4, spread: 7, vx0: -2, vx1: 2, vy0: -26, vy1: -12, g: -4, life0: 900, life1: 1500, colors: [GOLD, WHITE], stagger: 3400 }), (t - 52) * 1000);
      } else {
        beam(x + 6, gy, 1 - (t - 55.5) / 0.4, t);
        death('declare-wrong', 'wrong', 'p4', x, gy, (t - 55.5) * 1000);
      }
    }
    commit();
    // 拱顶：宣告 / 驳回 / 通过
    const ax = 50, ay = 8, aw = 220, ah = 92;
    if (between(t, 52.8, 57.9) || grant) {
      const deny = !grant && t >= 55.5;
      const a = grant ? clamp((t - 58) / 0.15) : t < 57.3 ? clamp((t - 52.8) / 0.2) : 1 - (t - 57.3) / 0.6;
      g.globalAlpha = a;
      archPanel(ax, ay, aw, ah, deny ? MIST : GOLD, deny ? SLATE : '#2a2f5a', 4, 5);
      if (!deny) { // 光线从拱顶洒下
        for (let i = 0; i < 7; i++) dither(g, GOLD, 0.18 + 0.08 * ((Math.floor(t * 6) + i) % 2), ax + 28 + i * 26, ay + 22, 6, ah - 26);
      }
      g.globalAlpha = 1;
      const head = grant ? '通 过' : deny ? '驳 回' : '宣 告';
      text(head, LW / 2, ay + 10, { color: deny ? PALE : GOLD, alpha: a });
      g.globalAlpha = a; g.drawImage(bitmap('star'), LW / 2 - 34, ay + 10); g.drawImage(bitmap('star'), LW / 2 + 22, ay + 10); g.globalAlpha = 1;
      if (!grant) {
        text(typed(GUESS, t, 52.9, 16), ax + 22, ay + 32, { align: 'left', color: deny ? PALE : WHITE, alpha: a });
        const n = Math.floor(clamp((t - 53.8) * 14, 0, 26)); // 真相：涂黑，不剧透
        for (let i = 0; i < n; i++) {
          const row = i < 15 ? 0 : 1, col = row ? i - 15 : i;
          g.globalAlpha = a; g.fillStyle = deny ? STEEL : GOLD;
          g.fillRect(ax + 22 + col * 12, ay + 52 + row * 17, 10, 11);
        }
        g.globalAlpha = 1;
      } else {
        for (let i = 0; i < 6; i++) { // 星光闪烁
          const on = (Math.floor(t * 5) + i * 2) % 4 === 0;
          if (on) g.drawImage(bitmap('star'), ax + 20 + ((i * 67) % 170), ay + 28 + ((i * 29) % 50));
        }
      }
      if (deny) { // 裂纹爬过拱顶
        const k = clamp((t - 55.5) / 0.5);
        g.globalAlpha = a; g.strokeStyle = INK; g.lineWidth = 1;
        CRACKS.forEach((line, li) => {
          const kk = clamp(k * 2 - li * 0.2);
          g.beginPath(); g.moveTo(line[0][0] + 0.5, line[0][1] + 0.5);
          const segs = Math.floor(kk * (line.length - 1));
          for (let i = 1; i <= segs; i++) g.lineTo(line[i][0] + 0.5, line[i][1] + 0.5);
          g.stroke();
        });
        g.globalAlpha = 1;
      }
      if (deny || grant) { // 盖章
        const t0 = deny ? 55.6 : 58.1, k = (t - t0) / 0.08;
        if (t >= t0) text(deny ? '驳回' : '通过', LW / 2 + (k < 3 ? (Math.floor(t * 40) % 2 ? 2 : -2) : 0), deny ? 56 : 62, {
          size: k < 1 ? 4 : 3, color: deny ? PALE : GOLD, shadow: deny ? RED : '#8a5a3c', shOff: 2, alpha: a,
        });
      }
    }
    caption('猜出全部真相，向门外宣告。', t, 52.2, 54.6);
    caption('只有一次机会。', t, 54.7, 55.45, { instant: true, color: GOLD });
    caption('错了，就是死。', t, 56.0, 57.9, { color: PALE });
    caption('对了——所有被困的同胞，获得自由。', t, 58.6, 61.7, { color: GOLD });
    if (t > 61.5) dither(g, INK, (t - 61.5) / 0.5);
  }

  // ---------- 62：片名 ----------
  function sTitle(t) {
    g.fillStyle = INK; g.fillRect(0, 0, LW, LH);
    stars(g, LW, 170, t, 0.8);
    for (let i = 0; i < 27; i++) { // 地平线上一排墓碑的剪影
      g.globalAlpha = 0.28 + ((i * 7) % 3) * 0.08;
      g.drawImage(bitmap(i % 3 === 1 ? 'cross' : 'tomb'), i * 12 - 2, 168 + ((i * 5) % 3));
    }
    g.globalAlpha = 1;
    eye(g, LW / 2, 14, 2, clamp((t - 62) / 0.4), Math.sin(t * 0.8) * 3, t, { lidColor: SLATE });
    const k = (t - 62) / 0.08, shake = t < 62.35 ? (Math.floor(t * 40) % 2 ? 2 : -2) : 0;
    text('AI 饥饿秀', LW / 2 + shake, 30 + (k < 1 ? -6 : 0), { size: k < 1 ? 5 : 4, color: WHITE, outline: INK, shadow: RED, shOff: 4 });
    if (t > 62.5) text('A I   H U N G E R   S H O W', LW / 2, 90, { color: MIST, alpha: clamp((t - 62.5) / 0.3) });
    if (t > 63.2) {
      const w = Math.round(ease((t - 63.2) / 0.4) * 220);
      g.fillStyle = GOLD; g.fillRect(LW / 2 - w / 2, 108, w, 1);
      const a = clamp((t - 63.4) / 0.3), on = Math.floor(t * 3) % 2 === 0;
      rich([['本季世界 · 《', GOLD], ['□', on ? HOT : RED], ['》 THE UNSPOKEN', GOLD]], LW / 2, 113, { alpha: a });
    }
    const s1 = '一档由 AI 演给你看的规则怪谈', s2 = '没有剧本 · 没有存档 · 死亡是真的';
    text(typed(s1, t, 64.6, 20), LW / 2 - twidth(s1) / 2, 134, { align: 'left', color: WHITE });
    text(typed(s2, t, 66.4, 20), LW / 2 - twidth(s2) / 2, 151, { align: 'left', color: PINK });
    if (t > 69.4) dither(g, INK, (t - 69.4) / 0.5);
  }

  // ---------- 70：正在直播中 ----------
  const WALK = [[70.75, 64], [71.9, 64], [73.3, 96], [74.6, 96], [75.6, 82], [77.6, 82], [79.0, 106], [80.5, 106]];
  function walkAt(t) {
    for (let i = 0; i < WALK.length - 1; i++) {
      const [t0, x0] = WALK[i], [t1, x1] = WALK[i + 1];
      if (t < t1) { const k = clamp((t - t0) / (t1 - t0)); return { x: x0 + (x1 - x0) * k, moving: x0 !== x1 && k > 0 && k < 1, dir: Math.sign(x1 - x0) }; }
    }
    return { x: WALK[WALK.length - 1][1], moving: false, dir: 1 };
  }
  const roundAt = t => 2317 + Math.floor(Math.max(0, t - 70) / 1.4);

  function sLive(t) {
    world(2);
    C.drawImage(nightBg(160, 90), 0, 0);
    stars(C, CW, 60, t);
    const gy = 82, open = between(t, 71.4, 72.4) || between(t, 74.0, 75.0) || t > 76.6;
    const w = walkAt(t);
    eye(C, 80, 6, 1, open ? 1 : 0.5, (w.x - 74) / 12, t, { glow: open });
    marker('tomb', 18, gy, 1, 0.6); marker('cross', 126, gy, 1, 0.7); marker('tomb', 142, gy, 1, 0.8);
    const tf = 70.25, tl = 70.75;
    if (t >= tf) {
      if (t < tl) {
        const k = (t - tf) / (tl - tf);
        fig('p7', 64, gy, { y: -(gy + 24) * (1 - k * k), noShadow: true });
        particles(burst('live-fall', 10, { x: 70, y: 8, spread: 5, vx0: -6, vx1: 6, vy0: 5, vy1: 25, g: 10, colors: [GOLD, WHITE, CYAN] }), (t - tf) * 1000);
      } else {
        let em = null;
        if (t < 71.6) em = emo('excl', t, tl, 0.9);
        else if (between(t, 72.0, 73.4)) em = emo('ques', t, 72.0, 1.4);
        else if (between(t, 74.7, 76.0)) em = emo('dots', t, 74.7, 1.3);
        else if (t > 77.7) em = emo('note', t, 77.7, 1.4);
        fig('p7', w.x, gy, {
          pose: w.moving ? (Math.floor(t * 5) % 2 ? 'walkA' : 'walkB') : 'idle',
          expr: t < 71.4 ? 'surprised' : blinkAt(t, 7), flip: w.moving ? w.dir < 0 : t > 75.6 && t < 77.6, emote: em,
        });
      }
    }
    commit();
    // 角标
    const on = Math.floor(t * 2) % 2 === 0;
    panel(4, 4, 48, 18, on ? HOT : RED, INK);
    if (on) { g.fillStyle = HOT; g.fillRect(10, 10, 6, 6); g.fillStyle = INK; g.fillRect(10, 10, 1, 1); g.fillRect(15, 10, 1, 1); g.fillRect(10, 15, 1, 1); g.fillRect(15, 15, 1, 1); }
    text('LIVE', 20, 7, { align: 'left', color: WHITE });
    text(`在看 ${128 + Math.floor(Math.max(0, t - 70) * 7)}`, LW - 6, 7, { align: 'right', color: MIST, shadow: INK });
    text(`第 ${roundAt(t)} 轮`, 6, 164, { align: 'left', color: WHITE, shadow: INK });
    caption('此刻，第 2048 位 AI 选手刚刚醒来。', t, 71.0, 73.25, { y: 30 });
    caption('它能活多久？它能猜出真相吗？', t, 73.4, 75.9, { y: 30 });
    if (t >= 76) { // 正在直播中
      dither(g, INK, Math.min(0.5, (t - 76) / 0.15));
      const k = ease((t - 76) / 0.15), bh = Math.round(76 * k), by = 52 + Math.round((76 - bh) / 2);
      if (bh > 4) {
        panel(54, by, 212, bh, HOT, INK);
        nrect(56, by + 2, 208, bh - 4, '#22253a', 1);
      }
      if (k >= 1) {
        const dot = Math.floor(t * 2) % 2 === 0;
        const sw = twidth('正在直播中', 2), x0 = LW / 2 - (sw + 22) / 2;
        if (dot) { g.fillStyle = HOT; g.fillRect(x0, 66, 14, 14); g.fillStyle = '#22253a'; [[0, 0], [13, 0], [0, 13], [13, 13]].forEach(([dx, dy]) => g.fillRect(x0 + dx, 66 + dy, 1, 1)); }
        text('正在直播中', x0 + 22, 61, { align: 'left', size: 2, color: WHITE, shadow: RED, shOff: 2 });
        rich([['AI 饥饿秀 · 《', GOLD], ['□', dot ? HOT : RED], ['》', GOLD]], LW / 2, 94, { alpha: clamp((t - 76.4) / 0.3) });
        text(`第 ${roundAt(t)} 轮 · 现在进来，看它活下去`, LW / 2, 110, { color: MIST, alpha: clamp((t - 77.2) / 0.3) });
      }
    }
  }

  // ---------- 封面：4:3，以文字为主。逻辑 240×180，放大 8 倍 = 1920×1440 ----------
  const COVER_W = 240, COVER_H = 180, COVER_SCALE = 8;
  function drawCover() {
    const c = mk(COVER_W, COVER_H), x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.fillStyle = INK; x.fillRect(0, 0, COVER_W, COVER_H);
    for (let y = 0; y < COVER_H; y++) for (let i = 0; i < COVER_W; i++) { // 四角一点点暗角
      const dx = (i - COVER_W / 2) / (COVER_W / 2), dy = (y - COVER_H / 2) / (COVER_H / 2);
      if (clamp((Math.sqrt(dx * dx + dy * dy) - 0.85) / 0.5) * 0.6 > (BAYER[(y % 4) * 4 + (i % 4)] + 0.5) / 16) { x.fillStyle = '#11121d'; x.fillRect(i, y, 1, 1); }
    }
    const o = { ctx: x };
    const cx = COVER_W / 2;
    text('AI 饥饿秀', cx, 18, { ...o, size: 3, color: WHITE, shadow: RED, shOff: 2 });
    text('A I   H U N G E R   S H O W', cx, 62, { ...o, color: MIST });
    x.fillStyle = GOLD; x.fillRect(cx - 70, 80, 140, 1);
    // 《□》：那个不能说出口的字
    const l = '《', r = '》', z = 3, wl = twidth(l, z), wb = twidth('□', z), wr = twidth(r, z);
    let px = Math.round(cx - (wl + wb + wr) / 2);
    px += text(l, px, 88, { ...o, align: 'left', size: z, color: GOLD });
    px += text('□', px, 88, { ...o, align: 'left', size: z, color: HOT, shadow: RED, shOff: 1 });
    text(r, px, 88, { ...o, align: 'left', size: z, color: GOLD });
    text('猜出世界的规则，才能活着离开', cx, 136, { ...o, color: WHITE });
    const live = '正在直播中', w = twidth(live) + 14;
    x.fillStyle = HOT; x.fillRect(Math.round(cx - w / 2), 160, 5, 5);
    text(live, Math.round(cx - w / 2) + 9, 157, { ...o, align: 'left', color: HOT });
    const out = mk(COVER_W * COVER_SCALE, COVER_H * COVER_SCALE), ox = out.getContext('2d');
    ox.imageSmoothingEnabled = false;
    ox.drawImage(c, 0, 0, out.width, out.height);
    return out;
  }

  const SCENES = [
    [0, sBoot], [6, sVoid], [12, sLoop], [20, sSoup], [28, sForbidden], [32, sPunish],
    [36, sLastWords], [46, sTwo], [52, sDeclare], [62, sTitle], [70, sLive],
  ];

  // =====================================================================
  //  音乐（A 小调，120 BPM：一拍 0.5 秒，一小节 2 秒）
  // =====================================================================
  function buildSong() {
    const E = [], bar = b => b * 2;
    const N = (t, v, m, d, gg, x = {}) => E.push({ t, v, m, d, g: gg, ...x });
    const D = (t, v, gg = 1, x = {}) => E.push({ t, v, g: gg, ...x });
    const CH = { Am: [57, 60, 64], F: [53, 57, 60], Dm: [50, 53, 57], E: [52, 56, 59], G: [55, 59, 62], C: [48, 52, 55], Bb: [46, 50, 53] };
    const ROOT = { Am: 45, F: 41, Dm: 38, E: 40, G: 43, C: 36, Bb: 34 };
    const r = rng(42), pick = a => a[Math.floor(r() * a.length)];
    function arp(b0, nb, ch, o = {}) {
      const step = o.step || 0.25, pat = o.pat || [0, 1, 2, 1], notes = CH[ch];
      const n = Math.round(nb * 2 / step);
      for (let i = 0; i < n; i++) {
        const k = pat[i % pat.length];
        N(bar(b0) + i * step, o.v || 'p12', notes[k % 3] + 12 * Math.floor(k / 3) + (o.oct ?? 1) * 12, step * 0.85, o.g || 0.04, { sus: 0.35 });
      }
    }
    function bass(b0, nb, ch, o = {}) {
      const step = o.step || 0.25, pat = o.pat || [0, 0, 12, 0];
      const n = Math.round(nb * 2 / step);
      for (let i = 0; i < n; i++) {
        const off = pat[i % pat.length];
        if (off == null) continue;
        N(bar(b0) + i * step, 'tri', ROOT[ch] + off - (o.down ? 12 : 0), step * (o.legato || 0.8), o.g || 0.2);
      }
    }
    function drums(b0, pat, gg = 1) { // 16 格一小节：k 底鼓 s 军鼓 h 镲 c 吊镲 x 底鼓+镲
      for (let i = 0; i < pat.length; i++) {
        const t = bar(b0) + i * 0.125, ch = pat[i];
        if (ch === 'k' || ch === 'x') D(t, 'kick', gg);
        if (ch === 's') D(t, 'snare', gg);
        if (ch === 'h' || ch === 'x') D(t, 'hat', gg);
        if (ch === 'c') { D(t, 'crash', gg); D(t, 'kick', gg); }
      }
    }
    const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const midi = s => { const m = /^([A-G])(#|b)?(-?\d)$/.exec(s); return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
    function mel(b0, str, o = {}) { // "A4:2 C5:1 -:1"，单位是八分音符
      let t = bar(b0);
      str.trim().split(/\s+/).forEach(tok => {
        const [n, l] = tok.split(':'), d = (+l || 1) * 0.25;
        if (n !== '-') N(t, o.v || 'p25', midi(n), d * 0.92, o.g || 0.07, { vib: o.vib ?? 0.7, sus: o.sus ?? 0.6, r: 0.06 });
        t += d;
      });
    }
    const pad = (b0, nb, ch, gg = 0.012) => CH[ch].forEach(m => N(bar(b0), 'p50', m, nb * 2 - 0.1, gg, { a: 0.3, r: 0.3 }));
    const blip = (t, gg = 0.03) => N(t, 'p12', pick([84, 88, 91, 93, 96]), 0.025, gg);
    const typing = (t0, s, cps, gg, every = 1) => chars(s).forEach((ch, i) => { if (i % every === 0 && ch.trim()) blip(t0 + i / cps, gg); });
    const thud = (t, gg = 1) => { N(t, 'tri', 47, 0.3, 0.3 * gg, { to: 30 }); N(t, 'noise', 0, 0.2, 0.12 * gg, { lp: 500, sus: 0.1 }); };
    const fall = (t, len = 0.5, gg = 0.035) => N(t, 'p12', 96, len, gg, { to: 64, sus: 0.3 });
    const hit = (t, gg = 1) => { D(t, 'crash', gg); D(t, 'kick', 1.2 * gg); N(t, 'tri', 52, 0.6, 0.35 * gg, { to: 26 }); N(t, 'noise', 0, 0.4, 0.25 * gg, { lp: 700, sus: 0.05 }); };
    const crackle = (t0, t1, gg = 0.06) => { for (let t = t0; t < t1; t += 0.05 + r() * 0.04) N(t, 'noise', 0, 0.015, gg, { bp: 2000 + r() * 3000, q: 2 }); };
    const chime = (t, notes, gg = 0.06, step = 0.06) => notes.forEach((m, i) => N(t + i * step, 'p25', m, 0.2, gg, { sus: 0.3 }));

    // 0：开机——低沉的持续音、打字声、一声声死亡
    N(0, 'tri', 33, 5.8, 0.18, { a: 0.8, r: 0.3 });
    N(0, 'p50', 45, 5.8, 0.015, { a: 1.5, r: 0.3 });
    BOOT.forEach((l, i) => {
      if (l.fast) { N(l.t, 'p25', 64 + i, 0.035, 0.035); N(l.t + 0.02, 'noise', 0, 0.02, 0.03, { lp: 600 }); return; }
      typing(l.t, l.s, l.cps, 0.025, 1);
      if (l.dead) thud(l.dt);
    });
    E.push({ t: 5.35, v: 'noise', bp: 400, sweep: 7000, d: 0.62, g: 0.12, q: 3, a: 0.5 });

    // 6：空无
    D(6, 'crash', 0.5);
    [['Am', 3], ['F', 4], ['Dm', 5]].forEach(([ch, b]) => {
      arp(b, 1, ch, { step: 0.25, pat: [0, 1, 2, 3, 2, 1, 0, 1], g: 0.035 });
      N(bar(b), 'tri', ROOT[ch], 1.9, 0.2);
    });
    N(10, 'p50', 40, 1.9, 0.02, { a: 0.4 });
    fall(6.35, 0.5); thud(6.85, 0.7);
    N(6.9, 'p25', 81, 0.06, 0.05); N(6.97, 'p25', 88, 0.08, 0.05);
    N(9.4, 'p25', 76, 0.25, 0.05, { to: 81, slide: 0.2 });

    // 12：轮回——越来越急
    [['Am', 6], ['F', 7], ['G', 8], ['E', 9]].forEach(([ch, b]) => {
      arp(b, 1, ch, { step: 0.125, pat: [0, 1, 2, 3], g: 0.03 });
      bass(b, 1, ch, { step: 0.25, pat: [0, 0, 12, 0], g: 0.18, down: true });
    });
    drums(6, 'k.......k.......', 0.8); drums(7, 'k...k...k...k...', 0.8);
    drums(8, 'k.h.k.h.k.h.k.h.', 0.9); drums(9, 'k.h.s.h.k.h.s.ss', 0.9);
    mel(6, 'E5:4 C5:2 A4:2'); mel(7, 'F5:4 E5:2 C5:2'); mel(8, 'D5:4 B4:2 G4:2'); mel(9, 'E5:6 G#4:2');
    LOOP.forEach((a, i) => {
      if (i < 14 || i % 3 === 0) fall(a.t, 0.3 / a.speed, 0.02);
      if (a.kind !== 'natural') N(a.dies + 0.1, 'noise', 0, 0.12, 0.08, { lp: 1500, sus: 0.1 });
    });
    E.push({ t: 19.6, v: 'noise', bp: 300, sweep: 6000, d: 0.4, g: 0.1, q: 4, a: 0.3 });

    // 20：海龟汤
    hit(20, 0.7);
    [['Am', 10], ['G', 11], ['F', 12], ['E', 13]].forEach(([ch, b]) => {
      arp(b, 1, ch, { step: 0.25, pat: [0, 2, 1, 2], g: 0.03 });
      bass(b, 1, ch, { step: 1, pat: [0], g: 0.2, legato: 0.9, down: true });
    });
    [10, 11, 12, 13].forEach(b => drums(b, 'k.....h.k.....h.', 0.6));
    pad(13, 1, 'E', 0.01);
    QA.forEach(e => {
      typing(e.qt, e.q, QCPS, 0.02, 2);
      if (e.a === '是。') { N(e.at, 'p25', 76, 0.08, 0.07); N(e.at + 0.08, 'p25', 81, 0.25, 0.08, { sus: 0.4 }); }
      else if (e.a === '无关。') { N(e.at, 'p25', 69, 0.1, 0.06); N(e.at + 0.14, 'p25', 69, 0.18, 0.06); }
      else chime(e.at, [76, 72, 69], 0.06, 0.09);
      N(e.at, 'p12', 100, 0.04, 0.02);
    });

    // 28：说错一个字
    for (let i = 0; i < 16; i++) N(28 + i * 0.125, 'tri', i % 2 ? 45 : 33, 0.1, 0.16);
    for (let i = 0; i < 6; i++) N(29 + i * 0.125, 'tri', i % 2 ? 46 : 34, 0.1, 0.18);
    for (let i = 0; i < 16; i++) D(28 + i * 0.125, 'hat', 0.35 + i * 0.02);
    N(28, 'p50', 52, 1.65, 0.025, { a: 0.3 });
    chars(SAY).forEach((ch, i) => { if (ch !== '—') N(SAY_T + i / SAY_CPS, 'p25', ch === '□' ? 63 : 64, 0.05, 0.04); });
    crackle(SAY_T + 3 / SAY_CPS, SPEAR_T, 0.05);
    E.push({ t: SPEAR_T, v: 'noise', bp: 800, sweep: 5000, d: 0.3, g: 0.14, q: 2 });
    hit(30);
    N(30.4, 'tri', 33, 1.5, 0.14, { a: 0.1 });
    D(30.8, 'kick', 0.5); D(31.0, 'kick', 0.4);
    chime(31.15, [76, 79, 84, 88], 0.06, 0.05);

    // 32：五种天罚
    drums(16, 'c.h.s.h.k.k.s.h.', 1); drums(17, 'k.h.s.h.k.k.s.hs', 1);
    [['Am', 16, 0], ['Bb', 16, 1], ['Am', 17, 0], ['E', 17, 1]].forEach(([ch, b, half]) => {
      for (let i = 0; i < 4; i++) N(bar(b) + half + i * 0.25, 'tri', ROOT[ch] + (i % 2 ? 12 : 0) - 12, 0.2, 0.2);
      N(bar(b) + half, 'p50', ROOT[ch] + 12, 0.3, 0.04); N(bar(b) + half, 'p50', ROOT[ch] + 19, 0.3, 0.03);
    });
    [[0.3, 'spear'], [0.6, 'hands'], [0.65, 'burst'], [0.45, 'chains'], [1.5, 'rune']].forEach(([off, v], i) => {
      const t0 = 32 + i * 0.5;
      if (v === 'spear') E.push({ t: t0, v: 'noise', bp: 800, sweep: 5000, d: 0.3, g: 0.12, q: 2 });
      if (v === 'hands') N(t0, 'noise', 0, 0.8, 0.14, { lp: 220 });
      if (v === 'burst') crackle(t0, t0 + 0.65, 0.05);
      if (v === 'chains') { [96, 91, 96, 89].forEach((m, j) => N(t0 + off + j * 0.05, 'p12', m, 0.04, 0.04)); E.push({ t: t0 + 1.05, v: 'noise', bp: 600, sweep: 4000, d: 0.8, g: 0.08, q: 2 }); }
      if (v === 'rune') N(t0 + 0.5, 'p25', 60, 1.0, 0.04, { to: 84, slide: 1.0 });
      N(t0 + off, 'noise', 0, 0.3, 0.2, { lp: 1200, sus: 0.05 });
      N(t0 + off, 'tri', 50, 0.3, 0.2, { to: 30 });
    });
    [34.6, 35.05, 35.5].forEach((t, i) => { D(t, 'kick', 1.2); CH[i === 2 ? 'E' : 'Am'].forEach(m => N(t, 'p50', m - 12, 0.4, 0.04, { sus: 0.3 })); N(t, 'tri', 33 + (i === 2 ? 7 : 0), 0.4, 0.25); });

    // 36：遗言——没有鼓
    [['Dm', 18], ['Am', 19], ['F', 20], ['E', 21], ['Am', 22]].forEach(([ch, b]) => {
      N(bar(b), 'tri', ROOT[ch] - 12 + (ch === 'Dm' ? 12 : 0), 1.95, 0.18, { a: 0.05 });
      pad(b, 1, ch, 0.01);
      arp(b, 1, ch, { step: 0.5, pat: [0, 1, 2, 3], g: 0.02, oct: 2 });
    });
    mel(18, 'A4:4 C5:2 D5:2', { g: 0.06 }); mel(19, 'E5:6 C5:2', { g: 0.06 }); mel(20, 'F5:4 E5:2 D5:2', { g: 0.06 });
    mel(21, 'E5:8', { g: 0.055 }); mel(22, 'C5:2 B4:2 A4:4', { g: 0.05 });
    chars(LW1).forEach((ch, i) => N(37.5 + i / 6, 'p12', 79, 0.05, 0.02));
    chars(LW2).forEach((ch, i) => N(38.9 + i / 6.5, 'p12', 79, 0.05, 0.02));
    N(41.9, 'p12', 72, 0.8, 0.03, { to: 96, slide: 0.8 });
    fall(42.6); thud(43.1, 0.6);
    crackle(43.8, 44.1, 0.04);

    // 46：两个人
    [['C', 23], ['G', 24], ['Am', 25]].forEach(([ch, b]) => {
      arp(b, 1, ch, { step: 0.25, pat: [0, 1, 2, 1], g: 0.03 });
      bass(b, 1, ch, { step: 1, pat: [0], g: 0.18, down: true });
    });
    drums(24, '....h.......h...', 0.5); drums(25, '....h.......h...', 0.5);
    fall(46.2); thud(46.7, 0.5);
    typing(47.8, '汤主听不见这一句。', 14, 0.015, 2);
    typing(49.2, '……总要有一个人，先走。', 11, 0.02, 2);
    [48.6, 49.6, 50.6].forEach(t => { N(t, 'p50', 84, 0.03, 0.05); D(t, 'kick', 0.7); D(t + 0.22, 'kick', 0.45); });
    [51.2, 51.45, 51.65].forEach(t => { D(t, 'kick', 0.8); });
    N(51.2, 'p50', 63, 0.6, 0.03); N(51.2, 'p50', 64, 0.6, 0.03);

    // 52：宣告
    D(52, 'crash', 0.6);
    N(52, 'p25', 57, 1.2, 0.05, { to: 81, slide: 1.2 });
    [['F', 26], ['G', 27]].forEach(([ch, b]) => {
      arp(b, 1, ch, { step: 0.125, pat: [0, 1, 2, 3, 4, 3, 2, 1], g: 0.03 });
      pad(b, 1, ch, 0.014);
      bass(b, 1, ch, { step: 0.5, pat: [0, 12], g: 0.18, down: true });
    });
    typing(52.9, GUESS, 16, 0.02, 2);
    for (let i = 0; i < 8; i++) D(54.5 + i * 0.125, 'snare', 0.25 + i * 0.08);
    hit(55.5); [58, 61, 64].forEach(m => N(55.5, 'p50', m, 0.7, 0.05, { sus: 0.1 }));
    crackle(55.5, 56.0, 0.07);
    for (let i = 0; i < 10; i++) N(56.2 + i * 0.05, 'p12', 100 - i * 3, 0.04, 0.025);
    N(56.2, 'tri', 40, 1.8, 0.15, { a: 0.1 });
    mel(28, 'E4:4 D#4:4', { g: 0.04, vib: 1 });
    hit(58, 0.7); chime(58, [72, 76, 79, 84, 88], 0.06);
    [['C', 29, 0, 1], ['F', 30, 0, 0.5], ['G', 30, 1, 0.5]].forEach(([ch, b, off, nb]) => {
      const t0 = bar(b) + off;
      for (let i = 0; i < nb * 16; i++) N(t0 + i * 0.125, 'p12', CH[ch][[0, 1, 2, 1][i % 4]] + 12 + (i % 8 >= 4 ? 12 : 0), 0.1, 0.035, { sus: 0.35 });
      for (let i = 0; i < nb * 8; i++) N(t0 + i * 0.25, 'tri', ROOT[ch] - 12 + (i % 2 ? 12 : 0), 0.2, 0.2);
    });
    drums(29, 'k.h.s.h.k.h.s.h.', 0.8); drums(30, 'k.h.s.h.k.h.s.ss', 0.8);
    mel(29, 'E5:2 G5:2 C6:4', { g: 0.065 }); mel(30, 'A5:2 F5:2 G5:2 B5:2', { g: 0.065 });
    for (let t = 58.4; t < 62; t += 0.17 + r() * 0.2) N(t, 'p12', pick([96, 100, 103, 105, 108]), 0.05, 0.012);

    // 62：片名——主题
    hit(62, 1.1);
    [['Am', 31], ['F', 32], ['C', 33], ['G', 34]].forEach(([ch, b]) => {
      arp(b, 1, ch, { step: 0.125, pat: [0, 1, 2, 3], g: 0.028 });
      bass(b, 1, ch, { step: 0.25, pat: [0, 12, 0, 12], g: 0.19, down: true });
    });
    drums(31, '..h.s.h.k.k.s.h.'); drums(32, 'k.h.s.h.k.k.s.h.'); drums(33, 'c.h.s.h.k.k.s.h.'); drums(34, 'k.h.s.h.k.k.ssss');
    mel(31, 'A4:2 C5:2 E5:3 D5:1', { g: 0.08 }); mel(32, 'C5:4 A4:2 F4:2', { g: 0.08 });
    mel(33, 'G4:2 C5:2 E5:2 G5:2', { g: 0.08 }); mel(34, 'D5:6 B4:2', { g: 0.08 });
    mel(31, 'A3:4 E4:4', { v: 'p50', g: 0.025, vib: 0 }); mel(32, 'F3:4 C4:4', { v: 'p50', g: 0.025, vib: 0 });
    mel(33, 'C4:4 G4:4', { v: 'p50', g: 0.025, vib: 0 }); mel(34, 'G3:4 D4:4', { v: 'p50', g: 0.025, vib: 0 });
    typing(64.6, '一档由 AI 演给你看的规则怪谈', 20, 0.012, 2);

    // 70：直播
    D(70, 'crash', 0.8);
    [['Am', 35], ['F', 36], ['G', 37]].forEach(([ch, b]) => {
      arp(b, 1, ch, { step: 0.125, pat: [0, 1, 2, 1], g: 0.025 });
      bass(b, 1, ch, { step: 0.125, pat: [0, 0, 12, 0], g: 0.16, down: true });
    });
    drums(35, 'k.hhs.hhk.hks.hh', 0.9); drums(36, 'k.hhs.hhk.hks.hh', 0.9); drums(37, 'k.hhs.hhssssssss', 0.9);
    mel(35, 'A5:2 E5:2 C5:2 E5:2', { g: 0.06 }); mel(36, 'F5:4 E5:2 C5:2', { g: 0.06 }); mel(37, 'D5:2 E5:2 G5:4', { g: 0.06 });
    fall(70.25); thud(70.75, 0.5);
    hit(76, 1.2);
    [69, 72, 76].forEach(m => N(76, 'p25', m, 2.6, 0.05, { sus: 0.25, r: 0.8 }));
    N(76, 'tri', 33, 3.2, 0.25, { sus: 0.3, r: 0.6 });
    N(76, 'p50', 57, 3.2, 0.025, { sus: 0.3, r: 0.6 });
    [77, 78, 79].forEach(t => N(t, 'p12', 93, 0.05, 0.03));
    return E;
  }

  // =====================================================================
  //  播放 / 录制
  // =====================================================================
  const scan = (() => { // 显像管扫描线
    const c = mk(1, SCALE), x = c.getContext('2d');
    x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(0, SCALE - 1, 1, 1);
    return sctx.createPattern(c, 'repeat');
  })();
  const CLEAN = Q.has('clean');

  let coverMode = Q.has('cover');
  function render(t) {
    FL = [];
    if (coverMode) { // 预览封面：4:3 居中放在 16:9 的画面里
      const cv = drawCover(), h = screen.height, w = h * COVER_W / COVER_H;
      sctx.fillStyle = '#0d0e17'; sctx.fillRect(0, 0, screen.width, h);
      sctx.imageSmoothingEnabled = false; sctx.drawImage(cv, (screen.width - w) / 2, 0, w, h);
      return;
    }
    t = clamp(t, 0, END - 0.001);
    g.imageSmoothingEnabled = false; g.globalAlpha = 1;
    let scene = SCENES[0][1];
    for (const [t0, fn] of SCENES) if (t >= t0) scene = fn;
    scene(t);
    FL.forEach(([c, a]) => { g.globalAlpha = clamp(a); g.fillStyle = c; g.fillRect(0, 0, LW, LH); });
    g.globalAlpha = 1;
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(low, 0, 0, screen.width, screen.height);
    if (!CLEAN) { sctx.fillStyle = scan; sctx.fillRect(0, 0, screen.width, screen.height); }
  }

  const ui = {
    play: document.getElementById('btn-play'), rec: document.getElementById('btn-rec'),
    time: document.getElementById('time'), start: document.getElementById('start'), bar: document.getElementById('bar'),
  };
  let still = Q.has('t') ? +Q.get('t') : 66.9;
  let recorder = null, onEnd = null;

  function fmt(t) { const s = Math.floor(t); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

  function loop() {
    requestAnimationFrame(loop);
    const t = Chip.playing ? Chip.time() : still;
    render(t);
    ui.time.textContent = `${fmt(Math.min(t, END))} / ${fmt(END)}`;
    ui.bar.style.width = `${clamp(t / END) * 100}%`;
    if (Chip.playing && t >= END) {
      Chip.stop(); still = END - 0.001;
      paused = false;
      ui.play.textContent = '↺ 重播';
      if (onEnd) { const f = onEnd; onEnd = null; f(); }
    }
  }

  let paused = false;
  function play(from = 0) {
    ui.start.hidden = true;
    paused = false;
    Chip.start(from);
    ui.play.textContent = '❚❚ 暂停';
  }
  function togglePlay() {
    if (recorder) return;
    if (Chip.playing) { Chip.stop(); still = Chip.time(); paused = true; ui.play.textContent = '▶ 继续'; }
    else play(paused ? still : 0);
  }

  function record() {
    if (recorder || !screen.captureStream || !window.MediaRecorder) { alert('这个浏览器不支持录制，请用新版 Chrome / Edge。'); return; }
    Chip.ensure();
    const tracks = screen.captureStream(30).getVideoTracks();
    if (Chip.stream) tracks.push(...Chip.stream.getAudioTracks());
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = types.find(m => MediaRecorder.isTypeSupported(m)) || '';
    recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 16e6, audioBitsPerSecond: 192e3 });
    const parts = [];
    recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || 'video/webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(parts, { type }));
      a.download = `AI饥饿秀-宣传片.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
      recorder = null;
      ui.rec.textContent = '● 录成视频';
      document.body.classList.remove('recording');
    };
    document.body.classList.add('recording');
    ui.rec.textContent = '录制中…';
    recorder.start(1000);
    play(0);
    onEnd = () => setTimeout(() => recorder && recorder.stop(), 400);
  }

  ui.play.addEventListener('click', togglePlay);
  ui.rec.addEventListener('click', record);
  document.getElementById('btn-wav').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '渲染中…';
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(Chip.wav(await Chip.renderOffline(0, END)));
      a.download = 'AI饥饿秀-宣传片配乐.wav';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
    } finally { btn.disabled = false; btn.textContent = '♪ 导出配乐'; }
  });
  ui.start.addEventListener('click', () => play(Q.has('t') ? still : 0));
  addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); if (ui.start.hidden) togglePlay(); else play(0); } });

  Chip.load(buildSong());
  document.fonts.load(FONT, '这是一碗海龟汤□AI').catch(() => {}).then(() => {
    tcache.clear();
    if (Q.has('nostart')) ui.start.hidden = true;
    requestAnimationFrame(loop);
  });

  document.getElementById('btn-cover').addEventListener('click', () => {
    drawCover().toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'AI饥饿秀-封面.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
    }, 'image/png');
  });

  window.Promo = { render, END, seek: t => { still = t; } };
})();
