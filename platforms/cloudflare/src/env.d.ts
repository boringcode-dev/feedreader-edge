export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Service binding to this same Worker — used to fan out per-source
   * refreshes as fresh invocations (fresh 10ms CPU budget each), instead of
   * a public-internet self-fetch that would need a known hostname. */
  SELF: Fetcher;
  /** Workers AI binding backing the "For You" LlmRanker — see
   * platforms/cloudflare/src/llmRanker.ts. No secret needed. */
  AI: Ai;
  REFRESH_SECRET: string;
  APP_VERSION?: string;
  FEEDREADER_ITEMS_PER_SOURCE?: string;
  FEEDREADER_USER_AGENT?: string;
  FEEDREADER_PERSONALIZE_POOL_SIZE?: string;
}
