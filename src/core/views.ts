// views.ts — the dashboard and terminal read models, shared by their entity reads.
import type { BatonCore } from './baton';
import { headOf } from './sync';
import { fileUrl, hiddenSessionLink } from './links';
import { briefMark, writtenBy } from './provenance';
import type { Repository } from './registry';
import type { SqlValue } from './ports';

type StateViewCore = Pick<BatonCore, 'sql' | 'now' | 'capacityFigures' | 'registry' | 'courses' | 'queues'
  | 'runners' | 'claims' | 'admin' | 'instance' | 'blocks' | 'notices' | 'stations' | 'cutover' | 'capacity'
  | 'scope' | 'questions' | 'conditions' | 'history' | 'resources' | 'observations' | 'provenance' | 'syncNeedsYou'>;

/** Needs you: a BATON_KEYS list that was refused, or that names a revoked key (R3-1239). */
export function keysNotice(core: Pick<BatonCore, 'sql'>): { refused?: string; revoked_listed?: string[] } | null {
  const raw = core.sql<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'keys_notice'`)[0]?.value;
  return raw ? JSON.parse(raw) : null;
}


/** §14 Needs you, B-127: the unsigned control changes of the last 7 days, newest first, of
 *  repositories that require their control inputs signed — by `at`, then `seq`, the order
 *  `events_by_kind_at` reads in (B-235), so the window reads only its rows. */
export function unsignedControlView(core: Pick<BatonCore, 'sql'>, now: number) {
  return core.sql<{ repository_id: string; at: number; detail_json: string }>(
    `SELECT repository_id, at, detail_json FROM events WHERE kind = 'unsigned-control' AND at > ? ORDER BY at DESC, seq DESC LIMIT 100`, now - 7 * 86_400_000)
    .map((row) => {
      let detail: Record<string, unknown> = {};
      try {
        detail = JSON.parse(row.detail_json) as Record<string, unknown>;
      } catch {
        detail = {};
      }
      return { repository_id: row.repository_id, at: row.at, ...detail };
    });
}

// ── the dashboard's state (§14: Ready and Providers in rollout step 1) ─────────────────

/** One registered repository as the state lists it (B-90: `baton board` reads the same):
 *  its own head and its own mode (R-BTN-47, R-BTN-28), and its courses with their queues. */
function uiRepo(core: Pick<BatonCore, 'sql' | 'courses' | 'queues' | 'runners'>, repo: Repository) {
  const sha = headOf(core, repo.id);
  const head = sha ? core.sql('SELECT sha, parent_sha, received_at, ticket_count FROM board_snapshots WHERE repository_id = ? AND sha = ?', repo.id, sha)[0] ?? null : null;
  const courses = core.courses.all().filter((c) => c.repository_id === repo.id).map(({ id, version, min_runner_version, skill }) => ({ id, version, min_runner_version, skill,
      // R-BTN-79: the course's intake and each of its queues, for the Courses view.
      intake: core.queues.intake(repo.id, id), queues: core.queues.legs(repo.id, id).map(({ leg, depth, max_queue }) => ({ leg, depth, max_queue })) }));
  return { id: repo.id, github: repo.github, forge: repo.forge, web_base: repo.web_base, default_branch: repo.default_branch, weight: repo.weight, head, mode: core.runners.mode(repo.id), courses };
}

/** `GET /v1/admin/repositories` (B-90, R-BTN-179): the registry as the dashboard's state lists
 *  it — one section of `stateView`'s answer, built by the same `uiRepo` it maps over. */
export function adminView(core: Pick<BatonCore, 'registry' | 'sql' | 'courses' | 'queues' | 'runners'>) {
  return { repositories: core.registry.all().map((repo) => uiRepo(core, repo)) };
}

/** `GET /v1/owner/{repository}/grants` (R-BTN-146, B-90): the repository's owner keys, the
 *  grants on it, and its owners' settings — the dashboard's state's own reads, for its owners. */
export function grantsView(core: Pick<BatonCore, 'admin' | 'now'>, repo: string) {
  // The same four sections `stateView().limits` serves, over one repository: owners, grants
  // settings and the bars in force.
  const limits = core.admin.view(core.now());
  return {
    repository: repo,
    owners: limits.owners.filter((o) => o.repository_id === repo),
    // R-BTN-58: a key granted here may be granted elsewhere too, and its holder decides once
    // for all of them — so each row also names the other repositories that key holds
    // (`other_repositories`, revoked grants excluded).
    grants: limits.grants.filter((g) => g.repository_id === repo).map((g) => ({
      credential_id: g.credential_id, hostname: g.hostname, label: g.label, repository_id: g.repository_id,
      capabilities: g.capabilities, max_claims: g.max_claims, granted_by: g.granted_by, granted_at: g.granted_at,
      deliver_interactions: g.deliver_interactions,
      other_repositories: limits.grants.filter((o) => o.credential_id === g.credential_id && o.repository_id !== repo).map((o) => o.repository_id).sort(),
    })),
    settings: limits.settings.find((s) => s.repository_id === repo) ?? null,
    // R-BTN-67: the bars in force and scheduled, always carrying their repository's id.
    bars: limits.bars.filter((b) => (b as { repository_id: string }).repository_id === repo),
    server_time: core.now(),
  };
}

/** `GET /v1/repositories/{repository}/board` (B-90): the dashboard's view of one repository —
 *  the repository as the state lists it, its `ready` tickets,
 *  derived by the same `readyRows` it derives them with, for one repository — and one field the
 *  dashboard does not have. `granted_capabilities` is the key's grant's capabilities — the
 *  heartbeat answer's field — so a granted runner knows its grant from the read alone; null
 *  for a key no grant binds and for an owner's or an administrator's key. `holders` (B-129) is
 *  the repository's live claims with each holder and its lease's end — the lock a session
 *  claiming through git reads with the same request (R-BTN-179's one-answer rule). */
export function boardView(core: Pick<BatonCore, 'now' | 'registry' | 'sql' | 'courses' | 'queues' | 'runners' | 'claims'>, repo: string, granted: string[] | null = null, sessionLink = hiddenSessionLink) {
  const now = core.now();
  const repository = uiRepo(core, core.registry.get(repo)!);
  const ready = readyRows(core, [repository], repo);
  return {
    repository,
    ready,
    holders: core.claims.holdersOf(repo, sessionLink),
    granted_capabilities: granted,
    server_time: now,
  };
}

/** Ready: a ticket whose queued leg its sync posts ready (R-BTN-70), the interim post's
 *  included — it places each ready item at its course's start (round 2, 2-A-4). For one
 *  repository when `repository_id` is given (B-90's board), every one otherwise. */
function readyRows(core: Pick<BatonCore, 'sql'>, repositories: ReturnType<typeof uiRepo>[], repository_id?: string) {
  const byId = new Map(repositories.map((r) => [r.id, r]));
  const items = core.sql<Record<string, SqlValue>>(
    `SELECT t.id, t.repository_id, t.local_id, t.path, t.title, t.project, t.status, t.node, t.queue, t.tags, t.requires_clause, t.operator_only, t.ord, t.rank,
            t.expedite, t.snapshot_sha, t.last_written_by, t.brief, s.station, s.next_leg, s.to_end
     FROM tickets t JOIN repositories p ON p.id = t.repository_id
     JOIN ticket_stations s ON s.ticket_id = t.id
     JOIN ticket_next_legs a ON a.ticket_id = t.id AND a.leg = s.next_leg AND a.state = 'ready'
     WHERE p.retired_at IS NULL${repository_id ? ' AND t.repository_id = ?' : ''} ORDER BY p.weight DESC, t.expedite DESC, s.to_end, t.rank IS NULL, t.rank, t.repository_id, t.id`,
    ...(repository_id ? [repository_id] : []));
  const requires = new Map<string, string[]>();
  for (const r of core.sql<{ ticket_id: string; name: string }>('SELECT ticket_id, name FROM ticket_requires WHERE ticket_id IN (SELECT value FROM json_each(?)) ORDER BY name', JSON.stringify(items.map((t) => t.id)))) {
    requires.set(r.ticket_id, [...(requires.get(r.ticket_id) ?? []), r.name]);
  }
  return items.map((r) => ({
    id: r.id,
    repository_id: r.repository_id,
    local_id: r.local_id,
    title: r.title,
    url: ((w) => fileUrl(w.forge, w.web_base, w.default_branch, r.path as string))(byId.get(r.repository_id as string)!),
    project: r.project,
    // The commit that last changed the ticket's row.
    changed_in: r.snapshot_sha,
    // B-126 (R-BTN-194): the pusher of the commit that last changed the ticket's file, and
    // B-127's brief mark (signed, and by whom), so a privileged session can see whose words
    // steer it before it reads them.
    ...((w) => (w ? { last_written_by: w } : {}))(writtenBy(r.last_written_by)),
    ...((b) => (b ? { brief: b } : {}))(briefMark(r.brief)),
    queue: r.queue,
    node: r.node,
    rank: r.rank,
    station: r.station,
    leg: r.next_leg,
    rank_reason: r.node ? (r.node === 'ready-expedite' ? 'expedite lane' : `${r.queue} queue · order ${r.ord ?? '—'}`)
      : `${r.expedite ? 'expedite lane · ' : ''}${r.next_leg} from ${r.station} · rank ${r.rank ?? '—'}`,
    requires_clause: r.requires_clause,
    requires: requires.get(r.id as string) ?? [],
    operator_only: r.operator_only === 1,
  }));
}

/** `GET /v1/admin/state` (R-BTN-57, R-BTN-179; B-118, B-216's Decision 4a): the state in one
 *  request for a terminal, an administrator's key's alone — built by the functions the entity
 *  reads use (`readyRows`, `claims.running`, `runners.runnersView`, `history.view`, the
 *  modules' `needsYou`), so the two cannot drift (S-BTN-170). The dashboard session's own
 *  `GET` of this answer is retired (B-203): a session reads the entity reads. */
export function stateView(core: StateViewCore) {
  const now = core.now();
  // R3-1258 (R-BTN-87): the envelope's figures read ONCE for the whole answer — Needs you's
  // `capacity` listing and the Capacity view share them (B-240's statement budget).
  const figures = core.capacityFigures();
  // Each registered repository: its own head and its own mode (R-BTN-47, R-BTN-28).
  const repositories = adminView(core).repositories;
  const ready = readyRows(core, repositories);
  // The Runners view, read once for both the rows it serves and Needs you's stale clients
  // (R-BTN-197, B-254) — one read, B-240's statement budget kept.
  const runners = core.runners.runnersView(now);

  const held = core.sql(
    `SELECT repository_id, sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at FROM held_snapshots
     WHERE accepted_at IS NULL ORDER BY received_at`);
  // B-142: `providers` and `suspensions` served here no more — the model tables they read are
  // gone; an unavailable provider is a reading (§6.3, R-BTN-76) and a peak preference a rule
  // in the course (§6.10), never a dashboard row.
  return {
    server_time: now, repositories, ready, held, runners,
    running: core.claims.running(now), timeline: core.claims.timeline(now),
    // R-BTN-66: owners, grants, owner bars and settings — read-only; the CLI changes them.
    limits: core.admin.view(now),
    // B-4 (§11.4's tenant settings, R-BTN-113): the instance settings — `session_hosts` the
    // client's link gate checks against (§12.3).
    instance: core.instance.view(),
    // R-BTN-69: a refused course file, the previous one staying in force.
    needs_you: { ...core.syncNeedsYou(now), ...core.claims.needsYou(now), ...core.blocks.needsYou(now), ...core.notices.needsYou(now), ...core.stations.needsYou(), adoptions: core.cutover.adoptions(), courses_refused: core.courses.refusals(), keys: keysNotice(core),
      // R-BTN-87 (R3-1258): the figures over 80% of the envelope — `baton.capacity` through
      // today's path, until B-57 converts it to a condition.
      ...core.capacity.needsYou(figures),
      // R-BTN-197 (B-254): each live runner whose own version statement is below the
      // recommended client, with its version — update it at your own pace; nothing self-updates.
      stale_clients: core.runners.staleClients(runners, core.instance.recommendedClient()),
      // B-134: the open scope findings — a leg reported outside its ticket's scope, a runner
      // push no open claim covers — until an owner resolves each.
      scope: core.scope.needsYou(),
      // B-133: the person legs' questions with each option's computed action (R-BTN-116).
      questions: core.questions.needsYou(),
      // B-234 (R-BTN-163, R-BTN-195): the open conditions, an `interact` with the session
      // link Baton set — a person asked into the leg's session.
      conditions: core.conditions.needsYou(),
      sync_lapses: core.observations.needsYou(now),
      sync_control_changes: core.provenance.needsYou(now),
      // B-127: the unsigned control changes a post moved the head onto while signed control is required.
      unsigned_control: unsignedControlView(core, now) },
    // R-BTN-75, R-BTN-76: each blocked ticket with its blocks, and the instances' states.
    blocked: core.blocks.view(),
    // R-BTN-85: the disagreements with git of the last 7 days, by kind.
    discrepancies: core.history.view(now),
    resources: core.resources.view(now),
    // R-BTN-87 (§2.3, R3-1258): the Capacity view — every figure against the envelope, and
    // the day's usage against the plan's limits (R-BTN-2).
    capacity: core.capacity.view(figures),
  };
}
