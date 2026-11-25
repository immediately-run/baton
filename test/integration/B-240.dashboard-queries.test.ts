// B-240 — the dashboard's Running and Timeline in joined queries (BATON_SPEC §14's Running and
// Timeline, §13's indexes; R-BTN-81's served shape). `GET /v1/ui/state` read one events and one
// activities query per active claim, and per alive runner one claims query, per claim one
// activities query and per activity one transcripts query — about 600 statements a poll on a
// production-sized state, polled every 10 seconds (production passed Cloudflare's 5,000,000
// rows_read/day on 2026-11-14). The answer is unchanged: the served `running` and `timeline` (B-4's leg runs included)
// equal what the per-row reads built, re-run here as they were, across states that exercise
// every tie and fallback (two claims claimed at one instant, activities started at one instant,
// a claim's activity transcript before its session's, two session transcripts, a reaped runner,
// claims outside the window). The statement count no longer grows with the claims, activities
// or lanes, the lookups search their indexes (migration 0055), and on the Cloudflare host a
// state whose history is out of the window costs rows of its window, not of its history.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Git, HOST, adminSession, cutover, register, rows, sessionCall, setAdminKeys, setClock, withCore, keyCall,
  setRunnerLastSeen, setRunnerReaped, seedActivity, seedClaim, seedClaimLeg, seedEvent, seedTranscript,
} from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { transcriptUrl } from '../../src/core/links';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const H = 3_600_000;
const STALLED_MS = 2 * H;
const TRANSCRIPTS = 'immediately-run/claude-sessions';

type Captured = { sql: string; params: unknown[]; cursor: { rowsRead?: number } };

/** One state answer, with every statement it ran and its cursor. */
async function state(session: string): Promise<{ state: Record<string, any>; log: Captured[] }> {
  const log: Captured[] = [];
  await withCore((c) => {
    const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b240?: (q: string, ...p: unknown[]) => unknown };
    s.__b240 ??= s.exec;
    const orig = s.__b240;
    s.exec = (q: string, ...p: unknown[]) => {
      const cursor = orig.call(s, q, ...p) as Captured['cursor'];
      log.push({ sql: q, params: p, cursor });
      return cursor;
    };
  });
  try {
    // B-203: the state is `GET /v1/admin/state`'s alone now — the same `stateView()`, read
    // with the administrator's key the session was minted from.
    const res = await keyCall(admin, '/v1/admin/state');
    expect(res.status).toBe(200);
    return { state: res.json as Record<string, any>, log };
  } finally {
    await withCore((c) => {
      const s = c.store as unknown as { exec: unknown; __b240?: unknown };
      if (s.__b240) s.exec = s.__b240;
    });
  }
}

// ── the per-row reads B-240 replaced, as they were (src/core/claims.ts before B-240) ─────────

async function oldRunning(now: number) {
  const out = [];
  for (const c of await rows<Record<string, any>>(
    `SELECT c.id, c.ticket_id, c.runner_id, c.claimed_at, c.nonce, w.hostname, w.session_name, w.last_seen_at, w.last_activity_at,
            w.lease_timeout_ms, w.kind, wi.title,
            (SELECT l.leg FROM claim_legs l WHERE l.claim_id = c.id AND l.finished_at IS NULL AND l.abandoned_at IS NULL
              ORDER BY l.seq DESC LIMIT 1) AS leg,
            (SELECT l.session_url FROM claim_legs l WHERE l.claim_id = c.id AND l.finished_at IS NULL AND l.abandoned_at IS NULL
              ORDER BY l.seq DESC LIMIT 1) AS session_url
     FROM claims c JOIN runners w ON w.id = c.runner_id LEFT JOIN tickets wi ON wi.id = c.ticket_id
     WHERE c.status = 'active' ORDER BY c.claimed_at`)) {
    const alive = c.kind !== 'legacy' && now - c.last_seen_at < c.lease_timeout_ms;
    out.push({
      ...c,
      session_url: null, session_link: c.session_url != null,
      alive,
      reap_at: c.kind === 'legacy' ? null : c.last_seen_at + c.lease_timeout_ms,
      stalled: alive && (c.last_activity_at == null ? now - c.claimed_at : now - c.last_activity_at) > STALLED_MS,
      events: await rows('SELECT at, kind, actor, detail_json FROM events WHERE claim_id = ? ORDER BY seq', c.id),
      activities: await rows('SELECT id, kind, label, started_at, ended_at, outcome, parent_id FROM activities WHERE claim_id = ? ORDER BY started_at', c.id),
    });
  }
  return out;
}

