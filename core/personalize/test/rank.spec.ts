import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../domain.ts";
import {
  buildRankingPrompt,
  itemKey,
  mergeRankedKeysOrder,
  mergeRankedOrder,
  parseRankedIndices,
} from "../rank.ts";
import { FakeLlmRanker } from "./fakeLlmRanker.ts";

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

describe("buildRankingPrompt", () => {
  it("numbers items by index and includes title, summary, and interests", () => {
    const items = [
      item({ title: "Rust async runtime", summary: "a new executor" }),
      item({ title: "No summary item" }),
    ];
    const prompt = buildRankingPrompt(items, "rust, distributed systems");
    expect(prompt).toContain("0: Rust async runtime — a new executor");
    expect(prompt).toContain("1: No summary item");
    expect(prompt).toContain("Reader interests: rust, distributed systems");
  });

  it("truncates oversized interests text", () => {
    const prompt = buildRankingPrompt([], "x".repeat(1000));
    const line = prompt.split("\n").find((l) => l.startsWith("Reader interests:"))!;
    expect(line.length).toBeLessThan(320);
  });
});

describe("parseRankedIndices", () => {
  it("parses a well-formed JSON array", () => {
    expect(parseRankedIndices("[2, 0, 1]", 3)).toEqual([2, 0, 1]);
  });

  it("tolerates surrounding prose/markdown around the array", () => {
    expect(parseRankedIndices("Sure! ```json\n[1, 0]\n```", 2)).toEqual([
      1, 0,
    ]);
  });

  it("drops out-of-range and duplicate indices", () => {
    expect(parseRankedIndices("[1, 1, 5, -1, 0]", 2)).toEqual([1, 0]);
  });

  it("returns [] for garbage output instead of throwing", () => {
    expect(parseRankedIndices("not even close to json", 3)).toEqual([]);
    expect(parseRankedIndices("", 3)).toEqual([]);
  });
});

describe("mergeRankedOrder", () => {
  const items = [item({ externalId: "a" }), item({ externalId: "b" }), item({ externalId: "c" })];

  it("places ranked items first in model order, then appends the rest", () => {
    const merged = mergeRankedOrder(items, [2, 0]);
    expect(merged.map((i) => i.externalId)).toEqual(["c", "a", "b"]);
  });

  it("passes through original order when ranking is empty", () => {
    expect(mergeRankedOrder(items, []).map((i) => i.externalId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ignores indices it doesn't recognize without throwing", () => {
    const merged = mergeRankedOrder(items, [99, 1]);
    expect(merged.map((i) => i.externalId)).toEqual(["b", "a", "c"]);
  });
});

describe("mergeRankedKeysOrder", () => {
  const items = [
    item({ source: "hackernews", externalId: "a" }),
    item({ source: "github", externalId: "b" }),
    item({ source: "hackernews", externalId: "c" }),
  ];

  it("places ranked items first by cached key order, then appends the rest", () => {
    const merged = mergeRankedKeysOrder(items, [
      itemKey(items[2]!),
      itemKey(items[0]!),
    ]);
    expect(merged.map((i) => i.externalId)).toEqual(["c", "a", "b"]);
  });

  it("tolerates a cached key for an item that no longer exists", () => {
    const merged = mergeRankedKeysOrder(items, [
      "hackernews missing-id",
      itemKey(items[1]!),
    ]);
    expect(merged.map((i) => i.externalId)).toEqual(["b", "a", "c"]);
  });

  it("tolerates duplicate cached keys", () => {
    const key = itemKey(items[1]!);
    const merged = mergeRankedKeysOrder(items, [key, key]);
    expect(merged.map((i) => i.externalId)).toEqual(["b", "a", "c"]);
  });

  it("passes through original order when there is no cached ranking", () => {
    expect(mergeRankedKeysOrder(items, []).map((i) => i.externalId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("FakeLlmRanker + degrade pattern", () => {
  const items = [item({ externalId: "a" }), item({ externalId: "b" })];

  it("a successful rank reorders items", async () => {
    const ranker = new FakeLlmRanker(() => [1, 0]);
    const ranked = await ranker.rank(items, "anything");
    expect(mergeRankedOrder(items, ranked).map((i) => i.externalId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("a thrown error is the caller's signal to degrade to chronological order", async () => {
    const ranker = new FakeLlmRanker(() => {
      throw new Error("model unavailable");
    });
    await expect(ranker.rank(items, "anything")).rejects.toThrow(
      "model unavailable",
    );
  });
});
