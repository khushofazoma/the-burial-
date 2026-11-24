// The Funeral: Cloudflare Worker backend.
//
// - The graveyard is public: no sign-in needed to view, nominate or vote.
// - The admin dashboard is unlocked by ADMIN_PASSWORD, or by Google sign-in for ADMIN_EMAILS.
// - Admin sessions live in an HMAC-signed cookie.
// - Proposals and ballots in Cloudflare D1. Static files in ./public via the ASSETS binding.
//
// Anonymity: each browser gets a random voter id in a cookie, never stored server-side.
// A ballot is HMAC(BALLOT_SECRET, "v:" + voterId + ":" + proposalId), so one vote per
// browser per proposal, and nothing links a vote to a person.

const SESSION_COOKIE = 'funeral_session';
const STATE_COOKIE = 'funeral_oauth';
const VOTER_COOKIE = 'funeral_voter';
const VOTER_TTL = 5 * 365 * 24 * 60 * 60;
const SESSION_TTL = 7 * 24 * 60 * 60; // seconds
const MAX_FEATURE = 80;
const MAX_REASON = 280;

// Nominating the company itself is an easter egg handled in the browser; never store it.
// Keep in sync with public/app.js.
const MOTHERSHIP = /^\s*(?:the\s+)?(?:whole\s+(?:of\s+)?|entire\s+|all\s+of\s+)?(?:the\s+)?azoma(?:\.ai)?(?:\s+(?:itself|as\s+a\s+whole|the\s+company|company|platform|app|inc\.?|ltd\.?))?\s*[!.?]*\s*$/i;


const enc = new TextEncoder();

// ---------------------------------------------------------------- crypto helpers

const keyCache = new Map();
async function hmacKey(secret) {
  if (!keyCache.has(secret)) {
    keyCache.set(
      secret,
      crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
    );
  }
  return keyCache.get(secret);
}

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacHex(secret, data) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(secret, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return body + '.' + b64url(sig);
}

async function unsign(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function randomToken(n = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

// ---------------------------------------------------------------- http helpers

function parseCookies(request) {
  const out = {};
  const header = request.headers.get('Cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(name, value, { maxAge, secure }) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '),
};

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

function json(data, status = 200, headers = {}) {
  return withHeaders(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }),
    headers
  );
}

function redirect(location, headers = {}) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.set(k, v);
  }
  return new Response(null, { status: 302, headers: h });
}

