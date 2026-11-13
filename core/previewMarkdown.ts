// Markdown-to-PreviewBlock mapping for the optional platform fallback (for
// example Workers AI's toMarkdown). The output is the same validated block
// shape as core/preview.ts: no upstream HTML, and every link/image target is
// re-checked by normalizePreviewUrl before it reaches the client.

import {
  isDecorativePreviewImageSrc,
  normalizePreviewUrl,
  type PreviewBlock,
  type PreviewSegment,
  type PreviewTextBlockType,
} from "./preview.ts";

// Keep these bounds in the same ballpark as core/preview.ts. The Markdown
// source is model output, so cap it before it becomes a response payload.
const MAX_BLOCKS = 120;
const MAX_IMAGES = 20;
const MAX_TABLES = 5;
const MAX_TABLE_ROWS = 15;
const MAX_TABLE_COLUMNS = 6;
const MAX_TABLE_CELL_CHARS = 150;
const MAX_BLOCK_CHARS = 4_000;
const MAX_TOTAL_CHARS = 40_000;
const MIN_PARAGRAPH_CHARS = 25;
const MIN_QUOTE_CHARS = 10;
const MIN_LIST_CHARS = 2;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};

const INLINE_TOKEN =
  /(?<!\\)(\*\*[^*\n]+\*\*|(?<![\p{L}\p{N}])__[^_\n]+__(?![\p{L}\p{N}])|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)|<https?:\/\/[^>\s]+>)/gu;

interface InlineMarks {
  href?: string;
  strong?: boolean;
  em?: boolean;
  code?: boolean;
}

interface FenceStart {
  marker: string;
}

interface StandaloneImage {
  alt: string;
  src: string;
}

export interface MarkdownPreviewOptions {
  /** Article URL, used to resolve relative links and images. */
  pageUrl: string;
  /** Skip a heading that repeats the stored article title. */
  title?: string;
}

export function markdownToPreviewBlocks(
  markdown: string,
  options: MarkdownPreviewOptions,
): PreviewBlock[] {
  const normalized = stripLeadingFrontmatter(
    markdown.replace(/\r\n?/g, "\n"),
  );
  const source = stripTrailingJsonLd(normalized);
  const lines = source.split("\n");
  const blocks: PreviewBlock[] = [];
  const seenImages = new Set<string>();
  const titleKey = normalizeText(options.title);
  let totalChars = 0;
  let imageCount = 0;
  let tableCount = 0;

  const addTextBlock = (
    type: PreviewTextBlockType,
    segments: PreviewSegment[],
    minChars: number,
  ): void => {
    const text = segments.map((segment) => segment.text).join("");
    if (text.length < minChars) return;
    if (blocks.length >= MAX_BLOCKS || totalChars >= MAX_TOTAL_CHARS) return;

    const cappedSegments = capSegments(segments, MAX_BLOCK_CHARS);
    const cappedText = cappedSegments
      .map((segment) => segment.text)
      .join("");
    if (cappedText === "") return;

    const last = blocks[blocks.length - 1];
    if (last && textBlockPlainText(last) === cappedText) return;

    if (hasInlineMarks(cappedSegments)) {
      blocks.push({ type, segments: cappedSegments });
    } else {
      blocks.push({ type, text: cappedText });
    }
    totalChars += cappedText.length;
  };

  const addImage = (image: StandaloneImage): void => {
    if (imageCount >= MAX_IMAGES || blocks.length >= MAX_BLOCKS) return;
    const src = resolvePublicUrl(image.src, options.pageUrl);
    if (src === "") return;
    if (seenImages.has(src) || isDecorativePreviewImageSrc(src)) return;
    seenImages.add(src);
    blocks.push({
      type: "image",
      src,
      alt: normalizeText(plainInlineText(image.alt)).slice(0, 300),
    });
    imageCount += 1;
  };

  let index = 0;
  while (
    index < lines.length &&
    blocks.length < MAX_BLOCKS &&
    totalChars < MAX_TOTAL_CHARS
  ) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = parseFenceStart(line);
    if (fence) {
      const code = readCodeFence(lines, index, fence);
      index = code.nextIndex;
      const text = code.text.slice(0, MAX_BLOCK_CHARS);
      if (text !== "" && blocks.length < MAX_BLOCKS) {
        blocks.push({ type: "code", text });
        totalChars += text.length;
      }
      continue;
    }

    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const text = plainInlineText(heading[1] ?? "");
      if (text !== "" && normalizeText(text) !== titleKey) {
        addTextBlock("heading", [{ text }], 1);
      }
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      if (tableCount < MAX_TABLES) {
        const table = buildTable(lines, index);
        if (table) {
          blocks.push(table.block);
          tableCount += 1;
          totalChars += table.chars;
        }
      }
      index = consumeTable(lines, index);
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      let text = "";
      while (index < lines.length) {
        const quoteMatch = /^ {0,3}>\s?(.*)$/.exec(lines[index]!);
        if (!quoteMatch) break;
        text += `${quoteMatch[1] ?? ""} `;
        index += 1;
      }
      addTextBlock(
        "quote",
        parseInlineSegments(text, options.pageUrl),
        MIN_QUOTE_CHARS,
      );
      continue;
    }

    if (isListItemLine(line)) {
      const item = parseListItem(lines, index);
      if (item) {
        const text = item.text.replace(/^\[[ xX]\]\s+/, "");
        addTextBlock(
          "list",
          parseInlineSegments(text, options.pageUrl),
          MIN_LIST_CHARS,
        );
      }
      index = item?.nextIndex ?? index + 1;
      continue;
    }

    const standaloneImage = parseStandaloneImage(line);
    if (standaloneImage) {
      addImage(standaloneImage);
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index]!;
      if (current.trim() === "") break;
      if (paragraphLines.length > 0 && isBlockStart(lines, index)) break;
      paragraphLines.push(current.trim());
      index += 1;
    }
    const paragraph = extractInlineImages(
      paragraphLines.join(" "),
      options.pageUrl,
    );
    for (const image of paragraph.images) addImage(image);
    addTextBlock(
      "paragraph",
      parseInlineSegments(paragraph.text, options.pageUrl),
      MIN_PARAGRAPH_CHARS,
    );
  }

  return blocks;
}

