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

## "For You" embedding pipeline

`/api/personalize` is retrieve-then-rerank, not a single LLM call: each item gets a `@cf/baai/bge-base-en-v1.5` embedding once at ingestion time (`core/service.ts`'s `refreshOne`, stored in `items.embedding_json`/`embedding_model`), and at request time only the interests string gets embedded — ranking the ~500-item pool by cosine similarity (`core/personalize/similarity.ts`) needs no LLM call. The existing `CloudflareLlmRanker` then runs only as an optional "polish" pass over the top `FEEDREADER_PERSONALIZE_POLISH_POOL_SIZE` similarity hits (default 30; set to `0` to disable the LLM step entirely and serve similarity order on its own — no redeploy needed, just a var change).

**Re-embedding trigger is presence-only, not staleness.** `D1Repository.listEmbeddedKeys` skips any item that already has a non-null `embedding_json`, so a source's mostly-unchanged trending items don't get re-embedded every hourly refresh — but if an item's title/summary is edited in place after first ingestion (rare for these sources), its embedding silently goes stale with no automatic re-embed. Existing rows from before this column existed self-backfill within ~1 hour of deploy, since the hourly refresh re-upserts every currently-live item regardless.

**Neuron budget**: the LLM polish step (one chat-model call over up to ~30 item titles/summaries) dominates Workers AI spend, not the embedder (one batched embed call per source per refresh cycle, only for items missing a vector, plus one tiny embed call per personalize cache-miss request). Under budget pressure, the first lever to pull is `FEEDREADER_PERSONALIZE_POLISH_POOL_SIZE`, not the embedding model.

**Manual verification** (no D1/Miniflare integration tests exist for this — same convention as the rest of `D1Repository`):

```bash
npm run db:migrate:local
npm run dev
# trigger one source's refresh, then inspect:
wrangler d1 execute feedreader --local --config platforms/cloudflare/wrangler.toml \
  --command "SELECT external_id, embedding_json IS NOT NULL AS has_embedding FROM items WHERE source='hackernews' LIMIT 5"
# trigger that source's refresh again and re-run the query — embedding_json
# should be unchanged (not re-computed) for the same rows, confirming the
# ON CONFLICT ... coalesce(excluded.embedding_json, items.embedding_json)
# preserve behavior in repository.ts.
```

With real Workers AI credentials, exercise `/api/personalize` with two paraphrased interests strings (e.g. "rust and distributed systems" vs "distributed systems, rust") and confirm comparable rankings despite the literal string difference — that's the concrete capability this pipeline is meant to deliver over the old cache-key-by-literal-string approach.

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
