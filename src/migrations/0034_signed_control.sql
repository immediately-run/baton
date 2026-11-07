-- 0034_signed_control.sql — B-127 (R-BTN-66 as amended, §7.1): owner-signed control inputs.
-- A repository opts in with `require_signed_control` (an owner setting, default off): a control
-- input counts only at a commit an owner's human-only key signed, and the sync posts what it
-- found — the groups the runners load from, the unsigned changes (the notice's list) and each
-- ticket's brief mark — which Baton stores as the claim answers' `control` and the brief the
-- dashboard and the privileged readers see. The verification itself is B-127's client half: the
-- sync computes (never alone — every runner verifies again before loading), and B-137 moves it
-- server-side over the raw commits.
ALTER TABLE repositories ADD COLUMN require_signed_control INTEGER NOT NULL DEFAULT 0;

-- The standing signed-control record of one repository: the latest post's word on what counts,
-- replaced by each accepted post that carries one. `control_json` is the posted record as
-- checkPayload validated it ({groups, unsigned}); `sha` names the post it rode.
CREATE TABLE signed_control (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  sha TEXT NOT NULL,
  control_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A ticket's brief mark (B-127 item 7): `{signed, signer?, commit}` as the sync computed it —
-- marked whether or not the setting is on, served with the ticket so a privileged reader sees
-- whose words the brief is before reading them.
ALTER TABLE tickets ADD COLUMN brief TEXT;

-- `unsigned-control` joins the event log's kinds (B-127: one per accepted post that moved the
-- head onto unsigned control inputs while the repository requires them signed — the notice under
-- Needs you reads these). Nothing references `events`, so it is rebuilt with the wider check,
-- as 0031 did, its indexes restored beside it.
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
                  'answer-invalid','arrival-unapplied','unsigned-control')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0034 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP TABLE events;
ALTER TABLE events_0034 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
CREATE INDEX events_unsigned_control ON events(at) WHERE kind = 'unsigned-control';
