// dependencies.ts — a ticket's dependency on another repository's ticket (BATON_SPEC §3.1
// R-BTN-47 *Relations stay home* as relaxed, §4.4; B-113): `depends_on` may name a ticket of a
// repository registered with the same Baton by its qualified id `<repository id>:<local id>`;
// an unqualified id stays local, and `parent` (so `blocked_by`) still stays home — and a
// repository naming its own id qualified is read as it reads the local id alone (§3.1). The
// board post refuses what it cannot resolve — an unregistered repository, an id neither live
// nor closed there, a dependency on a less visible repository without its owner's consent — and
// refuses a cycle that runs through two boards, named as its path with qualified ids. The sync
// resolves its qualified dependencies against the target's board through the dependencies read
// (`POST /v1/sync/dependencies`), so a station function gates on it as on a local one
// (R-BTN-120). Pure checks first, store reads below them, the way codeRepos.ts splits its own.
import { BatonError } from './http';
import { logEvent } from './db';
import { fileUrl, type Forge } from './links';
import { qualify, repositoryOf, TICKET_ID } from './validate';
import type { Store } from './ports';

/** The most boards one post's dependency graph walks (spec-silent, as board.ts's own bounds: a
 * `depends_on` graph naming more repositories than this is out of scale, and refused as one). */
export const BOARDS_MAX = 32;

/** One repository's board as the checks read it: its live tickets (local id, file path, stored
 * `depends_on`) and its closed ones (R-BTN-10's kept rows). */
interface BoardSlice {
  live: { local: string; path: string; depends_on: string }[];
  closed: Map<string, 'done' | 'withdrawn'>;
}

/** The store's one-statement read, `BatonCore.sql`'s shape, so the checks run inside the
 * caller's transaction on either host. */
export type Sql = <T = Record<string, unknown>>(q: string, ...a: unknown[]) => T[];

const sliceOf = (sql: Sql, repo: string): BoardSlice => ({
  live: sql<{ local: string; path: string; depends_on: string }>('SELECT local_id AS local, path, depends_on FROM tickets WHERE repository_id = ?', repo),
  closed: new Map(sql<{ ticket_id: string; closed_as: string }>(
    'SELECT ticket_id, closed_as FROM closed_tickets WHERE ticket_id >= ? AND ticket_id < ?', `${repo}:`, `${repo};`)
    .map((c) => [c.ticket_id.slice(repo.length + 1), c.closed_as as 'done' | 'withdrawn'])),
});

/** Whether `id` names another repository's ticket (B-113): qualified, and not the posting
 *  repository's own id spelled out — that stays a local dependency read as before. */
export const isCrossRepository = (id: string, repo: string): boolean => id.includes(':') && repositoryOf(id) !== repo;

/** Every `depends_on` entry of a post's live tickets, as the checks take them. */
export type DepGraph = readonly { id: string; depends_on: readonly string[] }[];

/** The target repository's registration, or the refusal: it must be live-registered — a retired
 *  one is as one never registered (R-BTN-47). `id` names the qualified id the refusal prints. */
function liveRepository(sql: Sql, id: string): { id: string; forge: Forge; web_base: string | null; default_branch: string } {
  const row = sql<{ id: string; forge: Forge; web_base: string | null; default_branch: string; retired_at: number | null }>(
    'SELECT id, forge, web_base, default_branch, retired_at FROM repositories WHERE id = ?', repositoryOf(id))[0];
  if (!row || row.retired_at != null) throw new BatonError('invalid-params', `depends_on names ${id}, which is not a repository registered here (B-113)`);
  return row;
}

/** Whether every principal that sees `dependent` sees `target` too (B-113, the visibility the
 *  consent rule reads): every owner key of the one is an owner of the other, and every runner
 *  grant on the one is a grant on the other. An administrator sees every board, so administrator
 *  keys lower nothing. */
