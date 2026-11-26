// reads/tickets.ts — the tickets list and the ticket's own read (B-194, B-218; BATON_SPEC §11.4,
// §14): `GET …/tickets` (`repo.tickets`), every live ticket under its one state word with the
// state's detail, in Baton's order, filtered and paged; and `GET …/tickets/{ticket}`
// (`ticket.show`), the read B-126 built — every field it served kept as it was (R-BTN-179: the
// CLI reads them) — extended with the ticket's list row and what its page draws. The rows are
// src/core/tickets.ts's; this module is the query, the page and the caller's `allowed`.
import { BatonError } from '../http';
import { fitsTier } from '../../shared/vocabulary.mjs';
import { qualify, repositoryOf, TICKET_ID } from '../validate';
import { sessionCaller, ACTIONS } from '../actions';
import { countStates, statesOf, ticketDetail, ticketRows, withEligible, TICKET_STATES, TICKET_TABS, type TicketRow } from '../tickets';
import { cursorOf, pageOf, queryOf, PAGE_DEFAULT, type ReadCall, type ReadCtx, type ReadPrincipal, type ReadRoute } from './kit';

/** `?q=` is matched, never interpreted: a bounded substring of an id or a title. */
const Q_MAX = 200;

/** `GET …/tickets`' answer. */
export type TicketsAnswer = {
  tickets: TicketRow[];
  next_cursor?: string;
  /** Per state word and `total`, over the whole repository — the filters do not move them. */
  counts: Record<string, number>;
  /** The rows the filters leave, across every page. */
  matched: number;
  server_time: number;
};

function ticketsAnswer(cx: ReadCtx, call: ReadCall): TicketsAnswer {
  const repo = call.repository!;
  const q = queryOf(call);
  const states = q.state == null ? null : statesOf(q.state);
  if (q.state != null && !states) throw new BatonError('invalid-params', `state: one of ${[...TICKET_STATES, ...Object.keys(TICKET_TABS).filter((t) => !(TICKET_STATES as readonly string[]).includes(t))].join(', ')}`);
  const ladder = cx.core.registry.get(repo)?.tiers ?? [];
  if (q.tier != null && !ladder.includes(q.tier)) throw new BatonError('invalid-params', `tier: one of ${ladder.join(', ')}`);
  if (q.q != null && (q.q.length === 0 || q.q.length > Q_MAX)) throw new BatonError('invalid-params', `q: 1 to ${Q_MAX} characters`);
  const after = cursorOf<{ id: string; n: number }>(cx, call);
  if (after != null && !(typeof after === 'object' && typeof after.id === 'string' && Number.isInteger(after.n))) throw new BatonError('invalid-params', 'cursor: not a cursor of this read');

  const all = ticketRows(cx, repo, call.sessionLink);
  const needle = q.q?.toLowerCase() ?? null;
  const matched = all.filter((r) =>
    (!states || states.includes(r.state))
    && (needle == null || r.ticket_id.toLowerCase().includes(needle) || (r.title ?? '').toLowerCase().includes(needle))
    // A ceiling, as `ready_by_tier` reads it; a row with no ticket behind it (closed, dropped) fits none.
    && (q.tier == null || (r.title != null && fitsTier(r.tier, q.tier, ladder))));
  // The page after the cursor's row — by its id where it still stands, else by its ordinal, so
  // a list that moved between two pages neither repeats a page nor ends early.
  let from = 0;
  if (after) {
    const at = matched.findIndex((r) => r.ticket_id === after.id);
    from = at >= 0 ? at + 1 : Math.min(after.n, matched.length);
  }
  const window = matched.slice(from, from + PAGE_DEFAULT + 1).map((r, i) => ({ r, n: from + i + 1 }));
  const p = pageOf(cx, call, window, (last) => ({ id: last.r.ticket_id, n: last.n }));
  return {
    tickets: withEligible(cx, p.items.map((x) => x.r)),
    ...(p.next_cursor ? { next_cursor: p.next_cursor } : {}),
    counts: countStates(all),
    matched: matched.length,
    server_time: cx.now(),
  };
}

/** B-218's `allowed`: the target-dependent actions the caller may take on this ticket — today
 *  `ticket.unhold` on a held one. An administrator's session lifts any hold (the route it calls
 *  admits it); an owner's session does where its key is an approver on `approvers.policy`
 *  (R-BTN-186) or set the hold itself; a key has no dashboard route, so nothing is listed for
 *  one. A drawing hint: the call is authorized again when it is made. */
export function allowedOn(cx: ReadCtx, principal: ReadPrincipal, repo: string, hold: { set_by: string | null } | null): string[] {
  if (!hold || principal.kind !== 'session') return [];
  const unhold = ACTIONS.find((a) => a.id === 'ticket.unhold');
  if (!unhold || !sessionCaller(unhold, principal.role)) return [];
  if (principal.role === 'administrator') return ['ticket.unhold'];
  if (hold.set_by === `owner:${principal.id}`) return ['ticket.unhold'];
  const policy = cx.core.policies.current(repo)?.policy;
  if (!policy) return [];
  return cx.core.policies.entryMatches(policy.approvers.policy, principal.id, cx.core.policies.facts(repo), policy.human_key) ? ['ticket.unhold'] : [];
}

function ticketAnswer(cx: ReadCtx, call: ReadCall) {
  const repo = call.repository!;
  queryOf(call);
  const raw = call.params.ticket;
  const id = raw.includes(':') ? raw : qualify(repo, raw);
  if (!TICKET_ID.test(id) || repositoryOf(id) !== repo) throw new BatonError('invalid-params', `ticket: must be a ticket of ${repo}`);
  // B-126's answer, as it was: a ticket not on the board is `not-found`, the same as none.
  const shown = cx.core.claims.ticketView(id);
  if (!shown) throw new BatonError('not-found', `${id} is not on the board`);
  const row = withEligible(cx, ticketRows(cx, repo).filter((r) => r.ticket_id === id))[0];
  const detail = ticketDetail(cx, repo, id, typeof shown.path === 'string' ? shown.path : null, call.sessionLink);
  const station = cx.sql<{ next_source: string }>('SELECT next_source FROM ticket_stations WHERE ticket_id = ?', id)[0];
  return {
    ...shown,
    ...(row ? {
      course: row.course, tags: row.tags, order: row.order, requires_unmet: row.requires_unmet,
      // R-BTN-83: the position with where its queued leg came from (course, marker, holder, …).
      position: row.position ? { ...row.position, next_source: station?.next_source ?? null } : null,
      state: row.state, reasons: row.reasons, detail: row.detail,
      ...(row.eligible_runners ? { eligible_runners: row.eligible_runners, failed_rule: row.failed_rule ?? null } : {}),
    } : {}),
    ...detail,
    evidence: cx.sql('SELECT ref, kind FROM ticket_evidence WHERE ticket_id = ? AND weighed_at IS NULL ORDER BY found_at, ref', id),
    allowed: allowedOn(cx, call.principal, repo, detail.overrides.hold),
    server_time: cx.now(),
  };
}

export const TICKET_READS: ReadRoute[] = [
  // Stalled, the lease ends, a backoff's end and the 24-hour window are the clock's.
  // The list is built from the tickets, their positions, claims, holds and conditions; the one
  // activity read behind it — a backing-off row's failed attempts — moves only as a claim ends.
  { action: 'repo.tickets', clock: true, quiet: true, run: ticketsAnswer },
  { action: 'ticket.show', clock: true, run: ticketAnswer },
];
