/* 观众投票：点对话区里选手说的某一句话（或他的头像），弹出 👍 / 👎。每位观众对每一句话各有一票（可以改，再点一次
 * 同一个就是撤回），所以观众不多，一个人也能给好几句话点赞。那句话的角上挂着它自己的票数；头像下面是这个人所有句子加起来的
 * 「👍几 👎几」，所有观众看到的都一样。死去的选手也照样能投（墓园、人气之星、复活人选都跟着变）；票存在服务器上，重启也在。
 *   HungerVotes.init({ live, viewer, toast })
 *   HungerVotes.attach(avatarEl, bubbleEl, pid, mid, name)   // 给一句话（和它旁边的头像）加上点击投票，返回挂在头像下面的总计数
 *   HungerVotes.update({ players: { pid: { up, down } }, messages: { mid: { up, down } } })   // 后端推来的计数
 *   HungerVotes.setMine({ mid: 1 | -1 })      // 这位观众自己投过哪几句（刚连上时从 /api/votes 读）
 *   HungerVotes.fromRecord(record)            // 死亡 / 胜利的那一刻：用墓碑上的计数补上本页还没有的数（之后照样能投）
 *   HungerVotes.tally(pid) / HungerVotes.badge(votes)   // 墓园、人物生平里用
 * 每有人新投一票（自己的，或别的观众推过来的），屏幕左下角和右下角各飘起几个 👍 / 👎，越飘越淡，直到消失。
 * 演示模式（没有后端）下只在本页记票。 */
