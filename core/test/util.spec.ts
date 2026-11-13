// Ports internal/sources/http_test.go's three getWithRetry cases.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWithRetry,
  readHttpErrorDetail,
  readLimitedText,
} from "../sources/util.ts";

describe("getWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a transport error", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("connection reset by peer");
      return new Response("ok", { status: 200 });
    });

    const promise = getWithRetry("https://example.com");
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(attempts).toBe(3);
    expect(response.status).toBe(200);
  });

  it("retries a retryable status", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      const status = attempts === 2 ? 200 : 502;
      return new Response(String(status), { status });
    });

    const promise = getWithRetry("https://example.com");
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(attempts).toBe(2);
    expect(response.status).toBe(200);
  });

  it("does not retry a non-retryable status", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      return new Response("missing", { status: 404 });
    });

    const response = await getWithRetry("https://example.com");

    expect(attempts).toBe(1);
    expect(response.status).toBe(404);
  });

  it("sends descriptive source headers", async () => {
    let headers: Headers | undefined;
    vi.stubGlobal(
      "fetch",
      async (_input: unknown, init?: RequestInit) => {
        headers = new Headers(init?.headers);
        return new Response("ok", { status: 200 });
      },
    );

    await getWithRetry("https://example.com");

    expect(headers?.get("user-agent")).toContain("feedreader/0.1");
    expect(headers?.get("accept")).toContain("application/json");
  });

  it("honors Retry-After on a 429", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("limited", {
            status: 429,
            headers: { "retry-after": "1" },
          })
        : new Response("ok", { status: 200 });
    });

    const promise = getWithRetry("https://example.com");
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(attempts).toBe(2);
    expect(response.status).toBe(200);
  });
});

describe("readHttpErrorDetail", () => {
  it("replaces an HTML error page with a fixed message", async () => {
    const detail = await readHttpErrorDetail(
      new Response("<!doctype html><html><body>blocked</body></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    expect(detail).toBe("upstream returned an HTML error page");
  });

  it("returns a compact short body for non-HTML errors", async () => {
    const detail = await readHttpErrorDetail(
      new Response('{\n  "error": "rate limited"\n}', {
        headers: { "content-type": "application/json" },
      }),
    );

    expect(detail).toBe('{ "error": "rate limited" }');
  });
});

describe("readLimitedText", () => {
  it("reads only the requested prefix of a body", async () => {
    const text = await readLimitedText(new Response("abcdefghij"), 4);

    expect(text).toBe("abcd");
  });
});
