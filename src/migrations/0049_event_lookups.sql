-- 0049_event_lookups.sql — B-235 (BATON_SPEC §13, §14): the dashboard's event lookups by kind
-- and time. `GET /v1/ui/state` reads Needs you's `bars-mismatch` and `unsigned-control` events
-- and the Discrepancies view's `discrepancy` events of a recent window; with no index on
-- `(kind, at)` each read scanned the whole event log, which is never pruned (production passed
-- Cloudflare's 5,000,000 rows_read/day on 2026-11-14). The queries order by `at`, `seq` so the
-- index also serves their order and their LIMIT.
CREATE INDEX events_by_kind_at ON events(kind, at);

-- 0040 made `events_unsigned_control`; 0043 rebuilt `events` and recreated only its four other
-- indexes, so the index was lost (0048's rebuild repeated 0043's list). A rebuild of `events`
-- recreates every index here and in 0040.
CREATE INDEX IF NOT EXISTS events_unsigned_control ON events(at) WHERE kind = 'unsigned-control';
