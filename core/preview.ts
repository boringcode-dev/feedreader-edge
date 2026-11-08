// Reader-view extraction and safe article fetching for the side preview
// panel. Output is plain text only — never upstream HTML — so rendering it
// with textContent cannot introduce script/markup injection.
//
// `fetchArticlePreview` is deliberately conservative: http(s) only, no
// credentials, no non-standard ports, and no loopback/private/link-local
// hosts (both the requested URL and every post-redirect URL are checked).
// Callers should additionally verify the URL belongs to a stored feed item
// before calling this, so the endpoint can't act as an open proxy.
//
// Residual DNS-rebinding note: Workers cannot reach private IP space by
// literal, and fetch() re-resolves hostnames at connect time. Workers fetch
// exposes no hook to pin a validated DNS answer, so a hostname whose DNS
// answer changes between validation and connect remains a theoretical
// rebinding vector; the stored-item allowlist and platform egress rules are
// the layers that bound it.

import { parseHtmlDocument } from "./sources/dom.ts";

const DEFAULT_MAX_BYTES = 400_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_BLOCKS = 120;
const MAX_BLOCK_CHARS = 4_000;
const MAX_TOTAL_CHARS = 40_000;
const MIN_PARAGRAPH_CHARS = 25;
// An <article> with real prose is almost always the page's content, even
// though its parent <main> scores at least as high (the article's text is a
// subset of the parent's). Prefer it once it clears this bar, so pages like
// GitHub don't leak repository chrome into the reader view.
const MIN_ARTICLE_SCORE = 300;

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "[hidden]",
  '[aria-hidden="true"]',
];

export type PreviewBlockType =
  | "heading"
  | "paragraph"
  | "list"
  | "quote"
  | "code";

export interface PreviewBlock {
  type: PreviewBlockType;
  text: string;
}

export interface ArticlePreview {
  title: string;
  siteName: string;
  byline?: string;
  blocks: PreviewBlock[];
}

export class PreviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewUnavailableError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchArticlePreviewOptions {
  userAgent: string;
  fetchImpl?: FetchLike;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Returns a normalized absolute URL, or null when the URL is not a public
 * http(s) resource this Worker is willing to fetch. WHATWG URL parsing
 * already collapses shorthand IPv4 forms (127.1, 2130706433) into dotted
 * quads before the private-range check sees them.
 */
export function normalizePreviewUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return null;
  if (isPrivateHostname(url.hostname)) return null;

  return url.toString();
}

