// Reader-view extraction and safe article fetching for the side preview
// panel. Output is plain text plus validated image URLs — never upstream
// HTML — so rendering it cannot introduce script/markup injection.
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

import {
  isElement,
  parentElement,
  parseHtmlDocument,
  type HtmlDocument,
  type HtmlElement,
  type HtmlNode,
} from "./sources/dom.ts";

const DEFAULT_MAX_BYTES = 400_000;
// Non-HTML bodies are handed to the optional platform fallback (for example
// Workers AI's toMarkdown) instead of being parsed here. Keep the cap well
// below the Worker's memory budget while still covering typical papers.
const DEFAULT_MAX_FALLBACK_BYTES = 5_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_BLOCKS = 120;
const MAX_IMAGES = 20;
const MAX_TABLES = 5;
const MAX_TABLE_ROWS = 15;
const MAX_TABLE_COLUMNS = 6;
const MAX_TABLE_CELL_CHARS = 150;
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

export type PreviewTextBlockType = "heading" | "paragraph" | "list" | "quote";

export interface PreviewSegment {
  text: string;
  href?: string;
  strong?: boolean;
  em?: boolean;
  code?: boolean;
}

export interface PreviewPlainTextBlock {
  type: PreviewTextBlockType;
  text: string;
}

export interface PreviewRichTextBlock {
  type: PreviewTextBlockType;
  segments: PreviewSegment[];
}

export interface PreviewCodeBlock {
  type: "code";
  text: string;
}

export interface PreviewImageBlock {
  type: "image";
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface PreviewTableBlock {
  type: "table";
  header: boolean;
  rows: string[][];
}

export type PreviewBlock =
  | PreviewPlainTextBlock
  | PreviewRichTextBlock
  | PreviewCodeBlock
  | PreviewImageBlock
  | PreviewTableBlock;

export interface ArticlePreview {
  title: string;
  siteName: string;
  byline?: string;
  publishedAt?: string;
  readingMinutes?: number;
  blocks: PreviewBlock[];
}

/** Content the primary extractor cannot turn into blocks. A platform adapter
 * may convert it another way (for example Workers AI's Markdown conversion);
 * core only passes bytes/text and receives already-validated blocks back. */
export type PreviewFallbackKind =
  | "no_content"
  | "too_large"
  | "unsupported_content_type";

export interface PreviewFallbackInput {
  kind: PreviewFallbackKind;
  url: string;
  contentType: string;
  /** Present for HTML fallbacks. */
  html?: string;
  /** Present for non-HTML fallbacks, capped by `maxFallbackBytes`. */
  bytes?: Uint8Array;
}

/**
 * Optional platform hook for previews the built-in extractor can't produce.
 * It must return plain `PreviewBlock` data (never upstream HTML) or null to
 * preserve the original failure. Core never imports a platform SDK.
 */
export type PreviewFallback = (
  input: PreviewFallbackInput,
) => Promise<ArticlePreview | null>;

export type PreviewFailureReason =
  | "invalid_url"
  | "fetch_failed"
  | "timeout"
  | "redirect"
  | "blocked"
  | "rate_limited"
  | "upstream_error"
  | "unsupported_content_type"
  | "too_large"
  | "empty_body";

export class PreviewUnavailableError extends Error {
  readonly reason: PreviewFailureReason;
  readonly upstreamStatus?: number;

