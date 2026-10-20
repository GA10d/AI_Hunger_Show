/* 对话区：气泡队列（打字机效果）、分隔条，以及三种“特殊轮”的对话框。
 *   HungerChat.add({ kind: 'message', who: 'env' | 'player', name, avatar, pid, text, ghost, to, instant }, onShow)   // to = 悄悄话的对象；pid = 选手 id（有它，头像才能投票）
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
 * special = 稀有身份，发言框和登场卡片各有各的样子（见下面的 SPECIALS 和 style.css）：
 *           revived 复活（金边、角上小十字架；卡片两侧翅膀、头顶光环）、catgirl 猫娘（粉色、猫耳、爪印）、
 *           bard 吟游诗人（羊皮纸卷轴、音符）、gambler 赌徒（绿色赌桌、骰子和金币）、medium 通灵者（深紫、第三只眼）、
 *           believer 信徒（彩色玻璃窗的边框、烛台）、earthbound 地缚灵体质（青灰、垂着锁链）、lover 恋人（红边、两颗心）；
 *   HungerChat.add({ kind: 'message', who: 'ghost', name, avatar, to, text })   // 地缚灵对活人的低语：半透明的虚线框
 *   message 带 act: 'kill'（下杀手：血红的框、刀痕、匕首，名字后写着对谁下手）| 'end_life'（诀别：黑底灰白框、一朵白花）
 *   HungerChat.add({ kind: 'lovers', players: [{name, avatar}, {name, avatar}] })  // 一对恋人同时降生
 *   HungerChat.add({ kind: 'vision', name, avatar, items: [{line, outline}] })    // 通灵者看见的轮廓（被抹掉的字只是一个空框）
 * instant = 不用打字机效果（回放历史时用）；
 * onShow 在该条开始显示的那一刻调用，用来让“墓园/年龄/轮数”等状态和画面同步。 */
