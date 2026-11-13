import { describe, expect, it } from "vitest";
import {
  PREVIEW_RATE_LIMIT_PER_MINUTE,
  takeRateLimit,
  type RateLimitCache,
} from "../src/rateLimit.ts";

const NOW_MS = Date.UTC(2026, 0, 1, 0, 0, 30);

function memoryCache(): RateLimitCache {
  const entries = new Map<string, string>();
  return {
    async match(request: Request): Promise<Response | null> {
      const body = entries.get(request.url);
      return body === undefined ? null : new Response(body);
    },
    async put(request: Request, response: Response): Promise<void> {
      entries.set(request.url, await response.text());
    },
  };
}

function previewOptions(nowMs = NOW_MS) {
  return {
    namespace: "preview",
    limit: PREVIEW_RATE_LIMIT_PER_MINUTE,
    nowMs,
  };
}

describe("takeRateLimit", () => {
  it("allows the per-minute limit and blocks the next request", async () => {
    const cache = memoryCache();

    for (let index = 0; index < PREVIEW_RATE_LIMIT_PER_MINUTE; index += 1) {
      expect(
        await takeRateLimit(cache, "203.0.113.7", previewOptions()),
      ).toBe(true);
    }

    expect(await takeRateLimit(cache, "203.0.113.7", previewOptions())).toBe(
      false,
    );
    // A different client has its own bucket.
    expect(await takeRateLimit(cache, "198.51.100.9", previewOptions())).toBe(
      true,
    );
    // The next fixed window resets the count.
    expect(
      await takeRateLimit(
        cache,
        "203.0.113.7",
        previewOptions(NOW_MS + 60_000),
      ),
    ).toBe(true);
  });

  it("keeps namespaces in separate buckets", async () => {
    const cache = memoryCache();
    const ip = "203.0.113.7";

    expect(
      await takeRateLimit(cache, ip, {
        namespace: "preview",
        limit: 1,
        nowMs: NOW_MS,
      }),
    ).toBe(true);
    expect(
      await takeRateLimit(cache, ip, {
        namespace: "preview",
        limit: 1,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
    expect(
      await takeRateLimit(cache, ip, {
        namespace: "personalize",
        limit: 1,
        nowMs: NOW_MS,
      }),
    ).toBe(true);
  });

  it("fails open when the cache is unavailable", async () => {
    const cache: RateLimitCache = {
      async match(): Promise<Response | null> {
        throw new Error("cache unavailable");
      },
      async put(): Promise<void> {
        throw new Error("cache unavailable");
      },
    };

    expect(await takeRateLimit(cache, "203.0.113.7", previewOptions())).toBe(
      true,
    );
  });
});
