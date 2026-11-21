// tickets.ts — a ticket's one state word and the rows the Board, Tickets and ticket screens draw
// (BATON_SPEC §11.4; B-194, B-218). `ticketState` is pure: the facts in, the word and its reasons
// out, by the one precedence. `ticketRows` reads those facts for a whole repository in a fixed
// number of queries — never one per ticket — from the rows Baton already maintains (positions
// R-BTN-39, blocks R-BTN-75, overrides R-BTN-12, claims R-BTN-10, questions R-BTN-116), and
// `ticketDetail` adds what one ticket's page draws. Filter fields only (R-BTN-33): no body, note
// or exit criterion is read. Nothing here writes, and the clock is the caller's `now`.
import type { SessionLinkView } from './links';
import { ATTEMPTS_HOLD_AT } from './attempts';
import { STALLED_MS } from './claims';
import { fileUrl, type Forge } from './links';
import type { BatonCore } from './baton';
import type { Row } from './ports';

/** §11.4's words, in precedence: the first that applies is the ticket's state. */
export const TICKET_STATES = ['unconfirmed', 'running', 'waiting-person', 'held', 'blocked', 'backing-off', 'suspended', 'ready', 'closed'] as const;
export type TicketState = (typeof TICKET_STATES)[number];

/** The Tickets screen's tabs that are not a state word of their own: `blocked` as a tab groups
 *  five words (a held ticket counts under Blocked), `closed-today` is `closed`. */
export const TICKET_TABS: Record<string, readonly TicketState[]> = {
  blocked: ['held', 'blocked', 'waiting-person', 'backing-off', 'suspended'],
  'closed-today': ['closed'],
};

/** A closed ticket is listed for this long after it closed. */
export const CLOSED_LISTED_MS = 24 * 3_600_000;

/** What decides a ticket's state. `queued` is its queued leg as the head snapshot posts it:
 *  `ready`, `waiting` (posted, not ready), `none` (an end station: no leg is queued) or
 *  `unplaced` (the snapshot places the ticket at no station). */
export interface StateFacts {
  /** A completion no later snapshot has confirmed (R-BTN-10). */
  unconfirmed: boolean;
  /** A live claim. */
  running: boolean;
  /** The queued leg is a person's (R-BTN-116). */
  person: boolean;
  /** A hold (R-BTN-12). */
  held: boolean;
  /** `blocked_since` stands (R-BTN-75). */
  blocked: boolean;
  /** A backoff not yet over (§7.4). */
  backingOff: boolean;
  queued: 'ready' | 'waiting' | 'none' | 'unplaced';
  /** The ticket left the board: a snapshot reported it closed. */
  closed: boolean;
}

/** One state word by the one precedence, and every other word that applies (§11.4). `ready` and
 *  `closed` are what is left when nothing above applies, so neither is ever a reason. A ticket
 *  nothing holds whose queued leg is posted but not ready — or that the snapshot places nowhere
 *  — rests where it is: `suspended`. A live ticket at an end station, with no leg queued, is
 *  `closed` (its source has not dropped it yet). */
export function ticketState(f: StateFacts): { state: TicketState; reasons: TicketState[] } {
  if (f.closed) return { state: 'closed', reasons: [] };
  const claimed = f.unconfirmed || f.running;
  const applies: [TicketState, boolean][] = [
    ['unconfirmed', f.unconfirmed],
    ['running', f.running],
    ['waiting-person', f.person && !claimed],
    ['held', f.held],
    ['blocked', f.blocked],
    ['backing-off', f.backingOff],
    ['suspended', !claimed && !f.person && (f.queued === 'waiting' || f.queued === 'unplaced')],
  ];
  const words = applies.filter(([, on]) => on).map(([w]) => w);
  if (words.length) return { state: words[0], reasons: words.slice(1) };
  return { state: f.queued === 'ready' ? 'ready' : 'closed', reasons: [] };
}

