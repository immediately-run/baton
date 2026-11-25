-- R-BTN-90: a timeout reap's fence has a fixed expiry. NULL preserves the
-- existing fence path for older reaps and other reasons until B-79.
ALTER TABLE claims ADD COLUMN fence_deadline INTEGER;
CREATE INDEX claims_pending_fence_deadline ON claims(fence_deadline)
  WHERE status = 'reaped' AND fence_pending = 1 AND fence_deadline IS NOT NULL;
