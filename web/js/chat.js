/* 对话区：气泡队列（打字机效果）、分隔条、遗言气泡、死亡框。
 *   HungerChat.add({ kind: 'message', who: 'env' | 'player', name, avatar, text, ghost, instant }, onShow)
 *   HungerChat.add({ kind: 'divider', icon: 'heart', text, instant }, onShow)
 *   HungerChat.add({ kind: 'death', record, onOpen, instant }, onShow)
 * ghost = 遗言轮：墓碑形的气泡，烛光、慢速打字；
 * death = 死亡轮：红黑色的“死亡框”，出现时震一下，点击可以打开这个人的生平；
 * instant = 不用打字机效果（回放历史时用）；
 * onShow 在该条开始显示的那一刻调用，用来让“墓园/年龄/轮数”等状态和画面同步。 */
(function (global) {
  'use strict';

  const MAX_ITEMS = 300; // 最多保留这么多条，防止长时间运行后页面越来越卡
  const chat = document.getElementById('chat');
  const queue = [];
  let busy = false;
  let skipTyping = false;

  const nearBottom = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  const toBottom = () => { chat.scrollTop = chat.scrollHeight; };

  function buildMessage(item) {
    const isEnv = item.who === 'env';
    const el = document.createElement('article');
    el.className = `msg ${isEnv ? 'left sp-env' : 'right sp-player'}${item.ghost ? ' sp-ghost' : ''}`;
    if (!isEnv) el.style.setProperty('--accent', Sprites.accent(item.avatar)); // 每位选手一个主色，同场时好区分
    const sprite = isEnv ? 'eye' : Sprites.avatar(item.avatar);
    const bubble = item.ghost
      ? '<div class="bubble tomb-bubble"><div class="epitaph-head">' +
        '<span class="sprite candle" data-sprite="candle"></span><span class="name"></span>' +
        '<span class="sprite candle" data-sprite="candle"></span></div><p class="text"></p></div>'
      : '<div class="bubble px-box"><div class="name"></div><p class="text"></p></div>';
    el.innerHTML = `<div class="avatar px-box"><span class="sprite" data-sprite="${sprite}"></span></div>` + bubble;
    // 名字和台词都用 textContent：这里放的是 LLM 生成的文本，不能当 HTML 解析
    el.querySelector('.name').textContent = item.ghost ? `† ${item.name} · 遗言 †` : item.name;
    Sprites.mount(el);
    return el;
  }

  function buildDivider(item) {
    const el = document.createElement('div');
    el.className = 'divider';
    el.innerHTML = `<span class="sprite" data-sprite="${item.icon || 'heart'}"></span><span class="dtext"></span>`;
    el.querySelector('.dtext').textContent = item.text;
    Sprites.mount(el);
    return el;
  }

  function buildDeath(item) {
    const r = item.record;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'death-box';
    el.setAttribute('aria-label', `${r.name} 死亡，查看生平`);
    el.innerHTML =
      '<span class="sprite skull" data-sprite="skull"></span>' +
      '<span class="d-body"><span class="d-title"></span><span class="d-cause"></span><span class="d-meta"></span></span>' +
      `<span class="gav px-box"><span class="sprite" data-sprite="${Sprites.avatar(r.avatar)}"></span></span>`;
    el.querySelector('.d-title').textContent = `† ${r.name} 死亡 †`;
    el.querySelector('.d-cause').textContent = `死因：${r.cause}`;
    el.querySelector('.d-meta').textContent =
      [r.died_round != null ? `第 ${r.died_round} 轮` : '', `存活 ${r.rounds} 轮`, '点击查看生平'].filter(Boolean).join(' · ');
    if (item.onOpen) el.addEventListener('click', item.onOpen);
    Sprites.mount(el);
    return el;
  }

  function append(el) {
    const stick = nearBottom();
    chat.appendChild(el);
    while (chat.children.length > MAX_ITEMS) chat.firstElementChild.remove();
    if (stick) toBottom();
  }

  function typeInto(el, text, instant, slow, done) {
    const chars = Array.from(text);
    let i = 0;
    const step = () => {
      const stick = nearBottom();
      if (skipTyping || instant) i = chars.length; else i++;
      el.textContent = chars.slice(0, i).join('');
      if (stick) toBottom();
      if (i >= chars.length) return done();
      const pause = '，。！？、…,.!?'.includes(chars[i - 1]);
      setTimeout(step, slow ? (pause ? 260 : 80) : (pause ? 160 : 32)); // 遗言一字一字慢慢刻
    };
    step();
  }

  function next() {
    const entry = queue.shift();
    if (!entry) { busy = false; return; }
    busy = true;
    const { item, onShow } = entry;
    const instant = !!item.instant;
    skipTyping = false;
    if (onShow) onShow();

    if (item.kind === 'divider' || item.kind === 'death') {
      append(item.kind === 'death' ? buildDeath(item) : buildDivider(item));
      setTimeout(next, instant ? 0 : (item.kind === 'death' ? 1400 : 500)); // 死亡后停顿久一点
      return;
    }
    const el = buildMessage(item);
    el.classList.add('typing');
    append(el);
    typeInto(el.querySelector('.text'), item.text, instant, !!item.ghost, () => {
      el.classList.remove('typing');
      setTimeout(next, instant ? 0 : (item.ghost ? 900 : 500));
    });
  }

  function add(item, onShow) {
    queue.push({ item, onShow });
    if (!busy) next();
  }

  function clear() {
    queue.length = 0;
    chat.replaceChildren();
  }

  chat.addEventListener('click', () => { skipTyping = true; }); // 点一下直接显示整句

  global.HungerChat = { add, clear };
})(window);
