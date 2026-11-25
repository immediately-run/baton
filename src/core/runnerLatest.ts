type Pointer = { runner_id: number; repo: string; path: string; t: number };
type Report = { runner_id: number; payload_json: string | null; sent_at: number };

/** S-BTN-243: one indexed top-1 lookup per live runner in each history table, independent
 *  of its history depth. Each caller supplies the live IDs from its own roster. */
export function runnerLatest(sql: <T>(query: string, ids: string) => T[], ids: string) {
  const transcript = new Map<number, Pointer>();
  const reports = new Map<number, Report>();
  if (ids === '[]') return { transcript, reports };

  // §6.8: the index order breaks ties within each table, and linked wins over pending.
  for (const t of sql<Pointer>(
    `SELECT runner_id, repo, path, COALESCE(last_pushed_at, first_seen_at) AS t FROM transcripts
     WHERE id IN (SELECT (SELECT t.id FROM transcripts t WHERE t.runner_id = j.value ORDER BY COALESCE(t.last_pushed_at, t.first_seen_at) DESC, t.repo, t.path, t.claim_id LIMIT 1) FROM json_each(?) j)`, ids)) transcript.set(t.runner_id, t);
  for (const t of sql<Pointer>(
    `SELECT runner_id, repo, path, COALESCE(last_pushed_at, first_seen_at) AS t FROM pending_transcripts
     WHERE rowid IN (SELECT (SELECT t.rowid FROM pending_transcripts t WHERE t.runner_id = j.value ORDER BY COALESCE(t.last_pushed_at, t.first_seen_at) DESC, t.repo, t.path LIMIT 1) FROM json_each(?) j)`, ids)) {
    const best = transcript.get(t.runner_id);
    if (!best || t.t > best.t) transcript.set(t.runner_id, t);
  }
  // §6.9: the newest status report is the one with the greatest id, not sent_at.
  for (const m of sql<Report>(
    `SELECT from_runner_id AS runner_id, payload_json, sent_at FROM messages
     WHERE id IN (SELECT (SELECT m.id FROM messages m WHERE m.kind = 'status_report' AND m.from_runner_id = j.value ORDER BY m.id DESC LIMIT 1) FROM json_each(?) j)`, ids)) reports.set(m.runner_id, m);

  return { transcript, reports };
}
