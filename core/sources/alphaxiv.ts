// Port of internal/sources/alphaxiv.go — the highest-risk source to port
// faithfully: alphaXivCardContainer walks UP the parent chain from a
// matched link looking for an ancestor with specific descendant markers.
// That structural DOM relationship isn't replicable as plain regex, so
// this uses linkedom just like github.ts.

import type { FeedItem } from "../domain.ts";
import { parseHtmlDocument } from "./dom.ts";
import type { Source } from "./index.ts";
import { cleanString, getWithRetry, HttpError, parseDigits, readLimitedText } from "./util.ts";

const HOMEPAGE_URL = "https://www.alphaxiv.org/";
const ALPHAXIV_DATE_PATTERN = /\b\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\b/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const alphaXivSource: Source = {
  key: () => "alphaxiv",
  label: () => "alphaXiv",
  homepageUrl: () => HOMEPAGE_URL,
  async fetch(): Promise<FeedItem[]> {
    const response = await getWithRetry(HOMEPAGE_URL);
    if (!response.ok) {
      throw new HttpError(response.status, await readLimitedText(response, 1024));
    }
    const html = await response.text();
    return parseAlphaXivExplore(html);
  },
};

export function parseAlphaXivExplore(html: string): FeedItem[] {
  const document = parseHtmlDocument(html);
  const items: FeedItem[] = [];
  const seen = new Set<string>();

  document.querySelectorAll('a[href^="/abs/"]').forEach((link) => {
    const title = words(textOf(link));
    if (title === "" || title.toLowerCase() === "view blog") return;

    const href = link.getAttribute("href");
    if (!href || href.trim() === "") return;

    const absoluteUrl = resolveAlphaXivUrl(href);
    const externalId = alphaXivExternalId(absoluteUrl);
    if (externalId === "" || seen.has(externalId)) return;

    const card = alphaXivCardContainer(link);
    if (!card) return;

    const authors = alphaXivAuthors(card);
    const metadata: Record<string, unknown> = {};
    if (authors.length > 0) metadata.authors = authors;
    const tags = alphaXivTags(card);
    if (tags.length > 0) metadata.tags = tags;

    items.push({
      source: "alphaxiv",
      externalId,
      title,
      url: absoluteUrl,
      summary: alphaXivSummary(card),
      author: cleanString(authors.join(", ")),
      score: alphaXivScore(card),
      publishedAt: alphaXivPublishedAt(card),
      sourceRank: items.length + 1,
      metadata,
    });
    seen.add(externalId);
  });

  return items;
}

function textOf(el: Element | null): string {
  return el?.textContent ?? "";
}

function words(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

function alphaXivCardContainer(link: Element): Element | null {
  let node: Element | null = link.parentElement;
  while (node) {
    if (
      node.querySelector("svg.lucide-thumbs-up") ||
      node.querySelector('a[href^="/audio/"]') ||
      node.querySelector('a[href^="/replicate/"]')
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function alphaXivExternalId(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "";
  }
  if (!parsed.pathname.startsWith("/abs/")) return "";
  const trimmed = parsed.pathname.replace(/\/+$/, "");
  const id = trimmed.split("/").pop() ?? "";
  if (id === "." || id === "/") return "";
  return id.trim();
}

function alphaXivSummary(card: Element): string | undefined {
  let best = "";
  card.querySelectorAll("p").forEach((p) => {
    const text = words(textOf(p));
    if (text.length > best.length) best = text;
  });
  return cleanString(best);
}

function alphaXivAuthors(card: Element): string[] {
  const seen = new Set<string>();
  const authors: string[] = [];
  const appendAuthor = (raw: string) => {
    const name = words(raw);
    if (name === "" || name.startsWith("#") || name.toLowerCase() === "view blog" || name.length > 80) return;
    if (seen.has(name)) return;
    seen.add(name);
    authors.push(name);
  };
  card.querySelectorAll('[aria-haspopup="dialog"]').forEach((node) => appendAuthor(textOf(node)));
  if (authors.length > 0) return authors;
  card.querySelectorAll("div.font-normal, span.font-normal").forEach((node) => appendAuthor(textOf(node)));
  return authors;
}

function alphaXivScore(card: Element): number | undefined {
  const buttons = Array.from(card.querySelectorAll("button"));
  for (const button of buttons) {
    if (button.querySelector("svg.lucide-thumbs-up")) {
      return parseDigits(textOf(button));
    }
  }
  return undefined;
}

function alphaXivTags(card: Element): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  card.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === null) return;
    const isTagLink =
      href.includes("?subcategories=") || href.includes("?categories=") || href.includes("?custom-categories=");
    if (!isTagLink) return;
    const tag = words(textOf(link)).replace(/^#/, "");
    if (tag === "" || seen.has(tag)) return;
    seen.add(tag);
    tags.push(tag);
  });
  return tags;
}

function alphaXivPublishedAt(card: Element): string | undefined {
  let match = "";
  for (const span of Array.from(card.querySelectorAll("span"))) {
    const found = ALPHAXIV_DATE_PATTERN.exec(words(textOf(span)));
    if (found) {
      match = found[0];
      break;
    }
  }
  if (match === "") {
    const found = ALPHAXIV_DATE_PATTERN.exec(words(textOf(card)));
    if (found) match = found[0];
  }
  if (match === "") return undefined;
  return parseAlphaXivDate(match);
}

function parseAlphaXivDate(value: string): string | undefined {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(value);
  if (!match) return undefined;
  const monthIndex = MONTHS.indexOf(match[2]!);
  if (monthIndex === -1) return undefined;
  const day = Number.parseInt(match[1]!, 10);
  const year = Number.parseInt(match[3]!, 10);
  return new Date(Date.UTC(year, monthIndex, day)).toISOString();
}

function resolveAlphaXivUrl(rawPath: string): string {
  try {
    return new URL(rawPath.trim(), HOMEPAGE_URL).toString();
  } catch {
    return rawPath;
  }
}
