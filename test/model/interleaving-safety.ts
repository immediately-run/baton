// S-BTN-334: replay.qnt's core-side assertions and properties.qnt's safety set.
// Each oracle reads committed rows, or compares them with the inputs at the boundary.
import { expect } from 'vitest';
import { course, withCore } from '../helpers';
import type { Projection } from '../integration/trace';

const graph = course().course;
type Leg = keyof typeof graph.legs;
const required = ['fix', 'merge'];

export interface Transition {
  claim?: { id: string; ticket: string; runner: number; cap: boolean };
  advance?: { id: string; leg: Leg; reached: string; bars: string[] };
  observe?: number;
  post?: { number: number; accepted: boolean };
}

export function checkSafety(before: Projection, after: Projection, move: Transition,
  runners: { id: number; limit: number }[], now: number, step: number, exercised: Set<string>) {
  return withCore(({ store }) => {
    const rows = <T>(sql: string) => store.exec<T>(sql).toArray();
    const claims = Object.entries(after.claims);
    const forTicket = (id: string) => claims.filter(([, c]) => c.ticket === id).map(([, c]) => c);

    // observationsIncrease (R-BTN-62): every accepted post advances to the handed-out number;
    // a refused post never changes the accepted observation.
    expect(after.counter, 'handed-out observation').toBe(move.observe ?? before.counter);
    if (move.observe !== undefined) expect(move.observe).toBeGreaterThan(before.counter);
    if (move.post?.accepted) {
      expect(move.post.number).toBeGreaterThan(before.lastAccepted);
      expect(move.post.number).toBe(before.counter);
    }
    expect(after.lastAccepted, 'accepted observation').toBe(move.post?.accepted ? move.post.number : before.lastAccepted);
    expect(after.lastAccepted).toBeLessThanOrEqual(after.counter);

    // oneLiveHolderPerTicket (R-BTN-4/19), oneClaimPerRunner (R-BTN-4): fixed grants
    // and declarations make min(concurrency, max_claims) an invariant in this fixture.
    for (const ticket of new Set(claims.map(([, c]) => c.ticket))) {
      expect(forTicket(ticket).filter((c) => c.status === 'active' || c.fencePending).length, ticket).toBeLessThanOrEqual(1);
    }
    for (const { id, limit } of runners) {
      const count = claims.filter(([, c]) => c.runner === id && c.status === 'active').length;
      expect(count, `runner ${id} claim limit`).toBeLessThanOrEqual(limit);
      if (count > 1) exercised.add('several-claims');
    }

    const events = rows<{ claim_id: number | null; ticket_id: string; kind: string; actor: string; detail_json: string }>(
      `SELECT claim_id, ticket_id, kind, actor, detail_json FROM events
       WHERE kind IN ('confirmed', 'fence-cleared', 'blocked', 'unblocked') ORDER BY seq`);
    const ended = new Map(rows<{ id: number; ended_at_sha: string | null }>('SELECT id, ended_at_sha FROM claims').map((c) => [c.id, c]));
    for (const [id, c] of claims) {
      const old = before.claims[id];
      const posted = after.tickets[c.ticket];
      // staleOnlyWhenTakenAway (R-BTN-35); this trace never reports a runner-side stale end.
      if (c.endReason === 'released:stale-board' && old?.status === 'active') {
        expect(posted?.present ?? false, 'stale despite still being on the board').toBe(false);
        exercised.add('stale');
      }
      // regressedOnlyWhenGitRegressed (R-BTN-81/85): a newly flagged regression needs
      // accepted git evidence newer than the claim/advance, not merely a lagging observation.
      if (c.regressed && !old?.regressed) {
        expect(move.post?.accepted).toBe(true);
        expect(after.lastAccepted).toBeGreaterThan(c.claimObs);
        expect(posted.path.length).toBeLessThan(Math.max(before.tickets[c.ticket]?.path.length ?? 0, c.startPath.length));
        exercised.add('regressed');
      }
      if (c.endReason === 'reaped:silent' && old?.status === 'active') {
        const lease = before.liveness[c.runner];
        expect(now - lease.lastSeen, 'silence reap before lease expiry').toBeGreaterThanOrEqual(lease.lease);
        expect(c.fencePending).toBe(false);
        exercised.add('silence-reap');
      }
      if (old?.fencePending && !c.fencePending) {
        const event = events.findLast((e) => e.claim_id === Number(id) && e.kind === 'fence-cleared');
        expect(event, 'fence cleared without an event').toBeDefined();
        if (JSON.parse(event!.detail_json).by === 'timeout') {
          const lease = before.liveness[c.runner];
          expect(now - lease.lastSeen, 'fence timeout before lease expiry').toBeGreaterThanOrEqual(lease.lease);
          exercised.add('fence-timeout');
        }
      }

      // confirmationAfterEnd (R-BTN-10/62): owner confirmation is explicit; otherwise
      // suspensions need a later observation and done can also use a newer recorded closure.
      if (c.confirmed && !old?.confirmed) {
        const event = events.findLast((e) => e.claim_id === Number(id) && e.kind === 'confirmed');
        expect(event, 'confirmation without an event').toBeDefined();
        const detail = JSON.parse(event!.detail_json) as { observation?: number; by?: string };
        expect(c.status).toBe('completed');
        if (detail.by === 'owner') {
          expect(event!.actor).toMatch(/^owner:/);
          exercised.add('owner-confirmed');
        } else {
          expect(event!.actor).toBe('sync');
          expect(detail.observation ?? after.lastAccepted).toBeGreaterThan(c.claimObs);
          if (c.endReason === 'done') {
            expect(!posted?.present || posted.path.at(-1) === 'merge', 'done without closure or end station').toBe(true);
            exercised.add('done-confirmed');
          } else {
            expect(move.post).toEqual({ number: detail.observation, accepted: true });
            expect(detail.observation).toBeGreaterThan(c.endObs);
            // No trace attests named evidence; a bare suspension does not need a git path.
            expect(ended.get(Number(id))?.ended_at_sha ?? '').toBe('');
            exercised.add('sync-confirmed');
          }
        }
      }

      // boundedLoops (R-BTN-63/69): count the starting path plus actual runs in the claim.
      const path = [...c.startPath, ...c.finished, ...(c.runningSeq != null ? [c.leg] : [])];
      for (const [leg, def] of Object.entries(graph.legs)) {
        if ('max_runs' in def) expect(path.filter((l) => l === leg).length, `${id} ${leg} max_runs`).toBeLessThanOrEqual(def.max_runs);
      }
    }

    // gatesHeld (R-BTN-45/63/83, configured gates): look at the state BEFORE the grant.
    // A new claim must not take a held, fenced, unconfirmed, stale or absent ticket.
    if (move.claim) {
      const { id, ticket, runner } = move.claim;
      expect(after.claims[id]).toMatchObject({ ticket, runner, status: 'active' });
      expect(before.claims[id]).toBeUndefined();
      expect(before.tickets[ticket]).toMatchObject({ present: true });
      expect(before.tickets[ticket].queued).not.toBeNull();
      expect(before.held[ticket] ?? false).toBe(false);
      for (const old of Object.values(before.claims).filter((c) => c.ticket === ticket)) {
        expect(old.status !== 'active' && !old.fencePending && (old.status !== 'completed' || old.confirmed)).toBe(true);
        expect(before.lastAccepted).toBeGreaterThan(old.endObs);
      }
    }
    expect(claims.filter(([id]) => !(id in before.claims)).map(([id]) => id)).toEqual(move.claim ? [move.claim.id] : []);
    if (move.advance) {
      const { id, leg, reached, bars } = move.advance;
      const old = before.claims[id];
      expect(old.status).toBe('active');
      expect(graph.legs[leg].from).toContain(reached);
      expect(after.claims[id]).toMatchObject({ leg, station: reached, legBars: [...bars].sort() });
      // writingLegsBarred (R-BTN-45/60/67): holder and snapshot bars together at start.
      const effective = [...bars, ...(before.tickets[old.ticket]?.bars[leg] ?? [])];
      if (required.includes(leg)) {
        expect(effective.some((b) => b.startsWith('family:'))).toBe(true);
        exercised.add(`started:${leg}`);
      }
      expect(effective.some((b) => before.runners[old.runner].includes(b))).toBe(false);
    }

    // capacityRespected (R-BTN-178): count seats and check their owners, not just the cap.
    const seats = rows<{ claim_id: number; capability: string }>('SELECT claim_id, capability FROM claim_seats');
    expect(seats.length, 'the one llm-call seat').toBeLessThanOrEqual(1);
    for (const seat of seats) {
      const c = after.claims[seat.claim_id];
      expect(seat.capability).toBe('llm-call');
      expect(c.status === 'active' || c.fencePending).toBe(true);
    }
    if (move.claim?.cap) expect(seats).toContainEqual({ claim_id: Number(move.claim.id), capability: 'llm-call' });

    // blockedIsStored (R-BTN-75), unblockedFollowsBlocked and answerLostOwesUnblocked (R-BTN-77).
    const blocks = rows<{ ticket_id: string; leg: string }>('SELECT ticket_id, leg FROM ticket_blocks');
    const open = new Set<string>();
    for (const e of events) {
      if (e.kind === 'blocked') open.add(e.ticket_id);
      if (e.kind === 'unblocked') expect(open.delete(e.ticket_id), `unpaired unblock on ${e.ticket_id}`).toBe(true);
    }
    for (const t of rows<{ id: string; blocked_since: number | null; answer_lost: string | null }>(`SELECT id, blocked_since, answer_lost FROM tickets WHERE repository_id = 'docs'`)) {
      const queued = after.tickets[t.id]?.queued;
      const held = forTicket(t.id).some((c) => c.status === 'active' || c.fencePending || (c.status === 'completed' && !c.confirmed));
      const blocked = !!queued && !held && blocks.some((b) => b.ticket_id === t.id && (!b.leg || b.leg === queued));
      expect(t.blocked_since != null, `blocked_since for ${t.id} at step ${step}`).toBe(blocked);
      if (t.answer_lost != null) expect(!blocked && open.has(t.id), `lost answer on ${t.id}`).toBe(true);
    }

    // attemptsBounded (R-BTN-122): this fixture has one retry group and max_failed = 2.
    const failures = rows<{ ticket_id: string; count: number }>(`
      SELECT c.ticket_id, count(*) AS count FROM claims c JOIN events e ON e.claim_id = c.id
       WHERE c.failed_attempt = 1 AND e.kind IN ('released', 'reaped') AND e.seq > COALESCE((
         SELECT max(o.seq) FROM events o WHERE o.ticket_id = c.ticket_id AND o.kind = 'override'
           AND json_extract(o.detail_json, '$.hold') = 0), 0) GROUP BY c.ticket_id`);
    for (const f of failures) expect(f.count, `${f.ticket_id} failed attempts since lift`).toBeLessThanOrEqual(2);
  });
}

// Not carried over verbatim:
// confirmedIsInGit (R-BTN-10/39): evidence, not a path prefix, confirms suspensions now.
// noActAfterLoss (R-BTN-6/26): the sidecar/pre-push owns this, not the core.
// noStuckTicket (R-BTN-45/75): requires an independent readiness and all-gates oracle.
// capabilityRowsCounted (R-BTN-75): requires a separate fleet census oracle, not just row consistency.
// blockedEndsBounded (R-BTN-126): no max_blocked counter in the current core.
// noTimeoutInsideFinishGrace (R-BTN-90): no finish-grace operation/state in the current core.
