// Worker entrypoint. Route surface mirrors internal/web/web.go exactly.
// Static assets (/static/*, /favicon.svg, /site.webmanifest, ...) are
// served by the [assets] binding before any request reaches fetch() below
// — see wrangler.toml and docs/RUNBOOK.md.

import type { CardView, RefreshOutcome, SyncState } from "../../../core/domain.ts";
import {
  buildCards,
  buildErrors,
  dashboard,
  feedItems,
  healthPayload,
  refreshOne,
} from "../../../core/service.ts";
import { build, type Source } from "../../../core/sources/index.ts";
import { renderIndexPage } from "../../../core/render.ts";
import {
  MAX_INTERESTS_LENGTH,
  itemKey,
  mergeRankedKeysOrder,
  mergeRankedOrder,
} from "../../../core/personalize/rank.ts";
import { rankBySimilarity } from "../../../core/personalize/similarity.ts";
import { paginate } from "../../../core/sources/listInMemory.ts";
import { D1Repository } from "./repository.ts";
import { CloudflareLlmRanker } from "./llmRanker.ts";
import { CloudflareEmbedder } from "./embedder.ts";
import type { Env } from "./env.d.ts";

const PAGE_SIZE = 12;
const KNOWN_SOURCES = new Set([
  "hackernews",
  "github",
  "huggingface",
  "alphaxiv",
]);

