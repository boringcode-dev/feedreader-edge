# feedreader

A tiny, private feed reader that aggregates Hacker News, GitHub Trending,
Hugging Face Papers Trending, and alphaXiv into a single server-rendered
view. Runs entirely on Cloudflare's free tier — Workers, D1, Cron Triggers,
and Workers Static Assets.

## Features

- Multi-source aggregation with per-source filters and a combined view
- Server-rendered HTML with incremental client-side pagination and search
- Persistent storage in D1, preserving fetch history across refreshes
- Hourly scheduled refresh via Cron Triggers, plus a manual refresh action
- PWA shell with offline caching via a service worker
- Dark/light theme, adjustable density, configurable visible sources

## Architecture

```
core/                  platform-agnostic domain logic, source adapters,
                       refresh orchestration, SSR rendering
platforms/cloudflare/  Worker entry, D1-backed persistence, wrangler config
web-static/            browser assets — HTML/CSS/JS, icons, manifest
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layout and
design rationale.

## Getting started

```bash
npm install
npm run db:migrate:local
npm run dev
```

Then open `http://127.0.0.1:8788`.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for first-time Cloudflare
setup and [docs/RUNBOOK.md](docs/RUNBOOK.md) for the CPU-budget fan-out
pattern the refresh flow depends on. [AGENTS.md](AGENTS.md) has the full
build/test/dev command reference.
