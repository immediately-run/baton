-- 0047_leg_run_inputs.sql — B-190 (BATON_SPEC §9.8 R-BTN-84, §5.5 R-BTN-82, §13.5 `leg_run_inputs`):
-- what each leg run was given, so any run can be replayed. Rows are written by the advance that
-- starts the run, from the runner's report at the run's start: each resolved input as a pointer
-- (uri and digest, or a bounded inline value — never content, R-BTN-33), and — on the row whose
-- `name` is empty, reserved for it — the ticket's version as the source posted it (B-183) and the
-- digest of what the source's `read` returned for the run, which is the version check's second
-- half: a version can name the same bytes under a moved store, and the digest says it did.
--
-- The ticket source itself declares how it reads (§4.2 R-BTN-74): a `pinned` source reads at a
-- version, a `current` one only as it is now. Replay (R-BTN-84) reads the ticket the same way and
-- compares both; a current source whose version or read digest moved stops the replay unless the
-- operator passed --accept-moved. `leg_version` is the leg contract's version (R-BTN-82), NULL
-- until contracts are recorded.
CREATE TABLE leg_run_inputs (
  claim_id       INTEGER NOT NULL REFERENCES claims(id),
  seq            INTEGER NOT NULL,             -- the run's `claim_legs` row (claim_id, seq)
  name           TEXT NOT NULL,                -- '' names the run's ticket row; a named input otherwise
  ticket_id      TEXT NOT NULL,
  from_leg       TEXT,                         -- the producing leg (R-BTN-82)
  from_run       INTEGER,                      -- the producing run
  uri            TEXT,                         -- ≤ 1 KB pointer (R-BTN-82)
  digest         TEXT,                         -- 'sha256:<hex>'
  value_json     TEXT,                         -- a bounded inline value (R-BTN-108), never beside a uri
  leg_version    INTEGER,                      -- the input's contract version
  ticket_version TEXT,                         -- the ticket row: the version the source posted
  read_digest    TEXT,                         -- the ticket row: digest of what read returned
  PRIMARY KEY (claim_id, seq, name)
);
