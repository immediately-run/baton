-- 0034_scope_audit.sql — B-134 (OWASP ASI10, hole 7): a leg's scope audit. The runner audits,
-- at each leg's end, the refs the leg's window moved and reports the actions outside its
-- ticket's scope with the claim (`scope-exceeded`); Baton cross-checks the forge's push
-- deliveries for the worker identities the owners named against the claims open at the time
-- (`unclaimed-write`). Each finding is raised under Needs you until an owner resolves it, and
-- with the owners' `scope_policy: hold` a scope-exceeded finding holds its ticket.
--
-- The runner's half is a cooperative aid, not a control (docs/security-model.mdx, review
-- finding 16): it runs as the runner's OS user, inside the trust domain it audits. The
-- server-side cross-check of forge deliveries is the control.

-- §13.1: what a scope-exceeded finding does — reported (Needs you alone, the default) or held
-- (the ticket is parked until an owner lifts the hold). §13.1 again: the forge logins the
-- fleet's VM runners push as (B-134's `unclaimed-write` cross-check names them); null or an
-- empty list means none — the cross-check is off until the owners name one.
ALTER TABLE repositories ADD COLUMN scope_policy TEXT NOT NULL DEFAULT 'report' CHECK (scope_policy IN ('report', 'hold'));
ALTER TABLE repositories ADD COLUMN worker_pushers TEXT;

-- One row per finding, open until an owner resolves it. `target` is the repository the action
-- touched (a forge path, `owner/name`) or, for an egress finding, the host reached; `detail_json`
-- holds identifiers only (R-BTN-33): the action's kind, its ref or port, the claim that
-- reported it. A repeated finding of the same shape updates the row it has open (the index
-- below makes one open row per shape) rather than stacking copies.
CREATE TABLE scope_findings (
  id            INTEGER PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  ticket_id     TEXT,                             -- the claim's ticket; NULL for unclaimed-write
  claim_id      INTEGER REFERENCES claims(id),    -- the claim that reported it, when one did
  kind          TEXT NOT NULL CHECK (kind IN ('scope-exceeded', 'unclaimed-write')),
  target        TEXT NOT NULL,                    -- the repository or host the action touched
  detail_json   TEXT NOT NULL,                    -- identifiers only, ≤ 2 KB as history's
  raised_at     INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  resolved_at   INTEGER,                          -- NULL while open
  resolved_by   TEXT
);
CREATE UNIQUE INDEX one_open_scope_finding ON scope_findings(repository_id, COALESCE(ticket_id, ''), kind, target) WHERE resolved_at IS NULL;
CREATE INDEX scope_findings_open ON scope_findings(repository_id, kind, updated_at) WHERE resolved_at IS NULL;

-- The events both halves write: the claim's report (`scope-exceeded`) and the forge
-- cross-check (`unclaimed-write`). Nothing references `events`, so it is rebuilt with the
-- wider check, as 0031 did.
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
                  'answer-invalid','arrival-unapplied','scope-exceeded','unclaimed-write')),
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
DROP INDEX IF EXISTS events_by_ticket_0034;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
