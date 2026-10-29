-- 0025_ontology.sql — the capability ontology (BATON_SPEC §5.9, R-BTN-174/R-BTN-175, B-104):
-- the program in force per repository, the derived sets it computes per worker, their input
-- digests, and the refusals a Needs-you listing shows until a unit is accepted.

-- The ontology in force (R-BTN-174): the merged program a board post carried, its digest (the
-- SHA-256 of the program's RFC 8785 canonical JSON), the built-in it names, the fixed
-- predicates' maximal result (at most 5,000 atoms) later evaluations read as facts, and the
-- snapshot that posted it.
CREATE TABLE ontologies (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  digest TEXT NOT NULL,
  builtin TEXT,
  fixed_json TEXT NOT NULL,
  program_json TEXT NOT NULL,
  snapshot_sha TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);

-- A worker's derived capabilities for a repository (R-BTN-174): at most 256, stored with the
-- input digest they were computed under — current exactly when it matches the worker's H and
-- the program in force now. A write evaluates them; nothing here is ever read stale by rule 4.
CREATE TABLE worker_derived (
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  capability TEXT NOT NULL,
  evaluated_at INTEGER NOT NULL,
  PRIMARY KEY (worker_id, repository_id, capability)
) WITHOUT ROWID;

-- The one inputs row per (worker, repository): the digest the stored sets were computed
-- under, and `limited` when an evaluation crossed its bound and stored the empty set — not
-- retried until the digest changes.
CREATE TABLE worker_derived_inputs (
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  input_digest TEXT NOT NULL,
  limited INTEGER NOT NULL DEFAULT 0,
  evaluated_at INTEGER NOT NULL,
  PRIMARY KEY (worker_id, repository_id)
) WITHOUT ROWID;

-- A refused unit (R-BTN-174's acceptance): the program in force stays, and the refusal is
-- listed under Needs you until a unit is accepted. `detail` names the entry, course and rule
-- (or the merge's error).
CREATE TABLE ontology_refusals (
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  reason TEXT NOT NULL,
  detail TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, reason)
) WITHOUT ROWID;

-- A course entry's route-choice attachments (R-BTN-177): the unit's course-entry side. The
-- column holds what was accepted; a refused unit keeps its previous value.
ALTER TABLE courses ADD COLUMN route_choices_json TEXT NOT NULL DEFAULT '{}';
