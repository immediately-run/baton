-- B-10 / B-239: 0103 let a `ticket` block on a later leg leave the queued leg ready
-- (R-BTN-75: a prerequisite binds only its leg), and 0125 added `required_caps` to the
-- ready projection. 0125 recreated `ready_ticket_source` from the view before 0103, so
-- any `ticket` block, on whatever leg, took the ticket out of the ready queue again.
-- The view keeps both: the per-leg block rule and the requirements column.
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
 b.kind IN ('ticket', 'decision') AND b.leg IN ('', s.next_leg));
DELETE FROM ready_tickets;
INSERT INTO ready_tickets SELECT * FROM ready_ticket_source;
