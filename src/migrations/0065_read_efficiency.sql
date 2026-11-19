-- B-287 / S-BTN-243: indexed matching inputs and one rebuildable candidate projection.
-- Source documents remain authoritative. Triggers maintain only rows affected by a source
-- mutation, including imports and renumberings; rollback is SQLite's own. No clock-derived
-- boolean is stored: retry_after and last_end_observation are checked at read time.
ALTER TABLE state_version ADD COLUMN scheduling_v INTEGER NOT NULL DEFAULT 1;
ALTER TABLE state_version ADD COLUMN board_v INTEGER NOT NULL DEFAULT 1;
ALTER TABLE state_version ADD COLUMN activity_v INTEGER NOT NULL DEFAULT 1;

CREATE TABLE course_legs (
  repository_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  person INTEGER NOT NULL,
  PRIMARY KEY (repository_id, course_id, leg),
  FOREIGN KEY (repository_id, course_id) REFERENCES courses(repository_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE course_leg_capabilities (
  repository_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  capability TEXT NOT NULL,
  PRIMARY KEY (repository_id, course_id, leg, capability),
  FOREIGN KEY (repository_id, course_id, leg) REFERENCES course_legs(repository_id, course_id, leg) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE grant_capabilities (
  credential_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  capability_pattern TEXT NOT NULL,
  PRIMARY KEY (credential_id, repository_id, capability_pattern),
  FOREIGN KEY (credential_id, repository_id) REFERENCES runner_grants(credential_id, repository_id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE ticket_repositories (
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  repository_key TEXT NOT NULL,
  PRIMARY KEY (ticket_id, repository_key)
) WITHOUT ROWID;
CREATE INDEX ticket_repositories_reverse ON ticket_repositories(repository_key, ticket_id);

-- Migration 0022 left old capability views empty until a later registry post. Include the
-- file's leg names too; missing derived requirements remain a coarse filter, rechecked by gates.
INSERT INTO course_legs SELECT k.repository_id, k.id, l.key,
 EXISTS (SELECT 1 FROM json_each(COALESCE(k.person_legs_json, '[]')) p WHERE p.value = l.key)
 FROM courses k, json_each(json_patch(COALESCE(json_extract(k.course_json, '$.legs'), '{}'), k.leg_capabilities_json)) l;
INSERT INTO course_leg_capabilities SELECT k.repository_id, k.id, l.key, c.value
 FROM courses k, json_each(k.leg_capabilities_json) l, json_each(l.value) c;
CREATE TRIGGER matching_courses_insert AFTER INSERT ON courses BEGIN
  DELETE FROM course_legs WHERE repository_id = NEW.repository_id AND course_id = NEW.id;
  INSERT INTO course_legs SELECT NEW.repository_id, NEW.id, l.key,
    EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.person_legs_json, '[]')) p WHERE p.value = l.key)
    FROM json_each(json_patch(COALESCE(json_extract(NEW.course_json, '$.legs'), '{}'), NEW.leg_capabilities_json)) l;
  INSERT INTO course_leg_capabilities SELECT NEW.repository_id, NEW.id, l.key, c.value
    FROM json_each(NEW.leg_capabilities_json) l, json_each(l.value) c;
END;
CREATE TRIGGER matching_courses_update AFTER UPDATE OF course_json, leg_capabilities_json, person_legs_json ON courses
WHEN OLD.course_json IS NOT NEW.course_json OR OLD.leg_capabilities_json IS NOT NEW.leg_capabilities_json OR OLD.person_legs_json IS NOT NEW.person_legs_json BEGIN
  DELETE FROM course_legs WHERE repository_id = NEW.repository_id AND course_id = NEW.id;
  INSERT INTO course_legs SELECT NEW.repository_id, NEW.id, l.key,
    EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.person_legs_json, '[]')) p WHERE p.value = l.key)
    FROM json_each(json_patch(COALESCE(json_extract(NEW.course_json, '$.legs'), '{}'), NEW.leg_capabilities_json)) l;
  INSERT INTO course_leg_capabilities SELECT NEW.repository_id, NEW.id, l.key, c.value
    FROM json_each(NEW.leg_capabilities_json) l, json_each(l.value) c;
