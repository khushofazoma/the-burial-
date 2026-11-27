// The sentencing: a full-screen reveal when a feature is chosen as next to die.
// Verdict.play({ feature, month: 'YYYY-MM', votes }) -> Promise resolved when dismissed.
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';

  function monthLabel(month) {
    if (!/^\d{4}-\d{2}$/.test(month || '')) return '';
    return new Date(month + '-01T00:00:00Z').toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  // Irregular wax-seal outline.
  function waxPath(cx, cy, r, bumps) {
    const pts = [];
    const n = 72;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wobble = Math.sin(a * bumps) * 2.6 + Math.sin(a * 7 + 1.3) * 1.6 + Math.sin(a * 13 + 0.4) * 0.9;
      pts.push([cx + Math.cos(a) * (r + wobble), cy + Math.sin(a) * (r + wobble)]);
    }
    return 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + ' Z';
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  function buildSeal(month) {
    const svg = svgEl('svg', { viewBox: '0 0 200 200', 'aria-hidden': 'true' });
    const defs = svgEl('defs', {});
    const grad = svgEl('radialGradient', { id: 'waxGrad', cx: '38%', cy: '32%', r: '75%' });
    grad.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#e0344d' }));
    grad.appendChild(svgEl('stop', { offset: '0.55', 'stop-color': '#a3101f' }));
    grad.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#5c0611' }));
    defs.appendChild(grad);
    defs.appendChild(svgEl('path', { id: 'sealRing', d: 'M100,100 m-66,0 a66,66 0 1,1 132,0 a66,66 0 1,1 -132,0' }));
    svg.appendChild(defs);
    svg.appendChild(svgEl('path', { d: waxPath(100, 100, 92, 9), fill: 'url(#waxGrad)', class: 'seal-wax' }));
    svg.appendChild(svgEl('circle', { cx: 100, cy: 100, r: 78, fill: 'none', stroke: 'rgba(255,210,215,0.35)', 'stroke-width': 1.5 }));
    svg.appendChild(svgEl('circle', { cx: 100, cy: 100, r: 54, fill: 'none', stroke: 'rgba(255,210,215,0.35)', 'stroke-width': 1.5 }));
    const ring = svgEl('g', { class: 'seal-ring' });
    const text = svgEl('text', { class: 'seal-text' });
    // stretch one pass of the label to exactly fill the ring, so it never overlaps itself
    const ringLength = Math.round(2 * Math.PI * 66) - 6;
    const tp = svgEl('textPath', { href: '#sealRing', startOffset: '0', textLength: ringLength, lengthAdjust: 'spacing' });
    tp.textContent = ('Sentenced  ·  ' + (monthLabel(month) || 'This month') + '  ·  Next to die  ·  ').toUpperCase();
    text.appendChild(tp);
    ring.appendChild(text);
    svg.appendChild(ring);
    svg.appendChild(svgEl('image', { href: '/brand/azoma-mark-white.svg', x: 72, y: 72, width: 56, height: 56, class: 'seal-mark' }));
    // highlight on the wax
    svg.appendChild(svgEl('ellipse', { cx: 76, cy: 62, rx: 26, ry: 12, fill: 'rgba(255,255,255,0.14)', transform: 'rotate(-30 76 62)' }));
    return svg;
  }

  function splatter(host, n) {
    for (let i = 0; i < n; i++) {
      const d = el('i', 'seal-drop');
      const ang = Math.random() * Math.PI * 2;
      // keep the drops beside the seal, clear of the text above and below
      const dist = 85 + Math.random() * 70;
      d.style.setProperty('--x', (Math.cos(ang) * dist * 1.4).toFixed(0) + 'px');
      d.style.setProperty('--y', (Math.sin(ang) * dist * 0.45).toFixed(0) + 'px');
      const size = 3 + Math.random() * 9;
      d.style.width = d.style.height = size + 'px';
      d.style.animationDelay = (Math.random() * 0.08).toFixed(2) + 's';
      host.appendChild(d);
    }
  }

  let active = null;

  function play({ feature, month, votes }) {
    if (active) return active;
    const sfx = window.SFX;
    const root = el('div', 'sentence');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-live', 'assertive');
    root.setAttribute('aria-label', `${feature} has been sentenced to die`);

    const inner = el('div', 'sentence-inner');
    inner.appendChild(el('div', 'sentence-kicker', 'The Undertaker has decided'));

    const name = el('h2', 'sentence-name');
    String(feature)
      .split(/\s+/)
      .forEach((w, i) => {
        const s = el('span', 'w', w);
        s.style.setProperty('--i', i);
        name.appendChild(s);
        name.appendChild(document.createTextNode(' '));
      });
    inner.appendChild(name);
    inner.appendChild(el('div', 'sentence-rule'));

    const sealWrap = el('div', 'sentence-seal');
    sealWrap.appendChild(buildSeal(month));
    const pulse = el('div', 'seal-pulse');
    sealWrap.appendChild(pulse);
    inner.appendChild(sealWrap);

    const meta = [`Next to die`, monthLabel(month)];
    if (typeof votes === 'number') meta.push(`${votes} vote${votes === 1 ? '' : 's'}`);
    inner.appendChild(el('div', 'sentence-meta', meta.filter(Boolean).join('  ·  ')));
    inner.appendChild(el('div', 'sentence-hint', 'Click anywhere to continue'));

    root.appendChild(inner);
    document.body.appendChild(root);
    document.body.classList.add('scene-dimmed');
    void root.offsetWidth;
    root.classList.add('play');
    if (reduced) root.classList.add('still');

    const timers = [];
    if (!reduced) {
      // the seal lands at ~1.75s
      timers.push(
        setTimeout(() => {
          root.classList.add('stamped');
          splatter(sealWrap, 16);
          if (sfx) sfx.thud();
        }, 1750)
      );
      timers.push(setTimeout(() => sfx && sfx.bell(), 1900));
    } else if (sfx) {
      timers.push(setTimeout(() => sfx.bell(), 300));
    }

    active = new Promise((resolve) => {
      let closed = false;
      function close() {
        if (closed) return;
        closed = true;
        timers.forEach(clearTimeout);
        document.removeEventListener('keydown', onKey);
        root.classList.add('closing');
        document.body.classList.remove('scene-dimmed');
        setTimeout(() => {
          root.remove();
          active = null;
          resolve();
        }, 450);
      }
      function onKey(e) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') close();
      }
      root.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      timers.push(setTimeout(close, 7000));
    });
    return active;
  }

  window.Verdict = { play, monthLabel };
})();