  constructor(
    message: string,
    reason: PreviewFailureReason = "fetch_failed",
    upstreamStatus?: number,
  ) {
    super(message);
    this.name = "PreviewUnavailableError";
    this.reason = reason;
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus;
  }
}

function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchArticlePreviewOptions {
  userAgent: string;
  fetchImpl?: FetchLike;
  maxBytes?: number;
  timeoutMs?: number;
  /** Base delay before retrying a transient upstream response. */
  retryDelayMs?: number;
  /** Random jitter added to the retry delay. */
  retryJitterMs?: number;
  /** Attempted only when the built-in extractor finds no readable blocks or
   * the response is not HTML. */
  fallback?: PreviewFallback;
  /** Cap for non-HTML response bodies handed to `fallback`. */
  maxFallbackBytes?: number;
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
    throw new PreviewUnavailableError(
      "article URL is not previewable",
      "invalid_url",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutSignal = AbortSignal.timeout(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let lastResult: { response: Response; url: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lastResult = await fetchWithSafeRedirects(fetchImpl, target, {
        headers: {
          // PDF/octet-stream let document URLs negotiate their document
          // instead of an HTML wrapper; HTML stays the preferred type for
          // ordinary article URLs.
          Accept:
            "text/html, application/xhtml+xml, application/pdf;q=0.9, application/octet-stream;q=0.5",
          "User-Agent": options.userAgent,
        },
        signal: timeoutSignal,
      });
    } catch (error) {
      if (error instanceof PreviewUnavailableError) throw error;
      throw new PreviewUnavailableError(
        "could not fetch article",
        isTimeoutError(error) ? "timeout" : "fetch_failed",
      );
    }
    if (
      lastResult.response.ok ||
      !isTransientStatus(lastResult.response.status) ||
      attempt === 1
    ) {
      break;
    }
    await lastResult.response.body?.cancel().catch(() => {});
    const jitter =
      options.retryJitterMs === 0 ? 0 : Math.random() * (options.retryJitterMs ?? 200);
    await sleep((options.retryDelayMs ?? 250) + jitter);
  }
  if (!lastResult) {
    throw new PreviewUnavailableError("could not fetch article", "fetch_failed");
  }

  const response = lastResult.response;
  const resolvedUrl = lastResult.url;

  if (!response.ok) {
    const reason: PreviewFailureReason =
      response.status === 401 || response.status === 403
        ? "blocked"
        : response.status === 429
          ? "rate_limited"
          : "upstream_error";
    throw new PreviewUnavailableError(
      `article returned ${response.status}`,
      reason,
      response.status,
    );
  }

  const finalUrl = response.url || resolvedUrl;
  if (!normalizePreviewUrl(finalUrl)) {
    throw new PreviewUnavailableError(
      "article redirected to an unusable URL",
      "redirect",
    );
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const isHtml =
    contentType === "" ||
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml");
  const fallback = options.fallback;

  if (!isHtml) {
    const maxFallbackBytes =
      options.maxFallbackBytes ?? DEFAULT_MAX_FALLBACK_BYTES;
    const declaredLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10,
    );
    // Do not download a document that already declares itself too large: the
    // fallback would reject the partial file anyway.
    const declaredTooLarge =
      Number.isFinite(declaredLength) && declaredLength > maxFallbackBytes;
    let tooLarge = false;
    if (fallback) {
      if (declaredTooLarge) {
        tooLarge = true;
      } else {
        try {
          const { bytes, truncated } = await readBytesLimited(
            response,
            maxFallbackBytes,
          );
          // A partial PDF/Office file is unlikely to convert; report the size
          // limit rather than spending an AI call on corrupt input.
          if (truncated) {
            tooLarge = true;
          } else {
            const converted = await tryPreviewFallback(fallback, {
              kind: "unsupported_content_type",
              url: finalUrl,
              contentType,
              bytes,
            });
            if (converted) return converted;
          }
        } catch {
          // The fallback is best-effort; report the original reason below.
        }
      }
    }
    throw new PreviewUnavailableError(
      tooLarge
        ? "article document is too large to preview"
        : "article is not HTML",
      tooLarge ? "too_large" : "unsupported_content_type",
    );
  }

  const { text: html, truncated } = await readBodyLimited(
    response,
    options.maxBytes ?? DEFAULT_MAX_BYTES,
  );
  if (html.trim() === "") {
    throw new PreviewUnavailableError("article body is empty", "empty_body");
  }

  const preview = extractArticlePreview(html, finalUrl);
  if (preview.blocks.length === 0 && fallback) {
    const converted = await tryPreviewFallback(fallback, {
      kind: truncated ? "too_large" : "no_content",
      url: finalUrl,
      contentType,
      html,
    });
    if (converted) return converted;
  }
  if (truncated && preview.blocks.length === 0) {
    throw new PreviewUnavailableError(
      "article body exceeded the preview limit before readable content",
      "too_large",
    );
  }
  return preview;
}

export function extractArticlePreview(
  html: string,
  pageUrl: string,
): ArticlePreview {
  const document = parseHtmlDocument(html);

  const rawTitle = firstNonEmpty(
    metaContent(document, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
    ]),
    normalizeText(document.querySelector("h1")?.textContent),
    normalizeText(document.querySelector("title")?.textContent),
  );
  const title = sanitizePreviewTitle(rawTitle, pageUrl);
  const isPaperPage = isHuggingFacePaperPage(pageUrl);
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
      isPaperPage ? extractHuggingFacePaperByline(document) : "",
    ),
  );
  const publishedAt = extractPublishedAt(document);
  // Read paper resources and citation lists before nav/header cleanup drops
  // the containers they live in.
  const paperLinks = isPaperPage
    ? extractHuggingFacePaperLinks(document, pageUrl)
    : [];
  const paperCitations = isPaperPage
    ? extractHuggingFacePaperCitations(document, pageUrl)
    : [];

  for (const selector of NOISE_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => {
      element.remove();
    });
  }

  const root = isPaperPage
    ? (pickHuggingFacePaperRoot(document) ?? pickContentRoot(document))
    : pickContentRoot(document);
  const blocks = root ? extractBlocks(root, title, pageUrl) : [];
  if (paperLinks.length > 0) {
    blocks.push({
      type: "paragraph",
      segments: [{ text: "Read the full paper: " }, ...paperLinks],
    });
  }
  blocks.push(...paperCitations);
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

  const readingMinutes = estimateReadingMinutes(blocks);
  const preview: ArticlePreview = { title, siteName, blocks };
  if (byline !== undefined) preview.byline = byline;
  if (publishedAt !== undefined) preview.publishedAt = publishedAt;
  if (readingMinutes !== undefined) preview.readingMinutes = readingMinutes;
  return preview;
}

