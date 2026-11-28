// reads/conditions.ts — the Conditions screens' reads (BATON_SPEC §7.3 R-BTN-163, §6.4
// R-BTN-116; B-195, B-219): one condition (`condition.show`), what waits on a person in one
// repository (`repo.needs-you`), the conditions list's additive fields, and the lookup behind
// the `/conditions/{id}` address (`condition.locate`). All four read rows Baton already holds;
// nothing here writes.
//
// What stands behind them today, and what does not:
//   - a condition's row is B-234's (`conditions`, migration 0048): type, disposition, severity,
//     restarts, the session link of an `interact`, and the core notice's re-raise count. No
//     leg-supplied `detail` or `handler` is stored (B-55, R-BTN-161), and no resolve exists (B-56) — so
//     `allowed` is empty for every caller and `not_built` names what is missing;
//   - a queued person leg is `questions.ts`'s (`ticket_questions`, the course's graph). Whether
//     the caller may answer it is `answerWord`: the same rule `POST …/attestations` judges by
//     (an owner key of the repository, where the policy's `inputs.answers` admits one), stated
//     for the reader — a drawing hint, decided again on the write. A dashboard session answers
//     nothing: an administrator's is no owner (R-BTN-57), and an owner's session and its write
//     path are B-76's;
//   - V1's other Needs-you listings (`stateView().needs_you`) are not conditions yet (B-57):
//     `repo.needs-you` serves the repository-scoped ones under `listings`, each as the module
//     that owns it answers it, narrowed to the one repository. The instance-wide ones are named
//     under `elsewhere` and are `admin.tenant`'s (`needs_you`, ./tenant.ts), drawn on State.
import { conditionLink, coreConditionDetail } from '../conditions';
import { BatonError } from '../http';
import { canRead, queryOf, type ReadCall, type ReadCtx, type ReadPrincipal, type ReadRoute } from './kit';
import type { Row } from '../ports';

/** The tree path of a condition's Resolve page (B-191): what `resolve_url` carries. */
export const resolvePath = (repository: string, id: number): string => `/repositories/${repository}/conditions/${id}`;

/** What a condition row cannot carry yet, by the ticket or rule that builds it. */
const CONDITION_NOT_BUILT = { resolve: 'B-56', detail: 'B-55', handler: 'R-BTN-161' } as const;

/** V1's Needs-you listings that are the instance's, not one repository's — the tenant screens'. */
export const INSTANCE_LISTINGS = ['instances_unknown', 'keys', 'capacity', 'stale_clients', 'stale_skills_no_course'] as const;

const SEVERITY_ORDER = `CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`;
const severityRank = (s: unknown): number => (s === 'critical' ? 0 : s === 'high' ? 1 : 2);

interface ConditionRow {
  id: number;
  repository_id: string;
  ticket_id: string | null;
  claim_id: number | null;
  run_id: string | null;
  leg: string | null;
  type: string;
  disposition: string;
  severity: string;
  url: string | null;
  restarts_json: string;
  default_restart: string | null;
  raised_at: number;
  outcome: string;
  closed_at: number | null;
  closed_how: string | null;
  reraised: number;
  detail_json: string | null;
}

const CONDITION_COLUMNS = 'id, repository_id, ticket_id, claim_id, run_id, leg, type, disposition, severity, url, restarts_json, default_restart, raised_at, outcome, closed_at, closed_how, reraised, detail_json';

/** A condition as these reads answer it: the list's fields (`Conditions.entry`), and its
 *  outcome, close and Resolve path. `allowed` is the registry ids the caller may call on it —
 *  none while no resolve is built. */
function conditionOf(r: ConditionRow, disclose: boolean) {
  let restarts: Record<string, string> | null = null;
  try {
    const parsed = JSON.parse(r.restarts_json) as Record<string, string>;
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) restarts = parsed;
  } catch { /* an unreadable list is no list */ }
  return {
    condition_id: r.id, ticket_id: r.ticket_id, leg: r.leg, run_id: r.run_id, type: r.type,
    disposition: r.disposition, severity: r.severity, raised_at: r.raised_at, ...conditionLink(r.type, r.url, disclose),
    restarts, default: r.default_restart,
    ...coreConditionDetail(r),
    outcome: r.outcome, closed_at: r.closed_at, closed_how: r.closed_how,
    resolve_url: resolvePath(r.repository_id, r.id),
    allowed: [] as string[],
  };
}

/** May `principal` answer a person leg of `repository` — write its `std:decision@1`? The rule
 *  of `POST …/attestations` (R-BTN-116, R-BTN-185, R-BTN-191), for the reader: an owner key of
 *  the repository, unless the policy counts a human-only key alone. `human_only` says which key
 *  the policy asks for, so the page can name it. */
