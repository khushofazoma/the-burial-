'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECURE_COOKIES = process.env.SECURE_COOKIES === 'true';

// Nominating the company itself is an easter egg handled in the browser; never store it.
// Keep in sync with public/app.js.
const MOTHERSHIP = /^\s*(?:the\s+)?(?:whole\s+(?:of\s+)?|entire\s+|all\s+of\s+)?(?:the\s+)?azoma(?:\.ai)?(?:\s+(?:itself|as\s+a\s+whole|the\s+company|company|platform|app|inc\.?|ltd\.?))?\s*[!.?]*\s*$/i;

const MAX_FEATURE = 80;
const MAX_REASON = 280;
const VOTER_COOKIE = 'funeral_voter';
const ADMIN_COOKIE = 'funeral_admin';
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Storage: a single JSON file, written atomically.
// ---------------------------------------------------------------------------

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    return { secret: crypto.randomBytes(32).toString('hex'), proposals: [] };
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex');
  if (!Array.isArray(db.proposals)) db.proposals = [];
  return db;
}

const db = loadDb();
saveDb();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------------------------------------------------------------------------
// Anonymity
//
// Each browser gets a random voter token in a cookie. We never store that
// token. For each vote we store HMAC(secret, token + proposalId), which lets
// us stop double-voting on a proposal but cannot be linked back to a person,
// and cannot be linked across proposals either. No names, emails or IPs are
// recorded for proposals or votes.
// ---------------------------------------------------------------------------

function ballotHash(voterToken, proposalId) {
  return crypto
    .createHmac('sha256', db.secret)
    .update(voterToken + ':' + proposalId)
    .digest('hex');
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function cookieOpts(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIES,
    maxAge: maxAgeMs,
    path: '/',
  };
}

function voterToken(req, res) {
  const cookies = parseCookies(req);
  let token = cookies[VOTER_COOKIE];
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    token = crypto.randomBytes(24).toString('hex');
    res.cookie(VOTER_COOKIE, token, cookieOpts(5 * 365 * 24 * 60 * 60 * 1000));
  }
  return token;
}

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.warn(
    '\n[funeral] ADMIN_PASSWORD is not set. Generated a one-time password for this run:\n' +
      `[funeral]   ${ADMIN_PASSWORD}\n` +
      '[funeral] Set ADMIN_PASSWORD in the environment to choose your own.\n'
  );
}

const adminSessions = new Map(); // token -> expiry

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAdmin(req) {
  const token = parseCookies(req)[ADMIN_COOKIE];
  if (!token) return false;
  const exp = adminSessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'The crypt is sealed. Log in first.' });
  next();
}

