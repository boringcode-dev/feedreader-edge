import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewFallbackInput } from "../../../core/preview.ts";
import type { Env } from "../src/env.d.ts";
import { aiPreviewFallback } from "../src/previewFallback.ts";

const HTML_INPUT: PreviewFallbackInput = {
  kind: "no_content",
  url: "https://example.com/posts/shell",
  contentType: "text/html; charset=utf-8",
  html: "<html><body><div id=\"root\"></div></body></html>",
};

const PDF_INPUT: PreviewFallbackInput = {
  kind: "unsupported_content_type",
  url: "https://example.com/paper.pdf",
  contentType: "application/pdf",
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
};

function envWith(
  value: string,
  toMarkdown: (...args: unknown[]) => Promise<unknown>,
): Env {
  return {
    FEEDREADER_AI_PREVIEW_FALLBACK: value,
    AI: { toMarkdown },
  } as unknown as Env;
}

function conversion(data: string, tokens = 10): Record<string, unknown> {
  return {
    id: "conversion-1",
    name: "article.html",
    mimeType: "text/html",
    format: "markdown",
    tokens,
    data,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("aiPreviewFallback", () => {
  it("does nothing when the env flag is false", async () => {
    const toMarkdown = vi.fn(async () => conversion("Unused content."));
    const result = await aiPreviewFallback(
      envWith("false", toMarkdown),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it("maps HTML conversion output and strips trailing JSON-LD", async () => {
    const toMarkdown = vi.fn(async () =>
      conversion(
        "A long enough paragraph recovered from the converted page.\n\n" +
          '{"@context":"https://schema.org","@type":"Article"}',
        42,
      ),
    );

    const result = await aiPreviewFallback(
      envWith("true", toMarkdown),
      HTML_INPUT,
      "Stored title",
    );

    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      title: "Stored title",
      siteName: "example.com",
      readingMinutes: 1,
      blocks: [
        {
          type: "paragraph",
          text: "A long enough paragraph recovered from the converted page.",
        },
      ],
    });
  });

  it("drops PDF filename and page-marker headings", async () => {
    const toMarkdown = vi.fn(async () =>
      conversion(
        [
          "# article.pdf",
          "# Page 1",
          "A long enough paragraph from the first page of the paper.",
          "# Page 2",
          "Another long enough paragraph from the second page of the paper.",
        ].join("\n\n"),
        120,
      ),
    );

    const result = await aiPreviewFallback(
      envWith("true", toMarkdown),
      PDF_INPUT,
      "A Paper",
    );

    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect(result?.blocks).toEqual([
      {
        type: "paragraph",
        text: "A long enough paragraph from the first page of the paper.",
      },
      {
        type: "paragraph",
        text: "Another long enough paragraph from the second page of the paper.",
      },
    ]);
  });

  it("skips standalone images without calling the AI service", async () => {
    const toMarkdown = vi.fn(async () => conversion("Unused content."));
    const result = await aiPreviewFallback(
      envWith("true", toMarkdown),
      {
        kind: "unsupported_content_type",
        url: "https://example.com/figure.png",
        contentType: "image/png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      },
      "A figure",
    );

    expect(result).toBeNull();
    expect(toMarkdown).not.toHaveBeenCalled();
  });

  it("returns null when the AI conversion reports an error", async () => {
    const toMarkdown = vi.fn(async () => ({
      id: "conversion-1",
      name: "article.bin",
      mimeType: "application/octet-stream",
      format: "error",
      error: "unsupported file type",
    }));

    const result = await aiPreviewFallback(
      envWith("true", toMarkdown),
      PDF_INPUT,
      "A Paper",
    );

    expect(result).toBeNull();
  });

  it("returns null when the AI call throws", async () => {
    const toMarkdown = vi.fn(async () => {
      throw new Error("AI unavailable");
    });

    const result = await aiPreviewFallback(
      envWith("true", toMarkdown),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
  });
});
