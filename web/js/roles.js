/* 墓园（点“墓园”按钮弹出）：墓碑列表 → 点开某一条看人物生平。
 *   HungerRoles.init({ graveyard: async () => [...records], current: () => [在世的选手] })
 *   HungerRoles.open()                    // 打开列表
 *   HungerRoles.open({ record })          // 直接打开某个人的生平（点聊天里的死亡框时用）
 *   HungerRoles.open({ detail: 0 })       // 打开第 n 条（最新的是 0），调试用
 * record = { id, name, avatar, rounds, cause, biography, last_words, born_round, died_round, died_at, votes }，按死亡先后排列。
 * 列表最上面并排两位：观众点赞最多的「人气之星」和点踩最多的「众矢之的」（在世的选手也算，用此刻的票数）。 */
(function (global) {
  'use strict';

  const modal = document.getElementById('roles');
  const body = document.getElementById('roles-body');
  const title = document.getElementById('roles-title');
  const backBtn = document.getElementById('roles-back');
  const closeBtn = document.getElementById('roles-close');

  let provider = { graveyard: async () => [], current: () => [] };
  let records = []; // 最新的在前
  let opener = null;
  let token = 0; // 防止慢请求回来时覆盖掉用户已经切换的界面

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // 全部用 textContent：内容是 LLM 生成的
    return e;
  }

  function sprite(name, cls) {
    const e = el('span', 'sprite' + (cls ? ' ' + cls : ''));
    e.dataset.sprite = name;
    return e;
  }

  function frame(avatarId, cls) {
    const f = el('span', 'gav px-box' + (cls ? ' ' + cls : ''));
    f.append(sprite(Sprites.avatar(avatarId)));
    return f;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('zh-CN', { hour12: false });
  }

  // 性格：绿色的优点、红色的缺点
  function chips(pers) {
    const c = el('span', 'chips');
    if (!pers) return c;
    const v = el('span', 'chip good', pers.virtue.name), f = el('span', 'chip bad', pers.flaw.name);
    v.title = pers.virtue.tip || ''; f.title = pers.flaw.tip || '';
    c.append(v, f);
    return c;
  }

  function who(name, line, pers) {
    const w = el('span', 'who');
    w.append(el('span', 'gname', name), el('span', 'gcause', line));
    if (pers) w.append(chips(pers));
    return w;
  }

  // 解开回廊的人是金星；留下了遗言的人是石碑；没来得及留的是木十字架
  function icon(r) {
    return r.kind === 'victory' ? 'star' : r.last_words ? 'tomb' : 'cross';
  }

  function meta(lines) {
    const m = el('span', 'gmeta');
    lines.filter(Boolean).forEach(t => m.append(el('span', null, t)));
    return m;
  }

  // ---------- 人气之星 / 众矢之的 ----------
  const votesOf = c => c.votes || { up: 0, down: 0 };
  function top(cands, key) { // 票数最多的那位；同票时新的在前（列表本来就是新的在前）
    let best = null;
    cands.forEach(c => { if (votesOf(c)[key] > 0 && (!best || votesOf(c)[key] > votesOf(best)[key])) best = c; });
    return best;
  }

  function hallCard(c, kind) {
    const good = kind === 'best';
    const card = el(c && !c.alive ? 'button' : 'div', `hall-card px-box ${kind}${c ? '' : ' vacant'}`);
    if (card.tagName === 'BUTTON') { card.type = 'button'; card.addEventListener('click', () => showDetail(c.record)); }
    card.append(el('span', 'hall-title', good ? '人气之星' : '众矢之的'));
    const art = el('span', 'hall-art');
    // 美术：人气之星头顶金冠、身边星光闪烁；众矢之的头顶乌云下雨、身上挨了烂番茄
    if (good) art.append(sprite('crown', 'hall-crown'), sprite('star', 'hall-spark s1'), sprite('star', 'hall-spark s2'), sprite('star', 'hall-spark s3'));
    else art.append(sprite('stormcloud', 'hall-cloud'), el('span', 'hall-rain'), sprite('tomato', 'hall-tomato t1'), sprite('tomato', 'hall-tomato t2'));
    const f = c ? frame(c.avatar, 'big') : el('span', 'gav px-box big hall-empty', '？');
    if (c && !c.alive) f.classList.add('gone');
    art.insertBefore(f, art.children[1]);
    card.append(art);
    if (!c) {
      card.append(el('span', 'gname', '虚位以待'), el('span', 'hall-sub', good ? '还没有人被点过赞' : '还没有人被点过踩'));
      return card;
    }
    const n = votesOf(c)[good ? 'up' : 'down'];
    const count = el('span', 'hall-count');
    count.append(sprite(good ? 'thumbUp' : 'thumbDown'), el('b', null, String(n)));
    card.append(el('span', 'gname', c.name), count,
      el('span', 'hall-sub', c.alive ? '在世 · 还在接受评价' : `${c.record.kind === 'victory' ? '解开了回廊' : '已故'} · 点击查看生平`));
    return card;
  }

  function hall(records, alive) {
    const cands = [
      ...alive.map(p => ({ name: p.name, avatar: p.avatar, alive: true, votes: HungerVotes.tally(p.id) })),
      ...records.map(r => ({ name: r.name, avatar: r.avatar, alive: false, votes: r.votes, record: r })),
    ];
    const box = el('section', 'hall');
    box.setAttribute('aria-label', '观众评价');
    box.append(hallCard(top(cands, 'up'), 'best'), hallCard(top(cands, 'down'), 'worst'));
    return box;
  }

  function graveItem(r) {
    const li = el('li');
    const btn = el('button', 'grave px-box');
    btn.type = 'button';
    const victory = r.kind === 'victory';
    btn.append(sprite(icon(r), 'gtomb'), frame(r.avatar), who(r.name, r.cause, r.personality),
      meta([`存活 ${r.rounds} 轮`, r.died_round != null ? `第 ${r.died_round} 轮${victory ? '解开了回廊' : '死亡'}` : '']));
    if (r.votes) btn.lastChild.append(HungerVotes.badge(r.votes, 'sealed'));
    btn.addEventListener('click', () => showDetail(r));
    li.append(btn);
    return li;
  }

  function aliveItem(p) {
    const li = el('li');
    const card = el('div', 'grave alive px-box');
    card.append(sprite('heart', 'gtomb'), frame(p.avatar), who(p.name, '在世，还没有墓碑', p.personality),
      meta([`已存活 ${p.age} 轮`]));
    card.lastChild.append(HungerVotes.badge(HungerVotes.tally(p.id)));
    li.append(card);
    return li;
  }

  async function showList() {
    const mine = ++token;
    title.textContent = '墓园';
    backBtn.hidden = true;
    body.replaceChildren(el('p', 'empty', '读取中…'));
    let list;
    try {
      list = await provider.graveyard();
    } catch (e) {
      if (mine === token) body.replaceChildren(el('p', 'empty', '无法读取墓园数据，请稍后再试。'));
      return;
    }
    if (mine !== token) return;
    records = list.slice().reverse();
    const alive = provider.current() || [];
    if (!alive.length && !records.length) {
      body.replaceChildren(el('p', 'empty', '墓园里还没有人。'));
      return;
    }
    const ul = el('ul', 'grave-list');
    alive.forEach(p => ul.append(aliveItem(p)));
    records.forEach(r => ul.append(graveItem(r)));
    body.replaceChildren(hall(records, alive), ul);
    Sprites.mount(body);
    body.scrollTop = 0;
  }

  function showDetail(r) {
    token++;
    title.textContent = '人物生平';
    backBtn.hidden = false;
    const art = el('article', 'bio');

    const victory = r.kind === 'victory';
    const lines = [
      `第 ${r.id} 位选手`,
      r.born_round != null ? `第 ${r.born_round} 轮入场` : '',
      r.died_round != null ? `第 ${r.died_round} 轮${victory ? '解开了回廊' : '死亡'}` : '',
      `存活 ${r.rounds} 轮`,
      formatDate(r.died_at),
    ].filter(Boolean).join(' · ');
    const info = el('div', 'bio-info');
    info.append(el('div', 'gname', r.name), el('div', 'gcause', `${victory ? '功绩' : '死因'}：${r.cause}`),
      el('div', 'gmeta', lines));
    if (r.personality) info.append(chips(r.personality));
    if (r.votes) { // 观众的评价：死亡那一刻封存
      const v = el('div', 'gmeta bio-votes', '观众评价');
      v.append(HungerVotes.badge(r.votes, 'sealed'));
      info.append(v);
    }
    const head = el('div', 'bio-head');
    head.append(sprite(icon(r), 'gtomb'), frame(r.avatar, 'big'), info);

    const traits = [];
    if (r.personality) {
      const { virtue, flaw } = r.personality;
      const row = (cls, label, t) => { const p = el('p', 'trait'); p.append(el('span', `chip ${cls}`, `${label} · ${t.name}`), el('span', 'p-tip', t.tip || '')); return p; };
      traits.push(el('h3', null, '性格'), row('good', '优点', virtue), row('bad', '缺点', flaw));
    }
    art.append(head, ...traits,
      el('h3', null, '生平'), el('p', 'bio-text', r.biography),
      el('h3', null, '遗言'),
      r.last_words ? el('p', 'last-words', `「${r.last_words}」`) : el('p', 'empty', '没来得及留下遗言。'));
    body.replaceChildren(art);
    Sprites.mount(body);
    body.scrollTop = 0;
    backBtn.focus();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    // 焦点困在弹窗里
    const items = [...modal.querySelectorAll('button:not([hidden])')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(opts) {
    opener = document.activeElement;
    modal.hidden = false;
    document.addEventListener('keydown', onKey);
    closeBtn.focus();
    if (opts && opts.record) { showDetail(opts.record); return; }
    const loaded = showList();
    if (opts && opts.detail != null) loaded.then(() => { if (records[opts.detail]) showDetail(records[opts.detail]); });
  }

  function close() {
    token++;
    modal.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (opener && opener.focus) opener.focus();
  }

  function init(p) {
    provider = p;
    closeBtn.addEventListener('click', close);
    backBtn.addEventListener('click', showList);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
  }

  global.HungerRoles = { init, open, close };
})(window);