// Simple in-memory throttle for login attempts and writes.
const buckets = new Map();
function throttle(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  for (const [t, exp] of adminSessions) if (exp < now) adminSessions.delete(t);
}, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(str, max) {
  return String(str || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function findProposal(id) {
  return db.proposals.find((p) => p.id === id);
}

function publicView(p, token) {
  return {
    id: p.id,
    feature: p.feature,
    reason: p.reason,
    votes: p.ballots.length,
    status: p.status,
    createdAt: p.createdAt,
    buriedAt: p.buriedAt || null,
    hasVoted: token ? p.ballots.includes(ballotHash(token, p.id)) : false,
  };
}

function sortProposals(list) {
  return list.sort((a, b) => b.votes - a.votes || a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true');
app.use(express.json({ limit: '10kb' }));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Public API ----------------------------------------------------------------

app.get('/api/proposals', (req, res) => {
  const token = voterToken(req, res);
  const all = db.proposals.map((p) => publicView(p, token));
  res.json({
    open: sortProposals(all.filter((p) => p.status === 'open')),
    buried: all
      .filter((p) => p.status === 'buried')
      .sort((a, b) => (b.buriedAt || '').localeCompare(a.buriedAt || '')),
  });
});

app.post('/api/proposals', (req, res) => {
  const token = voterToken(req, res);
  if (!throttle('propose:' + token, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Easy, reaper. Too many nominations this hour.' });
  }
  const feature = clean(req.body && req.body.feature, MAX_FEATURE);
  const reason = clean(req.body && req.body.reason, MAX_REASON);
  if (feature.length < 2) {
    return res.status(400).json({ error: 'Name the part of the tool you want dead.' });
  }
  if (MOTHERSHIP.test(feature)) {
    return res.status(422).json({ error: 'The mothership cannot be killed.', mothership: true });
  }
  const dupe = db.proposals.find(
    (p) => p.status === 'open' && p.feature.toLowerCase() === feature.toLowerCase()
  );
  if (dupe) {
    return res
      .status(409)
      .json({ error: 'That one is already on death row. Go vote for it.', id: dupe.id });
  }
  const id = crypto.randomUUID();
  const proposal = {
    id,
    feature,
    reason,
    status: 'open',
    createdAt: new Date().toISOString(),
    // The nominator's ballot is cast automatically.
    ballots: [ballotHash(token, id)],
  };
  db.proposals.push(proposal);
  saveDb();
  res.status(201).json(publicView(proposal, token));
});

app.post('/api/proposals/:id/vote', (req, res) => {
  const token = voterToken(req, res);
  if (!throttle('vote:' + token, 120, 60 * 1000)) {
    return res.status(429).json({ error: 'Slow down. The dead are patient.' });
  }
  const p = findProposal(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such grave.' });
  if (p.status !== 'open') return res.status(400).json({ error: 'It is already buried.' });
  const hash = ballotHash(token, p.id);
  const idx = p.ballots.indexOf(hash);
  if (idx >= 0) p.ballots.splice(idx, 1);
  else p.ballots.push(hash);
  saveDb();
  res.json(publicView(p, token));
});

// Admin API -----------------------------------------------------------------

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!throttle('login:' + ip, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  const password = req.body && req.body.password;
  if (!password || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong incantation.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + ADMIN_SESSION_MS);
  res.cookie(ADMIN_COOKIE, token, cookieOpts(ADMIN_SESSION_MS));
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const token = parseCookies(req)[ADMIN_COOKIE];
  if (token) adminSessions.delete(token);
  res.clearCookie(ADMIN_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ admin: isAdmin(req) });
});

app.get('/api/admin/proposals', requireAdmin, (req, res) => {
  const list = db.proposals.map((p) => {
    const v = publicView(p, null);
    delete v.hasVoted;
    return v;
  });
  const open = list.filter((p) => p.status === 'open');
  const buried = list.filter((p) => p.status !== 'open');
  res.json({
    proposals: [...sortProposals(open), ...sortProposals(buried)],
    stats: {
      total: list.length,
      open: open.length,
      buried: list.length - open.length,
      votes: list.reduce((n, p) => n + p.votes, 0),
    },
  });
});

app.delete('/api/admin/proposals/:id', requireAdmin, (req, res) => {
  const idx = db.proposals.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No such grave.' });
  db.proposals.splice(idx, 1);
  saveDb();
  res.json({ ok: true });
});

app.post('/api/admin/proposals/:id/status', requireAdmin, (req, res) => {
  const p = findProposal(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such grave.' });
  const status = req.body && req.body.status;
  if (status !== 'open' && status !== 'buried') {
    return res.status(400).json({ error: 'Status must be open or buried.' });
  }
  p.status = status;
  p.buriedAt = status === 'buried' ? new Date().toISOString() : undefined;
  saveDb();
  res.json({ ok: true });
});

app.post('/api/admin/proposals/:id/reset-votes', requireAdmin, (req, res) => {
  const p = findProposal(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such grave.' });
  p.ballots = [];
  saveDb();
  res.json({ ok: true });
});

// Static --------------------------------------------------------------------

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed request.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went bump in the night.' });
});

app.listen(PORT, () => {
  console.log(`[funeral] The graveyard is open on http://localhost:${PORT}`);
  console.log(`[funeral] Admin crypt:              http://localhost:${PORT}/admin`);
});
