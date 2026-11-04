-- 0028_session_links.sql — session links (BATON_SPEC §8.3 R-BTN-113, §11.2 R-BTN-57, §13.1, §14;
-- B-4): the administrators' instance settings and the column a leg run carries its session's
-- link in. A link that fails R-BTN-113's rule is dropped and logged, never stored.

-- §13.1's one row of instance settings. No row is the defaults: `link_hosts` empty (R-BTN-112),
-- `session_hosts` `["claude.ai"]` (R-BTN-113), no check App (§12.7).
CREATE TABLE instance_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  link_hosts    TEXT NOT NULL DEFAULT '[]',            -- JSON: hosts an administrator allowed for a view's links (R-BTN-112)
  session_hosts TEXT NOT NULL DEFAULT '["claude.ai"]', -- JSON: hosts a session link may come from (R-BTN-113)
  check_app_id  INTEGER                               -- the check App's id, by which the sync tells its runs (R-BTN-115, §12.7)
);

-- R-BTN-113: the running leg's session link, latest wins while running.
ALTER TABLE claim_legs ADD COLUMN session_url TEXT;

-- The event log gains `session-url-dropped` (a session link R-BTN-113's rule refused — dropped,
-- never refusing the heartbeat, advance or end that carried it). Nothing references `events`, so
-- it is rebuilt with the wider check, every row and its seq (the mirror's cursor) carried over,
-- as 0013, 0014, 0016, 0018 and 0021 did. 0027's rebuild recreated `events_by_ticket` alone, so
-- `events_by_claim`, `events_by_repository` and `events_discrepancies` had been dropped with the
-- old table; this rebuild brings all four back.
CREATE TABLE events_0028 (
  seq           INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('claimed','completed','confirmed',
                  'released','reaped','fence-cleared','adopted','rekeyed','override',
                  'suspension','reviewer-substituted','attempts-exhausted','held','cutover',
                  'snapshot-rejected','snapshot-accepted','shadow-conflict','foreign-claim',
                  'advanced','advice-overridden','off-graph','bars-mismatch','regressed','admin',
                  'blocked','unblocked','resource','discrepancy','queue-over','course-closed',
                  'course-opened','taken-invalid','session-url-dropped')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0028 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP TABLE events;
ALTER TABLE events_0028 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
