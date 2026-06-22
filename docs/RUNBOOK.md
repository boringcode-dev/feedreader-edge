# Runbook

## Why refresh is split into 4 internal requests

Cloudflare Workers Free caps CPU time at **10ms per invocation**, including
cron-triggered invocations. Fetching and parsing all 4 sources inline in
one `scheduled()` call would compete for that single 10ms budget — risky
for GitHub Trending and alphaXiv, which do real DOM parsing.

Instead, both the cron handler and `POST /api/refresh` fan out:

```
scheduled() / POST /api/refresh
        │
        │  env.SELF.fetch() × 4, one per source, via the service binding
        │  (fresh Worker invocation per call → fresh 10ms budget each)
        ▼
POST /internal/refresh/hackernews    ─┐
POST /internal/refresh/github         │  each gated by the
POST /internal/refresh/huggingface    │  X-Refresh-Secret header
POST /internal/refresh/alphaxiv      ─┘
```

This also preserves per-source fault isolation: one source's failure
updates only that source's `sync_state` row and never wipes its existing
`items` rows.

**If a source consistently nears the 10ms ceiling:** check whether the
upstream page grew unusually large (linkedom's DOM parse time scales with
page size). There's no code change implied by default — the existing
retry-on-next-hour behavior already absorbs an occasional miss. Only
consider code changes if it's failing on every run, not occasionally.

## D1 migrations

```bash
npm run db:migrate:local    # local Miniflare-backed SQLite
npm run db:migrate:remote   # deployed D1 database
```

New migrations go in `platforms/cloudflare/migrations/` as
`NNNN_description.sql`, following on from `0001_init.sql`.

## Reading cron execution history

Cloudflare dashboard → Workers & Pages → feedreader → Triggers → Cron
Triggers, or `wrangler tail` while a scheduled run is expected, to confirm
`sync_state.last_attempt_at` is updating without user-triggered traffic.

## SSR verification procedure

Before considering any `core/render.ts` change done: render the same
`PageData` through `renderIndexPage` and compare against the Go app's
output for an equivalent `pageData` (same cards/errors/filters/flags).
Static markup should match exactly; only `now()`-driven fields (current
year) are expected to differ.
