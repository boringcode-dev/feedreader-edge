-- Embedding vector for each item, generated once at ingestion time (see
-- core/service.ts's refreshOne) and reused across every /api/personalize
-- request — no per-request LLM call needed for the retrieval step. NULL
-- until a refresh cycle successfully embeds the item; embedding_model
-- records which model produced the stored vector, for future migrations.
ALTER TABLE items ADD COLUMN embedding_json TEXT;
ALTER TABLE items ADD COLUMN embedding_model TEXT;
