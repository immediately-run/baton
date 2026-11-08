-- 0035_scope_events.sql — B-134, round 1: the scope audit's two remaining event kinds.
-- `scope-invalid` is the scope report's counterpart of `taken-invalid`: a report whose entries
-- failed their shape, or whose actions ran past its sixteen, is dropped and counted — never a
-- refusal of the advance or end that carries it — and the count is logged, so a report is
-- never silently shortened. `scope-resolved` is the owner's acknowledgement a finding was
-- looked at, written in the resolve route's transaction like every neighbouring `/v1/ui`
-- mutation's history row.
--
-- As 0034 rebuilt `events` for its two kinds: nothing references the table, so it is rebuilt
-- with the wider check and its indexes restored.

CREATE TABLE events_0035 (
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
                  'answer-invalid','arrival-unapplied','scope-exceeded','unclaimed-write',
                  'scope-invalid','scope-resolved')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0035 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP INDEX IF EXISTS events_by_claim;
DROP INDEX IF EXISTS events_by_repository;
DROP INDEX IF EXISTS events_discrepancies;
DROP TABLE events;
ALTER TABLE events_0035 RENAME TO events;
DROP INDEX IF EXISTS events_by_ticket_0035;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
