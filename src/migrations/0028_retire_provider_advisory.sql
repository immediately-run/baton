-- 0028_retire_provider_advisory.sql — B-107: the provider advisory goes, replaced by the
-- ontology's readings and route choices (BATON_SPEC §5.9, §6.10; R-BTN-174, R-BTN-176,
-- R-BTN-177). An owner's peak-cost preference is a guard over a std:api-capacity@1 reading
-- inside a route choice, and an unavailable provider a reading (available: false) or an
-- alternative a leg reports dead — never a table core keeps. The advisory's tables go, each
-- child before its parent so no foreign key dangles: provider_suspensions, worker_providers
-- and the usage telemetry keyed by the advisory's accounts (usage_reports, rate_limit_events,
-- whose only writer was the heartbeat's, filtered by the accounts it knew), then the
-- reference tables provider_models and peak_schedules, the workers row's model_provider_id
-- (the heartbeat no longer carries one), and model_providers itself.
DROP TABLE provider_suspensions;
DROP TABLE worker_providers;
DROP TABLE usage_reports;
DROP TABLE rate_limit_events;
DROP TABLE provider_models;
DROP TABLE peak_schedules;
ALTER TABLE workers DROP COLUMN model_provider_id;
DROP TABLE model_providers;
