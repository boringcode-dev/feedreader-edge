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

`wrangler dev` runs the Worker locally against a local D1 simulator and serves `web-static/*` through the `[assets]` binding.

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
- Article previews add one outbound fetch (and one `linkedom` parse) per uncached `/api/preview` request. The 400 KB body cap and 30-minute edge cache in `core/preview.ts` bound that cost; watch the CPU-time panel if preview usage is heavy. Richer preview blocks (inline links, captions, tables) increase the cached response payload but not the upstream fetch count; the same byte cap and cache TTL apply.

Check the Cloudflare dashboard's D1 usage and Workers CPU-time panels periodically — see [RUNBOOK.md](RUNBOOK.md) for what to do if a source consistently nears the CPU ceiling.