export function atLeastAsVisible(sql: Sql, target: string, dependent: string): boolean {
  const owners = sql<{ n: number }>(
    `SELECT count(*) AS n FROM repository_owners d
     WHERE d.repository_id = ? AND d.removed_at IS NULL AND d.revoked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM repository_owners t WHERE t.repository_id = ?
                        AND t.fingerprint = d.fingerprint AND t.removed_at IS NULL AND t.revoked_at IS NULL)`, dependent, target)[0].n;
  if (owners > 0) return false;
  const grants = sql<{ n: number }>(
    `SELECT count(*) AS n FROM runner_grants d
     WHERE d.repository_id = ? AND d.revoked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM runner_grants t WHERE t.repository_id = ? AND t.credential_id = d.credential_id AND t.revoked_at IS NULL)`, dependent, target)[0].n;
  return grants === 0;
}

/** Whether the target repository's owners consented to the dependent's dependencies on it
 *  (B-113, recorded as R-BTN-140's cross-repository consent is): a `dependency_consents` row on
 *  the target naming the dependent, judged here at every use and never written by the
 *  dependent's own settings. */
export const hasConsent = (sql: Sql, target: string, dependent: string): boolean =>
  sql('SELECT 1 FROM dependency_consents WHERE repository_id = ? AND dependent_id = ?', target, dependent).length > 0;

/** The consent a post or a read asks for, as the refusal names it. */
export const consentAsk = (target: string, dependent: string): string =>
  `${target} is less visible than ${dependent}, and its owners have not consented — they consent with POST /v1/owner/${target}/dependency-consents {repository: "${dependent}", confirm: true} (B-113)`;

/** Check a post's cross-repository `depends_on` (B-113): every qualified id its live tickets
 *  name resolves to a live-registered repository and a ticket live or closed there, and the
 *  target is at least as visible as the posting repository, or its owners consented. Throws the
 *  refusal. */
export function checkCrossRepository(sql: Sql, repo: string, live: DepGraph): void {
  const named = new Set<string>();
  for (const t of live) for (const d of t.depends_on) if (isCrossRepository(d, repo)) named.add(d);
  const boards = new Map<string, BoardSlice>();
  for (const id of [...named].sort()) {
    if (!TICKET_ID.test(id)) throw new BatonError('invalid-params', `depends_on names ${id}, which is not a qualified id <repository>:<local> (B-113)`);
    const target = repositoryOf(id);
    liveRepository(sql, id);
    boards.get(target) ?? boards.set(target, sliceOf(sql, target));
    const local = id.slice(id.indexOf(':') + 1);
    const slice = boards.get(target)!;
    if (!slice.live.some((t) => t.local === local) && !slice.closed.has(local)) {
      throw new BatonError('invalid-params', `depends_on names ${id}, which is neither live nor closed on ${target} (B-113)`);
    }
    if (!atLeastAsVisible(sql, target, repo) && !hasConsent(sql, target, repo)) {
      throw new BatonError('invalid-params', `depends_on names ${id}: ${consentAsk(target, repo)}`);
    }
  }
}

/** Refuse a dependency cycle that runs through boards (B-113; B-111's item 4 across
 *  repositories): the post's live tickets and every touched repository's stored ones, qualified
 *  edges followed across boards, the cycle named as its path with qualified ids. An edge to a
 *  closed or unknown ticket is no cycle here, as within one board (§4.4); a loop one board holds
 *  alone, however its edges are spelled, was refused when that board was posted (B-111, with
 *  §3.1's self-qualified read). A graph over more boards than `BOARDS_MAX` is refused here
 *  too: it is out of scale, named as the board that crossed the bound. */
