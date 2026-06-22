// No huggingface_test.go exists in the Go repo to port from directly — this
// exercises parseHuggingFacePapers against a synthetic payload shaped like
// the real embedded data-props blob described in huggingface.go.
import { describe, expect, it } from "vitest";
import { parseHuggingFacePapers } from "../sources/huggingface.ts";

describe("parseHuggingFacePapers", () => {
  it("extracts papers from the embedded DailyPapers JSON", () => {
    const props = {
      dailyPapers: [
        {
          id: "2606.00001",
          title: "A Paper Title",
          summary: "A short summary.",
          upvotes: 12,
          publishedAt: "2026-06-20T00:00:00.000Z",
          submittedBy: { fullname: "Jane Doe", name: "janedoe" },
          paper: {
            id: "2606.00001",
            title: "A Paper Title",
            summary: "A short summary.",
            publishedAt: "2026-06-20T00:00:00.000Z",
            upvotes: 12,
            numComments: 4,
            authors: [{ name: "Jane Doe" }, { name: "John Roe" }],
          },
        },
      ],
    };
    const payload = `<div data-target="DailyPapers" data-props="${JSON.stringify(props).replace(/"/g, "&quot;")}"></div>`;

    const items = parseHuggingFacePapers(payload);
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

  it("throws when the DailyPapers payload is missing", () => {
    expect(() => parseHuggingFacePapers("<div>no papers here</div>")).toThrow();
  });
});