async function oldTimeline(now: number) {
  const from = now - 24 * H;
  const lanes = [];
  for (const l of await rows<Record<string, any>>(
    `SELECT id, hostname, session_name FROM runners WHERE reaped_at IS NULL AND ? - last_seen_at < lease_timeout_ms ORDER BY hostname, id`, now)) {
    const claims = [];
    for (const c of await rows<Record<string, any>>(`SELECT id, ticket_id, claimed_at, ended_at, status, end_reason FROM claims
                                WHERE runner_id = ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY claimed_at`, l.id, from)) {
      const activities = [];
      for (const a of await rows<Record<string, any>>('SELECT id, kind, seq, label, started_at, ended_at, outcome, parent_id, detail_json FROM activities WHERE claim_id = ? ORDER BY started_at', c.id)) {
        const t = (await rows<{ repo: string; path: string }>(
          `SELECT repo, path FROM transcripts WHERE claim_id = ? AND (activity_id = ? OR activity_id IS NULL) ORDER BY activity_id IS NULL, id LIMIT 1`, c.id, a.id))[0];
        activities.push({ ...a, transcript_url: t ? transcriptUrl(t.repo, t.path) : null });
      }
      const runs = (await rows<Record<string, any>>('SELECT leg, started_at, finished_at, abandoned_at, session_url FROM claim_legs WHERE claim_id = ? ORDER BY seq', c.id))
        .map((r) => ({ leg: r.leg, started_at: r.started_at, ended_at: r.finished_at ?? r.abandoned_at ?? null, session_url: null, session_link: r.session_url != null }));
      claims.push({ ...c, runs, activities });
    }
    lanes.push({ ...l, claims });
  }
  return { from, to: now, lanes };
}

const served = (x: unknown) => JSON.parse(JSON.stringify(x));

/** The fewest statements of three state reads: an alarm workerd runs meanwhile (the test clock
 *  is behind the real one) adds its own statements to the capture, never takes any away. */
async function quiet(session: string): Promise<Captured[]> {
  let best: Captured[] | null = null;
  for (let i = 0; i < 3; i++) {
    const { log } = await state(session);
    if (!best || log.length < best.length) best = log;
  }
  return best!;
}

async function sameAsBefore(session: string, now: number) {
  const { state: s } = await state(session);
  expect(s.running).toEqual(served(await oldRunning(now)));
  expect(s.timeline).toEqual(served(await oldTimeline(now)));
  return s;
}

// ── the state ───────────────────────────────────────────────────────────────────────────────

let n = 0;
async function claim(runner: number, ticket: string, claimedAt: number, endedAt: number | null) {
  n++;
  await seedClaim({
    ticket_id: ticket, runner_id: runner, request_id: `b240:${n}`, nonce: `n${n}`, snapshot_sha: '',
    claimed_at: claimedAt, status: endedAt == null ? 'active' : 'released', ended_at: endedAt,
    end_reason: endedAt == null ? null : 'released:owner',
  });
  return (await rows<{ id: number }>('SELECT MAX(id) AS id FROM claims'))[0].id;
}

/** Three activities, two started at one instant, the last still open. */
async function activities(runner: number, claimId: number, at: number) {
  for (const [i, [kind, started, ended]] of ([['implement', at, at + 60_000], ['push', at, at + 30_000], ['ci-wait', at + 120_000, null]] as const).entries()) {
    await seedActivity({
      runner_id: runner, id: `a${claimId}-${i}`, claim_id: claimId, kind, label: `${kind} ${i}`,
      source: 'skill', started_at: started, ended_at: ended, outcome: ended == null ? null : 'succeeded',
      received_at: started, detail_json: JSON.stringify({ n: i }),
    });
  }
}

async function transcript(runner: number, claimId: number, path: string, activity: string | null = null) {
  await seedTranscript({ runner_id: runner, claim_id: claimId, repo: TRANSCRIPTS, path, role: activity ? 'subagent' : 'session', activity_id: activity, first_seen_at: T0 });
}

async function event(claimId: number, ticket: string, at: number, kind = 'advanced') {
  await seedEvent({ at, kind, actor: 'test', detail_json: '{}', ticket_id: ticket, claim_id: claimId, repository_id: 'docs' });
}

/** The window's claims for one runner — two claimed at one instant, one active — with their
 *  activities, transcripts and events, and one claim ended before the window. */
