-- 0039_retire_ontology.sql — B-167: the capability ontology and the route choices leave core
-- (BATON_SPEC §5.9 R-BTN-174, §6.10; the restructure's retired rules, BATON_SPEC_HISTORY.md).
-- Rule 4 matches the capabilities a ticket and its leg require against what a runner declares,
-- granted, by name:
-- nothing is derived, no route is resolved and no advice is delivered or recorded. The tables
-- and columns that carried those reads go, each child before its parent and every one created
-- by a migration this file never edits — 0025_ontology.sql and 0027_route_choices.sql keep their
-- text as the history of what was built.
--
-- A worker's derived set and its input digest (0025), the program in force and the refusals a
-- Needs-you listing showed (0025), the hysteresis rows a resolution wrote (0027), the route
-- choices a course entry attached (0025) and the snapshot and taken a leg run carried (0027),
-- the readings' `x-baton-base` chain and `atoms_from` (0027: flags that steered route choices
-- and nothing else), and the course's `report_horizon_h` (0007: R-BTN-52 with the route choices,
-- read by nothing since). Every column is dropped with the table or through `DROP COLUMN`, which
-- SQLite supports in place; no index, trigger or view names them.

-- R-BTN-174's derived sets and their inputs (0025).
DROP TABLE worker_derived;
DROP TABLE worker_derived_inputs;
DROP TABLE ontology_refusals;
DROP TABLE ontologies;

-- The route choices' hysteresis rows (0027), now gone (BATON_SPEC_HISTORY.md, Retired).
DROP TABLE route_last;

-- The legs' and courses' route-choice columns (0025, 0027).
ALTER TABLE claim_legs DROP COLUMN route_choices_json;
ALTER TABLE claim_legs DROP COLUMN taken_json;
ALTER TABLE courses DROP COLUMN route_choices_json;
ALTER TABLE courses DROP COLUMN report_horizon_h;

-- The resource flags route choices read (0027): nothing reads either any more.
ALTER TABLE external_resources DROP COLUMN atoms_from;
ALTER TABLE external_resources DROP COLUMN base_chain_json;

-- The taken's `taken-invalid` leaves the event log's kinds, with the taken it logged; the two
-- kinds the restructure's retired fields still write stay (`advice-overridden`, `scope-invalid`).
-- Nothing references `events`, so it is rebuilt with the narrower check — 0037's kinds less
-- `taken-invalid` — as 0027, 0031, 0035 and 0037 did, its indexes restored beside it.
CREATE TABLE events_0039 (
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
                  'scope-invalid','scope-resolved','renumbered')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0039 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events
  WHERE kind != 'taken-invalid';
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
