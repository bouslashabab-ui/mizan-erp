'use strict';
/* Synthesised UI sounds (Web Audio, no files) with a mute toggle */
const SND = (() => {
  let ctx = null, muted = localStorage.getItem('mz_mute') === '1';
  const ac = () => { try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { } return ctx; };
  function tone(f, t0, dur, type, vol) {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const seq = (notes, type, vol, step) => notes.forEach((f, i) => tone(f, i * (step || 0.11), 0.38, type, vol));
  const S = {
    get muted() { return muted; },
    toggle() { muted = !muted; localStorage.setItem('mz_mute', muted ? '1' : '0'); if (!muted) S.click(); return muted; },
    play(n) { if (muted) return; (S[n] || (() => { }))(); },
    click() { if (muted) return; tone(1300, 0, 0.05, 'triangle', 0.05); },
    open() { if (muted) return; tone(520, 0, 0.09, 'sine', 0.06); tone(780, 0.05, 0.1, 'sine', 0.05); },
    close() { if (muted) return; tone(700, 0, 0.08, 'sine', 0.05); tone(480, 0.05, 0.1, 'sine', 0.04); },
    ok() { if (muted) return; seq([784, 1047], 'sine', 0.09, 0.09); },
    err() { if (muted) return; seq([260, 196], 'square', 0.05, 0.12); },
    login() { if (muted) return; seq([392, 523, 659, 784, 1047], 'sine', 0.1, 0.1); },
    logout() { if (muted) return; seq([784, 659, 523, 392], 'sine', 0.09, 0.1); }
  };
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button,.tb,.it,.mi>span,.tab,.rb,.card-link,a,tr[class],.quick');
    if (b) { ac(); S.click(); }
  }, true);
  return S;
})();
