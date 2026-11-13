import { describe, expect, it } from "vitest";
import {
  PREVIEW_CACHE_TTL_SECONDS,
  PREVIEW_EMPTY_CACHE_TTL_SECONDS,
  previewCacheTtlSeconds,
} from "../src/previewCachePolicy.ts";

describe("previewCacheTtlSeconds", () => {
  it("caches empty results for the short TTL", () => {
    expect(previewCacheTtlSeconds(0)).toBe(PREVIEW_EMPTY_CACHE_TTL_SECONDS);
    expect(PREVIEW_EMPTY_CACHE_TTL_SECONDS).toBe(300);
  });

  it("caches content for the normal TTL", () => {
    expect(previewCacheTtlSeconds(1)).toBe(PREVIEW_CACHE_TTL_SECONDS);
    expect(previewCacheTtlSeconds(100)).toBe(PREVIEW_CACHE_TTL_SECONDS);
    expect(PREVIEW_CACHE_TTL_SECONDS).toBe(1800);
  });
});