/** The states a `?state=` value names — a word or a tab — or null for neither. */
export function statesOf(value: string): readonly TicketState[] | null {
  if (Object.hasOwn(TICKET_TABS, value)) return TICKET_TABS[value];
  return (TICKET_STATES as readonly string[]).includes(value) ? [value as TicketState] : null;
}

export type RunnerName = { runner_id: number; hostname: string; session_name: string };

/** One ticket as `GET …/tickets` lists it. */
export interface TicketRow {
  ticket_id: string;
  /** Null for a ticket no longer on the board (closed, or dropped under a live claim). */
  title: string | null;
  course: string | null;
  tier: string | null;
  requires: string[];
  /** Of `requires`, the capabilities no live runner granted on the repository declares
   *  (`fleet_capabilities`, R-BTN-75). */
  requires_unmet: string[];
  tags: string[];
  order: string | null;
  parent: string | null;
  expedite: boolean;
  /** R-BTN-83: where the head snapshot places it; null where it places it nowhere. */
  position: { station: string; path_len: number; next_leg: string | null } | null;
  state: TicketState;
  reasons: TicketState[];
  /** The state's own detail (see §14's row). */
  detail: Record<string, unknown>;
  /** A `ready` ticket on the page: the live runners that pass the gates for its queued leg. */
  eligible_runners?: RunnerName[];
  /** With an empty `eligible_runners`: the gate's rule word (§6.6); null otherwise. */
  failed_rule?: string | null;
}

/** What the rows are read through: one SQL helper, the clock and the core's modules. */
export type TicketsCtx = { core: BatonCore; sql<T = Row>(query: string, ...params: unknown[]): T[]; now(): number };