function extractBlocks(
  root: HtmlElement,
  title: string,
  pageUrl: string,
): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  let totalChars = 0;
  let imageCount = 0;
  let tableCount = 0;
  const seenImageSources = new Set<string>();
  const titleKey = normalizeText(title);

  const elements = Array.from(
    root.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, img, table",
    ),
  );
  for (const element of elements) {
    if (blocks.length >= MAX_BLOCKS) break;

    if (element.tagName === "TABLE") {
      if (tableCount >= MAX_TABLES) continue;
      const table = extractTableBlock(element);
      if (!table) continue;
      blocks.push(table);
      tableCount += 1;
      totalChars += table.rows.reduce(
        (sum, row) =>
          sum + row.reduce((rowSum, cell) => rowSum + cell.length, 0),
        0,
      );
      if (totalChars >= MAX_TOTAL_CHARS) break;
      continue;
    }
    if (element.closest("table")) continue;

    if (element.tagName === "IMG") {
      if (imageCount >= MAX_IMAGES) continue;
      const image = extractImageBlock(element, pageUrl);
      if (!image || seenImageSources.has(image.src)) continue;
      seenImageSources.add(image.src);
      blocks.push(image);
      imageCount += 1;
      continue;
    }

    if (element.tagName === "PRE") {
      const text = normalizeCodeText(element.textContent);
      if (text === "") continue;
      const capped = text.slice(0, MAX_BLOCK_CHARS);
      blocks.push({ type: "code", text: capped });
      totalChars += capped.length;
      if (totalChars >= MAX_TOTAL_CHARS) break;
      continue;
    }

    if (element.closest("pre")) continue;
    if (element.closest("li") && element.tagName !== "LI") continue;
    if (element.closest("blockquote") && element.tagName !== "BLOCKQUOTE") {
      continue;
    }

    const type = blockTypeFor(element.tagName);
    const segments = extractInlineSegments(element, pageUrl);
    const text = segments.map((segment) => segment.text).join("");
    if (!isUsefulBlock(type, text)) continue;
    if (type === "heading" && normalizeText(text) === titleKey) continue;
    const lastBlock = blocks[blocks.length - 1];
    if (
      lastBlock &&
      isTextBlock(lastBlock) &&
      textBlockPlainText(lastBlock) === text
    ) {
      continue;
    }

    const cappedSegments = capSegments(segments, MAX_BLOCK_CHARS);
    const cappedText = cappedSegments
      .map((segment) => segment.text)
      .join("");
    if (hasInlineMarks(cappedSegments)) {
      blocks.push({ type, segments: cappedSegments });
    } else {
      blocks.push({ type, text: cappedText });
    }
    totalChars += cappedText.length;
    if (totalChars >= MAX_TOTAL_CHARS) break;
  }

  return blocks;
}

