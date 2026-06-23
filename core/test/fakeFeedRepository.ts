import type { FeedItem, SyncState } from "../domain.ts";
import type { FeedRepository } from "../ports.ts";

interface SaveSnapshotCall {
  source: string;
  fetchedAtIso: string;
  items: FeedItem[];
  embeddings: Map<string, number[]>;
}

interface ListEmbeddedKeysCall {
  source: string;
  externalIds: string[];
}

/** In-memory FeedRepository for tests — no D1/network. Records
 * saveSnapshot/listEmbeddedKeys calls for assertions and lets tests
 * pre-seed which (source, externalId) pairs already have a stored
 * embedding, so refreshOne's "only embed what's missing" logic can be
 * exercised without a real database. */
export class FakeFeedRepository implements FeedRepository {
  readonly saveSnapshotCalls: SaveSnapshotCall[] = [];
  readonly listEmbeddedKeysCalls: ListEmbeddedKeysCall[] = [];
  private readonly embeddedKeys: Set<string>;

  constructor(preEmbedded: { source: string; externalId: string }[] = []) {
    this.embeddedKeys = new Set(
      preEmbedded.map(({ source, externalId }) => `${source} ${externalId}`),
    );
  }

  async saveSnapshot(
    source: string,
    fetchedAtIso: string,
    items: FeedItem[],
    embeddings: Map<string, number[]>,
  ): Promise<void> {
    this.saveSnapshotCalls.push({ source, fetchedAtIso, items, embeddings });
  }

  async recordFailure(): Promise<void> {}

  async listSourceStates(): Promise<Record<string, SyncState>> {
    return {};
  }

  async getCurrentItems(): Promise<FeedItem[]> {
    return [];
  }

  async listFeedItems(): Promise<FeedItem[]> {
    return [];
  }

  async countTotalItems(): Promise<number> {
    return 0;
  }

  async listEmbeddedKeys(
    source: string,
    externalIds: string[],
  ): Promise<Set<string>> {
    this.listEmbeddedKeysCalls.push({ source, externalIds });
    const out = new Set<string>();
    for (const externalId of externalIds) {
      if (this.embeddedKeys.has(`${source} ${externalId}`)) {
        out.add(externalId);
      }
    }
    return out;
  }

  async listFeedItemsForRanking(): Promise<{
    items: FeedItem[];
    embeddings: Map<string, number[]>;
  }> {
    return { items: [], embeddings: new Map() };
  }
}
