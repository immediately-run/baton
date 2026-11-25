-- B-39: output envelopes and the schemas of the inputs actually given to each run.
ALTER TABLE leg_run_inputs ADD COLUMN schema TEXT;
ALTER TABLE claim_legs ADD COLUMN contract_version INTEGER;
ALTER TABLE claim_legs ADD COLUMN contract_course_version INTEGER;
ALTER TABLE repositories ADD COLUMN artifact_buckets TEXT NOT NULL DEFAULT '[]';

CREATE TABLE leg_outputs (
  ticket_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  run INTEGER NOT NULL,
  name TEXT NOT NULL,
  schema TEXT NOT NULL,
  uri TEXT,
  digest TEXT,
  value_json TEXT,
  course_version INTEGER NOT NULL,
  leg_version INTEGER NOT NULL,
  claim_id INTEGER,
  source TEXT NOT NULL CHECK (source IN ('holder', 'sync')),
  confirmed INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, leg, run, name)
);
