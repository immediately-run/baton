-- 0057_several_claims.sql — B-188 (BATON_SPEC R-BTN-4): a runner holds several claims at once.
-- One active claim per ticket stays a unique index (0005's `one_active_claim_per_ticket`); the
-- per-runner bound — the lower of the runner's declared `concurrency` and its grant's
-- `max_claims` — is checked in the claim's own transaction, so 0001's per-worker unique index
-- goes. Each defaults to 1, which is one claim per runner exactly as before.
DROP INDEX IF EXISTS one_active_claim_per_worker;

-- R-BTN-4's count: a worker's active claims.
CREATE INDEX claims_active_by_worker ON claims(worker_id) WHERE status = 'active';

-- R-BTN-4: what the runner's last heartbeat declared it can run at once (1–32).
ALTER TABLE workers ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 1;

-- R-BTN-4: the owner's ceiling on one grant (1–32).
ALTER TABLE worker_grants ADD COLUMN max_claims INTEGER NOT NULL DEFAULT 1;
