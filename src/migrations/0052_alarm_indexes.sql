-- 0052_alarm_indexes.sql — B-236 (BATON_SPEC §13): the indexes the alarm's and the runner
-- calls' claim, worker and waiting-leg lookups search, so a tick reads tens of rows, not tables.
-- Production passed Cloudflare's 5,000,000 rows_read/day on 2026-11-14 and 2026-11-15; the
-- alarm alone read 0.8–1.3k rows a minute on a production-sized state, most of it a scan of
-- `claims` for pending fences and of `ticket_next_legs` for the 72-hour stall.
--
-- Each partial index's WHERE is written exactly as the queries that use it write theirs, so
-- SQLite's planner, which matches a partial index by its terms, finds it.

-- R-BTN-19's pending fences (the alarm's lapsed-fence check) and §6.7's unconfirmed claims are
-- searched through 0055's `claims_fence_pending` and `claims_unconfirmed_by_end` (B-240), which
-- this file does not repeat; so is §14's timeline (0055's `claims_by_ended`): B-236's
-- `(worker_id, claimed_at)` would lead the planner to read a lane's every claim instead.
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
CREATE INDEX next_legs_waiting_since ON ticket_next_legs(waiting_since, ticket_id, leg, waiting_on) WHERE state = 'waiting';
-- Nearly every next leg is ready, so the ready-leg reads that searched this index (the
-- recommendations, the board's ready rows) read an index row and a table row for almost every
-- leg — more than the scan of the table they make without it.
DROP INDEX IF EXISTS next_legs_ready;

-- §9: the open messages — the alarm's expiries and an unblocked message's per-worker lookup
-- read these, not every message ever sent.
CREATE INDEX messages_by_status ON messages(status, to_worker_id);
