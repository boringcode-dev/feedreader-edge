// Ports internal/sources/http_test.go's three getWithRetry cases.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWithRetry } from "../sources/util.ts";

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
});
