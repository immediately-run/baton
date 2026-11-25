-- 0061_runners.sql — B-68 (BATON_SPEC §8.1 R-BTN-3/R-BTN-14, §13.3): the
-- implementation follows the specification's runner vocabulary. Old migrations keep the
-- historical names they originally created; this migration renames the live schema in place.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE workers RENAME TO runners;
ALTER TABLE worker_capabilities RENAME TO runner_capabilities;
ALTER TABLE worker_courses RENAME TO runner_courses;
ALTER TABLE worker_grants RENAME TO runner_grants;
ALTER TABLE worker_tags RENAME TO runner_tags;
ALTER TABLE worker_couriers RENAME TO runner_couriers;

ALTER TABLE activities RENAME COLUMN worker_id TO runner_id;
ALTER TABLE adoptions RENAME COLUMN worker_id TO runner_id;
ALTER TABLE claims RENAME COLUMN worker_id TO runner_id;
ALTER TABLE messages RENAME COLUMN from_worker_id TO from_runner_id;
ALTER TABLE messages RENAME COLUMN to_worker_id TO to_runner_id;
ALTER TABLE pending_transcripts RENAME COLUMN worker_id TO runner_id;
ALTER TABLE policy_pins RENAME COLUMN worker_id TO runner_id;
ALTER TABLE ticket_history RENAME COLUMN worker_id TO runner_id;
ALTER TABLE transcripts RENAME COLUMN worker_id TO runner_id;
ALTER TABLE runner_capabilities RENAME COLUMN worker_id TO runner_id;
ALTER TABLE runner_couriers RENAME COLUMN worker_id TO runner_id;
ALTER TABLE runner_courses RENAME COLUMN worker_id TO runner_id;
ALTER TABLE runner_tags RENAME COLUMN worker_id TO runner_id;
ALTER TABLE courses RENAME COLUMN min_worker_version TO min_runner_version;
ALTER TABLE fleet_capabilities RENAME COLUMN workers TO runners;
ALTER TABLE repositories RENAME COLUMN worker_pushers TO runner_pushers;

ALTER TABLE runners ADD COLUMN legacy_names_at INTEGER;

DROP INDEX claims_active_by_worker;
CREATE INDEX claims_active_by_runner ON claims(runner_id) WHERE status = 'active';
DROP INDEX worker_couriers_by_repository;
CREATE INDEX runner_couriers_by_repository ON runner_couriers(repository_id, asks, seen_at);
DROP INDEX workers_by_secret;
CREATE INDEX runners_by_secret ON runners(credential_id, secret_hash);
DROP INDEX workers_last_seen;
CREATE INDEX runners_last_seen ON runners(last_seen_at);
DROP INDEX workers_live;
CREATE INDEX runners_live ON runners(last_seen_at + lease_timeout_ms) WHERE reaped_at IS NULL;

-- SQLite cannot alter a CHECK constraint. Rebuild this one parent while foreign-key checks are
-- deferred. Its rows are set aside, the table is dropped and created again under its own name,
-- and the rows go back in: the DROP counts every row that names a credential (a runner, a grant,
-- a notice) as a deferred violation, and only an INSERT of the parent row it names takes that
-- count back off — a RENAME of a scratch table into place never does, so the commit would fail
-- and, on a Durable Object, reset the object with this migration unapplied (2026-11-19). All
-- columns and rows are preserved, with only the credential kind translated.
CREATE TABLE credentials_0061 AS SELECT * FROM credentials;
DROP TABLE credentials;
CREATE TABLE credentials (
  id                   TEXT PRIMARY KEY,
  hostname             TEXT NOT NULL,
  allowed_capabilities TEXT NOT NULL,
  revoked_at           INTEGER,
  kind                 TEXT NOT NULL DEFAULT 'token'
                         CHECK (kind IN ('token','runner','probe','courier','legacy')),
  public_key           TEXT,
  created_by           TEXT,
  label                TEXT,
  allowed_instances    TEXT NOT NULL DEFAULT '[]',
  revoked_by           TEXT
);
INSERT INTO credentials (id, hostname, allowed_capabilities, revoked_at, kind, public_key, created_by, label, allowed_instances, revoked_by)
  SELECT id, hostname, allowed_capabilities, revoked_at,
         CASE kind WHEN 'worker' THEN 'runner' ELSE kind END,
         public_key, created_by, label, allowed_instances, revoked_by
  FROM credentials_0061;
DROP TABLE credentials_0061;
CREATE UNIQUE INDEX credentials_public_key ON credentials(public_key) WHERE public_key IS NOT NULL;
CREATE UNIQUE INDEX credentials_runner_name ON credentials(hostname) WHERE kind = 'runner' AND revoked_at IS NULL;

-- These strings are identifiers in the record, not prose. Keep historical rows queryable under
-- the same vocabulary as newly written rows.
UPDATE events SET actor = 'runner:' || substr(actor, 8) WHERE actor LIKE 'worker:%';
UPDATE instance_readings SET source = 'runner:' || substr(source, 8) WHERE source LIKE 'worker:%';
UPDATE instance_readings SET posted_by = 'runner:' || substr(posted_by, 8) WHERE posted_by LIKE 'worker:%';
