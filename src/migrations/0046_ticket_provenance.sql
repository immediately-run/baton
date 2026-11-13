-- 0046_ticket_provenance.sql — B-126 (BATON_SPEC §4.4 R-BTN-194, §3.3 R-BTN-73; the security
-- model's reach 3, option 9): who last wrote each ticket. Provenance only — the owner,
-- 2026-11-13, dropped B-126's `control-changed` notice (and the owner-identities route and the
-- `control_paths` setting that served it) per the 2026-11-01 ruling on R-BTN-66: under
-- `cooperative` Baton carries no foreign-write notice; B-127's opt-in `unsigned-control` is the
-- detection. The signer half is B-127's brief mark (`tickets.brief`, 0040), not repeated here.

-- The pushes that moved a branch, as the App's push deliveries reported them (R-BTN-73): the
-- immutable pusher (`sender.id`, never the commit author, which anyone sets) and each commit's
-- changed paths, bounded at the front — a delivery past the bounds is remembered with
-- `truncated` and no paths, so what it changed reads as `pusher-unknown`. Pruned with
-- `webhook_deliveries`' 24 hours: provenance is computed at the post that accepts the head and
-- stored on `tickets`, so the delivery itself is needed only until the next sync.
CREATE TABLE push_deliveries (
  delivery_id  TEXT PRIMARY KEY,
  repository   TEXT NOT NULL,             -- the forge path, lowercase
  ref          TEXT NOT NULL,             -- 'refs/heads/<branch>'
  before_sha   TEXT NOT NULL,
  after_sha    TEXT NOT NULL,
  sender_id    INTEGER,                   -- the immutable forge user id; NULL when none came
  sender_login TEXT,
  commits_json TEXT NOT NULL,             -- [{sha, paths: […]}]
  truncated    INTEGER NOT NULL DEFAULT 0,
  received_at  INTEGER NOT NULL
);
CREATE INDEX push_deliveries_after ON push_deliveries (repository, ref, after_sha);
CREATE INDEX push_deliveries_received ON push_deliveries (received_at);

-- R-BTN-194: who last pushed each ticket's body — {pusher, pusher_id?, commit, at} as JSON,
-- Baton's own reading of the push deliveries; NULL until the ticket's first observed change.
-- Not an input of `row_hash`: provenance is Baton's record, never the post's.
ALTER TABLE tickets ADD COLUMN last_written_by TEXT;
