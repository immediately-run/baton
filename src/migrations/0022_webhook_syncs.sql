-- 0022_webhook_syncs.sql — B-89 (BATON_SPEC §7.1, R-BTN-73): when each repository's board was
-- last sent a sync for something GitHub told Baton about — a merge's pull_request delivery, or
-- R-BTN-73's dispatches for another repository's tickets. The alarm sends one when the row is
-- over `SYNC_STALE_MS` old: the backstop that watches the path which reaches Baton, not only
-- GitHub's schedule (which fires a run of a fifteen-minute cron every two to five hours).

CREATE TABLE webhook_syncs (                      -- one row per repository, once Baton has told it
  repository_id    TEXT PRIMARY KEY REFERENCES repositories(id),
  last_dispatch_at INTEGER NOT NULL
);
