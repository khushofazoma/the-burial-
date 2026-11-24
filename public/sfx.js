// Synthesised sound effects (no audio files). Muted state is remembered per browser.
(function () {
  'use strict';

  const KEY = 'funeral_muted';
  let muted = false;
  try {
    muted = localStorage.getItem(KEY) === '1';
  } catch {
    /* storage unavailable */
  }

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let droneNodes = null;

  function init() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // Call synchronously inside a click/submit handler so browsers allow audio.
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function ready() {
    return ctx && !muted && ctx.state === 'running';
  }

  function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.005, freqEnd } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  function tone(t, dur, { type = 'sine', freq = 220, freqEnd, gain = 0.4, attack = 0.005 } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SFX = {
    unlock,
    get muted() {
      return muted;
    },
    setMuted(v) {
      muted = !!v;
      try {
        localStorage.setItem(KEY, muted ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
      document.querySelectorAll('.sound-toggle').forEach((b) => {
        b.setAttribute('aria-pressed', String(!muted));
        b.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
      });
    },

    // Accelerating snare roll with a crescendo.
    drumroll(duration) {
      if (!ready()) return;
      const t0 = ctx.currentTime;
      let t = t0;
      let gap = 0.13;
      while (t < t0 + duration) {
        const p = (t - t0) / duration;
        noise(t, 0.07, { freq: 1900, q: 0.8, gain: 0.08 + p * 0.25 });
        tone(t, 0.09, { freq: 110 + p * 30, freqEnd: 70, gain: 0.06 + p * 0.18 });
        gap = Math.max(0.032, gap * 0.93);
        t += gap;
      }
    },

    whoosh(dur = 0.22) {
      if (!ready()) return;
      const t = ctx.currentTime;
      noise(t, dur, { freq: 350, freqEnd: 3200, q: 1.4, gain: 0.55, attack: dur * 0.6 });
    },

    thud() {
      if (!ready()) return;
      const t = ctx.currentTime;
      tone(t, 0.5, { freq: 150, freqEnd: 38, gain: 0.95 });
      noise(t, 0.2, { type: 'lowpass', freq: 1200, freqEnd: 200, gain: 0.8 });
      noise(t, 0.04, { type: 'highpass', freq: 3000, gain: 0.5 });
    },

    splat() {
      if (!ready()) return;
      const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        noise(t + 0.03 + i * (0.04 + Math.random() * 0.05), 0.09, {
          type: 'lowpass',
          freq: 700 + Math.random() * 500,
          freqEnd: 150,
          gain: 0.25 - i * 0.04,
        });
      }
    },

    bell() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const base = 87;
      [1, 2.01, 2.42, 3.0, 4.17, 5.43].forEach((m, i) => {
        tone(t, 4.5 - i * 0.5, { freq: base * m, gain: 0.22 / (i + 1), attack: 0.008 });
      });
    },

    droneStart() {
      if (!ready() || droneNodes) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.8);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      const oscs = [55, 55.6, 82.4].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.connect(lp);
        o.start(t);
        return o;
      });
      lp.connect(g).connect(master);
      droneNodes = { g, oscs };
    },

    droneStop() {
      if (!droneNodes || !ctx) return;
      const { g, oscs } = droneNodes;
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      oscs.forEach((o) => o.stop(t + 0.9));
      droneNodes = null;
    },

    rumble() {
      if (!ready()) return;
      const t = ctx.currentTime;
      noise(t, 1.3, { type: 'lowpass', freq: 160, gain: 0.7, attack: 0.25 });
      tone(t, 1.2, { freq: 46, freqEnd: 34, gain: 0.35, attack: 0.2 });
    },

    // Blade on something it cannot cut: bright inharmonic ring.
    clang() {
      if (!ready()) return;
      const t = ctx.currentTime;
      [1, 2.76, 5.4, 8.93, 13.3].forEach((m, i) => {
        tone(t, 1.6 - i * 0.22, { freq: 540 * m, gain: 0.32 / (i + 1), attack: 0.002 });
      });
      noise(t, 0.06, { type: 'highpass', freq: 4500, gain: 0.6 });
      tone(t, 0.25, { freq: 200, freqEnd: 90, gain: 0.4 });
    },

    // A dropped weapon bouncing on stone; intensity 0..1.
    clatter(intensity = 1) {
      if (!ready()) return;
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        const tt = t + i * (0.05 + Math.random() * 0.06);
        const f = 700 + Math.random() * 900;
        tone(tt, 0.25, { freq: f, gain: 0.12 * intensity, attack: 0.002 });
        tone(tt, 0.2, { freq: f * 2.7, gain: 0.05 * intensity, attack: 0.002 });
      }
      noise(t, 0.08, { type: 'lowpass', freq: 900, gain: 0.35 * intensity });
    },

    // A held major chord with gentle vibrato.
    choir() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      lp.connect(master);
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 5.2;
      lfoGain.gain.value = 3;
      lfo.connect(lfoGain);
      lfo.start(t);
      lfo.stop(t + 3.2);
      [220, 277.18, 329.63, 440, 554.37].forEach((f, i) => {
        for (const detune of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = i < 2 ? 'sawtooth' : 'triangle';
          o.frequency.value = f;
          o.detune.value = detune;
          lfoGain.connect(o.detune);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(i < 2 ? 0.025 : 0.05, t + 0.35);
          g.gain.setValueAtTime(i < 2 ? 0.025 : 0.05, t + 1.6);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
          o.connect(g).connect(lp);
          o.start(t);
          o.stop(t + 3.1);
        }
      });
    },

    chop() {
      if (!ready()) return;
      const t = ctx.currentTime;
      noise(t, 0.12, { freq: 600, freqEnd: 2800, q: 1.2, gain: 0.3, attack: 0.08 });
      tone(t + 0.1, 0.22, { freq: 220, freqEnd: 70, gain: 0.45 });
      noise(t + 0.1, 0.06, { type: 'highpass', freq: 2500, gain: 0.3 });
    },
  };

  window.SFX = SFX;

  // Wire up any sound toggle buttons on the page.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.sound-toggle').forEach((b) =>
      b.addEventListener('click', () => {
        unlock();
        SFX.setMuted(!muted);
      })
    );
    SFX.setMuted(muted);
  });
})();
