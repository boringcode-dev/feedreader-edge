# Deployment (Cloudflare Workers)

## First-time setup

```bash
npm install
wrangler login
wrangler d1 create feedreader
# copy the returned database_id into platforms/cloudflare/wrangler.toml
npm run db:migrate:remote
wrangler secret put REFRESH_SECRET --config platforms/cloudflare/wrangler.toml
```

`REFRESH_SECRET` gates the `/internal/refresh/:source` routes used by the
fan-out pattern (see [RUNBOOK.md](RUNBOOK.md)) — any random string works,
it's never read back, only compared.

## Deploy

```bash
npm run deploy
```

## Local development

```bash
npm run db:migrate:local
npm run dev
```

`wrangler dev` runs the Worker locally against a local D1 simulator and
serves `web-static/*` via the `[assets]` binding.

## Free-tier limits to watch

- D1: 5GB storage, 5M row reads/day, 100k row writes/day.
- Workers: 100k requests/day, 10ms CPU time per invocation, 50 subrequests
  per request.

Check the Cloudflare dashboard's D1 usage and Workers CPU-time panels
periodically — see RUNBOOK.md for what to do if a source consistently
nears the CPU ceiling.