export function checkCrossBoardCycle(sql: Sql, repo: string, live: DepGraph): void {
  // The graph: one node per qualified id, its dependencies qualified — the posting repository's
  // from the post itself, every other touched one from its stored rows. A qualified edge into a
  // board not yet loaded grows the set, until no new one is named or the bound refuses it (a
  // graph over more boards than BOARDS_MAX is out of scale, and refused as one — round 1, which
  // found the bound written but never thrown: a cycle through the 33rd board went unseen).
  const graph = new Map<string, string[]>();
  const loaded = new Set<string>([repo]);
  const load = (r: string, rows: readonly { id: string; depends_on: readonly string[] }[]): void => {
    for (const t of rows) graph.set(qualify(r, t.id), (t.depends_on ?? []).map((d) => (d.includes(':') ? d : qualify(r, d))));
  };
  load(repo, live);
  for (let grew = true; grew;) {
    grew = false;
    for (const deps of graph.values()) {
      for (const dep of deps) {
        if (!dep.includes(':') || graph.has(dep)) continue;
        const target = repositoryOf(dep);
        if (loaded.has(target)) continue;
        if (loaded.size >= BOARDS_MAX) throw new BatonError('invalid-params', `tickets.depends_on: a dependency graph over more than ${BOARDS_MAX} repositories is out of scale, and ${dep} takes it to ${loaded.size + 1} (B-113)`);
        loaded.add(target);
        load(target, sliceOf(sql, target).live.map((t) => ({ id: t.local, depends_on: JSON.parse(t.depends_on) as string[] })));
        grew = true;
      }
    }
  }
  // The walk: iterative depth-first, `dependsCycles`' shape — a legal board may be one
  // 10 000-long chain, which recursion cannot walk. Only a cycle over two or more repositories
  // is named here: one board's own loop, however its edges are spelled, was that board's own
  // post's refusal — `checkPayload` reads a self-qualified edge as its local id (§3.1, round 1).
  const state = new Map<string, 'open' | 'closed'>();
  for (const root of [...graph.keys()].sort()) {
    if (state.has(root)) continue;
    const stack: { id: string; at: number }[] = [{ id: root, at: 0 }];
    const path = [root];
    const onPath = new Map<string, number>([[root, 0]]);
    state.set(root, 'open');
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const list = graph.get(frame.id) ?? [];
      if (frame.at >= list.length) {
        stack.pop();
        path.pop();
        onPath.delete(frame.id);
        state.set(frame.id, 'closed');
        continue;
      }
      const dep = list[frame.at++];
      if (!graph.has(dep)) continue;
      if (state.get(dep) === 'open') {
        const loop = [...path.slice(onPath.get(dep)!), dep];
        if (new Set(loop.map(repositoryOf)).size > 1) {
          throw new BatonError('invalid-params', `tickets.depends_on: a dependency cycle across repositories: ${loop.join(' → ')}`);
        }
        continue;
      }
      if (state.has(dep)) continue;
      state.set(dep, 'open');
      onPath.set(dep, path.length);
      path.push(dep);
      stack.push({ id: dep, at: 0 });
    }
  }
}

/** One resolved dependency, as the sync's dependencies read answers it (§4.3, B-113): where the
 *  target stands on its own board — the `done` a `depends_at: {done: true}` waits on, its closed
 *  kinds, the station it sits at — and the target's link, built from its registration
 *  (`web_base`, forge path), never a stored URL (the display rule). */
export interface ResolvedDependency {
  /** The qualified id as it was named. */
  ticket: string;
  repository: string;
  local: string;
  done: boolean;
  withdrawn: boolean;
  closed: boolean;
  station: string | null;
  /** The target file's URL from its repository's registration; null on a `git` repository and
   *  for a closed target — its file moved to the target's archive, whose path the closing keeps
   *  nowhere, so the read answers no link rather than a guess (round 1). */
  url: string | null;
}

/** The sync's dependencies read (B-113, §4.3): resolve each qualified id the posting
 *  repository's tickets name against its target's board — a self-qualified one (the posting
 *  repository's own id spelled out, §3.1) against that same board, read as the local id alone,
 *  so a CLI whose repos map cannot name its own repository still syncs (round 1) — with the
 *  same refusals the post would make (`forbidden` for a missing consent, so the sync fails on
 *  it before it reads the forge), and the doneness the station functions gate on. */
