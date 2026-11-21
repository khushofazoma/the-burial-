(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const graveyard = $('#graveyard');
  const buriedSection = $('#buriedSection');
  const buriedList = $('#buriedList');
  const form = $('#nominate');
  const featureInput = $('#feature');
  const reasonInput = $('#reason');
  const formError = $('#formError');
  const submitBtn = $('#submitBtn');
  const toastEl = $('#toast');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DEFAULT_EPITAPHS = [
    'It lived too long and did too little.',
    'Loved by no one. Maintained by everyone.',
    'It is not dead. It is just deprecated.',
    'Here lies tech debt, finally paid.',
    'It served its purpose. Briefly.',
    'Nobody remembers why it was built.',
  ];

  let state = { open: [], buried: [] };
  let lastJson = '';
  let sortMode = 'votes';
  let busy = false;
  const pendingRise = new Set();
  const crackLevels = new Map();
  let firstRender = true;

  const CRACKS = [
    'M71 6 L64 20 L69 28 L61 42 M64 20 L57 23',
    'M10 38 L22 46 L18 57 L29 66',
    'M52 70 L45 82 L53 91 L46 106 M45 82 L36 87',
    'M90 58 L80 70 L86 79 L75 96 M80 70 L92 75',
  ];
  const crackLevel = (votes) => [2, 4, 7, 11].filter((t) => votes >= t).length;
  const sfx = () => window.SFX;

  // ----------------------------------------------------------------- utils

  function hashIdx(str, n) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % n;
  }

  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function h(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    (children || []).forEach((c) => c && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  async function api(url, opts) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Something went bump in the night.');
      err.data = data;
      throw err;
    }
    return data;
  }

  // ----------------------------------------------------------------- render

  function sorted(list) {
    const copy = list.slice();
    if (sortMode === 'new') copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else copy.sort((a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt));
    return copy;
  }

  function rankOf(p) {
    // rank is always by votes, regardless of display sort
    const byVotes = state.open
      .slice()
      .sort((a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt));
    const idx = byVotes.findIndex((x) => x.id === p.id);
    return p.votes > 0 ? idx : -1;
  }

  function graveEl(p) {
    const rank = rankOf(p);
    const tally = h('span', { class: 'tally', 'aria-label': `${p.votes} votes` }, [
      h('span', { class: 'skull', text: '☠' }),
      h('span', { class: 'n', text: String(p.votes) }),
    ]);
    const btn = h(
      'button',
      {
        class: 'vote-btn' + (p.hasVoted ? ' voted' : ''),
        type: 'button',
        'aria-pressed': String(p.hasVoted),
        onclick: () => vote(p.id),
      },
      [p.hasVoted ? '⚰ Doomed' : '🪓 Kill it']
    );
    btn.title = p.hasVoted ? 'You voted to kill this. Click to spare it.' : 'Vote to kill this feature';

    const stone = h('div', { class: 'tombstone' }, [
      h('div', { class: 'rip', text: 'R.I.P.' }),
      h('div', { class: 'here-lies', text: 'Here lies' }),
      h('div', { class: 'feature-name', text: p.feature }),
      h('div', { class: 'epitaph', text: p.reason ? `“${p.reason}”` : DEFAULT_EPITAPHS[hashIdx(p.id, DEFAULT_EPITAPHS.length)] }),
      h('div', { class: 'dates', text: `Condemned ${fmtDate(p.createdAt)}` }),
      h('div', { class: 'vote-row' }, [tally, btn]),
    ]);

    const level = crackLevel(p.votes);
    const prevLevel = crackLevels.has(p.id) ? crackLevels.get(p.id) : level;
    crackLevels.set(p.id, level);
    if (level > 0) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 120');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'cracks');
      svg.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < level; i++) {
        for (const cls of ['crack-hi', 'crack']) {
          const path = document.createElementNS(NS, 'path');
          path.setAttribute('d', CRACKS[i]);
          path.setAttribute('pathLength', '1');
          path.setAttribute('class', cls + (i >= prevLevel ? ' fresh' : ''));
          svg.appendChild(path);
        }
      }
      stone.appendChild(svg);
    }

    const grave = h('article', { class: 'grave', 'data-id': p.id }, [stone, h('div', { class: 'mound' })]);
    if (!reduced) {
      grave.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = stone.getBoundingClientRect();
        const dx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const dy = ((e.clientY - r.top) / r.height) * 2 - 1;
        const mag = Math.min(1, Math.hypot(dx, dy));
        stone.style.rotate = `${(-dy).toFixed(3)} ${dx.toFixed(3)} 0 ${(mag * 9).toFixed(2)}deg`;
        stone.style.setProperty('--mx', ((dx + 1) * 50).toFixed(1) + '%');
        stone.style.setProperty('--my', ((dy + 1) * 50).toFixed(1) + '%');
      });
      grave.addEventListener('pointerleave', () => {
        stone.style.rotate = '';
      });
    }
    if (rank === 0) {
      grave.classList.add('doomed');
      grave.appendChild(h('div', { class: 'rank-badge', text: '☠ Next to die' }));
      grave.appendChild(h('div', { class: 'candle l' }));
      grave.appendChild(h('div', { class: 'candle r' }));
    } else if (rank === 1 || rank === 2) {
      grave.appendChild(h('div', { class: 'rank-badge', text: `#${rank + 1} on death row` }));
    }
    return grave;
  }

  function render() {
    graveyard.replaceChildren();
    const open = sorted(state.open);
    if (!open.length) {
      graveyard.appendChild(
        h('div', { class: 'empty', style: 'grid-column:1/-1' }, [
          h('span', { class: 'ghost', text: '👻' }),
          'The graveyard is empty. Suspiciously empty. Nominate the first victim.',
        ])
      );
    }
    open.forEach((p, i) => {
      const g = graveEl(p);
      graveyard.appendChild(g);
      if (firstRender && !reduced) {
        g.classList.add('emerge');
        g.style.setProperty('--delay', Math.min(i, 12) * 90 + 'ms');
        setTimeout(() => g.classList.remove('emerge'), 1200 + Math.min(i, 12) * 90);
      }
      if (pendingRise.has(p.id)) {
        pendingRise.delete(p.id);
        riseFromEarth(g);
      }
    });
    if (open.length) firstRender = false;

    buriedList.replaceChildren();
    buriedSection.hidden = !state.buried.length;
    for (const p of state.buried) {
      buriedList.appendChild(
        h('div', { class: 'buried-item' }, [
          h('div', { class: 'cross', text: '✝' }),
          h('div', { class: 'name', text: p.feature }),
          h('div', { class: 'when', text: `Laid to rest ${fmtDate(p.buriedAt || p.createdAt)} · ${p.votes} votes` }),
        ])
      );
    }
  }

  async function load() {
    try {
      const data = await api('/api/proposals');
      const json = JSON.stringify(data);
      if (json !== lastJson && !busy) {
        lastJson = json;
        state = data;
        render();
      }
    } catch (e) {
      console.error(e);
    }
  }

  // ----------------------------------------------------------------- effects

  function particle(parent, cls, styles) {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, styles);
    parent.appendChild(d);
    return d;
  }

  // Parabolic arc as keyframes (WAAPI has no gravity, so sample it).
  function arcFrames(vx, vy, gravity, dur, spin) {
    const frames = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * dur;
      const x = vx * t;
      const y = vy * t + 0.5 * gravity * t * t;
      frames.push({
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(spin * t).toFixed(0)}deg)`,
        opacity: i < steps * 0.7 ? 1 : 1 - (i - steps * 0.7) / (steps * 0.3),
      });
    }
    return frames;
  }

  function dustPuff(parent, x, y, n, spread) {
    for (let i = 0; i < n; i++) {
      const size = 30 + Math.random() * 40;
      const d = particle(parent, 'dust-puff', {
        left: `calc(${x} - ${size / 2}px)`,
        top: `calc(${y} - ${size / 2}px)`,
        width: size + 'px',
        height: size + 'px',
      });
      const dx = (Math.random() - 0.5) * spread;
      d.animate(
        [
          { transform: 'translate(0,0) scale(0.3)', opacity: 0.55 },
          { transform: `translate(${dx}px, ${-20 - Math.random() * 30}px) scale(1.6)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'forwards' }
      ).onfinish = () => d.remove();
    }
  }

  function riseFromEarth(grave) {
    grave.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    if (reduced) return;
    grave.classList.add('rising');
    const s = sfx();
    // the earth splits first
    particle(grave, 'rift', {});
    setTimeout(() => {
      if (s) s.rumble();
      if (window.Ambience) window.Ambience.strike();
      // neighbouring graves tremble
      graveyard.querySelectorAll('.grave').forEach((g) => {
        if (g === grave) return;
        g.classList.remove('tremor');
        void g.offsetWidth;
        g.classList.add('tremor');
        setTimeout(() => g.classList.remove('tremor'), 900);
      });
    }, 250);
    setTimeout(() => {
      dustPuff(grave, '50%', 'calc(100% - 30px)', 9, 260);
      for (let i = 0; i < 34; i++) {
        const size = 4 + Math.random() * 7;
        const d = particle(grave, 'dirt', {
          left: 25 + Math.random() * 50 + '%',
          bottom: '24px',
          width: size + 'px',
          height: size + 'px',
          background: ['#3a2a1b', '#2a1d12', '#4a3622', '#3f5a34', '#5a4630'][i % 5],
        });
        const vx = (Math.random() - 0.5) * 420;
        const vy = -(240 + Math.random() * 380);
        const dur = 0.9 + Math.random() * 0.5;
        d.animate(arcFrames(vx, vy, 900, dur, (Math.random() - 0.5) * 900), {
          duration: dur * 1000,
          delay: Math.random() * 300,
          easing: 'linear',
          fill: 'forwards',
        }).onfinish = () => d.remove();
      }
    }, 300);
    setTimeout(() => {
      grave.classList.remove('rising');
      grave.querySelectorAll('.rift').forEach((r) => r.remove());
    }, 2200);
  }

  const SCYTHE_SVG =
    '<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="vsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eef1f6"/><stop offset="1" stop-color="#6b7079"/></linearGradient></defs>' +
    '<rect x="57" y="20" width="6" height="100" rx="3" fill="#3b2a1d"/>' +
    '<path d="M60 22 Q 18 10 4 44 Q 30 26 62 32 Z" fill="url(#vsg)" stroke="#25262b" stroke-width="1.5"/></svg>';

  function strikeGrave(grave) {
    if (reduced) return;
    const stone = grave.querySelector('.tombstone');

    // the scythe sweeps across the stone
    const sweep = particle(grave, 'vote-scythe', {});
    sweep.innerHTML = SCYTHE_SVG;
    sweep.animate(
      [
        { transform: 'rotate(-75deg) scale(0.9)', opacity: 0 },
        { transform: 'rotate(-55deg) scale(1)', opacity: 1, offset: 0.25 },
        { transform: 'rotate(40deg) scale(1)', opacity: 1, offset: 0.6 },
        { transform: 'rotate(55deg) scale(0.95)', opacity: 0 },
      ],
      { duration: 480, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }
    ).onfinish = () => sweep.remove();

    const trail = particle(stone, 'slash', {});
    trail.innerHTML =
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M96 10 Q 50 36 6 88" pathLength="1" stroke="url(#slashGrad)" stroke-width="5" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      '<defs><linearGradient id="slashGrad" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffd6dc"/><stop offset="1" stop-color="#ff3355"/></linearGradient></defs></svg>';
    setTimeout(() => trail.remove(), 700);

    setTimeout(() => {
      grave.classList.remove('struck');
      void grave.offsetWidth;
      grave.classList.add('struck');
      // stone chips
      for (let i = 0; i < 12; i++) {
        const size = 3 + Math.random() * 6;
        const d = particle(grave, 'shard', {
          left: 35 + Math.random() * 30 + '%',
          top: 35 + Math.random() * 25 + '%',
          width: size + 'px',
          height: size * (0.6 + Math.random() * 0.6) + 'px',
        });
        const vx = (Math.random() - 0.5) * 360;
        const vy = -(120 + Math.random() * 260);
        const dur = 0.7 + Math.random() * 0.4;
        d.animate(arcFrames(vx, vy, 1100, dur, (Math.random() - 0.5) * 1200), {
          duration: dur * 1000,
          easing: 'linear',
          fill: 'forwards',
        }).onfinish = () => d.remove();
      }
      dustPuff(grave, '50%', '45%', 4, 120);
      // a small soul escapes
      const ghost = particle(grave, 'ghost-wisp', {
        left: 40 + Math.random() * 20 + '%',
        top: '30%',
      });
      ghost.innerHTML =
        '<svg viewBox="0 0 40 50" aria-hidden="true"><path d="M20 2 C 8 2 4 12 4 22 L4 44 L10 38 L15 46 L20 38 L25 46 L30 38 L36 44 L36 22 C 36 12 32 2 20 2Z" fill="rgba(210,255,222,0.85)"/><circle cx="14" cy="20" r="3" fill="#0b1a10"/><circle cx="26" cy="20" r="3" fill="#0b1a10"/><ellipse cx="20" cy="30" rx="3" ry="4" fill="#0b1a10"/></svg>';
      const dx = (Math.random() - 0.5) * 60;
      ghost.animate(
        [
          { transform: 'translate(0, 10px) scale(0.4)', opacity: 0 },
          { transform: `translate(${dx * 0.3}px, -30px) scale(1) rotate(-6deg)`, opacity: 1, offset: 0.25 },
          { transform: `translate(${-dx * 0.4}px, -80px) scale(1.05) rotate(6deg)`, opacity: 0.85, offset: 0.6 },
          { transform: `translate(${dx}px, -140px) scale(1.15, 1.3)`, opacity: 0 },
        ],
        { duration: 1700, easing: 'cubic-bezier(.3,.1,.4,1)', fill: 'forwards' }
      ).onfinish = () => ghost.remove();
    }, 190);
  }

  function rollTally(grave, up) {
    const n = grave.querySelector('.tally .n');
    const tally = grave.querySelector('.tally');
    if (!n || reduced) return;
    n.animate(
      [
        { transform: `translateY(${up ? 90 : -90}%)`, opacity: 0, filter: 'blur(2px)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' },
      ],
      { duration: 380, delay: up ? 200 : 0, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'backwards' }
    );
    if (up) {
      tally.classList.remove('bump');
      void tally.offsetWidth;
      setTimeout(() => tally.classList.add('bump'), 200);
    }
  }

  // ----------------------------------------------------------------- actions

  async function vote(id) {
    const p = state.open.find((x) => x.id === id);
    if (!p) return;
    const wasVoted = p.hasVoted;
    // optimistic update
    p.hasVoted = !wasVoted;
    p.votes += wasVoted ? -1 : 1;
    render();
    const grave = graveyard.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const s = sfx();
    if (s) s.unlock();
    if (grave) {
      rollTally(grave, !wasVoted);
      if (!wasVoted) {
        if (s) s.chop();
        strikeGrave(grave);
      } else {
        grave.classList.remove('spared');
        void grave.offsetWidth;
        grave.classList.add('spared');
      }
    }
    try {
      const updated = await api(`/api/proposals/${encodeURIComponent(id)}/vote`, { method: 'POST' });
      Object.assign(p, updated);
      lastJson = '';
      // keep the struck animation visible; refresh counts quietly afterwards
      setTimeout(load, 1800);
    } catch (e) {
      p.hasVoted = wasVoted;
      p.votes += wasVoted ? 1 : -1;
      render();
      toast(e.message);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    const feature = featureInput.value.trim();
    const reason = reasonInput.value.trim();
    if (feature.length < 2) {
      formError.textContent = 'Name the part of the tool you want dead.';
      featureInput.focus();
      return;
    }
    submitBtn.disabled = true;
    busy = true;
    if (sfx()) sfx().unlock();
    try {
      const created = await api('/api/proposals', {
        method: 'POST',
        body: JSON.stringify({ feature, reason }),
      });
      form.reset();
      updateCounts();
      await window.Execution.play(created.feature);
      pendingRise.add(created.id);
      busy = false;
      lastJson = '';
      await load();
    } catch (err) {
      formError.textContent = err.message;
      if (err.data && err.data.id) {
        const g = graveyard.querySelector(`[data-id="${CSS.escape(err.data.id)}"]`);
        if (g) {
          g.scrollIntoView({ behavior: 'smooth', block: 'center' });
          strikeGrave(g);
        }
      }
    } finally {
      busy = false;
      submitBtn.disabled = false;
    }
  });

  function updateCounts() {
    $('#featureCount').textContent = `${featureInput.value.length}/80`;
    $('#reasonCount').textContent = `${reasonInput.value.length}/280`;
  }
  featureInput.addEventListener('input', updateCounts);
  reasonInput.addEventListener('input', updateCounts);

  document.querySelectorAll('.chip[data-sort]').forEach((chip) => {
    chip.addEventListener('click', () => {
      sortMode = chip.dataset.sort;
      document.querySelectorAll('.chip[data-sort]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      render();
    });
  });

  load();
  // live updates during the meeting
  setInterval(() => {
    if (!document.hidden) load();
  }, 10000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) load();
  });
})();