export function answerWord(cx: ReadCtx, principal: ReadPrincipal, repository: string): { answerable: boolean; why: string | null; human_only: boolean } {
  const human_only = (cx.core.policies.current(repository)?.policy.inputs.answers ?? 'git') === 'attestation';
  const no = (why: string) => ({ answerable: false, why, human_only });
  if (principal.kind === 'session') {
    // No session writes an attestation: an administrator's key is never an owner key
    // (R-BTN-57), and the owner's session — and its path onto the route — is B-76's.
    return principal.role === 'administrator'
      ? no('an administrator’s session answers no person leg: an administrator’s key is never an owner key (R-BTN-57)')
      : no('an owner session’s answer is not built (B-76)');
  }
  if (principal.role === 'admin') return no('an administrator’s key is never an owner key (R-BTN-57)');
  if (principal.role !== 'owner' || !cx.core.admin.owns(principal.cred, repository)) return no('only an owner key of the repository or a human-only key answers (R-BTN-116, R-BTN-185)');
  if (human_only) return no('the policy counts a person’s answer from a human-only key alone (inputs.answers: attestation)');
  return { answerable: true, why: null, human_only };
}

/** The queued person legs of `repository` with their questions (R-BTN-116), most severe first,
 *  each saying whether this caller may answer it. */
function questionsOf(cx: ReadCtx, principal: ReadPrincipal, repository: string) {
  const word = answerWord(cx, principal, repository);
  return cx.core.questions.needsYou()
    .filter((q) => q.ticket_id.startsWith(`${repository}:`))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0))
    .map((q) => ({ ...q, answerable: word.answerable, why: word.why, human_only: word.human_only }));
}

const inRepository = (repository: string) => (id: unknown): boolean => typeof id === 'string' && id.startsWith(`${repository}:`);

function parsed(text: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(text)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** V1's repository-scoped Needs-you listings, narrowed to `repository`: each list as its own
 *  module answers it for `stateView()` (`GET /v1/admin/state`), filtered by the row's ticket
 *  or repository. A stored JSON column is served parsed. */
function listingsOf(cx: ReadCtx, repository: string, now: number, administrator: boolean) {
  const mine = inRepository(repository);
  const here = (r: Row) => r.repository_id === repository;
  const byTicket = (r: Row) => mine(r.ticket_id);
  const claims = cx.core.claims.needsYou(now);
  const blocks = cx.core.blocks.needsYou(now);
  const notices = cx.core.notices.needsYou(now);
  const stations = cx.core.stations.needsYou();
  return {
    ...cx.core.syncNeedsYou(now, repository),
    unconfirmed: (claims.unconfirmed as Row[]).filter(byTicket),
    unacknowledged_releases: (claims.unacknowledged_releases as Row[])
      .map(({ payload_json, ...m }) => ({ ...m, payload: parsed(payload_json) }))
      .filter((m) => mine(m.payload.ticket_id)),
    fence_pending: (claims.fence_pending as Row[]).filter(byTicket),
    stale_skills: (claims.stale_skills as Row[]).filter(here),
    regressed: (claims.regressed as Row[]).filter(byTicket),
    policy: (claims.policy as Row[]).filter(byTicket),
    bars_mismatch: (claims.bars_mismatch as Row[]).filter(byTicket).map(({ detail_json, ...e }) => ({ ...e, detail: parsed(detail_json) })),
    held_items: claims.held_items.filter((h) => mine(h.ticket_id)),
    blocked_capability: (blocks.blocked_capability as Row[]).filter(byTicket),
    prerequisite_issues: cx.sql(`SELECT ticket_id, leg, ref, why,
      CASE WHEN cycle = 1 THEN 'baton.prerequisite-cycle' ELSE 'baton.prerequisite-unmet' END AS type
      FROM ticket_dependents WHERE ticket_id >= ? || ':' AND ticket_id < ? || ';'
        AND (cycle = 1 OR why IN ('no-parent', 'unknown-ticket', 'withdrawn', 'empty-selection'))
      ORDER BY ticket_id, leg, ref LIMIT 100`, repository, repository),
    pool_unclaimed: (notices.pool_unclaimed as Row[]).filter(here),
    no_owner_channel: (notices.no_owner_channel as Row[]).filter(here),
    course_changed: (stations.course_changed as Row[]).filter(byTicket),
    courses_refused: cx.core.courses.refusals().filter((r) => r.repository_id === repository),
    scope: cx.core.scope.needsYou().filter((f) => f.repository_id === repository),
    unsigned_control: cx.core.unsignedControlView(now).filter((u) => u.repository_id === repository),
    sync_lapses: cx.core.observations.needsYou(now, repository),
    sync_control_changes: cx.core.provenance.needsYou(now, repository),
    // R-BTN-28: an adoption is an administrator's to confirm, on the Sync screen.
    ...(administrator ? { adoptions: (cx.core.cutover.adoptions() as Row[]).filter(byTicket) } : {}),
  };
}

export const isAdministrator = (p: ReadPrincipal): boolean => (p.kind === 'session' ? p.role === 'administrator' : p.role === 'admin');

/** `GET …/conditions/{condition}`'s id: the table's integer. Anything else names no condition. */
function conditionId(raw: string): number {
  const id = /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id)) throw new BatonError('not-found', 'no such condition');
  return id;
}

