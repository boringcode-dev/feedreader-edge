// D1-backed FeedRepository. Mirrors internal/repository/sqlite.go: SQL
// handles source/search filtering (same as the Go app's WHERE clause);
// sorting and pagination happen in application memory via the shared
// core/sources/listInMemory.ts helpers, not in SQL — same design as Go's
// ListFeedItems, for the same reason (the dataset is small).

import type { FeedItem, SyncState } from "../../../core/domain.ts";
import type { FeedRepository } from "../../../core/ports.ts";
import { paginate, sortFeedItems } from "../../../core/sources/listInMemory.ts";

interface ItemRow {
  source: string;
  external_id: string;
  title: string;
  url: string;
  summary: string | null;
  author: string | null;
  score: number | null;
  comments_url: string | null;
  published_at: string | null;
  source_rank: number;
  metadata_json: string;
  first_seen_at: string;
}

interface SyncStateRow {
  source: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  item_count: number;
}

const ITEM_COLUMNS =
  "source, external_id, title, url, summary, author, score, comments_url, published_at, source_rank, metadata_json, first_seen_at";

export class D1Repository implements FeedRepository {
  constructor(private readonly db: D1Database) {}

  async saveSnapshot(
    source: string,
    fetchedAtIso: string,
    items: FeedItem[],
  ): Promise<void> {
    const upsertItem = this.db.prepare(`
      INSERT INTO items (
        source, external_id, title, url, summary, author, score, comments_url,
        published_at, source_rank, metadata_json, first_seen_at, last_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, external_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        summary = excluded.summary,
        author = excluded.author,
        score = excluded.score,
        comments_url = excluded.comments_url,
        published_at = coalesce(items.published_at, excluded.published_at),
        source_rank = excluded.source_rank,
        metadata_json = excluded.metadata_json,
        last_seen_at = excluded.last_seen_at,
        updated_at = items.updated_at
    `);
    const statements = items.map((item) =>
      upsertItem.bind(
        item.source,
        item.externalId,
        item.title,
        item.url,
        item.summary ?? null,
        item.author ?? null,
        item.score ?? null,
        item.commentsUrl ?? null,
        item.publishedAt ?? null,
        item.sourceRank,
        JSON.stringify(item.metadata ?? {}),
        fetchedAtIso,
        fetchedAtIso,
        fetchedAtIso,
      ),
    );

    const upsertSyncState = this.db
      .prepare(
        `
      INSERT INTO sync_state (source, last_attempt_at, last_success_at, last_error, item_count)
      VALUES (?, ?, ?, NULL, ?)
      ON CONFLICT(source) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = excluded.last_success_at,
        last_error = NULL,
        item_count = excluded.item_count
    `,
      )
      .bind(source, fetchedAtIso, fetchedAtIso, items.length);

    await this.db.batch([...statements, upsertSyncState]);
  }

  async recordFailure(
    source: string,
    attemptedAtIso: string,
    message: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `
      INSERT INTO sync_state (source, last_attempt_at, last_success_at, last_error, item_count)
      VALUES (?, ?, NULL, ?, 0)
      ON CONFLICT(source) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_error = excluded.last_error
    `,
      )
      .bind(source, attemptedAtIso, message.slice(0, 500))
      .run();
  }

  async listSourceStates(): Promise<Record<string, SyncState>> {
    const { results } = await this.db
      .prepare(
        `SELECT source, last_attempt_at, last_success_at, last_error, item_count FROM sync_state`,
      )
      .all<SyncStateRow>();
    const out: Record<string, SyncState> = {};
    for (const row of results) {
      out[row.source] = {
        source: row.source,
        lastAttemptAt: row.last_attempt_at ?? undefined,
        lastSuccessAt: row.last_success_at ?? undefined,
        lastError: row.last_error ?? undefined,
        itemCount: row.item_count,
      };
    }
    return out;
  }

  async getCurrentItems(source: string, limit: number): Promise<FeedItem[]> {
    const { results } = await this.db
      .prepare(
        `
      SELECT ${ITEM_COLUMNS}
      FROM items
      WHERE source = ?
        AND last_seen_at = (SELECT last_success_at FROM sync_state WHERE source = ?)
      ORDER BY source_rank ASC
      LIMIT ?
    `,
      )
      .bind(source, source, limit)
      .all<ItemRow>();
    return results.map(rowToFeedItem);
  }

  async listFeedItems(
    limit: number,
    offset: number,
    source: string,
    sources: string[],
    searchQuery: string,
  ): Promise<FeedItem[]> {
    let query = `SELECT ${ITEM_COLUMNS} FROM items`;
    const conditions: string[] = [];
    const args: unknown[] = [];

    const trimmedSource = source.trim();
    if (trimmedSource !== "") {
      conditions.push("source = ?");
      args.push(trimmedSource);
    } else if (sources.length > 0) {
      conditions.push(`source IN (${sources.map(() => "?").join(",")})`);
      args.push(...sources);
    }

    for (const term of searchTermsSql(searchQuery)) {
      conditions.push(
        "(lower(title) LIKE ? ESCAPE '\\' OR lower(coalesce(summary, '')) LIKE ? ESCAPE '\\' " +
          "OR lower(coalesce(author, '')) LIKE ? ESCAPE '\\' OR lower(url) LIKE ? ESCAPE '\\' " +
          "OR lower(coalesce(metadata_json, '')) LIKE ? ESCAPE '\\')",
      );
      const pattern = likePattern(term);
      args.push(pattern, pattern, pattern, pattern, pattern);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    const { results } = await this.db
      .prepare(query)
      .bind(...args)
      .all<ItemRow>();
    const items = sortFeedItems(results.map(rowToFeedItem));
    return paginate(items, limit, offset);
  }

  async countTotalItems(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) as count FROM items`)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async pruneOldItems(maxPerSource: number): Promise<number> {
    const { meta } = await this.db
      .prepare(
        `
      DELETE FROM items
      WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY source
            ORDER BY coalesce(published_at, first_seen_at) DESC, first_seen_at DESC,
              source_rank ASC, source ASC, external_id ASC
          ) AS rn
          FROM items
        )
        WHERE rn > ?
      )
    `,
      )
      .bind(maxPerSource)
      .run();
    return meta.changes ?? 0;
  }
}

function rowToFeedItem(row: ItemRow): FeedItem {
  return {
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    url: row.url,
    summary: row.summary ?? undefined,
    author: row.author ?? undefined,
    score: row.score ?? undefined,
    commentsUrl: row.comments_url ?? undefined,
    publishedAt: row.published_at ?? undefined,
    fetchedAt: row.first_seen_at,
    sourceRank: row.source_rank,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
  };
}

function searchTermsSql(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
}

function likePattern(term: string): string {
  const escaped = term
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `%${escaped}%`;
}