function isTextBlock(
  block: PreviewBlock,
): block is PreviewPlainTextBlock | PreviewRichTextBlock {
  return (
    block.type === "heading" ||
    block.type === "paragraph" ||
    block.type === "list" ||
    block.type === "quote"
  );
}

function textBlockPlainText(
  block: PreviewPlainTextBlock | PreviewRichTextBlock,
): string {
  return "segments" in block
    ? block.segments.map((segment) => segment.text).join("")
    : block.text;
}

interface InlineMarks {
  href?: string;
  strong?: boolean;
  em?: boolean;
  code?: boolean;
}

function extractInlineSegments(
  element: HtmlElement,
  pageUrl: string,
): PreviewSegment[] {
  const raw: PreviewSegment[] = [];
  collectInlineSegments(element, pageUrl, {}, raw);
  return normalizeInlineSegments(raw);
}

function collectInlineSegments(
  node: HtmlNode,
  pageUrl: string,
  marks: InlineMarks,
  out: PreviewSegment[],
): void {
  if (node.nodeType === 3) {
    const text = node.textContent ?? "";
    if (text !== "") out.push({ text, ...marks });
    return;
  }
  if (!isElement(node)) return;

  const element = node;
  const tagName = element.tagName;
  if (
    tagName === "SCRIPT" ||
    tagName === "STYLE" ||
    tagName === "NOSCRIPT" ||
    tagName === "TEMPLATE" ||
    tagName === "SVG" ||
    tagName === "CANVAS" ||
    tagName === "IFRAME" ||
    tagName === "OBJECT" ||
    tagName === "EMBED" ||
    tagName === "FORM" ||
    tagName === "TABLE"
  ) {
    return;
  }
  if (tagName === "BR") {
    out.push({ text: " ", ...marks });
    return;
  }

  let nextMarks = marks;
  if (tagName === "A") {
    const href = resolveInlineHref(element.getAttribute("href"), pageUrl);
    if (href !== "") nextMarks = { ...marks, href };
  } else if (tagName === "STRONG" || tagName === "B") {
    nextMarks = { ...marks, strong: true };
  } else if (tagName === "EM" || tagName === "I") {
    nextMarks = { ...marks, em: true };
  } else if (tagName === "CODE") {
    nextMarks = { ...marks, code: true };
  }

  for (const child of Array.from(element.childNodes)) {
    collectInlineSegments(child, pageUrl, nextMarks, out);
  }
}

/**
 * Resolves relative links and returns only public http(s) URLs.
 * `normalizePreviewUrl` rejects javascript:, data:, credentials, non-standard
 * ports, and private/link-local hosts, so callers never see unsafe schemes.
 */
function resolveInlineHref(
  raw: string | null | undefined,
  pageUrl: string,
): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return "";
  try {
    return normalizePreviewUrl(new URL(trimmed, pageUrl).toString()) ?? "";
  } catch {
    return "";
  }
}