(function (global) {
  'use strict';

  const tallies = new Map();   // pid -> { up, down }：这个人所有句子加起来
  const lines = new Map();     // mid -> { up, down }：某一句话
  const owners = new Map();    // mid -> pid
  const mine = new Map();      // mid -> 1 | -1
  let opts = { live: false, viewer: '', toast: () => {} };

  const pop = document.createElement('div');
  pop.className = 'vote-pop px-box';
  pop.hidden = true;
  pop.innerHTML =
    '<button type="button" class="vbtn up" data-vote="1" aria-label="点赞"><span class="sprite" data-sprite="thumbUp"></span></button>' +
    '<button type="button" class="vbtn down" data-vote="-1" aria-label="点踩"><span class="sprite" data-sprite="thumbDown"></span></button>';
  let popFor = null; // { pid, mid, name, anchor }

  const tally = pid => tallies.get(pid) || { up: 0, down: 0 };
  const line = mid => lines.get(mid) || { up: 0, down: 0 };

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

  const bumpEl = el => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

  function render(pid, bump) { // 头像下面：这个人的总数
    const v = tally(pid);
    document.querySelectorAll(`.vote-tally[data-pid="${pid}"]`).forEach(el => { fill(el, v); if (bump) bumpEl(el); });
  }

  function renderLine(mid, bump) { // 那句话的角上：它自己的票数，自己投过的那一个高亮
    const v = line(mid), m = mine.get(mid) || 0;
    document.querySelectorAll(`.line-votes[data-mid="${CSS.escape(mid)}"]`).forEach(el => {
      fill(el, v);
      el.classList.toggle('mine-up', m > 0);
      el.classList.toggle('mine-down', m < 0);
      if (bump) bumpEl(el);
    });
    if (popFor && popFor.mid === mid) paintPop();
  }

  function attach(avatarEl, bubbleEl, pid, mid, name) {
    if (pid == null) return null;
    const t = badge(tally(pid));
    t.dataset.pid = pid;
    if (mid == null) return t; // 这句话没有编号（老记录）：只显示总数，不能投
    owners.set(mid, pid);
    const lv = badge(line(mid), 'line-votes');
    lv.dataset.mid = mid;
    bubbleEl.append(lv);
    bubbleEl.classList.add('votable');
    for (const el of [avatarEl, bubbleEl]) {
      el.classList.add('votable');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.title = `给「${name}」的这句话点赞 / 点踩`;
      const open = e => {
        if (el === bubbleEl && el.closest('.msg.typing')) return; // 字还在一个个出来：这一下是“直接显示整句”
        e.stopPropagation();
        openPop(bubbleEl, pid, mid, name);
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    }
    queueMicrotask(() => { render(pid); renderLine(mid); }); // 挂进页面之后，把“自己投过哪一个”也标上
    return t;
  }

  // ---------- 弹出的两个按钮 ----------
  function paintPop() {
    const m = mine.get(popFor.mid) || 0;
    pop.querySelector('.up').classList.toggle('on', m > 0);
    pop.querySelector('.down').classList.toggle('on', m < 0);
  }

  function place() {
    const r = popFor.anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 10 > 8 ? r.top - h - 10 : r.bottom + 10; // 那句话上方放不下就放下面
    pop.style.left = `${Math.round(x)}px`;
    pop.style.top = `${Math.round(y)}px`;
  }

  function openPop(anchor, pid, mid, name) {
    if (popFor && popFor.mid === mid && !pop.hidden) { closePop(); return; }
    popFor = { pid, mid, name, anchor };
    pop.hidden = false;
    paintPop();
    place();
    pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show');
  }

  function closePop() {
    pop.hidden = true;
    popFor = null;
  }

  async function cast(pid, mid, vote) {
    const before = mine.get(mid) || 0;
    const next = before === vote ? 0 : vote; // 再点一次同一个：撤回
    const oldP = { ...tally(pid) }, oldL = { ...line(mid) };
    // 先在本页改好（乐观更新），失败了再改回来
    const shift = v => {
      const o = { ...v };
      if (before > 0) o.up--; else if (before < 0) o.down--;
      if (next > 0) o.up++; else if (next < 0) o.down++;
      return o;
    };
    const p = shift(oldP);
    tallies.set(pid, p);
    lines.set(mid, shift(oldL));
    if (next) mine.set(mid, next); else mine.delete(mid);
    render(pid, true);
    renderLine(mid, true);
    floatDelta(oldP, p);
    if (!opts.live) return;
    const undo = () => {
      tallies.set(pid, oldP);
      lines.set(mid, oldL);
      if (before) mine.set(mid, before); else mine.delete(mid);
      render(pid);
      renderLine(mid);
    };
    try {
      const r = await fetch('/api/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: pid, message_id: mid, vote: next, viewer: opts.viewer }),
      });
      if (!r.ok) {
        undo();
        opts.toast(r.status === 429 ? '这个网络里投票的人太多了'
          : r.status === 404 ? '这句话是上一场的，已经不能投了' : '投票失败，请稍后再试');
        return;
      }
      const d = await r.json();
      tallies.set(pid, d.player);
      lines.set(mid, d.message);
      render(pid);
      renderLine(mid);
    } catch (e) {
      undo();
      opts.toast('网络不通，投票没有送出去');
    }
  }

  pop.addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.target.closest('.vbtn');
    if (!btn || !popFor) return;
    const { pid, mid } = popFor;
    cast(pid, mid, Number(btn.dataset.vote));
    setTimeout(closePop, 260);
  });
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !(popFor && popFor.anchor.contains(e.target))) closePop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) closePop(); });
  addEventListener('resize', () => { if (!pop.hidden) closePop(); });

  // ---------- 外部 ----------
  function update(data) {
    if (!data) return;
    const players = data.players || (data.messages ? {} : data); // 演示数据还是老格式：{ pid: { up, down } }
    Object.entries(players).forEach(([pid, v]) => {
      pid = Number(pid);
      const old = tally(pid);
      if (old.up === v.up && old.down === v.down) return;
      tallies.set(pid, { up: v.up, down: v.down });
      render(pid, true);
      floatDelta(old, v);
    });
    Object.entries(data.messages || {}).forEach(([mid, v]) => {
      const old = line(mid);
      if (old.up === v.up && old.down === v.down) return;
      lines.set(mid, { up: v.up, down: v.down });
      renderLine(mid, true);
    });
  }

  function setMine(map) {
    Object.entries(map || {}).forEach(([mid, v]) => { mine.set(mid, v); renderLine(mid); });
  }

  // 死亡 / 胜利的那一刻：墓碑上记着当时的计数，本页还没有的就用它补上（之后的票照样实时推过来）。
  // 没有 votes 的老记录（或演示模式）反过来用本页最后看到的计数补上墓碑
  function fromRecord(record) {
    const pid = record.id;
    if (!record.votes) record.votes = { ...tally(pid) };
    if (!tallies.has(pid)) { tallies.set(pid, { up: record.votes.up, down: record.votes.down }); render(pid); }
    Object.entries(record.message_votes || {}).forEach(([mid, v]) => { if (!lines.has(mid)) { lines.set(mid, v); renderLine(mid); } });
  }

  // 墓园、死亡框里的计数：挂上 data-pid，之后有人再投，跟着一起变
  function liveBadge(pid, votes) {
    if (votes && !tallies.has(pid)) tallies.set(pid, { up: votes.up, down: votes.down });
    const b = badge(tally(pid));
    b.dataset.pid = pid;
    return b;
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

  global.HungerVotes = { init, attach, update, setMine, fromRecord, liveBadge, tally, badge };
})(window);
