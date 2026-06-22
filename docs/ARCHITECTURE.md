# Architecture

## Layout

```
core/                  platform-agnostic: domain types, source adapters,
                       refresh/card-building logic, SSR rendering
  ports.ts             FeedRepository interface — the only seam a platform
                       adapter has to implement
  sources/             one file per upstream source, plus shared helpers
platforms/cloudflare/  the only adapter that ships today: Worker entry,
                       D1-backed FeedRepository, wrangler config
web-static/            verbatim copy of the original Go implementation's
                       web/static/* — pure browser assets, no porting needed
```

`core/` never imports `cloudflare:*`, `Deno.*`, or `node:*`. This is what
makes a second platform adapter (e.g. Deno Deploy on Deno KV) additive
later rather than a rewrite, even though only the Cloudflare adapter is
built right now.

## Mapping back to the Go app

| This repo | Go implementation |
| --- | --- |
| `core/domain.ts` | `internal/domain/models.go` |
| `core/ports.ts` | `SQLiteRepository`'s public method set in `internal/repository/sqlite.go` |
| `core/service.ts` | `internal/service/service.go` (minus the in-process scheduler — Cron Triggers replace it) |
| `core/render.ts` | `web/templates/index.html` |
| `core/sources/*.ts` | `internal/sources/*.go` |
| `platforms/cloudflare/src/repository.ts` | the D1 SQL portion of `internal/repository/sqlite.go` |
| `platforms/cloudflare/migrations/0001_init.sql` | the `Schema` constant in `internal/db/sqlite.go` |

## Why sort/search stay in application memory

`internal/repository/sqlite.go`'s `ListFeedItems` filters via SQL but sorts
and paginates in Go application memory, because total item count across
all 4 sources is small (a few hundred rows). `core/sources/listInMemory.ts`
replicates that same sort comparator (effective date desc, then first-seen
desc, then source rank, then source, then external id) so the Cloudflare
adapter's `D1Repository` — and any future KV-backed adapter — produce
identical ordering without duplicating that logic per adapter.

## `FeedRepository`

```ts
interface FeedRepository {
  saveSnapshot(source, fetchedAtIso, items): Promise<void>;
  recordFailure(source, attemptedAtIso, message): Promise<void>;
  listSourceStates(): Promise<Record<string, SyncState>>;
  getCurrentItems(source, limit): Promise<FeedItem[]>;
  listFeedItems(limit, offset, source, sources, searchQuery): Promise<FeedItem[]>;
  countTotalItems(): Promise<number>;
}
```

Adding a second platform means implementing this interface once and
wiring a new entrypoint under `platforms/<name>/` — `core/service.ts` and
`core/render.ts` don't change.
