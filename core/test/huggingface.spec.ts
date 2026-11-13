import { describe, expect, it } from "vitest";
import { parseHuggingFaceDailyPapers } from "../sources/huggingface.ts";

describe("parseHuggingFaceDailyPapers", () => {
  it("extracts papers from the daily papers API entries", () => {
    const entries = [
      {
        id: "2606.00001",
        title: "A Paper Title",
        summary: "A short summary.",
        numComments: 4,
        publishedAt: "2026-06-20T00:00:00.000Z",
        submittedBy: { fullname: "Jane Doe", name: "janedoe" },
        paper: {
          id: "2606.00001",
          title: "A Paper Title",
          summary: "A short summary.",
          publishedAt: "2026-06-20T00:00:00.000Z",
          upvotes: 12,
          numComments: null,
          authors: [{ name: "Jane Doe" }, { name: "John Roe" }],
        },
      },
    ];

    const items = parseHuggingFaceDailyPapers(entries);
    expect(items).toHaveLength(1);

    const item = items[0]!;
    expect(item.source).toBe("huggingface");
    expect(item.externalId).toBe("2606.00001");
    expect(item.url).toBe("https://huggingface.co/papers/2606.00001");
    expect(item.title).toBe("A Paper Title");
    expect(item.summary).toBe("A short summary.");
    expect(item.author).toBe("Jane Doe, John Roe");
    expect(item.score).toBe(12);
    expect(item.metadata.comments_count).toBe(4);
    expect(item.metadata.authors).toEqual(["Jane Doe", "John Roe"]);
    expect(item.metadata.submitted_by).toBe("Jane Doe");
    expect(item.sourceRank).toBe(1);
  });

  it("falls back to the paper's comment count and title fields", () => {
    const items = parseHuggingFaceDailyPapers([
      {
        id: "2606.00002",
        paper: {
          id: "2606.00002",
          title: "Paper-only title",
          summary: "Paper-only summary.",
          numComments: 7,
          authors: [{ name: "Alice Smith" }],
        },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Paper-only title");
    expect(items[0]?.summary).toBe("Paper-only summary.");
    expect(items[0]?.metadata.comments_count).toBe(7);
  });

  it("skips entries without a paper id", () => {
    expect(parseHuggingFaceDailyPapers([{}, { paper: {} }])).toEqual([]);
  });
});
