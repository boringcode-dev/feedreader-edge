import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewFallbackInput } from "../../../core/preview.ts";
import type { Env } from "../src/env.d.ts";
import { browserPreviewFallback } from "../src/browserPreviewFallback.ts";

const HTML_INPUT: PreviewFallbackInput = {
  kind: "no_content",
  url: "https://example.com/posts/shell",
  contentType: "text/html; charset=utf-8",
  html: "<html><body><div id=\"root\"></div></body></html>",
};

function envWith(
  flag: string,
  quickAction: (action: string, options: unknown) => Promise<Response>,
): Env {
  return {
    FEEDREADER_BROWSER_PREVIEW_FALLBACK: flag,
    BROWSER: { quickAction },
  } as unknown as Env;
}

function successResponse(
  result: string,
  meta: Record<string, unknown> = {},
): Response {
  return Response.json({
    success: true,
    result,
    meta: {
      status: 200,
      title: "Example",
      finalUrl: "https://example.com/posts/shell",
      ...meta,
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

describe("browserPreviewFallback", () => {
  it("does nothing when the env flag is false", async () => {
    const quickAction = vi.fn(async () => successResponse("Unused."));
    const result = await browserPreviewFallback(
      envWith("false", quickAction),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
    expect(quickAction).not.toHaveBeenCalled();
  });

  it("rejects an unusable input URL before calling Browser Run", async () => {
    const quickAction = vi.fn(async () => successResponse("Unused."));
    const result = await browserPreviewFallback(
      envWith("true", quickAction),
      { ...HTML_INPUT, url: "http://127.0.0.1/private" },
      "Stored title",
    );

    expect(result).toBeNull();
    expect(quickAction).not.toHaveBeenCalled();
  });

  it("only handles no_content HTML failures", async () => {
    const quickAction = vi.fn(async () => successResponse("Unused."));

    for (const kind of ["too_large", "unsupported_content_type"] as const) {
      const result = await browserPreviewFallback(
        envWith("true", quickAction),
        { ...HTML_INPUT, kind },
        "Stored title",
      );
      expect(result).toBeNull();
    }
    expect(quickAction).not.toHaveBeenCalled();
  });

  it("maps rendered Markdown to a preview", async () => {
    const quickAction = vi.fn(
      async (_action: string, _options: unknown) =>
        successResponse(`---
title: "TodoMVC: React"
---

### Rendered

A long enough paragraph rendered after JavaScript executes.`),
    );

    const result = await browserPreviewFallback(
      envWith("true", quickAction),
      HTML_INPUT,
      "Stored title",
    );

    expect(quickAction).toHaveBeenCalledWith(
      "markdown",
      expect.objectContaining({
        url: HTML_INPUT.url,
        gotoOptions: expect.objectContaining({
          waitUntil: "networkidle2",
        }),
        bestAttempt: true,
        rejectResourceTypes: ["image", "media", "font"],
      }),
    );

    const options = quickAction.mock.calls[0]?.[1] as {
      rejectRequestPattern?: string[];
    };
    const pattern = options.rejectRequestPattern?.[0];
    expect(pattern).toBeDefined();
    const privateHost = new RegExp(
      pattern!.slice(1, pattern!.lastIndexOf("/")),
    );
    expect(privateHost.test("http://127.0.0.1/x")).toBe(true);
    expect(privateHost.test("http://[::ffff:127.0.0.1]/x")).toBe(true);
    expect(privateHost.test("https://metadata.google.internal/")).toBe(true);
    expect(privateHost.test("https://example.com/x")).toBe(false);

    expect(result).toMatchObject({
      title: "Stored title",
      siteName: "example.com",
      readingMinutes: 1,
      blocks: [
        { type: "heading", text: "Rendered" },
        {
          type: "paragraph",
          text: "A long enough paragraph rendered after JavaScript executes.",
        },
      ],
    });
  });

  it("rejects a final URL that is not public", async () => {
    const quickAction = vi.fn(async () =>
      successResponse("A long enough paragraph from a private redirect.", {
        finalUrl: "http://127.0.0.1/internal",
      }),
    );

    const result = await browserPreviewFallback(
      envWith("true", quickAction),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
  });

  it("rejects a redirect chain that reaches a private host", async () => {
    const quickAction = vi.fn(async () =>
      successResponse("A long enough paragraph after a redirect.", {
        redirectChain: [
          {
            url: "https://example.com/start",
            status: 302,
            headers: { location: "http://127.0.0.1/internal" },
          },
        ],
      }),
    );

    const result = await browserPreviewFallback(
      envWith("true", quickAction),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
  });

  it("returns null on a rate-limit error", async () => {
    const quickAction = vi.fn(async () =>
      Response.json(
        {
          success: false,
          errors: [{ code: 2001, message: "Rate limit exceeded" }],
        },
        { status: 429 },
      ),
    );

    const result = await browserPreviewFallback(
      envWith("true", quickAction),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
  });

  it("returns null when the rendered page itself is an error", async () => {
    const quickAction = vi.fn(async () =>
      successResponse("Not found. A long enough paragraph of error text.", {
        status: 404,
      }),
    );

    const result = await browserPreviewFallback(
      envWith("true", quickAction),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
  });

  it("returns null when the rendered page has no readable blocks", async () => {
    const quickAction = vi.fn(async () => successResponse("tiny"));

    const result = await browserPreviewFallback(
      envWith("true", quickAction),
      HTML_INPUT,
      "Stored title",
    );

    expect(result).toBeNull();
  });
});