export async function fetchArticlePreview(
  rawUrl: string,
  options: FetchArticlePreviewOptions,
): Promise<ArticlePreview> {
  const target = normalizePreviewUrl(rawUrl);
  if (!target) {
    throw new PreviewUnavailableError("article URL is not previewable");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  let resolvedUrl: string;
  try {
    const result = await fetchWithSafeRedirects(fetchImpl, target, {
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "User-Agent": options.userAgent,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    response = result.response;
    resolvedUrl = result.url;
  } catch (error) {
    if (error instanceof PreviewUnavailableError) throw error;
    throw new PreviewUnavailableError("could not fetch article");
  }

  if (!response.ok) {
    throw new PreviewUnavailableError(`article returned ${response.status}`);
  }

  const finalUrl = response.url || resolvedUrl;
  if (!normalizePreviewUrl(finalUrl)) {
    throw new PreviewUnavailableError("article redirected to an unusable URL");
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (
    contentType !== "" &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new PreviewUnavailableError("article is not HTML");
  }

  const html = await readBodyLimited(
    response,
    options.maxBytes ?? DEFAULT_MAX_BYTES,
  );
  if (html.trim() === "") {
    throw new PreviewUnavailableError("article body is empty");
  }

  return extractArticlePreview(html, finalUrl);
}

export function extractArticlePreview(
  html: string,
  pageUrl: string,
): ArticlePreview {
  const document = parseHtmlDocument(html);

  const title = firstNonEmpty(
    metaContent(document, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]),
    normalizeText(document.querySelector("h1")?.textContent),
    normalizeText(document.querySelector("title")?.textContent),
  );
  const siteName =
    metaContent(document, ['meta[property="og:site_name"]']) ||
    hostLabel(pageUrl);
  const byline = cleanByline(
    firstNonEmpty(
      metaContent(document, [
        'meta[name="author"]',
        'meta[property="article:author"]',
      ]),
      normalizeText(document.querySelector('[rel="author"]')?.textContent),
      normalizeText(document.querySelector('[class*="byline"]')?.textContent),
    ),
  );

  for (const selector of NOISE_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => {
      element.remove();
    });
  }

  const root = pickContentRoot(document);
  const blocks = root ? extractBlocks(root, title) : [];
  if (blocks.length === 0) {
    const description = normalizeText(
      metaContent(document, [
        'meta[name="description"]',
        'meta[property="og:description"]',
      ]),
    );
    if (description !== "") {
      blocks.push({ type: "paragraph", text: description });
    }
  }

  return byline !== undefined
    ? { title, siteName, byline, blocks }
    : { title, siteName, blocks };
}

function extractBlocks(root: Element, title: string): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  let totalChars = 0;
  const titleKey = normalizeText(title);

  const elements = Array.from(
    root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre"),
  );
  for (const element of elements) {
    if (blocks.length >= MAX_BLOCKS) break;
    if (element.closest("pre") && element.tagName !== "PRE") continue;
    if (element.closest("li") && element.tagName !== "LI") continue;
    if (element.closest("blockquote") && element.tagName !== "BLOCKQUOTE") {
      continue;
    }

    const type = blockTypeFor(element.tagName);
    const text =
      type === "code"
        ? normalizeCodeText(element.textContent)
        : normalizeText(element.textContent);
    if (!isUsefulBlock(type, text)) continue;
    if (type === "heading" && normalizeText(text) === titleKey) continue;
    if (blocks.length > 0 && blocks[blocks.length - 1]!.text === text) {
      continue;
    }

    const capped = text.slice(0, MAX_BLOCK_CHARS);
    blocks.push({ type, text: capped });
    totalChars += capped.length;
    if (totalChars >= MAX_TOTAL_CHARS) break;
  }

  return blocks;
}

function pickContentRoot(document: Document): Element | null {
  const articles = Array.from(document.querySelectorAll("article"));
  let bestArticle: Element | null = null;
  let bestArticleScore = 0;
  for (const article of articles) {
    const score = contentScore(article);
    if (score > bestArticleScore) {
      bestArticle = article;
      bestArticleScore = score;
    }
  }
  if (bestArticle && bestArticleScore >= MIN_ARTICLE_SCORE) {
    return bestArticle;
  }

  const candidates: Element[] = [...articles];
  const main = document.querySelector("main, [role=main]");
  if (main) candidates.push(main);
  if (document.body) candidates.push(document.body);
  if (candidates.length === 0) return null;

  let best = candidates[0]!;
  let bestScore = contentScore(best);
  for (const candidate of candidates.slice(1)) {
    const score = contentScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function contentScore(element: Element): number {
  let score = 0;
  element.querySelectorAll("p, li, blockquote").forEach((node) => {
    const length = normalizeText(node.textContent).length;
    if (length >= MIN_PARAGRAPH_CHARS) score += length;
  });
  return score;
}

function blockTypeFor(tagName: string): PreviewBlockType {
  switch (tagName) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return "heading";
    case "LI":
      return "list";
    case "BLOCKQUOTE":
      return "quote";
    case "PRE":
      return "code";
    default:
      return "paragraph";
  }
}

function isUsefulBlock(type: PreviewBlockType, text: string): boolean {
  if (text === "") return false;
  switch (type) {
    case "paragraph":
      return text.length >= MIN_PARAGRAPH_CHARS;
    case "quote":
      return text.length >= 10;
    case "list":
      return text.length >= 2;
    default:
      return true;
  }
}

function metaContent(document: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const content = document.querySelector(selector)?.getAttribute("content");
    const normalized = normalizeText(content);
    if (normalized !== "") return normalized;
  }
  return "";
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim() !== "") return value.trim();
  }
  return "";
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCodeText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function cleanByline(value: string): string | undefined {
  const trimmed = value.trim().slice(0, 120);
  if (trimmed === "" || /^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function hostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isPrivateHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");

  if (
    hostname === "" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
    return octets.some((octet) => octet > 255) || isPrivateIpv4(octets);
  }

  if (hostname.includes(":")) return isPrivateIpv6(hostname);
  return false;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 88 && octets[2] === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  return a >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  if (hostname === "::" || hostname === "::1") return true;
  if (hostname.startsWith("::ffff:")) {
    const embedded = hostname.slice("::ffff:".length);
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(embedded);
    if (!ipv4) return true;
    return isPrivateIpv4(ipv4.slice(1).map((part) => Number.parseInt(part, 10)));
  }
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  const firstGroup = hostname.split(":", 1)[0] ?? "";
  if (firstGroup.startsWith("fe8") || firstGroup.startsWith("fe9")) return true;
  if (firstGroup.startsWith("fea") || firstGroup.startsWith("feb")) return true;
  return firstGroup.startsWith("ff");
}

/**
 * Follows redirects manually so every hop's Location is checked by
 * normalizePreviewUrl before the request is issued. `redirect: "follow"`
 * would let the Worker reach a private/loopback host first and only reject
 * it afterwards — a blind SSRF. Returns the final response plus the URL it
 * was fetched from (useful when a test double can't set Response.url).
 */
async function fetchWithSafeRedirects(
  fetchImpl: FetchLike,
  target: string,
  init: RequestInit,
): Promise<{ response: Response; url: string }> {
  let currentUrl = target;
  for (let redirects = 0; ; redirects++) {
    const response = await fetchImpl(currentUrl, {
      ...init,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: currentUrl };
    }
    if (redirects >= MAX_REDIRECTS) {
      await response.body?.cancel().catch(() => {});
      throw new PreviewUnavailableError("article redirected too many times");
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new PreviewUnavailableError("article redirect is missing a location");
    }
    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new PreviewUnavailableError("article redirected to an invalid URL");
    }
    const normalized = normalizePreviewUrl(nextUrl);
    if (!normalized) {
      throw new PreviewUnavailableError("article redirected to an unusable URL");
    }

    await response.body?.cancel().catch(() => {});
    currentUrl = normalized;
  }
}

async function readBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let out = "";
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = maxBytes - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytesRead += chunk.byteLength;
      out += decoder.decode(chunk, { stream: true });
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}
