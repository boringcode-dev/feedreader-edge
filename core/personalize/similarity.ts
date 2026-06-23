// Pure helpers for ranking by embedding similarity — the retrieval half of
// the "For You" feature's retrieve-then-rerank pipeline. No I/O; adapters
// (e.g. platforms/cloudflare/src/embedder.ts) own the actual model call and
// platforms/cloudflare/src/index.ts's handlePersonalize wires this together
// with the existing LLM polish step (core/personalize/rank.ts).

import type { FeedItem } from "../domain.ts";
import { itemKey } from "./rank.ts";

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Sorts `items` by cosine similarity to `interestsVector`, descending.
 * Items with no entry in `embeddings` (not yet embedded at ingestion time,
 * or embedding generation failed that cycle) sink to the end, keeping
 * their relative order from `items` — a stable partition, not a random
 * placement, so an all-unembedded pool degrades to a no-op rather than
 * reshuffling. mergeRankedOrder/mergeRankedKeysOrder in rank.ts then treat
 * this function's output as the new "base order" for the LLM polish step.
 */
export function rankBySimilarity(
  items: FeedItem[],
  embeddings: Map<string, number[]>,
  interestsVector: number[],
): FeedItem[] {
  const scored: { item: FeedItem; score: number; index: number }[] = [];
  const unscored: FeedItem[] = [];
  items.forEach((item, index) => {
    const vector = embeddings.get(itemKey(item));
    if (vector) {
      scored.push({
        item,
        score: cosineSimilarity(vector, interestsVector),
        index,
      });
    } else {
      unscored.push(item);
    }
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });
  return [...scored.map((entry) => entry.item), ...unscored];
}
