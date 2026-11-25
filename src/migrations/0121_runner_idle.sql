-- B-244: one idle episode per runner, independent of the scheduling memo and host restarts.
CREATE TABLE runner_idle (
  runner_id INTEGER PRIMARY KEY REFERENCES runners(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0
);