function readCodeFence(
  lines: string[],
  start: number,
  fence: FenceStart,
): { text: string; nextIndex: number } {
  const content: string[] = [];
  let index = start + 1;
  while (index < lines.length && !isFenceClose(lines[index]!, fence.marker)) {
    content.push(lines[index]!);
    index += 1;
  }
  if (index < lines.length) index += 1;
  return {
    text: content.join("\n").replace(/\s+$/, ""),
    nextIndex: index,
  };
}

function parseFenceStart(line: string): FenceStart | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return match ? { marker: match[1]! } : null;
}

function isFenceClose(line: string, marker: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  const char = marker[0]!;
  for (const candidate of trimmed) {
    if (candidate !== char) return false;
  }
  return true;
}

function isHorizontalRule(line: string): boolean {
  const compact = line.trim().replace(/[ \t]/g, "");
  return compact.length >= 3 && /^(?:\*+|_+|-+)$/.test(compact);
}

function isListItemLine(line: string): boolean {
  return /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/.test(line);
}

function parseListItem(
  lines: string[],
  start: number,
): { text: string; nextIndex: number } | null {
  const match = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[start]!);
  if (!match) return null;

  let text = match[1] ?? "";
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") break;
    if (isListItemLine(line) || isBlockStart(lines, index)) break;
    if (!/^\s{2,}\S/.test(line)) break;
    text += ` ${line.trim()}`;
    index += 1;
  }
  return { text, nextIndex: index };
}

function isTableStart(lines: string[], index: number): boolean {
  const line = lines[index];
  const next = lines[index + 1];
  if (!line || !next || !line.includes("|")) return false;
  return isTableSeparator(next);
}

function isTableSeparator(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function consumeTable(lines: string[], start: number): number {
  let index = start + 2;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "" || !line.includes("|")) break;
    index += 1;
  }
  return index;
}

