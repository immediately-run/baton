-- B-315 (R-BTN-134): latest branch resolutions at this home commit and the exact resolution a claim took.
ALTER TABLE board_snapshots ADD COLUMN course_sources_json TEXT;
ALTER TABLE claims ADD COLUMN course_source_json TEXT;