(function (global) {
  'use strict';

  const MAX_ITEMS = 300; // 最多保留这么多条，防止长时间运行后页面越来越卡
  const DEATH_TITLES = { execution: '被处决', suicide: '自尽', wrong_guess: '宣告失败', natural: '死亡', heartbreak: '殉情', murdered: '被杀害' };
  // 下杀手（kill）/ 诀别（end_life）的发言框：角上的装饰；死亡框左边的图标随死法变
  const ACT_DECO = { kill: [['dagger', 'tl'], ['dagger', 'br']], end_life: [['lily', 'br']] };
  const DEATH_ICONS = { murdered: 'dagger', suicide: 'lily', heartbreak: 'heart' };

  // 稀有身份：登场卡片的标题、副标题，以及发言框 / 卡片上的小装饰（[像素图, 位置]，位置见 style.css 的 .deco.at-*）
  const SPECIALS = {
    revived: { title: it => `${it.name} 复活了 · 第 ${it.life || 2} 世`,
      sub: it => (it.diedRound != null ? `前世死于第 ${it.diedRound} 轮，带着记忆回来了` : '带着前世的记忆回来了'),
      bubble: [['holyCross', 'tl'], ['holyCross', 'br']], card: [] },
    catgirl: { tag: '猫娘', sub: () => '长着猫耳和尾巴，说话爱带「喵」', bubble: [['paw', 'br']], card: [['paw', 'tl'], ['paw', 'br']] },
    bard: { tag: '吟游诗人', sub: () => '只会用诗句说话', bubble: [['note', 'tr'], ['note', 'bl']], card: [['note', 'tr'], ['note', 'bl']] },
    gambler: { tag: '赌徒',
      sub: it => (it.gamble === 'won' ? '出生时押上了寿命——赢了，能多活一阵' : it.gamble === 'lost' ? '出生时押上了寿命——输了，只剩一半的时间' : '什么都敢押'),
      bubble: [['dice', 'tr'], ['coin', 'bl']], card: [['dice', 'tr'], ['coin', 'bl']] },
    medium: { tag: '通灵者', sub: () => '看得见回声墙上被抹掉的字的轮廓', bubble: [['eye', 'tr']], card: [['eye', 'tr']] },
    believer: { tag: '信徒', sub: () => '把「环境」当作神明来崇拜', bubble: [['candle', 'tr']], card: [['candle', 'tl'], ['candle', 'tr']] },
    earthbound: { tag: '地缚灵体质', sub: () => '死后不会离开，会化作地缚灵在这里徘徊', bubble: [['chain', 'b']], card: [['chain', 'b']] },
    chronicler: { tag: '史官', sub: () => '读过前人留下的 10 条遗言；他的遗言会传给之后出生的 10 个人',
      bubble: [['scroll', 'tr']], card: [['scroll', 'tl'], ['scroll', 'tr']] },
    lover: { tag: '恋人', sub: it => (it.lover ? `和「${it.lover}」是一对恋人` : '命中注定的那个人，同时降生在这里'),
      bubble: [['heart', 'tl'], ['heart', 'tr']], card: [['heart', 'tl'], ['heart', 'tr']] },
  };
  const deco = list => (list || []).map(([sp, at]) => `<span class="sprite deco d-${sp} at-${at}" data-sprite="${sp}"></span>`).join('');
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
    const isEnv = item.who === 'env', haunt = item.who === 'ghost'; // haunt：地缚灵在低语
    const el = document.createElement('article');
    el.className = `msg ${isEnv ? 'left sp-env' : 'right sp-player'}${item.ghost ? ' sp-ghost' : ''}${haunt ? ' sp-haunt' : item.special ? ' sp-' + item.special : ''}`;
    if (!isEnv) el.style.setProperty('--accent', Sprites.accent(item.avatar)); // 每位选手一个主色，同场时好区分
    const sprite = isEnv ? 'eye' : haunt && Sprites.SPRITES[`${item.avatar}Ghost`] ? `${item.avatar}Ghost` : Sprites.avatar(item.avatar);
    const bubble = item.ghost
      ? '<div class="bubble tomb-bubble"><div class="epitaph-head">' +
        '<span class="sprite candle" data-sprite="candle"></span><span class="name"></span>' +
        '<span class="sprite candle" data-sprite="candle"></span></div><p class="text"></p></div>'
      : '<div class="bubble px-box"><div class="name"></div><p class="text"></p></div>';
    el.innerHTML = `<div class="avatar px-box"><span class="sprite" data-sprite="${sprite}"></span></div>` + bubble;
    // 名字和台词都用 textContent：这里放的是 LLM 生成的文本，不能当 HTML 解析
    const who = item.special === 'revived' && item.life ? `${item.name} · 第 ${item.life} 世`
      : item.special === 'lover' && item.lover && !item.to ? `${item.name} ♥ ${item.lover}` : item.name;
    el.querySelector('.name').textContent = haunt ? `${item.name}（地缚灵）→ ${item.to} · 低语`
      : item.ghost ? `† ${who} · ${item.revised ? '改写' : ''}${item.special === 'chronicler' ? '史官的遗言' : '遗言'} †`
      : item.to ? `${who} → ${item.to}（悄悄话）`
      : item.act === 'kill' ? `${who} ⚔ 对「${item.target}」下了杀手` : item.act === 'end_life' ? `${who} · 诀别` : who;
    const sp = SPECIALS[item.special];
    if (ACT_DECO[item.act]) { // 杀人、自尽的那一句：换上专门的框，装饰也换成匕首 / 白花
      el.classList.add(item.act === 'kill' ? 'act-kill' : 'act-end');
      el.querySelector('.bubble').insertAdjacentHTML('beforeend', deco(ACT_DECO[item.act]));
    } else if (!item.ghost && !haunt && sp) el.querySelector('.bubble').insertAdjacentHTML('beforeend', deco(sp.bubble));
    if (item.to && !haunt) el.classList.add('whisper'); // 悄悄话：只有同伴听得到，环境不会回应
    if (!isEnv && !haunt && item.pid != null) { // 点这句话（或头像）给它点赞 / 点踩；头像下面挂着这个人的总数
      const av = el.querySelector('.avatar');
      const col = document.createElement('div');
      col.className = 'av-col';
      av.replaceWith(col);
      col.append(av, HungerVotes.attach(av, el.querySelector('.bubble'), item.pid, item.mid, item.name));
    }
    Sprites.mount(el);
    return el;
  }

  // 性格卡：一个优点（绿）+ 一个缺点（红）。名字和说明都是 LLM / 配置里的文字，用 textContent
  // 稀有身份的卡片：标题写身份，副标题一句说明，配上各自的装饰；复活的人两侧展开一对翅膀，头像上方一圈光环
  function buildPersona(item) {
    const el = document.createElement('article');
    el.className = `persona px-box${item.special ? ' ' + item.special : ''}`;
    el.style.setProperty('--accent', Sprites.accent(item.avatar));
    const sp = SPECIALS[item.special], revived = item.special === 'revived';
    el.innerHTML =
      (revived ? '<span class="sprite wing l" data-sprite="wing"></span><span class="sprite wing r" data-sprite="wing"></span>' : '') +
      deco(sp && sp.card) +
      `<span class="gav px-box">${revived ? '<i class="halo"></i>' : ''}<span class="sprite" data-sprite="${Sprites.avatar(item.avatar)}"></span></span>` +
      '<div class="p-body"><div class="p-title"></div><div class="p-sub"></div></div>';
    el.querySelector('.p-title').textContent =
      !sp ? `${item.name} 的性格` : sp.title ? sp.title(item) : `${item.name} · ${sp.tag}`;
    const sub = el.querySelector('.p-sub');
    if (sp) sub.textContent = sp.sub(item);
    else sub.remove();
    if (item.personality) {
      const { virtue, flaw } = item.personality;
      const row = (cls, label, t) => {
        const r = document.createElement('div');
        r.className = `p-row ${cls}`;
        r.innerHTML = `<b class="chip ${cls}"></b><span class="p-tip"></span>`;
        r.querySelector('.chip').textContent = `${label} · ${t.name}`;
        r.querySelector('.p-tip').textContent = t.tip || '';
        return r;
      };
      el.querySelector('.p-body').append(row('good', '优点', virtue), row('bad', '缺点', flaw));
    }
    Sprites.mount(el);
    return el;
  }

  // 一对恋人同时降生：两个头像中间一颗心
  function buildLovers(item) {
    const el = document.createElement('article');
    el.className = 'lovers-card px-box';
    const [a, b] = item.players;
    const face = p => `<span class="gav px-box" style="--edge:${Sprites.accent(p.avatar)}"><span class="sprite" data-sprite="${Sprites.avatar(p.avatar)}"></span></span>`;
    el.innerHTML = `<div class="l-title">一对恋人</div><div class="l-row">${face(a)}<span class="sprite l-heart" data-sprite="heart"></span>${face(b)}</div>` +
      '<div class="l-names"></div><div class="l-sub">一个死去，另一个也活不长了</div>';
    el.querySelector('.l-names').textContent = `「${a.name}」与「${b.name}」`;
    Sprites.mount(el);
    return el;
  }

  // 通灵者看见的轮廓：墙上的那句话（空框照旧）+ 空框里残存的轮廓
  function buildVision(item) {
    const el = document.createElement('article');
    el.className = 'vision-card px-box';
    el.innerHTML = '<div class="v-head"><span class="sprite" data-sprite="eye"></span><span class="v-title"></span>' +
      '<span class="sprite" data-sprite="eye"></span></div><ul class="v-items"></ul>';
    el.querySelector('.v-title').textContent = `通灵者「${item.name}」看见了`;
    const list = el.querySelector('.v-items');
    if (!item.items.length) list.append(Object.assign(document.createElement('li'), { className: 'v-none', textContent: '墙上还没有被抹掉的字，什么也没有看见。' }));
    item.items.forEach(it => {
      const li = document.createElement('li');
      const line = document.createElement('span');
      line.className = 'v-line';
      String(it.line).split('□').forEach((part, j) => {
        if (j) line.append(Object.assign(document.createElement('span'), { className: 'blank', textContent: '□' }));
        line.append(part);
      });
      li.append(line, Object.assign(document.createElement('span'), { className: 'v-outline', textContent: it.outline }));
      list.append(li);
    });
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
      `<span class="sprite skull" data-sprite="${DEATH_ICONS[r.kind] || 'skull'}"></span>` +
      '<span class="d-body"><span class="d-title"></span><span class="d-cause"></span><span class="d-meta"></span></span>' +
      `<span class="gav px-box"><span class="sprite" data-sprite="${Sprites.avatar(r.avatar)}"></span></span>`;
    el.querySelector('.d-title').textContent = `† ${r.name} ${DEATH_TITLES[r.kind] || '死亡'} †`;
    if (r.special === 'revived') el.classList.add('revived');
    el.classList.add(`k-${r.kind}`); // 被杀害 / 自尽 的死亡框各有颜色
    el.querySelector('.d-cause').textContent = `死因：${r.cause}`;
    el.querySelector('.d-meta').textContent =
      [r.killed_by ? `死于「${r.killed_by}」之手` : '', r.died_round != null ? `第 ${r.died_round} 轮` : '', `存活 ${r.rounds} 轮`, '点击查看生平']
        .filter(Boolean).join(' · ');
    el.querySelector('.d-body').append(HungerVotes.liveBadge(r.id, r.votes)); // 观众的评价：死后也照样能投，跟着变
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
    const cards = { divider: buildDivider, death: buildDeath, persona: buildPersona, lovers: buildLovers, vision: buildVision };
    if (cards[item.kind]) {
      append(cards[item.kind](item));
      setTimeout(next, instant ? 0 : ({ death: 1400, persona: 900, lovers: 1400, vision: 1600 }[item.kind] || 500)); // 死亡后停顿久一点
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
