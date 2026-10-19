/* 音乐：点“音乐”按钮开关，按 music/ 里的顺序一首接一首，整个清单循环播放。
 * 清单来自 ../music/playlist.js（python -m ai_related.playlist 生成，服务器每次启动都会重写）。
 * 浏览器不允许网页自己开始放声音，所以默认是关的；开过一次以后会记住，下次打开页面时，在你第一次点击/按键时自动接着放。 */
(function (global) {
  'use strict';

  const KEY = 'hunger.music';
  const INDEX_KEY = 'hunger.music.index';
  const VOLUME = 0.5;
  // 文件名里有空格和点，要逐个编码。路径是相对 web/ 的 ../music/，从 "/" 打开时就是 /music/
  const tracks = (global.MUSIC_PLAYLIST || []).map(name => `../music/${encodeURIComponent(name)}`);
  const btn = document.querySelector('[data-action="music"]');
  const label = btn.querySelector('.label');

  let audio = null;
  let index = 0;
  let playing = false;
  let failures = 0; // 连续加载失败的曲目数，全部失败就停

  const say = text => { if (global.HungerUI) global.HungerUI.toast(text); };
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* 隐私模式等：忽略 */ } };
  const read = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };

  function render() {
    btn.classList.toggle('music-on', playing);
    btn.setAttribute('aria-pressed', String(playing));
    label.textContent = playing ? '音乐·开' : '音乐·关';
  }

  function load(i) {
    index = (i + tracks.length) % tracks.length;
    store(INDEX_KEY, String(index));
    audio.src = tracks[index];
  }

  function stopAll(message) {
    if (audio) audio.pause();
    playing = false;
    store(KEY, '0');
    render();
    if (message) say(message);
  }

  function onTrackError() {
    failures += 1;
    if (failures >= tracks.length) { stopAll('音乐加载失败'); return; }
    load(index + 1); // 这首放不了，跳下一首
    audio.play().catch(() => {});
  }

  function ensureAudio() {
    if (audio) return;
    audio = new Audio();
    audio.preload = 'none'; // 一首 wav 有二三十 MB，没点开就不加载
    audio.volume = VOLUME;
    audio.loop = tracks.length === 1; // 只有一首时单曲循环；多首时放完接下一首，整个清单循环
    audio.addEventListener('ended', () => { load(index + 1); audio.play().catch(() => {}); });
    audio.addEventListener('playing', () => { failures = 0; });
    audio.addEventListener('error', onTrackError);
    load(Number(read(INDEX_KEY)) || 0);
  }

  async function start() {
    if (!tracks.length) { say('music 文件夹里还没有音乐'); return false; }
    ensureAudio();
    try {
      await audio.play();
    } catch (e) {
      if (e && e.name === 'NotAllowedError') return false; // 还没有用户操作，浏览器不让放
      // 其他失败（格式不支持等）由 error 事件处理
    }
    playing = !audio.paused;
    render();
    return playing;
  }

  function toggle() {
    if (playing) { stopAll(); return; }
    store(KEY, '1');
    start();
  }

  // 上次是开着的：等用户的第一次点击/按键就接着放（点的恰好是音乐按钮时，交给它自己的点击处理）
  if (read(KEY) === '1' && tracks.length) {
    const resume = e => {
      if (e.target.closest && e.target.closest('[data-action="music"]')) return;
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
      if (!playing) start();
    };
    document.addEventListener('pointerdown', resume, true);
    document.addEventListener('keydown', resume, true);
  }

  render();
  global.HungerMusic = {
    toggle,
    state: () => ({ playing, index, tracks: tracks.length, src: audio ? audio.src : null, paused: audio ? audio.paused : true }),
    _audio: () => audio, // 调试用
  };
})(window);
