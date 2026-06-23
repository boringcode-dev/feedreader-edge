// Ports the per-source card-brief switch in internal/service/service.go
// (cardBriefPrefix/cardBriefSuffix/cardStatFragments) for each source.
import { describe, expect, it } from "vitest";
import type { FeedItem, SourceSnapshot } from "../domain.ts";
import { FakeEmbedder } from "../personalize/test/fakeEmbedder.ts";
import { itemKey } from "../personalize/rank.ts";
import { buildCards, buildErrors, refreshOne } from "../service.ts";
import { FakeFeedRepository } from "./fakeFeedRepository.ts";
import type { Source } from "../sources/index.ts";

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
    const [card] = buildCards(
      [item({ score: 1234, metadata: { comments_count: 56 } })],
      0,
    );
    expect(card!.brief).toBe("1234 points · 56 comments");
    expect(card!.host).toBe("example.com");
    expect(card!.index).toBe(1);
  });

  it("formats github stars/today/forks with thousands separators and a fallback suffix", () => {
    const [card] = buildCards(
      [
        item({
          source: "github",
          metadata: {
            total_stars: 12345,
            stars_today: 67,
            forks: 8,
            language: "Go",
          },
        }),
      ],
      0,
    );
    expect(card!.brief).toBe(
      "12,345 stars · 67 today · 8 forks - Trending Go repository on GitHub",
    );
  });

  it("formats huggingface upvotes and falls back to author then a generic suffix", () => {
    const withAuthor = buildCards(
      [item({ source: "huggingface", score: 9, author: "Jane Doe" })],
      0,
    )[0]!;
    expect(withAuthor.brief).toBe("9 upvotes - Jane Doe");

    const withoutAuthor = buildCards(
      [item({ source: "huggingface", score: 9 })],
      0,
    )[0]!;
    expect(withoutAuthor.brief).toBe(
      "9 upvotes - Trending paper on Hugging Face",
    );
  });

  it("formats alphaxiv likes and falls back to author then a generic suffix", () => {
    const withAuthor = buildCards(
      [item({ source: "alphaxiv", score: 86, author: "Jane Doe" })],
      0,
    )[0]!;
    expect(withAuthor.brief).toBe("86 likes - Jane Doe");

    const withoutAuthor = buildCards(
      [item({ source: "alphaxiv", score: 86 })],
      0,
    )[0]!;
    expect(withoutAuthor.brief).toBe("86 likes - Trending paper on alphaXiv");
  });

  it("prefers a real summary over the generic suffix when present", () => {
    const [card] = buildCards(
      [item({ source: "github", summary: "A real description." })],
      0,
    );
    expect(card!.brief).toBe("A real description.");
  });
});

describe("buildErrors", () => {
  it("only includes snapshots with a non-empty last error", () => {
    const snapshots: SourceSnapshot[] = [
      {
        source: "github",
        label: "GitHub Trending",
        homepageUrl: "",
        itemCount: 0,
        items: [],
        lastError: "boom",
      },
      {
        source: "hackernews",
        label: "Hacker News",
        homepageUrl: "",
        itemCount: 0,
        items: [],
        lastError: "",
      },
      {
        source: "alphaxiv",
        label: "alphaXiv",
        homepageUrl: "",
        itemCount: 0,
        items: [],
      },
    ];
    expect(buildErrors(snapshots)).toEqual([
      { source: "github", label: "GitHub Trending", error: "boom" },
    ]);
  });
});

function fakeSource(fetch: () => Promise<FeedItem[]>): Source {
  return {
    key: () => "hackernews",
    label: () => "Hacker News",
    homepageUrl: () => "https://news.ycombinator.com",
    fetch,
  };
}

describe("refreshOne with embeddings", () => {
  it("embeds only items that don't already have a stored embedding", async () => {
    const fresh = item({ externalId: "fresh", title: "fresh item" });
    const stale = item({ externalId: "stale", title: "stale item" });
    const repo = new FakeFeedRepository([
      { source: "hackernews", externalId: "stale" },
    ]);
    const embedder = new FakeEmbedder((texts) => texts.map(() => [1, 0]));

    const outcome = await refreshOne(
      fakeSource(async () => [fresh, stale]),
      repo,
      embedder,
    );

    expect(outcome.ok).toBe(true);
    expect(embedder.calls).toEqual([["fresh item"]]);
    expect(repo.saveSnapshotCalls).toHaveLength(1);
    const embeddings = repo.saveSnapshotCalls[0]!.embeddings;
    expect(embeddings.has(itemKey(fresh))).toBe(true);
    expect(embeddings.has(itemKey(stale))).toBe(false);
  });

  it("still saves the snapshot when the embedder throws, with an empty embeddings map", async () => {
    const repo = new FakeFeedRepository();
    const embedder = new FakeEmbedder(() => {
      throw new Error("model unavailable");
    });

    const outcome = await refreshOne(
      fakeSource(async () => [item({ externalId: "a" })]),
      repo,
      embedder,
    );

    expect(outcome.ok).toBe(true);
    expect(repo.saveSnapshotCalls).toHaveLength(1);
    expect(repo.saveSnapshotCalls[0]!.embeddings.size).toBe(0);
  });

  it("short-circuits before any embed call when the source fetch fails", async () => {
    const repo = new FakeFeedRepository();
    const embedder = new FakeEmbedder(() => [[1, 0]]);

    const outcome = await refreshOne(
      fakeSource(async () => {
        throw new Error("network down");
      }),
      repo,
      embedder,
    );

    expect(outcome.ok).toBe(false);
    expect(embedder.calls).toHaveLength(0);
    expect(repo.saveSnapshotCalls).toHaveLength(0);
  });
});
