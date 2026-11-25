-- B-284 (§8.1, S-BTN-41): replace just the checked column, keeping runner ids,
-- indexes, and dependent rows intact. SQLite needs a default to add a NOT NULL
-- column to a populated table; all runner writes supply the name explicitly.
ALTER TABLE runners RENAME COLUMN harness TO harness_0076;
ALTER TABLE runners ADD COLUMN harness TEXT NOT NULL DEFAULT 'opencode';
UPDATE runners SET harness = harness_0076;
ALTER TABLE runners DROP COLUMN harness_0076;
