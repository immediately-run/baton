-- 0017_notices.sql — R3-1256 (BATON_SPEC §2g R-BTN-80, §2l R-BTN-103, §4): requests for people.
-- Baton queues a notice per courier for each open decision; couriers claim and mark them. A
-- personal courier is a `courier` credential its repositories' owners register with the `asks`
-- it delivers; a worker courier is a machine key whose heartbeat says so, and takes the one pool
-- copy a `(repository, asks)` gets while one has been seen within 24 hours.

CREATE TABLE couriers (                          -- R-BTN-80: a courier key's repositories and the asks it delivers
  credential_id TEXT NOT NULL REFERENCES credentials(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  asks          TEXT NOT NULL,
  PRIMARY KEY (credential_id, repository_id, asks)
);
CREATE INDEX couriers_by_repository ON couriers(repository_id, asks);

CREATE TABLE notices (                            -- R-BTN-80: requests for people, one per (decision, courier)
  id            TEXT PRIMARY KEY,                  -- random; a courier's dedupe key
  credential_id TEXT NOT NULL REFERENCES credentials(id),   -- a personal courier, or the reserved 'pool' row
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  -- Not a cascade as §4 has it (spec-vs-code, recorded on R3-1256): a ticket that leaves the board
  -- is deleted, and its closed notices must outlive it by 7 days, so a late mark is answered
  -- `closed` (R-BTN-80); the alarm's deletion bounds them.
  ticket_id     TEXT,                              -- NULL for 'queue-over'
  kind          TEXT NOT NULL CHECK (kind IN ('decision','queue-over')),
  ref           TEXT NOT NULL,                     -- the decision id, or the over-bound leg (course:leg)
  state         TEXT NOT NULL CHECK (state IN ('queued','claimed','sent','closed')),
  attempts      INTEGER NOT NULL DEFAULT 0,        -- failed marks since it was last sent: the backoff's step
  not_before    INTEGER NOT NULL,                  -- queued: the backoff; claimed: the lease's end; sent: the reminder;
                                                 -- closed: deletion
  sent_at       INTEGER,
  channel       TEXT,                              -- the courier's label for how it delivered
  payload_json  TEXT,                              -- 'queue-over': {leg, depth, max_queue, intake}; ≤ 512 bytes
  updated_at    INTEGER NOT NULL,
  -- Spec-silent (recorded on R3-1256): a notice carries `created_at` (R-BTN-80's shape). The
  -- pool's hour unclaimed (R-BTN-103) is counted from `updated_at`, the copy's last return to
  -- the queue, so a lapse or a failed mark starts the hour again.
  created_at    INTEGER NOT NULL,
  claimed_by    TEXT                               -- R-BTN-103: the fingerprint of the key that last claimed it
);
CREATE INDEX notices_due ON notices(credential_id, state, not_before);   -- a courier's claim
CREATE INDEX notices_alarm ON notices(state, not_before);                 -- the alarm: lapsed leases, reminders, deletion
CREATE INDEX notices_by_ref ON notices(ticket_id, ref);                   -- a decision's notices, to close them

CREATE TABLE worker_couriers (                   -- R-BTN-103: rewritten by each heartbeat's `couriers`
  worker_id     INTEGER NOT NULL REFERENCES workers(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  asks          TEXT NOT NULL,
  seen_at       INTEGER NOT NULL,                -- a pool copy is queued while one is within 24 hours
  PRIMARY KEY (worker_id, repository_id, asks)
);
CREATE INDEX worker_couriers_by_repository ON worker_couriers(repository_id, asks, seen_at);

-- R-BTN-80: a sent notice still open is queued again after this; an owner setting, 1 hour to 7 days.
ALTER TABLE repositories ADD COLUMN remind_after_s INTEGER NOT NULL DEFAULT 86400;

-- R-BTN-103: the reserved credential pool copies are queued to. It has no key, so nothing signs as it.
INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by)
  VALUES ('pool', 'pool', '[]', 'courier', NULL, 'system');