/** The conditions list's query, as the route has always taken it (B-234), and its answer with
 *  each entry's `outcome`, `closed_at` and `resolve_url` added — additive: the order, the page
 *  and the cursor are `Conditions.list`'s own. */
export function conditionsList(cx: ReadCtx, call: ReadCall) {
  const q = call.url.searchParams;
  const open = q.get('open');
  if (open != null && open !== '1' && open !== 'true') throw new BatonError('invalid-params', 'open: 1, or nothing');
  const repository = call.repository!;
  const page = cx.core.conditions.list(repository, {
    open: open === '1' || open === 'true' || undefined,
    type: q.get('type') ?? undefined,
    ticket: q.get('ticket') ?? undefined,
    cursor: q.get('cursor') ?? undefined,
  }, call.showInteractionLinks);
  const closes = new Map(cx.sql<{ id: number; outcome: string; closed_at: number | null }>(
    'SELECT id, outcome, closed_at FROM conditions WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(page.conditions.map((c) => c.condition_id)))
    .map((r) => [r.id, r]));
  return {
    ok: true,
    conditions: page.conditions.map((c) => ({
      ...c,
      outcome: closes.get(c.condition_id)?.outcome ?? null,
      closed_at: closes.get(c.condition_id)?.closed_at ?? null,
      resolve_url: resolvePath(repository, c.condition_id),
    })),
    cursor: page.cursor,
  };
}

export const CONDITION_READS: ReadRoute[] = [
  {
    // B-195 item 1 (R-BTN-160, R-BTN-163): one condition, with the ticket's position beside it
    // and the tickets blocked on its ticket. Another repository's id is `not-found`, as none.
    action: 'condition.show',
    run(cx, call) {
      queryOf(call);
      const repository = call.repository!;
      const id = conditionId(call.params.condition);
      const row = cx.sql<ConditionRow>(`SELECT ${CONDITION_COLUMNS} FROM conditions WHERE id = ? AND repository_id = ?`, id, repository)[0];
      if (!row) throw new BatonError('not-found', 'no such condition');
      const ticket = cx.sql<{ title: string; course_id: string; station: string | null; next_leg: string | null }>(
        `SELECT t.title, t.course_id, s.station, s.next_leg FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.id = ?`, row.ticket_id)[0] ?? null;
      // What its closing would let move: the tickets with a `ticket` block on the condition's
      // ticket (`ticket_blocks`) — no block names a condition itself.
      const unblocks = row.outcome === 'open' && row.ticket_id != null ? cx.core.blocks.blockedOn(repository, { kind: 'ticket', ref: row.ticket_id }, false).tickets.map((t) => t.ticket_id) : [];
      return {
        ...conditionOf(row, call.showInteractionLinks),
        repository,
        claim_id: row.claim_id,
        ticket: ticket ? { ticket_id: row.ticket_id, title: ticket.title, course_id: ticket.course_id, station: ticket.station, next_leg: ticket.next_leg } : null,
        unblocks,
        not_built: CONDITION_NOT_BUILT,
      };
    },
  },
  {
    // B-195 item 2 / B-219 (R-BTN-163): what waits on a person in one repository, in one
    // answer — the open conditions (severity, then age), the queued person legs with whether
    // this caller may answer, and V1's listings that are not conditions yet. A person leg's
    // expiry and the listings' windows are the clock's.
    action: 'repo.needs-you',
    clock: true,
    run(cx, call) {
      queryOf(call);
      const repository = call.repository!;
      const now = cx.now();
      const conditions = cx.sql<ConditionRow>(
        `SELECT ${CONDITION_COLUMNS} FROM conditions WHERE repository_id = ? AND outcome = 'open' ORDER BY ${SEVERITY_ORDER}, raised_at, id`, repository)
        .map((r) => conditionOf(r, call.showInteractionLinks));
      return {
        repository,
        conditions,
        questions: questionsOf(cx, call.principal, repository),
        listings: listingsOf(cx, repository, now, isAdministrator(call.principal)),
        held_posts: cx.sql<{ n: number }>('SELECT COUNT(*) AS n FROM held_snapshots WHERE repository_id = ? AND accepted_at IS NULL', repository)[0].n,
        elsewhere: INSTANCE_LISTINGS,
        not_built: { ...CONDITION_NOT_BUILT, listings_as_conditions: 'B-57', session_answer: 'B-76' },
        server_time: now,
      };
    },
  },
  {
    // B-195 item 3: which repository a condition id belongs to, within the caller's own — what
    // the front's `/conditions/{id}` redirect and the shell ask. A session's read alone; an id
    // outside the session's repositories is `not-found`, the same as none, so nothing outside
    // them is revealed.
    action: 'condition.locate',
    run(cx, call) {
      queryOf(call);
      const id = conditionId(call.params.condition);
      const row = cx.sql<{ repository_id: string }>('SELECT repository_id FROM conditions WHERE id = ?', id)[0];
      if (!row || !canRead(cx, call.principal, row.repository_id)) throw new BatonError('not-found', 'no such condition');
      return { condition_id: id, repository: row.repository_id, path: resolvePath(row.repository_id, id) };
    },
  },
];
