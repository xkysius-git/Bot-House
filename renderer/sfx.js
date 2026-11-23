/* Bot House — 기기 효과음 (Web Audio로 직접 합성, 외부 음원 없음)
   사용: Sfx.play('expand')  // 펼칠 때 "치킹!"
         Sfx.play('collapse') // 접을 때 "철컥"
         Sfx.play('click')    // 버튼 누름
         Sfx.setEnabled(false)
   설정 soundOn(electron store)과 연결은 app.js에서 Sfx.setEnabled(settings.soundOn) 한 줄. */
(function () {
  'use strict';

  let ctx = null;
  let enabled = true;
  let volume = 0.5;

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // 짧은 금속성 "탁" (노이즈 버스트 + 밴드패스)
  function clack(t, { freq = 2400, q = 6, dur = 0.05, gain = 0.6 } = {}) {
    const a = ctx;
    const len = Math.ceil(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = a.createBufferSource();
    src.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = a.createGain();
    g.gain.setValueAtTime(gain * volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(a.destination);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  // 반짝이는 "칭" (사각파 두 음 + 빠른 감쇠)
  function ting(t, { from = 1320, to = 1760, dur = 0.18, gain = 0.22 } = {}) {
    const a = ctx;
    const o = a.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + 0.06);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * volume, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    o.connect(lp).connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    // 치-킹! : 철컥 두 번 + 반짝
    expand(t) {
      clack(t, { freq: 1800, dur: 0.045 });
      clack(t + 0.07, { freq: 2600, dur: 0.05 });
      ting(t + 0.11, { from: 1320, to: 1980 });
    },
    // 철컥 : 낮게 한 번 + 짧게
    collapse(t) {
      clack(t, { freq: 2200, dur: 0.04 });
      clack(t + 0.06, { freq: 1300, q: 4, dur: 0.07, gain: 0.7 });
    },
    click(t) {
      clack(t, { freq: 3200, q: 8, dur: 0.025, gain: 0.35 });
    }
  };

  function play(name) {
    if (!enabled || !SOUNDS[name]) return;
    const a = audio();
    if (!a) return;
    try { SOUNDS[name](a.currentTime + 0.005); } catch (_) { /* 소리 실패는 무시 */ }
  }

  window.Sfx = {
    play,
    setEnabled(v) { enabled = !!v; },
    setVolume(v) { volume = Math.max(0, Math.min(1, Number(v) || 0)); },
    get enabled() { return enabled; }
  };
})();
