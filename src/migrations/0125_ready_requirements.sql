-- B-239 / S-BTN-243: make rejecting an unfit ticket a single index walk, without
-- fetching the ticket or seeking its requirements for each row of the ready queue.
ALTER TABLE ready_tickets ADD COLUMN required_caps TEXT NOT NULL DEFAULT '[]';
CREATE VIEW ready_ticket_requirements AS
SELECT ticket_id, json_group_array(name ORDER BY name) AS required_caps FROM ticket_requires GROUP BY ticket_id;
UPDATE ready_tickets SET required_caps = COALESCE((SELECT r.required_caps FROM ready_ticket_requirements r
  WHERE r.ticket_id = ready_tickets.ticket_id), '[]');

-- Existing projection triggers insert from this view. Updates to just the clause
-- are maintained separately; the source rows can change after the ticket upsert.
DROP VIEW ready_ticket_source;
CREATE VIEW ready_ticket_source AS
SELECT t.id AS ticket_id, t.repository_id, t.course_id, s.next_leg AS leg,
  MAX(t.expedite, COALESCE(o.expedite, 0)) AS expedite,
  s.to_end, t.rank, n.ready_since, t.tier_position, o.retry_after,
  COALESCE((SELECT MAX(c.end_observation) FROM claims c WHERE c.ticket_id = t.id), -1) AS last_end_observation,
  COALESCE((SELECT r.required_caps FROM ready_ticket_requirements r WHERE r.ticket_id = t.id), '[]') AS required_caps
FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
JOIN ticket_next_legs n ON n.ticket_id = t.id AND n.leg = s.next_leg AND n.state = 'ready'
LEFT JOIN ticket_overrides o ON o.ticket_id = t.id
WHERE COALESCE(o.hold, 0) = 0
AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.ticket_id = t.id AND
 (c.status = 'active' OR (c.status = 'completed' AND c.confirmed_at IS NULL) OR (c.status = 'reaped' AND c.fence_pending = 1)))
AND NOT EXISTS (SELECT 1 FROM ticket_blocks b WHERE b.ticket_id = t.id AND
 (b.kind = 'ticket' OR (b.kind = 'decision' AND b.leg IN ('', s.next_leg))));

CREATE TRIGGER ready_requirements_insert AFTER INSERT ON ticket_requires BEGIN
  UPDATE ready_tickets SET required_caps = (SELECT r.required_caps FROM ready_ticket_requirements r WHERE r.ticket_id = NEW.ticket_id)
  WHERE ticket_id = NEW.ticket_id;
END;
CREATE TRIGGER ready_requirements_delete AFTER DELETE ON ticket_requires BEGIN
  UPDATE ready_tickets SET required_caps = COALESCE((SELECT r.required_caps FROM ready_ticket_requirements r WHERE r.ticket_id = OLD.ticket_id), '[]')
  WHERE ticket_id = OLD.ticket_id;
END;
CREATE TRIGGER ready_requirements_update AFTER UPDATE OF ticket_id, name ON ticket_requires
WHEN OLD.ticket_id IS NOT NEW.ticket_id OR OLD.name IS NOT NEW.name BEGIN
  UPDATE ready_tickets SET required_caps = COALESCE((SELECT r.required_caps FROM ready_ticket_requirements r WHERE r.ticket_id = ready_tickets.ticket_id), '[]')
  WHERE ticket_id IN (OLD.ticket_id, NEW.ticket_id);
END;

DROP INDEX ready_tickets_order;
CREATE INDEX ready_tickets_order ON ready_tickets(repository_id, course_id,
  (-expedite), to_end, (rank IS NULL), COALESCE(rank, 0), COALESCE(ready_since, -1), ticket_id,
  required_caps, tier_position, last_end_observation, retry_after, leg, expedite, rank, ready_since);