async function fill(runner: number, tickets: string[], { active = true } = {}) {
  const old = await claim(runner, tickets[0], T0 - 72 * H, T0 - 48 * H);
  await activities(runner, old, T0 - 72 * H);
  const a = await claim(runner, tickets[1], T0 - 5 * H, T0 - 4 * H);
  const b = await claim(runner, tickets[2], T0 - 5 * H, T0 - 3 * H);
  await activities(runner, a, T0 - 5 * H);
  await activities(runner, b, T0 - 5 * H);
  await transcript(runner, a, `claude-code/s-${a}-1.jsonl`);
  await transcript(runner, a, `claude-code/s-${a}-2.jsonl`);
  await transcript(runner, b, `claude-code/sub-${b}.jsonl`, `a${b}-1`);
  await transcript(runner, b, `claude-code/s-${b}.jsonl`);
  for (const [seq, leg, finished] of [[2, 'review', null], [1, 'implement', T0 - 4 * H]] as const) {
    await seedClaimLeg({
      claim_id: b, seq, run_id: `r-${b}-${seq}`, leg, from_station: 'filed', started_at: T0 - 5 * H + seq,
      started_observation: 0, finished_at: finished, session_url: seq === 1 ? 'https://claude.ai/code/s1' : null,
    });
  }
  if (!active) return;
  const c = await claim(runner, tickets[3], T0 - H, null);
  await activities(runner, c, T0 - H);
  await transcript(runner, c, `claude-code/sub-${c}.jsonl`, `a${c}-2`);
  for (const at of [T0 - H, T0 - H, T0 - 30 * 60_000]) await event(c, tickets[3], at);
}

let admin: TestKey;
let session: string;
const tickets = Array.from({ length: 12 }, (_, i) => `docs:T-${i + 1}`);

beforeEach(async () => {
  n = 0;
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  const git = new Git();
  for (const t of tickets) git.add(t.slice(5));
  expect((await git.post()).status).toBe(200);
  await cutover();
  session = await adminSession(admin);
});

