ALTER TABLE board_head ADD COLUMN observation_expects_evidence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_head ADD COLUMN sync_cli_version TEXT;
ALTER TABLE board_head ADD COLUMN sync_missing_evidence INTEGER NOT NULL DEFAULT 0;
