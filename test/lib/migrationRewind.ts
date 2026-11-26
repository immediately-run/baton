// Rewinding a migrated database must remove views and cross-table triggers before their
// source tables. SQLite otherwise keeps an invalid view while older ALTER TABLEs run.
export function dropDerivedSchema(sql: SqlStorage): void {
  const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE type IN ('view', 'trigger')").toArray() as { type: string; name: string }[];
  for (const o of objects) sql.exec(`DROP ${o.type.toUpperCase()} "${o.name.replaceAll('"', '""')}"`);
}

/** A deployed, capped runner and a board whose raw parents form a cycle, before 0142. */
export function seedPreTierDropBoard(sql: SqlStorage, { fingerprint, publicKey, secretHash, at, oldHead, aHash, bHash, author }: {
  fingerprint: string; publicKey: string; secretHash: string; at: number; oldHead: string; aHash: string; bHash: string; author: string;
}): void {
  sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow, cutover_at, web_base, ci_identity)
    VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml', 1, 'https://github.com/immediately-run/docs', '{"kind":"github-actions"}')`);
  sql.exec('INSERT INTO board_head (repository_id, sha) VALUES (?, ?)', 'docs', oldHead);
  sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key) VALUES (?, 'host', '["agent-venue"]', 'runner', ?)`, fingerprint, publicKey);
  sql.exec(`INSERT INTO runner_grants (credential_id, repository_id, capabilities, max_tier, granted_by, granted_at) VALUES (?, 'docs', '["agent-venue"]', 1, 'owner:k', 1)`, fingerprint);
  sql.exec(`INSERT INTO runners (id, hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, tier_ceilings, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
      VALUES (7, 'host', 's', ?, ?, 'opencode', 'vm', 'critical', '{"docs":"critical"}', 900000, '', ?, ?)`, secretHash, fingerprint, at, at);
  sql.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash, tier, tier_position, course_id, rank, key, last_written_by)
      VALUES ('docs:A', 'docs', 'A', 'tickets/A.md', 'A', '', '', '', '[]', 'none', '[]', '[]', '["immediately-run/docs"]', ?, ?, 'critical', 2, 'roadmap-pr', 4, 'tickets/A.md', ?)`, oldHead, aHash, author);
  sql.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash, tier, tier_position, course_id, rank, key, last_written_by)
      VALUES ('docs:B', 'docs', 'B', 'tickets/B.md', 'B', '', '', '', '[]', 'none', '[]', '[]', '["immediately-run/docs"]', ?, ?, 'routine', 0, 'roadmap-pr', 5, 'tickets/B.md', ?)`, oldHead, bHash, author);
  sql.exec(`
    INSERT INTO ticket_stations (ticket_id, station, path, path_len, to_end, next_leg, next_source, snapshot_sha, observation)
      VALUES ('docs:A', 'filed', '[]', 0, 1, 'implement', 'course', '', 1);
    INSERT INTO ticket_next_legs (ticket_id, leg, state, ready_since) VALUES ('docs:A', 'implement', 'ready', 1);`);
}

export function setTierDropRank(sql: SqlStorage, rank: number): void {
  sql.exec("UPDATE tickets SET rank = ? WHERE id = 'docs:A'", rank);
}

export function setTierDropReady(sql: SqlStorage, state: 'ready' | 'waiting'): void {
  sql.exec("UPDATE ticket_next_legs SET state = ? WHERE ticket_id = 'docs:A'", state);
}
