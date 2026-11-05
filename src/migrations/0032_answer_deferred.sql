-- 0032_answer_deferred.sql — B-7 review round 1: R-BTN-39's deferred arrival for a person leg's
-- answer. An answer that fails only because a claim is active or Baton holds the ticket waits,
-- kept with its ref, and is applied when the hold ends if it still meets every other condition
-- then (§6.4) — the alarm's tick after the hold ends is that moment (Questions.applyPending).
-- Neither an `arrival-unapplied` record nor an `invalid-params` refusal: a hold is none of
-- R-BTN-116's four faults, and the arrival raises nothing meanwhile.

ALTER TABLE ticket_questions ADD COLUMN pending_leg TEXT;      -- the person leg the deferred answer names
ALTER TABLE ticket_questions ADD COLUMN pending_option TEXT;   -- the option the person chose
ALTER TABLE ticket_questions ADD COLUMN pending_reached TEXT;  -- the outcome that option names
ALTER TABLE ticket_questions ADD COLUMN pending_by TEXT;       -- who answered ('sync', 'owner:<fp>', 'human:<fp>')
ALTER TABLE ticket_questions ADD COLUMN pending_ref TEXT;      -- R-BTN-39: the commit the answer rode
ALTER TABLE ticket_questions ADD COLUMN pending_at INTEGER;    -- when it was kept
CREATE INDEX questions_pending ON ticket_questions(pending_at) WHERE pending_option IS NOT NULL;
