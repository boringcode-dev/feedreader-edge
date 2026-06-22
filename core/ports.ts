// Platform port for persistence. Maps 1:1 to SQLiteRepository's public
// methods in internal/repository/sqlite.go. Implemented by:
//   - platforms/cloudflare/src/repository.ts (D1)
//   - platforms/deno/src/repository.ts (Deno KV) — phase 2
//
// core/ never imports a concrete implementation of this interface.

import type { FeedItem, SyncState } from "./domain.ts";

export interface FeedRepository {
  saveSnapshot(
    source: string,
    fetchedAtIso: string,
    items: FeedItem[],
  ): Promise<void>;
  recordFailure(
    source: string,
    attemptedAtIso: string,
    message: string,
  ): Promise<void>;
  listSourceStates(): Promise<Record<string, SyncState>>;
  getCurrentItems(source: string, limit: number): Promise<FeedItem[]>;
  listFeedItems(
    limit: number,
    offset: number,
    source: string,
    sources: string[],
    searchQuery: string,
  ): Promise<FeedItem[]>;
  countTotalItems(): Promise<number>;
}
