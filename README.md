# The Funeral

A spooky graveyard where Azoma and Ecomtent staff nominate parts of the product to retire, and vote on which ones should die. Built for the weekly and monthly "funeral" segment.

## What it does

- **Nominate**: name a feature and (optionally) its crimes. Submitting triggers an execution scene: either a hooded executioner splits it with an axe, or the Grim Reaper slices it with a scythe. A drumroll builds as the lights close in, then a hit-stop, slow-motion blood spray, the card halves crash to the ground and the feature's soul floats away. A new tombstone then bursts out of the earth in the graveyard.
- **Sound**: effects are synthesised in the browser (no audio files). Toggle with the speaker button in the top-left corner; the choice is remembered.
- **Vote**: click "Kill it" on any tombstone. A scythe sweeps across it and a soul escapes. Click again to spare it. Tombstones crack more as their votes pile up. Graves are ranked by votes; the top one gets candles and a "Next to die" badge. The page refreshes counts every 10 seconds, so it works live on a shared screen.
- **Laid to Rest**: features the admin marks as retired move to a memorial section.
- **Sign-in**: Google accounts on `@azoma.ai` and `@ecomtent.ai` only.
- **Admin dashboard** at `/admin`: only for the emails listed in `ADMIN_EMAILS`. Shows every proposal with vote counts and a bar chart, plus actions to lay to rest, resurrect, reset votes, or remove.

## Easter eggs

- Try nominating **Azoma** itself.
- Look closely at the chopping block.

Brand assets live in `public/brand/`.

## Anonymity

- Signing in only proves someone works here. Emails are never written to the database.
- Nominations store no information about who made them.
- A vote is stored as `HMAC(BALLOT_SECRET, email + ":" + proposal_id)`. That allows one vote per person per proposal, but the database alone can't reveal who voted, or connect one person's votes across proposals. Ballots are stored without timestamps or insertion order.
- Admins see counts only.
- Limit: someone with full access to the Cloudflare account (the database **and** the `BALLOT_SECRET`) could hash a list of known emails and work out who voted for what. Keep that account to a small number of people.

## Running it

See **[DEPLOY.md](DEPLOY.md)** to put it on a live URL (Cloudflare Workers + D1 + Google sign-in, free).

Locally:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787. Locally the sign-in page offers an email box instead of Google.

## Project layout

```
src/worker.js        Cloudflare Worker: Google sign-in, sessions, API, serves the pages
migrations/          D1 database schema
wrangler.toml        Cloudflare config (allowed domains, database binding)
public/login.html    Sign-in page
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