END;

INSERT INTO grant_capabilities SELECT g.credential_id, g.repository_id, j.value FROM runner_grants g, json_each(g.capabilities) j;
CREATE TRIGGER matching_runner_grants_insert AFTER INSERT ON runner_grants BEGIN
  DELETE FROM grant_capabilities WHERE credential_id = NEW.credential_id AND repository_id = NEW.repository_id;
  INSERT INTO grant_capabilities SELECT NEW.credential_id, NEW.repository_id, value FROM json_each(NEW.capabilities);
END;
CREATE TRIGGER matching_runner_grants_update AFTER UPDATE OF capabilities ON runner_grants
WHEN OLD.capabilities IS NOT NEW.capabilities BEGIN
  DELETE FROM grant_capabilities WHERE credential_id = NEW.credential_id AND repository_id = NEW.repository_id;
  INSERT INTO grant_capabilities SELECT NEW.credential_id, NEW.repository_id, value FROM json_each(NEW.capabilities);
END;

INSERT OR IGNORE INTO ticket_repositories SELECT t.id, lower(j.value) FROM tickets t, json_each(t.repos) j;
CREATE TRIGGER matching_tickets_insert AFTER INSERT ON tickets BEGIN
  DELETE FROM ticket_repositories WHERE ticket_id = NEW.id;
  INSERT OR IGNORE INTO ticket_repositories SELECT NEW.id, lower(value) FROM json_each(NEW.repos);
END;
CREATE TRIGGER matching_tickets_update AFTER UPDATE OF repos ON tickets
WHEN OLD.repos IS NOT NEW.repos BEGIN
  DELETE FROM ticket_repositories WHERE ticket_id = NEW.id;
  INSERT OR IGNORE INTO ticket_repositories SELECT NEW.id, lower(value) FROM json_each(NEW.repos);
END;

CREATE TABLE ready_tickets (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  expedite INTEGER NOT NULL,
  to_end INTEGER NOT NULL,
  rank REAL,
  ready_since INTEGER,
  tier_position INTEGER,
  retry_after INTEGER,
  last_end_observation INTEGER NOT NULL
);
CREATE INDEX ready_tickets_order ON ready_tickets(repository_id, course_id,
  (-expedite), to_end, (rank IS NULL), COALESCE(rank, 0), COALESCE(ready_since, -1), ticket_id);
-- One definition of projection membership. Grants, bars, person legs and ceilings remain
-- runner-side predicates; observation and backoff comparisons remain clock/current-head reads.
CREATE VIEW ready_ticket_source AS
SELECT t.id AS ticket_id, t.repository_id, t.course_id, s.next_leg AS leg,
  MAX(t.expedite, COALESCE(o.expedite, 0)) AS expedite,
  s.to_end, t.rank, n.ready_since, t.tier_position, o.retry_after,
  COALESCE((SELECT MAX(c.end_observation) FROM claims c WHERE c.ticket_id = t.id), -1) AS last_end_observation
FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
JOIN ticket_next_legs n ON n.ticket_id = t.id AND n.leg = s.next_leg AND n.state = 'ready'
LEFT JOIN ticket_overrides o ON o.ticket_id = t.id
WHERE COALESCE(o.hold, 0) = 0
AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.ticket_id = t.id AND
 (c.status = 'active' OR (c.status = 'completed' AND c.confirmed_at IS NULL) OR (c.status = 'reaped' AND c.fence_pending = 1)))
AND NOT EXISTS (SELECT 1 FROM ticket_blocks b WHERE b.ticket_id = t.id AND
 (b.kind = 'ticket' OR (b.kind = 'decision' AND b.leg IN ('', s.next_leg))));
INSERT INTO ready_tickets SELECT * FROM ready_ticket_source;

