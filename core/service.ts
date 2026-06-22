// Port of internal/service/service.go. No in-process scheduler here —
// Cloudflare Cron Triggers (and, in a later Deno adapter, Deno.cron) own
// scheduling entirely; see platforms/cloudflare/src/index.ts.

import type { CardView, ErrorView, FeedItem, RefreshOutcome, SourceSnapshot } from "./domain.ts";
import type { FeedRepository } from "./ports.ts";
import type { Source } from "./sources/index.ts";

export async function refreshAll(sources: Source[], repo: FeedRepository): Promise<RefreshOutcome[]> {
  return Promise.all(sources.map((source) => refreshOne(source, repo)));
}

export async function refreshOne(source: Source, repo: FeedRepository): Promise<RefreshOutcome> {
  const attemptedAtIso = new Date().toISOString();
  let items: FeedItem[];
  try {
    items = await source.fetch();
  } catch (error) {
    const message = errorMessage(error);
    await repo.recordFailure(source.key(), attemptedAtIso, message);
    return { source: source.key(), ok: false, itemCount: 0, error: message };
  }
  if (items.length === 0) {
    const message = "source returned zero items";
    await repo.recordFailure(source.key(), attemptedAtIso, message);
    return { source: source.key(), ok: false, itemCount: 0, error: message };
  }
  try {
    await repo.saveSnapshot(source.key(), attemptedAtIso, items);
  } catch (error) {
    const message = errorMessage(error);
    await repo.recordFailure(source.key(), attemptedAtIso, message);
    return { source: source.key(), ok: false, itemCount: 0, error: message };
  }
  return { source: source.key(), ok: true, itemCount: items.length };
}

export async function dashboard(sources: Source[], repo: FeedRepository, limit: number): Promise<SourceSnapshot[]> {
  const states = await repo.listSourceStates();
  const snapshots: SourceSnapshot[] = [];
  for (const source of sources) {
    const state = states[source.key()] ?? { source: source.key(), itemCount: 0 };
    const items = await repo.getCurrentItems(source.key(), limit);
    snapshots.push({
      source: source.key(),
      label: source.label(),
      homepageUrl: source.homepageUrl(),
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      itemCount: state.itemCount,
      items,
    });
  }
  return snapshots;
}

export async function feedItems(
  repo: FeedRepository,
  limit: number,
  offset: number,
  source: string,
  sources: string[],
  searchQuery: string,
): Promise<{ items: FeedItem[]; hasNext: boolean }> {
  const fetchLimit = limit > 0 ? limit + 1 : limit;
  let items = await repo.listFeedItems(fetchLimit, offset, source, sources, searchQuery);
  let hasNext = false;
  if (limit > 0 && items.length > limit) {
    hasNext = true;
    items = items.slice(0, limit);
  }
  return { items, hasNext };
}

export async function healthPayload(sources: Source[], repo: FeedRepository): Promise<Record<string, unknown>> {
  const snapshots = await dashboard(sources, repo, 1);
  const total = await repo.countTotalItems();
  return {
    status: "ok",
    total_items: total,
    sources: snapshots.map((snapshot) => ({
      source: snapshot.source,
      last_attempt_at: snapshot.lastAttemptAt ?? null,
      last_success_at: snapshot.lastSuccessAt ?? null,
      last_error: snapshot.lastError ?? null,
      item_count: snapshot.itemCount,
    })),
  };
}

export function buildCards(items: FeedItem[], offset: number): CardView[] {
  return items.map((item, i) => {
    const briefPrefix = cardBriefPrefix(item);
    const briefSuffix = cardBriefSuffix(item);
    const [briefDateIso, briefDateKind] = cardDateParts(item);
    return {
      source: item.source,
      index: offset + i + 1,
      title: item.title,
      url: item.url,
      brief: composeBrief(briefPrefix, briefDateIso, briefDateKind, briefSuffix),
      briefPrefix,
      briefSuffix,
      briefDateIso,
      briefDateKind,
      host: hostLabel(item.url),
    };
  });
}

export function buildErrors(snapshots: SourceSnapshot[]): ErrorView[] {
  return snapshots
    .filter((snapshot) => (snapshot.lastError ?? "").trim() !== "")
    .map((snapshot) => ({ source: snapshot.source, label: snapshot.label, error: snapshot.lastError as string }));
}

