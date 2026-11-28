ALTER TABLE repositories ADD COLUMN exhausted_retry_s INTEGER NOT NULL DEFAULT 86400;
ALTER TABLE ticket_overrides ADD COLUMN exhausted_retry_position TEXT;