function buildTable(
  lines: string[],
  start: number,
): { block: PreviewBlock; chars: number } | null {
  const rows: string[][] = [];
  let chars = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === "" || !line.includes("|")) break;
    if (index === start + 1) continue;
    const row = splitTableRow(line)
      .slice(0, MAX_TABLE_COLUMNS)
      .map((cell) =>
        plainInlineText(cell).slice(0, MAX_TABLE_CELL_CHARS),
      );
    if (row.length === 0 || row.every((cell) => cell === "")) continue;
    rows.push(row);
    chars += row.reduce((sum, cell) => sum + cell.length, 0);
    if (rows.length >= MAX_TABLE_ROWS) break;
  }
  if (rows.length === 0) return null;
  return { block: { type: "table", header: true, rows }, chars };
}

function splitTableRow(line: string): string[] {
  let raw = line.trim();
  if (raw.startsWith("|")) raw = raw.slice(1);
  if (raw.endsWith("|") && !raw.endsWith("\\|")) {
    raw = raw.slice(0, -1);
  }
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && raw[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function parseStandaloneImage(line: string): StandaloneImage | null {
  const match =
    /^ {0,3}!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)\s*$/.exec(line);
  if (!match) return null;
  return { alt: match[1] ?? "", src: match[2] ?? "" };
}

function extractInlineImages(
  raw: string,
  pageUrl: string,
): { text: string; images: StandaloneImage[] } {
  const images: StandaloneImage[] = [];
  const text = raw.replace(
    /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g,
    (_match, alt: string, src: string) => {
      images.push({ alt, src });
      return " ";
    },
  );
  // Resolve here only to drop obviously unusable sources early; addImage does
  // the authoritative validation and deduplication.
  return {
    text,
    images: images.filter((image) => resolvePublicUrl(image.src, pageUrl) !== ""),
  };
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index]!;
  if (line.trim() === "") return true;
  if (parseFenceStart(line)) return true;
  if (/^ {0,3}#{1,6}\s+/.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (isListItemLine(line)) return true;
  if (isHorizontalRule(line)) return true;
  if (isTableStart(lines, index)) return true;
  return parseStandaloneImage(line) !== null;
}

function parseInlineSegments(
  raw: string,
  pageUrl: string,
  marks: InlineMarks = {},
): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  let lastIndex = 0;
  for (const match of raw.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      appendText(out, raw.slice(lastIndex, index), marks);
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      out.push(
        ...parseInlineSegments(token.slice(2, -2), pageUrl, {
          ...marks,
          strong: true,
        }),
      );
    } else if (token.startsWith("__") && token.endsWith("__")) {
      out.push(
        ...parseInlineSegments(token.slice(2, -2), pageUrl, {
          ...marks,
          strong: true,
        }),
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      out.push(
        ...parseInlineSegments(token.slice(1, -1), pageUrl, {
          ...marks,
          em: true,
        }),
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      appendSegment(out, { ...marks, text: token.slice(1, -1), code: true });
    } else {
      const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(token);
      if (link) {
        const href = resolvePublicUrl(link[2] ?? "", pageUrl);
        out.push(
          ...parseInlineSegments(
            link[1] ?? "",
            pageUrl,
            href === "" ? marks : { ...marks, href },
          ),
        );
      } else {
        const autolink = /^<(https?:\/\/[^>\s]+)>$/.exec(token);
        if (autolink) {
          const href = resolvePublicUrl(autolink[1] ?? "", pageUrl);
          appendText(
            out,
            autolink[1] ?? "",
            href === "" ? marks : { ...marks, href },
          );
        } else {
          appendText(out, token, marks);
        }
      }
    }
    lastIndex = index + token.length;
  }
  if (lastIndex < raw.length) appendText(out, raw.slice(lastIndex), marks);
  trimSegments(out);
  return out;
}

function appendText(
  out: PreviewSegment[],
  raw: string,
  marks: InlineMarks,
): void {
  const text = unescapeMarkdown(decodeHtmlEntities(raw)).replace(/\s+/g, " ");
  if (text === "") return;
  appendSegment(out, { ...marks, text });
}

function appendSegment(out: PreviewSegment[], segment: PreviewSegment): void {
  if (segment.text === "") return;
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

function trimSegments(segments: PreviewSegment[]): void {
  while (segments.length > 0) {
    segments[0]!.text = segments[0]!.text.replace(/^ +/, "");
    if (segments[0]!.text !== "") break;
    segments.shift();
  }
  while (segments.length > 0) {
    const last = segments[segments.length - 1]!;
    last.text = last.text.replace(/ +$/, "");
    if (last.text !== "") break;
    segments.pop();
  }
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

function hasInlineMarks(segments: PreviewSegment[]): boolean {
  return segments.some(
    (segment) =>
      segment.href !== undefined ||
      segment.strong === true ||
      segment.em === true ||
      segment.code === true,
  );
}

function textBlockPlainText(block: PreviewBlock): string | null {
  if (
    block.type !== "heading" &&
    block.type !== "paragraph" &&
    block.type !== "list" &&
    block.type !== "quote"
  ) {
    return null;
  }
  return "segments" in block
    ? block.segments.map((segment) => segment.text).join("")
    : block.text;
}

function plainInlineText(raw: string): string {
  let text = raw;
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, "$1");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  return normalizeText(unescapeMarkdown(decodeHtmlEntities(text)));
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, "$1");
}

function resolvePublicUrl(raw: string, pageUrl: string): string {
  const trimmed = decodeHtmlEntities(raw)
    .trim()
    .replace(/^</, "")
    .replace(/>$/, "");
  if (trimmed === "") return "";
  try {
    return normalizePreviewUrl(new URL(trimmed, pageUrl).toString()) ?? "";
  } catch {
    return "";
  }
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity: string) => {
      const key = entity.toLowerCase();
      if (key.startsWith("#x")) {
        return codePoint(match, Number.parseInt(key.slice(2), 16));
      }
      if (key.startsWith("#")) {
        return codePoint(match, Number.parseInt(key.slice(1), 10));
      }
      return HTML_ENTITIES[key] ?? match;
    },
  );
}

