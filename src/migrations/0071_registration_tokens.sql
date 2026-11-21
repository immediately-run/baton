CREATE TABLE registration_tokens (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  secret_hash TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  max_tier INTEGER,
  uses_left INTEGER NOT NULL CHECK (uses_left BETWEEN 0 AND 100),
  grant_ttl_s INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX registration_tokens_repository ON registration_tokens(repository_id);
CREATE TABLE token_registrations (
  token_id TEXT NOT NULL REFERENCES registration_tokens(id),
  at INTEGER NOT NULL
);
CREATE INDEX token_registrations_window ON token_registrations(token_id, at);

ALTER TABLE credentials ADD COLUMN registration_token_id TEXT REFERENCES registration_tokens(id);
ALTER TABLE credentials ADD COLUMN expires_at INTEGER;
ALTER TABLE credentials ADD COLUMN last_used_at INTEGER;
CREATE INDEX credentials_registration_token ON credentials(registration_token_id);
ALTER TABLE runner_grants ADD COLUMN accepted_at INTEGER;
UPDATE runner_grants SET accepted_at = granted_at;
ALTER TABLE repositories ADD COLUMN api_keys INTEGER NOT NULL DEFAULT 1 CHECK (api_keys IN (0, 1));
