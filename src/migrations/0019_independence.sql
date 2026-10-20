-- 0019_independence.sql — independence by credential and isolation floors (BATON_SPEC §2m.1,
-- R-BTN-106, R-BTN-107; B-2).
-- A worker's declared isolation, from its last heartbeat: `process` (the default, legs as the
-- runner's children), `attached` (handed back to the session that started the runner) or
-- `session` (one cloud session per leg, no Baton credential within reach).
ALTER TABLE workers ADD COLUMN isolation TEXT NOT NULL DEFAULT 'process' CHECK (isolation IN ('attached', 'process', 'session'));
-- The owners' required_independence, leg -> the legs a key that ran any of them on a ticket may
-- not take it; joined to every course file's no_chain_from.
ALTER TABLE repositories ADD COLUMN required_independence TEXT NOT NULL DEFAULT '{}'
