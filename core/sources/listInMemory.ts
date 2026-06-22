// Shared sort/filter/paginate logic used by every FeedRepository
// implementation (D1, and later Deno KV). Having exactly one implementation
// of this logic — rather than one per platform — is what keeps the two
// repository adapters behaviorally identical.
//
// Ports internal/repository/sqlite.go's ListFeedItems: sorting and
// pagination happen in application memory there too (not in SQL), because
// total item count across all 4 sources is small. Source/search filtering
// in the Go app happens in the SQL WHERE clause; the D1 adapter mirrors that
// with SQL LIKE, then calls sortFeedItems/paginate from here for ordering.
// A KV-backed adapter (no SQL available) would call filterFeedItems too.

import type { FeedItem } from "../domain.ts";

function effectiveSortTimeMs(item: FeedItem): number {
  const iso = item.publishedAt ?? item.fetchedAt;
  return iso ? Date.parse(iso) : 0;
}

/**
 * Matches sqlite.go's sort.SliceStable comparator: effective date desc,
 * then first-seen ("fetchedAt") desc, then source rank asc, then source
 * asc, then external id asc. Array.prototype.sort is stable since ES2019,
 * matching Go's SliceStable guarantee.
 */
export function sortFeedItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    const aTime = effectiveSortTimeMs(a);
    const bTime = effectiveSortTimeMs(b);
    if (aTime !== bTime) return bTime - aTime;

    const aFetched = a.fetchedAt ? Date.parse(a.fetchedAt) : 0;
    const bFetched = b.fetchedAt ? Date.parse(b.fetchedAt) : 0;
    if (aFetched !== bFetched) return bFetched - aFetched;

    if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    if (a.externalId !== b.externalId)
      return a.externalId < b.externalId ? -1 : 1;
    return 0;
  });
}

export function paginate<T>(items: T[], limit: number, offset: number): T[] {
  const safeOffset = Math.max(offset, 0);
  if (safeOffset >= items.length) return [];
  const end =
    limit > 0 ? Math.min(items.length, safeOffset + limit) : items.length;
  return items.slice(safeOffset, end);
}

function searchTerms(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
}

function matchesTerm(item: FeedItem, term: string): boolean {
  const haystacks = [
    item.title,
    item.summary ?? "",
    item.author ?? "",
    item.url,
    JSON.stringify(item.metadata ?? {}),
  ];
  return haystacks.some((value) => value.toLowerCase().includes(term));
}

/**
 * Case-insensitive, multi-term substring search: AND across terms, OR
 * across fields per term — same semantics as the Go app's multi-term LIKE
 * query. Plain `.includes()` needs no `%`/`_`/`\` escaping, unlike SQL LIKE,
 * but produces the same matches since those characters are literal in both.
 */
export function filterFeedItems(
  items: FeedItem[],
  source: string,
  sources: string[],
  searchQuery: string,
): FeedItem[] {
  let filtered = items;
  const trimmedSource = source.trim();
  if (trimmedSource !== "") {
    filtered = filtered.filter((item) => item.source === trimmedSource);
  } else if (sources.length > 0) {
    const sourceSet = new Set(sources);
    filtered = filtered.filter((item) => sourceSet.has(item.source));
  }

  const terms = searchTerms(searchQuery);
  if (terms.length > 0) {
    filtered = filtered.filter((item) =>
      terms.every((term) => matchesTerm(item, term)),
    );
  }
  return filtered;
}
