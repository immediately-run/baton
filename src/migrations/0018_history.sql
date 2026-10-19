-- 0018_history.sql — R3-1257 (BATON_SPEC §2h R-BTN-81, R-BTN-85, §2g R-BTN-78, §4): each ticket's
-- history, the 90-day purge of a closed ticket's rows, and the `discrepancy` event Baton logs when
-- an accepted snapshot overrides what it held.

CREATE TABLE ticket_history (                    -- R-BTN-81: a running record, never replayed into state
  id            INTEGER PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  ticket_id     TEXT NOT NULL,                   -- kept 90 days after the ticket closes
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  claim_id      INTEGER,
  worker_id     INTEGER,
  leg           TEXT,
  reached       TEXT,
  next_leg      TEXT,
  run           INTEGER,                         -- the leg's run number, on leg rows
  snapshot_sha  TEXT,                            -- the claim's snapshot_sha, on leg rows
  head_sha      TEXT,                            -- the code head the leg started from, on leg rows (reported from B-39)
  course_version INTEGER,
  leg_version   INTEGER,
  detail_json   TEXT                             -- names, ids, versions, pointers and digests only (R-BTN-33), ≤ 2 KB
);
CREATE INDEX history_by_ticket ON ticket_history(ticket_id, id);

-- R-BTN-81: a closed ticket's history goes 90 days after it closed; `purged_at` keeps the alarm
-- from scanning it again.
ALTER TABLE closed_tickets ADD COLUMN purged_at INTEGER;
CREATE INDEX closed_unpurged ON closed_tickets(closed_at) WHERE purged_at IS NULL;

-- The event log gains `discrepancy` (R-BTN-85). Nothing references `events`, so it is rebuilt with
-- the wider check, as 0014 and 0016 did.
CREATE TABLE events_0018 (
  seq           INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('claimed','completed','confirmed',
                  'released','reaped','fence-cleared','adopted','rekeyed','override',
                  'suspension','reviewer-substituted','attempts-exhausted','held','cutover',
                  'snapshot-rejected','snapshot-accepted','shadow-conflict','foreign-claim',
                  'advanced','advice-overridden','off-graph','bars-mismatch','regressed','admin',
                  'blocked','unblocked','resource','discrepancy')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0018 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP TABLE events;
ALTER TABLE events_0018 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
-- The dashboard's Discrepancies (R-BTN-85).
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
