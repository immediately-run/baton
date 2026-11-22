-- R-BTN-155: only the normalized email's hash is stored; link sessions keep NULL.
ALTER TABLE dashboard_sessions ADD COLUMN access_email_hash TEXT;
