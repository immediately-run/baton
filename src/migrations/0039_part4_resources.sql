-- 0039_part4_resources.sql — B-168: the restructure's part 4 in the resources (§6.3, R-BTN-76,
-- §12.8 R-BTN-181, R-BTN-188). A resource has two scopes — `account` and `service` — and what a
-- runner can use is the repository's own business: every runner granted there has the same
-- usable instances (the `service` instance and the account instances that serve the resource and
-- list the repository), so the `worker` scope, the heartbeat's `uses` that named account
-- instances per runner, and the implicit `<resource>@worker:<id>` instances go. An
-- administrator's reading is one more instrument's — no `atoms_from` judging whose readings may
-- steer (route choices left with B-167), and no signature of its own (R-BTN-181: a reading is
-- authenticated by the request that posts it), so a reading's `nonce` and `signature` go too.
--
-- The SQL is the one place the retired rows are dropped; each registration it drops is logged as
-- an `admin` event by this migration's `backfill` (src/migrations/index.ts), beside the rows it
-- read before dropping them.

-- The implicit worker instances a `worker`-scope resource had, child before parent: their
-- readings, their states, the worker `uses` rows that named them, and the serves row that made
-- them an instance of their resource.
DELETE FROM instance_readings WHERE instance LIKE '%@worker:%';
DELETE FROM instance_states WHERE instance LIKE '%@worker:%';
DELETE FROM instance_serves WHERE instance LIKE '%@worker:%';
-- …and what registered them.
DELETE FROM external_resources WHERE scope = 'worker';
-- R-BTN-181: a reading is authenticated by the request that posted it and carries no signature
-- of its own, so the two columns a signed one filled go.
ALTER TABLE instance_readings DROP COLUMN nonce;
ALTER TABLE instance_readings DROP COLUMN signature;
-- R-BTN-176's `atoms_from` judged whether runners' readings steered route choices; route
-- choices left with B-167, so nothing reads it.
ALTER TABLE external_resources DROP COLUMN atoms_from;
-- R-BTN-76: the heartbeat's `uses` named account instances a runner declared; a runner uses
-- what its repository's instances list. The call's `bills` went with it (R-BTN-100): a table the
-- core no longer reads stays until its rows are worth dropping.

-- R-BTN-76 as §13.7 states it: per (repository, resource) the repository's usable instances,
-- how many are not `unavailable`, and whether a live runner is granted on the repository —
-- which is what a resource block asks besides the counts.
CREATE TABLE resource_fleet_0039 (
  repository_id    TEXT NOT NULL REFERENCES repositories(id),
  resource         TEXT NOT NULL,
  usable_instances INTEGER NOT NULL,           -- the service instance and the account instances listing the repository
  open_instances   INTEGER NOT NULL,           -- of those, the ones not unavailable; blocked: live_runner = 1, usable > 0, open = 0
  live_runner      INTEGER NOT NULL DEFAULT 0, -- a live runner is granted on the repository
  PRIMARY KEY (repository_id, resource)
);
-- Every row is recounted at the next change (a heartbeat, a reading, a registration); a row
-- carried over cannot claim a runner is live whose last seen passed while nobody looked.
INSERT INTO resource_fleet_0039 (repository_id, resource, usable_instances, open_instances, live_runner)
  SELECT repository_id, resource, usable_workers, open_workers, 0 FROM resource_fleet;
DROP TABLE resource_fleet;
ALTER TABLE resource_fleet_0039 RENAME TO resource_fleet;

-- Part 4's retired wire fields log one `deprecated-field` event per credential and field per
-- day (BATON_SPEC_HISTORY, Migrations: "part 4's retired fields"), as R-BTN-132's window does
-- for the board post's. One row per (field, actor, day); the day is the event's at / 86 400 000.
CREATE TABLE deprecated_fields (
  field     TEXT NOT NULL,
  actor     TEXT NOT NULL,
  day       INTEGER NOT NULL,
  seen_at   INTEGER NOT NULL,
  PRIMARY KEY (field, actor, day)
);
-- The log's first kind of the window (B-168's heartbeat `uses` and claim `bills`); readings'
-- `nonce`/`signature` and a course entry's `report_horizon_h` join it with B-167's and B-169's
-- posts. Nothing references the table beyond its indexes, so it is rebuilt with the wider check,
-- its indexes restored beside it, as 0035 and 0037 did.
CREATE TABLE events_0039 (
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
                  'scope-invalid','scope-resolved','renumbered','deprecated-field')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0039 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP INDEX IF EXISTS events_by_claim;
DROP INDEX IF EXISTS events_by_repository;
DROP INDEX IF EXISTS events_discrepancies;
DROP TABLE events;
ALTER TABLE events_0039 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
