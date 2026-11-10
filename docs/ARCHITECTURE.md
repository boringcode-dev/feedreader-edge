# Architecture

## Layout

| Path                                                                                  | Responsibility                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`core/domain.ts`](../core/domain.ts)                                                 | Shared domain types such as `FeedItem`, `SyncState`, `CardView`, and `RefreshOutcome`.        |
| [`core/ports.ts`](../core/ports.ts)                                                   | `FeedRepository` interface — the persistence seam platform adapters implement.                |
| [`core/service.ts`](../core/service.ts)                                               | Refresh orchestration, feed pagination, health payloads, card-building, and error projection. |
| [`core/render.ts`](../core/render.ts)                                                 | Server-side HTML rendering for the feed UI.                                                   |
| [`core/preview.ts`](../core/preview.ts)                                               | Reader-view URL validation, guarded article fetch, and rich text/image/table extraction.      |
| [`core/sources/`](../core/sources)                                                    | Upstream source adapters plus shared HTTP/DOM helpers.                                        |
| [`platforms/cloudflare/src/index.ts`](../platforms/cloudflare/src/index.ts)           | Worker request router and scheduled entrypoint.                                               |
| [`platforms/cloudflare/src/repository.ts`](../platforms/cloudflare/src/repository.ts) | D1-backed `FeedRepository` implementation.                                                    |
| [`platforms/cloudflare/migrations/`](../platforms/cloudflare/migrations)              | D1 schema migrations.                                                                         |
| [`web-static/`](../web-static)                                                        | Browser assets: CSS, JS, icons, manifest, service worker.                                     |

## Runtime flow

1. The Worker handles `/`, `/api/items`, `/api/preview`, `/api/refresh`, and `/healthz`.
2. Source adapters fetch upstream content and normalize it into `FeedItem` values.
3. Snapshots are upserted into D1 by `(source, external_id)`.
4. The service layer turns stored items into card summaries and HTML/JSON responses.
5. The cron trigger fans out one refresh invocation per source through the `SELF` binding.

## Platform boundaries

- `core/` never imports `cloudflare:*`, `Deno.*`, or `node:*`.
- Platform-specific persistence and request wiring live under `platforms/*`.
- A second deployment target should implement `FeedRepository` once and provide its own entrypoint rather than forking `core/service.ts` or `core/render.ts`.

## Client state

Browser-only preferences and reading state live in `localStorage`: theme preference (including Auto, which follows the device), density, visible sources, the article-preview and bookmark-visibility settings, visited links, and saved articles. Bookmarks store a display snapshot and never leave the device, so they survive source pruning and offline use without a server API.

## Data model and refresh behavior

- Items are upserted by `(source, external_id)`.
- A refresh never deletes existing rows — a failed fetch records the failure in `sync_state` and leaves prior data in place.
- The original `published_at` is preserved across re-fetches via `coalesce(items.published_at, excluded.published_at)` so an upstream source cannot reorder an existing item by later emitting a different date.
- Sorting and pagination intentionally happen in application memory after SQL filtering. Total item count across the three sources is small enough that keeping one shared comparator is simpler and less error-prone than encoding the full fallback ordering logic separately per adapter.

## `FeedRepository`

```ts
interface FeedRepository {
  saveSnapshot(source, fetchedAtIso, items): Promise<void>;
  recordFailure(source, attemptedAtIso, message): Promise<void>;
  listSourceStates(): Promise<Record<string, SyncState>>;
  getCurrentItems(source, limit): Promise<FeedItem[]>;
  findItemByUrl(url): Promise<FeedItem | null>;
  listFeedItems(
    limit,
    offset,
    source,
    sources,
    searchQuery,
  ): Promise<FeedItem[]>;
  countTotalItems(): Promise<number>;
}
```

This keeps refresh logic, rendering, and feed shaping independent of D1-specific APIs.

## Refresh fan-out design

Cloudflare Workers Free has a tight per-invocation CPU budget. Fetching and parsing all three sources in one handler would create unnecessary coupling between unrelated source failures and CPU spikes.

Instead:

- `scheduled()` and `POST /api/refresh` fan out through the `SELF` binding
- each source refresh runs as a fresh invocation at `POST /internal/refresh/:source`
- `REFRESH_SECRET` gates those internal routes
- a failure in one source updates only that source's `sync_state` row

## Article preview

The optional article preview is served by `GET /api/preview?url=…`.

- The requested URL must exactly match a stored `items.url`. This check, not the fetch layer, is what keeps the endpoint from acting as an open proxy; `feedreader.articlePreviewEnabled` only controls the client behavior.
- `core/preview.ts` additionally rejects non-http(s) schemes, credentials, non-standard ports, and loopback/private/link-local hosts, and re-checks the final URL after redirects.
- Article fetches time out after 10 seconds and read at most 400 KB. The extractor removes scripts/navigation/footer noise and returns structured text segments, image blocks, and table blocks only — upstream HTML is never returned or injected. Text renders with `textContent`/DOM nodes; inline anchors are limited to URLs that pass the same public http(s) validation, and image URLs are re-validated before the browser loads them directly with `loading="lazy"` and `referrerpolicy="no-referrer"`.
- Image blocks may include a `figcaption`-derived caption and intrinsic width/height to reserve layout space. Known avatar/profile-image hosts and paths, SVG wordmarks, and common badge hosts are dropped before the image cap so author-list and README chrome doesn't displace article figures. Table blocks carry a header flag and capped rows/cells. The response also includes byline, publication date, and an estimated reading time. For Hugging Face paper URLs the extractor starts at the Abstract section, then appends the paper's resource links and citing model, dataset, space, and collection lists while excluding community comment chrome; GitHub titles drop the site prefix. The preview and card `…` dialogs expose a stored Hacker News comments URL for HN items; other sources omit it.
- The client highlights the card matching the open preview and provides previous/next navigation over the currently rendered card list, skipping duplicate or unusable cards. When the last rendered card is previewed, Next remains enabled if another page exists and appends it before advancing. On mobile the open panel pins the body scroll position (and reapplies it after rotation), and the `theme-color` tint switches to the panel surface while the panel covers the viewport.
- Card host rows keep the optional bookmark toggle and a more-actions dialog trigger. The dialog exposes Share, the stored Hacker News comments URL when present, and Open source; choosing an action does not open the preview.
- Successful previews are edge-cached for 30 minutes; the Cache API is a no-op in local `wrangler dev`.

See [RUNBOOK.md](RUNBOOK.md) for failure modes.