function normalizeInlineSegments(raw: PreviewSegment[]): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  for (const segment of raw) {
    for (const part of segment.text.split(/(\s+)/)) {
      if (part === "") continue;
      appendInlineSegment(out, {
        ...segment,
        text: /^\s+$/.test(part) ? " " : part,
      });
    }
  }
  while (out.length > 0) {
    out[0]!.text = out[0]!.text.replace(/^ +/, "");
    if (out[0]!.text !== "") break;
    out.shift();
  }
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    last.text = last.text.replace(/ +$/, "");
    if (last.text !== "") break;
    out.pop();
  }
  return out;
}

function appendInlineSegment(
  out: PreviewSegment[],
  segment: PreviewSegment,
): void {
  const last = out[out.length - 1];
  if (last && sameInlineMarks(last, segment)) {
    last.text += segment.text;
    return;
  }
  const clean: PreviewSegment = { text: segment.text };
  if (segment.href !== undefined) clean.href = segment.href;
  if (segment.strong) clean.strong = true;
  if (segment.em) clean.em = true;
  if (segment.code) clean.code = true;
  out.push(clean);
}

function sameInlineMarks(a: PreviewSegment, b: PreviewSegment): boolean {
  return (
    a.href === b.href &&
    Boolean(a.strong) === Boolean(b.strong) &&
    Boolean(a.em) === Boolean(b.em) &&
    Boolean(a.code) === Boolean(b.code)
  );
}

function hasInlineMarks(segments: PreviewSegment[]): boolean {
  return segments.some(
    (segment) =>
      segment.href !== undefined ||
      segment.strong === true ||
      segment.em === true ||
      segment.code === true,
  );
}

function capSegments(
  segments: PreviewSegment[],
  maxChars: number,
): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  let length = 0;
  for (const segment of segments) {
    if (length >= maxChars) break;
    const text = segment.text.slice(0, maxChars - length);
    if (text === "") continue;
    out.push({ ...segment, text });
    length += text.length;
  }
  return out;
}

function extractImageBlock(
  image: HtmlElement,
  pageUrl: string,
): PreviewImageBlock | null {
  const width = parseImageDimension(image.getAttribute("width"));
  const height = parseImageDimension(image.getAttribute("height"));
  if (
    (width !== undefined && width <= 2) ||
    (height !== undefined && height <= 2)
  ) {
    return null;
  }

  let resolved = "";
  for (const attribute of [
    "src",
    "data-src",
    "data-lazy-src",
    "data-original",
  ]) {
    resolved = resolveImageUrl(image.getAttribute(attribute), pageUrl);
    if (resolved !== "") break;
  }
  if (resolved === "") {
    const pictureSource = image
      .closest("picture")
      ?.querySelector("source[srcset]");
    for (const srcset of [
      image.getAttribute("srcset"),
      image.getAttribute("data-srcset"),
      pictureSource?.getAttribute("srcset") ?? null,
    ]) {
      resolved = resolveSrcsetUrl(srcset, pageUrl);
      if (resolved !== "") break;
    }
  }
  if (resolved === "") return null;
  if (isDecorativePreviewImageSrc(resolved)) return null;

  const caption = normalizeText(
    image.closest("figure")?.querySelector("figcaption")?.textContent,
  ).slice(0, 300);
  const block: PreviewImageBlock = {
    type: "image",
    src: resolved,
    alt: normalizeText(image.getAttribute("alt")).slice(0, 300),
  };
  if (caption !== "") block.caption = caption;
  if (width !== undefined) block.width = width;
  if (height !== undefined) block.height = height;
  return block;
}

