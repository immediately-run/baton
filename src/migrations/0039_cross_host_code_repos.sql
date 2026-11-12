-- 0039_cross_host_code_repos.sql — B-182: a code repository names its own forge and host
-- (R-BTN-140), and a pusher is qualified by host (R-BTN-139). Append-only, as every migration
-- is: the code_repos table is born with the columns the amended rule stores — path, forge,
-- host, the forge's ids and web_base — and the pushers and courses.facts columns default to
-- "none" and "no facts", so an entry or pusher written without a host stays the home's and a
-- course that declared no facts reads as before. Nothing existing changes meaning.
CREATE TABLE code_repos (                          -- the owners' code repositories (R-BTN-140)
  repository_id TEXT NOT NULL,                     -- the home the list belongs to
  path TEXT NOT NULL,                              -- owner/name, unique case-insensitively across
                                                   -- the home's path and every entry (R-BTN-92)
  forge TEXT NOT NULL CHECK (forge IN ('github','gitlab','gitea')),
  host TEXT NOT NULL,                              -- lowercased DNS name with optional port
  repo_id TEXT NOT NULL,                           -- the forge's ids (R-BTN-138's kind), which
  owner_id TEXT NOT NULL,                          -- decide at every read
  web_base TEXT NOT NULL,                          -- https://<host>/<path>, its links' base
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, path)
);
-- R-BTN-139: the owners' pushers, host-qualified — `[{host, id}]`, null for none. Stored
-- normalized (a host-less entry is written with the home's host), so a reader never has to
-- default one itself.
ALTER TABLE repositories ADD COLUMN pushers TEXT;
-- R-BTN-134/B-182: what a course's entry declares it reads — `["prs"]`, `["branches"]` — so
-- R-BTN-190 can follow the PRs without a policy knob. A course that posted none reads as none.
ALTER TABLE courses ADD COLUMN facts TEXT NOT NULL DEFAULT '[]';