describe('B-240 Running and Timeline in joined queries', { timeout: 120_000 }, () => {
  it('serves what the per-row reads served — empty, then across lanes, ties and transcript fallbacks', async () => {
    await sameAsBefore(session, T0);
    const a = await register('vm-a');
    const b = await register('vm-b');
    const gone = await register('mac');
    await sameAsBefore(session, T0);
    await fill(a.id, tickets.slice(0, 4));
    await fill(b.id, tickets.slice(4, 8));
    await fill(gone.id, tickets.slice(8, 12), { active: false });
    await setRunnerReaped(gone.id, T0 - 1);
    const s = await sameAsBefore(session, T0);
    // The state exercises what it claims to: two lanes, the window's claims and its ties, an
    // activity's own transcript and the session's.
    expect(s.timeline.lanes).toHaveLength(2);
    expect(s.timeline.lanes[0].claims).toHaveLength(3);
    expect(s.running).toHaveLength(2);
    expect(s.running[0].events).toHaveLength(3);
    const urls = s.timeline.lanes.flatMap((l: any) => l.claims.flatMap((c: any) => c.activities.map((x: any) => x.transcript_url)));
    expect(urls.filter((u: string | null) => u?.includes('/sub-'))).toHaveLength(4);
    expect(urls.filter((u: string | null) => u?.includes('-1.jsonl'))).toHaveLength(6);
    expect(urls.filter((u: string | null) => u == null)).toHaveLength(4);
    // Later: the window moves past the ended claims and a lane's runner falls silent.
    await setClock(T0 + 21 * H);
    await setRunnerLastSeen(a.id, T0 + 21 * H);
    session = await adminSession(admin); // a session lives 4 hours (R-BTN-155)
    await sameAsBefore(session, T0 + 21 * H);
  });

  it('runs the same statements however many claims and activities; the lookups search their indexes', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    await fill(a.id, tickets.slice(0, 4));
    await state(session); // the session's first read does its own one-time work
    const small = await quiet(session);
    await fill(b.id, tickets.slice(4, 8));
    for (let i = 0; i < 20; i++) {
      const c = await claim(b.id, tickets[4], T0 - 6 * H, T0 - 5 * H);
      await activities(b.id, c, T0 - 6 * H);
      await transcript(b.id, c, `claude-code/s-${c}.jsonl`);
    }
    const large = await quiet(session);
    expect(large.length).toBe(small.length);
    // 80 of B-240's joined reads, the one version row B-242's ETag reads before them, and
    // R3-1258's fixed Capacity statements: the envelope's two counted figures, the maintained
    // two's one row, the day's usage row read — and the request's own usage write in the tail.
    expect(large.length).toBeLessThanOrEqual(89);
    // The joined reads, explained: each searches an index and none scans its table.
    const lookups = large.filter((l) => /FROM (claims|activities|transcripts|events|ticket_next_legs n|ticket_stations s JOIN ticket_next_legs n)\b/.test(l.sql) && /json_each|fence_pending|confirmed_at IS NULL AND ended_at <=|waiting_on = 'policy'|waiting_on = 'course-changed'/.test(l.sql));
    expect(lookups.length).toBeGreaterThanOrEqual(9);
    for (const l of lookups) {
      const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${l.sql}`, ...l.params)).map((r) => r.detail);
      const scans = plan.filter((d) => /^SCAN (claims|activities|transcripts|events|n|s)\b/.test(d) && !/USING (COVERING )?INDEX/.test(d));
      expect(scans, `${l.sql}\n${plan.join('\n')}`).toEqual([]);
    }
  });

  it.runIf(HOST === 'cloudflare')("a history outside the window costs the dashboard's lookups nothing", async () => {
    const a = await register('vm-a');
    await fill(a.id, tickets.slice(0, 4));
    // The statements over claims, activities and transcripts — the event windows are B-235's,
    // and the Runners view's own reads (its claims, its open activities, its latest transcript,
    // now one query per list) are B-250's, not this ticket's.
    const read = (log: Captured[]) => log.filter((l) => /\b(claims|activities|transcripts)\b/.test(l.sql) && !/\bFROM events\b/.test(l.sql) && !/\bWHERE runner_id = \?/.test(l.sql)
      && !/FROM claims WHERE status = 'active' ORDER BY claimed_at, id$/.test(l.sql) && !/FROM activities WHERE ended_at IS NULL$/.test(l.sql) && !/AS t FROM (pending_)?transcripts\b/.test(l.sql))
      .reduce((s, l) => s + (l.cursor.rowsRead ?? 0), 0);
    await state(session); // the session's first read does its own one-time work
    const before = await quiet(session);
    // 400 more claims, each with its activities and transcript, ended a week before the window.
    const c = await claim(a.id, tickets[0], T0 - 9 * 24 * H, T0 - 8 * 24 * H);
    await activities(a.id, c, T0 - 9 * 24 * H);
    await transcript(a.id, c, `claude-code/s-${c}.jsonl`);
    const cols = (t: string) => rows<{ name: string; pk: number }>(`PRAGMA table_info(${t})`);
    const claimCols = (await cols('claims')).filter((x) => !x.pk).map((x) => x.name);
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 400)
                INSERT INTO claims (${claimCols.join(', ')}) SELECT ${claimCols.map((x) => (x === 'request_id' ? `request_id || '-' || k.i` : x === 'nonce' ? `nonce || '-' || k.i` : x)).join(', ')}
                FROM claims, k WHERE claims.id = ?`, c);
    await rows(`INSERT INTO activities (runner_id, id, claim_id, kind, label, source, started_at, ended_at, outcome, received_at, detail_json)
                SELECT a.runner_id, a.id || '-' || c.id, c.id, a.kind, a.label, a.source, a.started_at, a.ended_at, a.outcome, a.received_at, a.detail_json
                FROM activities a, claims c WHERE a.claim_id = ? AND c.id > ?`, c, c);
    await rows(`INSERT INTO transcripts (runner_id, claim_id, repo, path, role, activity_id, first_seen_at)
                SELECT t.runner_id, c.id, t.repo, 'claude-code/s-' || c.id || '.jsonl', t.role, t.activity_id, t.first_seen_at FROM transcripts t, claims c WHERE t.claim_id = ? AND c.id > ?`, c, c);
    expect((await rows<{ n: number }>('SELECT COUNT(*) AS n FROM claims'))[0].n).toBeGreaterThan(400);
    const after = await quiet(session);
    expect(after.length).toBe(before.length);
    // The window's own rows: its claims, their activities and transcripts — a scan read the
    // 400 claims, and the per-row reads their 1,200 activities and transcripts again per poll.
    expect(read(before)).toBeLessThanOrEqual(60);
    // An index search reads one entry past its range when one follows: at most one row per lookup.
    expect(read(after)).toBeLessThanOrEqual(read(before) + 5);
  });
});
