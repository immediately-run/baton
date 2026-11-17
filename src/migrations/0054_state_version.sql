-- 0054_state_version.sql — B-237 and B-242 (BATON_SPEC §3 R-BTN-196): the state version, one
-- row whose `v` moves in the commit of every write to Baton's state (src/core/stateVersion.ts),
-- liveness and request nonces excepted. A reader that saw `v` and sees it again knows no stored
-- fact changed between: the recommendation memo keys on it (B-237), and the dashboard's ETag
-- may (B-242). 0049–0053 are other branches'.
CREATE TABLE state_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  v  INTEGER NOT NULL
);
INSERT INTO state_version (id, v) VALUES (1, 0);

-- B-237: the candidate query's two claim lookups per ticket (§7.2 rule 3 and §6.7's "a sync since
-- the last end") read one index entry each, not every claim the ticket ever had — the claims
-- table is never pruned, so they grew with history.
CREATE INDEX claims_last_end ON claims(ticket_id, end_observation);
CREATE INDEX claims_holding ON claims(ticket_id)
  WHERE status = 'active' OR (status = 'completed' AND confirmed_at IS NULL) OR (status = 'reaped' AND fence_pending = 1);
