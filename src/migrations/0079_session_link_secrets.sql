-- B-312 (R-BTN-113): remove copies of session capabilities already written to the audit trail.
-- Keep the event, the history row and unrelated fields, including ordinary condition URLs.
UPDATE events SET detail_json = json_remove(detail_json, '$.url', '$.why')
 WHERE kind = 'discrepancy' AND json_extract(detail_json, '$.sub') = 'session-url'
   AND json_extract(detail_json, '$.why') LIKE 'its host %';
UPDATE events SET detail_json = json_remove(detail_json, '$.url')
 WHERE (kind = 'discrepancy' AND json_extract(detail_json, '$.sub') = 'session-url')
    OR (kind = 'condition' AND (json_extract(detail_json, '$.type') = 'interact'
                            OR json_extract(detail_json, '$.type') GLOB 'interact.*'));
UPDATE ticket_history SET detail_json = json_remove(detail_json, '$.session_url')
 WHERE kind IN ('leg-finished', 'leg-abandoned') AND json_type(detail_json, '$.session_url') IS NOT NULL;
UPDATE ticket_history SET detail_json = json_remove(detail_json, '$.url')
 WHERE kind = 'condition' AND (json_extract(detail_json, '$.type') = 'interact'
                           OR json_extract(detail_json, '$.type') GLOB 'interact.*');
-- Invalidate read ETags issued before the capability policy changed, even on a quiet board.
UPDATE state_version SET v = v + 1, board_v = board_v + 1 WHERE id = 1;
