-- 0056_worker_profile.sql — B-253 (BATON_SPEC §8.3 R-BTN-72, §13.3): the runner's profile,
-- opaque, from the heartbeat's `profile` field — its `cli` key names the CLI's pinning
-- (commit, ref, pinned), reported and never gated on. NULL until a heartbeat carries one.
ALTER TABLE workers ADD COLUMN profile_json TEXT;
