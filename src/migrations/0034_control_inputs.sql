-- 0034_control_inputs.sql — B-126 (BATON_SPEC §4.4 R-BTN-194, §3.3 R-BTN-73, §11.2 R-BTN-58;
-- docs/security-model.mdx mitigation G): a notice when a non-owner's push changes a control
-- input, and provenance on every ticket. Detection only — no gate (hardening option 7, B-127,
-- is the gate).

-- The pushes that moved a default branch, as the App's push deliveries reported them (R-BTN-73):
-- the immutable pusher (`sender.id`, never the commit author, which anyone sets) and each
-- commit's changed paths, bounded at the front — a delivery past the bounds is remembered with
-- `truncated` and no paths, so its range fails closed. Pruned with `webhook_deliveries`' 24
-- hours: provenance and the control judgement are computed at the post that accepts the head and
-- stored on `tickets`, so the delivery itself is needed only until the next sync.
CREATE TABLE push_deliveries (
  delivery_id  TEXT PRIMARY KEY,
  repository   TEXT NOT NULL,             -- the forge path, lowercase
  ref          TEXT NOT NULL,             -- 'refs/heads/<default branch>'
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

-- The owners' forge identities are the `pushers` owner setting (R-BTN-139's list, §13's owner
-- settings table): the immutable user ids whose words count on a forge — and, from this
-- ticket, whose control changes raise no notice (R-BTN-194). `baton owner identity add` (B-126)
-- adds one; the column is the one list, so the fact adapter's later reading finds the same.
ALTER TABLE repositories ADD COLUMN pushers TEXT NOT NULL DEFAULT '[]';

-- Owners may add control paths in their settings (R-BTN-66): path patterns beside the fixed
-- list, JSON, like every repositories setting.
ALTER TABLE repositories ADD COLUMN control_paths TEXT NOT NULL DEFAULT '[]';

-- R-BTN-194: who last changed each ticket — {pusher, pusher_id?, commit, at} as canonical JSON,
-- Baton's own reading of the push deliveries; NULL until the ticket's first observed change.
-- Not an input of `row_hash`: provenance is Baton's record, never the post's.
ALTER TABLE tickets ADD COLUMN last_written_by TEXT;

-- `control-changed` joins the event log's kinds (R-BTN-194: one per accepted post that moved the
-- head with a control change by a pusher who is not an owner identity — the notice under Needs
-- you reads these, as the discrepancies list reads `discrepancy`). Nothing references `events`,
-- so it is rebuilt with the wider check, as 0031 did, its indexes restored beside it.
CREATE TABLE events_0034 (
  seq           INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('claimed','completed','confirmed',
                  'released','reaped','fence-cleared','adopted','rekeyed','override',
                  'suspension','reviewer-substituted','attempts-exhausted','held','cutover',
                  'snapshot-rejected','snapshot-accepted','shadow-conflict','foreign-claim',
                  'advanced','advice-overridden','off-graph','bars-mismatch','regressed','admin',
                  'blocked','unblocked','resource','discrepancy','queue-over','course-closed',
                  'course-opened','taken-invalid',
                  'question-posted','question-dropped','question-answered','question-expired',
                  'answer-invalid','arrival-unapplied','control-changed')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0034 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP INDEX IF EXISTS events_by_claim;
DROP INDEX IF EXISTS events_by_repository;
DROP INDEX IF EXISTS events_discrepancies;
DROP TABLE events;
ALTER TABLE events_0034 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
CREATE INDEX events_control_changed ON events(at) WHERE kind = 'control-changed';
