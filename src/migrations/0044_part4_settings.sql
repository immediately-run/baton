-- 0044_part4_settings.sql — B-168 (renumbered at the merge behind main's 0039–0042): the
-- owner settings the restructure's part 4 leaves (§1
-- R-BTN-66). `required_independence` judged review by whose key ran the implement leg, a second
-- statement of the course file's `no_chain_from` (R-BTN-106), which is now the one. `trigger_workflows`
-- is gone with the restructure: the unblocked trigger (R-BTN-94, `unblocked_trigger`) names the
-- workflow on the default branch, and Baton reads no workflow file. `report_horizon_h` timed how
-- long a runner's reports were kept (R-BTN-99); they are kept 6 hours, a constant.
--
-- The open_workers/usable_workers of the old resource_fleet went with 0043; `courses.report_horizon_h`
-- went with B-167's 0042.

ALTER TABLE repositories DROP COLUMN required_independence;
