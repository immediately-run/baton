-- B-160 (R-BTN-189): Baton enforces floors itself; runners no longer pin policy.
-- Keep the unused table and its rows for a rollback to the preceding server, whose
-- claim path still queries it even for a runner that never sent a pin.
DELETE FROM policy_conditions WHERE type = 'baton.policy-unpinned';
