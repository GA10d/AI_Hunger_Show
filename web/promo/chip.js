/* 芯片音乐合成器：WebAudio 现场合成 8-bit 声音（方波 / 三角波 / 噪声），不需要任何音频文件。
 *   Chip.load(events)   事件表：{ t 秒, v 音色, m MIDI 音高 | hz, d 时长, g 音量, ... }，按 t 排好序
 *   Chip.start(offset)  从第 offset 秒开始播放      Chip.stop()   停止
 *   Chip.time()         当前播放到第几秒（画面以它为准，所以音画永远对齐）
 *   Chip.stream         MediaStream，录制视频时把声音接进去
 *   Chip.renderOffline() 离线渲染整首曲子（AudioBuffer），Chip.wav(buffer) 转成 WAV
 * 音色：p12 / p25 / p50（占空比 12.5% / 25% / 50% 的方波）、tri（三角波）、sine、noise（噪声）、
 *       kick / snare / hat / crash（鼓，内部展开成上面几种）。 */
(function (global) {
  'use strict';

  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const LOOKAHEAD = 0.6; // 提前排多少秒：后台标签页里定时器会变慢，排远一点不容易断

  let ac = null, out = null, noise = null, waves = {};
  let events = [], idx = 0, t0 = 0, playing = false, timer = 0, pausedAt = 0;
  const live = new Set();
  const api = { stream: null };

  function ensure() {
    if (ac) return true;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    build(new AC());
    return true;
  }

  // 在 ctx 上搭好输出链路、噪声和方波表
  function build(ctx) {
    ac = ctx;
    out = ac.createGain();
    out.gain.value = 0.6;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.2;
    out.connect(comp);
    comp.connect(ac.destination);
    if (ac.createMediaStreamDestination) { // 离线渲染时没有这个
      const dest = ac.createMediaStreamDestination();
      comp.connect(dest);
      api.stream = dest.stream;
    }
    // 噪声：每两个采样换一个值，听起来更“粗”，像老游戏机
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { if (i % 2 === 0) v = Math.random() * 2 - 1; d[i] = v; }
    noise = buf;
    for (const [k, duty] of [['p12', 0.125], ['p25', 0.25], ['p50', 0.5]]) {
      const N = 40, re = new Float32Array(N), im = new Float32Array(N);
      for (let n = 1; n < N; n++) re[n] = 2 / (n * Math.PI) * Math.sin(n * Math.PI * duty);
      waves[k] = ac.createPeriodicWave(re, im);
    }
  }

  // 离线渲染整首曲子，返回 AudioBuffer（导出配乐、或者检查音量用）
  async function renderOffline(from = 0, to = null) {
    const saved = [ac, out, noise, waves, api.stream];
    const end = to ?? (events.length ? events[events.length - 1].t + 4 : 1);
    const rate = 44100;
    try {
      waves = {};
      build(new OfflineAudioContext(2, Math.ceil((end - from) * rate), rate));
      offline = true;
      events.forEach(e => { if (e.t >= from && e.t < end) voice(e, e.t - from); });
      return await ac.startRendering();
    } finally {
      offline = false;
      [ac, out, noise, waves, api.stream] = saved;
    }
  }

  // AudioBuffer → 16 位 WAV
  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, view = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
    view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * ch * 2, true);
    view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) view.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
    return new Blob([view], { type: 'audio/wav' });
  }

  let offline = false;
  function track(src) {
    if (offline) return;
    live.add(src);
    src.onended = () => live.delete(src);
  }

  // 一个音：起音 a → 持续 d（sus < 1 时指数衰减到 vol × sus）→ 释放 r
  function voice(e, when) {
    const vol = e.g ?? 0.1, dur = e.d ?? 0.2, a = e.a ?? 0.004, r = e.r ?? 0.04, sus = e.sus ?? 1;
    const g = ac.createGain();
    let src;
    if (e.v === 'noise') {
      src = ac.createBufferSource();
      src.buffer = noise; src.loop = true;
      src.playbackRate.value = e.rate || 1;
      if (e.hp || e.lp || e.bp) {
        const f = ac.createBiquadFilter();
        f.type = e.hp ? 'highpass' : e.lp ? 'lowpass' : 'bandpass';
        f.frequency.setValueAtTime(e.hp || e.lp || e.bp, when);
        if (e.sweep) f.frequency.exponentialRampToValueAtTime(e.sweep, when + dur);
        if (e.q) f.Q.value = e.q;
        src.connect(f); f.connect(g);
      } else src.connect(g);
    } else {
      src = ac.createOscillator();
      if (e.v === 'tri') src.type = 'triangle';
      else if (e.v === 'sine') src.type = 'sine';
      else src.setPeriodicWave(waves[e.v] || waves.p50);
      const f0 = e.hz || hz(e.m);
      src.frequency.setValueAtTime(f0, when);
      if (e.to != null) src.frequency.exponentialRampToValueAtTime(Math.max(20, e.toHz || hz(e.to)), when + (e.slide ?? dur));
      if (e.vib) { // 颤音
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = 5.5; lg.gain.value = f0 * 0.012 * e.vib;
        lfo.connect(lg); lg.connect(src.frequency);
        lfo.start(when + 0.15); lfo.stop(when + dur + r + 0.05);
        track(lfo);
      }
      src.connect(g);
    }
    g.connect(out);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + a);
    if (sus < 1) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * sus), when + Math.max(a + 0.002, dur));
    else g.gain.setValueAtTime(vol, when + dur);
    g.gain.linearRampToValueAtTime(0.0001, when + dur + r);
    src.start(when);
    src.stop(when + dur + r + 0.03);
    track(src);
  }

  // 鼓：展开成基本音色
  function expand(e) {
    const g = e.g ?? 1;
    switch (e.v) {
      case 'kick': return [{ t: e.t, v: 'sine', hz: 160, toHz: 42, slide: 0.12, d: 0.16, sus: 0.05, g: 0.55 * g, r: 0.03 },
        { t: e.t, v: 'noise', lp: 900, d: 0.03, sus: 0.1, g: 0.12 * g }];
      case 'snare': return [{ t: e.t, v: 'noise', hp: 1400, d: 0.14, sus: 0.02, g: 0.2 * g },
        { t: e.t, v: 'tri', hz: 200, toHz: 120, d: 0.08, sus: 0.1, g: 0.18 * g }];
      case 'hat': return [{ t: e.t, v: 'noise', hp: 7000, d: e.d ?? 0.035, sus: 0.05, g: 0.07 * g }];
      case 'crash': return [{ t: e.t, v: 'noise', hp: 3200, d: e.d ?? 1.6, sus: 0.01, g: 0.16 * g, r: 0.1 }];
      default: return [e];
    }
  }

  function load(list) {
    events = list.flatMap(expand).sort((a, b) => a.t - b.t);
  }

  function pump() {
    if (!playing) return;
    const now = time(), horizon = now + LOOKAHEAD;
    while (idx < events.length && events[idx].t < horizon) {
      const e = events[idx++];
      if (e.t >= now - 0.03) voice(e, t0 + Math.max(e.t, now));
    }
  }

  function silence() {
    live.forEach(s => { try { s.stop(); } catch (_) { /* 已经停了 */ } });
    live.clear();
  }

  function start(offset = 0) {
    if (!ensure()) { // 没有 WebAudio：只用时钟
      playing = true; t0 = performance.now() / 1000 - offset; return;
    }
    ac.resume();
    silence();
    clearInterval(timer);
    t0 = ac.currentTime + 0.08 - offset;
    idx = events.findIndex(e => e.t >= offset);
    if (idx < 0) idx = events.length;
    playing = true;
    timer = setInterval(pump, 25);
    pump();
  }

  function stop() {
    if (!playing) return;
    pausedAt = time();
    playing = false;
    clearInterval(timer);
    if (ac) silence();
  }

  function time() {
    if (!playing) return pausedAt;
    return ac ? ac.currentTime - t0 : performance.now() / 1000 - t0;
  }

  Object.assign(api, { load, start, stop, time, hz, ensure, renderOffline, wav });
  Object.defineProperty(api, 'playing', { get: () => playing });
  global.Chip = api;
})(window);
