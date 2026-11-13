// Shared helpers for the platform preview fallbacks (Workers AI Markdown
// conversion and Browser Run). Both adapters return the same PreviewBlock
// shape and need the same title/host derivation and bounded waits.

import type { PreviewBlock } from "../../../core/preview.ts";

export const PREVIEW_TITLE_MAX_CHARS = 200;
const MAX_LOG_ERROR_CHARS = 300;

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function errorMessage(
  error: unknown,
  maxChars = MAX_LOG_ERROR_CHARS,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, maxChars);
}

export function firstHeading(blocks: PreviewBlock[]): string {
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    const text =
      "segments" in block
        ? block.segments.map((segment) => segment.text).join("")
        : block.text;
    const trimmed = text.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}

export function hostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function previewTitle(
  titleHint: string,
  blocks: PreviewBlock[],
): string {
  return (
    titleHint.trim().slice(0, PREVIEW_TITLE_MAX_CHARS) ||
    firstHeading(blocks) ||
    "Article preview"
  );
}
