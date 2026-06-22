---
description: Cloudflare Workers adapter constraints
globs: platforms/cloudflare/**
---

- D1 has no app-level `BEGIN`/`COMMIT` — use `env.DB.batch([...])` for
  atomic multi-statement writes (see `repository.ts`'s `saveSnapshot`).
- Workers Free is capped at 10ms CPU time per invocation, including cron
  invocations. Never fetch+parse more than one upstream source inline in a
  single handler — fan out via the `SELF` service binding to
  `/internal/refresh/:source` instead, so each source gets its own fresh
  budget. See `docs/RUNBOOK.md`.
