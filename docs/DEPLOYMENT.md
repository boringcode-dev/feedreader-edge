# Deployment (Cloudflare Workers)

This is the supported deployment path for this repository.

## Production site

The current production deployment is visible at:

- https://reader.boringcode.dev

If you deploy the project in another Cloudflare account, you can use the generated `*.workers.dev` hostname or attach your own custom domain.

## First-time setup

```bash
npm install
wrangler login
wrangler d1 create feedreader
# copy the returned database_id into platforms/cloudflare/wrangler.toml
wrangler secret put REFRESH_SECRET --config platforms/cloudflare/wrangler.toml
npm run db:migrate:remote
```

`REFRESH_SECRET` gates the internal per-source refresh routes used by the Worker fan-out path. Any random high-entropy string is fine; it is only compared, never read back.

## Local development

```bash
npm run db:migrate:local
npm run dev
```

`wrangler dev` runs the Worker locally against a local D1 simulator and serves `web-static/*` through the `[assets]` binding. It pins `APP_VERSION` to `dev`, which disables the five-minute home-page HTML cache so template and stylesheet edits are visible immediately.

## Deploy

```bash
npm run deploy
```

The deploy workflow in [`.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml) uses the same command after validating secrets, re-running verification, and applying remote D1 migrations.

## Configuration

See the configuration table in [README.md](../README.md#configuration) — this doc intentionally does not duplicate it.

## CI/CD flow

1. Pull requests and `main` pushes run [CI](../.github/workflows/ci.yml): typecheck, unit tests, and a local D1 migration smoke run.
2. Pull requests run [Preview (Cloudflare)](../.github/workflows/preview-cloudflare.yml), which uploads a Worker version and comments its preview URL on the PR.
3. Non-`main` branch pushes run [Preview branch (Cloudflare)](../.github/workflows/preview-branch-cloudflare.yml). It type-checks, tests, and uploads a stable per-branch preview alias, then writes the URL to the Actions run summary. If the branch already has an open PR, it defers to the PR preview workflow instead of uploading twice.
4. `main` pushes and manual dispatch run [Deploy (Cloudflare)](../.github/workflows/deploy-cloudflare.yml).
5. Deploy validates Cloudflare credentials, re-runs verification, applies remote D1 migrations, and deploys the Worker.

Preview versions share the production D1 database and do not receive cron-triggered refreshes. A branch that changes the schema needs its migration applied before its preview will work correctly.

## Custom domains

The checked-in `wrangler.toml` config does not hardcode a route. Domain attachment is account-specific and should be handled in Cloudflare for the target environment.

## Free-tier limits to watch

- D1: 5GB storage, 5M row reads/day, 100k row writes/day.
- Workers: 100k requests/day, 10ms CPU time per invocation, 50 subrequests per request.
- Source refreshes fetch one page per source per hourly fan-out. Hugging Face reads about 272 KB of JSON from `/api/daily_papers` instead of the ~1.4 MB `/papers/trending` HTML page; source error details are capped at 200 characters, and HTML error pages are reduced to a fixed message before they reach D1 or the UI.
- The five-minute home-page cache absorbs most `GET /` traffic, so only cache misses run the feed query and render the HTML. The browser response is `private, no-store`; edge caching is the Worker Cache API, not the CDN, so the zone's Browser Cache TTL setting cannot rewrite the client TTL. Each cold-isolate cache miss also reads `style.css` and `theme-init.js` through the `ASSETS` binding (two local subrequests), then reuses them in memory.
- The standalone launch veil and skeleton styles are inlined with the existing HTML/CSS, so they add no extra requests. Bump the shell cache version when the HTML shell or `app.js` changes; see [RUNBOOK.md](RUNBOOK.md#pwa-shell-updates).
- Article previews add one outbound fetch (and one `node-html-parser` parse) per uncached `/api/preview` request. The 400 KB HTML body cap, 30-minute edge cache (5 minutes for empty results), and a per-IP limiter (20 cache-miss previews per minute; cached previews bypass it) bound that cost; transient upstream `429`/`5xx` responses are retried once. PDFs/Office documents and HTML pages with no readable blocks can additionally call Workers AI's `toMarkdown` (5 MB download cap; document text conversion is free and the fallback disables AI image-description conversion). That call runs only on a cache miss and its result is cached for the same 30 minutes; set `FEEDREADER_AI_PREVIEW_FALLBACK=false` to disable it. HTML pages that still have no readable content after AI conversion can call Browser Run's `markdown` Quick Action; Workers Free includes 10 browser-minutes/day and paces Quick Actions to one request per 10 seconds. Browser Run runs only on a cache miss, uses no browser sessions (so the concurrent-browser limit does not apply), and its result is cached for 30 minutes; set `FEEDREADER_BROWSER_PREVIEW_FALLBACK=false` to disable it. Hugging Face paper pages parse only `<head>`+`<main>` with one combined noise selector, reducing their extraction CPU. The browser retries a preview `503` once after 500 ms; `429`s are not retried. Browser-facing preview and `/api/items` responses are `private, no-store`; their edge copies live in the Cache API. Watch the CPU-time panel if preview usage is heavy — bursts can hit the Workers Free 10 ms limit, so see [RUNBOOK.md](RUNBOOK.md#article-preview-failures). Richer preview blocks (inline links, captions, tables) increase the cached response payload but not the upstream fetch count; the same byte cap and cache TTL apply.
- `/api/personalize` cache misses are limited to 10 per minute per IP by the shared Cache API limiter; cached rankings bypass it. This protects the embedding and optional LLM-polish budget from varied interests strings; blocked requests return `429` with `Retry-After: 60`.

Check the Cloudflare dashboard's D1 usage and Workers CPU-time panels periodically — see [RUNBOOK.md](RUNBOOK.md) for what to do if a source consistently nears the CPU ceiling.
