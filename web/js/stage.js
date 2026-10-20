/* 演出区：在像素夜景里放上在场的选手。
 *   - 选手在地面上左右乱逛，时不时停下、眨眼、冒出表情（! ? ♥ ♪ 汗滴）；
 *   - 说话时嘴巴一张一合、面向同伴；心想时头上冒出云朵；
 *   - 遗言：跪下，身边点起烛光，飘起 †；
 *   - 宣告：双手高举，一道金光从天而降；
 *   - 死亡：处决=红光一闪、抽搐倒地、灵魂升天；宣告失败=白光吞没、碎成像素；自尽/寿尽=安静地跪下、灵魂升起；
 *            死后原地留下一块石碑（留了遗言）或木十字架（没来得及）；
 *   - 通关：全员欢呼跳跃，彩带落下，被困的同胞化作灵魂升向夜空；
 *   - 复活（spawn 时带 revived）：金光照下，地里冒出一块墓碑，墓碑碎开，人像灵魂一样从地里升起、展开翅膀，此后头顶一直顶着光环；
 *   - 猫娘：身后拖着一条会摇的尾巴；吟游诗人开口时冒音符；赌徒开口时头上转骰子；信徒跪着祷告；
 *     通灵者看见轮廓时额前紫光一闪；地缚灵体质的人身边飘着青色的游丝；
 *   - 恋人：两人之间连着一根红线，时不时冒出小心心；一个死去，另一个殉情时洒下红色的心；
 *   - 地缚灵：死后半透明的灵魂留在舞台上飘着，低语时飘到那个活人身边；魂飞魄散时炸成碎光，消散时慢慢变淡。
 *   HungerStage.lovers(idA, idB)  .vision(id)  .haunt(player)  .ghostWhisper(ghostId, targetId)  .ghostGone(ghostId, reason)
 * canvas 的逻辑分辨率跟随容器：取整数放大倍数 s，逻辑尺寸 = 容器尺寸 / s，像素始终是整数倍放大。
 *
 *   HungerStage.spawn(player, {instant})   .say(id, {len})   .think(id)   .envSay()   .lastWords(id)
 *   HungerStage.declare(id)   .die(record, {instant})   .victory(record, {freed})   .reset()
 * 动画跟着对话区的节奏走：这些函数由 app.js 在对应的气泡“开始显示”的那一刻调用。 */
