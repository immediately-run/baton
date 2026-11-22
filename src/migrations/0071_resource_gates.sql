-- R-BTN-75: a course resource prerequisite may bind as a gate; legacy needs stay advice.
ALTER TABLE ticket_blocks ADD COLUMN binds TEXT CHECK (binds IN ('gate', 'advice'));
ALTER TABLE ticket_blocks ADD COLUMN why TEXT;
