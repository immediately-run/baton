-- 0045_check_conclusions.sql — B-169 (renumbered at the merge behind B-168's 0043–0044) on R-BTN-114: the owners' `checks` map, one entry per
-- check course — `{name?, url?, conclusions: {<end station>: success | failure | timed_out}}` —
-- each checked by PUT /v1/owner/{repository}/settings before it lands, so no edit in git turns
-- `failed` into `success`. `{}` is the owners' whole word so far.
ALTER TABLE repositories ADD COLUMN checks TEXT NOT NULL DEFAULT '{}';