export function resolveDependencies(sql: Sql, repo: string, ids: readonly string[]): ResolvedDependency[] {
  return [...new Set(ids)].sort().map((id) => {
    if (!TICKET_ID.test(id)) throw new BatonError('invalid-params', `${id} is not a qualified id <repository>:<local> (B-113)`);
    const target = repositoryOf(id);
    const registration = liveRepository(sql, id);
    const slice = sliceOf(sql, target);
    const local = id.slice(id.indexOf(':') + 1);
    const closedAs = slice.closed.get(local) ?? null;
    const row = slice.live.find((t) => t.local === local) ?? null;
    if (!row && closedAs == null) throw new BatonError('invalid-params', `depends_on names ${id}, which is neither live nor closed on ${target} (B-113)`);
    if (!atLeastAsVisible(sql, target, repo) && !hasConsent(sql, target, repo)) {
      throw new BatonError('forbidden', `depends_on names ${id}: ${consentAsk(target, repo)}`);
    }
    const station = row ? sql<{ station: string | null }>('SELECT station FROM ticket_stations WHERE ticket_id = ?', qualify(target, local))[0]?.station ?? null : null;
    return {
      ticket: id, repository: target, local,
      done: closedAs === 'done',
      withdrawn: closedAs === 'withdrawn',
      closed: closedAs != null,
      station,
      url: row ? fileUrl(registration.forge, registration.web_base, registration.default_branch, row.path) : null,
    };
  });
}

/** `POST /v1/owner/{repository}/dependency-consents` (B-113): the target repository's owners'
 *  consent to another repository's tickets depending on theirs — given with `confirm: true`,
 *  withdrawn with `withdraw: true`, mirrored on R-BTN-140's `code-repo-consents`. Never written
 *  by the dependent's own settings: only this route, by the target's owners. */
export function consentRoute(store: Store, now: () => number, repo: string, actor: string, body: unknown): { ok: true; repository: string; consent: boolean } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BatonError('invalid-params', 'a JSON object is required');
  const b = body as { repository?: unknown; confirm?: unknown; withdraw?: unknown };
  if (typeof b.repository !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(b.repository)) throw new BatonError('invalid-params', 'repository: must be a repository id (the dependent)');
  if (b.repository === repo) throw new BatonError('invalid-params', 'repository: a repository consents to another repository\'s dependencies, not its own (B-113)');
  if (b.confirm === true && b.withdraw === true) throw new BatonError('invalid-params', 'confirm and withdraw are one of the two');
  if (b.confirm !== true && b.withdraw !== true) throw new BatonError('invalid-params', 'confirm: true gives the consent, withdraw: true withdraws it');
  for (const k of Object.keys(b)) if (!['repository', 'confirm', 'withdraw'].includes(k)) throw new BatonError('invalid-params', `${k} is not a consent field`);
  const dependent = b.repository;
  const live = store.exec<{ retired_at: number | null }>('SELECT retired_at FROM repositories WHERE id = ?', dependent).toArray()[0];
  if (!live || live.retired_at != null) throw new BatonError('not-found', `${dependent} is not registered`);
  return store.transaction(() => {
    if (b.withdraw === true) {
      store.exec('DELETE FROM dependency_consents WHERE repository_id = ? AND dependent_id = ?', repo, dependent);
    } else {
      store.exec('INSERT INTO dependency_consents (repository_id, dependent_id, granted_by, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT (repository_id, dependent_id) DO UPDATE SET granted_by = excluded.granted_by, granted_at = excluded.granted_at',
        repo, dependent, actor, now());
    }
    logEvent(store, now(), 'dependency-consent', actor, { repository: repo, dependent, consent: b.confirm === true }, null, null, repo);
    return { ok: true as const, repository: dependent, consent: b.confirm === true };
  });
}
