/* 圣言（点“圣言”按钮弹出）：这个世界的每一条世界观，以及它被触发过几次。
 *   HungerScripture.init({ load: async () => [{ id, kind: 'rule' | 'truth', count, title, text, hidden }] })
 *   HungerScripture.open() / .close()
 * kind = 'rule' 的条目是会被触发的规则（死了人就记一次），后面显示“触发 N 次”；
 * kind = 'truth' 的条目是世界的本质，不会被触发，后面只有一个“真相”标记；
 * hidden = true 的条目还没有被揭示，没有 title / text，只显示“？？？”（后端不会把没揭示的内容发过来）。 */
(function (global) {
  'use strict';

  const modal = document.getElementById('scripture');
  const body = document.getElementById('scripture-body');
  const closeBtn = document.getElementById('scripture-close');

  let provider = { load: async () => [] };
  let opener = null;
  let token = 0; // 防止慢请求回来时覆盖已经关掉的界面

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text; // 全部用 textContent
    return e;
  }

  // 还没有被揭示的条目：只有一把锁和“？？？”。规则在第一次被触发时揭示；世界的本质要等真相被完整宣告。
  function hiddenVerse(e) {
    const rule = e.kind === 'rule';
    const li = el('li', 'verse hidden px-box');
    const icon = el('span', 'sprite vicon');
    icon.dataset.sprite = 'lock';
    const main = el('div', 'vmain');
    main.append(el('div', 'vtitle', '？？？'),
      el('p', 'vtext', rule ? '这一条圣言还没有被揭示。它第一次被触发的那一刻，才会显现。'
        : '只有回廊的真相被完整宣告的那一刻，它才会显现。'));
    li.append(icon, main, el('span', 'vtag', rule ? '尚未触发' : '？？？'));
    return li;
  }

  function verse(e) {
    if (e.hidden) return hiddenVerse(e);
    const rule = e.kind === 'rule';
    const li = el('li', `verse px-box${e.count ? ' lit' : ''}`);
    const icon = el('span', 'sprite vicon');
    icon.dataset.sprite = rule ? 'star' : 'eye'; // 规则是星，本质是眼睛
    const main = el('div', 'vmain');
    main.append(el('div', 'vtitle', e.title), el('p', 'vtext', e.text));
    const badge = rule
      ? el('span', `vcount${e.count ? ' hot' : ''}`, e.count ? `触发 ${e.count} 次` : '尚未触发')
      : el('span', 'vtag', '真相');
    li.append(icon, main, badge);
    return li;
  }

  async function render() {
    const mine = ++token;
    body.replaceChildren(el('p', 'empty', '读取中…'));
    let entries;
    try {
      entries = await provider.load();
    } catch (err) {
      if (mine === token) body.replaceChildren(el('p', 'empty', '无法读取圣言，请稍后再试。'));
      return;
    }
    if (mine !== token) return;
    if (!entries.length) {
      body.replaceChildren(el('p', 'empty', '这个世界还没有写下圣言。'));
      return;
    }
    const list = el('ul', 'verse-list');
    entries.forEach(e => list.append(verse(e)));
    body.replaceChildren(el('p', 'vintro', '这个世界的每一条世界观。没有被触发过的，只是一个“？？？”；被触发过的规则，后面会记下次数。'), list);
    Sprites.mount(body);
    body.scrollTop = 0;
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); } // 弹窗里只有一个按钮，焦点就停在它上面
  }

  function open() {
    opener = document.activeElement;
    modal.hidden = false;
    document.addEventListener('keydown', onKey);
    closeBtn.focus();
    render();
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
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
  }

  global.HungerScripture = { init, open, close };
})(window);
