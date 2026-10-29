-- B-109 (§6.9): the `wind-down` message kind — an owner's ask that a worker drain. Only
-- `messages` references `messages`, so it is rebuilt the way 0016 rebuilt it.
CREATE TABLE messages_0024 (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('release','status_request','status_report','unblocked','wind-down')),
  payload_json    TEXT,
  from_worker_id  INTEGER REFERENCES workers(id),
  from_principal  TEXT,
  to_worker_id    INTEGER NOT NULL REFERENCES workers(id),
  in_reply_to     INTEGER REFERENCES messages_0024(id),
  sent_at         INTEGER NOT NULL,
  delivered_at    INTEGER,
  acknowledged_at INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('pending','delivered','acknowledged','expired')),
  CHECK (from_worker_id IS NOT NULL OR from_principal IS NOT NULL)
);
INSERT INTO messages_0024 SELECT id, kind, payload_json, from_worker_id, from_principal, to_worker_id, in_reply_to, sent_at, delivered_at, acknowledged_at, status FROM messages;
DROP TABLE messages;
ALTER TABLE messages_0024 RENAME TO messages;
