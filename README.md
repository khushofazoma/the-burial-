# The Funeral

A spooky graveyard where the team nominates parts of the product to retire, and vote on which ones should die. Built for the weekly and monthly "funeral" segment.

## What it does

- **Nominate**: name a feature and (optionally) its crimes. Submitting triggers an execution scene: either a hooded executioner splits it with an axe, or the Grim Reaper slices it with a scythe. A drumroll builds as the lights close in, then a hit-stop, slow-motion blood spray, the card halves crash to the ground and the feature's soul floats away. A new tombstone then bursts out of the earth in the graveyard.
- **Sound**: effects are synthesised in the browser (no audio files). Toggle with the speaker button in the top-left corner; the choice is remembered.
- **Vote**: click "Kill it" on any tombstone. A scythe sweeps across it and a soul escapes. Click again to spare it. Tombstones crack more as their votes pile up. Graves are ranked by votes; the top one gets candles and a "Next to die" badge. The page refreshes counts every 10 seconds, so it works live on a shared screen.
- **Laid to Rest**: features the admin marks as retired move to a memorial section.
- **No sign-in needed** to view, nominate or vote. Anyone with the link can take part.
- **Admin dashboard** at `/admin`: unlocked with `ADMIN_PASSWORD`, or by Google sign-in for the addresses in `ADMIN_EMAILS`. Shows every proposal with vote counts and a bar chart, plus actions to lay to rest, resurrect, reset votes, or remove.

## Easter eggs

- Try nominating **Azoma** itself.
- Look closely at the chopping block.

Brand assets live in `public/brand/`.

## Anonymity

- No names, emails or IP addresses are stored for nominations or votes.
- Each browser gets a random voter id in a cookie, which the server never stores. A vote is stored as `HMAC(BALLOT_SECRET, voter id + proposal id)`, so one vote per browser per proposal, with nothing that links a vote to a person or connects one browser's votes across proposals. Ballots have no timestamps or insertion order.
- Admins see counts only.
- Limit: it is one vote per browser, not per person. Someone could vote again from a private window or another device.

## Running it

See **[DEPLOY.md](DEPLOY.md)** to put it on a live URL (Cloudflare Workers + D1 + Google sign-in, free).

Locally:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787. For the admin Google sign-in, the local login page offers an email box instead of Google.

## Project layout

```
src/worker.js        Cloudflare Worker: Google sign-in, sessions, API, serves the pages
migrations/          D1 database schema
wrangler.toml        Cloudflare config (allowed domains, database binding)
public/login.html    Admin Google sign-in page
public/index.html    Graveyard page and execution stage
public/style.css     All styling and keyframe animations
public/execution.js  Axe / scythe execution sequence (camera, lighting, particle canvas, physics)
public/sfx.js        Synthesised sound effects
public/ambience.js   Bats, will-o'-wisps, lightning, passing reaper
public/app.js        Nominating, voting, rendering graves
public/admin.html    Admin dashboard
public/admin.js
public/brand/        Azoma logos
```

All animation respects the operating system's "reduce motion" setting.
