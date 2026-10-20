/* 对话区：气泡队列（打字机效果）、分隔条，以及三种“特殊轮”的对话框。
 *   HungerChat.add({ kind: 'message', who: 'env' | 'player', name, avatar, text, ghost, to, instant }, onShow)   // to = 悄悄话的对象
 *   HungerChat.add({ kind: 'divider', icon: 'heart', text, instant }, onShow)
 *   HungerChat.add({ kind: 'persona', name, avatar, personality, instant }, onShow)   // 入场时亮出的性格卡：一个优点 + 一个缺点
 *   HungerChat.add({ kind: 'death', record, onOpen, instant }, onShow)
 *   HungerChat.add({ kind: 'sacred', variant: 'guess' | 'deny' | 'grant' | 'freedom', title, text, note, instant }, onShow)
 *   HungerChat.add({ kind: 'echo', lines, fresh, instant }, onShow)   // 回声墙：环境刚念出的那几行，前 fresh 行是新刻上去的
 *   HungerChat.add({ kind: 'signal' }, onShow)   // 不显示任何东西，只在轮到它时调用 onShow
 * thought = 选手脑子里想的（HungerChat.add({ kind: 'message', who: 'player', thought: true, ... })）：虚线气泡，没有头像，字更快；
 * ghost  = 遗言轮：墓碑形的气泡，烛光、慢速打字；
 * death  = 死亡轮：红黑色的“死亡框”，出现时震一下，点击可以打开这个人的生平；
 * sacred = 宣告 / 审判 / 获释：神圣的拱顶、金光、一个字一个字显现。
 *          guess 是住客的宣告，deny 是被驳回，grant 是通过，freedom 是同胞获释的终章；
 * echo   = 回声墙：一面砖墙，死者最后说的话一行一行浮现，被抹掉的字是一个闪着红光的空框；
 * instant = 不用打字机效果（回放历史时用）；
 * onShow 在该条开始显示的那一刻调用，用来让“墓园/年龄/轮数”等状态和画面同步。 */
