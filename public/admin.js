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
      location.href = '/gate?next=/admin';
      throw new Error('Password needed.');
    }
    if (res.status === 403) {
      showLock();
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

  async function load() {
    loadBook();
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
        isOpen
          ? h('button', {
              class: 'btn btn-sm ' + (p.chosen ? 'btn-blood' : 'btn-ghost'),
              type: 'button',
              text: p.chosen ? '☠ Next to die ✓' : '☠ Mark next to die',
              title: p.chosen ? 'Click to remove the mark' : 'Show this grave as next to die',
              onclick: () => setChosen(p, !p.chosen),
            })
          : null,
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
          h('td', {}, [
            h('span', {
              class: `status-pill ${p.chosen ? 'chosen' : p.status}`,
              text: p.chosen ? 'Next to die' : isOpen ? 'Death row' : 'Buried',
            }),
          ]),
          h('td', { text: fmt(p.createdAt) }),
          h('td', {}, [actions]),
        ])
      );
    }
  }

  async function setChosen(p, chosen) {
    if (window.SFX) window.SFX.unlock();
    try {
      const res = await api(`/api/admin/proposals/${encodeURIComponent(p.id)}/chosen`, {
        method: 'POST',
        body: JSON.stringify({ chosen }),
      });
      if (chosen && res.verdict) {
        // don't replay this one when the admin next opens the graveyard
        try {
          const key = 'funeral_seen_sentences';
          const seen = JSON.parse(localStorage.getItem(key) || '[]');
          seen.push(p.id + ':' + res.verdict.chosenAt);
          localStorage.setItem(key, JSON.stringify(seen.slice(-100)));
        } catch {
          /* storage unavailable */
        }
        load();
        await window.Verdict.play(res.verdict);
      } else {
        toast(chosen ? `“${p.feature}” is next to die.` : `“${p.feature}” is spared, for now.`);
      }
      load();
    } catch (e) {
      toast(e.message);
    }
  }

  // ---- the book of the dead
  const OUTCOMES = { awaiting: 'Awaiting execution', executed: 'Executed', spared: 'Spared', removed: 'Removed' };

  async function loadBook() {
    let data;
    try {
      data = await api('/api/admin/verdicts');
    } catch {
      return;
    }
    const body = $('#bookRows');
    body.replaceChildren();
    if (!data.verdicts.length) {
      body.appendChild(h('tr', {}, [h('td', { colspan: '6', class: 'empty', text: 'Nobody has been sentenced yet.' })]));
      return;
    }
    for (const v of data.verdicts) {
      const input = h('input', { type: 'month', class: 'month-input', value: v.month, 'aria-label': 'Month' });
      input.addEventListener('change', async () => {
        if (!input.value) return;
        try {
          await api(`/api/admin/verdicts/${encodeURIComponent(v.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ month: input.value }),
          });
          toast(`Moved to ${window.Verdict.monthLabel(input.value)}.`);
          loadBook();
        } catch (e) {
          toast(e.message);
        }
      });
      body.appendChild(
        h('tr', {}, [
          h('td', {}, [input]),
          h('td', {}, [h('div', { class: 'feat', text: v.feature })]),
          h('td', { class: 'num', text: String(v.votes) }),
          h('td', { text: fmt(v.chosenAt) }),
          h('td', {}, [h('span', { class: 'outcome ' + v.outcome, text: OUTCOMES[v.outcome] || v.outcome })]),
          h('td', {}, [
            h('button', {
              class: 'btn btn-danger btn-sm',
              type: 'button',
              text: 'Delete',
              onclick: async () => {
                if (!confirm(`Delete the record of “${v.feature}” from the book?`)) return;
                try {
                  await api(`/api/admin/verdicts/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
                  loadBook();
                } catch (e) {
                  toast(e.message);
                }
              },
            }),
          ]),
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

  // ---- password unlock for signed-in users who are not on the admin email list
  function showLock() {
    dash.hidden = true;
    $('#bookPanel').hidden = true;
    $('#lockBox').hidden = false;
    $('#adminPassword').focus();
  }

  function showDash() {
    $('#lockBox').hidden = true;
    dash.hidden = false;
    $('#bookPanel').hidden = false;
    load();
  }

  $('#unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#unlockError').textContent = '';
    try {
      await api('/api/admin/unlock', {
        method: 'POST',
        body: JSON.stringify({ password: $('#adminPassword').value }),
      });
      $('#adminPassword').value = '';
      showDash();
    } catch (err) {
      $('#unlockError').textContent = err.message;
    }
  });

  api('/api/me')
    .then((me) => (me.admin ? showDash() : showLock()))
    .catch(() => {});
})();
