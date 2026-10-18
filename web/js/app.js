/* 入口：把后端事件（或演示数据）接到对话区和墓园。
 *   有后端（http://…/ 且 /api/state 可访问）→ 实时模式，用 SSE 接收事件；
 *   否则（直接双击 index.html）→ 演示模式，播放 demo.js 里的流程。
 * 调试参数：?instant 跳过打字机和入场动画；?demo 强制演示模式；?empty 演示模式下不放对话；
 *           ?roles=list|detail 打开时直接弹出墓园。 */
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
  };

  const STOP_REASONS = {
    stopped: '已手动暂停', max_rounds: '已达到轮数上限', max_players: '已达到选手数量上限', budget: '已达到费用上限',
  };

  // ---------- 舞台标签：模式 + 当前轮数 ----------
  let mode = '';
  function renderTag() {
    tagEl.textContent = `${mode}${state.round != null ? ` · 第 ${state.round} 轮` : ''}`;
  }
  function setMode(text) { mode = text; renderTag(); }

  // ---------- 事件 → 画面 ----------
  // 状态（在世的人、墓园、轮数）放在 onShow 里更新，这样墓园和对话区的进度一致，不会剧透
  function handleEvent(ev) {
    const instant = INSTANT || !!ev.replay;
    const show = fn => () => {
      if (ev.session != null && ev.session !== state.session) { state.session = ev.session; state.alive.clear(); }
      if (ev.round != null) { state.round = ev.round; renderTag(); }
      if (fn) fn();
    };
    const tick = () => {
      const p = state.alive.get(ev.player_id);
      if (p) p.age = ev.age;
    };
    switch (ev.type) {
      case 'spawn': {
        const p = ev.player;
        HungerChat.add({
          kind: 'divider', icon: 'heart', instant,
          text: `第 ${p.id} 位选手「${p.name}」入场${ev.inherited_last_words ? '，带着前人的遗言' : ''}`,
        }, show(() => state.alive.set(p.id, { id: p.id, name: p.name, avatar: p.avatar, age: 0 })));
        break;
      }
      case 'message':
        HungerChat.add({ kind: 'message', who: ev.who, name: ev.name, avatar: ev.avatar, text: ev.text, instant },
          show(tick));
        break;
      case 'lastwords':
        HungerChat.add({ kind: 'message', who: 'player', name: ev.name, avatar: ev.avatar, text: ev.text,
          ghost: true, instant }, show(tick));
        break;
      case 'death': {
        const r = ev.record;
        HungerChat.add({
          kind: 'death', record: r, instant,
          onOpen: () => HungerRoles.open({ record: r }),
        }, show(() => {
          state.alive.delete(r.id);
          if (!state.live) state.demoGraveyard.push(r);
        }));
        break;
      }
      case 'stop':
        HungerChat.add({ kind: 'divider', icon: 'eye', instant,
          text: `演出暂停（${STOP_REASONS[ev.reason] || ev.reason}）` }, show());
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

  document.querySelectorAll('.px-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'graveyard') HungerRoles.open();
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

  function connectLive() {
    const es = new EventSource('/api/events');
    es.onopen = () => setMode('LIVE');
    es.onerror = () => setMode('重连中…');
    es.onmessage = e => handleEvent(JSON.parse(e.data));
  }

  async function graveyardFromServer() {
    const r = await fetch('/api/graveyard', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  (async function start() {
    Sprites.mount(document);
    state.live = await detectLive();
    HungerRoles.init({
      graveyard: state.live ? graveyardFromServer : async () => state.demoGraveyard.slice(),
      current: () => [...state.alive.values()],
    });
    if (state.live) {
      setMode('LIVE');
      connectLive();
    } else {
      setMode('DEMO');
      if (!params.has('empty')) HungerDemo.EVENTS.forEach(handleEvent);
    }
    const roles = params.get('roles');
    if (roles) setTimeout(() => HungerRoles.open(roles === 'detail' ? { detail: 0 } : undefined), 400);
  })();

  global.HungerUI = { handleEvent, toast, state };
})(window);