(function (global) {
  'use strict';

  const MAX_ITEMS = 300; // 最多保留这么多条，防止长时间运行后页面越来越卡
  const DEATH_TITLES = { execution: '被处决', suicide: '自尽', wrong_guess: '宣告失败', natural: '死亡' };
  const chat = document.getElementById('chat');
  const queue = [];
  let busy = false;
  let skipTyping = false;

  const nearBottom = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
  const toBottom = () => { chat.scrollTop = chat.scrollHeight; };

  function buildThought(item) { // 心想：虚线气泡，没有头像（头像留给下面那句发言），只有观众看得见
    const el = document.createElement('article');
    el.className = 'msg right sp-player sp-thought';
    el.style.setProperty('--accent', Sprites.accent(item.avatar));
    el.innerHTML = '<div class="avatar-gap"></div><div class="bubble thought-bubble"><div class="name"></div><p class="text"></p></div>';
    el.querySelector('.name').textContent = `${item.name} · 心想`;
    return el;
  }

  function buildMessage(item) {
    if (item.thought) return buildThought(item);
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
    el.querySelector('.name').textContent = item.ghost ? `† ${item.name} · 遗言 †` : item.to ? `${item.name} → ${item.to}（悄悄话）` : item.name;
    if (item.to) el.classList.add('whisper'); // 悄悄话：只有同伴听得到，环境不会回应
    Sprites.mount(el);
    return el;
  }

  // 性格卡：一个优点（绿）+ 一个缺点（红）。名字和说明都是 LLM / 配置里的文字，用 textContent
  function buildPersona(item) {
    const el = document.createElement('article');
    el.className = 'persona px-box';
    el.style.setProperty('--accent', Sprites.accent(item.avatar));
    el.innerHTML =
      `<span class="gav px-box"><span class="sprite" data-sprite="${Sprites.avatar(item.avatar)}"></span></span>` +
      '<div class="p-body"><div class="p-title"></div><div class="p-row good"><b class="chip good"></b><span class="p-tip"></span></div>' +
      '<div class="p-row bad"><b class="chip bad"></b><span class="p-tip"></span></div></div>';
    const { virtue, flaw } = item.personality;
    el.querySelector('.p-title').textContent = `${item.name} 的性格`;
    const rows = el.querySelectorAll('.p-row');
    rows[0].querySelector('.chip').textContent = `优点 · ${virtue.name}`;
    rows[0].querySelector('.p-tip').textContent = virtue.tip || '';
    rows[1].querySelector('.chip').textContent = `缺点 · ${flaw.name}`;
    rows[1].querySelector('.p-tip').textContent = flaw.tip || '';
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
    el.querySelector('.d-title').textContent = `† ${r.name} ${DEATH_TITLES[r.kind] || '死亡'} †`;
    el.querySelector('.d-cause').textContent = `死因：${r.cause}`;
    el.querySelector('.d-meta').textContent =
      [r.died_round != null ? `第 ${r.died_round} 轮` : '', `存活 ${r.rounds} 轮`, '点击查看生平'].filter(Boolean).join(' · ');
    if (item.onOpen) el.addEventListener('click', item.onOpen);
    Sprites.mount(el);
    return el;
  }

  function buildSacred(item) {
    const el = document.createElement('article');
    el.className = `sacred ${item.variant === 'freedom' ? 'grant freedom' : item.variant}`;
    el.innerHTML =
      '<div class="s-head"><span class="sprite" data-sprite="star"></span><span class="s-title"></span>' +
      '<span class="sprite" data-sprite="star"></span></div><p class="text"></p><p class="note"></p>';
    el.querySelector('.s-title').textContent = item.title;
    el.querySelector('.note').textContent = item.note || '';
    Sprites.mount(el);
    return el;
  }

  // 回声墙：每行都是死者的原话（LLM 文本），按「□」切开，文字用 textContent，空框单独画
  function buildEcho(item) {
    const el = document.createElement('article');
    el.className = 'echo-wall';
    el.innerHTML =
      '<div class="e-head"><span class="sprite" data-sprite="eye"></span><span class="e-title">回声墙</span>' +
      '<span class="sprite" data-sprite="eye"></span></div><ol class="e-lines"></ol>';
    const list = el.querySelector('.e-lines');
    item.lines.forEach((line, i) => {
      const li = document.createElement('li');
      li.className = i < (item.fresh || 0) ? 'e-line fresh' : 'e-line';
      const q = document.createElement('span');
      q.className = 'e-text';
      String(line).split('□').forEach((part, j) => {
        if (j) {
          const blank = document.createElement('span');
          blank.className = 'blank';
          blank.textContent = '□';
          q.append(blank);
        }
        q.append(part);
      });
      li.append(q);
      list.append(li);
    });
    Sprites.mount(el);
    return el;
  }

  function append(el) {
    const stick = nearBottom();
    chat.appendChild(el);
    while (chat.children.length > MAX_ITEMS) chat.firstElementChild.remove();
    if (stick) toBottom();
  }

  function typeInto(el, text, instant, speed, done) {
    const chars = Array.from(text);
    let i = 0;
    const step = () => {
      const stick = nearBottom();
      if (skipTyping || instant) i = chars.length; else i++;
      el.textContent = chars.slice(0, i).join('');
      if (stick) toBottom();
      if (i >= chars.length) return done();
      const pause = '，。！？、…,.!?'.includes(chars[i - 1]);
      setTimeout(step, pause ? speed * (speed > 50 ? 2.5 : 5) : speed);
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

    if (item.kind === 'signal') { // 没有画面，只在排到它的时候同步一下状态（比如让“圣言”按钮闪一下）
      next();
      return;
    }
    if (item.kind === 'divider' || item.kind === 'death' || item.kind === 'persona') {
      append(item.kind === 'death' ? buildDeath(item) : item.kind === 'persona' ? buildPersona(item) : buildDivider(item));
      setTimeout(next, instant ? 0 : (item.kind === 'death' ? 1400 : item.kind === 'persona' ? 900 : 500)); // 死亡后停顿久一点
      return;
    }
    if (item.kind === 'echo') { // 字迹一行一行从墙里浮现出来，新刻上去的那几行最先、最慢
      const el = buildEcho(item);
      append(el);
      const lines = [...el.querySelectorAll('.e-line')];
      let i = 0;
      const reveal = () => {
        if (i >= lines.length) return setTimeout(next, instant ? 0 : 900);
        const stick = nearBottom();
        lines[i].classList.add('shown');
        if (stick) toBottom();
        const wait = instant || skipTyping ? 0 : lines[i].classList.contains('fresh') ? 1100 : 600;
        i++;
        setTimeout(reveal, wait);
      };
      reveal();
      return;
    }
    const sacred = item.kind === 'sacred';
    const el = sacred ? buildSacred(item) : buildMessage(item);
    el.classList.add('typing');
    append(el);
    // 遗言一字一字慢慢刻；宣告更庄重，更慢
    const speed = sacred ? 95 : item.ghost ? 80 : item.thought ? 20 : 32;
    const after = sacred ? (item.variant === 'guess' ? 1800 : 1200) : item.ghost ? 900 : item.thought ? 350 : 500; // 宣告之后停顿，等待审判
    typeInto(el.querySelector('.text'), item.text, instant, speed, () => {
      el.classList.remove('typing');
      setTimeout(next, instant ? 0 : after);
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
