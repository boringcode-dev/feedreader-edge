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

/**
 * Ranks `items` by relevance to a free-text `interests` description.
 * Returns a best-effort ordering of 0-based indices into `items`, most
 * relevant first — FeedItem has no stable numeric id, so position in the
 * input array is the only identifier the ranker needs. The result may be a
 * subset (the caller appends any indices the ranker omitted, in their
 * original order) and may be empty if ranking failed entirely; it must
 * never throw for a malformed model response, only for genuine
 * transport/availability failures.
 */
export interface LlmRanker {
  rank(items: FeedItem[], interests: string): Promise<number[]>;
}
