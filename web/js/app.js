/* 界面逻辑：对话气泡（打字机效果）、占位按钮、演出区占位画面。
 * 之后接后端时调用 HungerUI.addMessage(speakerId, text) 即可。 */
(function (global) {
  'use strict';

  // 说话者：side 决定头像在左还是右。新增选手只需在这里加一项，并在 style.css 里加配色
  const SPEAKERS = {
    env: { id: 'env', name: '环境', side: 'left', sprite: 'eye' },
    a: { id: 'a', name: '选手A', side: 'right', sprite: 'robotA' },
    b: { id: 'b', name: '选手B', side: 'right', sprite: 'robotB' },
  };

  const params = new URLSearchParams(location.search);
  const INSTANT = params.has('instant'); // 跳过打字机效果和入场动画（调试 / 截图用）
  if (INSTANT) document.documentElement.classList.add('instant');
  const chat = document.getElementById('chat');
  const toastEl = document.getElementById('toast');

  // ---------- 对话 ----------
  const queue = [];
  let busy = false;
  let skipTyping = false;

  function buildMessage(sp) {
    const el = document.createElement('article');
    el.className = `msg ${sp.side} sp-${sp.id}`;
    el.innerHTML =
      `<div class="avatar px-box"><span class="sprite" data-sprite="${sp.sprite}"></span></div>` +
      '<div class="bubble px-box"><div class="name"></div><p class="text"></p></div>';
    el.querySelector('.name').textContent = sp.name; // 用 textContent：以后这里会放 LLM 生成的文本
    Sprites.mount(el);
    return el;
  }

  function typeInto(el, text, done) {
    const chars = Array.from(text);
    let i = 0;
    const step = () => {
      if (skipTyping) i = chars.length; else i++;
      el.textContent = chars.slice(0, i).join('');
      chat.scrollTop = chat.scrollHeight;
      if (i >= chars.length) return done();
      setTimeout(step, '，。！？、…,.!?'.includes(chars[i - 1]) ? 160 : 32);
    };
    step();
  }

  function next() {
    const item = queue.shift();
    if (!item) { busy = false; return; }
    busy = true;
    skipTyping = INSTANT;
    const sp = SPEAKERS[item.speakerId];
    if (!sp) { console.warn('[ui] unknown speaker:', item.speakerId); return next(); }
    const el = buildMessage(sp);
    el.classList.add('typing');
    chat.appendChild(el);
    typeInto(el.querySelector('.text'), item.text, () => {
      el.classList.remove('typing');
      setTimeout(next, INSTANT ? 0 : 500);
    });
  }

  function addMessage(speakerId, text) {
    queue.push({ speakerId, text });
    if (!busy) next();
  }

  function clear() {
    queue.length = 0;
    chat.replaceChildren();
  }

  chat.addEventListener('click', () => { skipTyping = true; }); // 点一下直接显示整句

  // ---------- 占位按钮 ----------
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1600);
  }

  document.querySelectorAll('.px-btn').forEach(btn => {
    btn.addEventListener('click', () => toast(`${btn.querySelector('.label').textContent}：敬请期待`));
  });

  // ---------- 演出区占位画面 ----------
  // canvas 的逻辑分辨率跟随容器：取整数放大倍数 s，逻辑尺寸 = 容器尺寸 / s，
  // 这样不管手机还是电脑，像素都是整数倍放大、不会被拉伸或裁切。
  const stageEl = document.querySelector('.stage');
  const canvas = document.getElementById('stage-canvas');
  const ctx = canvas.getContext('2d');
  const BASE_H = 68; // 期望的逻辑高度，决定放大倍数
  const SKY = ['#1a1c2c', '#29366f', '#3b5dc9'];
  let W = canvas.width, H = canvas.height;

  function drawStage(t) {
    const bandH = H / 3;
    const gy = H - 8; // 地平线
    // 天空：三段色带，交界处用棋盘点阵过渡
    for (let y = 0; y < H; y++) {
      const band = Math.min(2, Math.floor(y / bandH));
      const blend = band > 0 && y - band * bandH < 2;
      for (let x = 0; x < W; x++) {
        ctx.fillStyle = SKY[blend && (x + y) % 2 === 0 ? band - 1 : band];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // 星星闪烁
    for (let i = 0; i < Math.floor(W / 14); i++) {
      ctx.fillStyle = (Math.floor(t / 500) + i) % 3 === 0 ? '#566c86' : '#f4f4f4';
      ctx.fillRect((i * 53 + 7) % W, (i * 29 + 5) % Math.max(1, gy - 14), 1, 1);
    }
    // 月亮
    const mx = W - 24, my = Math.round(H * 0.25), R = 6;
    ctx.fillStyle = '#f4f4f4';
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) ctx.fillRect(mx + dx, my + dy, 1, 1);
    }
    ctx.fillStyle = '#94b0c2';
    ctx.fillRect(mx - 3, my - 2, 2, 2);
    ctx.fillRect(mx + 1, my + 2, 2, 1);
    // 城市剪影
    for (let i = 0; i < Math.ceil(W / 8); i++) {
      const h = Math.max(6, 8 + ((i * 37) % 5) * 4 + Math.round((H - BASE_H) * 0.2));
      const x = i * 8;
      ctx.fillStyle = '#333c57';
      ctx.fillRect(x, gy - h, 7, h);
      ctx.fillStyle = '#ffcd75';
      for (let wy = gy - h + 3; wy < gy - 3; wy += 5) {
        if (((i + wy) * 7) % 3 === 0) ctx.fillRect(x + 2, wy, 1, 2);
      }
    }
    // 地面
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, gy, W, H - gy);
    ctx.fillStyle = '#38b764';
    for (let x = 0; x < W; x += 2) ctx.fillRect(x, gy, 1, 1);
  }

  function fitStage() {
    const { width, height } = stageEl.getBoundingClientRect();
    if (!width || !height) return;
    const s = Math.max(1, Math.round(height / BASE_H));
    W = canvas.width = Math.ceil(width / s);
    H = canvas.height = Math.ceil(height / s);
    drawStage(performance.now());
  }

  new ResizeObserver(fitStage).observe(stageEl);
  fitStage();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(() => drawStage(performance.now()), 500);
  }

  // ---------- 启动 ----------
  Sprites.mount(document);

  const DEMO = [
    ['env', '两位选手面对面坐下，节目开始了。'],
    ['a', '你好啊，看起来你今天状态不错，不过在这种节目里，开场太有精神反而容易后劲不足呢。'],
    ['b', '谢谢关心，不过我觉得保存体力的人才更容易后劲不足吧？倒是你看起来有点紧张呢。'],
    ['env', '场内的温度突然下降了几度，两人的呼吸开始凝成白雾。A 的手边多出一盏冒着热气的汤碗。'],
    ['a', '紧张？我只是在观察你。毕竟嘴上说着保存体力的人，往往最先撑不住。'],
    ['b', '那碗汤放在你那边都快凉了，还是说你不敢喝？'],
  ];
  if (!params.has('empty')) DEMO.forEach(([id, text]) => addMessage(id, text));

  global.HungerUI = { addMessage, clear, toast, SPEAKERS };
})(window);
