// The execution scene.
//
// A condemned feature drops onto the chopping block and is cut in two by
// either the executioner's axe or the grim reaper's scythe. Everything is
// driven by one animation loop: figure rigs, camera (zoom + trauma shake),
// stage lighting, card-half physics and a canvas particle system.
//
// All scene coordinates are in the SVG viewBox space (800 x 500).
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const overlay = $('#execution');
  const stage = $('#stage');
  const camera = $('#camera');
  const card = $('#condemned');
  const big = $('#verdictBig');
  const small = $('#verdictSmall');
  const screenFlash = $('#screenFlash');
  const skipBtn = $('#skipExec');
  const light = $('#stageLight');
  const canvas = $('#fx');
  const g = canvas.getContext('2d');
  const axeBlood = document.querySelector('.axe-blood');
  const pool = $('#blockPool');
  const drips = Array.from(document.querySelectorAll('#blockDrips path'));
  const sfx = () => window.SFX || null;

  const VB_W = 800;
  const VB_H = 500;
  const CARD = { x: 264, y: 230, w: 272, h: 100 }; // matches .condemned CSS
  const IMPACT = { x: 404, y: 318 };

  const VARIANTS = {
    axe: {
      arm: $('#axeArm'),
      rig: $('#axeRig'),
      body: $('#executionerBody'),
      pivot: [226, 236],
      feet: [186, 422],
      rest: -50,
      raised: -140,
      strike: 9,
      contact: -24, // blade meets the top of the card without cutting it
      dropVx: -95,
      leanBack: -5,
      leanFwd: 7,
      floaty: false,
      // blade sample points (unrotated) used for the motion trail
      trail: [[404, 236], [446, 304]],
      word: 'Executed',
      intro: 'The executioner raises the axe…',
      pieces: [
        { clip: 'polygon(0 0, 56% 0, 46% 100%, 0 100%)', origin: [0.26, 0.5], vx: -170, vy: -260, vr: -320 },
        { clip: 'polygon(56% 0, 100% 0, 100% 100%, 46% 100%)', origin: [0.75, 0.5], vx: 190, vy: -240, vr: 340 },
      ],
      line: [[0.56, 0], [0.46, 1]],
    },
    scythe: {
      arm: $('#scytheArm'),
      rig: $('#scytheRig'),
      body: $('#reaperBody'),
      pivot: [592, 242],
      feet: [632, 422],
      rest: 60,
      raised: 98,
      strike: 3,
      contact: 33,
      dropVx: 105,
      leanBack: 5,
      leanFwd: -7,
      floaty: true,
      trail: [[312, 246], [356, 344]],
      word: 'Reaped',
      intro: 'The reaper has come to collect…',
      pieces: [
        { clip: 'polygon(0 0, 100% 0, 100% 28%, 0 72%)', origin: [0.5, 0.3], vx: -260, vy: -200, vr: -260 },
        { clip: 'polygon(0 72%, 100% 28%, 100% 100%, 0 100%)', origin: [0.5, 0.75], vx: 150, vy: -120, vr: 180 },
      ],
      line: [[0, 0.72], [1, 0.28]],
    },
  };

  const EPITAPHS = [
    'Its grave is being dug as we speak.',
    'Nobody will miss it. Probably.',
    'Gone, but not forgotten. Mostly forgotten.',
    'The undertaker has been notified.',
    'It now awaits the funeral.',
    'May it never ship again.',
  ];

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const wordmark = new Image();
  wordmark.src = '/brand/azoma-wordmark-white-tight.svg';
  wordmark.alt = 'Azoma';
  let lastVariant = Math.random() < 0.5 ? 'axe' : 'scythe';

  // ------------------------------------------------------------------ state

  const S = {
    v: null,
    running: false,
    angle: 0,
    lean: 0,
    hover: 0,
    trauma: 0,
    zoom: 1,
    zoomPunch: 0,
    dark: 0.35,
    radius: 34,
    red: 0,
    violet: 0,
    drop: null,
    timeScale: 1,
    trailOn: false,
    trail: [],
    tremble: 0,
    parts: [],
    splats: [],
    rings: [],
    pieces: [],
    t: 0,
  };

  let skipped = false;
  let wake = null;
  let cleanupFns = [];

  class Skip extends Error {}
  const check = () => {
    if (skipped) throw new Skip();
  };

  function sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    }).then(check);
  }

  const ease = {
    linear: (t) => t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => {
      const c = 1.7;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    },
  };

  // Tween several state keys at once.
  function tween(to, dur, fn = ease.inOut) {
    const from = {};
    for (const k of Object.keys(to)) from[k] = S[k];
    return new Promise((resolve) => {
      const t0 = performance.now();
      wake = resolve;
      function frame(now) {
        if (skipped) return resolve();
        const t = Math.min(1, (now - t0) / dur);
        const e = fn(t);
        for (const k of Object.keys(to)) S[k] = from[k] + (to[k] - from[k]) * e;
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    }).then(check);
  }

  // Fire-and-forget tween that does not block the sequence.
  function drift(to, dur, fn) {
    tween(to, dur, fn).catch(() => {});
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ------------------------------------------------------------------ rig

  function rot(pt, c, deg) {
    const r = (deg * Math.PI) / 180;
    const dx = pt[0] - c[0];
    const dy = pt[1] - c[1];
    return [c[0] + dx * Math.cos(r) - dy * Math.sin(r), c[1] + dx * Math.sin(r) + dy * Math.cos(r)];
  }

  // World position of a point on the weapon, given arm angle and body lean.
  function weaponPoint(v, pt) {
    const a = rot(pt, v.pivot, S.angle + S.tremble);
    const b = rot(a, v.feet, S.lean);
    return [b[0], b[1] + S.hover];
  }

  function applyRig(v, time) {
    const [fx, fy] = v.feet;
    const breathe = 1 + Math.sin(time * 2.3) * 0.012;
    const sway = v.floaty ? Math.sin(time * 1.3) * 1.6 : 0;
    S.hover = v.floaty ? Math.sin(time * 1.7) * 4 - 3 : 0;
    const bodyT =
      `translate(0 ${S.hover.toFixed(2)}) rotate(${S.lean.toFixed(2)} ${fx} ${fy}) ` +
      `translate(${fx} ${fy}) scale(1 ${breathe.toFixed(4)}) skewX(${sway.toFixed(2)}) translate(${-fx} ${-fy})`;
    v.body.setAttribute('transform', bodyT);
    v.rig.setAttribute('transform', bodyT);
    v.arm.setAttribute('transform', `rotate(${(S.angle + S.tremble).toFixed(2)} ${v.pivot[0]} ${v.pivot[1]})`);
  }

  // ------------------------------------------------------------------ canvas

  let cw = 0;
  let ch = 0;
  let scale = 1;
  let dpr = 1;

  function sizeCanvas() {
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = sw * 2;
    ch = sh * 2;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    scale = sw / VB_W;
  }

  function toCanvasSpace() {
    // canvas spans 200% of the stage, offset by -50%; draw in viewBox units
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * sw * 0.5, dpr * sh * 0.5);
  }

  const BLOOD = ['#8a0a1c', '#b3122b', '#6d0716', '#d11a36', '#5a0512'];

  function spawnBlood(x, y, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const sp = rand(120, 620) * power;
      S.parts.push({
        kind: 'blood',
        x: x + rand(-20, 20),
        y: y + rand(-6, 6),
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - rand(0, 120),
        size: rand(1.6, 5.5),
        color: pick(BLOOD),
        ground: rand(428, 478),
        life: 4,
        age: 0,
      });
    }
    // a few heavy globs that arc high
    for (let i = 0; i < n / 8; i++) {
      S.parts.push({
        kind: 'blood',
        x,
        y,
        vx: rand(-260, 260),
        vy: rand(-760, -520),
        size: rand(5, 8),
        color: pick(BLOOD),
        ground: rand(430, 476),
        life: 4,
        age: 0,
      });
    }
  }

  function spawnSparks(x, y, n) {
    for (let i = 0; i < n; i++) {
      const ang = rand(-Math.PI, 0);
      const sp = rand(250, 700);
      S.parts.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: rand(0.18, 0.45),
        age: 0,
      });
    }
  }

  function spawnPaper(x, y, n) {
    for (let i = 0; i < n; i++) {
      S.parts.push({
        kind: 'paper',
        x: x + rand(-60, 60),
        y: y + rand(-30, 20),
        vx: rand(-220, 220),
        vy: rand(-380, -120),
        w: rand(4, 9),
        h: rand(3, 6),
        r: rand(0, Math.PI),
        vr: rand(-12, 12),
        phase: rand(0, 6),
        ground: rand(432, 478),
        life: 99,
        age: 0,
      });
    }
  }

  function spawnWisps(x, y, n) {
    for (let i = 0; i < n; i++) {
      S.parts.push({
        kind: 'wisp',
        x: x + rand(-70, 70),
        y: y + rand(-20, 20),
        vx: rand(-15, 15),
        vy: rand(-70, -35),
        size: rand(8, 20),
        phase: rand(0, 6),
        life: rand(1.6, 2.8),
        age: 0,
      });
    }
  }

  function spawnDust(x, y, n, spread = 60) {
    for (let i = 0; i < n; i++) {
      S.parts.push({
        kind: 'dust',
        x: x + rand(-spread, spread),
        y: y + rand(-4, 4),
        vx: rand(-80, 80),
        vy: rand(-40, -5),
        size: rand(8, 18),
        life: rand(0.7, 1.3),
        age: 0,
      });
    }
  }

  function spawnEmber(x, y) {
    S.parts.push({
      kind: 'ember',
      x: x + rand(-5, 5),
      y,
      vx: rand(-10, 10),
      vy: rand(-90, -50),
      phase: rand(0, 6),
      life: rand(1.2, 2.4),
      age: 0,
    });
  }

  function splat(x, y, size, color) {
    const blobs = [];
    const n = 2 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      blobs.push([rand(-size * 2.2, size * 2.2), rand(-size * 0.5, size * 0.5), rand(size * 0.25, size * 0.6)]);
    }
    S.splats.push({ x, y, r: size * rand(1.2, 1.8), color, blobs, grow: 0 });
  }

  function onBlockTop(x) {
    return x > 328 && x < 472;
  }

  function stepParticles(dt) {
    const G = 1500;
    for (const p of S.parts) {
      p.age += dt;
      if (p.kind === 'blood') {
        const prevY = p.y;
        p.vy += G * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // land on the top of the block
        if (p.vy > 0 && prevY < 334 && p.y >= 334 && onBlockTop(p.x) && Math.random() < 0.55) {
          splat(p.x, rand(331, 342), p.size, p.color);
          p.dead = true;
        } else if (p.y >= p.ground && p.vy > 0) {
          splat(p.x, p.ground, p.size, p.color);
          p.dead = true;
        }
      } else if (p.kind === 'spark') {
        p.vx *= 1 - 3 * dt;
        p.vy = p.vy * (1 - 3 * dt) + 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.kind === 'paper') {
        if (p.y < p.ground) {
          p.vy += 700 * dt;
          p.vy = Math.min(p.vy, 90); // air drag
          p.vx *= 1 - 1.8 * dt;
          p.x += (p.vx + Math.sin(p.age * 6 + p.phase) * 60) * dt;
          p.y += p.vy * dt;
          p.r += p.vr * dt;
        } else {
          p.y = p.ground;
        }
      } else if (p.kind === 'wisp') {
        p.x += (p.vx + Math.sin(p.age * 3 + p.phase) * 25) * dt;
        p.y += p.vy * dt;
      } else if (p.kind === 'dust') {
        p.vx *= 1 - 2.5 * dt;
        p.vy *= 1 - 2.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.size += 20 * dt;
      } else if (p.kind === 'ember') {
        p.x += (p.vx + Math.sin(p.age * 4 + p.phase) * 18) * dt;
        p.y += p.vy * dt;
      }
      if (p.age > p.life) p.dead = true;
    }
    S.parts = S.parts.filter((p) => !p.dead);
    for (const s of S.splats) s.grow = Math.min(1, s.grow + dt * 9);
    for (const r of S.rings) r.age += dt;
    S.rings = S.rings.filter((r) => r.age < r.life);
  }

  function drawScene() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    toCanvasSpace();

    // splats (persist on the ground and the block)
    for (const s of S.splats) {
      g.fillStyle = s.color;
      g.globalAlpha = 0.92;
      const k = ease.outCubic(s.grow);
      g.beginPath();
      g.ellipse(s.x, s.y, s.r * k, s.r * 0.32 * k, 0, 0, Math.PI * 2);
      g.fill();
      for (const [bx, by, br] of s.blobs) {
        g.beginPath();
        g.ellipse(s.x + bx * k, s.y + by * k, br * k, br * 0.4 * k, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // weapon motion trail
    const now = performance.now();
    S.trail = S.trail.filter((p) => now - p.t < 240);
    if (S.trail.length > 1) {
      g.globalCompositeOperation = 'lighter';
      for (let i = 1; i < S.trail.length; i++) {
        const a = S.trail[i - 1];
        const b = S.trail[i];
        const age = (now - b.t) / 240;
        const alpha = Math.max(0, 1 - age) * 0.55;
        const grad = g.createLinearGradient(b.i[0], b.i[1], b.o[0], b.o[1]);
        grad.addColorStop(0, `rgba(180,190,210,0)`);
        grad.addColorStop(0.6, `rgba(220,228,245,${alpha * 0.6})`);
        grad.addColorStop(1, `rgba(255,255,255,${alpha})`);
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(a.i[0], a.i[1]);
        g.lineTo(a.o[0], a.o[1]);
        g.lineTo(b.o[0], b.o[1]);
        g.lineTo(b.i[0], b.i[1]);
        g.closePath();
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }

    // shockwave rings
    for (const r of S.rings) {
      const t = r.age / r.life;
      g.strokeStyle = r.color.replace('A', (1 - t) * r.alpha);
      g.lineWidth = r.width * (1 - t) + 0.5;
      g.beginPath();
      g.ellipse(r.x, r.y, r.r * ease.outCubic(t), r.r * r.squash * ease.outCubic(t), 0, 0, Math.PI * 2);
      g.stroke();
    }

    for (const p of S.parts) {
      const life = p.age / p.life;
      if (p.kind === 'blood') {
        g.strokeStyle = p.color;
        g.lineWidth = p.size;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
        g.lineTo(p.x, p.y);
        g.stroke();
        if (p.size > 3.5) {
          g.fillStyle = 'rgba(255,120,130,0.35)';
          g.beginPath();
          g.arc(p.x - p.size * 0.2, p.y - p.size * 0.2, p.size * 0.22, 0, Math.PI * 2);
          g.fill();
        }
      } else if (p.kind === 'spark') {
        g.globalCompositeOperation = 'lighter';
        g.strokeStyle = `rgba(255,${(220 - life * 120) | 0},${(140 - life * 120) | 0},${1 - life})`;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
        g.lineTo(p.x, p.y);
        g.stroke();
        g.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'paper') {
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.scale(1, Math.abs(Math.cos(p.age * 7 + p.phase)) * 0.8 + 0.2);
        g.fillStyle = '#d9c597';
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      } else if (p.kind === 'wisp') {
        const a = Math.sin(life * Math.PI) * 0.5;
        const rg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        rg.addColorStop(0, `rgba(210,255,222,${a})`);
        rg.addColorStop(1, 'rgba(125,255,154,0)');
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = rg;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'dust') {
        const a = (1 - life) * 0.28;
        const rg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        rg.addColorStop(0, `rgba(120,100,90,${a})`);
        rg.addColorStop(1, 'rgba(120,100,90,0)');
        g.fillStyle = rg;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
      } else if (p.kind === 'ember') {
        const a = Math.sin(life * Math.PI) * 0.9;
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(255,${(170 - life * 90) | 0},60,${a})`;
        g.beginPath();
        g.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  // ------------------------------------------------------------------ card halves

  function makePieces(v) {
    const k = scale;
    v.pieces.forEach((def) => {
      const el = card.cloneNode(true);
      el.removeAttribute('id');
      el.classList.remove('drop', 'trembling');
      el.classList.add('half');
      el.style.clipPath = def.clip;
      el.style.transformOrigin = `${def.origin[0] * 100}% ${def.origin[1] * 100}%`;
      stage.querySelector('.camera').insertBefore(el, card);
      cleanupFns.push(() => el.remove());
      const cx = CARD.x + def.origin[0] * CARD.w;
      const cy = CARD.y + def.origin[1] * CARD.h;
      S.pieces.push({
        el,
        x0: cx,
        y0: cy,
        x: cx,
        y: cy,
        vx: def.vx * rand(0.85, 1.15),
        vy: def.vy * rand(0.85, 1.15),
        r: 0,
        vr: def.vr * rand(0.8, 1.2),
        hw: CARD.w * 0.25,
        hh: CARD.h * 0.5,
        ground: rand(452, 470),
        bounces: 0,
        rest: false,
        k,
      });
    });
    card.style.visibility = 'hidden';
  }

  function stepPieces(dt) {
    for (const p of S.pieces) {
      if (!p.rest) {
        p.vy += 1500 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += p.vr * dt;
        const rad = (p.r * Math.PI) / 180;
        const ext = Math.abs(Math.sin(rad)) * p.hw + Math.abs(Math.cos(rad)) * p.hh * 0.35;
        if (p.y + ext > p.ground && p.vy > 0) {
          p.y = p.ground - ext;
          p.bounces++;
          spawnDust(p.x, p.ground, 3, 20);
          if (p.bounces > 2 || Math.abs(p.vy) < 120) {
            p.rest = true;
            // settle flat-ish
            const target = Math.round(p.r / 180) * 180 + rand(-9, 9);
            p.settle = { from: p.r, to: target, t: 0 };
          } else {
            p.vy = -p.vy * 0.3;
            p.vx *= 0.55;
            p.vr *= 0.45;
          }
        }
      } else if (p.settle && p.settle.t < 1) {
        p.settle.t = Math.min(1, p.settle.t + dt * 4);
        p.r = p.settle.from + (p.settle.to - p.settle.from) * ease.outCubic(p.settle.t);
        const rad = (p.r * Math.PI) / 180;
        const ext = Math.abs(Math.sin(rad)) * p.hw + Math.abs(Math.cos(rad)) * p.hh * 0.35;
        p.y = p.ground - ext;
      }
      const k = scale;
      p.el.style.transform = `translate(${((p.x - p.x0) * k).toFixed(1)}px, ${((p.y - p.y0) * k).toFixed(1)}px) rotate(${p.r.toFixed(1)}deg)`;
    }
  }

  // ------------------------------------------------------------------ camera + light

  const noiseSeeds = [rand(0, 100), rand(0, 100), rand(0, 100)];
  function noise1(t, seed) {
    return Math.sin(t * 37.1 + seed) * 0.5 + Math.sin(t * 61.7 + seed * 1.7) * 0.3 + Math.sin(t * 13.3 + seed * 2.3) * 0.2;
  }

  function applyCamera(time, dt) {
    S.trauma = Math.max(0, S.trauma - dt * 1.4);
    S.zoomPunch *= Math.exp(-dt * 5);
    const shake = S.trauma * S.trauma;
    const sw = stage.clientWidth;
    const ox = shake * sw * 0.03 * noise1(time, noiseSeeds[0]);
    const oy = shake * sw * 0.03 * noise1(time, noiseSeeds[1]);
    const r = shake * 2.2 * noise1(time, noiseSeeds[2]);
    const z = S.zoom + S.zoomPunch;
    camera.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px) scale(${z.toFixed(4)}) rotate(${r.toFixed(3)}deg)`;

    const flicker = 0.04 * noise1(time * 0.25, 4.2);
    light.style.setProperty('--dark', (S.dark + flicker).toFixed(3));
    light.style.setProperty('--r', S.radius.toFixed(2) + '%');
    light.style.setProperty('--red', S.red.toFixed(3));
    S.red = Math.max(0, S.red - dt * 0.9);
    light.style.setProperty('--violet', S.violet.toFixed(3));
    S.violet = Math.max(0, S.violet - dt * 0.3);
  }

  // ------------------------------------------------------------------ loop

  let lastFrame = 0;
  let emberClock = 0;
  function loop(now) {
    if (!S.running) return;
    const realDt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    const dt = realDt * S.timeScale;
    S.t += realDt;
    const v = S.v;
    applyRig(v, S.t);
    if (S.trailOn) {
      const [i, o] = v.trail;
      S.trail.push({ i: weaponPoint(v, i), o: weaponPoint(v, o), t: now });
    }
    emberClock += realDt;
    if (!reduced && emberClock > 0.09) {
      emberClock = 0;
      spawnEmber(48, 205);
      spawnEmber(752, 205);
    }
    stepParticles(dt);
    stepPieces(dt);
    stepDrop(dt);
    applyCamera(S.t, realDt);
    drawScene();
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ beats

  function flashWhite(strength = 0.85, dur = 260) {
    screenFlash.animate([{ opacity: strength }, { opacity: 0 }], { duration: dur, easing: 'ease-out' });
  }

  function slashFlash(v) {
    const [[ax, ay], [bx, by]] = v.line;
    const k = scale;
    const x1 = (CARD.x + ax * CARD.w) * k;
    const y1 = (CARD.y + ay * CARD.h) * k;
    const x2 = (CARD.x + bx * CARD.w) * k;
    const y2 = (CARD.y + by * CARD.h) * k;
    const len = Math.hypot(x2 - x1, y2 - y1) * 1.9;
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const f = document.createElement('div');
    f.className = 'slash-flash';
    camera.appendChild(f);
    cleanupFns.push(() => f.remove());
    f.style.width = len + 'px';
    f.style.left = (x1 + x2) / 2 + 'px';
    f.style.top = (y1 + y2) / 2 + 'px';
    const base = `translate(-50%, -50%) rotate(${angle}deg)`;
    f.animate(
      [
        { opacity: 0, transform: base + ' scaleX(0)' },
        { opacity: 1, transform: base + ' scaleX(1)', offset: 0.3 },
        { opacity: 0, transform: base + ' scaleX(1.2) scaleY(0.3)' },
      ],
      { duration: 380, easing: 'ease-out', fill: 'forwards' }
    );
  }

  function bleedBlock() {
    pool.animate(
      [
        { transform: 'translate(404px, 337px) scale(0) translate(-404px, -337px)' },
        { transform: 'translate(404px, 337px) scale(1) translate(-404px, -337px)' },
      ],
      { duration: 1400, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' }
    );
    drips.forEach((d, i) => {
      d.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: 1600 + i * 400,
        delay: 300 + i * 220,
        easing: 'cubic-bezier(.5,0,.7,1)',
        fill: 'forwards',
      });
    });
  }

  function verdictWord(word, holy = false) {
    big.replaceChildren();
    big.classList.toggle('holy', holy);
    [...word.toUpperCase()].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'l';
      s.textContent = ch;
      s.style.setProperty('--i', i);
      s.style.setProperty('--r', rand(-14, 14).toFixed(1) + 'deg');
      if (!holy && Math.random() < 0.45) {
        const d = document.createElement('i');
        d.className = 'dr';
        d.style.left = rand(25, 65).toFixed(0) + '%';
        d.style.setProperty('--h', rand(14, 40).toFixed(0) + 'px');
        d.style.setProperty('--d', (0.5 + i * 0.06 + rand(0, 0.8)).toFixed(2) + 's');
        s.appendChild(d);
      }
      big.appendChild(s);
    });
    void big.offsetWidth;
    big.classList.add('show');
  }

  function soulRises(text) {
    const k = scale;
    const s = document.createElement('div');
    s.className = 'soul-text';
    s.textContent = text;
    Object.assign(s.style, {
      left: CARD.x * k + 'px',
      top: CARD.y * k + 'px',
      width: CARD.w * k + 'px',
      height: CARD.h * k + 'px',
      fontSize: getComputedStyle(card).fontSize,
    });
    camera.appendChild(s);
    cleanupFns.push(() => s.remove());
    const up = -VB_H * 0.42 * k;
    s.animate(
      [
        { transform: 'translate(0, 0) scale(0.95, 0.9)', opacity: 0, filter: 'blur(6px)' },
        { transform: `translate(${-8 * k}px, ${up * 0.25}px) scale(1, 1.05)`, opacity: 0.95, filter: 'blur(0px)', offset: 0.22 },
        { transform: `translate(${10 * k}px, ${up * 0.55}px) scale(1.05, 1.15)`, opacity: 0.7, filter: 'blur(1px)', offset: 0.55 },
        { transform: `translate(${-6 * k}px, ${up}px) scale(1.15, 1.35)`, opacity: 0, filter: 'blur(8px)' },
      ],
      { duration: 2800, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'forwards' }
    );
    spawnWisps(CARD.x + CARD.w / 2, CARD.y + 40, 18);
  }

  function impact(v, text) {
    const sx = sfx();
    if (sx) {
      sx.thud();
      sx.splat();
    }
    flashWhite();
    S.trauma = 1;
    S.zoomPunch = 0.1;
    S.red = 0.32;
    overlay.classList.add('struck');
    slashFlash(v);
    makePieces(v);
    if (!reduced) {
      const tip = weaponPoint(v, v.trail[1]);
      spawnSparks(tip[0], Math.min(tip[1], 336), 26);
      spawnBlood(IMPACT.x, IMPACT.y, 90);
      spawnPaper(CARD.x + CARD.w / 2, CARD.y + CARD.h / 2, 26);
      spawnDust(400, 336, 10, 70);
      S.rings.push({ x: IMPACT.x, y: 330, r: 170, squash: 0.28, width: 6, life: 0.55, age: 0, alpha: 0.7, color: 'rgba(255,220,220,A)' });
      S.rings.push({ x: IMPACT.x, y: 330, r: 110, squash: 0.32, width: 10, life: 0.4, age: 0, alpha: 0.5, color: 'rgba(227,38,63,A)' });
    }
    if (v === VARIANTS.axe && axeBlood) axeBlood.setAttribute('opacity', '1');
    bleedBlock();
    verdictWord(v.word);
    small.classList.remove('show');
    setTimeout(() => !skipped && soulRises(text), 450);
    setTimeout(() => !skipped && sx && sx.bell(), 380);
  }

  // ------------------------------------------------------------------ the mothership (easter egg)

  // The weapon leaves the hand: clone it into world space and let it fall.
  function startDrop(v) {
    const weapon = v.arm.querySelector('.weapon');
    const inner = document.createElementNS(NS, 'g');
    inner.setAttribute('transform', `${v.rig.getAttribute('transform')} ${v.arm.getAttribute('transform')}`);
    inner.appendChild(weapon.cloneNode(true));
    const outer = document.createElementNS(NS, 'g');
    outer.appendChild(inner);
    v.rig.parentNode.appendChild(outer);
    weapon.style.visibility = 'hidden';
    cleanupFns.push(() => {
      outer.remove();
      weapon.style.visibility = '';
    });
    const c = weaponPoint(v, v.trail[1]);
    S.drop = {
      el: outer,
      cx: c[0],
      cy: c[1],
      x: 0,
      y: 0,
      vx: v.dropVx,
      vy: -320,
      r: 0,
      vr: v.dropVx > 0 ? rand(220, 320) : rand(-320, -220),
      ground: rand(442, 452),
      bounces: 0,
      rest: false,
    };
  }

  function stepDrop(dt) {
    const d = S.drop;
    if (!d || d.rest) return;
    d.vy += 1500 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.r += d.vr * dt;
    if (d.cy + d.y > d.ground && d.vy > 0) {
      d.y = d.ground - d.cy;
      d.bounces++;
      const sx = sfx();
      if (sx) sx.clatter(1 / d.bounces);
      spawnDust(d.cx + d.x, d.ground, 5, 25);
      S.trauma = Math.max(S.trauma, 0.18 / d.bounces);
      if (d.bounces > 2 || d.vy < 160) {
        d.rest = true;
      } else {
        d.vy = -d.vy * 0.35;
        d.vx *= 0.5;
        d.vr *= 0.4;
      }
    }
    d.el.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)}) rotate(${d.r.toFixed(1)} ${d.cx.toFixed(1)} ${d.cy.toFixed(1)})`);
  }

  function holyBeam() {
    const k = scale;
    const b = document.createElement('div');
    b.className = 'holy-beam';
    Object.assign(b.style, {
      left: (CARD.x + CARD.w / 2) * k + 'px',
      width: CARD.w * 0.9 * k + 'px',
      height: `calc(60% + ${(CARD.y + CARD.h) * k}px)`,
    });
    camera.insertBefore(b, card);
    cleanupFns.push(() => b.remove());
    b.animate(
      [
        { opacity: 0, transform: 'translateX(-50%) scaleX(0.2)' },
        { opacity: 1, transform: 'translateX(-50%) scaleX(1)', offset: 0.15 },
        { opacity: 0.55, transform: 'translateX(-50%) scaleX(0.9)' },
      ],
      { duration: 2600, easing: 'ease-out', fill: 'forwards' }
    );
  }

  function impactMothership(v) {
    const sx = sfx();
    if (sx) {
      sx.clang();
      setTimeout(() => !skipped && sx.choir(), 220);
    }
    flashWhite(0.9, 220);
    S.violet = 0.42;
    S.trauma = 0.8;
    S.zoomPunch = 0.06;
    overlay.classList.add('mothership-hit');
    card.classList.remove('trembling');
    card.classList.add('shielded');
    if (!reduced) {
      const tip = weaponPoint(v, v.trail[1]);
      spawnSparks(tip[0], tip[1], 80);
      const cx = CARD.x + CARD.w / 2;
      const cy = CARD.y + CARD.h / 2;
      S.rings.push({ x: cx, y: cy, r: 260, squash: 0.62, width: 5, life: 0.9, age: 0, alpha: 0.8, color: 'rgba(205,185,255,A)' });
      S.rings.push({ x: cx, y: cy, r: 180, squash: 0.62, width: 9, life: 0.7, age: 0, alpha: 0.6, color: 'rgba(140,90,240,A)' });
      S.rings.push({ x: cx, y: cy, r: 120, squash: 0.62, width: 12, life: 0.5, age: 0, alpha: 0.5, color: 'rgba(255,255,255,A)' });
    }
    holyBeam();
    verdictWord('Immortal', true);
    small.classList.remove('show');
  }

  function vibrate(ms, amp, freq, grow = false) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      (function tick(now) {
        if (skipped) return resolve();
        const e = Math.min(1, (now - t0) / ms);
        S.tremble = Math.sin(now * freq) * amp * (grow ? e : 1 - e);
        if (e < 1) requestAnimationFrame(tick);
        else resolve();
      })(t0);
    }).then(() => {
      S.tremble = 0;
      check();
    });
  }

  // ------------------------------------------------------------------ lifecycle

  function reset() {
    cleanupFns.forEach((f) => f());
    cleanupFns = [];
    S.parts = [];
    S.splats = [];
    S.rings = [];
    S.pieces = [];
    S.trail = [];
    S.trailOn = false;
    S.trauma = 0;
    S.zoom = 1;
    S.zoomPunch = 0;
    S.dark = 0.35;
    S.radius = 34;
    S.red = 0;
    S.violet = 0;
    S.drop = null;
    S.timeScale = 1;
    S.tremble = 0;
    card.style.visibility = '';
    card.classList.remove('drop', 'trembling', 'mothership', 'shielded');
    overlay.classList.remove('mothership-hit');
    big.classList.remove('holy');
    big.classList.remove('show');
    big.replaceChildren();
    small.classList.remove('show');
    small.textContent = '';
    overlay.classList.remove('struck');
    camera.style.transform = '';
    if (axeBlood) axeBlood.setAttribute('opacity', '0');
    pool.getAnimations().forEach((a) => a.cancel());
    drips.forEach((d) => d.getAnimations().forEach((a) => a.cancel()));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
  }

  function close() {
    const sx = sfx();
    if (sx) sx.droneStop();
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      S.running = false;
      reset();
    }, 450);
  }

  function skip() {
    if (!overlay.classList.contains('open')) return;
    skipped = true;
    if (wake) wake();
  }

  skipBtn.addEventListener('click', skip);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') skip();
  });
  window.addEventListener('resize', () => {
    if (S.running) sizeCanvas();
  });

  async function windUp(v, sx) {
    if (sx) sx.drumroll(1.35);
    drift({ zoom: 1.08, dark: 0.78, radius: 20 }, 1500, ease.inOut);
    await tween({ angle: v.raised, lean: v.leanBack }, 950, ease.inOut);
    await vibrate(380, 1.4, 0.09, true); // shudder builds at the top
  }

  async function play(text, opts = {}) {
    const mothership = !!opts.mothership;
    reset();
    skipped = false;
    lastVariant = lastVariant === 'axe' ? 'scythe' : 'axe';
    const v = VARIANTS[lastVariant];
    S.v = v;
    for (const k of Object.keys(VARIANTS)) {
      const o = VARIANTS[k];
      const on = o === v;
      o.rig.style.display = on ? '' : 'none';
      o.body.style.display = on ? '' : 'none';
    }
    S.angle = v.rest;
    S.lean = 0;
    if (mothership) {
      card.replaceChildren(wordmark.cloneNode());
      card.classList.add('mothership');
    } else {
      card.textContent = text;
    }
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    sizeCanvas();
    S.running = true;
    lastFrame = performance.now();
    requestAnimationFrame(loop);

    const sx = sfx();
    if (sx) sx.droneStart();

    void card.offsetWidth;
    card.classList.add('drop');

    try {
      // the condemned lands on the block
      await sleep(430);
      S.trauma = 0.25;
      spawnDust(400, 334, 12, 90);
      await sleep(250);
      card.classList.remove('drop');
      if (!mothership) card.classList.add('trembling');
      small.textContent = v.intro;
      small.classList.add('show');

      if (mothership) {
        // Easter egg: the blade bounces off and the weapon is knocked away.
        if (reduced) {
          await sleep(400);
          S.angle = v.contact;
          impactMothership(v);
          small.textContent = 'The mothership cannot be killed.';
          small.classList.add('show');
          await sleep(2800);
        } else {
          await windUp(v, sx);
          if (sx) sx.whoosh(0.16);
          S.trailOn = true;
          const dir = Math.sign(v.strike - v.raised);
          await tween({ angle: v.contact, lean: v.leanFwd }, 135, ease.inCubic);
          S.timeScale = 0;
          impactMothership(v);
          S.zoom = 1.08;
          await sleep(120);
          S.trailOn = false;
          S.timeScale = 0.3;
          drift({ timeScale: 1 }, 600, ease.inCubic);
          drift({ zoom: 1.0, dark: 0.45, radius: 32 }, 1200, ease.outCubic);
          // recoil, the arm rings like a struck bell, and the weapon flies loose
          setTimeout(() => !skipped && startDrop(v), 300);
          await Promise.all([
            tween({ angle: v.contact - dir * 80, lean: v.leanBack * 1.8 }, 360, ease.outBack),
            vibrate(900, 5, 0.32),
          ]);
          small.textContent = 'The mothership cannot be killed.';
          small.classList.add('show');
          await sleep(1300);
          // the figure lowers an empty hand
          await tween({ angle: v.rest, lean: 0 }, 1000, ease.inOut);
          await sleep(1000);
        }
      } else if (reduced) {
        await sleep(400);
        S.angle = v.strike;
        impact(v, text);
        await sleep(2600);
      } else {
        // anticipation: wind up, lean back, lights close in, camera creeps forward
        await windUp(v, sx);

        // the swing
        if (sx) sx.whoosh(0.16);
        S.trailOn = true;
        const dir = Math.sign(v.strike - v.raised);
        await tween({ angle: v.strike + dir * 3, lean: v.leanFwd }, 135, ease.inCubic);

        // hit-stop, then slow motion easing back to real time
        S.timeScale = 0;
        impact(v, text);
        S.zoom = 1.08;
        await sleep(95);
        S.trailOn = false;
        S.timeScale = 0.22;
        drift({ timeScale: 1 }, 650, ease.inCubic);
        drift({ zoom: 1.0, dark: 0.5, radius: 30 }, 1200, ease.outCubic);
        await tween({ angle: v.strike, lean: v.leanFwd * 0.5 }, 220, ease.outBack);

        await sleep(1100);
        small.textContent = `“${text}” ${pick(EPITAPHS)}`;
        small.classList.add('show');
        await sleep(900);

        // yank the weapon free and step back
        S.trauma = Math.max(S.trauma, 0.22);
        await tween({ angle: v.strike - dir * 16, lean: 0 }, 140, ease.outCubic);
        await tween({ angle: v.rest }, 750, ease.inOut);
        await sleep(650);
      }
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
    }
    close();
    skipped = false;
    await new Promise((r) => setTimeout(r, 350));
  }

  window.Execution = { play };
})();
