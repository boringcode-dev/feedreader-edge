// Workers AI-backed LlmRanker. Tries each model in MODEL_CHAIN in order —
// falling through on error or unparseable output — before giving up. Workers
// AI (env.AI) is a first-party binding (no API key/secret to manage) with a
// 10,000 Neurons/day free allocation, so it's the provider used here instead
// of a third-party gateway like OpenRouter. Model ids below are confirmed
// non-deprecated in Cloudflare's Workers AI catalog as of 2026-06-23 — see
// https://developers.cloudflare.com/workers-ai/models/ before changing them,
// since Workers AI does retire model ids on a published schedule.

import type { FeedItem } from "../../../core/domain.ts";
import type { LlmRanker } from "../../../core/ports.ts";
import { buildRankingPrompt, parseRankedIndices } from "../../../core/personalize/rank.ts";

const MAX_OUTPUT_TOKENS = 512;

type ModelCall = (ai: Ai, prompt: string) => Promise<string>;

function responseText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "response" in result) {
    const response = (result as { response?: unknown }).response;
    if (typeof response === "string") return response;
  }
  return "";
}

// Primary, then three fallbacks of decreasing similarity (different size,
// then a different model vendor entirely) so a single model family outage
// doesn't take down personalization.
const MODEL_CHAIN: ModelCall[] = [
  (ai, prompt) =>
    ai
      .run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_OUTPUT_TOKENS,
      })
      .then(responseText),
  (ai, prompt) =>
    ai
      .run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_OUTPUT_TOKENS,
      })
      .then(responseText),
  (ai, prompt) =>
    ai
      .run("@cf/mistral/mistral-7b-instruct-v0.2-lora", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_OUTPUT_TOKENS,
      })
      .then(responseText),
  (ai, prompt) =>
    ai
      .run("@cf/meta/llama-3.2-3b-instruct", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_OUTPUT_TOKENS,
      })
      .then(responseText),
];

export class CloudflareLlmRanker implements LlmRanker {
  constructor(private readonly ai: Ai) {}

  async rank(items: FeedItem[], interests: string): Promise<number[]> {
    if (items.length === 0 || interests.trim() === "") return [];
    const prompt = buildRankingPrompt(items, interests);

    let lastError: unknown;
    for (const call of MODEL_CHAIN) {
      try {
        const raw = await call(this.ai, prompt);
        const ranked = parseRankedIndices(raw, items.length);
        if (ranked.length > 0) return ranked;
      } catch (error) {
        lastError = error;
      }
    }
    // Every model either errored or returned unparseable output. Throw only
    // if at least one was a genuine error — a clean run of parse failures
    // alone resolves to [] (caller treats that as "no ranking available",
    // not a hard failure).
    if (lastError) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    return [];
  }
}
