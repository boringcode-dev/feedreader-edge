// Ports the per-source card-brief switch in internal/service/service.go
// (cardBriefPrefix/cardBriefSuffix/cardStatFragments) for each source.
import { describe, expect, it } from "vitest";
import type { FeedItem, SourceSnapshot } from "../domain.ts";
import { buildCards, buildErrors } from "../service.ts";

function item(overrides: Partial<FeedItem>): FeedItem {
  return {
    source: "hackernews",
    externalId: "1",
    title: "title",
    url: "https://example.com/a/b",
    sourceRank: 1,
    metadata: {},
    ...overrides,
  };
}

describe("buildCards", () => {
  it("formats hackernews points and comments", () => {
    const [card] = buildCards([item({ score: 1234, metadata: { comments_count: 56 } })], 0);
    expect(card!.brief).toBe("1234 points · 56 comments");
    expect(card!.host).toBe("example.com");
    expect(card!.index).toBe(1);
  });

  it("formats github stars/today/forks with thousands separators and a fallback suffix", () => {
    const [card] = buildCards(
      [item({ source: "github", metadata: { total_stars: 12345, stars_today: 67, forks: 8, language: "Go" } })],
      0,
    );
    expect(card!.brief).toBe("12,345 stars · 67 today · 8 forks - Trending Go repository on GitHub");
  });

  it("formats huggingface upvotes and falls back to author then a generic suffix", () => {
    const withAuthor = buildCards([item({ source: "huggingface", score: 9, author: "Jane Doe" })], 0)[0]!;
    expect(withAuthor.brief).toBe("9 upvotes - Jane Doe");

    const withoutAuthor = buildCards([item({ source: "huggingface", score: 9 })], 0)[0]!;
    expect(withoutAuthor.brief).toBe("9 upvotes - Trending paper on Hugging Face");
  });

  it("formats alphaxiv likes and falls back to author then a generic suffix", () => {
    const withAuthor = buildCards([item({ source: "alphaxiv", score: 86, author: "Jane Doe" })], 0)[0]!;
    expect(withAuthor.brief).toBe("86 likes - Jane Doe");

    const withoutAuthor = buildCards([item({ source: "alphaxiv", score: 86 })], 0)[0]!;
    expect(withoutAuthor.brief).toBe("86 likes - Trending paper on alphaXiv");
  });

  it("prefers a real summary over the generic suffix when present", () => {
    const [card] = buildCards([item({ source: "github", summary: "A real description." })], 0);
    expect(card!.brief).toBe("A real description.");
  });
});

describe("buildErrors", () => {
  it("only includes snapshots with a non-empty last error", () => {
    const snapshots: SourceSnapshot[] = [
      { source: "github", label: "GitHub Trending", homepageUrl: "", itemCount: 0, items: [], lastError: "boom" },
      { source: "hackernews", label: "Hacker News", homepageUrl: "", itemCount: 0, items: [], lastError: "" },
      { source: "alphaxiv", label: "alphaXiv", homepageUrl: "", itemCount: 0, items: [] },
    ];
    expect(buildErrors(snapshots)).toEqual([{ source: "github", label: "GitHub Trending", error: "boom" }]);
  });
});
