// Per-IP fixed-window limiter for expensive cache misses. Cached responses
// bypass it; a miss can fetch upstream content and run Workers AI / Browser
// Run, so the limiter protects those quotas from a single client enumerating
// stored articles or varying personalization interests. The Cache API is
// best-effort and per-colo, so this is an abuse speed bump, not a strict
// global quota; failures fail open so a cache outage never breaks requests.

const DEFAULT_WINDOW_MS = 60_000;
export const PREVIEW_RATE_LIMIT_PER_MINUTE = 20;
export const PERSONALIZE_RATE_LIMIT_PER_MINUTE = 10;

export interface RateLimitCache {
  match(request: Request): Promise<Response | null | undefined>;
  put(
    request: Request,
    response: Response,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

export interface RateLimitOptions {
  /** Separate buckets, e.g. "preview" and "personalize". */
  namespace: string;
  limit: number;
  windowMs?: number;
  /** Test seam; defaults to Date.now(). */
  nowMs?: number;
}

export async function takeRateLimit(
  cache: RateLimitCache,
  clientIp: string,
  options: RateLimitOptions,
): Promise<boolean> {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const nowMs = options.nowMs ?? Date.now();
  const window = Math.floor(nowMs / windowMs);
  const key = `rate-limit:v1:${options.namespace}:${clientIp}:${window}`;
  const cacheRequest = new Request(
    `https://feedreader-internal.invalid/rate-limit?k=${encodeURIComponent(key)}`,
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

  if (count >= options.limit) return false;

  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000) * 2);
  try {
    await cache.put(
      cacheRequest,
      new Response(String(count + 1), {
        headers: {
          "Content-Type": "text/plain",
          "Cache-Control": `public, max-age=${ttlSeconds}`,
        },
      }),
      { expirationTtl: ttlSeconds },
    );
  } catch {
    // Fail open; the next request re-checks the previous count.
  }
  return true;
}
