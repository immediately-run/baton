-- 0021_leg_queues.sql — R3-1255 (BATON_SPEC §2g R-BTN-79, R-BTN-80, §4): each leg's queue — the
-- unheld tickets whose queued leg it is — counted in the transactions that change it, and the
-- `queue-over`, `course-closed` and `course-opened` events.

CREATE TABLE leg_queues (                         -- R-BTN-79: unheld tickets whose queued leg is the leg
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  course_id     TEXT NOT NULL,
  leg           TEXT NOT NULL,
  depth         INTEGER NOT NULL,
  max_queue     INTEGER,                          -- the bound last judged against (spec-silent, R3-1255): a
                                                  -- course file's new bound is a crossing too, and is
                                                  -- found by comparing with this
  PRIMARY KEY (repository_id, course_id, leg)
);
-- Which queue each ticket is counted in (spec-silent, R3-1255): a change of membership moves one
-- ticket between two rows, so a depth is counted, never recounted by a scan.
CREATE TABLE leg_queue_members (
  ticket_id     TEXT PRIMARY KEY,                 -- no cascade: a ticket leaving the board leaves its queue
                                                  -- in the transaction that deletes it (Queues.touch)
  repository_id TEXT NOT NULL,
  course_id     TEXT NOT NULL,
  leg           TEXT NOT NULL
);
CREATE INDEX leg_queue_members_by_leg ON leg_queue_members(repository_id, course_id, leg);

-- The tickets already queued: those with a queued leg and no claim holding them (R-BTN-75's held,
-- the one definition — Blocks.isHeld).
INSERT INTO leg_queue_members (ticket_id, repository_id, course_id, leg)
  SELECT t.id, t.repository_id, t.course_id, s.next_leg FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
  WHERE s.next_leg IS NOT NULL AND t.course_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.ticket_id = t.id AND (c.status = 'active'
                    OR (c.status = 'completed' AND c.confirmed_at IS NULL) OR (c.status = 'reaped' AND c.fence_pending = 1)));
INSERT INTO leg_queues (repository_id, course_id, leg, depth, max_queue)
  SELECT m.repository_id, m.course_id, m.leg, COUNT(*),
         (SELECT json_extract(c.course_json, '$.legs."' || m.leg || '".max_queue') FROM courses c
          WHERE c.repository_id = m.repository_id AND c.id = m.course_id)
  FROM leg_queue_members m GROUP BY m.repository_id, m.course_id, m.leg;

-- The event log gains `queue-over`, `course-closed` and `course-opened` (R-BTN-79). Nothing
-- references `events`, so it is rebuilt with the wider check, as 0014, 0016 and 0018 did.
CREATE TABLE events_0021 (
  seq           INTEGER PRIMARY KEY,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('claimed','completed','confirmed',
                  'released','reaped','fence-cleared','adopted','rekeyed','override',
                  'suspension','reviewer-substituted','attempts-exhausted','held','cutover',
                  'snapshot-rejected','snapshot-accepted','shadow-conflict','foreign-claim',
                  'advanced','advice-overridden','off-graph','bars-mismatch','regressed','admin',
                  'blocked','unblocked','resource','discrepancy','queue-over','course-closed','course-opened')),
  ticket_id     TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  actor         TEXT NOT NULL,
  detail_json   TEXT,
  repository_id TEXT
);
INSERT INTO events_0021 (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id)
  SELECT seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id FROM events;
DROP TABLE events;
ALTER TABLE events_0021 RENAME TO events;
CREATE INDEX events_by_ticket ON events(ticket_id, kind, seq);
CREATE INDEX events_by_claim ON events(claim_id, kind, seq);
CREATE INDEX events_by_repository ON events(repository_id, seq);
CREATE INDEX events_discrepancies ON events(at) WHERE kind = 'discrepancy';
