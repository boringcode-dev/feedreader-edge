import type { Embedder } from "../../ports.ts";

/** In-memory Embedder for tests — no network calls. `script` decides the
 * returned vectors (or throws, to simulate a transport/availability
 * failure), same pattern as FakeLlmRanker. */
export class FakeEmbedder implements Embedder {
  readonly calls: string[][] = [];

  constructor(private readonly script: (texts: string[]) => number[][]) {}

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return this.script(texts);
  }
}
