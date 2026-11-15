-- 0052_alarm_indexes.sql — B-236 (BATON_SPEC §13): the indexes the alarm's and the runner
-- calls' claim, worker and waiting-leg lookups search, so a tick reads tens of rows, not tables.
-- Production passed Cloudflare's 5,000,000 rows_read/day on 2026-11-14 and 2026-11-15; the
-- alarm alone read 0.8–1.3k rows a minute on a production-sized state, most of it a scan of
-- `claims` for pending fences and of `ticket_next_legs` for the 72-hour stall.
--
-- Each partial index's WHERE is written exactly as the queries that use it write theirs, so
-- SQLite's planner, which matches a partial index by its terms, finds it.

-- R-BTN-19: the alarm's lapsed fences and Needs you's fence_pending list.
CREATE INDEX claims_fence_pending ON claims(ended_at) WHERE status = 'reaped' AND fence_pending = 1;
-- §6.7: Needs you's unconfirmed claims, by when they ended.
CREATE INDEX claims_unconfirmed_ended ON claims(ended_at) WHERE status = 'completed' AND confirmed_at IS NULL;
-- §14's timeline: a lane's claims.
CREATE INDEX claims_by_worker ON claims(worker_id, claimed_at);
-- R-BTN-90: the alarm's due claim deadlines and the earliest one it arms at.
CREATE INDEX claims_deadline ON claims(deadline_at) WHERE status = 'active' AND deadline_at IS NOT NULL;

-- Every runner call's worker lookup (src/core/workerApi.ts).
CREATE INDEX workers_by_secret ON workers(credential_id, secret_hash);
-- §5's live worker: `last_seen_at + lease_timeout_ms > now` (algebraically R-BTN-9's
-- `now - last_seen_at < lease_timeout_ms`), so the live set is a range of this index — never
-- the reaped sessions, whose rows are kept forever (R-BTN-3).
CREATE INDEX workers_live ON workers(last_seen_at + lease_timeout_ms) WHERE reaped_at IS NULL;

-- `baton:stalled`: the alarm's 72-hour stall reads only the legs posted waiting that long — and only
-- this index for them, which carries every column the stall reads of the leg.
CREATE INDEX next_legs_waiting ON ticket_next_legs(waiting_since, ticket_id, leg, waiting_on) WHERE state = 'waiting';
-- Nearly every next leg is ready, so the ready-leg reads that searched this index (the
-- recommendations, the board's ready rows) read an index row and a table row for almost every
-- leg — more than the scan of the table they make without it.
DROP INDEX IF EXISTS next_legs_ready;

-- §9: the open messages — the alarm's expiries and an unblocked message's per-worker lookup
-- read these, not every message ever sent.
CREATE INDEX messages_by_status ON messages(status, to_worker_id);
