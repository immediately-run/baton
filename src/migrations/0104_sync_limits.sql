-- B-137, R-BTN-187: bind the outstanding observation to its authenticated issuer.
ALTER TABLE board_head ADD COLUMN observation_issuer TEXT;
-- A pre-upgrade reservation cannot be attributed safely. Keep its sequence number voided.
UPDATE board_head SET handed_out_at = NULL WHERE handed_out_at IS NOT NULL;

CREATE TABLE sync_quota (
  issuer TEXT NOT NULL,
  kind TEXT NOT NULL,
  hour INTEGER NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (issuer, kind)
);

CREATE TABLE sync_lapses (
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  issuer TEXT NOT NULL,
  day INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, issuer)
);

-- The board's delivery-derived control notices, distinct from course accounting (B-264).
CREATE TABLE sync_control_changes (
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  sha TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, sha)
);
CREATE INDEX sync_control_changes_at ON sync_control_changes(at);

CREATE TRIGGER sync_key_release_observation AFTER UPDATE OF revoked_at ON sync_keys
WHEN OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL BEGIN
  UPDATE board_head SET handed_out_at = NULL, observation_issuer = NULL
    WHERE repository_id = NEW.repository_id AND observation_issuer = NEW.fingerprint;
  DELETE FROM sync_lapses WHERE repository_id = NEW.repository_id AND issuer = NEW.fingerprint;
END;
