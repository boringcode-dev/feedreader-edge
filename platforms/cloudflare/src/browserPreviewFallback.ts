// Browser Run fallback for the narrow case where an HTML page has no
// readable blocks even after Workers AI conversion: usually a JavaScript
// shell whose content only exists after the page executes. Quick Actions
// render the page in a real browser and return Markdown; the mapper then
// applies the same URL/block validation as the other extractors.
//
// Workers Free includes 10 browser-minutes/day and paces Quick Actions to
// one request per 10 seconds. This adapter runs only on a preview cache miss
// after the static extractor and AI fallback both found nothing; successes
// are cached for 30 minutes by the preview handler. A 429 is logged and
// treated as "no preview" rather than an error.

import {
  estimateReadingMinutes,
  normalizePreviewUrl,
  type ArticlePreview,
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

const BROWSER_TIMEOUT_MS = 9_000;
const BROWSER_GOTO_TIMEOUT_MS = 8_000;
const REJECTED_RESOURCE_TYPES: BrowserRunResourceType[] = [
  "image",
  "media",
  "font",
];
// Quick Actions do not support session guardrails. Block literal private
// hosts at the request layer and re-check meta.finalUrl below; the
// stored-item allowlist remains the primary SSRF boundary.
const PRIVATE_HOST_REQUEST_PATTERN =
  "/^https?:\\/\\/(?:localhost|127\\.|0\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(?:1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|\\[f[cd])/";

export async function browserPreviewFallback(
  env: Env,
  input: PreviewFallbackInput,
  titleHint: string,
): Promise<ArticlePreview | null> {
  if (!isBrowserFallbackEnabled(env.FEEDREADER_BROWSER_PREVIEW_FALLBACK)) {
    return null;
  }
  if (input.kind !== "no_content") return null;

  const startedAt = Date.now();
  try {
    const response = await withTimeout(
      env.BROWSER.quickAction("markdown", {
        url: input.url,
        gotoOptions: {
          timeout: BROWSER_GOTO_TIMEOUT_MS,
          // SPAs finish rendering after the initial DOM load; wait for the
          // network to settle, but let bestAttempt return a partial page if
          // the site keeps polling and never reaches idle.
          waitUntil: "networkidle2",
        },
        actionTimeout: BROWSER_GOTO_TIMEOUT_MS,
        bestAttempt: true,
        rejectResourceTypes: REJECTED_RESOURCE_TYPES,
        rejectRequestPattern: [PRIVATE_HOST_REQUEST_PATTERN],
      }),
      BROWSER_TIMEOUT_MS,
      "Browser Run markdown timed out",
    );

    const browserMs = parseHeaderInt(response.headers.get("x-browser-ms-used"));
    const payload = (await response.json().catch(() => null)) as
      | BrowserRunMarkdownSuccessResponse
      | BrowserRunErrorResponse
      | null;

    if (!response.ok || payload === null || payload.success !== true) {
      const detail =
        payload !== null && payload.success === false
          ? payload.errors.map((entry) => entry.message).join("; ")
          : `HTTP ${response.status}`;
      logBrowserFallback(input, startedAt, {
        outcome: "error",
        status: response.status,
        browserMs,
        error: detail,
      });
      return null;
    }

    const pageStatus = payload.meta.status;
    if (pageStatus < 200 || pageStatus >= 300) {
      logBrowserFallback(input, startedAt, {
        outcome: "error",
        status: response.status,
        pageStatus,
        browserMs,
        error: `upstream status ${pageStatus}`,
      });
      return null;
    }

    const finalUrl = normalizePreviewUrl(payload.meta.finalUrl ?? input.url);
    if (!finalUrl) {
      logBrowserFallback(input, startedAt, {
        outcome: "error",
        status: response.status,
        pageStatus,
        browserMs,
        error: "unusable final URL",
      });
      return null;
    }

    const blocks = markdownToPreviewBlocks(payload.result, {
      pageUrl: finalUrl,
      title: titleHint,
    });
    if (blocks.length === 0) {
      logBrowserFallback(input, startedAt, {
        outcome: "empty",
        status: response.status,
        pageStatus,
        browserMs,
      });
      return null;
    }

    const readingMinutes = estimateReadingMinutes(blocks);
    const preview: ArticlePreview = {
      title: previewTitle(titleHint, blocks),
      siteName: hostLabel(finalUrl),
      blocks,
    };
    if (readingMinutes !== undefined) preview.readingMinutes = readingMinutes;
    logBrowserFallback(input, startedAt, {
      outcome: "ok",
      status: response.status,
      pageStatus,
      browserMs,
      blocks: blocks.length,
    });
    return preview;
  } catch (error) {
    logBrowserFallback(input, startedAt, {
      outcome: "error",
      error: errorMessage(error),
    });
    return null;
  }
}

function isBrowserFallbackEnabled(raw: string | undefined): boolean {
  return (raw ?? "true").trim().toLowerCase() !== "false";
}

function parseHeaderInt(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

function logBrowserFallback(
  input: PreviewFallbackInput,
  startedAt: number,
  result: {
    outcome: "ok" | "empty" | "error";
    status?: number;
    pageStatus?: number;
    browserMs?: number;
    blocks?: number;
    error?: string;
  },
): void {
  const entry: Record<string, unknown> = {
    event: "preview_browser_fallback",
    kind: input.kind,
    url: input.url,
    outcome: result.outcome,
    ms: Date.now() - startedAt,
  };
  if (result.status !== undefined) entry.status = result.status;
  if (result.pageStatus !== undefined) entry.page_status = result.pageStatus;
  if (result.browserMs !== undefined) entry.browser_ms = result.browserMs;
  if (result.blocks !== undefined) entry.blocks = result.blocks;
  if (result.error !== undefined) entry.error = result.error;
  const line = JSON.stringify(entry);
  if (result.outcome === "ok") console.log(line);
  else console.warn(line);
}
