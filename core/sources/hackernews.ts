// Port of internal/sources/hackernews.go. JSON only, no DOM parsing.

import type { FeedItem } from "../domain.ts";
import type { Source } from "./index.ts";
import { cleanString, firstNonEmpty, getWithRetry, HttpError, readLimitedText, unescapeHtmlEntities } from "./util.ts";

const HACKER_NEWS_FRONT_PAGE_API = "https://hn.algolia.com/api/v1/search?tags=front_page";

interface HnStory {
  objectID?: string;
  story_id?: number;
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  story_text?: string;
  comment_text?: string;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
}

interface HnFrontPage {
  hits?: HnStory[];
}

export const hackerNewsSource: Source = {
  key: () => "hackernews",
  label: () => "Hacker News",
  homepageUrl: () => "https://news.ycombinator.com/",
  async fetch(): Promise<FeedItem[]> {
    const response = await getWithRetry(HACKER_NEWS_FRONT_PAGE_API);
    if (!response.ok) {
      throw new HttpError(response.status, await readLimitedText(response, 1024));
    }
    const payload = (await response.json()) as HnFrontPage;
    return parseHackerNews(payload);
  },
};

export function parseHackerNews(payload: HnFrontPage): FeedItem[] {
  const hits = payload.hits ?? [];
  const items: FeedItem[] = [];
  hits.forEach((node, idx) => {
    let externalId = (node.objectID ?? "").trim();
    if (externalId === "" && node.story_id && node.story_id > 0) {
      externalId = String(node.story_id);
    }
    if (externalId === "") return;

    const commentsUrl = `https://news.ycombinator.com/item?id=${externalId}`;
    const metadata: Record<string, unknown> = {};
    if (node.num_comments != null) {
      metadata.comments_count = node.num_comments;
    }

    items.push({
      source: "hackernews",
      externalId,
      title: firstNonEmpty(node.title ?? "", node.story_title ?? "", externalId).trim(),
      url: firstNonEmpty(node.url ?? "", node.story_url ?? "", commentsUrl).trim(),
      summary: cleanString(extractHnSummary(firstNonEmpty(node.story_text ?? "", node.comment_text ?? ""))),
      author: cleanString((node.author ?? "").trim()),
      score: node.points ?? undefined,
      commentsUrl: cleanString(commentsUrl),
      publishedAt: parseHackerNewsTime(node.created_at),
      sourceRank: idx + 1,
      metadata,
    });
  });
  return items;
}

function parseHackerNewsTime(value: string | undefined): string | undefined {
  if (!value || value.trim() === "") return undefined;
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function extractHnSummary(description: string): string {
  let cleaned = description.replace(/<a [^>]+>|<\/a>|<[^>]+>/g, " ");
  cleaned = unescapeHtmlEntities(cleaned);
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned.trim();
}
