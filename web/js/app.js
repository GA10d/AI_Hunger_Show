/* 入口：把后端事件（或演示数据）接到对话区和墓园。
 *   有后端（http://…/ 且 /api/state 可访问）→ 实时模式，用 SSE 接收事件；
 *   否则（直接双击 index.html）→ 演示模式，播放 demo.js 里的流程。
 * 调试参数：?instant 跳过打字机和入场动画；?demo 强制演示模式；?empty 演示模式下不放对话；
 *           ?roles=list|detail 打开时直接弹出墓园；?scripture 打开时直接弹出圣言。 */
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
  };

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

  // ---------- 事件 → 画面 ----------
  // 状态（在世的人、墓园、轮数）放在 onShow 里更新，这样墓园和对话区的进度一致，不会剧透
  function handleEvent(ev) {
    const instant = INSTANT || !!ev.replay;
    const show = fn => () => {
      if (ev.session != null && ev.session !== state.session) { state.session = ev.session; state.alive.clear(); HungerStage.reset(); }
      if (ev.round != null) { state.round = ev.round; renderTag(); }
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
        HungerChat.add({
          kind: 'divider', icon: 'heart', instant,
          text: `第 ${p.id} 位选手「${p.name}」入场${ev.inherited_last_words ? '，带着前人的遗言' : ''}`,
        }, show(() => {
          state.alive.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, age: 0, personality: ev.personality || p.personality });
          HungerStage.spawn(p, { instant });
        }));
        // 入场时亮出性格（一个优点 + 一个缺点），再由他自己用一句心里话说说自己是个什么样的人
        if (ev.personality) {
          HungerChat.add({ kind: 'persona', name: p.name, avatar: p.avatar, personality: ev.personality, instant }, show(() => HungerStage.introduce(p.id, { instant })));
        }
        if (ev.intro) {
          HungerChat.add({ kind: 'message', who: 'player', name: p.name, avatar: p.avatar, text: ev.intro, thought: true, instant }, show());
        }
        break;
      }
      case 'message':
        thought(ev);
        HungerChat.add({ kind: 'message', who: ev.who, name: ev.name, avatar: ev.avatar, text: ev.text, to: ev.to, instant },
          show(() => {
            tick();
            if (ev.who === 'env') HungerStage.envSay({ instant });
            else HungerStage.say(ev.player_id, { instant, len: ev.text.length });
          }));
        // 环境刚刚念了回声墙：紧跟着亮出墙上的原文（被抹掉的字只是一个空框）
        if (ev.echo && ev.echo.lines && ev.echo.lines.length) {
          HungerChat.add({ kind: 'echo', lines: ev.echo.lines, fresh: ev.echo.new, instant }, show());
        }
        break;
      case 'lastwords':
        thought(ev);
        HungerChat.add({ kind: 'message', who: 'player', name: ev.name, avatar: ev.avatar, text: ev.text,
          ghost: true, instant }, show(() => { tick(); HungerStage.lastWords(ev.player_id, { instant }); }));
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
      case 'scripture': // 某条世界观刚刚生效：让“圣言”按钮闪一下（次数在打开圣言页时读取）
        HungerChat.add({ kind: 'signal' }, show(() => pulse('scripture')));
        break;
      case 'stop':
        HungerChat.add({ kind: 'divider', icon: ev.reason === 'victory' ? 'star' : 'eye', instant,
          text: ev.reason === 'victory' ? `演出结束（${STOP_REASONS.victory}）`
            : `演出暂停（${STOP_REASONS[ev.reason] || ev.reason}）` }, show());
        break;
      case 'error':
        console.error('[game]', ev.message);
        HungerChat.add({ kind: 'divider', icon: 'eye', instant, text: `演出出错：${ev.message}` }, show());
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
      return (await fetch('/api/state', { cache: 'no-store' })).ok;
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
    setTimeout(() => {
      if (flowing) return;
      es.close();
      pollLive();
    }, 5000);
  }

  function pollLive() {
    const viewer = Math.random().toString(36).slice(2);
    let after = -1;
    (async function tick() {
      try {
        const data = await getJSON(`/api/poll?after=${after}&viewer=${viewer}`);
        setMode('LIVE');
        after = data.last;
        data.events.forEach(handleEvent);
      } catch (e) {
        setMode('重连中…');
      }
      setTimeout(tick, 1000);
    })();
  }

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  const graveyardFromServer = () => getJSON('/api/graveyard');
  const scriptureFromServer = () => getJSON('/api/scripture');
  // 演示模式下自己做和后端一样的事：规则触发过才揭示；世界的本质要等有人宣告成功（墓园里出现胜利者）
  const scriptureFromDemo = async () => {
    const solved = state.demoGraveyard.some(r => r.kind === 'victory');
    return HungerDemo.SCRIPTURE.map(e => {
      const count = state.demoScripture[e.id] || 0;
      return (e.kind === 'rule' ? count > 0 : solved) ? { ...e, count } : { id: e.id, kind: e.kind, count, hidden: true };
    });
  };

  (async function start() {
    Sprites.mount(document);
    state.live = await detectLive();
    HungerRoles.init({
      graveyard: state.live ? graveyardFromServer : async () => state.demoGraveyard.slice(),
      current: () => [...state.alive.values()],
    });
    HungerScripture.init({ load: state.live ? scriptureFromServer : scriptureFromDemo });
    if (state.live) {
      setMode('LIVE');
      connectLive();
    } else {
      setMode('DEMO');
      if (!params.has('empty')) HungerDemo.EVENTS.forEach(handleEvent);
    }
    const roles = params.get('roles');
    if (roles) setTimeout(() => HungerRoles.open(roles === 'detail' ? { detail: 0 } : undefined), 400);
    if (params.has('scripture')) setTimeout(() => HungerScripture.open(), 400);
  })();

  global.HungerUI = { handleEvent, toast, state };
})(window);
