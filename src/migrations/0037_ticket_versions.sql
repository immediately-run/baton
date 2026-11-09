-- 0034_ticket_versions.sql — opaque ticket versions and stable keys (BATON_SPEC §4.2 R-BTN-74,
-- §4.3 R-BTN-11/R-BTN-62/R-BTN-147, §4.4, §4.5 R-BTN-5/R-BTN-34; B-183). A ticket's version is
-- the ticket source's opaque string — the markdown source's is the ticket file's blob id at the
-- posted commit — compared by Baton for equality only (values 4: no ordering, no clock). The
-- `key` is the source's stable name for the ticket (default: its `path`), by which a dropped and
-- re-added ticket is detected as `renumbered` (R-BTN-147).

-- '' is "no version posted" (a source that posts none, an older CLI): never stale, never
-- compared. A posted version is validated on write (§12.3: 1–128 of [A-Za-z0-9._:+/=-]).
ALTER TABLE tickets ADD COLUMN version TEXT NOT NULL DEFAULT '';

-- NULL is "no key posted and no path to default one from" (the interim post's rows keep NULL
-- until their next materialization; a normative ticket always resolves a key: its own or its
-- path). `key` is not reserved in SQLite (it parses bare; the materializer writes it unquoted).
ALTER TABLE tickets ADD COLUMN key TEXT;

-- The last accepted post's ticket-source declaration (§4.4 `source`): how the source reads a
-- ticket — 'pinned' (at a version) or 'current' (as it is now) — for the runner's re-verification
-- (§4.5) and the `tickets-approved` floor's refusal. NULL: never declared.
ALTER TABLE board_head ADD COLUMN source_kind TEXT;
ALTER TABLE board_head ADD COLUMN source_versions TEXT;

-- R-BTN-147's `renumbered` joins the event log's kinds (B-183: a dropped ticket re-added under a
-- new id at the same `key` — the move is logged, the new id taking the old one's hold and
-- backoff). Nothing references `events`, so it is rebuilt with the wider check, as 0027 and 0031
-- did, its indexes restored beside it.
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
                  'answer-invalid','arrival-unapplied','renumbered')),
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
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
