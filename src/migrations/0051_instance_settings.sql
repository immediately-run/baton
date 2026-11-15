-- 0051_instance_settings.sql — B-4 (BATON_SPEC §13.1, R-BTN-113, R-BTN-57): the administrators'
-- instance settings, one row, behind PUT /v1/admin/settings — `link_hosts` (R-BTN-112's hosts,
-- whose links a view may draw; default empty) and `session_hosts` (R-BTN-113's allowlist, whose
-- session links the instance keeps) as JSON lists, and `check_app_id` (§12.7, R-BTN-115: the
-- check App's id). A NULL `session_hosts` is no administrator's setting: the deploy's
-- BATON_SESSION_HOSTS (B-234's interim home of the rule) stands, whose default is claude.ai alone
-- — so an upgraded instance keeps the allowlist it ran with until an administrator sets the
-- row's.
CREATE TABLE instance_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  link_hosts    TEXT NOT NULL DEFAULT '[]',   -- JSON: hosts whose links a view may draw
  session_hosts TEXT,                         -- JSON: hosts whose session links are kept; NULL — the deploy's
  check_app_id  TEXT                          -- §12.7, R-BTN-115: the check App's id
);
INSERT INTO instance_settings (id, link_hosts) VALUES (1, '[]');