function cardBriefPrefix(item: FeedItem): string | undefined {
  const fragments = cardStatFragments(item);
  return fragments.length === 0 ? undefined : fragments.join(" · ");
}

function cardBriefSuffix(item: FeedItem): string | undefined {
  switch (item.source) {
    case "hackernews":
      return undefined;
    case "github": {
      const summary = normalizedSummary(item.summary);
      if (summary) return summary;
      const language = metadataString(item.metadata, "language");
      return language ? `Trending ${language} repository on GitHub` : "Trending repository on GitHub";
    }
    case "huggingface": {
      const summary = normalizedSummary(item.summary);
      if (summary) return summary;
      if (item.author && item.author.trim() !== "") return item.author.trim();
      return "Trending paper on Hugging Face";
    }
    case "alphaxiv": {
      const summary = normalizedSummary(item.summary);
      if (summary) return summary;
      if (item.author && item.author.trim() !== "") return item.author.trim();
      return "Trending paper on alphaXiv";
    }
    default:
      return normalizedSummary(item.summary);
  }
}

function cardStatFragments(item: FeedItem): string[] {
  const fragments: string[] = [];
  switch (item.source) {
    case "hackernews": {
      if (item.score != null) fragments.push(`${item.score} points`);
      const comments = metadataInt(item.metadata, "comments_count");
      if (comments != null) fragments.push(`${comments} comments`);
      break;
    }
    case "github": {
      const stars = metadataInt(item.metadata, "total_stars");
      if (stars != null) fragments.push(`${formatCount(stars)} stars`);
      const today = metadataInt(item.metadata, "stars_today");
      if (today != null) fragments.push(`${formatCount(today)} today`);
      const forks = metadataInt(item.metadata, "forks");
      if (forks != null) fragments.push(`${formatCount(forks)} forks`);
      break;
    }
    case "huggingface":
      if (item.score != null) fragments.push(`${formatCount(item.score)} upvotes`);
      break;
    case "alphaxiv":
      if (item.score != null) fragments.push(`${formatCount(item.score)} likes`);
      break;
  }
  return fragments;
}

function cardDateParts(item: FeedItem): [string | undefined, string] {
  if (item.publishedAt) return [item.publishedAt, "published"];
  if (item.fetchedAt) return [item.fetchedAt, "fetched"];
  return [undefined, ""];
}

function composeBrief(
  prefix: string | undefined,
  dateIso: string | undefined,
  dateKind: string,
  suffix: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (prefix && prefix.trim() !== "") parts.push(prefix.trim());
  const fallback = cardDateLabelFromParts(dateIso, dateKind);
  if (fallback !== "") parts.push(fallback);
  const joined = parts.join(" · ");
  if (suffix && suffix.trim() !== "") {
    const text = suffix.trim();
    return joined !== "" ? `${joined} - ${text}` : text;
  }
  return joined === "" ? undefined : joined;
}

function cardDateLabelFromParts(dateIso: string | undefined, dateKind: string): string {
  if (!dateIso || dateIso.trim() === "") return "";
  const parsedMs = Date.parse(dateIso);
  if (Number.isNaN(parsedMs)) return "";
  let verb: string;
  if (dateKind === "published") verb = "Published";
  else if (dateKind === "fetched") verb = "Fetched";
  else return "";
  return `${verb} ${formatMonthDayYear(new Date(parsedMs))}`;
}

function formatMonthDayYear(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function normalizedSummary(summary: string | undefined): string | undefined {
  if (!summary || summary.trim() === "") return undefined;
  return summary.split(/\s+/).filter(Boolean).join(" ");
}

function hostLabel(rawUrl: string): string {
  let trimmed = rawUrl.trim();
  trimmed = trimmed.replace(/^https:\/\//, "").replace(/^http:\/\//, "");
  const host = (trimmed.split("/", 1)[0] ?? "").toLowerCase().replace(/^www\./, "");
  return host === "" ? rawUrl : host;
}

function metadataInt(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" ? value : undefined;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

function formatCount(value: number): string {
  if (value === 0) return "0";
  const negative = value < 0;
  let digits = String(Math.abs(value));
  const parts: string[] = [];
  while (digits.length > 3) {
    parts.unshift(digits.slice(-3));
    digits = digits.slice(0, -3);
  }
  parts.unshift(digits);
  const joined = parts.join(",");
  return negative ? `-${joined}` : joined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
