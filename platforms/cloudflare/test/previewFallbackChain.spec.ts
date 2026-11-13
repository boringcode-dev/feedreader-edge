import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewFallbackInput } from "../../../core/preview.ts";
import type { Env } from "../src/env.d.ts";
import { createPreviewFallback } from "../src/previewFallbackChain.ts";

const HTML_INPUT: PreviewFallbackInput = {
  kind: "no_content",
  url: "https://example.com/posts/shell",
  contentType: "text/html; charset=utf-8",
  html: "<html><body><div id=\"root\"></div></body></html>",
};

function envWith(
  flags: { ai: string; browser: string },
  toMarkdown: (...args: unknown[]) => Promise<unknown>,
  quickAction: (...args: unknown[]) => Promise<Response>,
): Env {
  return {
    FEEDREADER_AI_PREVIEW_FALLBACK: flags.ai,
    FEEDREADER_BROWSER_PREVIEW_FALLBACK: flags.browser,
    AI: { toMarkdown },
    BROWSER: { quickAction },
  } as unknown as Env;
}

function aiConversion(data: string): Record<string, unknown> {
  return {
    id: "conversion-1",
    name: "article.html",
    mimeType: "text/html",
    format: "markdown",
    tokens: 10,
    data,
  };
}

function browserSuccess(result: string): Response {
  return Response.json({
    success: true,
    result,
    meta: {
      status: 200,
      title: "Example",
      finalUrl: "https://example.com/posts/shell",
    },
  });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPreviewFallback", () => {
  it("uses the AI fallback first", async () => {
    const toMarkdown = vi.fn(async () =>
      aiConversion(
        "A long enough paragraph recovered from the AI conversion.",
      ),
    );
    const quickAction = vi.fn(async () =>
      browserSuccess("A long enough paragraph rendered by the browser."),
    );
    const fallback = createPreviewFallback(
      envWith({ ai: "true", browser: "true" }, toMarkdown, quickAction),
      "Stored title",
    );

    const result = await fallback?.(HTML_INPUT);

    expect(result?.blocks).toEqual([
      {
        type: "paragraph",
        text: "A long enough paragraph recovered from the AI conversion.",
      },
    ]);
    expect(quickAction).not.toHaveBeenCalled();
  });

  it("falls through to Browser Run when AI returns nothing", async () => {
    const toMarkdown = vi.fn(async () => ({
      id: "conversion-1",
      name: "article.html",
      mimeType: "text/html",
      format: "error",
      error: "no readable content",
    }));
    const quickAction = vi.fn(async () =>
      browserSuccess(
        "A long enough paragraph rendered after JavaScript executes.",
      ),
    );
    const fallback = createPreviewFallback(
      envWith({ ai: "true", browser: "true" }, toMarkdown, quickAction),
      "Stored title",
    );

    const result = await fallback?.(HTML_INPUT);

    expect(toMarkdown).toHaveBeenCalledTimes(1);
    expect(quickAction).toHaveBeenCalledTimes(1);
    expect(result?.blocks).toEqual([
      {
        type: "paragraph",
        text: "A long enough paragraph rendered after JavaScript executes.",
      },
    ]);
  });

  it("can use Browser Run without the AI fallback", async () => {
    const toMarkdown = vi.fn(async () => aiConversion("Unused AI output."));
    const quickAction = vi.fn(async () =>
      browserSuccess("A long enough paragraph rendered by the browser."),
    );
    const fallback = createPreviewFallback(
      envWith({ ai: "false", browser: "true" }, toMarkdown, quickAction),
      "Stored title",
    );

    const result = await fallback?.(HTML_INPUT);

    expect(toMarkdown).not.toHaveBeenCalled();
    expect(quickAction).toHaveBeenCalledTimes(1);
    expect(result?.blocks).toHaveLength(1);
  });

  it("returns undefined when both fallbacks are disabled", () => {
    const fallback = createPreviewFallback(
      envWith(
        { ai: "false", browser: "false" },
        async () => aiConversion("Unused."),
        async () => browserSuccess("Unused."),
      ),
      "Stored title",
    );

    expect(fallback).toBeUndefined();
  });
});