const list = (json: unknown): string[] => {
  try {
    const v = typeof json === 'string' ? (JSON.parse(json) as unknown) : json;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

type Held = {
  id: number; ticket_id: string; runner_id: number; status: string; claimed_at: number; ended_at: number | null; hostname: string; session_name: string;
  kind: string; last_seen_at: number; last_activity_at: number | null; lease_timeout_ms: number; leg: string | null; session_url: string | null;
};

/** Every row of the repository, in the list's order: the ready ones in Baton's matching order
 *  (R-BTN-61 — the board read's own `ORDER BY`), then the others by state precedence and id,
 *  the tickets closed in the last 24 hours last. No `eligible_runners` yet: `withEligible` adds
 *  them to the rows a page serves. */
export function ticketRows(cx: TicketsCtx, repo: string, sessionLink?: SessionLinkView): TicketRow[] {
  const now = cx.now();
  const lo = `${repo}:`;
  const hi = `${repo};`;
  const tickets = cx.sql<{
    id: string; title: string; course_id: string; tier: string | null; tags: string; ord: string | null; parent: string | null; expedite: number; blocked_since: number | null;
    station: string | null; path_len: number | null; next_leg: string | null; leg_state: string | null; waiting_on: string | null;
    hold: number | null; hold_reason: string | null; retry_after: number | null; set_by: string | null; set_at: number | null; o_expedite: number | null;
  }>(
    `SELECT t.id, t.title, t.course_id, t.tier, t.tags, t.ord, t.parent, t.expedite, t.blocked_since,
            s.station, s.path_len, s.next_leg, a.state AS leg_state, a.waiting_on,
            o.hold, o.hold_reason, o.retry_after, o.set_by, o.set_at, o.expedite AS o_expedite
     FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id
     LEFT JOIN ticket_next_legs a ON a.ticket_id = t.id AND a.leg = s.next_leg
     LEFT JOIN ticket_overrides o ON o.ticket_id = t.id
     WHERE t.repository_id = ? ORDER BY t.expedite DESC, s.to_end, t.rank IS NULL, t.rank, t.id`, repo);
  const requires = new Map<string, string[]>();
  for (const r of cx.sql<{ ticket_id: string; name: string }>(
    'SELECT ticket_id, name FROM ticket_requires WHERE ticket_id >= ? AND ticket_id < ? ORDER BY ticket_id, name', lo, hi)) {
    const l = requires.get(r.ticket_id);
    if (l) l.push(r.name);
    else requires.set(r.ticket_id, [r.name]);
  }
  const held = new Set(cx.sql<{ capability: string }>('SELECT capability FROM fleet_capabilities WHERE repository_id = ? AND runners > 0', repo).map((r) => r.capability));
  const claims = new Map<string, { active?: Held; unconfirmed?: Held }>();
  for (const c of cx.sql<Held>(
    `SELECT c.id, c.ticket_id, c.runner_id, c.status, c.claimed_at, c.ended_at, w.hostname, w.session_name, w.kind, w.last_seen_at, w.last_activity_at, w.lease_timeout_ms,
            COALESCE(l.leg, c.offered_leg) AS leg, ${sessionLink ? 'l.session_url' : 'NULL'} AS session_url
     FROM claims c JOIN runners w ON w.id = c.runner_id
     LEFT JOIN claim_legs l ON l.claim_id = c.id AND l.seq = (SELECT MAX(seq) FROM claim_legs
       WHERE claim_id = c.id AND finished_at IS NULL AND abandoned_at IS NULL)
     WHERE (c.status = 'active' OR (c.status = 'completed' AND c.confirmed_at IS NULL)) AND c.ticket_id >= ? AND c.ticket_id < ? ORDER BY c.id`, lo, hi)) {
    const e = claims.get(c.ticket_id) ?? {};
    if (c.status === 'active') e.active = c;
    else e.unconfirmed = c;
    claims.set(c.ticket_id, e);
  }
  // The condition a live claim's leg waits on: its oldest open one that is more than a notice.
  const waits = new Map<number, number>();
  for (const c of cx.sql<{ id: number; claim_id: number }>(
    `SELECT id, claim_id FROM conditions WHERE repository_id = ? AND outcome = 'open' AND disposition != 'notify' ORDER BY id DESC`, repo)) waits.set(c.claim_id, c.id);
  const blocks = new Map<string, { kind: string; ref: string; since: number }>();
  for (const b of cx.sql<{ ticket_id: string; kind: string; ref: string; since: number }>(
    'SELECT ticket_id, kind, ref, since FROM ticket_blocks WHERE repository_id = ? ORDER BY ticket_id, since DESC, kind DESC, ref DESC', repo)) blocks.set(b.ticket_id, { kind: b.kind, ref: b.ref, since: b.since });
  const questions = new Map(cx.sql<{ ticket_id: string; question_id: string | null; leg: string }>(
    'SELECT ticket_id, question_id, leg FROM ticket_questions WHERE ticket_id >= ? AND ticket_id < ? AND answered_at IS NULL', lo, hi).map((q) => [q.ticket_id, q]));
  const person = new Map<string, boolean>();
  const isPerson = (course: string, leg: string | null): boolean => {
    if (!leg) return false;
    const key = `${course}\u0000${leg}`;
    let p = person.get(key);
    if (p === undefined) {
      p = !!cx.core.stations.graph(repo, course)?.legs.get(leg)?.person;
      person.set(key, p);
    }
    return p;
  };
  const retryMax = cx.core.admin.retry(repo)?.max_failed ?? ATTEMPTS_HOLD_AT;

  const running = (c: Held) => {
    const alive = c.kind !== 'legacy' && now - c.last_seen_at < c.lease_timeout_ms;
    return {
      claim_id: c.id, runner_id: c.runner_id, hostname: c.hostname, session_name: c.session_name, leg: c.leg, since: c.claimed_at,
      ...sessionLink?.(c.session_url, c.runner_id),
      lease_ends_at: c.kind === 'legacy' ? null : c.last_seen_at + c.lease_timeout_ms,
      last_activity_at: c.last_activity_at, alive,
      // §11.4: alive, and no activity for 2 hours (the claim's own age where none was reported).
      stalled: alive && now - (c.last_activity_at ?? c.claimed_at) > STALLED_MS,
      condition_wait: waits.get(c.id) ?? null,
    };
  };
  const unconfirmed = (c: Held) => ({ claim_id: c.id, reported_at: c.ended_at, runner_id: c.runner_id, hostname: c.hostname });

  const rows: TicketRow[] = [];
  const seen = new Set<string>();
  for (const t of tickets) {
    seen.add(t.id);
    const c = claims.get(t.id) ?? {};
    const facts: StateFacts = {
      unconfirmed: !!c.unconfirmed, running: !!c.active, person: isPerson(t.course_id, t.next_leg), held: !!t.hold, blocked: t.blocked_since != null,
      backingOff: t.retry_after != null && t.retry_after > now,
      queued: t.station == null ? 'unplaced' : t.next_leg == null ? 'none' : t.leg_state === 'ready' ? 'ready' : 'waiting',
      closed: false,
    };
    const { state, reasons } = ticketState(facts);
    const block = blocks.get(t.id);
    const question = questions.get(t.id);
    const detail: Record<string, unknown> =
      state === 'unconfirmed' ? unconfirmed(c.unconfirmed!)
      : state === 'running' ? running(c.active!)
      : state === 'waiting-person' ? { leg: t.next_leg, question_id: question && question.leg === t.next_leg ? question.question_id : null }
      : state === 'held' ? { set_by: t.set_by, reason: t.hold_reason, since: t.set_at }
      : state === 'blocked' ? { kind: block?.kind ?? null, ref: block?.ref ?? null, since: block?.since ?? t.blocked_since }
      : state === 'backing-off' ? { attempt: cx.core.claims.failedAttempts(t.id).length, max_runs: retryMax, until: t.retry_after }
      : state === 'suspended' ? { station: t.station, waits_for: t.waiting_on }
      : state === 'closed' ? { at: null, end: t.station }
      : {};
    const req = requires.get(t.id) ?? [];
    rows.push({
      ticket_id: t.id, title: t.title, course: t.course_id, tier: t.tier, requires: req, requires_unmet: req.filter((r) => !held.has(r)),
      tags: list(t.tags), order: t.ord, parent: t.parent, expedite: !!t.expedite || !!t.o_expedite,
      position: t.station == null ? null : { station: t.station, path_len: t.path_len ?? 0, next_leg: t.next_leg },
      state, reasons, detail,
    });
  }
  // A claim on a ticket git has dropped stays (R-BTN-35): its row is the claim alone.
  for (const [id, c] of claims) {
    if (seen.has(id)) continue;
    seen.add(id);
    const state: TicketState = c.unconfirmed ? 'unconfirmed' : 'running';
    rows.push({
      ticket_id: id, title: null, course: null, tier: null, requires: [], requires_unmet: [], tags: [], order: null, parent: null, expedite: false, position: null,
      state, reasons: c.unconfirmed && c.active ? ['running'] : [], detail: c.unconfirmed ? unconfirmed(c.unconfirmed) : running(c.active!),
    });
  }
  const rank = (s: TicketState) => TICKET_STATES.indexOf(s);
  const ready = rows.filter((r) => r.state === 'ready');
  const rest = rows.filter((r) => r.state !== 'ready').sort((a, b) => rank(a.state) - rank(b.state) || (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0));
  const closed: TicketRow[] = cx.sql<{ ticket_id: string; closed_as: string; closed_at: number; parent: string | null }>(
    'SELECT ticket_id, closed_as, closed_at, parent FROM closed_tickets WHERE ticket_id >= ? AND ticket_id < ? AND closed_at > ? ORDER BY closed_at DESC, ticket_id', lo, hi, now - CLOSED_LISTED_MS)
    .filter((c) => !seen.has(c.ticket_id))
    .map((c) => ({
      ticket_id: c.ticket_id, title: null, course: null, tier: null, requires: [], requires_unmet: [], tags: [], order: null, parent: c.parent, expedite: false, position: null,
      state: 'closed' as const, reasons: [], detail: { at: c.closed_at, end: c.closed_as },
    }));
  return [...ready, ...rest, ...closed];
}

/** `counts`: how many of the repository's rows stand under each state word, and `total`. */
export function countStates(rows: readonly TicketRow[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(TICKET_STATES.map((s) => [s, 0]));
  for (const r of rows) counts[r.state]++;
  counts.total = rows.length;
  return counts;
}

/** The live runners a ready ticket may be offered to — not reaped, their lease standing, their
 *  key in force — by name (R-BTN-3). */
export function liveRunners(cx: TicketsCtx): RunnerName[] {
  return cx.sql<RunnerName>(
    `SELECT w.id AS runner_id, w.hostname, w.session_name FROM runners w JOIN credentials c ON c.id = w.credential_id
     WHERE w.reaped_at IS NULL AND w.kind != 'legacy' AND w.last_seen_at + w.lease_timeout_ms > ? AND c.revoked_at IS NULL ORDER BY w.hostname, w.session_name, w.id`, cx.now());
}

/** The rows given, each `ready` one with its eligible live runners by name — the claim gates
 *  themselves, asked for the queued leg (§6.6) — and, where none passes, the rule word. */
export function withEligible(cx: TicketsCtx, rows: readonly TicketRow[]): TicketRow[] {
  const ready = rows.filter((r) => r.state === 'ready').map((r) => r.ticket_id);
  if (!ready.length) return [...rows];
  const runners = liveRunners(cx);
  const byId = new Map(runners.map((w) => [w.runner_id, w]));
  const verdicts = cx.core.claims.eligibility(ready, runners.map((w) => w.runner_id));
  return rows.map((r) => {
    const v = verdicts.get(r.ticket_id);
    return v ? { ...r, eligible_runners: v.eligible.map((id) => byId.get(id)!), failed_rule: v.failed_rule } : r;
  });
}

/** What a ticket's page draws beyond its list row (B-218): the live claim, the earlier failed
 *  attempts, the overrides, the open conditions and scope findings, a pending fence, the resume
 *  record and the forge link. `repo` is the ticket's own, already checked. */
export function ticketDetail(cx: TicketsCtx, repo: string, id: string, path: string | null, sessionLink: SessionLinkView) {
  const now = cx.now();
  const retryMax = cx.core.admin.retry(repo)?.max_failed ?? ATTEMPTS_HOLD_AT;
  const failed = cx.core.claims.failedAttempts(id);
  const override = cx.sql<{ expedite: number; hold: number; hold_reason: string | null; retry_after: number | null; set_by: string | null; set_at: number | null }>(
    'SELECT expedite, hold, hold_reason, retry_after, set_by, set_at FROM ticket_overrides WHERE ticket_id = ?', id)[0] ?? null;
  const live = cx.sql<{
    id: number; runner_id: number; claimed_at: number; deadline_at: number | null; hostname: string; session_name: string; kind: string; last_seen_at: number;
    last_activity_at: number | null; lease_timeout_ms: number; offered_leg: string | null;
  }>(
    `SELECT c.id, c.runner_id, c.claimed_at, c.deadline_at, c.offered_leg, w.hostname, w.session_name, w.kind, w.last_seen_at, w.last_activity_at, w.lease_timeout_ms
     FROM claims c JOIN runners w ON w.id = c.runner_id WHERE c.ticket_id = ? AND c.status = 'active'`, id)[0] ?? null;
  const leg = live ? cx.sql<{ leg: string; run_id: string | null; session_url: string | null; leg_log_dir: string | null; started_at: number }>(
    `SELECT leg, run_id, session_url, leg_log_dir, started_at FROM claim_legs WHERE claim_id = ? AND finished_at IS NULL AND abandoned_at IS NULL ORDER BY seq DESC LIMIT 1`, live.id)[0] ?? null : null;
  const alive = !!live && live.kind !== 'legacy' && now - live.last_seen_at < live.lease_timeout_ms;
  const claim = live ? {
    claim_id: live.id, runner_id: live.runner_id, hostname: live.hostname, session_name: live.session_name,
    // The leg it runs; before its first advance, the leg it was offered.
    leg: leg?.leg ?? live.offered_leg ?? null, run_id: leg?.run_id ?? null, leg_started_at: leg?.started_at ?? null, claimed_at: live.claimed_at,
    lease_ends_at: live.kind === 'legacy' ? null : live.last_seen_at + live.lease_timeout_ms, deadline_at: live.deadline_at,
    // §7.4: the attempt this claim is, against the failed attempts that hold the ticket.
    attempt: failed.length + 1, max_runs: retryMax, next_backoff_until: override?.retry_after ?? null,
    // R-BTN-113: stored only where the session-host rule passed it; R-BTN-128: a directory, as text.
    ...sessionLink(leg?.session_url ?? null, live.runner_id), log_dir: leg?.leg_log_dir ?? null,
    last_activity_at: live.last_activity_at, alive, stalled: alive && now - (live.last_activity_at ?? live.claimed_at) > STALLED_MS,
  } : null;
  const attempts = cx.sql<{ id: number; runner_id: number; hostname: string; claimed_at: number; ended_at: number | null; end_reason: string | null; end_detail: string | null }>(
    `SELECT c.id, c.runner_id, w.hostname, c.claimed_at, c.ended_at, c.end_reason, c.end_detail FROM claims c JOIN runners w ON w.id = c.runner_id
     WHERE c.id IN (SELECT value FROM json_each(?)) ORDER BY c.id`, JSON.stringify(failed))
    .map((a, i) => ({ run: i + 1, claim_id: a.id, runner_id: a.runner_id, hostname: a.hostname, started_at: a.claimed_at, ended_at: a.ended_at, end_reason: a.end_reason, detail: a.end_detail }));
  const conditions = cx.sql<{ id: number; type: string; severity: string; leg: string; restarts_json: string }>(
    `SELECT id, type, severity, leg, restarts_json FROM conditions WHERE ticket_id = ? AND outcome = 'open' ORDER BY id`, id)
    .map((c) => {
      let restarts: string[] = [];
      try {
        restarts = Object.keys(JSON.parse(c.restarts_json) as Record<string, unknown>);
      } catch { /* an unreadable list is no list */ }
      return { condition_id: c.id, type: c.type, severity: c.severity, leg: c.leg, restarts };
    });
  const scope = cx.sql<{ id: number; kind: string; target: string; detail_json: string; raised_at: number }>(
    'SELECT id, kind, target, detail_json, raised_at FROM scope_findings WHERE ticket_id = ? AND resolved_at IS NULL ORDER BY id', id)
    .map((f) => {
      let ref: string | null = null;
      try {
        const d = JSON.parse(f.detail_json) as { ref?: unknown };
        if (typeof d.ref === 'string') ref = d.ref;
      } catch { /* stored by Scope from a checked report: never malformed */ }
      return { id: f.id, kind: f.kind, target: f.target, ref, at: f.raised_at };
    });
  const fenced = cx.sql<{ id: number; runner_id: number; hostname: string; ended_at: number | null }>(
    `SELECT c.id, c.runner_id, w.hostname, c.ended_at FROM claims c JOIN runners w ON w.id = c.runner_id
     WHERE c.ticket_id = ? AND c.status = 'reaped' AND c.fence_pending = 1 ORDER BY c.id DESC LIMIT 1`, id)[0] ?? null;
  const registered = cx.core.registry.get(repo);
  return {
    claim,
    attempts,
    overrides: {
      expedite: !!override?.expedite,
      hold: override?.hold ? { set_by: override.set_by, reason: override.hold_reason, since: override.set_at } : null,
    },
    conditions,
    scope,
    /** R-BTN-19: a reaped claim whose fence is still pending — what `claim.fence-clear` clears. */
    fence: fenced ? { claim_id: fenced.id, runner_id: fenced.runner_id, hostname: fenced.hostname, since: fenced.ended_at } : null,
    resume: cx.core.claims.resumeOf(id),
    // R-BTN-92: the ticket's file on its forge, built from `web_base` alone; null for `git`.
    web_url: registered && path ? fileUrl(registered.forge as Forge, registered.web_base, registered.default_branch, path) : null,
  };
}
