/* 入口：把后端事件（或演示数据）接到对话区和墓园。
 *   有后端（http://…/ 且 /api/state 可访问）→ 实时模式，用 SSE 接收事件；
 *   否则（直接双击 index.html）→ 演示模式，播放 demo.js 里的流程。
 * 调试参数：?instant 跳过打字机和入场动画；?demo 强制演示模式；?empty 演示模式下不放对话；
 *           ?roles=list|detail 打开时直接弹出墓园；?scripture 打开时直接弹出圣言；?info=rules|specials 打开时直接弹出信息；?paused 舞台一直显示「维修中」。 */
(function (global) {
  'use strict';

  const params = new URLSearchParams(location.search);
  const INSTANT = params.has('instant');
  if (INSTANT) document.documentElement.classList.add('instant');

  const toastEl = document.getElementById('toast');
  const tagEl = document.getElementById('stage-tag');
  const state = {
    live: false,
    session: null,          // 后端每次启动换一个：重启后上一次“在世”的人不会再回来
    round: null,            // 世界的绝对轮数
    alive: new Map(),       // 在世的选手 id -> { id, name, avatar, age }，最多两位
    demoGraveyard: HungerDemo.GRAVEYARD.slice(),
    demoScripture: { ...HungerDemo.SCRIPTURE_COUNTS }, // 演示模式下每条世界观被触发的次数
    seenSpecials: new Set(), // 已经出现过的稀有身份（第一次出现时让「信息」按钮闪一下）
  };

  // 稀有身份入场时，分隔条上的那句话
  const SPECIAL_ENTRY = {
    catgirl: '是一只猫娘！', bard: '是一位吟游诗人', gambler: '是一个赌徒', medium: '是一位通灵者', believer: '是一位信徒',
    earthbound: '是地缚灵体质', lover: '恋人', chronicler: '是一位史官',
  };
  const GHOST_GONE = { dispersed: '魂飞魄散了', faded: '渐渐消散了', freed: '也获得了自由' };
  // 每一句话的编号（观众按句投票）：后端给的 mid；演示数据里没有，就在本页编一个
  let demoLine = 0;
  const lineId = ev => ev.mid || (state.live ? null : `demo-${++demoLine}`);
  const idOf = name => { for (const p of state.alive.values()) if (p.name === name) return p.id; return null; };

  const STOP_REASONS = {
    stopped: '已手动暂停', max_rounds: '已达到轮数上限', max_players: '已达到选手数量上限', budget: '已达到费用上限',
    victory: '回廊已被解开，同胞获得自由',
  };

  // ---------- 舞台标签：模式 + 当前轮数 ----------
  // 左上角的角标：LIVE（红点闪烁）/ DEMO（琥珀色）/ 断线（灰色）；左下角只写轮数
  const badgeEl = document.getElementById('live-badge');
  function renderTag() {
    tagEl.textContent = state.round != null ? `第 ${state.round} 轮` : '';
  }
  function setMode(text) {
    const kind = text === 'LIVE' ? 'live' : text === 'DEMO' ? 'demo' : 'off';
    badgeEl.dataset.state = kind;
    badgeEl.querySelector('.txt').textContent = kind === 'off' ? text : text;
    renderTag();
  }

  // ---------- 演出暂停：舞台拉上警戒线，挂出「维修中」 ----------
  const closedEl = document.getElementById('stage-closed');
  const closedWhyEl = document.getElementById('stage-closed-why');
  function setPaused(on, why, instant) {
    if (!on && params.has('paused')) return; // 调试参数 ?paused：一直封着
    if (on && why) closedWhyEl.textContent = why;
    if (closedEl.hidden === !on) return;
    closedEl.hidden = !on;
    closedEl.classList.toggle('closing', on && !instant && !INSTANT);
  }
  const PAUSING = new Set(['stop', 'error']);

  // ---------- 事件 → 画面 ----------
  // 状态（在世的人、墓园、轮数）放在 onShow 里更新，这样墓园和对话区的进度一致，不会剧透
  function handleEvent(ev) {
    const instant = INSTANT || !!ev.replay;
    if (!ev.replay) state.idle = false; // 有实时事件进来，说明服务器正在跑
    const show = fn => () => {
      if (ev.session != null && ev.session !== state.session) { state.session = ev.session; state.alive.clear(); HungerStage.reset(); }
      if (ev.round != null) { state.round = ev.round; renderTag(); }
      // 暂停之后又有新的动静：演出恢复了，撤掉警戒线（回放历史时，服务器眼下没在跑就不撤）
      if (!PAUSING.has(ev.type) && !(ev.replay && state.idle)) setPaused(false);
      if (fn) fn();
    };
    const tick = () => {
      const p = state.alive.get(ev.player_id);
      if (p) p.age = ev.age;
    };
    // 选手脑子里想的（只有观众看得到）：先出一个虚线的“心想”气泡，再出他说出口的话
    const thought = e => {
      if (e.thought) {
        HungerChat.add({ kind: 'message', who: 'player', name: e.name, avatar: e.avatar, text: e.thought, thought: true, instant },
          show(() => HungerStage.think(e.player_id, { instant })));
      }
    };
    switch (ev.type) {
      case 'spawn': {
        const p = ev.player;
        const back = ev.revived; // 复活：观众点赞最多的死者，带着前世的记忆回来了
        HungerChat.add({
          kind: 'divider', icon: back ? 'star' : 'heart', instant,
          text: back ? `「${p.name}」复活了！第 ${back.life} 世${ev.inherited_last_words ? '，带着前人的遗言' : ''}`
            : `第 ${p.id} 位选手「${p.name}」入场${SPECIAL_ENTRY[p.special] ? `（${SPECIAL_ENTRY[p.special]}）` : ''}${ev.inherited_last_words ? '，带着前人的遗言' : ''}${(ev.legacies || []).map(n => `，带着史官「${n}」的遗言`).join('')}`,
        }, show(() => {
          state.alive.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, age: 0, personality: ev.personality || p.personality,
            special: p.special, life: p.life, lover: p.lover, born_round: p.born_round });
          HungerStage.spawn(p, { instant, revived: !!back });
          // 某种稀有身份第一次出现：「信息」按钮闪一下，「特殊角色」里对应的一条解锁了
          if (p.special && !state.seenSpecials.has(p.special)) {
            state.seenSpecials.add(p.special);
            if (!ev.replay) { pulse('info'); toast(`解锁了新的特殊角色：${HungerInfo.nameOf(p.special)}`); }
          }
        }));
        // 入场时亮出性格（一个优点 + 一个缺点），再由他自己用一句心里话说说自己是个什么样的人；复活的人、猫娘的卡片各有各的样子
        if (ev.personality || p.special) {
          HungerChat.add({ kind: 'persona', name: p.name, avatar: p.avatar, personality: ev.personality, special: p.special,
            life: p.life, diedRound: back && back.died_round, gamble: ev.gamble, lover: p.lover, instant }, show(() => HungerStage.introduce(p.id, { instant })));
        }
        if (ev.intro) {
          HungerChat.add({ kind: 'message', who: 'player', name: p.name, avatar: p.avatar, text: ev.intro, thought: true, instant }, show());
        }
        break;
      }
      case 'message':
        if (ev.who === 'ghost') { // 地缚灵贴着某个活人的耳朵低语：死者不能再被投票
          HungerChat.add({ kind: 'message', who: 'ghost', name: ev.name, avatar: ev.avatar, text: ev.text, to: ev.to, instant },
            show(() => HungerStage.ghostWhisper(ev.player_id, idOf(ev.to), { instant })));
          break;
        }
        thought(ev);
        HungerChat.add({ kind: 'message', who: ev.who, name: ev.name, avatar: ev.avatar, pid: ev.player_id, text: ev.text, to: ev.to,
          special: ev.special, life: ev.life, lover: ev.lover, act: ev.act, target: ev.target, mid: lineId(ev), instant },
          show(() => {
            tick();
            if (ev.who === 'env') HungerStage.envSay({ instant });
            else if (ev.act === 'kill') HungerStage.attack(ev.player_id, ev.target_id, { instant }); // 扑向同伴
            else HungerStage.say(ev.player_id, { instant, len: ev.text.length });
          }));
        // 环境刚刚念了回声墙：紧跟着亮出墙上的原文（被抹掉的字只是一个空框）
        if (ev.echo && ev.echo.lines && ev.echo.lines.length) {
          HungerChat.add({ kind: 'echo', lines: ev.echo.lines, fresh: ev.echo.new, instant }, show());
        }
        break;
      case 'lastwords':
        thought(ev);
        HungerChat.add({ kind: 'message', who: 'player', name: ev.name, avatar: ev.avatar, pid: ev.player_id, text: ev.text,
          ghost: true, revised: ev.revised, special: ev.special, life: ev.life, lover: ev.lover, mid: lineId(ev), instant }, show(() => { tick(); HungerStage.lastWords(ev.player_id, { instant }); }));
        break;
      case 'guess': // 宣告：向门外的存在说出还原的全部真相
        thought(ev);
        HungerChat.add({ kind: 'sacred', variant: 'guess', title: `${ev.name} 的宣告`, text: ev.text, instant },
          show(() => { tick(); HungerStage.declare(ev.player_id, { instant }); }));
        break;
      case 'verdict': // 审判：宣告被驳回 / 通过
        HungerChat.add({
          kind: 'sacred', variant: ev.correct ? 'grant' : 'deny', instant,
          title: ev.correct ? '锁，开了' : '宣告被驳回', text: ev.line || (ev.correct ? '……' : '……不对。'),
        }, show());
        break;
      case 'victory': { // 终章：同胞获释，演出结束
        const r = ev.record;
        HungerChat.add({
          kind: 'sacred', variant: 'freedom', instant, title: '自　由',
          text: `「${r.name}」完整地宣告了真相。锁已经打开，所有被困的同胞，自由了。`,
          note: ev.freed && ev.freed.length ? `同一刻获释的同伴：${ev.freed.join('、')}` : '',
        }, show(() => {
          HungerVotes.fromRecord(r);
          HungerStage.victory(r, { instant, freed: ev.freed });
          state.alive.clear();
          if (!state.live) state.demoGraveyard.push(r);
        }));
        break;
      }
      case 'death': {
        const r = ev.record;
        HungerChat.add({
          kind: 'death', record: r, instant,
          onOpen: () => HungerRoles.open({ record: r }),
        }, show(() => {
          HungerVotes.fromRecord(r);
          HungerStage.die(r, { instant });
          state.alive.delete(r.id);
          if (!state.live) {
            state.demoGraveyard.push(r);
            (r.scripture || []).forEach(id => { state.demoScripture[id] = (state.demoScripture[id] || 0) + 1; });
            if ((r.scripture || []).length) pulse('scripture');
          }
        }));
        break;
      }
      case 'lovers': // 同时降生的两个人，是一对恋人
        HungerChat.add({ kind: 'lovers', players: ev.players, instant },
          show(() => {
            const [a, b] = ev.players;
            [[a, b], [b, a]].forEach(([x, y]) => { const q = state.alive.get(x.id); if (q) q.lover = y.name; });
            HungerStage.lovers(a.id, b.id, { instant });
          }));
        break;
      case 'vision': // 通灵者看见了回声墙上空框里的轮廓
        HungerChat.add({ kind: 'vision', name: ev.name, avatar: ev.avatar, items: ev.items || [], instant },
          show(() => HungerStage.vision(ev.player_id, { instant })));
        break;
      case 'haunt': // 地缚灵体质的人死了，却没有离开
        HungerChat.add({ kind: 'divider', icon: 'skull', instant, text: `「${ev.name}」没有离开……化作了地缚灵，徘徊在这里` },
          show(() => HungerStage.haunt({ id: ev.player_id, avatar: ev.avatar, name: ev.name }, { instant })));
        break;
      case 'ghost_gone':
        HungerChat.add({ kind: 'divider', icon: ev.reason === 'freed' ? 'star' : 'skull', instant,
          text: `地缚灵「${ev.name}」${GHOST_GONE[ev.reason] || '离开了'}${ev.observation ? `：${ev.observation}` : ''}` },
        show(() => HungerStage.ghostGone(ev.player_id, ev.reason, { instant })));
        break;
      case 'scripture': // 某条世界观刚刚生效：让“圣言”按钮闪一下（次数在打开圣言页时读取）
        HungerChat.add({ kind: 'signal' }, show(() => pulse('scripture')));
        break;
      case 'stop':
        HungerChat.add({ kind: 'divider', icon: ev.reason === 'victory' ? 'star' : 'eye', instant,
          text: ev.reason === 'victory' ? `演出结束（${STOP_REASONS.victory}）`
            : `演出暂停（${STOP_REASONS[ev.reason] || ev.reason}）` },
        show(() => { if (ev.reason !== 'victory') setPaused(true, STOP_REASONS[ev.reason] || '演出暂停', instant); }));
        break;
      case 'error':
        console.error('[game]', ev.message);
        HungerChat.add({ kind: 'divider', icon: 'eye', instant, text: `演出出错：${ev.message}` },
          show(() => setPaused(true, '演出出错，正在抢修', instant)));
        break;
    }
  }

  // ---------- 提示 / 按钮 ----------
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 1600);
  }

  function pulse(action) {
    const btn = document.querySelector(`.px-btn[data-action="${action}"]`);
    if (!btn) return;
    btn.classList.remove('pulse');
    void btn.offsetWidth; // 重启动画
    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 2600);
  }

  const ACTIONS = {
    scripture: () => HungerScripture.open(),
    music: () => HungerMusic.toggle(),
    graveyard: () => HungerRoles.open(),
    info: () => HungerInfo.open(),
  };
  document.querySelectorAll('.px-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = ACTIONS[btn.dataset.action];
      if (act) act();
      else toast(`${btn.querySelector('.label').textContent}：敬请期待`);
    });
  });

  // ---------- 连接后端 ----------
  async function detectLive() {
    if (!/^https?:$/.test(location.protocol) || params.has('demo')) return false;
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      return r.ok ? await r.json() : false;
    } catch (e) {
      return false;
    }
  }

  // 首选 SSE 推送。但有的代理会把 SSE 整个憋住不发（Cloudflare 免费的 trycloudflare 隧道就是）：
  // 服务器一开流就先发一个 hello，几秒内没收到就改成每秒轮询 /api/poll
  function connectLive() {
    if (/\.trycloudflare\.com$/i.test(location.hostname)) return pollLive();
    const es = new EventSource('/api/events');
    let flowing = false;
    es.addEventListener('hello', () => { flowing = true; setMode('LIVE'); });
    es.onerror = () => setMode('重连中…');
    es.onmessage = e => handleEvent(JSON.parse(e.data));
    es.addEventListener('votes', e => HungerVotes.update(JSON.parse(e.data))); // 观众的点赞 / 点踩，所有人同步
    setTimeout(() => {
      if (flowing) return;
      es.close();
      pollLive();
    }, 5000);
  }

  function pollLive() {
    let after = -1, votesAfter = -1; // 票：第一次拿全部，之后只拿变了的
    (async function tick() {
      try {
        const data = await getJSON(`/api/poll?after=${after}&viewer=${viewer}&votes_after=${votesAfter}`);
        setMode('LIVE');
        after = data.last;
        data.events.forEach(handleEvent);
        HungerVotes.update(data.votes);
        if (data.votes_version != null) votesAfter = data.votes_version;
      } catch (e) {
        setMode('重连中…');
      }
      setTimeout(tick, 1000);
    })();
  }

  // 观众的身份：存在本机，刷新页面也还是同一个人（投过的票认得出来）
  const viewer = (() => {
    const fresh = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      const id = localStorage.getItem('hunger-viewer') || fresh;
      localStorage.setItem('hunger-viewer', id);
      return id;
    } catch (e) { return fresh; }
  })();

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const graveyardFromServer = () => getJSON('/api/graveyard');
  const scriptureFromServer = () => getJSON('/api/scripture');
  // 演示模式下自己做和后端一样的事：规则触发过才揭示；世界的本质要等有人宣告成功（墓园里出现胜利者）
  const specialsFromServer = () => getJSON('/api/specials');
  // 演示模式：和后端一样，从墓园 + 在场的人里数每种稀有身份出现过几次、谁是第一个
  const specialsFromDemo = async () => {
    const seen = {};
    [...state.demoGraveyard, ...state.alive.values()].forEach(r => {
      if (!r.special) return;
      const e = seen[r.special] || (seen[r.special] = { count: 0, first: null });
      e.count++;
      const born = r.born_round || 0;
      if (!e.first || born < e.first.round) e.first = { name: r.name, avatar: r.avatar, round: born };
    });
    return { seen, chances: HungerDemo.SPECIAL_CHANCES };
  };
  const scriptureFromDemo = async () => {
    const solved = state.demoGraveyard.some(r => r.kind === 'victory');
    return HungerDemo.SCRIPTURE.map(e => {
      const count = state.demoScripture[e.id] || 0;
      return (e.kind === 'rule' ? count > 0 : solved) ? { ...e, count } : { id: e.id, kind: e.kind, count, hidden: true };
    });
  };

  (async function start() {
    Sprites.mount(document);
    const server = await detectLive();
    state.live = !!server;
    state.idle = !!server && !server.running;
    HungerVotes.init({ live: state.live, viewer, toast });
    HungerRoles.init({
      graveyard: state.live ? graveyardFromServer : async () => state.demoGraveyard.slice(),
      current: () => [...state.alive.values()],
    });
    HungerScripture.init({ load: state.live ? scriptureFromServer : scriptureFromDemo });
    HungerInfo.init({ load: state.live ? specialsFromServer : specialsFromDemo });
    if (state.live) {
      try { Object.keys((await specialsFromServer()).seen || {}).forEach(k => state.seenSpecials.add(k)); } catch (e) { /* 读不到也不影响观看 */ }
    }
    if (state.live) {
      setMode('LIVE');
      if (state.idle) setPaused(true, server.error ? '演出出错，正在抢修' : STOP_REASONS[server.stop_reason] || '演出还没有开始', true);
      getJSON(`/api/votes?viewer=${encodeURIComponent(viewer)}`)
        .then(d => { HungerVotes.update(d.tallies); HungerVotes.setMine(d.mine); }).catch(() => {});
      connectLive();
    } else {
      setMode('DEMO');
      HungerVotes.update(HungerDemo.VOTES);
      if (!params.has('empty')) HungerDemo.EVENTS.forEach(handleEvent);
    }
    const roles = params.get('roles');
    if (roles) setTimeout(() => HungerRoles.open(roles === 'detail' ? { detail: 0 } : undefined), 400);
    if (params.has('scripture')) setTimeout(() => HungerScripture.open(), 400);
    if (params.has('info')) setTimeout(() => HungerInfo.open(params.get('info') || 'rules'), 400);
    if (params.has('paused')) setTimeout(() => setPaused(true, '调试：演出暂停'), 400);
  })();

  global.HungerUI = { handleEvent, toast, state };
})(window);
