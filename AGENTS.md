# AGENTS.md

## Project overview

A private, server-rendered feed reader aggregating Hacker News, GitHub
Trending, Hugging Face Papers Trending, and alphaXiv, running on
Cloudflare Workers with D1 for storage.

## Repo layout

`core/` is platform-agnostic (zero `cloudflare:*`/`Deno.*`/`node:*` imports —
pure TS, Web Standard APIs only). `platforms/cloudflare/` is the only
adapter that ships today. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Build & run (Cloudflare)

```bash
npm install
npm run db:migrate:local   # apply migrations/0001_init.sql to local D1
npm run dev                # wrangler dev
```

## Test

```bash
npm run typecheck
npm test
```

## Code style

No linter configured yet — match existing formatting (2-space indent,
double quotes, semicolons).

## Adding a new feed source

Implement the `Source` interface in `core/sources/`, add it to
`core/sources/index.ts`'s `build()` — the Cloudflare adapter picks it up
automatically, no platform-side change needed.

## D1 / cron specifics

See [docs/RUNBOOK.md](docs/RUNBOOK.md) for the per-source CPU-budget
fan-out pattern and D1 migration commands.

## Security considerations

`/internal/refresh/:source` routes are gated by the `REFRESH_SECRET`
header. Never log it or expose it in client-side code.

## Commit / PR conventions

Conventional Commits (`feat:`, `fix:`, `chore:`, ...).
