-- 0060_workers_view_reads.sql — B-250 (BATON_SPEC §13, §14): the dashboard's Workers view reads
-- one query per list instead of about six per worker row ever registered, reaped ones included
-- (~1.9k statements a poll at 300 workers, ~3.6k rows_read; production passed Cloudflare's
-- 5,000,000 rows_read/day on 2026-11-14 and again on 2026-11-15). Each list's read must not
-- cost the workers' count.

-- The view's own order: `ORDER BY hostname, id` sorted the whole table, and a sort reads every
-- row twice on the Cloudflare host. The index carries the id (the rowid) behind `hostname`, so
-- the ordered read walks it at one row a worker. A worker row's hostname never changes after
-- its registration (one row per hostname and session), so a heartbeat writes no entry but the
-- registration's one.
CREATE INDEX workers_by_hostname ON workers(hostname);

-- The latest status report per worker: the per-worker reads scanned every message ever sent,
-- releases and requests included, once per worker. The partial index holds the reports alone,
-- ordered by their sender, so the one read the view makes of them touches no other message.
CREATE INDEX messages_reports ON messages(from_worker_id, id) WHERE kind = 'status_report';