function codePoint(fallback: string, value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) {
    return fallback;
  }
  return String.fromCodePoint(value);
}

/**
 * Browser Run prefixes Markdown with YAML frontmatter when the page exposes
 * metadata. Strip a leading `---` block only when it contains at least one
 * `key:` line, so a document that starts with a horizontal rule is left
 * alone.
 */
function stripLeadingFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return markdown;
  const frontmatter = markdown.slice(4, end);
  if (!/^[A-Za-z0-9_-]+:/m.test(frontmatter)) return markdown;
  const after = markdown.slice(end + 4);
  if (after !== "" && !after.startsWith("\n")) return markdown;
  return after.replace(/^\n+/, "");
}

/**
 * HTML conversion appends the page's JSON-LD at the end of the Markdown.
 * Remove only a trailing JSON-LD-shaped object/array so a legitimate JSON
 * code sample elsewhere in the article is left alone. Limit how many opening
 * braces are tried so a long PDF with many braces cannot make this quadratic.
 */
function stripTrailingJsonLd(markdown: string): string {
  const fenced = /```(?:json)?[ \t]*\n([\s\S]*?)\n```\s*$/i.exec(markdown);
  if (fenced && isJsonLd(fenced[1] ?? "")) {
    return markdown.slice(0, fenced.index).trimEnd();
  }

  const leading = markdown.trimStart();
  if (leading.startsWith("{") && isJsonLd(leading.trim())) {
    return "";
  }

  let start = markdown.lastIndexOf("\n{");
  for (let attempts = 0; start !== -1 && attempts < 5; attempts += 1) {
    const candidate = markdown.slice(start + 1).trim();
    if (isJsonLd(candidate)) return markdown.slice(0, start).trimEnd();
    start = markdown.lastIndexOf("\n{", start - 1);
  }
  return markdown;
}

function isJsonLd(text: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return false;
  }
  return hasJsonLdShape(parsed);
}

function hasJsonLdShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => hasJsonLdShape(entry));
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["@context"] !== undefined || typeof record["@type"] === "string"
  );
}
