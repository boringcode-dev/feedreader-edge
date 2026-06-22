# AGENTS.md

## Canonical shared instructions

This is the single canonical AI-agent guide for this repository.

- Do not add tool-specific instruction files such as `CLAUDE.md`, `CODEX.md`, `HERMES.md`, Copilot instructions, or Cursor rule files unless there is a hard technical requirement that `AGENTS.md` cannot satisfy.
- If an agent or editor supports repository instructions, point it at `AGENTS.md` rather than maintaining a parallel policy file.
- When updating agent guidance, update this file only.

## Project overview

`feedreader` is a small Cloudflare-native feed reader that aggregates Hacker News, GitHub Trending, Hugging Face Papers Trending, and alphaXiv into a server-rendered feed backed by D1.

## Repo layout

- `core/` — platform-agnostic domain logic, source adapters, refresh orchestration, SSR rendering
- `platforms/cloudflare/` — Worker entrypoint, D1-backed repository, migrations, wrangler config
- `web-static/` — browser assets: CSS, JS, icons, manifest, service worker
- `docs/` — standalone project docs; do not describe this repo as a port or point readers at retired implementations

## Build & run

```bash
npm install
npm run db:migrate:local
npm run dev
```

Local dev serves on `http://127.0.0.1:8788` by default.

## Test & verify

```bash
npm run typecheck
npm test
npm run db:migrate:local
```

If you change GitHub Actions, migrations, or Worker wiring, run the migration smoke step too before calling the work done.

## CI/CD

- CI: `.github/workflows/ci.yml`
- Deploy: `.github/workflows/deploy-cloudflare.yml`

The deploy workflow validates Cloudflare secrets, re-runs verification, applies remote D1 migrations, and deploys the Worker.

## Code style

No dedicated formatter or linter is configured. Match the existing TypeScript style:

- 2-space indent
- double quotes
- semicolons
- narrow, explicit diffs over broad rewrites

## Architecture constraints

- `core/` must stay free of `cloudflare:*`, `Deno.*`, and `node:*` imports.
- `core/` should use only pure functions and Web Standard APIs such as `fetch`, `URL`, `crypto`, and `Date`.
- Platform-specific behavior belongs under `platforms/*` behind `core/ports.ts`.
- D1 has no app-level `BEGIN`/`COMMIT`; use `env.DB.batch([...])` for atomic multi-statement writes.
- Keep refresh fan-out through the `SELF` binding; do not collapse all source fetch+parse work into a single invocation.
- Cloudflare Workers Free has a tight per-invocation CPU budget; never fetch and parse multiple upstream sources inline in one handler.

## Adding a new feed source

1. Implement the `Source` interface in `core/sources/`.
2. Register it in `core/sources/index.ts`.
3. Preserve `FeedItem` shape and metadata conventions used by `core/service.ts`.
4. Add or update tests under `core/test/`.

## Docs policy

- Keep docs standalone and accurate to this repository.
- Do not reference retired or alternate implementations in README or `docs/`.
- If behavior changes, update README, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, and `docs/RUNBOOK.md` together.

## Security considerations

- `POST /internal/refresh/:source` must remain gated by `REFRESH_SECRET`.
- Do not log secrets or expose them in client-side code.
- `POST /api/refresh` is intentionally small-scope and should stay limited to refresh behavior only.

## Commit / PR conventions

Conventional Commits (`feat:`, `fix:`, `chore:`, ...).
