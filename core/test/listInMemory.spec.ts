import { describe, expect, it } from "vitest";
import type { FeedItem } from "../domain.ts";
import {
  filterFeedItems,
  paginate,
  sortFeedItems,
} from "../sources/listInMemory.ts";

function item(overrides: Partial<FeedItem>): FeedItem {
  return {
    source: "hackernews",
    externalId: "1",
    title: "title",
    url: "https://example.com",
    sourceRank: 1,
    metadata: {},
    ...overrides,
  };
}

describe("sortFeedItems", () => {
  it("orders by effective date desc, then first-seen desc, then rank/source/id", () => {
    const older = item({
      externalId: "older",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = item({
      externalId: "newer",
      publishedAt: "2026-06-01T00:00:00.000Z",
    });
    const noDate = item({
      externalId: "no-date",
      fetchedAt: "2026-03-01T00:00:00.000Z",
    });

    const sorted = sortFeedItems([older, noDate, newer]);
    expect(sorted.map((i) => i.externalId)).toEqual([
      "newer",
      "no-date",
      "older",
    ]);
  });

  it("breaks ties by source rank, then source, then external id", () => {
    const a = item({ externalId: "b", source: "github", sourceRank: 2 });
    const b = item({ externalId: "a", source: "github", sourceRank: 1 });
    const c = item({ externalId: "a", source: "alphaxiv", sourceRank: 1 });
    const sorted = sortFeedItems([a, b, c]);
    expect(sorted.map((i) => `${i.source}:${i.externalId}`)).toEqual([
      "alphaxiv:a",
      "github:a",
      "github:b",
    ]);
  });
});

describe("paginate", () => {
  it("slices by offset/limit and returns empty past the end", () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginate(items, 2, 1)).toEqual([2, 3]);
    expect(paginate(items, 0, 0)).toEqual(items);
    expect(paginate(items, 2, 10)).toEqual([]);
  });
});

describe("filterFeedItems", () => {
  const items = [
    item({
      externalId: "1",
      source: "hackernews",
      title: "Rust is great",
      summary: "systems programming",
    }),
    item({
      externalId: "2",
      source: "github",
      title: "awesome-go",
      author: "gopher",
    }),
    item({ externalId: "3", source: "github", title: "totally unrelated" }),
  ];

  it("filters by a single source", () => {
    expect(
      filterFeedItems(items, "github", [], "").map((i) => i.externalId),
    ).toEqual(["2", "3"]);
  });

  it("filters by an enabled-sources set when no single source is set", () => {
    expect(
      filterFeedItems(items, "", ["hackernews"], "").map((i) => i.externalId),
    ).toEqual(["1"]);
  });

  it("matches multi-term search across fields, AND across terms", () => {
    expect(
      filterFeedItems(items, "", [], "rust systems").map((i) => i.externalId),
    ).toEqual(["1"]);
    expect(
      filterFeedItems(items, "", [], "gopher").map((i) => i.externalId),
    ).toEqual(["2"]);
    expect(filterFeedItems(items, "", [], "rust gopher")).toEqual([]);
  });
});
