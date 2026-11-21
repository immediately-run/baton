import { codeReposOf } from './codeRepos';
import { BatonError } from './http';
import type { Store } from './ports';
import { scopePaths } from './scope';
import { checkForgeRun } from './validate';

/** S-BTN-310: unlike the scope audit, this read never authorizes by-name reach. */
export function forgeScope(store: Store, now: number, run: string, runner?: string) {
  checkForgeRun(run);
  const row = store.exec<{ repository_id: string; github: string; repos: string; valid_until: number }>(`
    SELECT p.id AS repository_id, p.github, t.repos,
           min(w.last_seen_at + w.lease_timeout_ms, coalesce(c.deadline_at, 9007199254740991)) AS valid_until
    FROM claim_legs l JOIN claims c ON c.id = l.claim_id JOIN runners w ON w.id = c.runner_id
    JOIN credentials k ON k.id = w.credential_id JOIN tickets t ON t.id = c.ticket_id
    JOIN repositories p ON p.id = t.repository_id
    JOIN runner_grants g ON g.repository_id = p.id AND g.credential_id = k.id
    WHERE l.run_id = ? AND l.finished_at IS NULL AND l.abandoned_at IS NULL
      AND c.status = 'active' AND w.reaped_at IS NULL AND k.kind = 'runner'
      AND k.revoked_at IS NULL AND g.revoked_at IS NULL AND p.retired_at IS NULL
      AND p.forge = 'github' AND lower(p.web_base) = 'https://github.com/' || lower(p.github)
      AND (? IS NULL OR k.id = ?)
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.to_runner_id = w.id AND m.kind = 'release'
        AND m.status IN ('pending', 'delivered') AND json_extract(m.payload_json, '$.ticket_id') = t.id)
  `, run, runner ?? null, runner ?? null).toArray()[0];
  if (!row || row.valid_until <= now) throw new BatonError('not-found', 'no active forge scope for this run');
  const listed = codeReposOf(store, row.repository_id);
  const paths = scopePaths({ ...row, forge: 'github' }, listed.map((entry) => entry.path));
  const home = row.github.toLowerCase();
  const repositories = [...paths].sort().map((path) => {
    if (path === home) return { path, id: null };
    const entry = listed.find((e) => e.path.toLowerCase() === path)!;
    if (entry.forge !== 'github' || entry.host !== 'github.com') {
      throw new BatonError('not-found', 'the run does not have a github.com-only forge scope');
    }
    return { path, id: entry.repo_id };
  });
  return { repositories, valid_until: row.valid_until };
}
