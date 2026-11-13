// Uses Hugging Face's daily-papers JSON API. The public /papers/trending
// page is ~1.4 MB of HTML with the same data embedded in a data-props blob;
// fetching and parsing it wasted Worker CPU and its HTML fallback page is
// also what surfaced large 429 challenge bodies. The API returns the same
// 50 daily-paper entries as JSON.

import type { FeedItem } from "../domain.ts";
import type { Source } from "./index.ts";
import {
  cleanString,
  firstNonEmpty,
  getWithRetry,
  HttpError,
  readHttpErrorDetail,
} from "./util.ts";

const HOMEPAGE_URL = "https://huggingface.co/papers/trending";
const DAILY_PAPERS_API_URL = "https://huggingface.co/api/daily_papers";

interface HfAuthor {
  name?: string;
}

interface HfPaper {
  id?: string;
  title?: string;
  summary?: string;
  publishedAt?: string;
  upvotes?: number | null;
  numComments?: number | null;
  authors?: HfAuthor[];
}

interface HfDailyPaperEntry {
  id?: string;
  title?: string;
  summary?: string;
  upvotes?: number | null;
  numComments?: number | null;
  publishedAt?: string;
  submittedBy?: { fullname?: string; name?: string };
  paper?: HfPaper;
}

export const huggingFacePapersSource: Source = {
  key: () => "huggingface",
  label: () => "Hugging Face Trending Papers",
  homepageUrl: () => HOMEPAGE_URL,
  async fetch(): Promise<FeedItem[]> {
    const response = await getWithRetry(DAILY_PAPERS_API_URL, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new HttpError(
        response.status,
        await readHttpErrorDetail(response),
      );
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("unexpected daily papers payload");
    }
    return parseHuggingFaceDailyPapers(payload);
  },
};

export function parseHuggingFaceDailyPapers(
  entries: HfDailyPaperEntry[],
): FeedItem[] {
  const items: FeedItem[] = [];
  entries.forEach((entry, i) => {
    const paper = entry.paper ?? {};
    const paperId = firstNonEmpty(paper.id ?? "", entry.id ?? "");
    if (paperId === "") return;

    const authors = (paper.authors ?? [])
      .map((a) => (a.name ?? "").trim())
      .filter((name) => name !== "");

    const metadata: Record<string, unknown> = {};
    const commentCount = firstDefined(entry.numComments, paper.numComments);
    if (commentCount != null) {
      metadata.comments_count = commentCount;
    }
    if (authors.length > 0) {
      metadata.authors = authors.length > 6 ? authors.slice(0, 6) : authors;
    }
    const submittedBy = firstNonEmpty(
      entry.submittedBy?.fullname ?? "",
      entry.submittedBy?.name ?? "",
    ).trim();
    if (submittedBy !== "") {
      metadata.submitted_by = submittedBy;
    }

    items.push({
      source: "huggingface",
      externalId: paperId,
      title: firstNonEmpty(
        entry.title ?? "",
        paper.title ?? "",
        paperId,
      ).trim(),
      url: `https://huggingface.co/papers/${paperId}`,
      summary: cleanString(
        firstNonEmpty(entry.summary ?? "", paper.summary ?? ""),
      ),
      author: cleanString(authorSummary(authors)),
      score: firstDefined(entry.upvotes, paper.upvotes),
      publishedAt: parseIsoTime(
        firstNonEmpty(entry.publishedAt ?? "", paper.publishedAt ?? ""),
      ),
      sourceRank: i + 1,
      metadata,
    });
  });
  return items;
}

function parseIsoTime(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Date.parse(value.trim());
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function authorSummary(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} +${authors.length - 3}`;
}

function firstDefined(
  ...values: (number | null | undefined)[]
): number | undefined {
  for (const value of values) {
    if (value != null) return value;
  }
  return undefined;
}
