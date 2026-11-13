-- 0048_sequences.sql — B-176 (BATON_SPEC §4.3 R-BTN-195, §13.4 `sequences`): the per-repository,
-- per-kind sequence table behind `POST /v1/repositories/{repository}/sequences/{kind}/next`.
-- Every identifier a concurrent branch writes to git — a ticket id from any filer, a rule,
-- scenario or gate id, a migration number — is one Baton hands out, so two branches open at once
-- can never take the same number (R-BTN-193: git is never a counter). Core knows no kind's
-- meaning (value 3): `kind` is an opaque string the CLI names (`ticket-b`, `rule`, `scenario`,
-- `gate`, `migration`); the last number issued is all the table holds (R-BTN-33: no prose).
--
-- A kind with no row starts at 0: the first call's number is `max(stored, floor) + 1`, so a
-- fresh Baton, seeded by the floor the caller read from git, never reissues a number git holds
-- (value 1: lost state fails closed). The events table is rebuilt beside it with the `sequence`
-- kind — each issue is an event naming the caller and, when given, the ticket it is for.
CREATE TABLE sequences (
  repository_id TEXT NOT NULL,
  kind          TEXT NOT NULL,                -- opaque to core (R-BTN-195): the CLI names kinds
  last_number   INTEGER NOT NULL,             -- the last number issued; a kind with no row starts at 0
  PRIMARY KEY (repository_id, kind)
);

-- The events table rebuilt with the `sequence` kind beside it, its indexes restored, as 0035,
-- 0037, 0040, 0042 and 0043 did: nothing references the table beyond its indexes.
CREATE TABLE events_0048 (
  seq           INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('claimed','completed','confirmed',
                  'released','reaped','fence-cleared','adopted','rekeyed','override',
                  'suspension','reviewer-substituted','attempts-exhausted','held','cutover',
                  'snapshot-rejected','snapshot-accepted','shadow-conflict','foreign-claim',
                  'advanced','advice-overridden','off-graph','bars-mismatch','regressed','admin',
                  'blocked','unblocked','resource','discrepancy','queue-over','course-closed',
                  'course-opened',
                  'question-posted','question-dropped','question-answered','question-expired',
                  'answer-invalid','arrival-unapplied','scope-exceeded','unclaimed-write',
                  'scope-invalid','scope-resolved','renumbered','unsigned-control','deprecated-field',
                  'sequence')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0048 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP INDEX IF EXISTS events_by_claim;
DROP INDEX IF EXISTS events_by_repository;
DROP INDEX IF EXISTS events_discrepancies;
DROP TABLE events;
ALTER TABLE events_0048 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
