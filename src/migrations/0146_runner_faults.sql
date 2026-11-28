-- B-359: retry effects are provisional until their runner's failure window passes.
ALTER TABLE repositories ADD COLUMN runner_faults TEXT;

CREATE TABLE runner_fault_backoff (
  credential_id TEXT PRIMARY KEY,
  until_at INTEGER NOT NULL,
  delay_ms INTEGER NOT NULL
);

CREATE TABLE runner_fault_episodes (
  repository_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  burst INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, credential_id)
);
CREATE INDEX runner_fault_episodes_key ON runner_fault_episodes(credential_id);

CREATE TABLE runner_fault_samples (
  claim_id INTEGER PRIMARY KEY REFERENCES claims(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  ended_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  error_type TEXT,
  burst INTEGER,
  undo_json TEXT
);
CREATE INDEX runner_fault_samples_window ON runner_fault_samples(repository_id, credential_id, ended_at);
CREATE INDEX runner_fault_samples_key ON runner_fault_samples(credential_id);
CREATE INDEX runner_fault_samples_expiry ON runner_fault_samples(ended_at) WHERE burst IS NULL;
