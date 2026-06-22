# Architecture

## Layout

| Path                                                                                  | Responsibility                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`core/domain.ts`](../core/domain.ts)                                                 | Shared domain types such as `FeedItem`, `SyncState`, `CardView`, and `RefreshOutcome`.        |
| [`core/ports.ts`](../core/ports.ts)                                                   | `FeedRepository` interface — the persistence seam platform adapters implement.                |
| [`core/service.ts`](../core/service.ts)                                               | Refresh orchestration, feed pagination, health payloads, card-building, and error projection. |
| [`core/render.ts`](../core/render.ts)                                                 | Server-side HTML rendering for the feed UI.                                                   |
| [`core/sources/`](../core/sources)                                                    | Upstream source adapters plus shared HTTP/DOM helpers.                                        |
| [`platforms/cloudflare/src/index.ts`](../platforms/cloudflare/src/index.ts)           | Worker request router and scheduled entrypoint.                                               |
| [`platforms/cloudflare/src/repository.ts`](../platforms/cloudflare/src/repository.ts) | D1-backed `FeedRepository` implementation.                                                    |
| [`platforms/cloudflare/migrations/`](../platforms/cloudflare/migrations)              | D1 schema migrations.                                                                         |
| [`web-static/`](../web-static)                                                        | Browser assets: CSS, JS, icons, manifest, service worker.                                     |

## Runtime flow

1. The Worker handles `/`, `/api/items`, `/api/refresh`, and `/healthz`.
2. Source adapters fetch upstream content and normalize it into `FeedItem` values.
3. Snapshots are upserted into D1 by `(source, external_id)`.
4. The service layer turns stored items into card summaries and HTML/JSON responses.
5. The cron trigger fans out one refresh invocation per source through the `SELF` binding.

## Platform boundaries

- `core/` never imports `cloudflare:*`, `Deno.*`, or `node:*`.
- Platform-specific persistence and request wiring live under `platforms/*`.
- A second deployment target should implement `FeedRepository` once and provide its own entrypoint rather than forking `core/service.ts` or `core/render.ts`.

## Data model and refresh behavior

- Items are upserted by `(source, external_id)`.
- A refresh never deletes existing rows — a failed fetch records the failure in `sync_state` and leaves prior data in place.
- The original `published_at` is preserved across re-fetches via `coalesce(items.published_at, excluded.published_at)` so an upstream source cannot reorder an existing item by later emitting a different date.
- Sorting and pagination intentionally happen in application memory after SQL filtering. Total item count across the four sources is small enough that keeping one shared comparator is simpler and less error-prone than encoding the full fallback ordering logic separately per adapter.

## `FeedRepository`

```ts
interface FeedRepository {
  saveSnapshot(source, fetchedAtIso, items): Promise<void>;
  recordFailure(source, attemptedAtIso, message): Promise<void>;
  listSourceStates(): Promise<Record<string, SyncState>>;
  getCurrentItems(source, limit): Promise<FeedItem[]>;
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

Cloudflare Workers Free has a tight per-invocation CPU budget. Fetching and parsing all four sources in one handler would create unnecessary coupling between unrelated source failures and CPU spikes.

Instead:

- `scheduled()` and `POST /api/refresh` fan out through the `SELF` binding
- each source refresh runs as a fresh invocation at `POST /internal/refresh/:source`
- `REFRESH_SECRET` gates those internal routes
- a failure in one source updates only that source's `sync_state` row

See [RUNBOOK.md](RUNBOOK.md) for the operational details.
