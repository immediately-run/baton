// reads/repositories.ts — the two reads the shell itself needs (B-204): `GET /v1/repositories`
// (`repo.list`), the caller's repositories with the counts the sidebar and the strip draw, and
// `GET /v1/actions` (`actions.list`), a session's own registry entries.
import { liveRunnerSql } from '../runnerLiveness';
import { BatonError } from '../http';
import { actionsFor } from '../actions';
import { DISCREPANCY_WINDOW_MS } from '../history';
import { countStates, ticketRows } from '../tickets';
import { readableRepositories, type ReadCtx, type ReadPrincipal, type ReadRoute } from './kit';

/** One repository as `GET /v1/repositories` lists it. Filter fields only (R-BTN-33): the
 *  registry row and counts. */
export type RepositoryRow = {
  id: string;
  /** The forge path (R-BTN-92), under its stored name. */
  github: string;
  forge: string;
  web_base: string | null;
  default_branch: string;
  weight: number;
  /** The courses in force, ids and versions. */
  courses: { id: string; version: number }[];
  /** The head snapshot — its commit, when its post was accepted, and that post's observation
   *  number (R-BTN-62) — or null before the first accepted post. */
  head: { sha: string; received_at: number | null; observation: number } | null;
  /** R-BTN-28. */
  mode: 'shadow' | 'cut-over';
  /** Live claims: `claims` rows with `status = 'active'` on the repository's tickets. */
  running: number;
  /** Ready tickets: those the Tickets list calls `ready` (`ticketState`) — a queued leg posted
   *  ready and nothing above it in the precedence (no claim, hold, block or back-off), so the
   *  strip's number is the length of the list it links to. */
  ready: number;
  /** Open conditions (`conditions.outcome = 'open'`) and nothing else: the queued person legs
   *  R-BTN-163 also lists join the count with B-57. The strip labels it "conditions" until then. */
  needs_you: number;
  /** Of `runners_total`, those whose lease stands at the read's instant. */
  runners_alive: number;
  /** Runner sessions not reaped whose key holds a live (unrevoked) grant on the repository. A
   *  seed or bearer credential, which no grant binds, is not counted. */
  runners_total: number;
  /** R-BTN-85's discrepancy events of the last 7 days. */
  discrepancies_7d: number;
  /** The repository's exclusive goal. Always null: goals are not built (B-122). */
  exclusive_goal: { id: string; title: string } | null;
};

/** `GET /v1/repositories`' answer. */
export type RepositoriesAnswer = {
  repositories: RepositoryRow[];
  /** The caller's session role; null for a key. */
  session: { role: 'administrator' | 'owner' } | null;
  /** The instance's link rule (§12.3), for the client's link gate. */
  link_hosts: string[];
  session_hosts: string[];
  /** For an administrator (key or session), as `GET /v1/admin/repositories` carries it
   *  (R-BTN-58): the repositories leaning on the deploy's seed for their owner keys. Absent
   *  when there is none. */
  seed_owners?: string[];
  server_time: number;
};

const prefix = `substr(ticket_id, 1, instr(ticket_id, ':') - 1)`;

function countBy(cx: ReadCtx, query: string, ...params: unknown[]): Map<string, number> {
  return new Map(cx.sql<{ r: string; n: number }>(query, ...params).map((x) => [x.r, x.n]));
}

export function repositoriesAnswer(cx: ReadCtx, principal: ReadPrincipal): RepositoriesAnswer {
  const now = cx.now();
  const mine = new Set(readableRepositories(cx, principal));
  const repos = cx.core.registry.all().filter((r) => mine.has(r.id));
  const heads = new Map(cx.sql<{ repository_id: string; sha: string | null; observation: number; received_at: number | null }>(
    `SELECT h.repository_id, h.sha, h.observation, s.received_at FROM board_head h
     LEFT JOIN board_snapshots s ON s.repository_id = h.repository_id AND s.sha = h.sha`).map((h) => [h.repository_id, h]));
  const courses = new Map<string, { id: string; version: number }[]>();
  for (const c of cx.core.courses.all()) courses.set(c.repository_id, [...(courses.get(c.repository_id) ?? []), { id: c.id, version: c.version }]);
  const running = countBy(cx, `SELECT ${prefix} AS r, COUNT(*) AS n FROM claims WHERE status = 'active' GROUP BY r`);
  const needsYou = countBy(cx, `SELECT repository_id AS r, COUNT(*) AS n FROM conditions WHERE outcome = 'open' GROUP BY repository_id`);
  const total = countBy(cx,
    `SELECT g.repository_id AS r, COUNT(*) AS n FROM runner_grants g JOIN runners w ON w.credential_id = g.credential_id
     WHERE g.revoked_at IS NULL AND w.reaped_at IS NULL GROUP BY g.repository_id`);
  const alive = countBy(cx,
    `SELECT g.repository_id AS r, COUNT(*) AS n FROM runner_grants g JOIN runners w ON w.credential_id = g.credential_id
     WHERE g.revoked_at IS NULL AND ${liveRunnerSql('w.')} GROUP BY g.repository_id`, now);
  const discrepancies = countBy(cx,
    `SELECT COALESCE(repository_id, ${prefix}) AS r, COUNT(*) AS n FROM events WHERE kind = 'discrepancy' AND at > ? GROUP BY r`, now - DISCREPANCY_WINDOW_MS);
  const instance = cx.core.instance.view();
  const administrator = principal.kind === 'session' ? principal.role === 'administrator' : principal.role === 'admin';
  const seed_owners = administrator ? cx.core.admin.seedOwnedRepositories() : [];
  return {
    repositories: repos.map((r) => {
      const h = heads.get(r.id);
      return {
        id: r.id, github: r.github, forge: r.forge, web_base: r.web_base, default_branch: r.default_branch, weight: r.weight,
        courses: courses.get(r.id) ?? [],
        head: h?.sha ? { sha: h.sha, received_at: h.received_at, observation: h.observation } : null,
        mode: r.cutover_at != null ? 'cut-over' as const : 'shadow' as const,
        running: running.get(r.id) ?? 0,
        ready: countStates(ticketRows(cx, r.id)).ready,
        needs_you: needsYou.get(r.id) ?? 0,
        runners_alive: alive.get(r.id) ?? 0,
        runners_total: total.get(r.id) ?? 0,
        discrepancies_7d: discrepancies.get(r.id) ?? 0,
        exclusive_goal: null,
      };
    }),
    session: principal.kind === 'session' ? { role: principal.role } : null,
    link_hosts: instance.link_hosts,
    session_hosts: instance.session_hosts,
    ...(seed_owners.length ? { seed_owners } : {}),
    server_time: now,
  };
}

export const SHELL_READS: ReadRoute[] = [
  // `runners_alive` and the 7-day window are the clock's.
  { action: 'repo.list', clock: true, run: (cx, call) => repositoriesAnswer(cx, call.principal) },
  {
    // R-BTN-129's "what can I do", to a session: its entries as the table holds them, minus
    // `delegated`, with `ui` — never per target (B-204).
    action: 'actions.list',
    run(cx, call) {
      const p = call.principal;
      if (p.kind !== 'session') throw new BatonError('forbidden', 'actions.list answers a dashboard session');
      return { actions: actionsFor(p.role, { ownsRepository: readableRepositories(cx, p).length > 0 }), session: { role: p.role } };
    },
  },
];
