-- Keep independent selector answers even when they share a display ref.
ALTER TABLE ticket_dependents RENAME TO prior_ticket_dependents;
CREATE TABLE ticket_dependents (
  ticket_id TEXT NOT NULL,
  leg TEXT NOT NULL,
  ref TEXT NOT NULL,
  on_ticket TEXT NOT NULL,
  predicate TEXT NOT NULL,
  target_course TEXT,
  skip_withdrawn INTEGER NOT NULL,
  allow_empty INTEGER NOT NULL,
  why TEXT,
  station TEXT,
  cycle INTEGER NOT NULL DEFAULT 0,
  selector TEXT NOT NULL,
  PRIMARY KEY (ticket_id, leg, ref, selector)
);
INSERT INTO ticket_dependents SELECT *, '' FROM prior_ticket_dependents;
DROP TABLE prior_ticket_dependents;
CREATE INDEX ticket_dependents_by_target ON ticket_dependents(on_ticket, ticket_id);

-- A block on a later leg does not remove the queued leg from recommendations.
DROP VIEW ready_ticket_source;
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
 b.kind IN ('ticket', 'decision') AND b.leg IN ('', s.next_leg));
DELETE FROM ready_tickets;
INSERT INTO ready_tickets SELECT * FROM ready_ticket_source;
