-- alphaXiv is no longer a supported source. Remove its stored items and
-- sync state so the unfiltered feed cannot keep serving orphaned rows.
DELETE FROM items WHERE source = 'alphaxiv';
DELETE FROM sync_state WHERE source = 'alphaxiv';
