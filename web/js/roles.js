/* 墓园（点“墓园”按钮弹出）：墓碑列表 → 点开某一条看人物生平。
 *   HungerRoles.init({ graveyard: async () => [...records], current: () => [在世的选手] })
 *   HungerRoles.open()                    // 打开列表
 *   HungerRoles.open({ record })          // 直接打开某个人的生平（点聊天里的死亡框时用）
 *   HungerRoles.open({ detail: 0 })       // 打开第 n 条（最新的是 0），调试用
 * record = { id, name, avatar, rounds, cause, biography, last_words, born_round, died_round, died_at }，按死亡先后排列。 */
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

  function who(name, line) {
    const w = el('span', 'who');
    w.append(el('span', 'gname', name), el('span', 'gcause', line));
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

  function graveItem(r) {
    const li = el('li');
    const btn = el('button', 'grave px-box');
    btn.type = 'button';
    const victory = r.kind === 'victory';
    btn.append(sprite(icon(r), 'gtomb'), frame(r.avatar), who(r.name, r.cause),
      meta([`存活 ${r.rounds} 轮`, r.died_round != null ? `第 ${r.died_round} 轮${victory ? '解开了回廊' : '死亡'}` : '']));
    btn.addEventListener('click', () => showDetail(r));
    li.append(btn);
    return li;
  }

  function aliveItem(p) {
    const li = el('li');
    const card = el('div', 'grave alive px-box');
    card.append(sprite('heart', 'gtomb'), frame(p.avatar), who(p.name, '在世，还没有墓碑'),
      meta([`已存活 ${p.age} 轮`]));
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
    body.replaceChildren(ul);
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
    const head = el('div', 'bio-head');
    head.append(sprite(icon(r), 'gtomb'), frame(r.avatar, 'big'), info);

    art.append(head,
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