CREATE TRIGGER ready_tickets_insert AFTER INSERT ON tickets BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_tickets_delete AFTER DELETE ON tickets BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_tickets_update AFTER UPDATE OF id, repository_id, course_id, expedite, rank, tier_position ON tickets
WHEN OLD.id IS NOT NEW.id OR OLD.repository_id IS NOT NEW.repository_id OR OLD.course_id IS NOT NEW.course_id OR OLD.expedite IS NOT NEW.expedite OR OLD.rank IS NOT NEW.rank OR OLD.tier_position IS NOT NEW.tier_position BEGIN
  DELETE FROM ready_tickets WHERE OLD.id IS NOT NEW.id AND ticket_id = OLD.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.id IS NOT NEW.id AND ticket_id = OLD.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.id IS NOT NEW.id AND ticket_id = OLD.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_stations_insert AFTER INSERT ON ticket_stations BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_stations_delete AFTER DELETE ON ticket_stations BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_stations_update AFTER UPDATE OF ticket_id, next_leg, to_end ON ticket_stations
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.next_leg IS NOT NEW.next_leg OR OLD.to_end IS NOT NEW.to_end BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_next_legs_insert AFTER INSERT ON ticket_next_legs BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_next_legs_delete AFTER DELETE ON ticket_next_legs BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_next_legs_update AFTER UPDATE OF ticket_id, leg, state, ready_since ON ticket_next_legs
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.leg IS NOT NEW.leg OR OLD.state IS NOT NEW.state OR OLD.ready_since IS NOT NEW.ready_since BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_overrides_insert AFTER INSERT ON ticket_overrides BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_overrides_delete AFTER DELETE ON ticket_overrides BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_overrides_update AFTER UPDATE OF ticket_id, hold, expedite, retry_after ON ticket_overrides
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.hold IS NOT NEW.hold OR OLD.expedite IS NOT NEW.expedite OR OLD.retry_after IS NOT NEW.retry_after BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_claims_insert AFTER INSERT ON claims BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_claims_delete AFTER DELETE ON claims BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_claims_update AFTER UPDATE OF ticket_id, status, confirmed_at, fence_pending, end_observation ON claims
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.status IS NOT NEW.status OR OLD.confirmed_at IS NOT NEW.confirmed_at OR OLD.fence_pending IS NOT NEW.fence_pending OR OLD.end_observation IS NOT NEW.end_observation BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_blocks_insert AFTER INSERT ON ticket_blocks BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_blocks_delete AFTER DELETE ON ticket_blocks BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_blocks_update AFTER UPDATE OF ticket_id, kind, leg ON ticket_blocks
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.kind IS NOT NEW.kind OR OLD.leg IS NOT NEW.leg BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, tier_position = excluded.tier_position, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.tier_position IS NOT excluded.tier_position OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

-- Ordered latest-row and entity timeline lookups; a page never reads every report.
CREATE INDEX transcripts_latest ON transcripts(runner_id, COALESCE(last_pushed_at, first_seen_at) DESC, repo, path, claim_id);
CREATE INDEX pending_transcripts_latest ON pending_transcripts(runner_id, COALESCE(last_pushed_at, first_seen_at) DESC, repo, path);
CREATE INDEX events_ticket_timeline ON events(ticket_id, seq);
CREATE INDEX events_claim_timeline ON events(claim_id, seq);
CREATE INDEX claims_end_observation ON claims(end_observation) WHERE end_observation IS NOT NULL;
CREATE TABLE sync_fingerprints (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  digest TEXT NOT NULL,
  scheduling_v INTEGER NOT NULL
);

CREATE INDEX tickets_list ON tickets(repository_id, id);
CREATE INDEX runner_courses_repository ON runner_courses(repository_id, runner_id);

-- The general ticket-page index must not displace the sparse blocked-page access path.
DROP INDEX tickets_blocked;
CREATE INDEX tickets_blocked ON tickets(repository_id, id) WHERE blocked_since IS NOT NULL;
