// Per-IP fixed-window limiter for expensive /api/preview cache misses.
// Cached previews bypass it; a miss can fetch an upstream article and run
// Workers AI / Browser Run, so the limiter protects those quotas from a
// single client enumerating the stored feed. The Cache API is best-effort
// and per-colo, so this is an abuse speed bump, not a strict global quota;
// failures fail open so a cache outage never breaks previews.

const WINDOW_MS = 60_000;
const CACHE_TTL_SECONDS = 120;
export const PREVIEW_RATE_LIMIT_PER_MINUTE = 20;

export interface PreviewRateLimitCache {
  match(request: Request): Promise<Response | null | undefined>;
  put(
    request: Request,
    response: Response,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export async function takePreviewRateLimit(
  cache: PreviewRateLimitCache,
  clientIp: string,
  nowMs = Date.now(),
): Promise<boolean> {
  const window = Math.floor(nowMs / WINDOW_MS);
  const key = `preview-rate:v1:${clientIp}:${window}`;
  const cacheRequest = new Request(
    `https://feedreader-internal.invalid/preview-rate?k=${encodeURIComponent(key)}`,
    { method: "GET" },
  );

  let count = 0;
  try {
    const cached = await cache.match(cacheRequest);
    if (cached) {
      const parsed = Number.parseInt(await cached.text(), 10);
      if (Number.isFinite(parsed) && parsed >= 0) count = parsed;
    }
  } catch {
    count = 0;
  }

  if (count >= PREVIEW_RATE_LIMIT_PER_MINUTE) return false;

  try {
    await cache.put(
      cacheRequest,
      new Response(String(count + 1), {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      }),
      { expirationTtl: CACHE_TTL_SECONDS },
    );
  } catch {
    // Fail open; the next request re-checks the previous count.
  }
  return true;
}
