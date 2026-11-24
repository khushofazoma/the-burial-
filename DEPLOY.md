# Deploying The Funeral

The Funeral runs on **Cloudflare Workers** with a **Cloudflare D1** database. Both are free for this kind of use (100,000 requests and 100,000 database writes per day), need no credit card, and allow company use. Sign-in uses **Google**, restricted to `@azoma.ai` and `@ecomtent.ai`.

Allow about 20 minutes the first time. Run every command from the project folder on your Mac.

## 1. Install and log in to Cloudflare

```bash
cd the-burial-
git pull
npm install
npx wrangler login
```

`wrangler login` opens a browser. Sign up for a free Cloudflare account if you don't have one, then approve access.

## 2. Create the database

```bash
npx wrangler d1 create funeral
```

It prints a `database_id`. Open `wrangler.toml` and replace `00000000-0000-0000-0000-000000000000` with that id.

## 3. First deploy

```bash
npm run deploy
```

This creates the tables and publishes the site. At the end it prints your live URL, something like:

```
https://the-funeral.<your-subdomain>.workers.dev
```

Copy it. If Cloudflare asks you to pick a `workers.dev` subdomain first, choose one (for example `azoma`) and run the command again.

## 4. Set the secret keys

Generate two random keys and store them in Cloudflare. Paste each value when prompted:

```bash
openssl rand -base64 32          # copy the output
npx wrangler secret put SESSION_SECRET

openssl rand -base64 32          # copy the new output
npx wrangler secret put BALLOT_SECRET

npx wrangler secret put ADMIN_EMAILS
# e.g. khush@azoma.ai,someone.else@azoma.ai
```

- `SESSION_SECRET` signs login cookies. Changing it signs everyone out, nothing else.
- `BALLOT_SECRET` keys the anonymous vote hashes. **Never change it.** If you do, existing votes can no longer be matched to their voters, so people could vote twice.
- `ADMIN_EMAILS` is who can open `/admin`. Update it the same way at any time.

## 5. Create the Google sign-in client

1. Go to https://console.cloud.google.com and create a project called **The Funeral**.
2. Open **Google Auth Platform** (it may be called **OAuth consent screen**) and click **Get started**:
   - App name: `The Funeral`. User support email: your email.
   - Audience: **External**. This is needed because Azoma and Ecomtent are separate Google organisations. The app itself still only lets those two domains in.
   - Contact email: your email. Accept the policy and create.
3. Under **Audience**, click **Publish app** so it leaves "Testing" mode. The app only asks for name and email, so Google does not require a review.
4. Under **Clients**, click **Create client**:
   - Application type: **Web application**. Name: `The Funeral`.
   - Authorized redirect URIs: your URL from step 3 plus `/auth/callback`, for example
     `https://the-funeral.azoma.workers.dev/auth/callback`
   - Create, then copy the **Client ID** and **Client secret**.
5. Store them in Cloudflare:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

## 6. Open it

Visit your URL. You should see the sign-in page. Sign in with an `@azoma.ai` or `@ecomtent.ai` Google account. Personal Gmail accounts are turned away.

## Updating later

After pulling new code:

```bash
npm run deploy
```

### Optional: deploy automatically from GitHub

`.github/workflows/deploy.yml` deploys on every push to `main`. To turn it on, add two repository secrets in GitHub (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_ACCOUNT_ID`: shown on the right of the Cloudflare dashboard's Workers page.
- `CLOUDFLARE_API_TOKEN`: create at https://dash.cloudflare.com/profile/api-tokens with the **Edit Cloudflare Workers** template, then add **Account → D1 → Edit** to it.

The secrets from step 4 and 5 stay in Cloudflare and do not need to be in GitHub.

## Optional settings

In `wrangler.toml` under `[vars]`:

- `ALLOWED_DOMAINS`: who may sign in. Default `azoma.ai,ecomtent.ai`.
- `REQUIRE_WORKSPACE`: set to `"true"` to accept only Google Workspace accounts on those domains (blocks personal Google accounts that were registered with a work address). Leave it `"false"` if either company does not use Google Workspace.

Redeploy after changing them.

## Custom address

If `azoma.ai` is managed in Cloudflare, you can serve the site at something like `funeral.azoma.ai`: Workers → the-funeral → Settings → Domains & Routes → Add custom domain. Then add `https://funeral.azoma.ai/auth/callback` as another redirect URI in the Google client.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787. With `DEV_LOGIN=true` in `.dev.vars`, the sign-in page shows an email box instead of Google. This only works on localhost and is never enabled in production.
