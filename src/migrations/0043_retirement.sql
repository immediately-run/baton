-- 0043_retirement.sql — B-173 (BATON_SPEC §3.1 R-BTN-47's *Retirement*, §3.1 R-BTN-138's
-- tombstone): a retired repository's forge path moves to `former_paths` (latest 10, never
-- read for authentication or links) and its row carries the tombstone `~retired/<id>` in its
-- place, freeing the path among live rows. A former path reaches the fence alone — the
-- branch-holder query answers for it while a fence is pending (R-BTN-7, R-BTN-19) and no live
-- repository holds the path.
ALTER TABLE repositories ADD COLUMN former_paths TEXT;
-- Rows retired before this deploy — a retire that set `retired_at` alone — are brought to the
-- same tombstone: their path still sat in `github`, so `Registry.register`'s duplicate check
-- (it matches over every row, retired or not) would have refused the path to a new repository
-- forever, and the former-path fence (which reads `former_paths`) never reached them. The
-- tombstone names the id, so it can never collide with a live path; the same columns the
-- retiring transaction clears go NULL here too.
UPDATE repositories
SET former_paths = json_array(github), github = '~retired/' || id,
    web_base = NULL, dispatch = NULL, unblocked_trigger = NULL, sync_wanted_at = NULL, sync_wanted_after = NULL
WHERE retired_at IS NOT NULL AND github NOT LIKE '~retired/%';