function clean(str, max) {
  return String(str || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

// ---------------------------------------------------------------- auth

function isLocal(url) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

function emailAllowed(env, email) {
  const domain = email.split('@')[1] || '';
  return list(env.ALLOWED_DOMAINS).includes(domain.toLowerCase());
}

// Admin if signed in with Google as one of ADMIN_EMAILS, or unlocked with ADMIN_PASSWORD.
function isAdmin(env, session) {
  if (!session) return false;
  if (session.email && list(env.ADMIN_EMAILS).includes(session.email.toLowerCase())) return true;
  return session.admin === true && !!env.ADMIN_PASSWORD;
}

async function passwordMatches(env, attempt) {
  if (!env.ADMIN_PASSWORD || typeof attempt !== 'string') return false;
  // compare HMACs so the check takes the same time whatever the input
  const [a, b] = await Promise.all([hmacHex(env.SESSION_SECRET, attempt), hmacHex(env.SESSION_SECRET, env.ADMIN_PASSWORD)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// best-effort, per-isolate limit on password guesses
const unlockLog = new Map();
function unlockAllowed(key) {
  const now = Date.now();
  const recent = (unlockLog.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (recent.length >= 8) return false;
  recent.push(now);
  unlockLog.set(key, recent);
  return true;
}

// Admin session (Google-signed-in admin, or password-unlocked).
async function getSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  const s = await unsign(env.SESSION_SECRET, token);
  if (!s) return null;
  if (s.email && !emailAllowed(env, s.email)) return null;
  return s;
}

const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'local';

async function startSession(env, url, email, name, extra = {}) {
  const token = await sign(env.SESSION_SECRET, {
    email: (email || '').toLowerCase(),
    name: name || '',
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
    ...extra,
  });
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL, secure: url.protocol === 'https:' });
}

function loginError(code) {
  return redirect('/login?error=' + encodeURIComponent(code));
}

async function handleAuth(request, env, url) {
  const secure = url.protocol === 'https:';

  // Local development only: sign in as any address without Google.
  if (url.pathname === '/auth/dev') {
    if (!(env.DEV_LOGIN === 'true' && isLocal(url))) return new Response('Not found', { status: 404 });
    const email = (url.searchParams.get('email') || '').trim();
    if (!emailAllowed(env, email)) return redirect('/login?dev=1&error=domain');
    if (!list(env.ADMIN_EMAILS).includes(email.toLowerCase())) return redirect('/login?dev=1&error=notadmin');
    return redirect('/admin', { 'Set-Cookie': await startSession(env, url, email, 'Dev user') });
  }

  if (url.pathname === '/auth/login') {
    if (env.DEV_LOGIN === 'true' && isLocal(url)) return redirect('/login?dev=1');
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return loginError('config');
    const state = randomToken();
    const nonce = randomToken();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: url.origin + '/auth/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      prompt: 'select_account',
    });
    const stateCookie = await sign(env.SESSION_SECRET, { state, nonce, exp: Math.floor(Date.now() / 1000) + 600 });
    return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params, {
      'Set-Cookie': cookie(STATE_COOKIE, stateCookie, { maxAge: 600, secure }),
    });
  }

  if (url.pathname === '/auth/callback') {
    const clearState = cookie(STATE_COOKIE, '', { maxAge: 0, secure });
    const saved = await unsign(env.SESSION_SECRET, parseCookies(request)[STATE_COOKIE]);
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error')) return loginError('cancelled');
    if (!saved || !code || url.searchParams.get('state') !== saved.state) return loginError('state');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: url.origin + '/auth/callback',
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return loginError('google');
    const tokens = await tokenRes.json();

    // The ID token came straight from Google over TLS, so its claims can be
    // read without verifying the signature; the standard claims are still checked.
    let claims;
    try {
      claims = JSON.parse(new TextDecoder().decode(b64urlDecode(tokens.id_token.split('.')[1])));
    } catch {
      return loginError('google');
    }
    const now = Date.now() / 1000;
    const validIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    if (!validIssuer || claims.aud !== env.GOOGLE_CLIENT_ID || claims.exp < now || claims.nonce !== saved.nonce) {
      return loginError('google');
    }
    const email = String(claims.email || '').toLowerCase();
    if (!claims.email_verified || !emailAllowed(env, email)) {
      return redirect('/login?error=domain', { 'Set-Cookie': clearState });
    }
    if (env.REQUIRE_WORKSPACE === 'true' && (claims.hd || '').toLowerCase() !== email.split('@')[1]) {
      return redirect('/login?error=domain', { 'Set-Cookie': clearState });
    }
    if (!list(env.ADMIN_EMAILS).includes(email)) {
      return redirect('/login?error=notadmin', { 'Set-Cookie': clearState });
    }
    return redirect('/admin', { 'Set-Cookie': [clearState, await startSession(env, url, email, claims.name)] });
  }

  if (url.pathname === '/auth/logout') {
    return redirect('/', { 'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0, secure }) });
  }

  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------- data

async function ballotHash(env, voterId, proposalId) {
  return hmacHex(env.BALLOT_SECRET, 'v:' + voterId + ':' + proposalId);
}

// Anonymous per-browser voter id. Returns [id, Set-Cookie header or null].
function voterIdentity(request, url) {
  const existing = parseCookies(request)[VOTER_COOKIE];
  if (existing && /^[A-Za-z0-9_-]{32}$/.test(existing)) return [existing, null];
  const id = randomToken(24);
  return [id, cookie(VOTER_COOKIE, id, { maxAge: VOTER_TTL, secure: url.protocol === 'https:' })];
}

function toView(row, voted) {
  return {
    id: row.id,
    feature: row.feature,
    reason: row.reason,
    votes: row.votes || 0,
    status: row.status,
    createdAt: row.created_at,
    buriedAt: row.buried_at || null,
    hasVoted: !!voted,
  };
}

async function allProposals(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.feature, p.reason, p.status, p.created_at, p.buried_at, COUNT(b.ballot) AS votes
       FROM proposals p LEFT JOIN ballots b ON b.proposal_id = p.id
      GROUP BY p.id`
  ).all();
  return results;
}

// Which of these proposals has this browser voted for?
async function votedSet(env, voterId, rows) {
  const voted = new Set();
  if (!rows.length) return voted;
  const pairs = await Promise.all(rows.map(async (r) => [r.id, await ballotHash(env, voterId, r.id)]));
  const byHash = new Map(pairs.map(([id, h]) => [h, id]));
  const hashes = [...byHash.keys()];
  for (let i = 0; i < hashes.length; i += 90) {
    const chunk = hashes.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT ballot FROM ballots WHERE ballot IN (${chunk.map(() => '?').join(',')})`
    )
      .bind(...chunk)
      .all();
    for (const r of results) voted.add(byHash.get(r.ballot));
  }
  return voted;
}

const byVotes = (a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt);

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// best-effort, per-isolate throttle for nominations
const nominationLog = new Map();
function nominationAllowed(key) {
  const now = Date.now();
  const recent = (nominationLog.get(key) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= 15) return false;
  recent.push(now);
  nominationLog.set(key, recent);
  return true;
}

async function handleApi(request, env, url, session, voterId) {
  const { pathname } = url;
  const method = request.method;
  const admin = isAdmin(env, session);

  if (pathname === '/api/me' && method === 'GET') {
    return json({ admin, email: (session && session.email) || null });
  }

  if (pathname === '/api/proposals' && method === 'GET') {
    const rows = await allProposals(env);
    const voted = await votedSet(env, voterId, rows);
    const all = rows.map((r) => toView(r, voted.has(r.id)));
    return json({
      open: all.filter((p) => p.status === 'open').sort(byVotes),
      buried: all
        .filter((p) => p.status === 'buried')
        .sort((a, b) => (b.buriedAt || '').localeCompare(a.buriedAt || '')),
    });
  }

  if (pathname === '/api/proposals' && method === 'POST') {
    const body = await readBody(request);
    const feature = clean(body.feature, MAX_FEATURE);
    const reason = clean(body.reason, MAX_REASON);
    if (feature.length < 2) return json({ error: 'Name the part of the tool you want dead.' }, 400);
    if (MOTHERSHIP.test(feature)) {
      return json({ error: 'The mothership cannot be killed.', mothership: true }, 422);
    }
    if (!nominationAllowed('v:' + voterId) || !nominationAllowed('ip:' + clientIp(request))) {
      return json({ error: 'Easy, reaper. Too many nominations this hour.' }, 429);
    }
    const dupe = await env.DB.prepare(
      `SELECT id FROM proposals WHERE status = 'open' AND lower(feature) = lower(?)`
    )
      .bind(feature)
      .first();
    if (dupe) return json({ error: 'That one is already on death row. Go vote for it.', id: dupe.id }, 409);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    // The nominator's ballot is cast automatically.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO proposals (id, feature, reason, status, created_at) VALUES (?, ?, ?, 'open', ?)`
      ).bind(id, feature, reason, createdAt),
      env.DB.prepare(`INSERT INTO ballots (proposal_id, ballot) VALUES (?, ?)`).bind(
        id,
        await ballotHash(env, voterId, id)
      ),
    ]);
    return json(
      toView({ id, feature, reason, status: 'open', created_at: createdAt, votes: 1 }, true),
      201
    );
  }

  let m = pathname.match(/^\/api\/proposals\/([0-9a-f-]{36})\/vote$/);
  if (m && method === 'POST') {
    const id = m[1];
    const p = await env.DB.prepare(`SELECT status FROM proposals WHERE id = ?`).bind(id).first();
    if (!p) return json({ error: 'No such grave.' }, 404);
    if (p.status !== 'open') return json({ error: 'It is already buried.' }, 400);
    const hash = await ballotHash(env, voterId, id);
    const del = await env.DB.prepare(`DELETE FROM ballots WHERE proposal_id = ? AND ballot = ?`).bind(id, hash).run();
    let voted = false;
    if (!del.meta.changes) {
      await env.DB.prepare(`INSERT OR IGNORE INTO ballots (proposal_id, ballot) VALUES (?, ?)`).bind(id, hash).run();
      voted = true;
    }
    const row = await env.DB.prepare(
      `SELECT p.id, p.feature, p.reason, p.status, p.created_at, p.buried_at, COUNT(b.ballot) AS votes
         FROM proposals p LEFT JOIN ballots b ON b.proposal_id = p.id WHERE p.id = ? GROUP BY p.id`
    )
      .bind(id)
      .first();
    return json(toView(row, voted));
  }

  // ---- admin
  if (pathname === '/api/admin/unlock' && method === 'POST') {
    if (!env.ADMIN_PASSWORD) return json({ error: 'No admin password is set.' }, 400);
    if (!unlockAllowed(clientIp(request))) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    const { password } = await readBody(request);
    if (!(await passwordMatches(env, password))) return json({ error: 'Wrong incantation.' }, 400);
    return json({ ok: true }, 200, {
      'Set-Cookie': await startSession(env, url, session && session.email, session && session.name, { admin: true }),
    });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!admin) return json({ error: 'Only the undertaker may enter.' }, 403);

    if (pathname === '/api/admin/proposals' && method === 'GET') {
      const all = (await allProposals(env)).map((r) => {
        const v = toView(r, false);
        delete v.hasVoted;
        return v;
      });
      const open = all.filter((p) => p.status === 'open').sort(byVotes);
      const buried = all.filter((p) => p.status !== 'open').sort(byVotes);
      return json({
        proposals: [...open, ...buried],
        stats: {
          total: all.length,
          open: open.length,
          buried: buried.length,
          votes: all.reduce((n, p) => n + p.votes, 0),
        },
      });
    }

    m = pathname.match(/^\/api\/admin\/proposals\/([0-9a-f-]{36})(\/status|\/reset-votes)?$/);
    if (m) {
      const id = m[1];
      const exists = await env.DB.prepare(`SELECT id FROM proposals WHERE id = ?`).bind(id).first();
      if (!exists) return json({ error: 'No such grave.' }, 404);

      if (!m[2] && method === 'DELETE') {
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM ballots WHERE proposal_id = ?`).bind(id),
          env.DB.prepare(`DELETE FROM proposals WHERE id = ?`).bind(id),
        ]);
        return json({ ok: true });
      }
      if (m[2] === '/status' && method === 'POST') {
        const { status } = await readBody(request);
        if (status !== 'open' && status !== 'buried') return json({ error: 'Status must be open or buried.' }, 400);
        await env.DB.prepare(`UPDATE proposals SET status = ?, buried_at = ? WHERE id = ?`)
          .bind(status, status === 'buried' ? new Date().toISOString() : null, id)
          .run();
        return json({ ok: true });
      }
      if (m[2] === '/reset-votes' && method === 'POST') {
        await env.DB.prepare(`DELETE FROM ballots WHERE proposal_id = ?`).bind(id).run();
        return json({ ok: true });
      }
    }
  }

  return json({ error: 'Not found.' }, 404);
}

// ---------------------------------------------------------------- entry

async function serveAsset(request, env, path) {
  const url = new URL(request.url);
  if (path) url.pathname = path;
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/index.html';
  const res = await env.ASSETS.fetch(new Request(url, request));
  const extra = {};
  if ((res.headers.get('Content-Type') || '').includes('text/html')) extra['Cache-Control'] = 'no-store';
  return withHeaders(res, extra);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    for (const k of ['SESSION_SECRET', 'BALLOT_SECRET']) {
      if (!env[k]) return new Response(`Server not configured: ${k} is missing.`, { status: 500 });
    }

    if (pathname.startsWith('/auth/')) return handleAuth(request, env, url);

    const session = await getSession(request, env);

    // /login is now only the admins' Google sign-in page
    if (pathname === '/login' || pathname === '/login.html') {
      if (isAdmin(env, session)) return redirect('/admin');
      return serveAsset(request, env, '/login.html');
    }

    if (pathname.startsWith('/api/')) {
      // reject cross-site writes
      if (request.method !== 'GET') {
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return json({ error: 'Bad origin.' }, 403);
      }
      const [voterId, voterCookie] = voterIdentity(request, url);
      try {
        const res = await handleApi(request, env, url, session, voterId);
        if (voterCookie) res.headers.append('Set-Cookie', voterCookie);
        return res;
      } catch (err) {
        console.error(err);
        return json({ error: 'Something went bump in the night.' }, 500);
      }
    }

    // The admin page loads for anyone but shows only the unlock prompt; all data is behind the API check.
    if (pathname === '/admin' || pathname === '/admin.html') return serveAsset(request, env, '/admin.html');
    return serveAsset(request, env);
  },
};