function extractTableBlock(table: HtmlElement): PreviewTableBlock | null {
  if (parentElement(table)?.closest("table")) return null;

  const rows: string[][] = [];
  let header = false;
  for (const row of Array.from(table.querySelectorAll("tr")).slice(
    0,
    MAX_TABLE_ROWS,
  )) {
    if (row.closest("table") !== table) continue;
    const cells = Array.from(row.children)
      .filter((cell) => cell.tagName === "TH" || cell.tagName === "TD")
      .slice(0, MAX_TABLE_COLUMNS)
      .map((cell) =>
        normalizeText(cell.textContent).slice(0, MAX_TABLE_CELL_CHARS),
      );
    if (cells.length === 0) continue;
    if (cells.every((text) => text === "")) continue;
    if (rows.length === 0) {
      header = Array.from(row.children).some((cell) => cell.tagName === "TH");
    }
    rows.push(cells);
  }

  return rows.length > 0 ? { type: "table", header, rows } : null;
}

function resolveImageUrl(
  raw: string | null | undefined,
  pageUrl: string,
): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "" || trimmed.startsWith("data:")) return "";
  try {
    return normalizePreviewUrl(new URL(trimmed, pageUrl).toString()) ?? "";
  } catch {
    return "";
  }
}

/**
 * True for interface chrome that should never become a reader-view figure.
 * Shared with the Markdown fallback mapper so both extractors apply the same
 * avatar/wordmark/badge policy.
 */
export function isDecorativePreviewImageSrc(rawUrl: string): boolean {
  return isAvatarImageSrc(rawUrl) || isDecorativeImageSrc(rawUrl);
}

/**
 * Avatar and profile images are interface chrome, not article figures. They
 * often appear before the content and would otherwise consume the image cap
 * before the real paper/repository figures are reached. Match hosts and paths
 * that exclusively serve avatars rather than guessing from alt text or size.
 */
function isAvatarImageSrc(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "cdn-avatars.huggingface.co") return true;
  if (host === "avatars.githubusercontent.com") return true;
  if (host === "huggingface.co" && url.pathname.startsWith("/avatars/")) {
    return true;
  }
  if (
    (host === "gravatar.com" || host.endsWith(".gravatar.com")) &&
    url.pathname.startsWith("/avatar")
  ) {
    return true;
  }
  if (host === "github.com" && url.pathname.startsWith("/identicons/")) {
    return true;
  }
  return false;
}

/**
 * README badges and wordmarks dominate a reader view when they are stretched
 * to the panel width. They are interface chrome, not article figures.
 */
function isDecorativeImageSrc(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (/\.svgz?$/i.test(url.pathname)) return true;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  return (
    host === "img.shields.io" ||
    host === "badgen.net" ||
    host === "badge.fury.io"
  );
}

function resolveSrcsetUrl(
  srcset: string | null | undefined,
  pageUrl: string,
): string {
  const raw = (srcset ?? "").trim();
  if (raw === "") return "";
  let best = "";
  let bestScore = -1;
  for (const part of raw.split(",")) {
    const [candidate = "", descriptor = ""] = part.trim().split(/\s+/);
    const resolved = resolveImageUrl(candidate, pageUrl);
    if (resolved === "") continue;
    const score = Number.parseFloat(descriptor);
    const normalizedScore = Number.isFinite(score) ? score : 1;
    if (normalizedScore > bestScore) {
      best = resolved;
      bestScore = normalizedScore;
    }
  }
  return best;
}

function parseImageDimension(
  raw: string | null | undefined,
): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10_000) {
    return undefined;
  }
  return parsed;
}

/**
 * Source pages often prefix the article title with their own site chrome
 * ("GitHub - ", "Paper page - "). Strip only on the matching host so a real
 * article title that happens to start with those words is left alone.
 */
function sanitizePreviewTitle(rawTitle: string, pageUrl: string): string {
  const title = rawTitle.trim();
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return title;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let cleaned = title;
  if (host === "github.com") {
    cleaned = cleaned.replace(/^GitHub\s*[-–—]\s*/i, "");
  } else if (host === "huggingface.co" && url.pathname.startsWith("/papers/")) {
    cleaned = cleaned.replace(/^Paper page\s*[-–—]\s*/i, "");
  }
  return cleaned.trim() || title;
}

