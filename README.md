# Autopilot Uptime

Independent status page for [Autopilot](https://aplt.ai). Hosted entirely on
GitHub Pages + Cloudflare so it stays up even when Vercel or Supabase don't.

## Architecture

- **`worker/`** — a Cloudflare Worker that runs on a 1-minute cron, pings
  each target, and writes results to a Cloudflare D1 database. Exposes
  `/current` and `/history` JSON endpoints at `https://uptime-api.aplt.ai`.
- **`docs/`** — a static page (vanilla HTML/CSS/JS) served by GitHub Pages
  at `https://status.aplt.ai`. Fetches the Worker's JSON every 30 s.

There is no GitHub Actions workflow — the Worker is the only thing
running checks.

## What's monitored

| Target               | URL                                                       |
| -------------------- | --------------------------------------------------------- |
| Autopilot App        | https://aplt.ai/dashboard                                 |
| aplt.ai              | https://www.aplt.ai                                       |
| Autopilot's Backend  | Supabase REST endpoint                                    |
| Autopilot Companion  | Anthropic API                                             |

Edit `worker/src/index.ts` (`TARGETS`) and re-deploy to change them.

## Deploying the worker

```bash
cd worker
export CLOUDFLARE_API_TOKEN="$(cat ~/.cloudflare-uptime-token)"
npx wrangler deploy
```

To apply schema changes:

```bash
npx wrangler d1 execute autopilot-uptime --remote --file=migrations/0001_initial.sql
```

## Page

The page is committed under `docs/` and served by GitHub Pages from the
`/docs` folder on `main`. Editing `docs/index.html` and pushing is enough
— Pages rebuilds automatically.

Custom domain `status.aplt.ai` is configured in the GitHub Pages settings
+ a CNAME record on the aplt.ai Cloudflare zone pointing at
`thegeorgeadamson.github.io`.

## Alerting

Cloudflare's Workers logs surface failures, but there's no email-on-down
yet. Add a Worker step to POST to a webhook (Slack, Resend, etc.) when a
target moves from `up → down` if you want active alerting.
