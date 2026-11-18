-- 0060_dependency_consents.sql — B-113 (BATON_SPEC §3.1 R-BTN-47 *Relations stay home* as
-- relaxed, §4.4): a ticket's `depends_on` may name another registered repository's ticket by
-- its qualified id. A dependency on a repository less visible than the dependent's — an owner
-- key or a worker grant that sees the dependent's board and not the target's — needs the target
-- repository owners' consent, recorded as R-BTN-140's cross-repository consent is: one row on
-- the target, naming the dependent, judged by id at every use (a post, the sync's dependencies
-- read) and never written by the dependent's own settings — only by the target's owners
-- (POST /v1/owner/{repository}/dependency-consents, R-BTN-58), each giving and withdrawal one
-- `dependency-consent` event.

CREATE TABLE dependency_consents (              -- B-113: repository T's owners' consent to D's tickets depending on T's
  repository_id TEXT NOT NULL REFERENCES repositories(id),  -- the target, depended on (whose board is exposed)
  dependent_id  TEXT NOT NULL REFERENCES repositories(id),  -- the dependent, whose board names the dependency
  granted_by    TEXT NOT NULL,                               -- 'owner:<fingerprint>'
  granted_at    INTEGER NOT NULL,
  PRIMARY KEY (repository_id, dependent_id)
);

-- The events table rebuilt with the `dependency-consent` kind beside it, its indexes restored,
-- as 0035 through 0059 did: nothing references the table beyond its indexes.
CREATE TABLE events_0060 (
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
                  'condition','leg-timeout',
                  'sequence','dependency-consent')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0060 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP INDEX IF EXISTS events_by_claim;
DROP INDEX IF EXISTS events_by_repository;
DROP INDEX IF EXISTS events_discrepancies;
DROP INDEX IF EXISTS events_by_kind_at;
DROP INDEX IF EXISTS events_unsigned_control;
DROP INDEX IF EXISTS events_retention;
DROP TABLE events;
ALTER TABLE events_0060 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
CREATE INDEX events_by_kind_at ON events(kind, at);
CREATE INDEX events_unsigned_control ON events(at) WHERE kind = 'unsigned-control';
CREATE INDEX events_retention ON events(at) WHERE repository_id IS NOT NULL;
