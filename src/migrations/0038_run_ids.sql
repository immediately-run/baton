-- 0038_run_ids.sql — every leg run has a run id (BATON_SPEC §5.3 R-BTN-63, §13.5 `claim_legs`;
-- B-185). `claim_legs` gains the surrogate `id` §13.5 names, the run's `run_id` (unique across
-- the tenant; opaque, compared for equality only) and the run-record columns §13.5 lists that no
-- migration had added: `head_sha`, `session_url` and `leg_log_dir` (R-BTN-128). SQLite cannot add
-- a primary key or a UNIQUE column in place, so the table is rebuilt — create, copy, drop,
-- rename — keeping `(claim_id, seq)` unique, as its key was. Nothing references `claim_legs`.
--
-- Runs recorded before this migration get their run ids from the migration's backfill
-- (`src/migrations/index.ts`, minted from each run's `started_at` as R-BTN-63 says), in the
-- same transaction: a ULID needs the core's random source, which SQL does not have.
CREATE TABLE claim_legs_0038 (
  id            INTEGER PRIMARY KEY,
  claim_id      INTEGER NOT NULL REFERENCES claims(id),
  seq           INTEGER NOT NULL,
  run_id        TEXT UNIQUE,                     -- R-BTN-63: `r_` + a ULID; set at the advance that starts the run
  leg           TEXT NOT NULL,
  from_station  TEXT NOT NULL,
  to_station    TEXT,
  bars          TEXT NOT NULL DEFAULT '[]',
  started_at    INTEGER NOT NULL,
  started_observation INTEGER NOT NULL,
  finished_at   INTEGER,
  abandoned_at  INTEGER,
  evidence      TEXT,
  bars_judged   INTEGER NOT NULL DEFAULT 0,
  route_choices_json TEXT,
  taken_json    TEXT,
  head_sha      TEXT,                            -- §13.5: the branch head the holder reported (R-BTN-63's advance)
  session_url   TEXT,                            -- §13.5: the run's session, when the holder reports one
  leg_log_dir   TEXT,                            -- R-BTN-128: the run's log directory, when a root is set
  UNIQUE (claim_id, seq)
);
INSERT INTO claim_legs_0038 (claim_id, seq, leg, from_station, to_station, bars, started_at, started_observation,
                             finished_at, abandoned_at, evidence, bars_judged, route_choices_json, taken_json)
  SELECT claim_id, seq, leg, from_station, to_station, bars, started_at, started_observation,
         finished_at, abandoned_at, evidence, bars_judged, route_choices_json, taken_json
  FROM claim_legs ORDER BY claim_id, seq;
DROP TABLE claim_legs;
ALTER TABLE claim_legs_0038 RENAME TO claim_legs;

-- R-BTN-81: the history's leg rows carry the run's id. Rows written before this have none.
ALTER TABLE ticket_history ADD COLUMN run_id TEXT;
