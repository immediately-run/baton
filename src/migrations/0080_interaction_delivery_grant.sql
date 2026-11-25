-- S-BTN-310: ordinary read grants do not authorize delivery of bearer capabilities.
ALTER TABLE runner_grants ADD COLUMN deliver_interactions INTEGER NOT NULL DEFAULT 0 CHECK (deliver_interactions IN (0, 1));
