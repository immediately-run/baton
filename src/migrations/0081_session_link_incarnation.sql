-- B-312 / R-BTN-113: a runner key may read only links attributed to its verified incarnation.
-- Do not attribute pre-upgrade links to the runner's current incarnation: it may have re-keyed.
ALTER TABLE claim_legs ADD COLUMN session_incarnation INTEGER;
