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

    const grave = h('article', { class: 'grave', 'data-id': p.id }, [stone, h('div', { class: 'mound' })]);
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
    for (const p of open) {
      const g = graveEl(p);
      graveyard.appendChild(g);
      if (pendingRise.has(p.id)) {
        pendingRise.delete(p.id);
        riseFromEarth(g);
      }
    }

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

  function riseFromEarth(grave) {
    grave.classList.add('rising');
    grave.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    if (reduced) return;
    const mound = grave.querySelector('.mound');
    for (let i = 0; i < 26; i++) {
      const d = document.createElement('div');
      d.className = 'dirt';
      d.style.left = 20 + Math.random() * 60 + '%';
      d.style.bottom = '18px';
      d.style.background = ['#3a2a1b', '#2a1d12', '#4a3622', '#3f5a34'][i % 4];
      grave.appendChild(d);
      const dx = (Math.random() - 0.5) * 220;
      const up = 60 + Math.random() * 120;
      d.animate(
        [
          { transform: 'translate(0,0)', opacity: 1 },
          { transform: `translate(${dx * 0.6}px, ${-up}px)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, 30px)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 600, delay: Math.random() * 400, easing: 'cubic-bezier(.2,.7,.5,1)', fill: 'forwards' }
      ).onfinish = () => d.remove();
    }
    if (mound) mound.style.zIndex = 2;
    setTimeout(() => grave.classList.remove('rising'), 1600);
  }

  function strikeGrave(grave) {
    if (reduced) return;
    grave.classList.remove('struck');
    void grave.offsetWidth;
    grave.classList.add('struck');
    const stone = grave.querySelector('.tombstone');
    const slash = document.createElement('div');
    slash.className = 'slash';
    slash.innerHTML =
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M95 8 Q 55 40 6 92" stroke="#ff3355" stroke-width="2.4" fill="none" stroke-linecap="round" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 6px #ff3355)"/></svg>';
    stone.appendChild(slash);
    setTimeout(() => slash.remove(), 600);
    const icons = ['👻', '💀', '🦇'];
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('div');
      s.className = 'soul';
      s.textContent = icons[i];
      s.style.left = 30 + Math.random() * 40 + '%';
      s.style.top = '30%';
      s.style.setProperty('--dx', (Math.random() - 0.5) * 80 + 'px');
      s.style.animationDelay = i * 0.12 + 's';
      grave.appendChild(s);
      setTimeout(() => s.remove(), 2000);
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
    if (grave) {
      const tally = grave.querySelector('.tally');
      tally.classList.add('bump');
      if (!wasVoted) strikeGrave(grave);
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
