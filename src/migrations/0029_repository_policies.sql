-- 0028_repository_policies.sql — the repository policy (BATON_SPEC §12.8 R-BTN-188/R-BTN-189,
-- B-145): one versioned policy document per repository, the floors a deployment registers over
-- its guarantees, the human-only keys that satisfy human approver entries, the trust attributes
-- a grant and a courier carry (their setting routes are B-147's), the protection reports that
-- feed `no-runner-lands`, the policy pins trusted runners report, and Baton's own policy
-- conditions (`baton.unprotected`, `baton.policy-unpinned`).
--
-- Every existing repository gets version 1 — the `cooperative` preset on a forge, `plain-git`
-- where `forge` is `git` — written by `Policies.ensure` at start and at registration (the hash
-- is Baton's own SHA-256 over the canonical document, computed in code, never in SQL). The
-- version table is append-only: triggers refuse every UPDATE and DELETE, on both hosts.

CREATE TABLE repository_policies (               -- R-BTN-188: the append-only policy log
  repository_id  TEXT NOT NULL REFERENCES repositories(id),
  version        INTEGER NOT NULL,               -- 1 up, one per change
  policy_json    TEXT NOT NULL,                  -- the document, validated before it is written
  hash           TEXT NOT NULL,                  -- SHA-256 over the RFC 8785 canonical document
  previous_hash  TEXT,                           -- the version before; NULL for version 1
  changed_by     TEXT NOT NULL,                  -- the credential that made it (an actor column)
  approver       TEXT,                           -- the approver class it met (R-BTN-188); NULL for version 1
  preset         TEXT,                           -- the preset it applied, if any — the only place a preset name is stored
  at             INTEGER NOT NULL,
  PRIMARY KEY (repository_id, version)
);
CREATE INDEX policies_by_hash ON repository_policies(repository_id, hash);

CREATE TRIGGER repository_policies_no_update BEFORE UPDATE ON repository_policies
  BEGIN SELECT RAISE(ABORT, 'repository_policies is append-only (R-BTN-188)'); END;
CREATE TRIGGER repository_policies_no_delete BEFORE DELETE ON repository_policies
  BEGIN SELECT RAISE(ABORT, 'repository_policies is append-only (R-BTN-188)'); END;

CREATE TABLE policy_floors (                     -- R-BTN-189: a deployment's named guarantees
  repository_id  TEXT NOT NULL REFERENCES repositories(id),
  name           TEXT NOT NULL,                  -- the deployment's name for the floor
  guarantees     TEXT NOT NULL,                  -- JSON array of guarantee names
  remove_by      TEXT NOT NULL DEFAULT 'human' CHECK (remove_by IN ('human', 'owner')),
  added_by       TEXT NOT NULL,
  added_at       INTEGER NOT NULL,
  PRIMARY KEY (repository_id, name)
);

-- Baton's own policy conditions (R-BTN-163's shape, minimally, until §7's condition store is
-- built): one open row per (repository, type, ref). `baton.unprotected` (a protection report
-- that does not match or differs from the previous reading, R-BTN-180) and
-- `baton.policy-unpinned` (a trusted runner whose policy pin differs, R-BTN-189) are `notify`:
-- held open until their closing report arrives.
CREATE TABLE policy_conditions (
  repository_id  TEXT NOT NULL REFERENCES repositories(id),
  type           TEXT NOT NULL,                  -- 'baton.unprotected' | 'baton.policy-unpinned'
  ref            TEXT NOT NULL DEFAULT '',       -- the runner a pin belongs to; '' for the repository's own
  raised_at      INTEGER NOT NULL,
  closed_at      INTEGER,                        -- NULL while open
  outcome        TEXT,                           -- 'closed' when a matching report closed it
  detail_json    TEXT,                           -- identifiers only
  PRIMARY KEY (repository_id, type, ref, raised_at)
);
CREATE INDEX policy_conditions_open ON policy_conditions(repository_id, type, ref, closed_at);

-- R-BTN-180: the latest protection report per repository — only the protection checker's
-- heartbeat writes here (the grant's role names it); a report older than 24 hours stops
-- feeding `no-runner-lands` (judged where the guarantee is computed, never here).
CREATE TABLE protection_reports (
  repository_id  TEXT NOT NULL PRIMARY KEY REFERENCES repositories(id),
  matched        INTEGER NOT NULL,
  reading_hash   TEXT NOT NULL,
  by             TEXT NOT NULL,                  -- the checker's credential
  at             INTEGER NOT NULL
);

-- R-BTN-189: the policy hash each trusted runner pinned per repository, as its heartbeat
-- reports it. A pin that differs from the current version holds `baton.policy-unpinned` open
-- and stops the runner acting on the repository (the protection checker excepted).
CREATE TABLE policy_pins (
  worker_id      INTEGER NOT NULL REFERENCES workers(id),
  repository_id  TEXT NOT NULL REFERENCES repositories(id),
  hash           TEXT NOT NULL,
  at             INTEGER NOT NULL,
  PRIMARY KEY (worker_id, repository_id)
);

-- R-BTN-185: the tenant's human-only keys. A tenant's first is a line of the host's
-- BATON_HUMAN_KEYS configuration, never a row; each later one is registered with a signature
-- by an existing one (POST /v1/human-keys). A key here owns nothing until a repository's
-- `approvers.members` action adds it as an owner.
CREATE TABLE human_keys (
  fingerprint    TEXT PRIMARY KEY,
  public_key     TEXT NOT NULL,
  added_by       TEXT NOT NULL,
  added_at       INTEGER NOT NULL,
  revoked_at     INTEGER
);

-- §13 (under §12.8): owner keys gain the human-only mark and the FIDO attestation a hardware
-- `human_key` reads (B-136 builds the attestation check itself).
ALTER TABLE repository_owners ADD COLUMN human_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repository_owners ADD COLUMN fido_attestation TEXT;

-- §13 (under §12.8): the trust attributes of a grant — set only by an `approvers.trust`
-- approver (B-147 builds the routes and the enforcement), cleared to untrusted, roles dropped,
-- domains and families null, when `approvers.trust` becomes human-only (R-BTN-188).
ALTER TABLE worker_grants ADD COLUMN trust_level TEXT;
ALTER TABLE worker_grants ADD COLUMN trust_domain TEXT;
ALTER TABLE worker_grants ADD COLUMN model_family TEXT;
ALTER TABLE worker_grants ADD COLUMN role TEXT;
ALTER TABLE worker_grants ADD COLUMN trust_set_by TEXT;

-- Item 10 of B-145: a courier carries a trust level and a trust domain, set by the
-- `approvers.trust` approver at registration, cleared with the grants'.
ALTER TABLE couriers ADD COLUMN trust_level TEXT;
ALTER TABLE couriers ADD COLUMN trust_domain TEXT;
ALTER TABLE couriers ADD COLUMN trust_set_by TEXT;

-- R-BTN-181's reading half (B-145 item 9): a reading records its writer class, and may be
-- signed — the columns land here so the reading routes can carry them; which readings count
-- for a repository is the policy's `readings` knob, read once B-146 builds requirements.
ALTER TABLE instance_readings ADD COLUMN writer TEXT;
ALTER TABLE instance_readings ADD COLUMN nonce TEXT;
ALTER TABLE instance_readings ADD COLUMN signature TEXT;
