import { describe, expect, it } from "vitest";
import {
  PREVIEW_RATE_LIMIT_PER_MINUTE,
  takePreviewRateLimit,
  type PreviewRateLimitCache,
} from "../src/previewRateLimit.ts";

const NOW_MS = Date.UTC(2026, 0, 1, 0, 0, 30);

function memoryCache(): PreviewRateLimitCache {
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

describe("takePreviewRateLimit", () => {
  it("allows the per-minute limit and blocks the next request", async () => {
    const cache = memoryCache();

    for (let index = 0; index < PREVIEW_RATE_LIMIT_PER_MINUTE; index += 1) {
      expect(
        await takePreviewRateLimit(cache, "203.0.113.7", NOW_MS),
      ).toBe(true);
    }

    expect(
      await takePreviewRateLimit(cache, "203.0.113.7", NOW_MS),
    ).toBe(false);
    // A different client has its own bucket.
    expect(
      await takePreviewRateLimit(cache, "198.51.100.9", NOW_MS),
    ).toBe(true);
    // The next fixed window resets the count.
    expect(
      await takePreviewRateLimit(
        cache,
        "203.0.113.7",
        NOW_MS + 60_000,
      ),
    ).toBe(true);
  });

  it("fails open when the cache is unavailable", async () => {
    const cache: PreviewRateLimitCache = {
      async match(): Promise<Response | null> {
        throw new Error("cache unavailable");
      },
      async put(): Promise<void> {
        throw new Error("cache unavailable");
      },
    };

    expect(await takePreviewRateLimit(cache, "203.0.113.7", NOW_MS)).toBe(
      true,
    );
  });
});
