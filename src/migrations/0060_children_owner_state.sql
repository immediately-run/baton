-- 0060_children_owner_state.sql — R3-1258 (BATON_SPEC §4.6 R-BTN-86, §4.8 R-BTN-88, §13): child
-- tickets and owner state. `tickets.parent` holds the qualified id of a ticket's same-repository
-- parent (`<repository>:<local id>`, R-BTN-47), stored by the snapshot that materializes the
-- ticket — a malformed or cycling parent is stored as NULL and logged `parent-invalid`
-- (R-BTN-149's cap: 4 generations below a root); `tickets_by_parent` serves the children read
-- (§14) and the dashboard's tree. `closed_tickets.parent` keeps the relation past the close,
-- until the purge. `pending_owner_state` holds the ticket-scoped rows an import writes before
-- their ticket's first snapshot creates it (§13's row: kind `override` here; `condition`,
-- `timer` and `outbox` arrive with the tickets that add those sections, `station`, `history`
-- and `run` with course history) — applied by that snapshot, dropped and logged by the
-- repository's first one if it posts no such ticket.
--
-- The events table is rebuilt with `capacity` (R-BTN-87's envelope crossings), `parent-invalid`
-- (R-BTN-86), `frozen`, `unfrozen`, `sealed` and `imported` (R-BTN-88) beside every kind the
-- 0059 CHECK holds. `baton_settings` is a key-value table: `frozen_at` and `sealed_at` are rows
-- in it, written by the freeze, seal and import paths. `repositories.mirror_acked_seq` (0006)
-- is the cursor the seal reads. The `spawned_children` table holds what a `spawned` end
-- reported as the run's children until the first accepted snapshot observed after the end
-- (R-BTN-85's `spawned-unposted` drops the unposted ones there); the range a call settles over
-- (R-BTN-165) is B-62's to read.
CREATE TABLE spawned_children (
  repository_id TEXT NOT NULL,
  ticket_id     TEXT NOT NULL,               -- the parent, a qualified id
  claim_id      INTEGER NOT NULL,
  children_json TEXT NOT NULL,               -- the reported local ids still recorded
  observation   INTEGER NOT NULL,            -- the observation counter at the end
  ended_at      INTEGER NOT NULL,
  PRIMARY KEY (repository_id, ticket_id, claim_id)
);

ALTER TABLE tickets ADD COLUMN parent TEXT;
-- Partial: most tickets name no parent, and the index serves the children reads (R-BTN-86)
-- alone — never the planner's choice for a repository's ordinary pages (test/unit/blocks.test.ts
-- keeps `tickets_blocked` the unfiltered blocked page's).
CREATE INDEX tickets_by_parent ON tickets(repository_id, parent) WHERE parent IS NOT NULL;
ALTER TABLE closed_tickets ADD COLUMN parent TEXT;

CREATE TABLE pending_owner_state (
  repository_id TEXT NOT NULL,
  ticket_id     TEXT NOT NULL,               -- a qualified id the import holds rows for
  kind          TEXT NOT NULL CHECK (kind IN ('override','condition','timer','outbox','station','history','run')),
  key           TEXT NOT NULL,               -- '' (override), the condition id, the timer's (leg, kind), the outbox id
  row_json      TEXT NOT NULL,
  PRIMARY KEY (repository_id, ticket_id, kind, key)
);

-- The events table rebuilt with R3-1258's kinds beside every one 0059 held, its indexes
-- restored, as 0035, 0037, 0040, 0042, 0043, 0048 and 0059 did: nothing references the table
-- beyond its indexes.
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
                  'sequence',
                  'capacity','parent-invalid','frozen','unfrozen','sealed','imported')),
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
