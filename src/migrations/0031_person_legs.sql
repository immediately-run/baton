-- 0031_person_legs.sql — B-7 (BATON_SPEC §6.4 R-BTN-116): the leg a person answers. A course
-- file may mark a leg "kind": "person" with "asks" and "expires"; no runner is offered it or may
-- claim or advance into it (rule `person`); the ticket source posts the queued person leg's
-- question with the ticket, stored here and listed under Needs you; the answer is a
-- std:decision@1 — attested by the sync from the ticket's `answer:` where the policy's
-- `inputs.answers` admits git, or written by an owner through `baton decision answer` — and is
-- applied as the leg's arrival (R-BTN-39), moving the ticket to the outcome the option names.

-- The registry's view of which legs are a person's (R-BTN-116), beside the course file's other
-- derived views (`leg_capabilities_json`, 0022): the candidate query reads it so a person leg is
-- never offered, as rule `person` refuses it at a claim and an advance.
ALTER TABLE courses ADD COLUMN person_legs_json TEXT NOT NULL DEFAULT '[]';

-- The queued person leg's question and its answer or expiry (R-BTN-116, R-BTN-163). One row per
-- ticket: the question of the leg it waits on, replaced when the source posts a new one. A
-- queued person leg with no posted question is listed under Needs you with the leg's outcomes as
-- its options (§6.4), so the row exists only once a question arrives or is answered.
CREATE TABLE ticket_questions (
  ticket_id   TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  question_id TEXT,                             -- null until a question is posted (§4.4)
  leg         TEXT NOT NULL,                    -- the queued person leg it asks
  url         TEXT,                             -- where git holds its text, under R-BTN-92's link rule
  severity    TEXT,                             -- R-BTN-125: critical, high or normal
  options_json TEXT NOT NULL DEFAULT '[]',      -- JSON: [{id, reached}], each naming an outcome of the leg's `to`
  posted_at   INTEGER NOT NULL,
  answered_at INTEGER,                          -- set by an answer or an expiry
  answered_by TEXT,                             -- the owner key's fingerprint, or 'sync'
  option      TEXT,                             -- the option chosen; null at an expiry
  answered_ref TEXT                             -- R-BTN-39's idempotence: the commit the answer rode (a sync attestation)
);
CREATE INDEX questions_open ON ticket_questions(posted_at) WHERE answered_at IS NULL;

-- A person leg's expiry instant (R-BTN-116, R-BTN-167): set when the person leg becomes the
-- queued leg, kept while the ticket's station does not change, applied by the alarm at the
-- instant if the leg is still queued and unanswered. Held in `ticket_stations` until B-167's
-- `ticket_timers` unifies the instants Baton holds per leg; the table is rebuilt the way 0024
-- rebuilt `messages`, adding the column and the `baton` source of a queued leg (R-BTN-83) — the
-- one an applied answer or expiry writes.
CREATE TABLE ticket_stations_0031 (
  ticket_id    TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  station      TEXT NOT NULL,
  path         TEXT NOT NULL,
  path_len     INTEGER NOT NULL,
  to_end       INTEGER NOT NULL,
  next_leg     TEXT,
  next_source  TEXT NOT NULL CHECK (next_source IN ('course','marker','inferred','holder','baton')),
  handoff_url  TEXT,
  snapshot_sha TEXT NOT NULL,
  observation  INTEGER NOT NULL,
  person_expires_at INTEGER
);
INSERT INTO ticket_stations_0031 SELECT ticket_id, station, path, path_len, to_end, next_leg, next_source, handoff_url, snapshot_sha, observation, NULL FROM ticket_stations;
DROP TABLE ticket_stations;
ALTER TABLE ticket_stations_0031 RENAME TO ticket_stations;
CREATE INDEX person_expiry_due ON ticket_stations(person_expires_at) WHERE person_expires_at IS NOT NULL;

-- The events the question's life writes (R-BTN-116, R-BTN-81): a question posted or dropped, an
-- answer arriving or invalid, an expiry, an arrival not applied (R-BTN-39). Nothing references
-- `events`, so it is rebuilt with the wider check, as 0027 did.
CREATE TABLE events_0031 (
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
                  'answer-invalid','arrival-unapplied')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0031 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP TABLE events;
ALTER TABLE events_0031 RENAME TO events;
DROP INDEX IF EXISTS events_by_ticket_0031;
-- 0027's rebuild recreated `events_by_ticket` alone, so `events_by_claim`, `events_by_repository`
-- and `events_discrepancies` (0021) went with the old table and never came back; this rebuild
-- restores them beside it.
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
