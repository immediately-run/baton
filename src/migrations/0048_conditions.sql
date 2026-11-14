-- 0048_conditions.sql — B-234 (BATON_SPEC §7.1 R-BTN-160, R-BTN-195): a leg's raised conditions.
-- The rows a raise's report writes (`POST /v1/runner/claims/{id}/conditions`) and the reads
-- serve: one per raise, open until its outcome settles. Filter fields only (R-BTN-33): the
-- subject and body a leg supplies never leave the runner, and an `interact` condition's `url` is
-- the stored session link Baton set (R-BTN-195), never one the runner sent. Handler tickets are
-- not built (R-BTN-161 is B-234's later work), so no handler column yet: `interact` files none
-- and nothing else is bound.
--
-- `claims.deadline_at` is R-BTN-90's armed deadline: set by the advance that starts a leg with
-- `deadline_s` (the course file's `max_duration`), cleared by the next advance and the claim's
-- end, and taken back by the alarm at the instant with a `release` whose reason is
-- `leg-timeout` — a failed attempt, and what ends a joinable session nobody joins (R-BTN-195).

CREATE TABLE conditions (
  id            INTEGER PRIMARY KEY,
  repository_id TEXT NOT NULL,
  ticket_id     TEXT NOT NULL,
  claim_id      INTEGER NOT NULL REFERENCES claims(id),
  run_id        TEXT NOT NULL,                    -- the raising run (`claim_legs.run_id`)
  leg           TEXT NOT NULL,
  type          TEXT NOT NULL,                    -- R-BTN-160's grammar
  disposition   TEXT NOT NULL CHECK (disposition IN ('interrupt','suspend','notify')),
  severity      TEXT NOT NULL DEFAULT 'normal',   -- R-BTN-125
  url           TEXT,                             -- an interact: the stored session link (R-BTN-195); an unbound suspend: where git holds the question (R-BTN-92)
  restarts_json TEXT NOT NULL DEFAULT '{}',       -- R-BTN-33: ids and descriptions only
  default_restart TEXT,
  raised_at     INTEGER NOT NULL,
  outcome       TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','superseded','recorded','closed')),
  closed_at     INTEGER,
  closed_how    TEXT                              -- 'run-ended' for an interact whose run ended
);
CREATE INDEX conditions_open ON conditions(repository_id, type, raised_at) WHERE outcome = 'open';
CREATE INDEX conditions_by_ticket ON conditions(ticket_id, raised_at);
CREATE INDEX conditions_by_run ON conditions(run_id);

-- R-BTN-90: the claim's armed deadline, one per claim; NULL when the running leg has none.
ALTER TABLE claims ADD COLUMN deadline_at INTEGER;

-- The events this adds: `condition` (a raise recorded, R-BTN-81) and `leg-timeout` (the alarm
-- taking a claim back at its deadline, R-BTN-90). Nothing references `events` beyond its
-- indexes, so the table is rebuilt with the wider check as 0031 and 0043 did.
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
                  'condition','leg-timeout')),
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
