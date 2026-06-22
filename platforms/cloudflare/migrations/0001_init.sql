-- Translated 1:1 from the original Go implementation's schema constant —
-- D1 is SQLite, so this is nearly copy-paste. idx_items_feed_order is kept
-- even though listFeedItems sorts in application memory rather than via
-- SQL ORDER BY, for parity with the Go schema, which keeps the same index
-- despite the same design.

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    summary TEXT,
    author TEXT,
    score INTEGER,
    comments_url TEXT,
    published_at TEXT,
    source_rank INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
    source TEXT PRIMARY KEY,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    item_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_source_last_seen_rank
    ON items(source, last_seen_at DESC, source_rank ASC);
CREATE INDEX IF NOT EXISTS idx_items_last_seen
    ON items(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_feed_order
    ON items(coalesce(published_at, first_seen_at) DESC, first_seen_at DESC, source_rank ASC, source ASC, external_id ASC);