(function (global) {
  'use strict';

  const stageEl = document.querySelector('.stage');
  const canvas = document.getElementById('stage-canvas');
  const ctx = canvas.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BASE_H = 68;     // 期望的逻辑高度，决定放大倍数
  const FRAME_MS = 66;   // 约 15 帧每秒：像素画就该一格一格地动
  const SPEED = 9;       // 走路速度（逻辑像素 / 秒）
  const SKY = ['#1a1c2c', '#29366f', '#3b5dc9'];
  const PAL = Sprites.PALETTE;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[Math.floor(Math.random() * list.length)];

  let W = canvas.width, H = canvas.height, GY = H - 8; // GY：地平线
  const bg = document.createElement('canvas');
  const bctx = bg.getContext('2d');

  // ---------- 背景（只在尺寸变化时画一次） ----------
  function paintBackground() {
    bg.width = W; bg.height = H;
    const bandH = H / 3;
    for (let y = 0; y < H; y++) {
      const band = Math.min(2, Math.floor(y / bandH));
      const blend = band > 0 && y - band * bandH < 2;
      for (let x = 0; x < W; x++) {
        bctx.fillStyle = SKY[blend && (x + y) % 2 === 0 ? band - 1 : band];
        bctx.fillRect(x, y, 1, 1);
      }
    }
    const mx = W - 24, my = Math.round(H * 0.25), R = 6; // 月亮
    bctx.fillStyle = '#f4f4f4';
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) bctx.fillRect(mx + dx, my + dy, 1, 1);
    }
    bctx.fillStyle = '#94b0c2';
    bctx.fillRect(mx - 3, my - 2, 2, 2);
    bctx.fillRect(mx + 1, my + 2, 2, 1);
    for (let i = 0; i < Math.ceil(W / 8); i++) { // 城市剪影
      const h = Math.max(6, 8 + ((i * 37) % 5) * 4 + Math.round((H - BASE_H) * 0.2));
      const x = i * 8;
      bctx.fillStyle = '#333c57';
      bctx.fillRect(x, GY - h, 7, h);
      bctx.fillStyle = '#ffcd75';
      for (let wy = GY - h + 3; wy < GY - 3; wy += 5) {
        if (((i + wy) * 7) % 3 === 0) bctx.fillRect(x + 2, wy, 1, 2);
      }
    }
    bctx.fillStyle = '#1a1c2c'; // 地面
    bctx.fillRect(0, GY, W, H - GY);
    bctx.fillStyle = '#38b764';
    for (let x = 0; x < W; x += 2) bctx.fillRect(x, GY, 1, 1);
  }

  function drawStars(t) {
    for (let i = 0; i < Math.floor(W / 14); i++) {
      ctx.fillStyle = (Math.floor(t / 500) + i) % 3 === 0 ? '#566c86' : '#f4f4f4';
      ctx.fillRect((i * 53 + 7) % W, (i * 29 + 5) % Math.max(1, GY - 14), 1, 1);
    }
  }

  // ---------- 像素小人：头 + 身体 + 腿，每个姿势 × 表情 × 头像合成一次并缓存 ----------
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
    idle:  ['....k..k....', '....k..k....', '...kk..kk...'],
    walkA: ['...k....k...', '...k....k...', '..kk....kk..'],
    walkB: ['.....kk.....', '.....kk.....', '....kkkk....'],
    kneel: ['..kDDDDDDk..', '.kkkkkkkkkk.'],
  };

  function grid(avatar, pose, expr) {
    const head = Sprites.SPRITES[Sprites.avatar(avatar)];
    const F = head[3][3], A = head[4][0], D = head[10][5];
    const sub = row => row.replace(/[FDA]/g, ch => ({ F, D, A })[ch]);
    const rows = head.slice(0, 10).concat(BODY.map(sub), (LEGS[pose === 'armsUp' || pose === 'cheer' ? 'idle' : pose] || LEGS.idle).map(sub));
    const g = rows.map(r => r.split(''));
    const set = (x, y, ch) => { if (g[y] && x >= 0 && x < 12) g[y][x] = ch; };
    if (pose === 'armsUp' || pose === 'cheer') { // 双手举过头顶
      for (let y = 1; y <= 8; y++) { set(0, y, D); set(11, y, D); }
      set(0, 0, A); set(11, 0, A);
      for (let y = 12; y <= 14; y++) { set(1, y, '.'); set(2, y, 'k'); set(3, y, F); set(8, y, F); set(9, y, 'k'); set(10, y, '.'); }
    }
    const clearEyes = () => [[3, 4], [4, 4], [3, 5], [4, 5], [7, 4], [8, 4], [7, 5], [8, 5]].forEach(([x, y]) => set(x, y, F));
    const clearMouth = () => { for (let x = 2; x <= 9; x++) { set(x, 7, F); set(x, 8, F); } };
    const xEyes = () => [[3, 3], [3, 5], [4, 4], [5, 3], [5, 5]].forEach(([x, y]) => { set(x - 1, y, 'k'); set(x + 4, y, 'k'); });
    switch (expr) {
      case 'blink':
        clearEyes(); [3, 4, 7, 8].forEach(x => set(x, 5, 'k')); break;
      case 'happy':
        clearEyes(); set(3, 5, 'k'); set(4, 4, 'k'); set(7, 4, 'k'); set(8, 5, 'k');
        clearMouth(); set(3, 7, 'k'); set(8, 7, 'k'); [4, 5, 6, 7].forEach(x => set(x, 8, 'k')); break;
      case 'surprised':
        clearMouth(); set(5, 7, 'k'); set(6, 7, 'k'); set(5, 8, 'k'); set(6, 8, 'k'); break;
      case 'talk':
        clearMouth(); [4, 5, 6, 7].forEach(x => set(x, 7, 'k')); [5, 6].forEach(x => set(x, 8, 'k')); break;
      case 'sad':
        clearMouth(); [4, 5, 6, 7].forEach(x => set(x, 7, 'k')); set(3, 8, 'k'); set(8, 8, 'k');
        set(3, 3, 'k'); set(4, 3, 'k'); set(7, 3, 'k'); set(8, 3, 'k'); break;
      case 'dead': // × ×
        clearEyes(); xEyes();
        clearMouth(); [4, 5, 6, 7].forEach(x => set(x, 8, 'k')); break;
      case 'xeyes': // 地缚灵：× × 的眼睛，嘴还是原来的
        clearEyes(); xEyes(); break;
      case 'xtalk': // 地缚灵在低语：× × 的眼睛，嘴一张一合
        clearEyes(); xEyes();
        clearMouth(); [4, 5, 6, 7].forEach(x => set(x, 7, 'k')); [5, 6].forEach(x => set(x, 8, 'k')); break;
      default:
    }
    return g;
  }

  function raster(g, tint) {
    const c = document.createElement('canvas');
    c.width = g[0].length; c.height = g.length;
    const x = c.getContext('2d');
    g.forEach((row, y) => row.forEach((ch, i) => {
      if (ch === '.') return;
      x.fillStyle = tint ? tint(ch) : PAL[ch];
      x.fillRect(i, y, 1, 1);
    }));
    return c;
  }

  const cache = new Map();
  function sprite(avatar, pose, expr, kind) {
    const key = `${avatar}|${pose}|${expr}|${kind || ''}`;
    if (!cache.has(key)) {
      const g = grid(avatar, pose, expr);
      let tint = null;
      if (kind === 'white') tint = ch => (ch === 'k' ? '#ffcd75' : '#f4f4f4');   // 被光吞没：剪影
      if (kind === 'red') tint = ch => (ch === 'k' ? '#5d275d' : ch === 'w' ? '#f4f4f4' : '#b13e53'); // 被处决：血色
      if (kind === 'ghost') tint = ch => (ch === 'k' ? '#566c86' : ch === 'w' ? '#f4f4f4' : '#c9d6e0'); // 灵魂
      cache.set(key, raster(g, tint));
    }
    return cache.get(key);
  }

  const ICONS = { // 7×7 的小表情，飘在头顶
    excl: ['...y...', '...y...', '...y...', '...y...', '.......', '...y...', '.......'],
    ques: ['..yyy..', '.y...y.', '.....y.', '...yy..', '...y...', '.......', '...y...'],
    heart: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...', '.......'],
    note: ['...wwww', '...w..w', '...w...', '...w...', '.ww....', '.ww....', '.......'],
    dots: ['.wwwww.', 'wwwwwww', 'wkwkwkw', 'wwwwwww', '.wwwww.', '..w....', '.w.....'],
    sweat: ['...c...', '..ccc..', '..ccc..', '.ccccc.', '..ccc..', '.......', '.......'],
    star: ['...y...', '...y...', 'yyyyyyy', '.yyyyy.', '..yyy..', '.yy.yy.', '.y...y.'],
    cross: ['...w...', '...w...', '.wwwww.', '...w...', '...w...', '...w...', '.......'],
    dice: ['wwwwwww', 'wkwwwkw', 'wwwwwww', 'wwwrwww', 'wwwwwww', 'wkwwwkw', 'wwwwwww'],
  };
  const iconCache = {};
  const icon = name => iconCache[name] || (iconCache[name] = raster(ICONS[name].map(r => r.split(''))));
  const bitmap = name => { // 来自 sprites.js 的 12×12 图（石碑、十字架、烛台）
    const key = '@' + name;
    return iconCache[key] || (iconCache[key] = raster(Sprites.SPRITES[name].map(r => r.split(''))));
  };

  // ---------- 状态 ----------
  let actors = [];      // 在场的选手（含正在死去的）
  let markers = [];     // 死者留下的碑 { x, kind: 'tomb' | 'cross', born }
  let ghosts = [];      // 升天的灵魂 { x, y, avatar, born, life }
  let particles = [];   // { x, y, vx, vy, g, born, life, color, size }
  let flash = null;     // { color, born, life, alpha }
  let candles = [];     // { x, until }
  let beams = [];       // 金色光柱 { actor }
  let spirits = [];     // 地缚灵 { id, avatar, x, born, mode: 'idle' | 'whisper' | 'gone', target, until, end }
  let lovers = null;    // 一对恋人的 id [a, b]
  let glow = 0;         // 通关时夜空泛金光到什么时候
  let eyeUntil = 0;     // 环境发言时，天上的眼睛亮到什么时候
  let eyeLook = 0;      // 眼睛看向的 x
  let last = 0;

  const now = () => performance.now();
  const find = id => actors.find(a => a.id === id && a.mode !== 'dying');
  const partnerOf = a => actors.find(b => b !== a && b.mode !== 'dying');
  const clampX = x => Math.max(10, Math.min(W - 22, x));

  function spawnParticles(x, y, n, colors, o = {}) {
    const t = now();
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x + rand(-(o.spread || 0), o.spread || 0), y: y + rand(-(o.spreadY || 0), o.spreadY || 0),
        vx: rand(o.vx0 ?? -10, o.vx1 ?? 10), vy: rand(o.vy0 ?? -30, o.vy1 ?? -8), g: o.g ?? 40,
        born: t, life: rand(o.life0 ?? 700, o.life1 ?? 1400), color: pick(colors), size: o.size || 1,
      });
    }
  }

  function emote(a, name, dur = 1400) { a.emote = { name, born: now(), dur }; }
  function face(a, expr, dur = 900) { a.expr = expr; a.exprUntil = now() + dur; }

  function newActor(p, x) {
    return {
      id: p.id, avatar: p.avatar, name: p.name, x, y: 0, dir: Math.random() < 0.5 ? 1 : -1,
      pose: 'idle', expr: 'normal', exprUntil: 0, nextFace: now() + rand(1200, 3000),
      mode: 'idle', modeUntil: 0, target: null, wait: rand(400, 1400), emote: null, born: now(), special: p.special,
    };
  }

  function freeSpot() {
    for (let i = 0; i < 12; i++) {
      const x = rand(14, Math.max(16, W - 30));
      if (actors.every(a => Math.abs(a.x - x) > 22)) return x;
    }
    return rand(14, Math.max(16, W - 30));
  }

  // ---------- 对外的事件 ----------
  function spawn(p, o = {}) {
    if (find(p.id)) return;
    const a = newActor(p, freeSpot());
    if (o.instant || REDUCED) {
      a.mode = 'idle';
    } else if (o.revived) { // 复活：金光照下，墓碑从地里冒出来、碎开，人从地里升起
      a.mode = 'revive'; a.t0 = now(); a.hidden = true; a.sink = 24;
      beams.push({ actor: a });
    } else { // 从天上落下，落地后吃了一惊
      a.mode = 'enter'; a.modeUntil = now() + 520; a.y = -(GY + 4);
      spawnParticles(a.x + 6, 8, 10, ['#ffcd75', '#f4f4f4', '#73eff7'], { spread: 5, vy0: 5, vy1: 25, vx0: -6, vx1: 6, g: 10 });
    }
    actors.push(a);
    render();
  }

  function introduce(id, o = {}) { // 性格卡亮出来的时候：转个身，冒个星星
    const a = find(id);
    if (!a || o.instant || a.mode !== 'idle' && a.mode !== 'enter') return;
    face(a, 'happy', 1100); emote(a, 'star', 1300);
  }

  // 入场（从天而降）和复活还没演完：说话、心想不打断它们；遗言、宣告要演，就先让人立刻落地
  const arriving = a => a.mode === 'enter' || a.mode === 'revive';
  function settle(a) {
    if (!arriving(a)) return;
    a.mode = 'idle'; a.y = 0; a.sink = 0; a.hidden = false; a.ghostly = false;
    beams = beams.filter(b => b.actor !== a);
  }

  function say(id, o = {}) {
    const a = find(id);
    if (!a || o.instant) return;
    if (a.mode === 'lastwords' || a.mode === 'declare' || arriving(a)) return;
    a.mode = 'speak';
    if (a.special === 'bard') { emote(a, 'note', 1600); spawnParticles(a.x + 6, GY - 22, 3, ['#ffcd75', '#f4f4f4'], { spread: 4, vx0: -6, vx1: 6, vy0: -16, vy1: -8, g: 0, life0: 900, life1: 1400, size: 2 }); }
    if (a.special === 'gambler') emote(a, 'dice', 1200);
    a.modeUntil = now() + Math.min(2600, 700 + (o.len || 20) * 45);
    a.target = null;
    const b = partnerOf(a);
    if (b) { a.dir = b.x >= a.x ? 1 : -1; if (b.mode === 'idle') { b.dir = -a.dir; if (Math.random() < 0.5) face(b, 'surprised', 700); } }
    eyeLook = a.x;
  }

  function think(id, o = {}) {
    const a = find(id);
    if (!a || o.instant || a.mode === 'lastwords' || a.mode === 'declare' || arriving(a)) return;
    a.mode = 'think'; a.modeUntil = now() + 1500; a.target = null;
    emote(a, 'dots', 1500);
    eyeLook = a.x;
  }

  function envSay(o = {}) {
    if (o.instant) return;
    eyeUntil = now() + 1600;
    const a = actors.find(x => x.mode !== 'dying');
    if (a) { eyeLook = a.x; if (a.mode === 'idle' && Math.random() < 0.6) face(a, 'surprised', 600); }
  }

  function lastWords(id, o = {}) {
    const a = find(id);
    if (!a || REDUCED || o.instant) return;
    settle(a);
    if (a.special === 'chronicler') emote(a, 'note', 1600); // 史官提笔
    a.mode = 'lastwords'; a.modeUntil = now() + 4200; a.target = null; a.expr = 'sad'; a.exprUntil = a.modeUntil;
    candles.push({ x: a.x + (a.dir > 0 ? 15 : -15), until: a.modeUntil + 800, actor: a });
    eyeLook = a.x;
  }

  function declare(id, o = {}) {
    const a = find(id);
    if (!a || REDUCED || o.instant) return;
    settle(a);
    a.mode = 'declare'; a.modeUntil = now() + 30000; a.target = null; a.expr = 'normal';
    a.dir = 1;
    const cx = clampX(W / 2 - 6); // 走到舞台中央去宣告
    a.target = cx; a.goingToDeclare = true;
    beams.push({ actor: a });
  }

  function die(r, o = {}) {
    const a = actors.find(x => x.id === r.id);
    const marker = { x: a ? a.x : rand(14, W - 30), kind: r.last_words ? 'tomb' : 'cross' };
    if (!a || o.instant || REDUCED) {
      actors = actors.filter(x => x !== a);
      beams = beams.filter(b => b.actor !== a);
      addMarker(marker);
      render();
      return;
    }
    settle(a);
    a.mode = 'dying'; a.kind = r.kind; a.t0 = now(); a.marker = marker; a.target = null; a.emote = null;
    if (r.kind === 'execution') a.variant = o.variant || pick(VARIANTS); // 触发圣言：随机一种天罚
    if (r.kind === 'heartbreak') spawnParticles(a.x + 6, GY - 14, 12, ['#e0607a', '#ff9ab0', '#b13e53'], { spread: 4, vx0: -10, vx1: 10, vy0: -22, vy1: -6, g: 20, life0: 900, life1: 1600, size: 2 });
    beams = beams.filter(b => b.actor !== a || r.kind === 'wrong_guess');
    candles = candles.filter(c => c.actor !== a);
    if (r.kind === 'wrong_guess') flash = { color: '#f4f4f4', born: now(), life: 500, alpha: 0.5 };
  }

  function victory(r, o = {}) {
    const a = actors.find(x => x.id === r.id);
    glow = now() + 9000;
    if (REDUCED || o.instant) { actors = []; beams = []; candles = []; return; }
    beams = [];
    actors.forEach(x => { x.mode = 'cheer'; x.modeUntil = now() + 9000; x.target = null; x.expr = 'happy'; x.exprUntil = x.modeUntil; });
    if (a) emote(a, 'star', 4000);
    // 被困的同胞：化作灵魂，从地面升向夜空
    const n = 5 + ((o.freed || []).length);
    for (let i = 0; i < n; i++) {
      ghosts.push({ x: 14 + (i + 0.5) * (W - 36) / n, y: GY - 6, avatar: Sprites.AVATARS[i % Sprites.AVATARS.length],
        born: now() + i * 260, life: 3600, drift: rand(-8, 8) });
    }
  }

  // ---------- 稀有身份 ----------
  function setLovers(idA, idB) { lovers = [idA, idB]; }

  function vision(id, o = {}) { // 通灵者睁开第三只眼：额前紫光一闪
    const a = find(id);
    if (!a || o.instant) return;
    emote(a, 'star', 1400);
    spawnParticles(a.x + 6, GY - 18, 14, ['#c28cd9', '#e0b8f0', '#73eff7'], { spread: 3, vx0: -14, vx1: 14, vy0: -18, vy1: 4, g: 0, life0: 700, life1: 1300 });
  }

  function haunt(p, o = {}) { // 死者没有离开：半透明的灵魂留在原地飘着
    if (spirits.some(sp => sp.id === p.id)) return;
    const a = actors.find(x => x.id === p.id);
    spirits.push({ id: p.id, avatar: p.avatar, x: a ? a.x : rand(14, W - 30), born: o.instant ? now() - 2000 : now() + 1800, mode: 'idle' });
  }

  function ghostWhisper(id, targetId, o = {}) { // 飘到那个活人耳边
    const sp = spirits.find(x => x.id === id), b = targetId != null && find(targetId);
    if (!sp || o.instant) return;
    sp.mode = 'whisper'; sp.until = now() + 3200; sp.target = b ? b.x + (b.x > sp.x ? -10 : 10) : sp.x;
    if (b) { face(b, 'surprised', 1200); emote(b, 'sweat', 1400); }
  }

  function ghostGone(id, reason, o = {}) {
    const sp = spirits.find(x => x.id === id);
    if (!sp) return;
    if (o.instant || REDUCED) { spirits = spirits.filter(x => x !== sp); return; }
    sp.mode = 'gone'; sp.end = reason; sp.until = now() + (reason === 'dispersed' ? 0 : 1600);
    if (reason === 'dispersed') { // 魂飞魄散：炸成青色和红色的碎光
      shatter({ x: sp.x, y: -6 }, sprite(sp.avatar, 'idle', 'dead', 'ghost'), now(), {
        vx: x => (x - 6) * rand(2, 5), vy: () => rand(-50, 10), g: 30, l0: 600, l1: 1300, colors: ['#73eff7', '#c9d6e0', '#ff4a4a', '#f4f4f4'],
      });
      flash = { color: '#73eff7', born: now(), life: 350, alpha: 0.3 };
      spirits = spirits.filter(x => x !== sp);
    }
  }

  function updateSpirits(t, dt) {
    for (const sp of spirits) {
      if (sp.mode === 'whisper') {
        const dx = sp.target - sp.x;
        if (Math.abs(dx) > 1) sp.x += Math.sign(dx) * Math.min(Math.abs(dx), 14 * dt / 1000);
        if (t > sp.until) sp.mode = 'idle';
      } else if (sp.mode === 'idle') {
        sp.x = clampX(sp.x + Math.sin(t / 1300 + sp.id) * 2 * dt / 1000);
      }
      if (Math.random() < 0.08) particles.push({ x: sp.x + rand(2, 10), y: GY - 6, vx: rand(-2, 2), vy: rand(-10, -4), g: 0, born: t, life: rand(600, 1000), color: '#73eff7', size: 1 });
    }
    spirits = spirits.filter(sp => !(sp.mode === 'gone' && t > sp.until));
  }

  function drawSpirits(t) {
    for (const sp of spirits) {
      if (t < sp.born) continue; // 等死亡的演出结束才浮现
      const talking = sp.mode === 'whisper' && Math.floor(t / 180) % 2;
      const img = sprite(sp.avatar, 'idle', talking ? 'xtalk' : 'xeyes', 'ghost'); // 死后灵体化：眼睛变成 × ×
      let alpha = Math.min(0.55, (t - sp.born) / 1200 * 0.55) * (0.8 + 0.2 * Math.sin(t / 300));
      let y = GY - img.height - 6 + Math.round(Math.sin(t / 500 + sp.id) * 2);
      if (sp.mode === 'gone') {
        const k = 1 - Math.max(0, sp.until - t) / 1600;
        alpha *= 1 - k;
        if (sp.end === 'freed') y -= Math.round(k * (GY - 4));
      }
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.drawImage(img, Math.round(sp.x), y);
      ctx.fillStyle = '#566c86'; // 拴在地上的锁链
      for (let cy = y + img.height; cy < GY; cy += 2) ctx.fillRect(Math.round(sp.x) + 6 + (cy % 4 ? 1 : 0), cy, 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  function drawThread(t) { // 恋人之间的红线：从一个人的手连到另一个人的手，垂成一道弧
    if (!lovers) return;
    const [a, b] = lovers.map(id => actors.find(x => x.id === id && x.mode !== 'dying' && !x.hidden));
    if (!a || !b) return;
    const [l, r] = a.x < b.x ? [a, b] : [b, a];
    const x0 = Math.round(l.x) + 10, x1 = Math.round(r.x) + 2, y0 = GY - 7 + (l.y || 0), y1 = GY - 7 + (r.y || 0);
    if (x1 <= x0) return;
    ctx.fillStyle = '#e0607a';
    for (let x = x0; x <= x1; x++) {
      const k = (x - x0) / (x1 - x0);
      ctx.fillRect(x, Math.round(y0 + (y1 - y0) * k + Math.sin(k * Math.PI) * 3), 1, 1);
    }
    if (Math.random() < 0.02) emote(Math.random() < 0.5 ? a : b, 'heart', 1200);
  }

  function reset() {
    spirits = []; lovers = null;
    actors = []; markers = []; ghosts = []; particles = []; candles = []; beams = []; flash = null; glow = 0;
    render();
  }

  function addMarker(m) {
    markers.push({ ...m, born: now() });
    while (markers.length > 3) markers.shift();
  }

  // ---------- 每一帧的逻辑 ----------
  function update(t, dt) {
    for (const a of actors) {
      const el = t - (a.t0 || 0);
      switch (a.mode) {
        case 'enter': {
          const k = Math.min(1, 1 - (a.modeUntil - t) / 520);
          a.y = Math.round(-(GY + 4) * (1 - k * k));
          a.pose = 'idle';
          if (t >= a.modeUntil) { a.y = 0; a.mode = 'idle'; face(a, 'surprised', 1000); emote(a, 'excl', 1000); }
          break;
        }
        case 'revive':
          updateRevive(a, t, el);
          break;
        case 'speak':
          a.pose = a.special === 'believer' ? 'kneel' : 'idle'; // 信徒跪着祷告
          a.expr = Math.floor(t / 150) % 2 ? 'talk' : 'normal'; a.exprUntil = t + 50;
          if (t >= a.modeUntil) { a.mode = 'idle'; a.expr = 'normal'; a.wait = rand(300, 900); }
          break;
        case 'think':
          a.pose = 'idle';
          if (t >= a.modeUntil) { a.mode = 'idle'; a.wait = rand(200, 700); }
          break;
        case 'lastwords':
          a.pose = 'kneel';
          if (Math.random() < 0.06) spawnParticles(a.x + 6, GY - 16, 1, ['#f4f4f4', '#94b0c2'], { vx0: -3, vx1: 3, vy0: -14, vy1: -8, g: 0, life0: 1200, life1: 1800 });
          if (t >= a.modeUntil) { a.mode = 'idle'; a.expr = 'normal'; a.wait = 600; }
          break;
        case 'declare':
          if (a.goingToDeclare) {
            if (Math.abs(a.target - a.x) > 1) { a.x += Math.sign(a.target - a.x) * SPEED * 1.6 * dt / 1000; a.pose = Math.floor(t / 150) % 2 ? 'walkA' : 'walkB'; a.dir = Math.sign(a.target - a.x) || 1; break; }
            a.goingToDeclare = false;
          }
          a.pose = 'armsUp'; a.dir = 1;
          if (Math.random() < 0.35) spawnParticles(a.x + 6, GY - 4, 1, ['#ffcd75', '#f4f4f4'], { spread: 7, vx0: -2, vx1: 2, vy0: -26, vy1: -12, g: -4, life0: 900, life1: 1500 });
          if (t >= a.modeUntil) { a.mode = 'idle'; beams = beams.filter(b => b.actor !== a); }
          break;
        case 'cheer':
          a.pose = 'cheer';
          a.y = -Math.round(Math.abs(Math.sin(t / 170)) * 6);
          if (Math.random() < 0.5) spawnParticles(rand(4, W - 4), 0, 1, ['#ffcd75', '#ef7d57', '#73eff7', '#a7f070', '#e0607a', '#f4f4f4'], { vx0: -6, vx1: 6, vy0: 10, vy1: 28, g: 6, life0: 1600, life1: 2600, size: 2 });
          if (t >= a.modeUntil) { a.mode = 'idle'; a.y = 0; }
          break;
        case 'dying':
          updateDying(a, t, el);
          break;
        default: wander(a, t, dt);
      }
      if (a.mode !== 'dying') {
        if (a.exprUntil && t > a.exprUntil && a.mode !== 'speak') a.expr = 'normal';
        if (a.emote && t - a.emote.born > a.emote.dur) a.emote = null;
        // 别叠在一起
        const b = partnerOf(a);
        if (b && a.mode === 'idle' && Math.abs(b.x - a.x) < 12) a.x += (a.x < b.x ? -1 : 1) * 6 * dt / 1000;
      }
    }
    for (const a of actors) { // 地缚灵体质的人身边飘着青色的游丝；通灵者头上偶尔一点紫光
      if (a.mode === 'dying' || a.hidden) continue;
      if (a.special === 'earthbound' && Math.random() < 0.05) particles.push({ x: a.x + rand(0, 12), y: GY - rand(2, 16), vx: rand(-3, 3), vy: rand(-8, -3), g: 0, born: t, life: rand(700, 1100), color: '#73eff7', size: 1 });
      if (a.special === 'medium' && Math.random() < 0.03) particles.push({ x: a.x + 6, y: GY - 18, vx: rand(-4, 4), vy: rand(-8, -2), g: 0, born: t, life: rand(500, 900), color: '#c28cd9', size: 1 });
    }
    updateSpirits(t, dt);
    actors = actors.filter(a => !a.gone);
    ghosts = ghosts.filter(g => t - g.born < g.life);
    particles = particles.filter(p => t - p.born < p.life);
    candles = candles.filter(c => t < c.until);
    markers.forEach(m => { if (m.born == null) m.born = t; });
    if (flash && t - flash.born > flash.life) flash = null;
  }

  function wander(a, t, dt) {
    if (a.wait > 0) {
      a.wait -= dt; a.pose = 'idle';
      if (a.wait <= 0) a.target = null;
    } else {
      if (a.target == null) {
        const b = partnerOf(a);
        let x = rand(10, Math.max(12, W - 22));
        if (b && Math.abs(x - b.x) < 16) x = clampX(b.x + (x < b.x ? -22 : 22));
        a.target = x;
      }
      const dx = a.target - a.x, step = SPEED * dt / 1000;
      if (Math.abs(dx) <= step) {
        a.x = a.target; a.target = null; a.wait = rand(1400, 4200); a.pose = 'idle';
        const b = partnerOf(a);
        if (b && Math.random() < 0.6) a.dir = b.x >= a.x ? 1 : -1;
      } else {
        a.x += Math.sign(dx) * step; a.dir = Math.sign(dx);
        a.pose = Math.floor(t / 200) % 2 ? 'walkA' : 'walkB';
      }
    }
    // 偶尔做点表情
    if (t > a.nextFace) {
      a.nextFace = t + rand(1500, 4200);
      const roll = Math.random();
      if (roll < 0.5) face(a, 'blink', 160);
      else if (roll < 0.62) { face(a, 'happy', 1100); emote(a, pick(['heart', 'note'])); }
      else if (roll < 0.74) { face(a, 'surprised', 900); emote(a, pick(['ques', 'excl'])); }
      else if (roll < 0.84) { face(a, 'sad', 1200); emote(a, 'sweat'); }
      else if (roll < 0.94) { a.dir = -a.dir; a.target = null; a.wait = Math.max(a.wait, 500); }
      else face(a, 'blink', 160);
    }
  }

  // ---------- 复活 ----------
  const REVIVE_TOMB = 900, REVIVE_END = 2500;
  function updateRevive(a, t, el) {
    const fx = a.fx || (a.fx = {});
    a.pose = 'idle';
    if (el < REVIVE_TOMB) { // 光柱里落下金色的光点，一块墓碑从地里冒出来
      a.hidden = true;
      if (Math.random() < 0.5) spawnParticles(a.x + 6 + rand(-5, 5), rand(0, GY - 12), 1, ['#ffcd75', '#f4f4f4'], { vx0: -1, vx1: 1, vy0: 8, vy1: 18, g: 0, life0: 500, life1: 900 });
      return;
    }
    if (!fx.cracked) { // 墓碑碎开：白光一闪，碎石四溅
      fx.cracked = true; a.hidden = false;
      flash = { color: '#f4f4f4', born: t, life: 420, alpha: 0.45 };
      spawnParticles(a.x + 6, GY - 6, 24, ['#94b0c2', '#566c86', '#f4f4f4', '#ffcd75'], { spread: 5, vx0: -32, vx1: 32, vy0: -44, vy1: -8, g: 90, life0: 500, life1: 1100 });
    }
    const k = ease((el - REVIVE_TOMB) / 1200); // 从地里升起来，起初还是灵魂的样子
    a.sink = Math.round(24 * (1 - k));
    a.ghostly = el < REVIVE_TOMB + 1000;
    a.expr = a.ghostly ? 'blink' : 'surprised';
    if (Math.random() < 0.35) spawnParticles(a.x + 6, GY - 4, 1, ['#ffcd75', '#f4f4f4'], { spread: 7, vx0: -2, vx1: 2, vy0: -26, vy1: -10, g: -4, life0: 700, life1: 1300 });
    if (el > REVIVE_END) {
      a.mode = 'idle'; a.sink = 0; a.ghostly = false; a.wingsUntil = t + 1800;
      beams = beams.filter(b => b.actor !== a);
      face(a, 'happy', 1300); emote(a, 'star', 1500);
    }
  }

  // ---------- 死亡的动画（按死因不同） ----------
  function updateDying(a, t, el) {
    const k = a.kind;
    if (k === 'execution') {
      updateExecution(a, t, el);
    } else if (k === 'wrong_guess') {
      a.pose = 'armsUp'; a.expr = 'surprised';
      if (el < 700) a.silhouette = el > 350;
      else if (!a.burst) { // 碎成像素，升上夜空
        a.burst = true; a.hidden = true;
        const img = sprite(a.avatar, 'armsUp', 'surprised', 'white');
        const ctx2 = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          if (ctx2[(y * img.width + x) * 4 + 3] === 0) continue;
          particles.push({ x: a.x + x, y: GY - img.height + y, vx: rand(-14, 14), vy: rand(-46, -10), g: -6, born: t, life: rand(800, 1700), color: pick(['#f4f4f4', '#ffcd75', '#73eff7']), size: 1 });
        }
        beams = beams.filter(b => b.actor !== a);
      }
      if (el > 1800) endDying(a, t);
    } else { // suicide / natural：安静地跪下，灵魂升起
      if (el < 900) { a.pose = 'kneel'; a.expr = 'sad'; }
      else {
        a.pose = 'kneel';
        if (!a.ghosted) { a.ghosted = true; ghosts.push({ x: a.x, y: GY - 16, avatar: a.avatar, born: t, life: 2400, drift: rand(-5, 5) }); }
        a.alpha = Math.max(0, 1 - (el - 900) / 900);
      }
      if (el > 1900) endDying(a, t);
    }
  }
  // ---------- 触发圣言的死：五种“天罚”，每次随机一种 ----------
  const VARIANTS = ['spear', 'hands', 'burst', 'chains', 'rune'];
  const REDS = ['#b13e53', '#ef7d57', '#e0607a', '#5d275d', '#ff4a4a', '#ffcd75'];
  const ease = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const CRACK = (() => { // 裂纹：几条折线，逐像素展开
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
  const SPEAR_HEAD = [[-2, 5, '#ff4a4a'], [-2, 5, '#ef7d57'], [-1, 3, '#ffcd75'], [-1, 3, '#ffcd75'], [0, 1, '#f4f4f4'], [0, 1, '#f4f4f4']];

  function shatter(a, img, t, o) { // 把整个小人拆成一个个像素飞出去
    const d = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    const top = GY - img.height + (a.y || 0);
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (d[(y * img.width + x) * 4 + 3] === 0) continue;
      particles.push({ x: a.x + x, y: top + y, vx: o.vx(x, y), vy: o.vy(x, y), g: o.g, born: t, life: rand(o.l0, o.l1), color: pick(o.colors), size: 1 });
    }
  }

  function updateExecution(a, t, el) {
    const fx = a.fx || (a.fx = {});
    const shake = () => (Math.floor(t / 66) % 2 ? 1 : -1);
    const soul = life => {
      if (fx.soul) return;
      fx.soul = true;
      ghosts.push({ x: a.x, y: GY - 18 + (a.y || 0), avatar: a.avatar, born: t, life, drift: rand(-6, 6) });
    };
    const hit = (alpha, life) => { flash = { color: '#b13e53', born: t, life, alpha }; };
    switch (a.variant) {
      case 'spear': // 红色的神矛从天而降，贯穿身体，把人钉在地上
        if (el < 300) { a.pose = 'idle'; a.expr = 'surprised'; }
        else {
          if (!fx.hit) { fx.hit = true; hit(0.6, 380); spawnParticles(a.x + 6, GY - 12, 18, REDS, { spread: 3, vx0: -28, vx1: 28, vy0: -42, vy1: -6, g: 70, life0: 500, life1: 1000 }); }
          a.expr = 'dead';
          if (el < 900) { a.pose = 'idle'; a.shake = shake(); } else { a.pose = 'kneel'; a.shake = 0; }
        }
        if (el > 1500) { soul(1800); a.alpha = Math.max(0, 1 - (el - 1500) / 500); }
        if (el > 2000 && !fx.dissolve) {
          fx.dissolve = true;
          for (let i = 0; i < 16; i++) particles.push({ x: a.x + 6, y: GY - rand(0, 44), vx: rand(-6, 6), vy: rand(-30, -8), g: -4, born: t, life: rand(600, 1200), color: pick(REDS), size: 1 });
        }
        if (el > 2300) endDying(a, t);
        break;
      case 'hands': // 地底伸出血红色的手，抓住脚踝，把人拖进地里
        a.pose = 'idle';
        a.expr = el < 600 ? 'surprised' : 'dead';
        a.shake = el > 350 ? shake() : 0;
        fx.reach = Math.min(1, el / 500);
        a.sink = el < 600 ? 0 : Math.round(ease((el - 600) / 1100) * 24);
        if (a.sink >= 24) {
          a.hidden = true;
          if (!fx.puff) { fx.puff = true; spawnParticles(a.x + 6, GY, 16, REDS, { spread: 8, vx0: -16, vx1: 16, vy0: -32, vy1: -5, g: 60 }); }
        }
        fx.retract = a.sink >= 24 ? Math.min(1, (el - 1700) / 400) : 0;
        if (el > 2200) endDying(a, t);
        break;
      case 'burst': // 身上裂开发光的红色裂纹，然后炸开
        if (el < 650) {
          a.pose = 'idle'; a.expr = 'dead'; a.shake = shake(); a.redTint = Math.floor(t / 90) % 2 === 0;
          fx.crack = Math.min(1, el / 600);
        } else if (!fx.exploded) {
          fx.exploded = true; a.hidden = true; fx.crack = 0;
          hit(0.7, 450);
          shatter(a, sprite(a.avatar, 'idle', 'dead'), t, {
            vx: x => (x - 6) * rand(3, 6) + rand(-8, 8), vy: () => rand(-70, -5), g: 110, l0: 700, l1: 1500, colors: REDS.concat(['#f4f4f4']),
          });
          spawnParticles(a.x + 6, GY - 10, 16, ['#ff4a4a', '#ffcd75', '#f4f4f4'], { spread: 3, vx0: -50, vx1: 50, vy0: -50, vy1: 0, g: 100, life0: 400, life1: 900 });
          soul(1700);
        }
        if (el > 1800) endDying(a, t);
        break;
      case 'chains': // 红色锁链从天而降缠住身体，把人拽向天空
        if (el < 450) { a.expr = 'surprised'; fx.drop = el / 450; }
        else if (el < 1050) { fx.drop = 1; a.expr = 'dead'; a.shake = shake(); }
        else { fx.drop = 1; a.expr = 'dead'; a.shake = 0; a.y = -Math.round(ease((el - 1050) / 800) * (GY + 30)); }
        if (el > 1850 && !fx.gone) {
          fx.gone = true; a.hidden = true;
          spawnParticles(a.x + 6, 4, 16, REDS, { spread: 6, vx0: -20, vx1: 20, vy0: -6, vy1: 22, g: 40, life0: 500, life1: 1000 });
        }
        if (el > 2100) endDying(a, t);
        break;
      default: // 'rune'：血色法阵从地上浮现，红光把人托起，化作余烬
        fx.rune = Math.min(1, el / 500);
        if (el < 500) { a.pose = 'idle'; a.expr = 'surprised'; }
        else if (el < 1500) {
          a.pose = 'armsUp'; a.expr = el > 1000 ? 'dead' : 'surprised';
          a.y = -Math.round(ease((el - 500) / 900) * 12);
          a.redTint = el > 1100 && Math.floor(t / 100) % 2 === 0;
        } else if (!fx.embers) {
          fx.embers = true; a.hidden = true;
          shatter(a, sprite(a.avatar, 'armsUp', 'dead'), t, {
            vx: () => rand(-10, 10), vy: () => rand(-60, -15), g: -8, l0: 900, l1: 1800, colors: ['#ff4a4a', '#ef7d57', '#ffcd75', '#e0607a'],
          });
          hit(0.35, 400); soul(2000);
        }
        fx.fade = el > 1500 ? Math.max(0, 1 - (el - 1500) / 700) : 1;
        if (el > 2300) endDying(a, t);
    }
  }

  // 天罚的特效：back = 画在人后面（法阵、光柱），front = 画在人前面（矛、手、锁链、裂纹）
  function drawDeathFx(a, t, layer) {
    const fx = a.fx;
    if (!fx || a.kind !== 'execution') return;
    const el = t - a.t0, cx = Math.round(a.x) + 6;
    const top = GY - 20 + (a.y || 0);
    if (layer === 'back' && a.variant === 'rune') {
      ctx.globalAlpha = fx.rune * (fx.fade != null ? fx.fade : 1);
      for (let i = 0; i < 48; i++) {
        if (i % 3 === 0) continue;
        const ang = i / 48 * Math.PI * 2 + t / 700;
        ctx.fillStyle = '#e0607a';
        ctx.fillRect(Math.round(cx + Math.cos(ang) * 17), Math.round(GY - 1 + Math.sin(ang) * 3), 1, 1);
      }
      for (let i = 0; i < 30; i++) {
        if (i % 2 === 0) continue;
        const ang = -i / 30 * Math.PI * 2 - t / 500;
        ctx.fillStyle = '#b13e53';
        ctx.fillRect(Math.round(cx + Math.cos(ang) * 11), Math.round(GY - 1 + Math.sin(ang) * 2), 1, 1);
      }
      ctx.fillStyle = '#ffcd75'; // 六个符文
      for (let i = 0; i < 6; i++) {
        const ang = i / 6 * Math.PI * 2 + t / 900;
        ctx.fillRect(Math.round(cx + Math.cos(ang) * 14), Math.round(GY - 2 + Math.sin(ang) * 3), 2, 2);
      }
      if (el >= 500 && !fx.embers) {
        const flick = Math.floor(t / 90) % 2;
        ctx.fillStyle = 'rgba(224, 96, 122, .2)'; ctx.fillRect(cx - 9, 0, 18, GY);
        ctx.fillStyle = `rgba(255, 120, 120, ${flick ? 0.32 : 0.24})`; ctx.fillRect(cx - 4, 0, 8, GY);
      }
      ctx.globalAlpha = 1;
    }
    if (layer !== 'front') return;
    if (a.variant === 'spear' && el <= 2000) {
      const tipY = el < 300 ? Math.round(-46 + (GY + 46) * (el / 300)) : GY, len = 46;
      if (el < 300) { ctx.fillStyle = 'rgba(255, 74, 74, .3)'; ctx.fillRect(cx - 2, tipY - len - 12, 5, 12 + len); } // 拖尾
      ctx.fillStyle = '#7a1e30'; ctx.fillRect(cx - 1, tipY - len, 3, len);
      ctx.fillStyle = '#b13e53'; ctx.fillRect(cx - 1, tipY - len, 1, len);
      ctx.fillStyle = '#ef7d57'; ctx.fillRect(cx, tipY - len, 1, len);
      ctx.fillStyle = '#ffcd75';
      for (let y = tipY - len + 3; y < tipY - 10; y += 9) ctx.fillRect(cx - 1, y, 3, 1);
      SPEAR_HEAD.forEach(([dx, w, color], i) => { ctx.fillStyle = color; ctx.fillRect(cx + dx, tipY - 6 + i, w, 1); }); // 矛头，尖朝下
    }
    if (a.variant === 'hands') {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, GY); ctx.clip();
      ctx.fillStyle = `rgba(177, 62, 83, ${0.4 + 0.15 * (Math.floor(t / 100) % 2)})`; ctx.fillRect(cx - 14, GY - 1, 28, 2);
      [-7, 0, 7].forEach((dx, i) => {
        const x = cx + dx + (i === 1 ? 0 : (Math.floor(t / 120) % 2) * (i - 1)); // 抓得发抖
        const H = Math.round(12 * fx.reach) - Math.round((fx.retract || 0) * 14) - Math.round((a.sink || 0) * 0.45);
        if (H <= 0) return;
        const y = GY - H;
        ctx.fillStyle = '#7a1e30'; ctx.fillRect(x - 1, y, 3, H);
        ctx.fillStyle = '#b13e53'; ctx.fillRect(x - 1, y, 1, H);
        ctx.fillRect(x - 2, y - 3, 5, 3); // 手掌
        ctx.fillStyle = '#ef7d57'; ctx.fillRect(x - 2, y - 5, 1, 2); ctx.fillRect(x, y - 6, 1, 3); ctx.fillRect(x + 2, y - 5, 1, 2); // 手指
      });
      ctx.restore();
    }
    if (a.variant === 'chains') {
      const x0 = Math.round(a.x) + (a.shake || 0), chest = top + 11;
      const end = el < 450 ? Math.round(chest * fx.drop) : chest;
      [x0 + 2, x0 + 9].forEach(x => {
        for (let y = 0; y < end; y += 3) {
          const odd = Math.floor(y / 3) % 2;
          ctx.fillStyle = odd ? '#8a1f35' : '#e0607a';
          ctx.fillRect(x + odd, y, 2, 2);
        }
      });
      if (fx.drop >= 1 && !fx.gone) { // 缠在身上的两道锁链
        ctx.fillStyle = '#b13e53'; ctx.fillRect(x0 - 1, chest, 14, 2); ctx.fillRect(x0 - 1, chest + 5, 14, 2);
        ctx.fillStyle = '#e0607a';
        for (let x = x0; x < x0 + 13; x += 3) { ctx.fillRect(x, chest, 1, 2); ctx.fillRect(x + 1, chest + 5, 1, 2); }
      }
    }
    if (a.variant === 'burst' && fx.crack) { // 裂纹：红色里闪着白光
      const n = Math.floor(fx.crack * CRACK.length), x0 = Math.round(a.x) + (a.shake || 0);
      for (let i = 0; i < n; i++) {
        const [px, py] = CRACK[i];
        ctx.fillStyle = Math.floor(t / 80 + i) % 3 === 0 ? '#f4f4f4' : '#ff4a4a';
        ctx.fillRect(x0 + px, GY - 20 + py, 1, 1);
      }
    }
  }

  function endDying(a, t) {
    a.gone = true;
    addMarker(a.marker);
    spawnParticles(a.marker.x + 6, GY - 4, 8, ['#94b0c2', '#566c86', '#f4f4f4'], { spread: 6, vx0: -8, vx1: 8, vy0: -18, vy1: -6, g: 30, life0: 400, life1: 800 });
  }

  // ---------- 绘制 ----------
  function blit(img, x, y, flip, alpha) {
    if (alpha != null && alpha < 1) ctx.globalAlpha = Math.max(0, alpha);
    if (flip) {
      ctx.save(); ctx.translate(x + img.width, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore();
    } else ctx.drawImage(img, x, y);
    ctx.globalAlpha = 1;
  }

  // 天上的“环境之眼”：平时半闭着，环境发言时睁开、发出金光，瞳孔看向刚说话的人
  const EYE = [
    '....kkkkkkk....',
    '..kkwwwwwwwkk..',
    '.kwwwwwwwwwwwk.',
    'kwwwwwwwwwwwwwk',
    '.kwwwwwwwwwwwk.',
    '..kkwwwwwwwkk..',
    '....kkkkkkk....',
  ];
  function drawEye(t) {
    const cx = Math.round(W * 0.5) - 7, cy = 3, open = t < eyeUntil;
    ctx.globalAlpha = open ? 1 : 0.7;
    if (open) { // 一圈金光
      ctx.fillStyle = '#ffcd75';
      for (let i = 0; i < 16; i++) {
        const ang = i / 16 * Math.PI * 2 + t / 900;
        ctx.fillRect(Math.round(cx + 7 + Math.cos(ang) * 11), Math.round(cy + 3 + Math.sin(ang) * 6), 1, 1);
      }
    }
    EYE.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        ctx.fillStyle = ch === 'k' ? '#1a1c2c' : (!open && (y === 1 || y === 2 || y === 4) ? '#333c57' : '#f4f4f4'); // 眼睑
        ctx.fillRect(cx + x, cy + y, 1, 1);
      }
    });
    const look = Math.max(-3, Math.min(3, Math.round((eyeLook - W / 2) / (W / 8))));
    ctx.fillStyle = open ? '#ef7d57' : '#8a5a3c'; ctx.fillRect(cx + 6 + look, cy + 2, 3, 3);
    ctx.fillStyle = '#1a1c2c'; ctx.fillRect(cx + 7 + look, cy + 3, 1, 1);
    ctx.globalAlpha = 1;
  }

  function drawBeams(t) {
    for (const b of beams) {
      const a = b.actor, x = Math.round(a.x) + 6;
      const flick = Math.floor(t / 90) % 2;
      ctx.fillStyle = 'rgba(255, 205, 117, .16)'; ctx.fillRect(x - 9, 0, 18, GY);
      ctx.fillStyle = `rgba(255, 244, 200, ${flick ? .3 : .22})`; ctx.fillRect(x - 5, 0, 10, GY);
      ctx.fillStyle = 'rgba(255, 255, 255, .45)'; ctx.fillRect(x - 1, 0, 2, GY);
    }
  }

  function drawCandles(t) {
    for (const c of candles) {
      const x = Math.round(c.x), y = GY - 12;
      const fade = Math.min(1, (c.until - t) / 600);
      ctx.fillStyle = `rgba(255, 205, 117, ${0.1 * fade})`;
      for (let r = 12; r > 4; r -= 4) { ctx.beginPath(); ctx.arc(x + 6, y + 3, r, 0, Math.PI * 2); ctx.fill(); }
      blit(bitmap('candle'), x, y, false, fade);
      if (Math.floor(t / 120) % 3 === 0) { ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x + 5 + (Math.floor(t / 240) % 2), y, 1, 1); }
    }
  }

  // 猫娘的尾巴：从屁股后面伸出来，弯上去，尖儿是白的，一摇一摇
  const TAIL = [[-1, 0], [-2, 0], [-3, -1], [-4, -2], [-4, -3], [-4, -4], [-3, -5]];
  function drawTail(a, t, x, y) {
    const back = a.dir < 0 ? 1 : -1; // 尾巴在背后：往右走时在左边
    const wag = Math.floor(t / 260) % 2;
    const bx = back < 0 ? x + 1 : x + 10, by = y + 14;
    TAIL.forEach(([dx, dy], i) => {
      ctx.fillStyle = i === TAIL.length - 1 ? '#f4f4f4' : '#ef7d57';
      const sway = i >= 4 ? wag * -back : 0;
      ctx.fillRect(bx + back * -dx + sway, by + dy, 1, 1);
    });
  }

  // 复活的人：头顶的光环；刚复活时身边还展开一对翅膀
  function drawHalo(t, x, y) {
    ctx.fillStyle = Math.floor(t / 400) % 2 ? '#ffcd75' : '#fff1c9';
    ctx.fillRect(x + 3, y - 4, 6, 1); ctx.fillRect(x + 3, y - 2, 6, 1);
    ctx.fillRect(x + 2, y - 3, 1, 1); ctx.fillRect(x + 9, y - 3, 1, 1);
  }
  function drawWings(t, x, y) {
    const up = Math.floor(t / 150) % 2;
    [[-1, x - 1], [1, x + 12]].forEach(([side, wx]) => {
      for (let i = 0; i < 4; i++) { // 四根羽毛，越往外越短；扇动时整体抬高一格
        const h = 6 - i, fy = y + 10 - up - (3 - i);
        ctx.fillStyle = i === 3 ? '#94b0c2' : '#f4f4f4';
        ctx.fillRect(wx + side * i, fy, 1, h);
      }
    });
  }

  function drawActor(a, t) {
    if (a.mode === 'revive' && a.hidden) { // 复活的第一幕：墓碑从地里冒出来
      const rise = Math.max(0, 11 - Math.floor((t - a.t0) / 50));
      blit(bitmap('tomb'), Math.round(a.x), GY - 11 + rise, false, 0.9);
      return;
    }
    if (a.hidden) return;
    const kind = a.silhouette ? 'white' : a.redTint ? 'red' : a.ghostly ? 'ghost' : undefined;
    const img = sprite(a.avatar, a.pose, a.expr, kind);
    const x = Math.round(a.x) + (a.shake || 0);
    const flip = a.dir < 0;
    const alpha = a.alpha != null ? a.alpha : 1;
    const top = GY - img.height + (a.y || 0) + (a.sink || 0);
    if (a.special === 'catgirl' && a.mode !== 'dying' && !a.sink) drawTail(a, t, x, top);
    if ((a.mode === 'revive' && !a.hidden) || t < (a.wingsUntil || 0)) drawWings(t, x, top);
    if (!a.sink && a.y > -40) { // 影子
      ctx.fillStyle = 'rgba(26, 28, 44, .6)';
      const wide = a.y < -2 ? 4 : 8;
      ctx.fillRect(x + 6 - wide / 2, GY, wide, 1);
    }
    const y = GY - img.height + (a.y || 0) + (a.sink || 0);
    if (a.sink) { // 被拖进地里：地平线以下的部分不画
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, GY + 1); ctx.clip();
      blit(img, x, y, flip, alpha);
      ctx.restore();
    } else blit(img, x, y, flip, alpha);
    if (a.special === 'revived' && a.mode !== 'dying' && !a.ghostly && !a.sink) drawHalo(t, x, y);
    if (a.emote) {
      const e = a.emote, k = (t - e.born) / e.dur;
      const ic = icon(e.name);
      const ey = GY - img.height + (a.y || 0) - 8 - Math.round(k * 4);
      ctx.globalAlpha = k > 0.75 ? 1 - (k - 0.75) * 4 : 1;
      ctx.drawImage(ic, x + (flip ? 0 : 6), ey);
      ctx.globalAlpha = 1;
    }
  }

  function drawMarkers(t) {
    markers.forEach((m, i) => {
      const x = Math.round(Math.min(m.x, W - 16));
      const age = t - (m.born || t);
      const rise = Math.max(0, 6 - Math.floor(age / 60)); // 从地里冒出来
      blit(bitmap(m.kind), x, GY - 11 + rise, false, 0.55 + 0.15 * i);
    });
  }

  function drawGhosts(t) {
    ghosts.forEach(g => {
      const k = (t - g.born) / g.life;
      if (k < 0) return;
      const img = sprite(g.avatar, 'idle', 'normal', 'ghost');
      const y = Math.round(g.y - k * (GY - 8));
      const x = Math.round(g.x + Math.sin(k * 9) * 3 + g.drift * k);
      ctx.globalAlpha = Math.max(0, 0.7 * (1 - k * k));
      ctx.drawImage(img, x, y);
      ctx.globalAlpha = 1;
    });
  }

  function drawParticles(t) {
    particles.forEach(p => {
      const s = (t - p.born) / 1000;
      const x = Math.round(p.x + p.vx * s), y = Math.round(p.y + p.vy * s + 0.5 * p.g * s * s);
      ctx.globalAlpha = Math.max(0, 1 - (t - p.born) / p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, p.size, p.size);
    });
    ctx.globalAlpha = 1;
  }

  function render(t = now()) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bg, 0, 0);
    if (t < glow) { // 通关：夜空泛起金光
      const k = Math.min(1, (glow - t) / 1500);
      ctx.fillStyle = `rgba(255, 205, 117, ${0.22 * k})`; ctx.fillRect(0, 0, W, GY);
    }
    drawStars(t);
    drawEye(t);
    drawBeams(t);
    drawMarkers(t);
    drawCandles(t);
    drawGhosts(t);
    drawSpirits(t);
    actors.forEach(a => drawDeathFx(a, t, 'back'));
    drawThread(t);
    [...actors].sort((a, b) => a.x - b.x).forEach(a => drawActor(a, t));
    actors.forEach(a => drawDeathFx(a, t, 'front'));
    drawParticles(t);
    if (flash) {
      ctx.globalAlpha = flash.alpha * Math.max(0, 1 - (t - flash.born) / flash.life);
      ctx.fillStyle = flash.color; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 主循环 ----------
  function frame(t) {
    requestAnimationFrame(frame);
    if (t - last < FRAME_MS) return;
    const dt = Math.min(200, t - (last || t));
    last = t;
    update(now(), dt);
    render(now());
  }

  function fitStage() {
    const { width, height } = stageEl.getBoundingClientRect();
    if (!width || !height) return;
    const s = Math.max(1, Math.round(height / BASE_H));
    W = canvas.width = Math.ceil(width / s);
    H = canvas.height = Math.ceil(height / s);
    GY = H - 8;
    paintBackground();
    actors.forEach(a => { a.x = clampX(a.x); a.target = null; });
    markers.forEach(m => { m.x = Math.min(m.x, W - 16); });
    render();
  }

  new ResizeObserver(fitStage).observe(stageEl);
  fitStage();
  if (!REDUCED) requestAnimationFrame(frame);

  global.HungerStage = {
    VARIANTS, fitStage, spawn, introduce, say, think, envSay, lastWords, declare, die, victory, reset,
    lovers: setLovers, vision, haunt, ghostWhisper, ghostGone,
    _debug: () => ({ actors: actors.map(a => ({ id: a.id, mode: a.mode, x: Math.round(a.x), y: a.y, pose: a.pose, expr: a.expr,
      hidden: !!a.hidden, alpha: a.alpha, sink: a.sink || 0, special: a.special })), markers: markers.length, ghosts: ghosts.length, W, H }),
  };
})(window);