function isHuggingFacePaperPage(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    return (
      url.hostname.toLowerCase().replace(/^www\./, "") === "huggingface.co" &&
      url.pathname.startsWith("/papers/")
    );
  } catch {
    return false;
  }
}

/**
 * Paper pages mix the abstract with a community thread and citation cards in
 * one document. Start at the "Abstract" section so the reader view keeps the
 * paper itself instead of the surrounding discussion chrome.
 */
function extractHuggingFacePaperByline(document: HtmlDocument): string {
  const nodes = Array.from(document.querySelectorAll(".author, h2"));
  const abstractIndex = nodes.findIndex(
    (element) =>
      element.tagName === "H2" &&
      normalizeText(element.textContent).toLowerCase() === "abstract",
  );
  const stop = abstractIndex === -1 ? nodes.length : abstractIndex;
  const names: string[] = [];
  for (const node of nodes.slice(0, stop)) {
    if (!node.classList.contains("author")) continue;
    const name = normalizeText(node.textContent).replace(/\s*,\s*$/, "");
    if (name !== "" && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return "";
  return names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")}, et al.`;
}

function extractHuggingFacePaperLinks(
  document: HtmlDocument,
  pageUrl: string,
): PreviewSegment[] {
  const heading = findHuggingFaceAbstractHeading(document);
  const container = parentElement(heading)?.nextElementSibling;
  const anchors = container
    ? Array.from(container.querySelectorAll("a[href]"))
    : [];
  const parts: PreviewSegment[] = [];
  for (const anchor of anchors) {
    const label = normalizeText(anchor.textContent);
    // resolveInlineHref only emits public http(s) URLs.
    const href = resolveInlineHref(anchor.getAttribute("href"), pageUrl);
    if (href === "") continue;
    let text = "";
    if (/^View arXiv page/i.test(label)) text = "arXiv abstract";
    else if (/^View PDF/i.test(label)) text = "PDF";
    else if (/^Project page/i.test(label)) text = "Project page";
    else if (/^GitHub\b/i.test(label)) text = "GitHub";
    if (text === "") continue;
    if (parts.length > 0) parts.push({ text: " · " });
    parts.push({ text, href });
  }
  return parts;
}

function extractHuggingFacePaperCitations(
  document: HtmlDocument,
  pageUrl: string,
): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const headings = Array.from(document.querySelectorAll("h2, h3")).filter(
    (element) => {
      const text = normalizeText(element.textContent);
      return (
        /^(Models|Datasets|Spaces) citing this paper/i.test(text) ||
        /^Collections including this paper/i.test(text)
      );
    },
  );
  for (const heading of headings) {
    const title = normalizeText(heading.textContent);
    const container = heading.nextElementSibling;
    if (!container) continue;
    const items: PreviewSegment[] = [];
    for (const anchor of Array.from(container.querySelectorAll("a[href]"))) {
      // resolveInlineHref only emits public http(s) URLs.
      const href = resolveInlineHref(anchor.getAttribute("href"), pageUrl);
      if (href === "") continue;
      const label = normalizeText(
        anchor.querySelector("h4")?.textContent ?? anchor.textContent,
      );
      if (label === "") continue;
      items.push({ text: label, href });
    }
    if (items.length === 0) continue;
    blocks.push({ type: "heading", text: title });
    for (const item of items) {
      blocks.push({ type: "list", segments: [item] });
    }
  }
  return blocks;
}

function findHuggingFaceAbstractHeading(document: HtmlDocument): HtmlElement | null {
  return (
    Array.from(document.querySelectorAll("h2")).find(
      (element) =>
        normalizeText(element.textContent).toLowerCase() === "abstract",
    ) ?? null
  );
}

function pickHuggingFacePaperRoot(document: HtmlDocument): HtmlElement | null {
  const heading = findHuggingFaceAbstractHeading(document);
  const parent = parentElement(heading);
  if (!parent || parent === document.body || parent.tagName === "MAIN") {
    return null;
  }
  return parent;
}

function pickContentRoot(document: HtmlDocument): HtmlElement | null {
  const articles = Array.from(document.querySelectorAll("article"));
  let bestArticle: HtmlElement | null = null;
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

  const candidates: HtmlElement[] = [...articles];
  const main = document.querySelector("main, [role=main]");
  if (main) candidates.push(main);
  // Truncated documents may not expose a <body> element; fall back to <html>
  // so a body cap doesn't turn an extractable prefix into "no content".
  const body = document.body ?? document.querySelector("html");
  if (body) candidates.push(body);
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

function contentScore(element: HtmlElement): number {
  let score = 0;
  element.querySelectorAll("p, li, blockquote").forEach((node) => {
    const length = normalizeText(node.textContent).length;
    if (length >= MIN_PARAGRAPH_CHARS) score += length;
  });
  return score;
}

function blockTypeFor(tagName: string): PreviewTextBlockType {
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
    default:
      return "paragraph";
  }
}

function extractPublishedAt(document: HtmlDocument): string | undefined {
  const candidates = [
    metaContent(document, [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[itemprop="datePublished"]',
      'meta[name="date"]',
    ]),
    normalizeText(
      document.querySelector("time[datetime]")?.getAttribute("datetime"),
    ),
  ];
  for (const candidate of candidates) {
    if (candidate === "") continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}

export function estimateReadingMinutes(
  blocks: PreviewBlock[],
): number | undefined {
  let words = 0;
  for (const block of blocks) {
    if (block.type === "image" || block.type === "code") continue;
    if (block.type === "table") {
      for (const row of block.rows) {
        for (const cell of row) words += countWords(cell);
      }
      continue;
    }
    const text = "segments" in block
      ? block.segments.map((segment) => segment.text).join(" ")
      : block.text;
    words += countWords(text);
  }
  if (words === 0) return undefined;
  return Math.max(1, Math.round(words / 200));
}

function countWords(text: string): number {
  return (
    text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []
  ).length;
}

function isUsefulBlock(type: PreviewTextBlockType, text: string): boolean {
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

function metaContent(document: HtmlDocument, selectors: string[]): string {
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

async function tryPreviewFallback(
  fallback: PreviewFallback,
  input: PreviewFallbackInput,
): Promise<ArticlePreview | null> {
  try {
    const preview = await fallback(input);
    return preview && preview.blocks.length > 0 ? preview : null;
  } catch {
    return null;
  }
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
      throw new PreviewUnavailableError(
        "article redirected too many times",
        "redirect",
      );
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new PreviewUnavailableError(
        "article redirect is missing a location",
        "redirect",
      );
    }
    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new PreviewUnavailableError(
        "article redirected to an invalid URL",
        "redirect",
      );
    }
    const normalized = normalizePreviewUrl(nextUrl);
    if (!normalized) {
      throw new PreviewUnavailableError(
        "article redirected to an unusable URL",
        "redirect",
      );
    }

    await response.body?.cancel().catch(() => {});
    currentUrl = normalized;
  }
}

async function readBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text();
    return {
      text: text.slice(0, maxBytes),
      truncated: text.length > maxBytes,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let out = "";
  let truncated = false;
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = maxBytes - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      if (value.byteLength > remaining) {
        truncated = true;
      }
      bytesRead += chunk.byteLength;
      out += decoder.decode(chunk, { stream: true });
    }
    if (!truncated && bytesRead >= maxBytes) {
      const extra = await reader.read();
      truncated = !extra.done;
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { text: out, truncated };
}

async function readBytesLimited(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes: bytes.slice(0, maxBytes),
      truncated: bytes.byteLength > maxBytes,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let truncated = false;
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = maxBytes - bytesRead;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        bytesRead += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      bytesRead += value.byteLength;
    }
    if (!truncated && bytesRead >= maxBytes) {
      const extra = await reader.read();
      truncated = !extra.done;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}
