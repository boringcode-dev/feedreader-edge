import { describe, expect, it } from "vitest";
import type { PreviewBlock } from "../preview.ts";
import { markdownToPreviewBlocks } from "../previewMarkdown.ts";

function blockText(block: PreviewBlock): string {
  if (block.type === "image") return block.alt;
  if (block.type === "table") return block.rows.flat().join(" ");
  if (block.type === "code") return block.text;
  return "segments" in block
    ? block.segments.map((segment) => segment.text).join("")
    : block.text;
}

describe("markdownToPreviewBlocks", () => {
  it("maps headings, prose, lists, quotes, code, images, and tables", () => {
    const markdown = `# Edge Caching Deep Dive

Edge caching keeps responses close to users, cutting latency and origin load.

## How it works

The **cache key** includes the [request URL](https://example.com/docs). A hit returns a stored response; a miss runs the origin handler.

- Lower latency
- Fewer origin reads
- [x] Verified

> Cache the edges, not the decisions.

\`\`\`js
const cached = await cache.match(request);
\`\`\`

![Latency chart](https://example.com/chart.png)

| Region | Latency |
| --- | --- |
| US | 20ms |
`;

    const blocks = markdownToPreviewBlocks(markdown, {
      pageUrl: "https://example.com/posts/edge",
      title: "Edge Caching Deep Dive",
    });

    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
      "list",
      "list",
      "list",
      "quote",
      "code",
      "image",
      "table",
    ]);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      text: "Edge caching keeps responses close to users, cutting latency and origin load.",
    });
    expect(blocks[1]).toEqual({ type: "heading", text: "How it works" });
    expect(blocks[2]).toEqual({
      type: "paragraph",
      segments: [
        { text: "The " },
        { text: "cache key", strong: true },
        {
          text: " includes the ",
        },
        { text: "request URL", href: "https://example.com/docs" },
        {
          text: ". A hit returns a stored response; a miss runs the origin handler.",
        },
      ],
    });
    expect(blocks.filter((block) => block.type === "list")).toEqual([
      { type: "list", text: "Lower latency" },
      { type: "list", text: "Fewer origin reads" },
      { type: "list", text: "Verified" },
    ]);
    expect(blocks.find((block) => block.type === "quote")).toEqual({
      type: "quote",
      text: "Cache the edges, not the decisions.",
    });
    expect(blocks.find((block) => block.type === "code")).toEqual({
      type: "code",
      text: "const cached = await cache.match(request);",
    });
    expect(blocks.find((block) => block.type === "image")).toEqual({
      type: "image",
      src: "https://example.com/chart.png",
      alt: "Latency chart",
    });
    expect(blocks.find((block) => block.type === "table")).toEqual({
      type: "table",
      header: true,
      rows: [
        ["Region", "Latency"],
        ["US", "20ms"],
      ],
    });
  });

  it("drops unsafe links and images while keeping readable text", () => {
    const markdown = `This paragraph has a [dangerous link](javascript:alert(1)) and a [private link](http://127.0.0.1/admin) plus a [safe link](https://example.com/ok) for context.

![Private image](http://127.0.0.1/private.png)
![Badge](https://img.shields.io/badge/build-passing.svg)
![Relative chart](/images/chart.png)
`;

    const blocks = markdownToPreviewBlocks(markdown, {
      pageUrl: "https://example.com/posts/unsafe",
    });

    const paragraph = blocks.find((block) => block.type === "paragraph");
    expect(paragraph).toBeDefined();
    if (
      paragraph?.type !== "paragraph" ||
      !("segments" in paragraph)
    ) {
      throw new Error("expected a rich paragraph");
    }
    expect(
      paragraph.segments
        .map((segment) => segment.href)
        .filter((href) => href !== undefined),
    ).toEqual(["https://example.com/ok"]);
    expect(paragraph.segments.map((segment) => segment.text).join("")).toContain(
      "dangerous link",
    );

    expect(blocks.filter((block) => block.type === "image")).toEqual([
      {
        type: "image",
        src: "https://example.com/images/chart.png",
        alt: "Relative chart",
      },
    ]);
  });

  it("extracts inline images as figure blocks", () => {
    const markdown = `This paragraph is long enough to pass the minimum length check and contains ![Latency chart](https://example.com/chart.png) an inline figure plus enough trailing words.`;

    const blocks = markdownToPreviewBlocks(markdown, {
      pageUrl: "https://example.com/posts/inline-image",
    });

    expect(blocks.map((block) => block.type)).toEqual(["image", "paragraph"]);
    expect(blocks[0]).toEqual({
      type: "image",
      src: "https://example.com/chart.png",
      alt: "Latency chart",
    });
    expect(blockText(blocks[1]!)).not.toContain("chart.png");
    expect(blockText(blocks[1]!)).not.toContain("Latency chart");
  });

  it("strips JSON-LD appended by the HTML converter", () => {
    const markdown = `A long enough article paragraph that should remain in the preview.

{"@context":"https://schema.org","@type":"Article","headline":"A story"}`;

    const blocks = markdownToPreviewBlocks(markdown, {
      pageUrl: "https://example.com/posts/json-ld",
    });

    expect(blocks).toEqual([
      {
        type: "paragraph",
        text: "A long enough article paragraph that should remain in the preview.",
      },
    ]);
  });

  it("strips a fenced JSON-LD block but keeps ordinary JSON code", () => {
    const markdown = `A long enough article paragraph that should remain in the preview.

\`\`\`json
{"@context":"https://schema.org","@type":"Article"}
\`\`\`
`;

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/json-ld-fenced",
      }).map((block) => block.type),
    ).toEqual(["paragraph"]);

    const ordinary = `\`\`\`json
{"enabled":true}
\`\`\``;
    expect(
      markdownToPreviewBlocks(ordinary, {
        pageUrl: "https://example.com/posts/json-code",
      }),
    ).toEqual([{ type: "code", text: '{"enabled":true}' }]);
  });

  it("skips a heading that repeats the stored title", () => {
    const markdown = `# Same Title

A long enough paragraph that should remain in the preview.`;

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/title",
        title: "Same Title",
      }).map((block) => block.type),
    ).toEqual(["paragraph"]);

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/title",
      })[0],
    ).toEqual({ type: "heading", text: "Same Title" });
  });

  it("does not interpret Markdown inside fenced code", () => {
    const markdown = `\`\`\`md
# Not a heading
**not bold**
\`\`\``;

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/code",
      }),
    ).toEqual([
      { type: "code", text: "# Not a heading\n**not bold**" },
    ]);
  });

  it("supports autolinks and avoids emphasis inside snake_case", () => {
    const markdown =
      "Read <https://example.com/docs> and use snake_case_name in this long enough paragraph.";

    const blocks = markdownToPreviewBlocks(markdown, {
      pageUrl: "https://example.com/posts/autolink",
    });

    expect(blocks).toHaveLength(1);
    const paragraph = blocks[0];
    if (
      paragraph?.type !== "paragraph" ||
      !("segments" in paragraph)
    ) {
      throw new Error("expected a rich paragraph");
    }
    expect(paragraph.segments).toContainEqual({
      text: "https://example.com/docs",
      href: "https://example.com/docs",
    });
    expect(paragraph.segments.some((segment) => segment.strong)).toBe(false);
    expect(paragraph.segments.some((segment) => segment.em)).toBe(false);
  });

  it("handles escaped pipes in tables", () => {
    const markdown = `| Name | Value |
| --- | --- |
| a \\| b | 1 |`;

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/table",
      }),
    ).toEqual([
      {
        type: "table",
        header: true,
        rows: [
          ["Name", "Value"],
          ["a | b", "1"],
        ],
      },
    ]);
  });

  it("unescapes Markdown punctuation and decodes entities", () => {
    const markdown =
      "Use \\[brackets\\] and \\*stars\\* &hellip; in this long enough paragraph.";

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/escaped",
      }),
    ).toEqual([
      {
        type: "paragraph",
        text: "Use [brackets] and *stars* … in this long enough paragraph.",
      },
    ]);
  });

  it("does not mistake other trailing JSON for JSON-LD", () => {
    const markdown = '{"Content-Type":["text/html"],"X-Test":["ignore"]}';

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/plain-json",
      }),
    ).toEqual([{ type: "paragraph", text: markdown }]);
  });

  it("strips YAML frontmatter returned by Browser Run", () => {
    const markdown = `---
title: "TodoMVC: React"
meta:
  description: "A TodoMVC written in React."
---

### Rendered

A long enough paragraph rendered after JavaScript executes.`;

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/rendered",
      }),
    ).toEqual([
      { type: "heading", text: "Rendered" },
      {
        type: "paragraph",
        text: "A long enough paragraph rendered after JavaScript executes.",
      },
    ]);
  });

  it("does not treat horizontal rules as frontmatter", () => {
    const markdown = `---

A long enough paragraph that stays after the first rule.

---

Another long enough paragraph after the second rule.`;

    expect(
      markdownToPreviewBlocks(markdown, {
        pageUrl: "https://example.com/posts/rules",
      }),
    ).toEqual([
      {
        type: "paragraph",
        text: "A long enough paragraph that stays after the first rule.",
      },
      {
        type: "paragraph",
        text: "Another long enough paragraph after the second rule.",
      },
    ]);
  });

  it("returns no blocks for empty or JSON-LD-only input", () => {
    expect(
      markdownToPreviewBlocks("", {
        pageUrl: "https://example.com/posts/empty",
      }),
    ).toEqual([]);
    expect(
      markdownToPreviewBlocks('{"@context":"https://schema.org"}', {
        pageUrl: "https://example.com/posts/json-only",
      }),
    ).toEqual([]);
  });
});
