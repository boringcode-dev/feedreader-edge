import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../domain.ts";
import { itemKey } from "../rank.ts";
import { cosineSimilarity, rankBySimilarity } from "../similarity.ts";

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

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
  });

  it("is 0 rather than NaN for a zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe("rankBySimilarity", () => {
  it("sorts items strictly by descending similarity when all have vectors", () => {
    const a = item({ externalId: "a" });
    const b = item({ externalId: "b" });
    const c = item({ externalId: "c" });
    const interests = [1, 0];
    const embeddings = new Map([
      [itemKey(a), [0, 1]], // orthogonal -> 0
      [itemKey(b), [1, 0]], // identical -> 1
      [itemKey(c), [0.7, 0.3]], // partial match
    ]);
    const ranked = rankBySimilarity([a, b, c], embeddings, interests);
    expect(ranked.map((i) => i.externalId)).toEqual(["b", "c", "a"]);
  });

  it("sinks un-embedded items to the end, preserving their relative order", () => {
    const embedded = item({ externalId: "embedded" });
    const first = item({ externalId: "first" });
    const second = item({ externalId: "second" });
    const embeddings = new Map([[itemKey(embedded), [1, 0]]]);
    const ranked = rankBySimilarity(
      [first, embedded, second],
      embeddings,
      [1, 0],
    );
    // embedded item sorts first; the two un-embedded items keep their
    // original relative order ("first" before "second") rather than being
    // reshuffled.
    expect(ranked.map((i) => i.externalId)).toEqual([
      "embedded",
      "first",
      "second",
    ]);
  });

  it("degrades to a no-op when no item has a stored embedding", () => {
    const items = [
      item({ externalId: "a" }),
      item({ externalId: "b" }),
      item({ externalId: "c" }),
    ];
    const ranked = rankBySimilarity(items, new Map(), [1, 0]);
    expect(ranked.map((i) => i.externalId)).toEqual(["a", "b", "c"]);
  });
});