// Ranking the LLM sees is capped (cheap prompt, see env var below); pagination
// is served from a larger in-memory pool. 500 mirrors the "dataset is small"
// assumption already baked into D1Repository.listFeedItems/countTotalItems.
const PERSONALIZE_FULL_POOL_LIMIT = 500;
// Backstop only — the cache key already changes whenever the underlying
// source data refreshes (see latestSuccessAt below), so this just bounds
// staleness if a source somehow stops refreshing.
const PERSONALIZE_CACHE_TTL_SECONDS = 21600;
// Backstop only — the cache key already changes whenever the underlying
// source data refreshes (see latestSuccessAt), so this just bounds
// staleness if a source somehow stops refreshing.
const ITEMS_CACHE_TTL_SECONDS = 21600;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const repo = new D1Repository(env.DB);
    const sources = build();

    if (url.pathname === "/") return handleHome(url, env, repo);
    if (url.pathname === "/healthz") return handleHealthz(sources, repo);
    if (url.pathname === "/api/items") return handleItemsApi(url, repo);
    if (url.pathname === "/api/version") return handleVersion(env);
    if (url.pathname === "/api/personalize") {
      if (request.method !== "POST") {
        return new Response("method not allowed", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }
      return handlePersonalize(request, env, repo);
    }
    if (url.pathname === "/api/refresh") {
      if (request.method !== "POST") {
        return new Response("method not allowed", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }
      return handleRefresh(env, sources);
    }
    if (url.pathname.startsWith("/internal/refresh/")) {
      return handleInternalRefresh(request, env, repo, sources, url);
    }
    return new Response("not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await fanOutRefresh(env, build());
  },
};

async function handleHome(
  url: URL,
  env: Env,
  repo: D1Repository,
): Promise<Response> {
  const protocolAction = normalizeProtocolAction(url.searchParams.get("open"));
  const source = normalizeSource(
    url.searchParams.get("source") ?? protocolAction.source,
  );
  const searchQuery = normalizeSearchQuery(
    url.searchParams.get("q") ?? protocolAction.query,
  );
  const querySource = source === "all" ? "" : source;
  const canonicalUrl = `${url.origin}${url.pathname}${url.search}`;
  const socialImageUrl = `${url.origin}/og-image.png?v=2`;
  const appVersion = currentAppVersion(env);

  const { items, hasNext } = await feedItems(
    repo,
    PAGE_SIZE,
    0,
    querySource,
    [],
    searchQuery,
  );
  const snapshots = await dashboard(build(), repo, 1);

  const html = renderIndexPage({
    cards: buildCards(items, 0),
    errors: buildErrors(snapshots),
    sourceFilters: buildSourceFilters(source),
    currentSource: source,
    searchQuery,
    searchOpen: searchQuery !== "",
    emptyMessage: buildEmptyMessage(source, searchQuery),
    pageSize: PAGE_SIZE,
    hasNext,
    currentYear: new Date().getUTCFullYear(),
    canonicalUrl,
    socialImageUrl,
    appVersion,
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handleHealthz(
  sources: Source[],
  repo: D1Repository,
): Promise<Response> {
  const payload = await healthPayload(sources, repo);
  return Response.json(payload);
}

/** Lets the client (notably an installed PWA resuming from the background,
 * which never re-runs index.html's inline bootstrap) detect that a new
 * version has been deployed and prompt for a refresh — see
 * web-static/static/app.js's checkForUpdate(). Deliberately uncached: it
 * must always reflect the currently-deployed APP_VERSION. */
function handleVersion(env: Env): Response {
  return Response.json(
    { version: currentAppVersion(env) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function currentAppVersion(env: Env): string {
  return env.APP_VERSION?.trim() || "dev";
}

/**
 * The data backing a given (source filter, search query, page) is fixed
 * until the next source refresh, so the full JSON response can be cached
 * as-is — unlike /api/personalize there's no per-request LLM step to avoid,
 * caching here is just sparing D1 the same paginated read on every poll.
 *
 * The cache key includes latestSuccessAt so it naturally invalidates
 * whenever the underlying sources next refresh (see personalize's same
 * pattern) — no manual purge needed, and `generated_at` in the cached body
 * reflects when that snapshot was actually produced.
 */
async function handleItemsApi(url: URL, repo: D1Repository): Promise<Response> {
  const source = normalizeSource(url.searchParams.get("source") ?? "");
  const searchQuery = normalizeSearchQuery(url.searchParams.get("q") ?? "");
  const selectedSources = normalizeSourceList(
    url.searchParams.get("sources") ?? "",
  );
  let limit = parsePositiveInt(url.searchParams.get("limit"), PAGE_SIZE);
  if (limit > 100) limit = 100;
  const offset = parseNonNegativeInt(url.searchParams.get("offset"), 0);
  const querySource = source === "all" ? "" : source;

  const states = await repo.listSourceStates();
  const freshness = latestSuccessAt(states, querySource, selectedSources);
  const cacheRequest = itemsCacheRequest(
    querySource,
    selectedSources,
    searchQuery,
    limit,
    offset,
    freshness,
  );

  const cached = await readEdgeCache(cacheRequest);
  if (cached) return cached;

  const { items, hasNext } = await feedItems(
    repo,
    limit,
    offset,
    querySource,
    selectedSources,
    searchQuery,
  );
  const cards = buildCards(items, offset);

  const response = Response.json(
    {
      generated_at: new Date().toISOString(),
      source,
      sources: selectedSources,
      query: searchQuery,
      offset,
      limit,
      has_next: hasNext,
      items: cardsToJson(cards),
    },
    { headers: { "Cache-Control": `max-age=${ITEMS_CACHE_TTL_SECONDS}` } },
  );
  await writeEdgeCache(cacheRequest, response.clone());
  return response;
}

/** Latest successful refresh among the sources in scope — used so an edge
 * cache entry (items) and the personalize ranking cache both invalidate
 * themselves whenever new items arrive, without needing an explicit purge. */
function latestSuccessAt(
  states: Record<string, SyncState>,
  source: string,
  sources: string[],
): string {
  const relevant =
    source !== ""
      ? [source]
      : sources.length > 0
        ? sources
        : Array.from(KNOWN_SOURCES);
  let latest = "";
  for (const key of relevant) {
    const at = states[key]?.lastSuccessAt ?? "";
    if (at > latest) latest = at;
  }
  return latest;
}

/** Synthetic GET request used purely as a Cache API key — never fetched.
 * `.invalid` is reserved by RFC 2606 for exactly this kind of placeholder
 * use, so it's guaranteed not to collide with a real host. */
function itemsCacheRequest(
  source: string,
  sources: string[],
  query: string,
  limit: number,
  offset: number,
  freshness: string,
): Request {
  const raw = `items:v1:${source} ${sources.join(",")} ${query} ${limit} ${offset} ${freshness}`;
  const url = `https://feedreader-internal.invalid/items-cache?k=${encodeURIComponent(raw)}`;
  return new Request(url, { method: "GET" });
}

// tsconfig includes the DOM lib (needed for linkedom-based source parsing
// elsewhere), whose own `CacheStorage` type shadows the Workers one and
// lacks `.default` — cast through `unknown` once to recover it.
function defaultEdgeCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

async function readEdgeCache(cacheRequest: Request): Promise<Response | null> {
  try {
    return (await defaultEdgeCache().match(cacheRequest)) ?? null;
  } catch {
    // Cache API is best-effort — any failure here is just a cache miss,
    // never an error.
    return null;
  }
}

async function writeEdgeCache(
  cacheRequest: Request,
  response: Response,
): Promise<void> {
  try {
    await defaultEdgeCache().put(cacheRequest, response);
  } catch {
    // Same as above — a failed write just means the next request re-queries D1.
  }
}

function cardsToJson(cards: CardView[]) {
  return cards.map((card) => ({
    source: card.source,
    index: card.index,
    title: card.title,
    url: card.url,
    brief: card.brief ?? null,
    brief_prefix: card.briefPrefix ?? null,
    brief_suffix: card.briefSuffix ?? null,
    brief_date_iso: card.briefDateIso ?? null,
    brief_date_kind: card.briefDateKind,
    host: card.host,
  }));
}

/**
 * Client sends only interests (plus the currently-active source filter and
 * normal limit/offset paging); the candidate pool and final ordering are
 * entirely server-decided — the client never supplies item ids.
 *
 * Retrieve-then-rerank: items are embedded once at ingestion time (see
 * core/service.ts's refreshOne), so the request-time path only embeds the
 * interests string and sorts the pool by cosine similarity
 * (core/personalize/similarity.ts) — no LLM call needed for this step, and
 * it's robust to paraphrased interests in a way a literal cache-key string
 * match isn't. The LLM ranker then runs only as an optional "polish" pass
 * on the top FEEDREADER_PERSONALIZE_POLISH_POOL_SIZE similarity hits
 * (default 30, 0 disables it) instead of the whole candidate pool.
 *
 * The polish step is only ever consulted for the *first* page request for a
 * given (interests, source filter, source-data freshness) combination — the
 * resulting ranked order is cached via the platform Cache API, keyed so it
 * naturally invalidates whenever the underlying sources next refresh (see
 * latestSuccessAt). Every page request — including the first — re-fetches
 * fresh item rows from D1 and reorders them according to that ranking, so
 * pagination never re-invokes the model and item content (title/score/etc.)
 * is never served stale from the cache, only the ordering is.
 *
 * `personalization` in the response tells the client which tier was
 * actually served: "llm" (similarity + LLM polish both succeeded),
 * "similarity" (similarity ranking served on its own — polish disabled, or
 * it failed but similarity is still a real personalized order, unlike
 * yesterday's flat chronological fallback), or "none" (interests embedding
 * itself failed, or the pool was empty — chronological order, same as
 * before). Only "none" is cached as a non-result (not cached at all), so
 * the next request retries rather than being stuck there.
 */
async function handlePersonalize(
  request: Request,
  env: Env,
  repo: D1Repository,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { interests, source, sources, limit, offset } =
    parsePersonalizeBody(body);
  if (interests === "") {
    return Response.json({ error: "interests is required" }, { status: 400 });
  }

  const { items: fullPool, embeddings } = await repo.listFeedItemsForRanking(
    PERSONALIZE_FULL_POOL_LIMIT,
    source,
    sources,
  );
  if (fullPool.length === 0) {
    return Response.json({
      generated_at: new Date().toISOString(),
      personalization: "none",
      has_next: false,
      items: [],
    });
  }

  const states = await repo.listSourceStates();
  const freshness = latestSuccessAt(states, source, sources);
  const cacheRequest = personalizeCacheRequest(
    interests,
    source,
    sources,
    freshness,
  );

  const cached = await readRankedKeysCache(cacheRequest);
  let rankedKeys: string[];
  let personalization: "llm" | "similarity" | "none";
  if (cached) {
    rankedKeys = cached.rankedKeys;
    personalization = cached.personalization;
  } else {
    let interestsVector: number[] | null = null;
    try {
      const embedder = new CloudflareEmbedder(env.AI);
      const [vector] = await embedder.embed([interests]);
      interestsVector = vector ?? null;
    } catch {
      interestsVector = null;
    }

    if (interestsVector) {
      const bySimilarity = rankBySimilarity(
        fullPool,
        embeddings,
        interestsVector,
      );
      let polishPoolSize = parseNonNegativeInt(
        env.FEEDREADER_PERSONALIZE_POLISH_POOL_SIZE ?? null,
        30,
      );
      if (polishPoolSize > 100) polishPoolSize = 100;

      if (polishPoolSize > 0) {
        const candidates = bySimilarity.slice(0, polishPoolSize);
        try {
          const ranker = new CloudflareLlmRanker(env.AI);
          const ranked = await ranker.rank(candidates, interests);
          if (ranked.length > 0) {
            rankedKeys = mergeRankedOrder(candidates, ranked).map(itemKey);
            personalization = "llm";
          } else {
            rankedKeys = bySimilarity.map(itemKey);
            personalization = "similarity";
          }
        } catch {
          rankedKeys = bySimilarity.map(itemKey);
          personalization = "similarity";
        }
      } else {
        rankedKeys = bySimilarity.map(itemKey);
        personalization = "similarity";
      }
      await writeRankedKeysCache(cacheRequest, { personalization, rankedKeys });
    } else {
      rankedKeys = [];
      personalization = "none";
    }
  }

  const ordered = mergeRankedKeysOrder(fullPool, rankedKeys);
  const page = paginate(ordered, limit, offset);
  const hasNext = offset + page.length < ordered.length;
  const cards = buildCards(page, offset);

  return Response.json({
    generated_at: new Date().toISOString(),
    personalization,
    has_next: hasNext,
    items: cardsToJson(cards),
  });
}

function parsePersonalizeBody(body: unknown): {
  interests: string;
  source: string;
  sources: string[];
  limit: number;
  offset: number;
} {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const interests = normalizeInterests(record.interests);
  const source = normalizeSource(
    typeof record.source === "string" ? record.source : "",
  );
  const querySource = source === "all" ? "" : source;
  const rawSources = Array.isArray(record.sources)
    ? record.sources
        .filter((value): value is string => typeof value === "string")
        .join(",")
    : "";
  const sources = querySource === "" ? normalizeSourceList(rawSources) : [];
  let limit = parsePositiveInt(bodyNumberAsString(record.limit), PAGE_SIZE);
  if (limit > 100) limit = 100;
  const offset = parseNonNegativeInt(bodyNumberAsString(record.offset), 0);
  return { interests, source: querySource, sources, limit, offset };
}

function bodyNumberAsString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  return null;
}

function normalizeInterests(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MAX_INTERESTS_LENGTH);
}

/** Synthetic GET request used purely as a Cache API key — never fetched.
 * `.invalid` is reserved by RFC 2606 for exactly this kind of placeholder
 * use, so it's guaranteed not to collide with a real host. */
function personalizeCacheRequest(
  interests: string,
  source: string,
  sources: string[],
  freshness: string,
): Request {
  const raw = `rank:v1:${interests} ${source} ${sources.join(",")} ${freshness}`;
  const url = `https://feedreader-internal.invalid/personalize-rank?k=${encodeURIComponent(raw)}`;
  return new Request(url, { method: "GET" });
}

// tsconfig includes the DOM lib (needed for linkedom-based source parsing
// elsewhere), whose own `CacheStorage` type shadows the Workers one and
// lacks `.default` — cast through `unknown` once to recover it.
function defaultPersonalizeCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

interface CachedRanking {
  personalization: "llm" | "similarity";
  rankedKeys: string[];
}

async function readRankedKeysCache(
  cacheRequest: Request,
): Promise<CachedRanking | null> {
  try {
    const hit = await defaultPersonalizeCache().match(cacheRequest);
    if (!hit) return null;
    const data = (await hit.json()) as Partial<CachedRanking> | null;
    if (
      !data ||
      (data.personalization !== "llm" && data.personalization !== "similarity") ||
      !Array.isArray(data.rankedKeys)
    ) {
      return null;
    }
    return {
      personalization: data.personalization,
      rankedKeys: data.rankedKeys.filter(
        (value): value is string => typeof value === "string",
      ),
    };
  } catch {
    // Cache API is best-effort (and a documented no-op in local `wrangler
    // dev`) — any failure here is just a cache miss, never an error.
    return null;
  }
}

async function writeRankedKeysCache(
  cacheRequest: Request,
  cached: CachedRanking,
): Promise<void> {
  try {
    await defaultPersonalizeCache().put(
      cacheRequest,
      new Response(JSON.stringify(cached), {
        headers: {
          "content-type": "application/json",
          "cache-control": `max-age=${PERSONALIZE_CACHE_TTL_SECONDS}`,
        },
      }),
    );
  } catch {
    // Same as above — a failed write just means the next request re-ranks.
  }
}

async function handleRefresh(env: Env, sources: Source[]): Promise<Response> {
  const outcomes = await fanOutRefresh(env, sources);
  const allOk = outcomes.every((outcome) => outcome.ok);
  return Response.json({ ok: allOk, outcomes }, { status: allOk ? 200 : 502 });
}

async function handleInternalRefresh(
  request: Request,
  env: Env,
  repo: D1Repository,
  sources: Source[],
  url: URL,
): Promise<Response> {
  if (request.headers.get("X-Refresh-Secret") !== env.REFRESH_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const sourceKey = url.pathname.slice("/internal/refresh/".length);
  const source = sources.find((s) => s.key() === sourceKey);
  if (!source) return new Response("unknown source", { status: 404 });
  const outcome = await refreshOne(source, repo, new CloudflareEmbedder(env.AI));
  return Response.json(outcome);
}

/**
 * Issues one fresh Worker invocation per source via the SELF service
 * binding, so each source's fetch+parse — especially GitHub/alphaXiv's DOM
 * parse — gets its own 10ms CPU budget instead of sharing one invocation's
 * budget across all 4 sources. See docs/RUNBOOK.md.
 */
async function fanOutRefresh(
  env: Env,
  sources: Source[],
): Promise<RefreshOutcome[]> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const response = await env.SELF.fetch(
        `http://internal/internal/refresh/${source.key()}`,
        {
          method: "POST",
          headers: { "X-Refresh-Secret": env.REFRESH_SECRET },
        },
      );
      if (!response.ok) {
        throw new Error(
          `internal refresh for ${source.key()} returned ${response.status}`,
        );
      }
      return (await response.json()) as RefreshOutcome;
    }),
  );
  return results.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : {
          source: sources[i]!.key(),
          ok: false,
          itemCount: 0,
          error: errorMessage(result.reason),
        },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSource(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "all") return "all";
  return KNOWN_SOURCES.has(trimmed) ? trimmed : "all";
}

function normalizeSourceList(raw: string): string[] {
  if (raw.trim() === "") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const normalized = normalizeSource(part);
    if (normalized === "all" || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function normalizeSearchQuery(raw: string): string {
  return raw.trim().split(/\s+/).filter(Boolean).join(" ");
}

function normalizeProtocolAction(raw: string | null): {
  source: string;
  query: string;
} {
  if (!raw || raw.trim() === "") {
    return { source: "", query: "" };
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "web+feedreader:") {
      return { source: "", query: "" };
    }

    if (url.hostname === "source") {
      return {
        source: decodeURIComponent(url.pathname.replace(/^\//, "")),
        query: "",
      };
    }

    if (url.hostname === "search") {
      return {
        source: "",
        query: decodeURIComponent(url.pathname.replace(/^\//, "")).replace(
          /\+/g,
          " ",
        ),
      };
    }
  } catch {
    return { source: "", query: "" };
  }

  return { source: "", query: "" };
}

function buildSourceFilters(current: string) {
  const defs = [
    {
      key: "all",
      label: "For You",
      iconPath: undefined as string | undefined,
    },
    {
      key: "hackernews",
      label: "Hacker News",
      iconPath: "/static/source-icons/hackernews.svg",
    },
    {
      key: "github",
      label: "GitHub Trending",
      iconPath: "/static/source-icons/github.svg",
    },
    {
      key: "huggingface",
      label: "Hugging Face Trending Papers",
      iconPath: "/static/source-icons/huggingface.svg",
    },
    {
      key: "alphaxiv",
      label: "alphaXiv",
      iconPath: "/static/source-icons/alphaxiv.png",
    },
  ];
  return defs.map((item) => ({ ...item, active: item.key === current }));
}

function buildEmptyMessage(source: string, searchQuery: string): string {
  if (searchQuery !== "") {
    return source !== "" && source !== "all"
      ? `No matches found in ${sourceLabel(source)}. Try a different query.`
      : "No matches found. Try a different query.";
  }
  return source !== "" && source !== "all"
    ? `No items found in ${sourceLabel(source)} right now.`
    : "No items yet. The scheduler will populate the feed automatically.";
}

function sourceLabel(source: string): string {
  switch (source) {
    case "hackernews":
      return "Hacker News";
    case "github":
      return "GitHub Trending";
    case "huggingface":
      return "Hugging Face Trending Papers";
    case "alphaxiv":
      return "alphaXiv";
    default:
      return "this source";
  }
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? fallback : parsed;
}

function parseNonNegativeInt(raw: string | null, fallback: number): number {
  if (!raw || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 0 ? fallback : parsed;
}
