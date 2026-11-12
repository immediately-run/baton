-- 0036_retire_model_tables.sql — B-142: the pre-route-choice model tables go. Route choices
-- (§6.10) formed their atoms from the ontology, external_resources and readings — never
-- model_providers, peak_schedules or provider_suspensions — and since B-167 nothing in core
-- reads them either: an unavailable provider is a reading `available: false` (§6.3, R-BTN-76)
-- or a resource block a leg reports, and an owner's peak-cost preference is a rule in the
-- course, never a table core keeps. The tables drop, each child before its parent so no
-- foreign key dangles: the suspensions, the workers' billing rows and the usage telemetry
-- keyed by the model accounts (usage_reports, rate_limit_events, whose only writer was the
-- heartbeat's, filtered by the accounts it knew), then the reference tables provider_models
-- and peak_schedules, the workers row's model_provider_id (the heartbeat no longer carries
-- one), and model_providers itself.
DROP TABLE provider_suspensions;
DROP TABLE worker_providers;
DROP TABLE usage_reports;
DROP TABLE rate_limit_events;
DROP TABLE provider_models;
DROP TABLE peak_schedules;
ALTER TABLE workers DROP COLUMN model_provider_id;
DROP TABLE model_providers;
