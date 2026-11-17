-- 0055_dashboard_lookups.sql — B-240, B-241 (BATON_SPEC §13, §14): the dashboard's claim,
-- transcript and waiting-leg lookups read their rows, not their tables, and a board post judges
-- its unjudged leg runs in one lookup. `GET /v1/ui/state` is polled every
-- 10 seconds while a dashboard is open, and each of these lookups scanned a table that only
-- grows (production passed Cloudflare's 5,000,000 rows_read/day on 2026-11-14).

-- The timeline's claims in its 24-hour window: the active ones (`ended_at IS NULL`) and those
-- ended since its start.
CREATE INDEX claims_by_ended ON claims(ended_at);

-- Needs you's unconfirmed completions (§6.7), oldest first: 0001's `claims_unconfirmed` is on
-- the ticket, and the planner scanned the claims for this order.
CREATE INDEX claims_unconfirmed_by_end ON claims(ended_at) WHERE status = 'completed' AND confirmed_at IS NULL;

-- Needs you's fence-pending claims (R-BTN-19), in their order; the alarm's lapsed fences read it too.
CREATE INDEX claims_fence_pending ON claims(ended_at) WHERE status = 'reaped' AND fence_pending = 1;

-- The timeline's transcript links (§6.8): a claim's transcripts, first stored first.
CREATE INDEX transcripts_by_claim ON transcripts(claim_id, id);

-- Needs you's `policy` and `course-changed` waits (R-BTN-67, R-BTN-83): the waiting legs by what
-- they wait on.
CREATE INDEX next_legs_waiting ON ticket_next_legs(waiting_on, ticket_id, leg) WHERE state = 'waiting';

-- B-241: a board post's leg runs whose declared bars no snapshot has judged yet (R-BTN-63) — few
-- at any time — read for every placed ticket at once.
CREATE INDEX claim_legs_unjudged ON claim_legs(claim_id) WHERE bars != '[]' AND bars_judged = 0;
