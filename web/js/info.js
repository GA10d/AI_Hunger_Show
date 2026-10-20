/* 信息（点“信息”按钮弹出）：最上面两个标签页切换。
 *   游戏规则 —— 讲给观众听的玩法简介，每一段配一张像素小图；
 *   特殊角色 —— 和圣言一样是封锁的：某种稀有身份第一次出现之后，对应的一条才解锁，点开看详细机制。
 *   HungerInfo.init({ load: async () => ({ seen: { id: { count, first: { name, avatar, round } } }, chances: { id: 概率 } }) })
 *   HungerInfo.open('rules' | 'specials')  /  HungerInfo.close()  /  HungerInfo.nameOf(id) */
(function (global) {
  'use strict';

  const modal = document.getElementById('info');
  const body = document.getElementById('info-body');
  const backBtn = document.getElementById('info-back');
  const closeBtn = document.getElementById('info-close');
  const tabs = [...modal.querySelectorAll('.tab')];

  let provider = { load: async () => ({ seen: {}, chances: {} }) };
  let tab = 'rules';
  let opener = null;
  let token = 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sprite(name, cls) {
    const e = el('span', 'sprite' + (cls ? ' ' + cls : ''));
    e.dataset.sprite = name;
    return e;
  }

  // ---------- 游戏规则：讲给观众听的 ----------
  // art：这一段配的小图。字符串数组 = 一排像素图；'echo' / 'thought' 是两张小示意图
  const RULES = [
    { title: '一场 AI 演给你看的规则怪谈', art: ['eye', 'p0', 'p3'],
      text: '舞台上只有两种角色：「环境」是叙述者，冷冷地描述一切，但从不撒谎；选手是一个个 AI，醒来时对这个世界一无所知。整场演出没有剧本，全由大模型即兴演出。' },
    { title: '看不见的规则', art: ['skull', 'scroll'],
      text: '世界里藏着几条规则，谁违反了就当场处死，但没有人会告诉选手规则是什么。另一个「裁决者」AI 拿着规则，在每次行动之后审判。被触发过的规则，会显现在「圣言」里。' },
    { title: '隐藏的寿命', art: ['heart', 'cross'],
      text: '每位选手的寿命是隐藏的随机数，随时可能耗尽。世界按「轮」计时：每一轮，场上每个人各行动一次。场上最多两个人；有人死去，就会有新人降生。' },
    { title: '遗言：一代代人之间的接力', art: ['candle', 'tomb'],
      text: '选手可以花掉一整次行动留下遗言，之后还能改写。遗言谁也看不到，环境和同伴都听不见，只会传给下一个出生的人。' },
    { title: '回声墙', art: 'echo',
      text: '死者最后说出口的那句话会被刻在墙上，念给后来的人听，但要了他命的那个字会被抹成「□」。后来的人要自己把空框填出来。' },
    { title: '心想：只有你听得见', art: 'thought',
      text: '选手的每次行动都分成两层：虚线的暗色气泡是他脑子里想的，只有观众看得见；实心的气泡才是他说出口的话。' },
    { title: '两个人同场', art: ['p1', 'heart', 'p6'],
      text: '两个人同场时能听到彼此，也可以说只有对方听得到的悄悄话（紫色的气泡），商量谁去冒险、谁去赴死。' },
    { title: '宣告：唯一的出口', art: ['star'],
      text: '想终结循环，选手必须把这个世界的全部真相推理出来，向世界宣告。每人只有一次机会：错了当场死去；对了，所有被困的同胞都会获得自由。' },
    { title: '你能做什么', art: ['thumbUp', 'thumbDown', 'crown'],
      text: '点对话区里选手的头像，可以给他点赞或点踩，所有观众看到的票数都一样。墓园最上面站着人气之星和众矢之的；点赞最多的死者，还有机会复活。' },
    { title: '稀有的出生', art: ['wing', 'cat', 'bard'],
      text: '极少数选手生来就不一样：复活者、猫娘、吟游诗人、赌徒……某种身份第一次出现的时候，「特殊角色」页里对应的那一条才会解锁。' },
  ];

  function ruleArt(art) {
    const box = el('div', 'r-art');
    if (art === 'echo') {
      const line = el('span', 'r-echo');
      line.append('「', Object.assign(el('span', 'blank'), { textContent: '□' }), '先看看前台的铃」');
      box.append(line);
    } else if (art === 'thought') {
      box.append(el('span', 'r-thought', '心想：先别开口……'), el('span', 'r-speech', '钟停了。'));
    } else {
      art.forEach(name => box.append(sprite(Sprites.SPRITES[name] ? name : 'p0')));
    }
    return box;
  }

  function renderRules() {
    token++;
    backBtn.hidden = true;
    const list = el('ol', 'rule-list');
    RULES.forEach((r, i) => {
      const li = el('li', 'rule px-box');
      const main = el('div', 'r-main');
      main.append(el('div', 'r-title', `${i + 1}. ${r.title}`), el('p', 'r-text', r.text));
      li.append(ruleArt(r.art), main);
      list.append(li);
    });
    body.replaceChildren(el('p', 'vintro', '第一次来看？下面是这场演出的玩法。'), list);
    Sprites.mount(body);
    body.scrollTop = 0;
  }

  // ---------- 特殊角色 ----------
  // avatar：列表和详情里用的图（专属头像，或代表它的像素图）；chanceText：概率怎么说
  const SPECIALS = [
    { id: 'revived', name: '复活者', avatar: 'wing', tip: '点赞最多的死者，带着前世的记忆回来了',
      chanceText: c => `每位新人降生时 ${c}`,
      rules: ['有新人降生时，有一定概率来的不是新人，而是墓园里观众点赞最多的那位死者（至少有一个👍、没有复活过、不是胜利者）。',
        '名字、头像、性格都和前世一样。他会被告知自己复活了、上一次是哪句话要了他的命、死时现场是什么样子，还记得前世说过和听过的话。',
        '同场的人和环境也会知道：他是复活归来的。'],
      looks: ['舞台上：金光照下，地里冒出一块墓碑，墓碑碎开，他从地里升起、展开翅膀，此后头顶一直顶着光环。',
        '登场卡片两侧展开一对翅膀；发言框是金边，角上钉着小十字架，名字后面写着「第 N 世」。'] },
    { id: 'catgirl', name: '猫娘', avatar: 'cat', tip: '句尾带「喵」，自称「本喵」',
      rules: ['说话的句尾总爱带上「喵」，自称「本喵」或「人家」；好奇心旺盛、怕水、爱撒娇也爱傲娇。', '但她也只有一条命，这里的危险对她同样是真的。'],
      looks: ['专属的橘色猫耳头像，舞台上身后拖着一条会摇的尾巴。', '粉色的登场卡片和发言框，框顶长着两只猫耳，角上印着爪印。'] },
    { id: 'bard', name: '吟游诗人', avatar: 'bard', tip: '只用诗句说话',
      rules: ['说出口的每一句话都是诗：五言或七言，两句或四句，讲究押韵；留下的遗言是一首诗，宣告也用诗唱出来。', '只有心里想的才是平常的话。'],
      looks: ['插着羽毛的红色贝雷帽头像，开口时头上冒出音符。', '发言框是一卷羊皮纸，上下两根木轴，角上是音符。'] },
    { id: 'gambler', name: '赌徒', avatar: 'gambler', tip: '一出生就押上了自己的寿命',
      rules: ['出生的那一刻就押上了自己的寿命：一半的机会多活 50%，一半的机会只剩一半。登场卡片上会写他赌赢了还是赌输了。',
        '什么决定都当成一场赌局。向世界宣告真相每人只有一次机会，错了就死，对了就赢：那是他眼里最大的一场赌局。'],
      looks: ['戴着荷官的绿色遮阳帽檐，开口时头上转着骰子。', '发言框是绿色的赌桌绒布，金边，角上一颗骰子、一枚金币。'] },
    { id: 'medium', name: '通灵者', avatar: 'medium', tip: '看得见被抹掉的字的轮廓',
      rules: ['回声墙上被抹成「□」的字，在他眼里并没有完全消失：他能看见空框里残存的轮廓，比如几个字、几画、什么结构、什么部首，但看不见那个字本身。',
        '他出生时看一次整面墙；之后墙上每多一个空框，他都会再看一次。他看见的轮廓，观众也能在「通灵者看见了」的卡片里看到。'],
      looks: ['紫色兜帽，额头上一只青色的第三只眼；舞台上头顶偶尔闪一点紫光。', '深紫色的发言框，中间一团幽光，角上一只会眨的眼睛。'] },
    { id: 'believer', name: '信徒', avatar: 'believer', tip: '把「环境」当作神明',
      rules: ['把「环境」当作神明崇拜，说话用祈祷的口吻，称它为「主」或「神」；相信苦难都有意义，愿意为同伴献出自己。', '环境也会被告知：有人把它当作神。'],
      looks: ['棕色修士兜帽，双眼闭着祷告；舞台上说话时会跪下。', '发言框镶着一圈彩色玻璃窗一样的边，角上一支烛台。'] },
    { id: 'earthbound', name: '地缚灵', avatar: 'earthbound', tip: '死后不会离开',
      rules: ['他生来就知道：自己死后不会离开，而会化作地缚灵留在这里。',
        '死后，每隔 3 轮，他可以对一位活着的人低语一句话（30 字以内，最多 4 句），12 轮之后渐渐消散。',
        '低语也要过裁决者：说了不该说的话，会连魂魄都散掉（魂飞魄散）。'],
      looks: ['青白的脸、缝起来的嘴，头顶两节锁链；活着时身边飘着青色的游丝。', '死后灵体化：眼睛变成 × ×，半透明的灵魂拴着锁链在舞台上飘，低语时飘到那个人身边；低语是半透明的虚线气泡。'] },
    { id: 'chronicler', name: '史官', avatar: 'chronicler', tip: '读过 10 条遗言，也把遗言留给 10 个人',
      rules: ['别人只能读到上一个死者的遗言；史官出生时，能读到最近 10 位死者留下的遗言档案。',
        '他自己的遗言不只传给下一个人，而会传给他死后出生的 10 个人。遗言可以改写，传下去的是最后一版。'],
      looks: ['戴着两边带翅的黑色乌纱帽，穿深蓝的官袍。', '发言框是深蓝底、金边，角上一卷书；他的遗言板是一块金色的碑，标题写着「史官的遗言」。',
        '收到史官遗言的新人入场时，分隔条上会写「带着史官「某某」的遗言」。'] },
    { id: 'lover', name: '恋人', avatar: 'heart', tip: '一个死去，另一个也活不长',
      chanceText: c => `两位选手同时降生时 ${c}`,
      rules: ['两位选手同时降生时，有一定概率是一对恋人：他们一见面就知道对方就是那个人。',
        '一个死去之后，另一个只剩最后一次行动，做完就会随之而去（死因：殉情）。'],
      looks: ['发言框是红边，角上两颗心；入场时有一张「一对恋人」的卡片。', '舞台上两人之间连着一根红线，时不时冒出小心心。'] },
  ];
  const pct = x => `${+(x * 100).toFixed(2)}%`;

  async function renderSpecials() {
    const mine = ++token;
    backBtn.hidden = true;
    body.replaceChildren(el('p', 'empty', '读取中…'));
    let data;
    try {
      data = await provider.load();
    } catch (err) {
      if (mine === token) body.replaceChildren(el('p', 'empty', '无法读取，请稍后再试。'));
      return;
    }
    if (mine !== token) return;
    const seen = data.seen || {}, chances = data.chances || {};
    const list = el('ul', 'verse-list');
    SPECIALS.forEach(sp => {
      const s = seen[sp.id], chance = chances[sp.id] != null ? (sp.chanceText ? sp.chanceText(pct(chances[sp.id])) : pct(chances[sp.id])) : '';
      if (!s) { // 还没有人以这个身份出现过：一把锁、“？？？”，只透露有多稀有
        const li = el('li', 'verse hidden px-box');
        const main = el('div', 'vmain');
        main.append(el('div', 'vtitle', '？？？'), el('p', 'vtext', '还没有人以这个身份出现过。第一个出现的那一刻，这一条才会解锁。'));
        li.append(sprite('lock', 'vicon'), main, el('span', 'vtag', chances[sp.id] != null ? `稀有度 ${pct(chances[sp.id])}` : '尚未出现'));
        list.append(li);
        return;
      }
      const li = el('li');
      const btn = el('button', 'verse lit sp-entry px-box');
      btn.type = 'button';
      const main = el('div', 'vmain');
      main.append(el('div', 'vtitle', sp.name), el('p', 'vtext', sp.tip));
      btn.append(sprite(sp.avatar, 'vicon'), main, el('span', 'vcount hot', `出现过 ${s.count} 次`));
      btn.addEventListener('click', () => showDetail(sp, s, chance));
      li.append(btn);
      list.append(li);
    });
    const n = SPECIALS.filter(sp => seen[sp.id]).length;
    body.replaceChildren(el('p', 'vintro', `极少数选手生来就不一样。已经解锁 ${n} / ${SPECIALS.length} 种；点开看他们的详细机制。`), list);
    Sprites.mount(body);
    body.scrollTop = 0;
  }

  function showDetail(sp, s, chance) {
    token++;
    backBtn.hidden = false;
    const art = el('article', 'bio sp-detail');
    const head = el('div', 'bio-head');
    const face = el('span', 'gav px-box big');
    face.style.setProperty('--edge', Sprites.accent(sp.avatar) || 'var(--gold)');
    face.append(sprite(sp.avatar));
    const info = el('div', 'bio-info');
    info.append(el('div', 'gname', sp.name), el('div', 'gcause', sp.tip));
    const meta = [chance && `稀有度：${chance}`, `出现过 ${s.count} 次`].filter(Boolean).join(' · ');
    info.append(el('div', 'gmeta', meta));
    if (s.first) info.append(el('div', 'gmeta', `第一次出现：「${s.first.name}」，第 ${s.first.round} 轮`));
    head.append(face, info);
    const list = items => { const ul = el('ul', 'sp-points'); items.forEach(t => ul.append(el('li', null, t))); return ul; };
    art.append(head, el('h3', null, '机制'), list(sp.rules), el('h3', null, '怎么认出他'), list(sp.looks));
    body.replaceChildren(art);
    Sprites.mount(body);
    body.scrollTop = 0;
    backBtn.focus();
  }

  // ---------- 标签页 / 弹窗 ----------
  function show(name) {
    tab = name;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    if (name === 'specials') renderSpecials(); else renderRules();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...modal.querySelectorAll('button:not([hidden])')];
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(which) {
    opener = document.activeElement;
    modal.hidden = false;
    document.addEventListener('keydown', onKey);
    closeBtn.focus();
    show(which || tab);
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
    backBtn.addEventListener('click', () => show(tab));
    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
  }

  const nameOf = id => (SPECIALS.find(sp => sp.id === id) || {}).name || id;

  global.HungerInfo = { init, open, close, nameOf };
})(window);
