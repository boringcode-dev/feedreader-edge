# Runbook

## Why refresh is split into 4 internal requests

Cloudflare Workers Free caps CPU time per invocation tightly enough that fetching and parsing all four sources inline in one `scheduled()` run is an unnecessary risk, especially for the DOM-heavy sources.

Instead, both the cron handler and `POST /api/refresh` fan out:

```
scheduled() / POST /api/refresh
        │
        │  env.SELF.fetch() × 4, one per source, via the service binding
        │  (fresh Worker invocation per call)
        ▼
POST /internal/refresh/hackernews    ─┐
POST /internal/refresh/github         │  each gated by the
POST /internal/refresh/huggingface    │  X-Refresh-Secret header
POST /internal/refresh/alphaxiv      ─┘
```

This preserves per-source fault isolation: one source's failure updates only that source's `sync_state` row and never wipes its existing `items` rows.

**If a source consistently nears the CPU ceiling:**

- inspect whether the upstream page size changed dramatically
- confirm the failure is persistent rather than a one-off transient miss
- keep the fan-out design intact unless you have evidence that another architecture is safer

## D1 migrations

```bash
npm run db:migrate:local    # local Miniflare-backed D1
npm run db:migrate:remote   # deployed D1 database
```

New migrations go in `platforms/cloudflare/migrations/` as `NNNN_description.sql`, following on from `0001_init.sql`.

## Weekly item-retention prune

`scheduled()`'s single hourly trigger does double duty: every firing, `isWeeklyPruneWindow` checks whether `event.scheduledTime` landed on Sunday 16:00 UTC (23:00 ICT) and, if so, runs `D1Repository.pruneOldItems` before the normal refresh fan-out. It deletes all but the `FEEDREADER_MAX_ITEMS_PER_SOURCE` (default 1000) most recent items per source, ordered the same way the feed itself sorts (`coalesce(published_at, first_seen_at) DESC, ...`).

**Why not a second Cron Trigger:** that was the original design, but deploying a second `[triggers]` cron entry alongside the hourly one made `wrangler deploy` fail outright — `[ERROR] Some triggers failed to deploy for feedreader: - A request to the Cloudflare API (/accounts/.../workers/scripts/feedreader/schedules) failed.`, with no further detail (Wrangler doesn't currently surface the underlying API error for trigger-deploy failures — see [cloudflare/workers-sdk#14288](https://github.com/cloudflare/workers-sdk/issues/14288)). The script, bindings, and vars deployed fine each time; only the schedules update failed, leaving only the original single cron registered. Root cause against the live Cloudflare API was never confirmed (no token available outside CI to reproduce with verbose logging). If you want to retry the two-cron-trigger approach, capture `wrangler deploy --log-level debug` output to get the actual API error body before assuming it'll work differently this time.

1000/source was sized against rows-read cost, not disk: `listFeedItems` reads every row matching its WHERE clause with no SQL `LIMIT` (sorting/pagination happens in memory — see `core/sources/listInMemory.ts`), so an unfiltered home-page hit reads `sources × cap` rows from D1 every time. At 4 sources × 1000 that's 4,000 rows/request — cheap in isolation, but worth keeping in mind against D1 Free's 5M-rows-read/day budget if traffic grows or source count grows well past 4. Raising the cap or adding more sources should come with either moving sort/pagination into SQL (the existing `idx_items_feed_order` index already matches the sort order but is unused by the current query shape) or checking D1 Free's rows-read budget isn't at risk.

## Reading cron execution history

Use Cloudflare dashboard → Workers & Pages → `feedreader` → Triggers → Cron Triggers, or `wrangler tail` while a scheduled run is expected, to confirm `sync_state.last_attempt_at` is updating without user-triggered traffic.

## Local SSR smoke procedure

Before considering any `core/render.ts` change done:

1. Run:

   ```bash
   npm run typecheck
   npm test
   npm run db:migrate:local
   ```

2. Start local dev:

   ```bash
   npm run dev
   ```

3. Load `http://127.0.0.1:8788` and verify:
   - header actions render correctly
   - source filters and search controls render correctly
   - the reader settings dialog opens and closes
   - empty-state and error-banner markup still look sane
   - `View more` visibility matches whether another page exists

4. If the change also affects `/api/items`, hit the endpoint directly and verify the JSON shape still matches what `web-static/static/app.js` expects.
