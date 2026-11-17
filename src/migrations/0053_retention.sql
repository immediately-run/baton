-- 0053_retention.sql — B-238 (BATON_SPEC §2 R-BTN-149, §13): what the alarm's retention reads.
-- Nothing was ever pruned: events, board snapshots, runner declarations and closed tickets'
-- claims grew without end, and every read proportional to them grew with them.
--
-- Each prune finds its rows through an index, so a tick with nothing to delete reads a handful
-- of rows (B-238: the retention must not cost more than it saves).

-- §16, §12: the mirror's acknowledged cursor — the `after` of its `GET /v1/sync/events`. 0 until
-- a mirror first reads: no event of a repository with a mirror is pruned before it has.
ALTER TABLE repositories ADD COLUMN mirror_acked_seq INTEGER NOT NULL DEFAULT 0;

-- Repository events by age (a tenant event, `repository_id` NULL, is not R-BTN-149's to prune).
CREATE INDEX events_retention ON events(at) WHERE repository_id IS NOT NULL;
-- Board snapshots by age.
CREATE INDEX board_snapshots_received ON board_snapshots(received_at);
-- Runner rows by when they were last seen: the dependents' prune walks them in this order.
CREATE INDEX workers_last_seen ON workers(last_seen_at);

-- R-BTN-81's purge done, the ticket's claims are due to go: when the alarm next tries them
-- (NULL once they are gone). A claim another record still names waits for it.
ALTER TABLE closed_tickets ADD COLUMN claims_due_at INTEGER;
UPDATE closed_tickets SET claims_due_at = purged_at WHERE purged_at IS NOT NULL;
CREATE INDEX closed_claims_due ON closed_tickets(claims_due_at) WHERE claims_due_at IS NOT NULL;

-- A claim's rows found by the claim, for its prune (its transcripts through 0055's
-- `transcripts_by_claim`).
CREATE INDEX scope_findings_by_claim ON scope_findings(claim_id) WHERE claim_id IS NOT NULL;
CREATE INDEX conditions_by_claim ON conditions(claim_id);
