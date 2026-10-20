/* 观众投票：点对话区里选手的头像，头像上弹出 👍 / 👎；头像下面挂着这个人的「👍几 👎几」，所有观众看到的都一样。
 * 每位观众对每位选手只有一票（可以改，再点一次同一个就是撤回），只有在场的选手能投；死亡时计数封存进墓碑（record.votes）。
 *   HungerVotes.init({ live, viewer, toast })
 *   HungerVotes.attach(avatarEl, pid, name)   // 给对话区里的头像加上点击投票，返回挂在头像下面的计数
 *   HungerVotes.update({ pid: { up, down } }) // 后端推来的计数（只含在场的选手）
 *   HungerVotes.setMine({ pid: 1 | -1 })      // 这位观众自己投过的票（刚连上时从 /api/votes 读）
 *   HungerVotes.freeze(record)                // 死亡 / 胜利：之后不能再投，计数以 record.votes 为准
 *   HungerVotes.tally(pid) / HungerVotes.badge(votes)   // 墓园、人物生平里用
 * 每有人新投一票（自己的，或别的观众推过来的），屏幕左下角和右下角各飘起几个 👍 / 👎，越飘越淡，直到消失。
 * 演示模式（没有后端）下只在本页记票。 */
(function (global) {
  'use strict';

  const tallies = new Map(); // pid -> { up, down }
  const mine = new Map();    // pid -> 1 | -1
  const frozen = new Set();  // 已经离场的选手
  let opts = { live: false, viewer: '', toast: () => {} };

  const pop = document.createElement('div');
  pop.className = 'vote-pop px-box';
  pop.hidden = true;
  pop.innerHTML =
    '<button type="button" class="vbtn up" data-vote="1" aria-label="点赞"><span class="sprite" data-sprite="thumbUp"></span></button>' +
    '<button type="button" class="vbtn down" data-vote="-1" aria-label="点踩"><span class="sprite" data-sprite="thumbDown"></span></button>';
  let popFor = null; // { pid, name, anchor }

  const tally = pid => tallies.get(pid) || { up: 0, down: 0 };

  // ---------- 飘起来的拇指 ----------
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PER_CORNER = 3;  // 每一票，每个角飘几个
  const MAX_FLOATS = 48; // 同时最多这么多个，票多的时候不至于卡
  let quietUntil = 0;    // 刚打开页面时收到的是已有的票，不算“有人刚投”
  const layer = document.createElement('div');
  layer.className = 'vote-floats';
  layer.setAttribute('aria-hidden', 'true');
  const rand = (a, b) => a + Math.random() * (b - a);

  function float(kind, votes = 1) {
    if (REDUCED || document.hidden || performance.now() < quietUntil) return;
    const n = Math.min(votes, 4) * PER_CORNER;
    for (let i = 0; i < n; i++) {
      for (const side of ['left', 'right']) {
        if (layer.childElementCount >= MAX_FLOATS) return;
        const el = document.createElement('span');
        el.className = `vote-float ${kind}`;
        el.innerHTML = Sprites.svg(kind === 'up' ? 'thumbUp' : 'thumbDown');
        el.style[side] = `${Math.round(rand(2, 12))}%`;
        layer.append(el);
        const rise = innerHeight * rand(0.45, 0.8);
        const drift = (side === 'left' ? 1 : -1) * rand(10, 70); // 往屏幕中间飘一点
        const sway = rand(10, 24) * (Math.random() < 0.5 ? 1 : -1);
        const tilt = rand(-18, 18);
        el.animate([
          { transform: `translate(0, 0) rotate(${tilt}deg) scale(.6)`, opacity: 0 },
          { transform: `translate(${sway * 0.5}px, ${-rise * 0.12}px) rotate(${-tilt}deg) scale(1)`, opacity: 1, offset: 0.1 },
          { transform: `translate(${drift * 0.5 - sway}px, ${-rise * 0.5}px) rotate(${tilt}deg)`, opacity: 0.75, offset: 0.5 },
          { transform: `translate(${drift}px, ${-rise}px) rotate(${-tilt}deg) scale(.9)`, opacity: 0 },
        ], { duration: rand(2200, 3400), delay: i * 140 + rand(0, 120), easing: 'ease-out', fill: 'backwards' })
          .finished.then(() => el.remove(), () => el.remove());
      }
    }
  }

  // 计数从 old 变成 v：多出来的票才飘（撤回、改票减少的那一边不飘）
  function floatDelta(old, v) {
    if (v.up > old.up) float('up', v.up - old.up);
    if (v.down > old.down) float('down', v.down - old.down);
  }

  // 「👍3 👎1」：像素拇指 + 数字
  function badge(votes, cls) {
    const v = votes || { up: 0, down: 0 };
    const el = document.createElement('span');
    el.className = 'vote-tally' + (cls ? ' ' + cls : '');
    el.innerHTML = '<span class="vt up"><span class="sprite" data-sprite="thumbUp"></span><b></b></span>' +
      '<span class="vt down"><span class="sprite" data-sprite="thumbDown"></span><b></b></span>';
    fill(el, v);
    Sprites.mount(el);
    return el;
  }

  function fill(el, v) {
    const [up, down] = el.querySelectorAll('b');
    up.textContent = v.up;
    down.textContent = v.down;
    el.classList.toggle('zero', !v.up && !v.down);
  }

  function render(pid, bump) {
    const v = tally(pid), m = mine.get(pid) || 0;
    document.querySelectorAll(`.vote-tally[data-pid="${pid}"]`).forEach(el => {
      fill(el, v);
      el.classList.toggle('mine-up', m > 0);
      el.classList.toggle('mine-down', m < 0);
      if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    });
    if (popFor && popFor.pid === pid) paintPop();
  }

  function attach(avatarEl, pid, name) {
    if (pid == null) return null;
    const t = badge(tally(pid));
    t.dataset.pid = pid;
    avatarEl.classList.add('votable');
    avatarEl.setAttribute('role', 'button');
    avatarEl.tabIndex = 0;
    avatarEl.title = `给「${name}」点赞 / 点踩`;
    const open = e => { e.stopPropagation(); openPop(avatarEl, pid, name); };
    avatarEl.addEventListener('click', open);
    avatarEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    queueMicrotask(() => render(pid)); // 挂进页面之后，把“自己投过哪一个”也标上
    return t;
  }

  // ---------- 弹出的两个按钮 ----------
  function paintPop() {
    const m = mine.get(popFor.pid) || 0;
    pop.querySelector('.up').classList.toggle('on', m > 0);
    pop.querySelector('.down').classList.toggle('on', m < 0);
  }

  function place() {
    const r = popFor.anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 10 > 8 ? r.top - h - 10 : r.bottom + 10; // 头像上方放不下就放下面
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  }

  function openPop(anchor, pid, name) {
    if (frozen.has(pid)) { opts.toast(`「${name}」已经离开了舞台，评价已封存`); return; }
    if (popFor && popFor.pid === pid && popFor.anchor === anchor && !pop.hidden) { closePop(); return; }
    popFor = { pid, name, anchor };
    pop.hidden = false;
    paintPop();
    place();
    pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show');
  }

  function closePop() {
    pop.hidden = true;
    popFor = null;
  }

  async function cast(pid, vote) {
    const before = mine.get(pid) || 0;
    const next = before === vote ? 0 : vote; // 再点一次同一个：撤回
    const old = { ...tally(pid) };
    // 先在本页改好（乐观更新），失败了再改回来
    const v = { ...old };
    if (before > 0) v.up--; else if (before < 0) v.down--;
    if (next > 0) v.up++; else if (next < 0) v.down++;
    tallies.set(pid, v);
    if (next) mine.set(pid, next); else mine.delete(pid);
    render(pid, true);
    floatDelta(old, v);
    if (!opts.live) return;
    try {
      const r = await fetch('/api/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: pid, vote: next, viewer: opts.viewer }),
      });
      if (!r.ok) {
        tallies.set(pid, old);
        if (before) mine.set(pid, before); else mine.delete(pid);
        if (r.status === 409) frozen.add(pid);
        opts.toast(r.status === 409 ? '他已经离开了舞台，评价已封存' : r.status === 429 ? '这个网络里投票的人太多了' : '投票失败，请稍后再试');
        render(pid);
        return;
      }
      const d = await r.json();
      tallies.set(pid, { up: d.up, down: d.down });
      render(pid);
    } catch (e) {
      tallies.set(pid, old);
      if (before) mine.set(pid, before); else mine.delete(pid);
      opts.toast('网络不通，投票没有送出去');
      render(pid);
    }
  }

  pop.addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.target.closest('.vbtn');
    if (!btn || !popFor) return;
    const { pid } = popFor;
    cast(pid, Number(btn.dataset.vote));
    setTimeout(closePop, 260);
  });
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !(popFor && popFor.anchor.contains(e.target))) closePop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) closePop(); });
  addEventListener('resize', () => { if (!pop.hidden) closePop(); });

  // ---------- 外部 ----------
  function update(map) {
    Object.entries(map || {}).forEach(([pid, v]) => {
      pid = Number(pid);
      if (frozen.has(pid)) return;
      const old = tally(pid);
      if (old.up === v.up && old.down === v.down) return;
      tallies.set(pid, { up: v.up, down: v.down });
      render(pid, true);
      floatDelta(old, v);
    });
  }

  function setMine(map) {
    Object.entries(map || {}).forEach(([pid, v]) => { mine.set(Number(pid), v); render(Number(pid)); });
  }

  // 死亡 / 胜利：以后不能再投；没有 votes 的老记录（或演示模式）用本页最后看到的计数补上
  function freeze(record) {
    const pid = record.id;
    if (!record.votes) record.votes = { ...tally(pid) };
    tallies.set(pid, { up: record.votes.up, down: record.votes.down });
    frozen.add(pid);
    if (popFor && popFor.pid === pid) closePop();
    render(pid);
    document.querySelectorAll(`.vote-tally[data-pid="${pid}"]`).forEach(el => el.classList.add('sealed'));
  }

  function init(o) {
    opts = { ...opts, ...o };
    quietUntil = performance.now() + 2500;
    document.body.append(pop, layer);
    Sprites.mount(pop);
    const chat = document.getElementById('chat');
    // 新消息会把对话区往下推：按钮跟着头像走，头像滚出视野才收起
    if (chat) chat.addEventListener('scroll', () => {
      if (pop.hidden) return;
      const a = popFor.anchor.getBoundingClientRect(), c = chat.getBoundingClientRect();
      if (!popFor.anchor.isConnected || a.bottom < c.top || a.top > c.bottom) closePop(); else place();
    }, { passive: true });
  }

  global.HungerVotes = { init, attach, update, setMine, freeze, tally, badge };
})(window);
