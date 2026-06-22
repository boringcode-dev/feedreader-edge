// Mirrors internal/sources/hackernews_test.go's fixture and assertions.
import { describe, expect, it } from "vitest";
import { parseHackerNews } from "../sources/hackernews.ts";

describe("parseHackerNews", () => {
  it("parses the front page payload", () => {
    const items = parseHackerNews({
      hits: [
        {
          objectID: "123",
          title: "Example story",
          url: "https://example.com/story",
          author: "alice",
          points: 42,
          num_comments: 11,
          created_at: "2026-06-21T12:44:13Z",
          story_text: "<p>Example &amp; summary.</p>",
        },
        {
          objectID: "456",
          title: "Ask HN: Fallback URL",
          author: "bob",
          points: 7,
          num_comments: 3,
          created_at: "2026-06-21T13:00:00Z",
        },
      ],
    });

    expect(items).toHaveLength(2);

    const [first, second] = items;
    expect(first!.source).toBe("hackernews");
    expect(first!.externalId).toBe("123");
    expect(first!.title).toBe("Example story");
    expect(first!.url).toBe("https://example.com/story");
    expect(first!.author).toBe("alice");
    expect(first!.score).toBe(42);
    expect(first!.summary).toBe("Example & summary.");
    expect(first!.commentsUrl).toBe("https://news.ycombinator.com/item?id=123");
    expect(first!.metadata.comments_count).toBe(11);
    expect(first!.publishedAt).toBe(new Date("2026-06-21T12:44:13Z").toISOString());
    expect(first!.sourceRank).toBe(1);

    expect(second!.url).toBe("https://news.ycombinator.com/item?id=456");
    expect(second!.commentsUrl).toBe("https://news.ycombinator.com/item?id=456");
  });
});
