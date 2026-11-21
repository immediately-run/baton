-- B-55 / S-BTN-131: core condition identities and a server-recorded activity per raise.
CREATE TABLE conditions_next (
  id            INTEGER PRIMARY KEY,
  repository_id TEXT NOT NULL,
  ticket_id     TEXT,
  ref           TEXT,
  handler       TEXT,
  detail_json   TEXT,
  restart       TEXT,
  answered_by   TEXT,
  claim_id      INTEGER REFERENCES claims(id),
  run_id        TEXT,                    -- the raising run (`claim_legs.run_id`)
  leg           TEXT,
  type          TEXT NOT NULL,                    -- R-BTN-160's grammar
  disposition   TEXT NOT NULL CHECK (disposition IN ('interrupt','suspend','notify')),
  severity      TEXT NOT NULL DEFAULT 'normal',   -- R-BTN-125
  url           TEXT,                             -- an interact: the stored session link (R-BTN-195); an unbound suspend: where git holds the question (R-BTN-92)
  restarts_json TEXT NOT NULL DEFAULT '{}',       -- R-BTN-33: ids and descriptions only
  default_restart TEXT,
  raised_at     INTEGER NOT NULL,
  outcome       TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','superseded','recorded','closed')),
  closed_at     INTEGER,
  closed_how    TEXT                              -- 'run-ended' for an interact whose run ended
);
INSERT INTO conditions_next (id, repository_id, ticket_id, claim_id, run_id, leg, type, disposition,
    severity, url, restarts_json, default_restart, raised_at, outcome, closed_at, closed_how)
  SELECT id, repository_id, ticket_id, claim_id, run_id, leg, type, disposition,
    severity, url, restarts_json, default_restart, raised_at, outcome, closed_at, closed_how FROM conditions;
DROP TABLE conditions;
ALTER TABLE conditions_next RENAME TO conditions;
CREATE INDEX conditions_open ON conditions(repository_id, type, raised_at) WHERE outcome = 'open';
CREATE INDEX conditions_by_ticket ON conditions(ticket_id, raised_at);
CREATE INDEX conditions_by_claim ON conditions(claim_id);
CREATE INDEX conditions_by_run ON conditions(run_id);
CREATE INDEX conditions_by_handler ON conditions(handler) WHERE outcome = 'open' AND handler IS NOT NULL;
-- SQLite treats NULLs as distinct in unique indexes; repository-wide conditions also deduplicate.
CREATE UNIQUE INDEX conditions_open_core ON conditions(repository_id, type, COALESCE(ticket_id, ''), COALESCE(ref, ''))
  WHERE outcome = 'open' AND (type = 'baton' OR substr(type, 1, 6) = 'baton.');

CREATE TABLE activities_next (
  runner_id   INTEGER NOT NULL REFERENCES runners(id),
  id          TEXT NOT NULL,              -- client-generated, unique per worker (idempotent retries)
  claim_id    INTEGER REFERENCES claims(id),   -- NULL only for 'orient' before a claim
  parent_id   TEXT,                       -- a reviewer's review round: same worker, same claim
  call_id     TEXT,                       -- hook activities: the harness's tool-call id
  kind        TEXT NOT NULL CHECK (kind IN ('orient','implement','local-verify','open-pr',
                'push','ci-wait','review-round','reviewer','fix-findings','adjudicate',
                'merge','reconcile','status-write','decision-packet','other','condition')),
  seq         INTEGER,                    -- the round number, for review-round
  label       TEXT,                       -- short human text: 'review-pr-deepseek (deepseek-v4-pro)'
  source      TEXT NOT NULL CHECK (source IN ('skill','hook','baton')),
  started_at  INTEGER NOT NULL,           -- worker clock
  ended_at    INTEGER,
  outcome     TEXT CHECK (outcome IN ('succeeded','failed','cancelled','abandoned')),
  received_at INTEGER NOT NULL,           -- server clock
  run_id      TEXT,
  detail_json TEXT,                       -- bounded (§10.4): PR URL, finding counts, exit code
  PRIMARY KEY (runner_id, id),
  UNIQUE (runner_id, call_id),
  CHECK ((ended_at IS NULL) = (outcome IS NULL)),
  CHECK (claim_id IS NOT NULL OR kind = 'orient')
);
INSERT INTO activities_next (runner_id, id, claim_id, parent_id, call_id, kind, seq, label,
    source, started_at, ended_at, outcome, received_at, detail_json)
  SELECT runner_id, id, claim_id, parent_id, call_id, kind, seq, label,
    source, started_at, ended_at, outcome, received_at, detail_json FROM activities;
DROP TABLE activities;
ALTER TABLE activities_next RENAME TO activities;
CREATE INDEX activities_by_claim ON activities(claim_id, started_at);
CREATE INDEX activities_open ON activities(runner_id) WHERE ended_at IS NULL;
