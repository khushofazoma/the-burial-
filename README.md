# The Funeral

A spooky graveyard where Azoma staff nominate parts of the product to retire, and vote on which ones should die. Built for the weekly and monthly "funeral" segment.

## What it does

- **Nominate**: name a feature and (optionally) its crimes. Submitting triggers an execution scene: either a hooded executioner splits it with an axe, or the Grim Reaper slices it with a scythe. A drumroll builds as the lights close in, then a hit-stop, slow-motion blood spray, the card halves crash to the ground and the feature's soul floats away. A new tombstone then bursts out of the earth in the graveyard.
- **Sound**: effects are synthesised in the browser (no audio files). Toggle with the speaker button in the top-left corner; the choice is remembered.
- **Vote**: click "Kill it" on any tombstone. A scythe sweeps across it and a soul escapes. Click again to spare it. Tombstones crack more as their votes pile up. Graves are ranked by votes; the top one gets candles and a "Next to die" badge. The page refreshes counts every 10 seconds, so it works live on a shared screen.
- **Laid to Rest**: features the admin marks as retired move to a memorial section.
- **Admin dashboard** at `/admin`: password protected. Shows every proposal with vote counts and a bar chart, plus actions to lay to rest, resurrect, reset votes, or remove.

## Easter eggs

- Try nominating **Azoma** itself.
- Look closely at the chopping block.

Brand assets live in `public/brand/`.

## Anonymity

- No names, emails or IPs are stored for nominations or votes.
- Each browser gets a random token in an http-only cookie. The server never stores it. A vote is stored as `HMAC(server_secret, token + proposal_id)`, which stops double-voting but cannot be traced back to a person or linked across proposals.
- The admin sees counts only.
- Limitation: one vote per browser, not per person. Someone determined could vote again from a private window. For an internal culture ritual this is the right trade-off; tying votes to logins would break anonymity.

## Running it

Requires Node 18+.

```bash
npm install
ADMIN_PASSWORD=choose-something npm start
```

Open http://localhost:3000 for the graveyard and http://localhost:3000/admin for the Undertaker's Office.

If `ADMIN_PASSWORD` is not set, a one-time password is generated and printed in the console on startup.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | random, printed at startup | Admin login |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where `db.json` is stored. Point it at a persistent volume in production. |
| `SECURE_COOKIES` | `false` | Set to `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Set to `true` behind a reverse proxy so login throttling sees real IPs |

## Deploying

Any host that runs Node and keeps a persistent disk works (Render, Railway, Fly.io, a small VM). Mount a volume, set `DATA_DIR` to it, set `ADMIN_PASSWORD`, and set `SECURE_COOKIES=true` and `TRUST_PROXY=true` behind HTTPS.

## Project layout

```
server.js            Express API + JSON file storage
public/index.html    Graveyard page and execution stage
public/style.css     All styling and keyframe animations
public/execution.js  Axe / scythe execution sequence (camera, lighting, particle canvas, physics)
public/sfx.js        Synthesised sound effects
public/ambience.js   Bats, will-o'-wisps, lightning, passing reaper
public/app.js        Nominating, voting, rendering graves
public/admin.html    Admin dashboard
public/admin.js
```

All animation respects the operating system's "reduce motion" setting.
