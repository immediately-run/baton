-- B-160 (R-BTN-189): Baton enforces floors itself; runners no longer pin policy.
DROP TABLE policy_pins;
DELETE FROM policy_conditions WHERE type = 'baton.policy-unpinned';
