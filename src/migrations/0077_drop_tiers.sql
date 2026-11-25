-- B-322: replace the tier-dependent projection view/triggers in place, preserving rows
-- and the ready-order index. Owner capability grants and other scheduling inputs stay.
DROP TRIGGER ready_tickets_insert;
DROP TRIGGER ready_tickets_delete;
DROP TRIGGER ready_tickets_update;
DROP TRIGGER ready_ticket_stations_insert;
DROP TRIGGER ready_ticket_stations_delete;
DROP TRIGGER ready_ticket_stations_update;
DROP TRIGGER ready_ticket_next_legs_insert;
DROP TRIGGER ready_ticket_next_legs_delete;
DROP TRIGGER ready_ticket_next_legs_update;
DROP TRIGGER ready_ticket_overrides_insert;
DROP TRIGGER ready_ticket_overrides_delete;
DROP TRIGGER ready_ticket_overrides_update;
DROP TRIGGER ready_claims_insert;
DROP TRIGGER ready_claims_delete;
DROP TRIGGER ready_claims_update;
DROP TRIGGER ready_ticket_blocks_insert;
DROP TRIGGER ready_ticket_blocks_delete;
DROP TRIGGER ready_ticket_blocks_update;
DROP VIEW ready_ticket_source;

-- The old digest covered the posted parent, which cannot be recovered from the resolved
-- parent column. Keep the dropped hash inputs with that digest only until the next sync.
UPDATE tickets SET row_hash = 'v1:' || json_array(row_hash, tier, tier_position);

-- Both the activity and quiet read validators must change with the response shape.
UPDATE state_version SET v = v + 1, board_v = board_v + 1, scheduling_v = scheduling_v + 1 WHERE id = 1;

ALTER TABLE ready_tickets DROP COLUMN tier_position;
ALTER TABLE tickets DROP COLUMN tier_position;
ALTER TABLE tickets DROP COLUMN tier;
ALTER TABLE runner_grants DROP COLUMN max_tier;
ALTER TABLE runners DROP COLUMN tier_ceiling;
ALTER TABLE runners DROP COLUMN tier_ceilings;
ALTER TABLE repositories DROP COLUMN tiers;

CREATE VIEW ready_ticket_source AS
SELECT t.id AS ticket_id, t.repository_id, t.course_id, s.next_leg AS leg,
  MAX(t.expedite, COALESCE(o.expedite, 0)) AS expedite,
  s.to_end, t.rank, n.ready_since, o.retry_after,
  COALESCE((SELECT MAX(c.end_observation) FROM claims c WHERE c.ticket_id = t.id), -1) AS last_end_observation
FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
JOIN ticket_next_legs n ON n.ticket_id = t.id AND n.leg = s.next_leg AND n.state = 'ready'
LEFT JOIN ticket_overrides o ON o.ticket_id = t.id
WHERE COALESCE(o.hold, 0) = 0
AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.ticket_id = t.id AND
 (c.status = 'active' OR (c.status = 'completed' AND c.confirmed_at IS NULL) OR (c.status = 'reaped' AND c.fence_pending = 1)))
AND NOT EXISTS (SELECT 1 FROM ticket_blocks b WHERE b.ticket_id = t.id AND
 (b.kind = 'ticket' OR (b.kind = 'decision' AND b.leg IN ('', s.next_leg))));

CREATE TRIGGER ready_tickets_insert AFTER INSERT ON tickets BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_tickets_delete AFTER DELETE ON tickets BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_tickets_update AFTER UPDATE OF id, repository_id, course_id, expedite, rank ON tickets
WHEN OLD.id IS NOT NEW.id OR OLD.repository_id IS NOT NEW.repository_id OR OLD.course_id IS NOT NEW.course_id OR OLD.expedite IS NOT NEW.expedite OR OLD.rank IS NOT NEW.rank BEGIN
  DELETE FROM ready_tickets WHERE OLD.id IS NOT NEW.id AND ticket_id = OLD.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.id IS NOT NEW.id AND ticket_id = OLD.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.id IS NOT NEW.id AND ticket_id = OLD.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_stations_insert AFTER INSERT ON ticket_stations BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_stations_delete AFTER DELETE ON ticket_stations BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_stations_update AFTER UPDATE OF ticket_id, next_leg, to_end ON ticket_stations
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.next_leg IS NOT NEW.next_leg OR OLD.to_end IS NOT NEW.to_end BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_next_legs_insert AFTER INSERT ON ticket_next_legs BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_next_legs_delete AFTER DELETE ON ticket_next_legs BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_next_legs_update AFTER UPDATE OF ticket_id, leg, state, ready_since ON ticket_next_legs
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.leg IS NOT NEW.leg OR OLD.state IS NOT NEW.state OR OLD.ready_since IS NOT NEW.ready_since BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_overrides_insert AFTER INSERT ON ticket_overrides BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_overrides_delete AFTER DELETE ON ticket_overrides BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_overrides_update AFTER UPDATE OF ticket_id, hold, expedite, retry_after ON ticket_overrides
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.hold IS NOT NEW.hold OR OLD.expedite IS NOT NEW.expedite OR OLD.retry_after IS NOT NEW.retry_after BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_claims_insert AFTER INSERT ON claims BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_claims_delete AFTER DELETE ON claims BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_claims_update AFTER UPDATE OF ticket_id, status, confirmed_at, fence_pending, end_observation ON claims
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.status IS NOT NEW.status OR OLD.confirmed_at IS NOT NEW.confirmed_at OR OLD.fence_pending IS NOT NEW.fence_pending OR OLD.end_observation IS NOT NEW.end_observation BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;

CREATE TRIGGER ready_ticket_blocks_insert AFTER INSERT ON ticket_blocks BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_blocks_delete AFTER DELETE ON ticket_blocks BEGIN
  DELETE FROM ready_tickets WHERE ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
CREATE TRIGGER ready_ticket_blocks_update AFTER UPDATE OF ticket_id, kind, leg ON ticket_blocks
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.kind IS NOT NEW.kind OR OLD.leg IS NOT NEW.leg BEGIN
  DELETE FROM ready_tickets WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE OLD.ticket_id IS NOT NEW.ticket_id AND ticket_id = OLD.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
  DELETE FROM ready_tickets WHERE ticket_id = NEW.ticket_id
    AND NOT EXISTS (SELECT 1 FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id);
  INSERT INTO ready_tickets SELECT * FROM ready_ticket_source WHERE ticket_id = NEW.ticket_id
    ON CONFLICT(ticket_id) DO UPDATE SET repository_id = excluded.repository_id, course_id = excluded.course_id, leg = excluded.leg, expedite = excluded.expedite, to_end = excluded.to_end, rank = excluded.rank, ready_since = excluded.ready_since, retry_after = excluded.retry_after, last_end_observation = excluded.last_end_observation
    WHERE ready_tickets.repository_id IS NOT excluded.repository_id OR ready_tickets.course_id IS NOT excluded.course_id OR ready_tickets.leg IS NOT excluded.leg OR ready_tickets.expedite IS NOT excluded.expedite OR ready_tickets.to_end IS NOT excluded.to_end OR ready_tickets.rank IS NOT excluded.rank OR ready_tickets.ready_since IS NOT excluded.ready_since OR ready_tickets.retry_after IS NOT excluded.retry_after OR ready_tickets.last_end_observation IS NOT excluded.last_end_observation;
END;
