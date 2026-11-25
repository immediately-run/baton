-- B-27 (R-BTN-83, R-BTN-163): a board condition belongs to a ticket, not a claim or run.
CREATE TABLE conditions_0075 (
  id              INTEGER PRIMARY KEY,
  repository_id   TEXT NOT NULL,
  ticket_id       TEXT NOT NULL,
  claim_id        INTEGER REFERENCES claims(id),
  run_id          TEXT,
  leg             TEXT,
  type            TEXT NOT NULL,
  disposition     TEXT NOT NULL CHECK (disposition IN ('interrupt','suspend','notify')),
  severity        TEXT NOT NULL DEFAULT 'normal',
  url             TEXT,
  restarts_json   TEXT NOT NULL DEFAULT '{}',
  default_restart TEXT,
  raised_at       INTEGER NOT NULL,
  outcome         TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','superseded','recorded','closed')),
  closed_at       INTEGER,
  closed_how      TEXT,
  reraised        INTEGER NOT NULL DEFAULT 0
);
INSERT INTO conditions_0075 (id, repository_id, ticket_id, claim_id, run_id, leg, type, disposition,
                             severity, url, restarts_json, default_restart, raised_at, outcome, closed_at, closed_how)
  SELECT id, repository_id, ticket_id, claim_id, run_id, leg, type, disposition,
         severity, url, restarts_json, default_restart, raised_at, outcome, closed_at, closed_how FROM conditions;
DROP TABLE conditions;
ALTER TABLE conditions_0075 RENAME TO conditions;
CREATE INDEX conditions_open ON conditions(repository_id, type, raised_at) WHERE outcome = 'open';
CREATE INDEX conditions_by_ticket ON conditions(ticket_id, raised_at);
CREATE INDEX conditions_by_run ON conditions(run_id);
CREATE INDEX conditions_by_claim ON conditions(claim_id);

-- The first refresh must settle missing-next conditions even if the reading is unchanged.
DELETE FROM sync_fingerprints;
