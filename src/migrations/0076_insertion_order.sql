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
UPDATE instance_readings SET insertion_order = rowid;
CREATE INDEX instance_readings_insertion_order ON instance_readings(insertion_order);

ALTER TABLE runner_reports ADD COLUMN insertion_order INTEGER NOT NULL DEFAULT 0;
UPDATE runner_reports SET insertion_order = rowid;
CREATE UNIQUE INDEX runner_reports_insertion_order ON runner_reports(insertion_order);
