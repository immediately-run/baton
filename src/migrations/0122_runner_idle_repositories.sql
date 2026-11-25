-- B-244: notify each repository at most once during a runner's idle stretch.
ALTER TABLE runner_idle ADD COLUMN notified_repositories TEXT NOT NULL DEFAULT '[]';
