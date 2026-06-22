// Port of internal/sources/github.go. Uses linkedom (DOM parsing) because
// the extraction is CSS-selector-based, same as the Go app's goquery usage.

import type { FeedItem } from "../domain.ts";
import { parseHtmlDocument } from "./dom.ts";
import type { Source } from "./index.ts";
import {
  cleanString,
  extractInt,
  getWithRetry,
  HttpError,
  parseDigits,
  readLimitedText,
} from "./util.ts";

const HOMEPAGE_URL = "https://github.com/trending";
const STARS_TODAY_PATTERN = /(\d[\d,]*)\s+stars today/;

export const gitHubTrendingSource: Source = {
  key: () => "github",
  label: () => "GitHub Trending",
  homepageUrl: () => HOMEPAGE_URL,
  async fetch(): Promise<FeedItem[]> {
    const response = await getWithRetry(HOMEPAGE_URL);
    if (!response.ok) {
      throw new HttpError(
        response.status,
        await readLimitedText(response, 1024),
      );
    }
    const html = await response.text();
    return parseGitHubTrending(html);
  },
};

export function parseGitHubTrending(html: string): FeedItem[] {
  const document = parseHtmlDocument(html);
  const items: FeedItem[] = [];

  document.querySelectorAll("article.Box-row").forEach((article, i) => {
    const repoLink = article.querySelector("h2 a");
    if (!repoLink) return;
    const href = repoLink.getAttribute("href") ?? "";
    const repoPath = normalizeGitHubRepoPath(href, textOf(repoLink));
    if (repoPath === "") return;

    const description = cleanString(textOf(article.querySelector("p")));
    const language = cleanString(
      textOf(article.querySelector('[itemprop="programmingLanguage"]')),
    );
    const stars = parseDigits(
      textOf(article.querySelector('a[href$="/stargazers"]')),
    );
    const forks = parseDigits(
      textOf(article.querySelector('a[href$="/forks"]')),
    );
    const articleText = textOf(article).split(/\s+/).filter(Boolean).join(" ");
    const starsToday = extractInt(articleText, STARS_TODAY_PATTERN);

    const metadata: Record<string, unknown> = {};
    if (language !== undefined) metadata.language = language;
    if (stars !== undefined) metadata.total_stars = stars;
    if (forks !== undefined) metadata.forks = forks;
    if (starsToday !== undefined) metadata.stars_today = starsToday;

    items.push({
      source: "github",
      externalId: repoPath.toLowerCase(),
      title: repoPath,
      url: resolveGitHubUrl(href),
      summary: description,
      score: starsToday,
      sourceRank: i + 1,
      metadata,
    });
  });

  return items;
}

function textOf(el: Element | null): string {
  return el?.textContent ?? "";
}

function resolveGitHubUrl(path: string): string {
  return new URL(path, "https://github.com").toString();
}

function normalizeGitHubRepoPath(href: string, linkText: string): string {
  try {
    const parsed = new URL(href, "https://github.com");
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length >= 2 && parts[0] !== "" && parts[1] !== "") {
      return `${parts[0]}/${parts[1]}`;
    }
  } catch {
    // fall through to the link-text fallback below
  }
  return linkText
    .split(/\s+/)
    .filter(Boolean)
    .join("")
    .replace(/^\/+|\/+$/g, "");
}
