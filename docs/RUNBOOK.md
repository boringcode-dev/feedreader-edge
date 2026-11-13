# Runbook

## Why refresh is split into 3 internal requests

Cloudflare Workers Free caps CPU time per invocation tightly enough that fetching and parsing all three sources inline in one `scheduled()` run is an unnecessary risk, especially for the DOM-heavy sources.

Instead, both the cron handler and `POST /api/refresh` fan out:

```
scheduled() / POST /api/refresh
        │
        │  env.SELF.fetch() × 3, one per source, via the service binding
        │  (fresh Worker invocation per call)
        ▼
POST /internal/refresh/hackernews    ─┐
POST /internal/refresh/github         │  each gated by the
POST /internal/refresh/huggingface    ─┘  X-Refresh-Secret header
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

`/api/personalize` is retrieve-then-rerank, not a single LLM call: each item gets a `@cf/baai/bge-base-en-v1.5` embedding once at ingestion time (`core/service.ts`'s `refreshOne`, stored in `items.embedding_json`/`embedding_model`), and at request time only the interests string gets embedded — ranking the ~500-item pool by cosine similarity (`core/personalize/similarity.ts`) needs no LLM call. The existing `CloudflareLlmRanker` then runs only as an optional "polish" pass over the `FEEDREADER_PERSONALIZE_POLISH_POOL_SIZE` candidates (default 30; set to `0` to disable the LLM step entirely and serve similarity order on its own — no redeploy needed, just a var change). Candidate selection (`selectCandidates`) reserves one page's worth of slots for the newest items, so a freshly ingested story is considered by the ranker instead of always falling below the polished block — without that reserve, pure similarity retrieval never picked up just-ingested items and they effectively never reached the first "For You" page.

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

## Weekly item-retention prune

`scheduled()`'s single hourly trigger does double duty: every firing, `isWeeklyPruneWindow` checks whether `event.scheduledTime` landed on Sunday 16:00 UTC (23:00 ICT) and, if so, runs `D1Repository.pruneOldItems` before the normal refresh fan-out. It deletes all but the `FEEDREADER_MAX_ITEMS_PER_SOURCE` (default 1000) most recent items per source, ordered the same way the feed itself sorts (`coalesce(published_at, first_seen_at) DESC, ...`).

**Why not a second Cron Trigger:** that was the original design, but deploying a second `[triggers]` cron entry alongside the hourly one made `wrangler deploy` fail outright — `[ERROR] Some triggers failed to deploy for feedreader: - A request to the Cloudflare API (/accounts/.../workers/scripts/feedreader/schedules) failed.`, with no further detail (Wrangler doesn't currently surface the underlying API error for trigger-deploy failures — see [cloudflare/workers-sdk#14288](https://github.com/cloudflare/workers-sdk/issues/14288)). The script, bindings, and vars deployed fine each time; only the schedules update failed, leaving only the original single cron registered. Root cause against the live Cloudflare API was never confirmed (no token available outside CI to reproduce with verbose logging). If you want to retry the two-cron-trigger approach, capture `wrangler deploy --log-level debug` output to get the actual API error body before assuming it'll work differently this time.

1000/source was sized against rows-read cost, not disk: `listFeedItems` reads every row matching its WHERE clause with no SQL `LIMIT` (sorting/pagination happens in memory — see `core/sources/listInMemory.ts`), so an unfiltered home-page hit reads `sources × cap` rows from D1 every time. At 3 sources × 1000 that's 3,000 rows/request — cheap in isolation, but worth keeping in mind against D1 Free's 5M-rows-read/day budget if traffic grows or source count grows well past 3. Raising the cap or adding more sources should come with either moving sort/pagination into SQL (the existing `idx_items_feed_order` index already matches the sort order but is unused by the current query shape) or checking D1 Free's rows-read budget isn't at risk.

## Reading cron execution history

Use Cloudflare dashboard → Workers & Pages → `feedreader` → Triggers → Cron Triggers, or `wrangler tail` while a scheduled run is expected, to confirm `sync_state.last_attempt_at` is updating without user-triggered traffic.

## Article preview failures

`GET /api/preview?url=…` only previews URLs that still exist in `items`, so a pruned or changed article URL returns `404` even if it is still visible in an open tab. Failures include a machine-readable `reason` (and `upstream_status` when applicable):

- `422 invalid_url` — the stored URL is not public http(s) (for example an upstream feed emitted a `javascript:` or localhost link)
- `502 blocked` — the upstream returned `401`/`403` (for example DataDome/paywall protection)
- `502 rate_limited` / `502 upstream_error` — the upstream returned `429`/`5xx` after one retry
- `504 timeout` — the fetch exceeded the 10-second timeout
- `502 too_large` — the HTML exceeded the 400 KB cap before readable content, or a document exceeded the 5 MB fallback cap
- `502 unsupported_content_type` / `empty_body` / `redirect` / `fetch_failed` — other fetch or extraction failures. `unsupported_content_type` also covers a document the AI fallback could not convert (disabled, timed out, or unsupported by `toMarkdown`).
- `200` with `reason: "no_content"` — the page was fetched and had no readable blocks, and neither the AI nor Browser Run fallback produced content.

Before returning `unsupported_content_type` for a non-HTML response, `too_large` for a truncated page, or `no_content` for an empty HTML page, `fetchArticlePreview` calls the optional Workers AI `toMarkdown` fallback (`platforms/cloudflare/src/previewFallback.ts`). It downloads at most 5 MB (`DEFAULT_MAX_FALLBACK_BYTES`), races the conversion against a 10-second timeout, strips the filename/page-marker headings from PDF output, and maps the Markdown back into validated preview blocks. Standalone images are skipped; the fallback disables AI image-description conversion. Set `FEEDREADER_AI_PREVIEW_FALLBACK=false` to disable it. Document text conversion is free in Workers AI.

If the AI conversion returns nothing for an HTML page, the chain calls Browser Run's `markdown` Quick Action (`platforms/cloudflare/src/browserPreviewFallback.ts`) before returning `no_content`. It is limited to `no_content`; PDFs/Office documents, `too_large`, `blocked`, `timeout`, and rate-limited failures never reach it. Browser Run waits for `networkidle2` with 8-second navigation/action and 9-second outer timeouts, blocks images/media/fonts and literal private-host requests, and validates the rendered page status and final URL. Workers Free includes 10 browser-minutes/day and paces Quick Actions to one request per 10 seconds; a `429` is logged and treated as no preview. Set `FEEDREADER_BROWSER_PREVIEW_FALLBACK=false` to disable it. Browser Run successes are cached for 30 minutes; the preview cache key is `preview:v11`.

The Worker logs `preview_unavailable` and `preview_empty` events with the URL, reason, and upstream status, plus a `preview_ai_fallback` event for each AI attempt (`kind`, `outcome` = `ok`/`empty`/`error`, `ms`, `blocks`, `tokens`, and a capped `error`) and a `preview_browser_fallback` event for each Browser Run attempt (`outcome`, `status`, `page_status`, `browser_ms`, `blocks`, and a capped `error`). Successful previews, including AI- and Browser Run-converted ones, are edge-cached for 30 minutes via the Cache API; browser-facing responses are `private, no-store`. Transient upstream `429`/`5xx` responses are retried once with jitter. If bursts produce transient `503`s, check Workers Logs/CPU: the extractor runs in the request invocation, and sequential retries succeeding usually points at the Workers Free 10 ms CPU limit rather than a lasting upstream block. Lowering `DEFAULT_MAX_BYTES` in `core/preview.ts` (400 KB today) reduces the parse cost.

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
   - the document has no external `style.css` or `theme-init.js` request; both are inlined in `<head>`
   - the response carries `Cache-Control: private, no-store` (the five-minute edge copy lives in the Cache API and is rewritten to this header on the way out)
   - in a regular browser tab the launch veil stays hidden (`display: none`) and is removed from the DOM; in an installed/standalone window it is visible and fades out within about a second
   - throttle the network, then change a source filter or run a search: skeleton cards appear after ~150 ms and are replaced by the new cards; `View more` appends three skeleton rows
   - enable article preview, throttle the network, and open a card: the card title stays visible while a preview skeleton appears in the panel, then the fetched title/content fade in; a failed preview clears the skeleton and shows the error status
   - with `prefers-reduced-motion: reduce`, skeleton shimmer and the view/Web Animations transitions are disabled
   - typing in the search box shows only the app's close control, not a second native clear X
   - header actions render correctly
   - source filters and search controls render correctly
   - the reader settings dialog opens and closes, its Appearance/Reading/Sources tabs switch via click and arrow keys, and Cancel/Save show their icons
   - empty-state and error-banner markup still look sane
   - `View more` has its icon and its visibility matches whether another page exists
   - enabling article preview, clicking a card, and confirming the panel renders rich text links, images/captions (without contributor avatars), tables, reading metadata, and (for Hacker News) a Comments action in the `…` dialog; `Open source` points at the article; the active card is highlighted and previous/next move through the visible list, with Next loading the next page when the last rendered card is previewed and more pages exist
   - card host-row actions: the `…` dialog shows Share, Comments only for Hacker News, and Open source, and every action works without opening the preview
   - Share uses the native share sheet on supporting browsers and copies the article link otherwise; verify it from both the card `…` dialog and the preview `…` dialog
   - on a viewport 900px or narrower the preview panel is fullscreen and its footer places the bookmark, `…`, and Close after Previous/Next in both orientations; above 900px the panel is an aside and those controls stay in its header. The `…` dialog is headed by the article title with its source icon/host and a close button, with full-width action rows over the standard backdrop; it closes on X, backdrop click/Escape and leaves the preview open
   - on a phone, a rightward drag from the left screen edge moves the fullscreen preview with the finger and closes it past the distance/velocity threshold, returning to the previous feed position; a short drag springs back, vertical edge drags still scroll the article, and the gesture is ignored while the `…` dialog is open
   - in an installed iOS PWA in phone portrait, both the page header and the preview panel header sit below the iOS 26 status-bar blur
   - opening the preview on iOS portrait updates the status bar/toolbar tint to the panel surface color, so the strip above the panel is not the page background color and the panel header is not visibly blurred
   - in iPhone landscape, the header, feed cards, filters, and full-screen preview content stay inside the left/right safe-area insets (no notch/Dynamic Island overlap)
   - with preview open in phone landscape, Install/New version and For You collapse to icon-only controls, and feed-row text keeps the same reduced size whether or not an article is previewing
   - enabling bookmarks in Reader settings, bookmarking a card, confirming the Saved count and view, then reloading to confirm the bookmark persists; disabling bookmarks hides the card/preview controls and Saved filter, leaves the Saved view, and re-enabling restores the saved item

4. If the change also affects `/api/items`, hit the endpoint directly and verify the JSON shape still matches what `web-static/static/app.js` expects.

## PWA shell updates

The launch veil and skeleton styles are part of the server-rendered HTML/CSS shell. When changing `core/render.ts`, `web-static/static/style.css`, `web-static/static/theme-init.js`, or `web-static/static/app.js`:

- bump the `app.js?v=` value in `core/render.ts` and `web-static/service-worker.js`
- bump `SHELL_CACHE` in `web-static/service-worker.js`

The service worker navigation handler is network-first, but the version bump ensures installed clients install the new shell atomically.
