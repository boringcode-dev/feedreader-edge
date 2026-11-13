// Workers AI Markdown Conversion fallback for previews the built-in
// extractor cannot read: PDFs/Office documents and HTML pages with no
// readable blocks (often a JavaScript shell) or a body truncated before the
// content. Core passes only validated URLs and bounded bytes; this adapter
// turns the converted Markdown back into the same PreviewBlock shape.
//
// The AI binding has no request-level timeout, so race the conversion.
// Failures are logged and return null, which preserves the original preview
// failure reason instead of turning an optional enhancement into an error.

import {
  estimateReadingMinutes,
  type ArticlePreview,
  type PreviewBlock,
  type PreviewFallbackInput,
} from "../../../core/preview.ts";
import { markdownToPreviewBlocks } from "../../../core/previewMarkdown.ts";
import type { Env } from "./env.d.ts";
import {
  errorMessage,
  hostLabel,
  previewTitle,
  withTimeout,
} from "./previewFallbackUtils.ts";

const AI_TIMEOUT_MS = 10_000;

// toMarkdown also accepts images, but turning a standalone image into an AI
// description is not a useful article preview and can consume the Workers AI
// allocation. Keep the fallback on document formats.
const AI_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.apple.numbers",
  "application/vnd.ms-excel",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/xml",
  "text/csv",
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  bmp: "image/bmp",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const MIME_TYPE_EXTENSIONS: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_MIME_TYPES).map(([extension, mimeType]) => [
    mimeType,
    extension,
  ]),
);

/**
 * Returns null when the AI conversion fails, times out, or produces no
 * previewable blocks. `titleHint` is the stored feed-item title.
 */
export async function aiPreviewFallback(
  env: Env,
  input: PreviewFallbackInput,
  titleHint: string,
): Promise<ArticlePreview | null> {
  const fallbackFlag = (env.FEEDREADER_AI_PREVIEW_FALLBACK ?? "true")
    .trim()
    .toLowerCase();
  if (fallbackFlag === "false") return null;

  const startedAt = Date.now();
  const mimeType = normalizeMimeType(input.contentType, input.url);
  if (input.bytes && !AI_DOCUMENT_MIME_TYPES.has(mimeType)) {
    return null;
  }
  try {
    const document = buildMarkdownDocument(input, mimeType);
    if (!document) return null;

    const result = await withTimeout(
      env.AI.toMarkdown(document, {
        conversionOptions: {
          html: {
            hostname: input.url,
            images: { convert: false },
          },
          pdf: { metadata: false, images: { convert: false } },
        },
      }),
      AI_TIMEOUT_MS,
      "AI Markdown conversion timed out",
    );

    if (result.format === "error") {
      logFallback(input, mimeType, startedAt, {
        outcome: "error",
        error: result.error,
      });
      return null;
    }

    const blocks = cleanConvertedBlocks(
      markdownToPreviewBlocks(result.data, {
        pageUrl: input.url,
        title: titleHint,
      }),
      document.name,
      mimeType === "application/pdf",
    );
    if (blocks.length === 0) {
      logFallback(input, mimeType, startedAt, {
        outcome: "empty",
        tokens: result.tokens,
      });
      return null;
    }

    const readingMinutes = estimateReadingMinutes(blocks);
    const preview: ArticlePreview = {
      title: previewTitle(titleHint, blocks),
      siteName: hostLabel(input.url),
      blocks,
    };
    if (readingMinutes !== undefined) preview.readingMinutes = readingMinutes;
    logFallback(input, mimeType, startedAt, {
      outcome: "ok",
      blocks: blocks.length,
      tokens: result.tokens,
    });
    return preview;
  } catch (error) {
    logFallback(input, mimeType, startedAt, {
      outcome: "error",
      error: errorMessage(error),
    });
    return null;
  }
}

function buildMarkdownDocument(
  input: PreviewFallbackInput,
  mimeType: string,
): MarkdownDocument | null {
  if (input.bytes) {
    return {
      name: documentName(mimeType),
      blob: new Blob([input.bytes], { type: mimeType }),
    };
  }
  if (input.html !== undefined) {
    return {
      name: "article.html",
      blob: new Blob([input.html], { type: "text/html" }),
    };
  }
  return null;
}

function normalizeMimeType(contentType: string, pageUrl: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    base !== "" &&
    base !== "application/octet-stream" &&
    base !== "binary/octet-stream"
  ) {
    return base;
  }
  const extension = urlExtension(pageUrl);
  const inferred = extension ? EXTENSION_MIME_TYPES[extension] : undefined;
  return inferred ?? (base !== "" ? base : "application/octet-stream");
}

function documentName(mimeType: string): string {
  if (mimeType === "text/html") return "article.html";
  const extension = MIME_TYPE_EXTENSIONS[mimeType];
  return extension ? `article.${extension}` : "article.bin";
}

function urlExtension(rawUrl: string): string {
  try {
    return /\.([a-z0-9]+)$/i.exec(new URL(rawUrl).pathname)?.[1]?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

/**
 * PDF conversion emits a heading for the uploaded filename and for each page
 * ("Page 1", "Page 2", ...). Neither is article content; drop them so the
 * reader view starts with the paper's text.
 */
function cleanConvertedBlocks(
  blocks: PreviewBlock[],
  documentName: string,
  isPdf: boolean,
): PreviewBlock[] {
  const nameKey = documentName.trim().toLowerCase();
  return blocks.filter((block) => {
    const text = blockPlainText(block);
    if (text === null) return true;
    const trimmed = text.trim();
    if (nameKey !== "" && trimmed.toLowerCase() === nameKey) return false;
    if (isPdf && /^page\s+\d+(?:\s+of\s+\d+)?$/i.test(trimmed)) {
      return false;
    }
    return true;
  });
}

function blockPlainText(block: PreviewBlock): string | null {
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

function logFallback(
  input: PreviewFallbackInput,
  mimeType: string,
  startedAt: number,
  result: {
    outcome: "ok" | "empty" | "error";
    blocks?: number;
    tokens?: number;
    error?: string;
  },
): void {
  const entry: Record<string, unknown> = {
    event: "preview_ai_fallback",
    kind: input.kind,
    url: input.url,
    content_type: mimeType,
    outcome: result.outcome,
    ms: Date.now() - startedAt,
  };
  if (result.blocks !== undefined) entry.blocks = result.blocks;
  if (result.tokens !== undefined) entry.tokens = result.tokens;
  if (result.error !== undefined) entry.error = result.error;
  const line = JSON.stringify(entry);
  if (result.outcome === "ok") console.log(line);
  else console.warn(line);
}
