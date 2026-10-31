-- 0027_route_choices.sql — route choices (BATON_SPEC §6.10, R-BTN-176/R-BTN-177, B-105): what a
-- resource's readings may steer (atoms_from), the x-baton-base chain a registration proved, the
-- hysteresis rows each resolution writes, and the two columns a leg run carries its route-choice
-- snapshot and its reported taken in.

-- R-BTN-76 as R-BTN-176 amends it: whether runners' readings, besides administrators' and
-- instrument keys', may steer route choices for a resource. 'admin' (the default) hears only
-- administrators and instrument keys; 'any' admits every runner's readings for the resource's
-- instances — the tenant telling Baton it trusts its runners' reports to steer advice.
ALTER TABLE external_resources ADD COLUMN atoms_from TEXT NOT NULL DEFAULT 'admin'
  CHECK (atoms_from IN ('admin','any'));

-- R-BTN-176: the schema's named `x-baton-base` chain (one `std:` id per row, outermost first),
-- proved at registration; core forms `refines(R, S)` from it and never resolves the schemas again.
ALTER TABLE external_resources ADD COLUMN base_chain_json TEXT NOT NULL DEFAULT '[]';

-- R-BTN-177's hysteresis: one row per alternative at each resolution, written whether or not the
-- alternative was available, read as `was_demoted` while younger than 24 hours and deleted by the
-- alarm after. Keyed by worker: what a runner can use differs between runners.
CREATE TABLE route_last (
  worker_id     INTEGER NOT NULL REFERENCES workers(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  choice        TEXT NOT NULL,
  alternative   TEXT NOT NULL,
  demoted       INTEGER NOT NULL,
  resolved_at   INTEGER NOT NULL,
  PRIMARY KEY (worker_id, repository_id, choice, alternative)
);

-- The resolved route choices a leg run started under (R-BTN-177: a snapshot, not refreshed while
-- the leg runs), and the taken its finishing advance or end reported against them.
ALTER TABLE claim_legs ADD COLUMN route_choices_json TEXT;
ALTER TABLE claim_legs ADD COLUMN taken_json TEXT;

-- R-BTN-177's `taken-invalid` joins the event log's kinds (a dropped entry is logged, never
-- refusing the advance or end that carried it). Nothing references `events`, so it is rebuilt
-- with the wider check, as 0014, 0016, 0018 and 0021 did.
CREATE TABLE events_0026 (
  seq           INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('claimed','completed','confirmed',
                  'released','reaped','fence-cleared','adopted','rekeyed','override',
                  'suspension','reviewer-substituted','attempts-exhausted','held','cutover',
                  'snapshot-rejected','snapshot-accepted','shadow-conflict','foreign-claim',
                  'advanced','advice-overridden','off-graph','bars-mismatch','regressed','admin',
                  'blocked','unblocked','resource','discrepancy','queue-over','course-closed',
                  'course-opened','taken-invalid')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0026 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP INDEX IF EXISTS events_by_ticket;
DROP TABLE events;
ALTER TABLE events_0026 RENAME TO events;
DROP INDEX IF EXISTS events_by_ticket_0026;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
