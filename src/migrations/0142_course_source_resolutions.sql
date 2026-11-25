-- B-315 (R-BTN-131): branch resolutions from the most recent reading at this home commit.
ALTER TABLE board_snapshots ADD COLUMN course_sources_json TEXT;
