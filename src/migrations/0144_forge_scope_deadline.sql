-- B-131: preserve the consumed deadline for the run, not the claim's alarm schedule.
ALTER TABLE claim_legs ADD COLUMN forge_deadline_at INTEGER;
UPDATE claim_legs AS l
SET forge_deadline_at = (
  SELECT CAST(json_extract(e.detail_json, '$.deadline_at') AS INTEGER)
  FROM events e
  WHERE e.claim_id = l.claim_id AND e.kind = 'leg-timeout'
    AND json_extract(e.detail_json, '$.deadline_at') > l.started_at
  ORDER BY e.seq DESC LIMIT 1
)
WHERE l.finished_at IS NULL AND l.abandoned_at IS NULL
  AND EXISTS (SELECT 1 FROM claims c WHERE c.id = l.claim_id AND c.status = 'active' AND c.deadline_at IS NULL);
