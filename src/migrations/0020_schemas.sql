-- 0020_schemas.sql — the course schemas each sync posts (BATON_SPEC §2m.2 R-BTN-108; B-3).
-- Keyed by (repository, id): an id names its course and version (`<course>:<name>@<n>`), so two
-- repositories' courses of one name never collide. A schema version is immutable: a post whose
-- digest differs from the stored one is refused with its course file, so a row is written once.
-- `std:` schemas are Baton's own library and never stored here.
CREATE TABLE course_schemas (
  repository_id TEXT NOT NULL,
  id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  snapshot_sha TEXT NOT NULL,
  PRIMARY KEY (repository_id, id)
)
