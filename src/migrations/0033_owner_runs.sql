-- 0031_owner_runs.sql — the owner's answers to a sync's decisions, and the runs an answer grants
-- (BATON_SPEC §6.8, B-110): the third review round's blockers are the owner's, and the owner
-- answers through Baton's authenticated owner surface (`baton owner resolve`, the route Baton's
-- own decisions are answered by), never by a commit any pusher could write (the owner,
-- 2026-11-03, "Through Baton, not git"). A `round` answer itself grants exactly one more review
-- run (the owner, 2026-11-03, "The answer carries the grant"): the option's grant, added to the
-- leg's `max_runs` for this ticket alone — the traversal record still counts the runs
-- (R-BTN-63), so a grant buys one round and never more; nothing spends it, and a later answer
-- grants again.

-- JSON {<leg>: <granted runs>}, one key per leg granted; null is none. Read at the advance that
-- starts the leg, beside the course file's own bound.
ALTER TABLE ticket_overrides ADD COLUMN runs_json TEXT;

-- A posted decision's question (one line of display text, rendered as text) and its options
-- (JSON [{id, grants?: {leg, runs}}]) — what the owner may answer and what each answer grants.
ALTER TABLE ticket_decisions ADD COLUMN question TEXT;
ALTER TABLE ticket_decisions ADD COLUMN options_json TEXT;

-- The owner's answer to a sync-posted decision, written by the authenticated owner route alone
-- and read back by the sync in its observation; a decision answered is never posted open again.
CREATE TABLE decision_answers (
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  decision_id   TEXT NOT NULL,
  answer        TEXT NOT NULL,
  answered_by   TEXT NOT NULL,                     -- the owner credential's fingerprint
  answered_at   INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, decision_id)
);
