/* 演出区占位画面。canvas 的逻辑分辨率跟随容器：取整数放大倍数 s，逻辑尺寸 = 容器尺寸 / s，
 * 这样不管手机还是电脑，像素都是整数倍放大、不会被拉伸或裁切。之后换成 sprite 演出时改 drawStage。 */
(function (global) {
  'use strict';

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

  global.HungerStage = { fitStage };
})(window);
