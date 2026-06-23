// Pure helpers for the "For You" LLM ranking feature. No I/O — adapters
// (e.g. platforms/cloudflare/src/llmRanker.ts) own the actual model call and
// use these to build the prompt and interpret the response.

import type { FeedItem } from "../domain.ts";

export const MAX_INTERESTS_LENGTH = 300;
const MAX_ITEM_TEXT_LENGTH = 160;

export function buildRankingPrompt(
  items: FeedItem[],
  interests: string,
): string {
  const lines = items.map((item, i) => {
    const title = item.title.trim().slice(0, MAX_ITEM_TEXT_LENGTH);
    const summary = (item.summary ?? "").trim().slice(0, MAX_ITEM_TEXT_LENGTH);
    return `${i}: ${title}${summary ? ` — ${summary}` : ""}`;
  });
  return [
    "You are ranking a list of feed items by relevance to a reader's stated interests.",
    `Reader interests: ${interests.trim().slice(0, MAX_INTERESTS_LENGTH)}`,
    "Items (index: title — summary):",
    ...lines,
    "",
    "Respond with ONLY a JSON array of the item indices above, ordered from most to least relevant to the interests. Include every index exactly once. No other text, no markdown.",
  ].join("\n");
}

/**
 * Defensively extracts a ranked index list from a raw model response.
 * Never throws — a malformed or empty response yields []. Indices outside
 * [0, itemCount) or repeated are dropped (first occurrence wins).
 */
export function parseRankedIndices(raw: string, itemCount: number): number[] {
  const match = /\[[\s\S]*\]/.exec(raw);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of parsed) {
    const index = typeof value === "number" ? value : Number(value);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= itemCount ||
      seen.has(index)
    ) {
      continue;
    }
    seen.add(index);
    out.push(index);
  }
  return out;
}

/**
 * Places ranked items first (in model order), then appends any remaining
 * items in whatever order `items` arrived in — guarantees a full, valid
 * list even when the ranker returns a partial or empty result. Callers may
 * pass any base order, not just chronological — e.g. handlePersonalize
 * feeds this similarity-ranked input (core/personalize/similarity.ts) when
 * running the LLM as a polish pass over a pre-filtered candidate pool, and
 * the "remainder" preserves that similarity order rather than reverting to
 * chronological.
 */
export function mergeRankedOrder(
  items: FeedItem[],
  rankedIndices: number[],
): FeedItem[] {
  const used = new Set<number>();
  const out: FeedItem[] = [];
  for (const index of rankedIndices) {
    const item = items[index];
    if (!item || used.has(index)) continue;
    used.add(index);
    out.push(item);
  }
  for (let i = 0; i < items.length; i++) {
    if (!used.has(i)) out.push(items[i]!);
  }
  return out;
}

/** Stable identifier for a FeedItem — the domain type has no numeric id,
 * so (source, externalId) is the natural key for referencing an item
 * across requests (e.g. in a cached ranking). */
export function itemKey(item: FeedItem): string {
  return `${item.source} ${item.externalId}`;
}

/**
 * Projects a previously-computed ranked key order (from a cached ranking,
 * possibly over a different/smaller pool) onto a freshly-fetched item
 * list: ranked items appear first, in cached order; anything not in
 * rankedKeys — new items, or items the cache doesn't cover — keeps its
 * relative order from `items` at the end (which, like mergeRankedOrder,
 * need not be chronological — see that function's comment). Unlike
 * mergeRankedOrder, this tolerates the two lists having different lengths
 * or contents, since `items` is re-fetched live while rankedKeys may be
 * stale or partial.
 */
export function mergeRankedKeysOrder(
  items: FeedItem[],
  rankedKeys: string[],
): FeedItem[] {
  const byKey = new Map(items.map((item) => [itemKey(item), item]));
  const used = new Set<string>();
  const out: FeedItem[] = [];
  for (const key of rankedKeys) {
    const item = byKey.get(key);
    if (!item || used.has(key)) continue;
    used.add(key);
    out.push(item);
  }
  for (const item of items) {
    if (!used.has(itemKey(item))) out.push(item);
  }
  return out;
}
