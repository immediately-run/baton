-- B-147, R-BTN-180/R-BTN-182: keep the role separate from the checker mark,
-- and freeze the starting domain and trust requirement on each run.
ALTER TABLE runner_grants ADD COLUMN checker INTEGER NOT NULL DEFAULT 0 CHECK (checker IN (0, 1));
ALTER TABLE claim_legs ADD COLUMN domain TEXT;
ALTER TABLE claim_legs ADD COLUMN trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1));
ALTER TABLE claims ADD COLUMN offered_trusted INTEGER NOT NULL DEFAULT 0 CHECK (offered_trusted IN (0, 1));
