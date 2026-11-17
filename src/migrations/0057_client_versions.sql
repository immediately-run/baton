-- 0057_client_versions.sql — B-254 (BATON_SPEC §11.3 R-BTN-197, §13.1, §13.3): the client
-- versions Baton and its clients state about each other. `instance_settings.recommended_client`
-- is the administrator's raise of the code's RECOMMENDED_CLIENT — NULL for the code's default,
-- never below it (validated in validate.ts) — read into the Baton-Client-Versions response
-- header and the Needs-you listing of runners below it. `workers.client_version` is the last
-- runner call's Baton-Client (`baton/0.1.4+dev` → `0.1.4+dev`): the runner's own statement,
-- recorded as one and shown as one (§13.3, a filter field, R-BTN-33) — NULL when the call named
-- no version an old runner sends none.
ALTER TABLE instance_settings ADD COLUMN recommended_client TEXT;
ALTER TABLE workers ADD COLUMN client_version TEXT;
