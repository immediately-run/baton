-- B-278: preserve the old tie order (S-BTN-31) once, before switching reads to
-- named columns. New inserts choose MAX(insertion_order) + 1 in the statement
-- itself; Baton has one writer, and upserts leave the original order alone.
ALTER TABLE activities ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE activities SET insertion_order = rowid;
CREATE INDEX activities_insertion_order ON activities(insertion_order);
DROP INDEX activities_by_claim;
CREATE INDEX activities_by_claim ON activities(claim_id, started_at, insertion_order);

ALTER TABLE repositories ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE repositories SET insertion_order = rowid;
CREATE INDEX repositories_insertion_order ON repositories(insertion_order);

ALTER TABLE instance_readings ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
-- The backfills change storage order keys only, not the rows the views see.
DROP TRIGGER runner_view_instance_readings_update;
UPDATE instance_readings SET insertion_order = rowid;
CREATE TRIGGER runner_view_instance_readings_update AFTER UPDATE ON instance_readings BEGIN
  UPDATE baton_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'instances_version';
END;
CREATE INDEX instance_readings_insertion_order ON instance_readings(insertion_order);

ALTER TABLE runner_reports ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER runner_view_runner_reports_update;
UPDATE runner_reports SET insertion_order = rowid;
CREATE TRIGGER runner_view_runner_reports_update AFTER UPDATE ON runner_reports BEGIN
  UPDATE board_head SET fleet_version = fleet_version + 1 WHERE repository_id = NEW.repository_id;
END;
CREATE UNIQUE INDEX runner_reports_insertion_order ON runner_reports(insertion_order);
