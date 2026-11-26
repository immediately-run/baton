-- R-BTN-94: the accepted observation counter advanced on a held post, even when sha did not.
UPDATE board_head AS b
SET posted_sha = (SELECT h.sha FROM held_snapshots h
                  WHERE h.repository_id = b.repository_id AND h.observation = b.observation
                  ORDER BY h.received_at DESC, h.sha LIMIT 1)
WHERE b.posted_sha IS NULL AND b.observation > 0;
