// Preview fallback order: Workers AI Markdown conversion first (PDFs/Office
// documents and static HTML), then Browser Run for JavaScript-rendered pages
// that still produced no blocks. Core receives one injected fallback.

import type { PreviewFallback } from "../../../core/preview.ts";
import { browserPreviewFallback } from "./browserPreviewFallback.ts";
import type { Env } from "./env.d.ts";
import { aiPreviewFallback } from "./previewFallback.ts";

export function createPreviewFallback(
  env: Env,
  titleHint: string,
): PreviewFallback | undefined {
  const aiEnabled = isEnabled(env.FEEDREADER_AI_PREVIEW_FALLBACK);
  const browserEnabled = isEnabled(env.FEEDREADER_BROWSER_PREVIEW_FALLBACK);
  if (!aiEnabled && !browserEnabled) return undefined;

  return async (input) => {
    if (aiEnabled) {
      const aiPreview = await aiPreviewFallback(env, input, titleHint);
      if (aiPreview) return aiPreview;
    }
    if (browserEnabled) {
      return browserPreviewFallback(env, input, titleHint);
    }
    return null;
  };
}

function isEnabled(raw: string | undefined): boolean {
  return (raw ?? "true").trim().toLowerCase() !== "false";
}
