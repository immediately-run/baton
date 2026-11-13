-- 0043_retirement.sql — B-173 (BATON_SPEC §3.1 R-BTN-47's *Retirement*, §3.1 R-BTN-138's
-- tombstone): a retired repository's forge path moves to `former_paths` (latest 10, never
-- read for authentication or links) and its row carries the tombstone `~retired/<id>` in its
-- place, freeing the path among live rows. A former path reaches the fence alone — the
-- branch-holder query answers for it while a fence is pending (R-BTN-7, R-BTN-19) and no live
-- repository holds the path.
ALTER TABLE repositories ADD COLUMN former_paths TEXT;
