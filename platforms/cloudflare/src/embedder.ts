// Workers AI-backed Embedder, used both at ingestion time (core/service.ts's
// refreshOne, embedding each item's title+summary once) and at request time
// (handlePersonalize, embedding the interests string). Same first-party env.AI
// binding as llmRanker.ts — no separate secret/binding to provision.
//
// @cf/baai/bge-base-en-v1.5: 768-dim, mean-pooled by default. Cloudflare's
// own model docs (developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/)
// don't call for a different prefix/instruction on the query side vs the
// document side, so item text and interests text are embedded identically
// here — no asymmetric-retrieval prefix needed. Confirmed non-deprecated as
// of 2026-06-23; check Cloudflare's catalog before changing the model id.

import type { Embedder } from "../../../core/ports.ts";

// Exported so repository.ts can record provenance (embedding_model column)
// without duplicating the model id string.
export const MODEL_ID = "@cf/baai/bge-base-en-v1.5";

export class CloudflareEmbedder implements Embedder {
  constructor(private readonly ai: Ai) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const output = await this.ai.run(MODEL_ID, { text: texts });
    const data = (output as { data?: number[][] }).data;
    if (!Array.isArray(data)) {
      throw new Error(`${MODEL_ID} returned no embedding data`);
    }
    return data;
  }
}
