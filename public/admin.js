(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const dash = $('#dash');
  const rows = $('#rows');
  const stats = $('#stats');
  const toastEl = $('#toast');

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3000);
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
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('Signed out.');
    }
    if (res.status === 403) {
      location.href = '/';
      throw new Error('Not an admin.');
    }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed.');
    return data;
  }

  function h(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    (children || []).forEach((c) => c && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';


  function stat(label, value) {
    return h('div', { class: 'stat' }, [h('div', { class: 'label', text: label }), h('div', { class: 'value', text: String(value) })]);
  }

  const fmtDay = (d) =>
    d ? new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

  async function loadRegister() {
    let data;
    try {
      data = await api('/api/admin/participants');
    } catch (e) {
      return;
    }
    const body = $('#registerRows');
    body.replaceChildren();
    if (!data.participants.length) {
      body.appendChild(h('tr', {}, [h('td', { colspan: '4', class: 'empty', text: 'Nobody has voted yet.' })]));
      return;
    }
    for (const p of data.participants) {
      body.appendChild(
        h('tr', {}, [
          h('td', {}, [h('div', { class: 'feat', text: p.name || '—' })]),
          h('td', { text: p.email }),
          h('td', { text: fmtDay(p.firstVoted) }),
          h('td', { text: fmtDay(p.lastVoted) }),
        ])
      );
    }
  }

  $('#clearRegister').addEventListener('click', async () => {
    if (!confirm('Clear the register of who has voted? Votes themselves are not affected.')) return;
    try {
      await api('/api/admin/participants', { method: 'DELETE' });
      toast('Register cleared.');
      load();
    } catch (e) {
      toast(e.message);
    }
  });

  async function load() {
    loadRegister();
    let data;
    try {
      data = await api('/api/admin/proposals');
    } catch (e) {
      return toast(e.message);
    }
    const { proposals, stats: s } = data;
    stats.replaceChildren(
      stat('On death row', s.open),
      stat('Laid to rest', s.buried),
      stat('Votes cast', s.votes),
      stat('Mourners', s.voters),
      stat('Total nominations', s.total)
    );

    const max = Math.max(1, ...proposals.map((p) => p.votes));
    rows.replaceChildren();
    if (!proposals.length) {
      rows.appendChild(
        h('tr', {}, [h('td', { colspan: '6', class: 'empty', text: 'No nominations yet. The crypt is quiet.' })])
      );
      return;
    }
    let rank = 0;
    for (const p of proposals) {
      const isOpen = p.status === 'open';
      if (isOpen) rank++;
      const bar = h('div', { class: 'bar' }, [h('span', { style: `width:${(p.votes / max) * 100}%` })]);
      const actions = h('div', { class: 'actions' }, [
        h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          text: isOpen ? '⚰ Lay to rest' : '↺ Resurrect',
          title: isOpen ? 'Mark as officially retired' : 'Move back to death row',
          onclick: () => setStatus(p, isOpen ? 'buried' : 'open'),
        }),
        h('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          text: 'Reset votes',
          onclick: () => resetVotes(p),
        }),
        h('button', {
          class: 'btn btn-danger btn-sm',
          type: 'button',
          text: '✕ Remove',
          onclick: () => remove(p),
        }),
      ]);
      rows.appendChild(
        h('tr', { class: isOpen ? '' : 'is-buried' }, [
          h('td', { class: 'num', text: isOpen ? String(rank) : '✝' }),
          h('td', {}, [
            h('div', { class: 'feat', text: p.feature }),
            p.reason ? h('div', { class: 'why', text: p.reason }) : null,
          ]),
          h('td', {}, [h('div', { class: 'num', style: 'font-family:var(--font-ui);font-weight:700;font-size:1.2rem;color:var(--bone)', text: String(p.votes) }), bar]),
          h('td', {}, [h('span', { class: `status-pill ${p.status}`, text: isOpen ? 'Death row' : 'Buried' })]),
          h('td', { text: fmt(p.createdAt) }),
          h('td', {}, [actions]),
        ])
      );
    }
  }

  async function setStatus(p, status) {
    try {
      await api(`/api/admin/proposals/${encodeURIComponent(p.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      toast(status === 'buried' ? `“${p.feature}” has been laid to rest.` : `“${p.feature}” rises again.`);
      load();
    } catch (e) {
      toast(e.message);
    }
  }

  async function resetVotes(p) {
    if (!confirm(`Reset all votes for “${p.feature}”?`)) return;
    try {
      await api(`/api/admin/proposals/${encodeURIComponent(p.id)}/reset-votes`, { method: 'POST' });
      toast('Votes reset.');
      load();
    } catch (e) {
      toast(e.message);
    }
  }

  async function remove(p) {
    if (!confirm(`Permanently remove “${p.feature}” and its ${p.votes} votes? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/proposals/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      toast('Proposal removed.');
      load();
    } catch (e) {
      toast(e.message);
    }
  }


  $('#refresh').addEventListener('click', load);

  setInterval(() => {
    if (!dash.hidden && !document.hidden) load();
  }, 10000);

  load();
})();
