-- B-249: recovery grace is not a heartbeat and does not renew a pending fence.
ALTER TABLE claims ADD COLUMN lease_recovered_at INTEGER;
