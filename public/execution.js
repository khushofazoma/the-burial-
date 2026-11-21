// The execution: a condemned feature is placed on the block and cut in two,
// either by the executioner's axe or the grim reaper's scythe.
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const overlay = $('#execution');
  const stage = $('#stage');
  const card = $('#condemned');
  const big = $('#verdictBig');
  const small = $('#verdictSmall');
  const screenFlash = $('#screenFlash');
  const skipBtn = $('#skipExec');
  const axeBlood = document.querySelector('.axe-blood');

  const VARIANTS = {
    axe: {
      arm: $('#axeArm'),
      body: $('#executionerBody'),
      pivot: [226, 236],
      rest: -50,
      raised: -138,
      strike: 9,
      word: 'Executed',
      cutA: 'polygon(0 0, 56% 0, 46% 100%, 0 100%)',
      cutB: 'polygon(56% 0, 100% 0, 100% 100%, 46% 100%)',
      line: [[0.56, 0], [0.46, 1]],
    },
    scythe: {
      arm: $('#scytheArm'),
      body: $('#reaperBody'),
      pivot: [592, 242],
      rest: 60,
      raised: 112,
      strike: 3,
      word: 'Reaped',
      cutA: 'polygon(0 0, 100% 0, 100% 28%, 0 72%)',
      cutB: 'polygon(0 72%, 100% 28%, 100% 100%, 0 100%)',
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
  let lastVariant = Math.random() < 0.5 ? 'axe' : 'scythe';
  let skipped = false;
  let wake = null; // resolves the current wait early when skipping
  let cleanupFns = [];

  class Skip extends Error {}

  function check() {
    if (skipped) throw new Skip();
  }

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
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inQuad: (t) => t * t,
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  };

  function tween(from, to, dur, fn, update) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      wake = resolve;
      function frame(now) {
        if (skipped) return resolve();
        const t = Math.min(1, (now - t0) / dur);
        update(from + (to - from) * fn(t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    }).then(check);
  }

  function setAngle(v, deg) {
    v.arm.setAttribute('transform', `rotate(${deg} ${v.pivot[0]} ${v.pivot[1]})`);
  }

  function stageRect() {
    return stage.getBoundingClientRect();
  }

  function cardBox() {
    const s = stageRect();
    const c = card.getBoundingClientRect();
    return { x: c.left - s.left, y: c.top - s.top, w: c.width, h: c.height, sw: s.width };
  }

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    (parent || stage).appendChild(e);
    cleanupFns.push(() => e.remove());
    return e;
  }

  function slashFlash(v, box) {
    const [[ax, ay], [bx, by]] = v.line;
    const x1 = box.x + ax * box.w;
    const y1 = box.y + ay * box.h;
    const x2 = box.x + bx * box.w;
    const y2 = box.y + by * box.h;
    const len = Math.hypot(x2 - x1, y2 - y1) * 1.6;
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    const f = el('div', 'slash-flash');
    f.style.width = len + 'px';
    f.style.left = (x1 + x2) / 2 + 'px';
    f.style.top = (y1 + y2) / 2 + 'px';
    const base = `translate(-50%, -50%) rotate(${angle}deg)`;
    f.animate(
      [
        { opacity: 0, transform: base + ' scaleX(0)' },
        { opacity: 1, transform: base + ' scaleX(1)', offset: 0.35 },
        { opacity: 0, transform: base + ' scaleX(1.15)' },
      ],
      { duration: 420, easing: 'ease-out', fill: 'forwards' }
    );
  }

  function splitCard(v, box) {
    const a = card.cloneNode(true);
    const b = card.cloneNode(true);
    for (const h of [a, b]) {
      h.removeAttribute('id');
      h.classList.remove('drop');
      h.classList.add('half');
      stage.insertBefore(h, card);
      cleanupFns.push(() => h.remove());
    }
    a.style.clipPath = v.cutA;
    b.style.clipPath = v.cutB;
    card.style.visibility = 'hidden';

    const W = box.sw;
    const opts = { duration: 1300, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' };
    if (v === VARIANTS.axe) {
      a.animate(
        [
          { transform: 'none' },
          { transform: `translate(${-W * 0.03}px, ${-W * 0.02}px) rotate(-6deg)`, offset: 0.12 },
          { transform: `translate(${-W * 0.22}px, ${W * 0.32}px) rotate(-75deg)`, opacity: 0 },
        ],
        opts
      );
      b.animate(
        [
          { transform: 'none' },
          { transform: `translate(${W * 0.03}px, ${-W * 0.02}px) rotate(7deg)`, offset: 0.12 },
          { transform: `translate(${W * 0.25}px, ${W * 0.34}px) rotate(82deg)`, opacity: 0 },
        ],
        opts
      );
    } else {
      a.animate(
        [
          { transform: 'none' },
          { transform: `translate(${-W * 0.06}px, ${W * 0.01}px) rotate(-4deg)`, offset: 0.18 },
          { transform: `translate(${-W * 0.34}px, ${W * 0.3}px) rotate(-60deg)`, opacity: 0 },
        ],
        opts
      );
      b.animate(
        [
          { transform: 'none' },
          { transform: `translate(${W * 0.01}px, ${W * 0.02}px) rotate(3deg)`, offset: 0.25 },
          { transform: `translate(${W * 0.12}px, ${W * 0.3}px) rotate(28deg)`, opacity: 0 },
        ],
        { ...opts, duration: 1500 }
      );
    }
  }

  function gore(box) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h * 0.55;
    const W = box.sw;
    const colors = ['#b3122b', '#e3263f', '#7a0a18', '#ff4d6a', '#5e0612'];
    const k = Math.min(1, Math.max(0.45, W / 820));
    const parts = [];
    const n = reduced ? 0 : 46;
    for (let i = 0; i < n; i++) {
      const d = el('div', 'gore');
      const size = (3 + Math.random() * 10) * k;
      d.style.width = d.style.height = size + 'px';
      d.style.background = colors[(Math.random() * colors.length) | 0];
      d.style.left = cx + 'px';
      d.style.top = cy + 'px';
      parts.push({
        d,
        x: (Math.random() - 0.5) * box.w * 0.5,
        y: 0,
        vx: (Math.random() - 0.5) * W * 1.1,
        vy: -(W * 0.25 + Math.random() * W * 0.75),
        life: 0.9 + Math.random() * 0.9,
      });
    }
    // ectoplasm wisps
    for (let i = 0; i < (reduced ? 0 : 14); i++) {
      const d = el('div', 'gore');
      const size = (6 + Math.random() * 10) * k;
      d.style.width = d.style.height = size + 'px';
      d.style.background = 'radial-gradient(circle, #d4ffe0, rgba(125,255,154,0) 70%)';
      d.style.left = cx + 'px';
      d.style.top = cy + 'px';
      parts.push({
        d,
        x: (Math.random() - 0.5) * box.w * 0.6,
        y: 0,
        vx: (Math.random() - 0.5) * W * 0.15,
        vy: -(W * 0.12 + Math.random() * W * 0.15),
        g: -0.02,
        life: 1.6 + Math.random() * 0.8,
      });
    }
    const G = W * 1.9;
    let last = performance.now();
    let age = 0;
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      age += dt;
      let alive = false;
      for (const p of parts) {
        if (age > p.life) {
          p.d.style.opacity = 0;
          continue;
        }
        alive = true;
        p.vy += (p.g !== undefined ? p.g * G : G) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const fade = Math.max(0, 1 - Math.max(0, age - p.life * 0.6) / (p.life * 0.4));
        p.d.style.transform = `translate(${p.x}px, ${p.y}px)`;
        p.d.style.opacity = fade;
      }
      if (alive && !skipped) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function soulRises(text, box) {
    const s = el('div', 'gore');
    s.textContent = text;
    Object.assign(s.style, {
      left: box.x + 'px',
      top: box.y + 'px',
      width: box.w + 'px',
      borderRadius: '0',
      textAlign: 'center',
      fontFamily: 'var(--font-ui)',
      fontWeight: '700',
      fontSize: getComputedStyle(card).fontSize,
      color: 'rgba(190,255,205,0.9)',
      textShadow: '0 0 12px #7dff9a, 0 0 30px #7dff9a',
      padding: '0 4%',
    });
    s.animate(
      [
        { transform: 'translateY(10%) scale(0.9)', opacity: 0, filter: 'blur(4px)' },
        { opacity: 0.95, filter: 'blur(0px)', offset: 0.25 },
        { transform: `translateY(${-box.sw * 0.28}px) scale(1.15)`, opacity: 0, filter: 'blur(6px)' },
      ],
      { duration: 2400, easing: 'ease-out', fill: 'forwards' }
    );
  }

  function impact(v, text) {
    const box = cardBox();
    stage.classList.remove('shake');
    void stage.offsetWidth;
    stage.classList.add('shake');
    screenFlash.animate([{ opacity: 0.75 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
    if (window.Ambience) window.Ambience.strike();
    slashFlash(v, box);
    splitCard(v, box);
    gore(box);
    if (v === VARIANTS.axe && axeBlood) axeBlood.setAttribute('opacity', '1');
    setTimeout(() => !skipped && soulRises(text, box), 350);
    big.textContent = v.word;
    big.classList.remove('show');
    void big.offsetWidth;
    big.classList.add('show');
    small.classList.remove('show');
  }

  function reset() {
    cleanupFns.forEach((f) => f());
    cleanupFns = [];
    card.style.visibility = '';
    card.classList.remove('drop');
    big.classList.remove('show');
    small.classList.remove('show');
    small.textContent = '';
    stage.classList.remove('shake');
    if (axeBlood) axeBlood.setAttribute('opacity', '0');
  }

  function close() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    setTimeout(reset, 400);
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

  async function play(text) {
    reset();
    skipped = false;
    lastVariant = lastVariant === 'axe' ? 'scythe' : 'axe';
    const v = VARIANTS[lastVariant];
    for (const k of Object.keys(VARIANTS)) {
      const other = VARIANTS[k];
      const on = other === v;
      other.arm.style.display = on ? '' : 'none';
      other.body.style.display = on ? '' : 'none';
    }
    setAngle(v, v.rest);
    card.textContent = text;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    void card.offsetWidth;
    card.classList.add('drop');
    small.textContent =
      v === VARIANTS.axe ? 'The executioner raises the axe…' : 'The reaper has come to collect…';
    small.classList.add('show');

    try {
      await sleep(reduced ? 200 : 750);
      if (!reduced) {
        await tween(v.rest, v.raised, 720, ease.outCubic, (d) => setAngle(v, d));
        await sleep(260);
        await tween(v.raised, v.strike, 150, ease.inQuad, (d) => setAngle(v, d));
      } else {
        setAngle(v, v.strike);
      }
      impact(v, text);
      await tween(v.strike, v.strike - 4, 90, ease.outCubic, (d) => setAngle(v, d));
      await tween(v.strike - 4, v.strike, 140, ease.inOut, (d) => setAngle(v, d));
      await sleep(1100);
      small.textContent = `“${text}” ${EPITAPHS[(Math.random() * EPITAPHS.length) | 0]}`;
      small.classList.add('show');
      await sleep(1400);
      await tween(v.strike, v.rest, 600, ease.inOut, (d) => setAngle(v, d));
      await sleep(250);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
    }
    close();
    skipped = false;
    await new Promise((r) => setTimeout(r, 300));
  }

  window.Execution = { play };
})();
