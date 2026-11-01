-- 0028_owner_runs.sql — owner-granted runs of one leg (BATON_SPEC §6.8, B-110): the override
-- that carries a `round` adjudication answer. Each grant is exactly one more run of the named
-- leg, added to its `max_runs` for this ticket alone — the traversal record still counts the
-- runs (R-BTN-63), so a grant buys one round and never more; nothing spends it, and an owner
-- may grant again.

-- JSON {<leg>: <granted runs>}; null is none. Read at the advance that starts the leg, beside
-- the course file's own bound.
ALTER TABLE ticket_overrides ADD COLUMN runs_json TEXT;
