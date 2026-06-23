// Platform port for persistence. Maps 1:1 to SQLiteRepository's public
// methods in internal/repository/sqlite.go. Implemented by:
//   - platforms/cloudflare/src/repository.ts (D1)
//   - platforms/deno/src/repository.ts (Deno KV) — phase 2
//
// core/ never imports a concrete implementation of this interface.

import type { FeedItem, SyncState } from "./domain.ts";

export interface FeedRepository {
  /**
   * Upserts `items` for `source`. `embeddings` is keyed by `itemKey()`
   * (see core/personalize/rank.ts) and may be empty or a partial subset of
   * `items` — a key's absence means "leave that item's stored embedding
   * untouched" (preserve whatever is already on the row), not "clear it".
   * Embedding generation is best-effort at the call site, so this must
   * accept an empty map without complaint.
   */
  saveSnapshot(
    source: string,
    fetchedAtIso: string,
    items: FeedItem[],
    embeddings: Map<string, number[]>,
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
  /**
   * Of the given `externalIds` for `source`, returns the subset that
   * already have a stored embedding — used at ingestion time to embed only
   * items that don't have one yet, instead of re-embedding the whole batch
   * every refresh cycle.
   */
  listEmbeddedKeys(
    source: string,
    externalIds: string[],
  ): Promise<Set<string>>;
  /**
   * Like `listFeedItems`, but for the /api/personalize candidate pool:
   * always starts at offset 0, ignores search, and also returns each
   * item's stored embedding (keyed by `itemKey()`) alongside the items
   * themselves in one round trip. An item with no stored embedding yet is
   * simply absent from the map — callers must treat that as "no vector",
   * not an error.
   */
  listFeedItemsForRanking(
    limit: number,
    source: string,
    sources: string[],
  ): Promise<{ items: FeedItem[]; embeddings: Map<string, number[]> }>;
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

/**
 * Embeds free-text into vectors for similarity ranking. One vector per
 * input string, same order as `texts`, on success. Must throw only for
 * genuine transport/availability failures (never return a partial or
 * malformed result silently) — callers treat a thrown error as "skip
 * embedding for this batch/request", the same resilience posture as
 * LlmRanker.
 */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}
