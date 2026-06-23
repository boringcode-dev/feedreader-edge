import type { FeedItem } from "../../domain.ts";
import type { LlmRanker } from "../../ports.ts";

/** In-memory LlmRanker for tests — no network calls. `script` decides the
 * returned ranking (or throws, to simulate a transport/availability failure). */
export class FakeLlmRanker implements LlmRanker {
  constructor(
    private readonly script: (
      items: FeedItem[],
      interests: string,
    ) => number[],
  ) {}

  async rank(items: FeedItem[], interests: string): Promise<number[]> {
    return this.script(items, interests);
  }
}
