-- R-BTN-94: newest posted head, even when a legacy force post did not move the board head.
ALTER TABLE board_head ADD COLUMN posted_sha TEXT;

-- Keep the work of polling a mirror independent of unrelated events in its log.
CREATE INDEX events_mirror_pending ON events(repository_id, seq) WHERE
  kind IN ('claimed', 'completed', 'released', 'suspended', 'reaped', 'foreign-claim', 'adopted', 'fence-cleared')
  OR (kind = 'override' AND (json_type(detail_json, '$.hold') IS NOT NULL OR json_type(detail_json, '$.expedite') IS NOT NULL));
