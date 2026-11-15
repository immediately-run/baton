// B-240 — the dashboard's Running and Timeline in joined queries (BATON_SPEC §14's Running and
// Timeline, §13's indexes; R-BTN-81's served shape). `GET /v1/ui/state` read one events and one
// activities query per active claim, and per alive worker one claims query, per claim one
// activities query and per activity one transcripts query — about 600 statements a poll on a
// production-sized state, polled every 10 seconds (production passed Cloudflare's 5,000,000
// rows_read/day on 2026-11-14). The answer is unchanged: the served `running` and `timeline` (B-4's leg runs included)
// equal what the per-row reads built, re-run here as they were, across states that exercise
// every tie and fallback (two claims claimed at one instant, activities started at one instant,
// a claim's activity transcript before its session's, two session transcripts, a reaped worker,
// claims outside the window). The statement count no longer grows with the claims, activities
// or lanes, the lookups search their indexes (migration 0055), and on the Cloudflare host a
// state whose history is out of the window costs rows of its window, not of its history.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, HOST, adminSession, cutover, register, rows, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
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
    const res = await sessionCall(session, '/v1/ui/state');
    expect(res.status).toBe(200);
    return { state: (await res.json()) as Record<string, any>, log };
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
    `SELECT c.id, c.ticket_id, c.worker_id, c.claimed_at, c.nonce, w.hostname, w.session_name, w.last_seen_at, w.last_activity_at,
            w.lease_timeout_ms, w.kind, wi.title,
            (SELECT l.leg FROM claim_legs l WHERE l.claim_id = c.id AND l.finished_at IS NULL AND l.abandoned_at IS NULL
              ORDER BY l.seq DESC LIMIT 1) AS leg,
            (SELECT l.session_url FROM claim_legs l WHERE l.claim_id = c.id AND l.finished_at IS NULL AND l.abandoned_at IS NULL
              ORDER BY l.seq DESC LIMIT 1) AS session_url
     FROM claims c JOIN workers w ON w.id = c.worker_id LEFT JOIN tickets wi ON wi.id = c.ticket_id
     WHERE c.status = 'active' ORDER BY c.claimed_at`)) {
    const alive = c.kind !== 'legacy' && now - c.last_seen_at < c.lease_timeout_ms;
    out.push({
      ...c,
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
    `SELECT id, hostname, session_name FROM workers WHERE reaped_at IS NULL AND ? - last_seen_at < lease_timeout_ms ORDER BY hostname, id`, now)) {
    const claims = [];
    for (const c of await rows<Record<string, any>>(`SELECT id, ticket_id, claimed_at, ended_at, status, end_reason FROM claims
                                WHERE worker_id = ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY claimed_at`, l.id, from)) {
      const activities = [];
      for (const a of await rows<Record<string, any>>('SELECT id, kind, seq, label, started_at, ended_at, outcome, parent_id, detail_json FROM activities WHERE claim_id = ? ORDER BY started_at', c.id)) {
        const t = (await rows<{ repo: string; path: string }>(
          `SELECT repo, path FROM transcripts WHERE claim_id = ? AND (activity_id = ? OR activity_id IS NULL) ORDER BY activity_id IS NULL, id LIMIT 1`, c.id, a.id))[0];
        activities.push({ ...a, transcript_url: t ? transcriptUrl(t.repo, t.path) : null });
      }
      const runs = (await rows<Record<string, any>>('SELECT leg, started_at, finished_at, abandoned_at, session_url FROM claim_legs WHERE claim_id = ? ORDER BY seq', c.id))
        .map((r) => ({ leg: r.leg, started_at: r.started_at, ended_at: r.finished_at ?? r.abandoned_at ?? null, session_url: r.session_url }));
      claims.push({ ...c, runs, activities });
    }
    lanes.push({ ...l, claims });
  }
  return { from, to: now, lanes };
}

const served = (x: unknown) => JSON.parse(JSON.stringify(x));

async function sameAsBefore(session: string, now: number) {
  const { state: s } = await state(session);
  expect(s.running).toEqual(served(await oldRunning(now)));
  expect(s.timeline).toEqual(served(await oldTimeline(now)));
  return s;
}

// ── the state ───────────────────────────────────────────────────────────────────────────────

let n = 0;
async function claim(worker: number, ticket: string, claimedAt: number, endedAt: number | null) {
  n++;
  await rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason)
              VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`, ticket, worker, `b240:${n}`, `n${n}`, claimedAt, endedAt == null ? 'active' : 'released', endedAt,
  endedAt == null ? null : 'released:owner');
  return (await rows<{ id: number }>('SELECT MAX(id) AS id FROM claims'))[0].id;
}

/** Three activities, two started at one instant, the last still open. */
async function activities(worker: number, claimId: number, at: number) {
  for (const [i, [kind, started, ended]] of ([['implement', at, at + 60_000], ['push', at, at + 30_000], ['ci-wait', at + 120_000, null]] as const).entries()) {
    await rows(`INSERT INTO activities (worker_id, id, claim_id, kind, label, source, started_at, ended_at, outcome, received_at, detail_json)
                VALUES (?, ?, ?, ?, ?, 'skill', ?, ?, ?, ?, ?)`, worker, `a${claimId}-${i}`, claimId, kind, `${kind} ${i}`, started, ended,
    ended == null ? null : 'succeeded', started, JSON.stringify({ n: i }));
  }
}

async function transcript(worker: number, claimId: number, path: string, activity: string | null = null) {
  await rows(`INSERT INTO transcripts (worker_id, claim_id, repo, path, role, activity_id, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    worker, claimId, TRANSCRIPTS, path, activity ? 'subagent' : 'session', activity, T0);
}

async function event(claimId: number, ticket: string, at: number, kind = 'advanced') {
  await rows(`INSERT INTO events (at, kind, actor, detail_json, ticket_id, claim_id, repository_id) VALUES (?, ?, 'test', '{}', ?, ?, 'docs')`, at, kind, ticket, claimId);
}

/** The window's claims for one worker — two claimed at one instant, one active — with their
 *  activities, transcripts and events, and one claim ended before the window. */
async function fill(worker: number, tickets: string[], { active = true } = {}) {
  const old = await claim(worker, tickets[0], T0 - 72 * H, T0 - 48 * H);
  await activities(worker, old, T0 - 72 * H);
  const a = await claim(worker, tickets[1], T0 - 5 * H, T0 - 4 * H);
  const b = await claim(worker, tickets[2], T0 - 5 * H, T0 - 3 * H);
  await activities(worker, a, T0 - 5 * H);
  await activities(worker, b, T0 - 5 * H);
  await transcript(worker, a, `claude-code/s-${a}-1.jsonl`);
  await transcript(worker, a, `claude-code/s-${a}-2.jsonl`);
  await transcript(worker, b, `claude-code/sub-${b}.jsonl`, `a${b}-1`);
  await transcript(worker, b, `claude-code/s-${b}.jsonl`);
  for (const [seq, leg, finished] of [[2, 'review', null], [1, 'implement', T0 - 4 * H]] as const) {
    await rows(`INSERT INTO claim_legs (claim_id, seq, run_id, leg, from_station, started_at, started_observation, finished_at, session_url)
                VALUES (?, ?, ?, ?, 'filed', ?, 0, ?, ?)`, b, seq, `r-${b}-${seq}`, leg, T0 - 5 * H + seq, finished, seq === 1 ? 'https://claude.ai/code/s1' : null);
  }
  if (!active) return;
  const c = await claim(worker, tickets[3], T0 - H, null);
  await activities(worker, c, T0 - H);
  await transcript(worker, c, `claude-code/sub-${c}.jsonl`, `a${c}-2`);
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

describe('B-240 Running and Timeline in joined queries', () => {
  it('serves what the per-row reads served — empty, then across lanes, ties and transcript fallbacks', async () => {
    await sameAsBefore(session, T0);
    const a = await register('vm-a');
    const b = await register('vm-b');
    const gone = await register('mac');
    await sameAsBefore(session, T0);
    await fill(a.id, tickets.slice(0, 4));
    await fill(b.id, tickets.slice(4, 8));
    await fill(gone.id, tickets.slice(8, 12), { active: false });
    await rows('UPDATE workers SET reaped_at = ? WHERE id = ?', T0 - 1, gone.id);
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
    // Later: the window moves past the ended claims and a lane's worker falls silent.
    await setClock(T0 + 21 * H);
    await rows('UPDATE workers SET last_seen_at = ? WHERE id = ?', T0 + 21 * H, a.id);
    session = await adminSession(admin); // a session lives 4 hours (R-BTN-155)
    await sameAsBefore(session, T0 + 21 * H);
  });

  it('runs the same statements however many claims and activities; the lookups search their indexes', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    await fill(a.id, tickets.slice(0, 4));
    await state(session); // the session's first read does its own one-time work
    const small = (await state(session)).log;
    await fill(b.id, tickets.slice(4, 8));
    for (let i = 0; i < 20; i++) {
      const c = await claim(b.id, tickets[4], T0 - 6 * H, T0 - 5 * H);
      await activities(b.id, c, T0 - 6 * H);
      await transcript(b.id, c, `claude-code/s-${c}.jsonl`);
    }
    const large = (await state(session)).log;
    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThanOrEqual(80);
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
    // and the Workers view's per-worker reads (its current activity, its latest transcript)
    // are not this ticket's.
    const read = (log: Captured[]) => log.filter((l) => /\b(claims|activities|transcripts)\b/.test(l.sql) && !/\bFROM events\b/.test(l.sql) && !/\bWHERE worker_id = \?/.test(l.sql))
      .reduce((s, l) => s + (l.cursor.rowsRead ?? 0), 0);
    await state(session); // the session's first read does its own one-time work
    const before = (await state(session)).log;
    // 400 more claims, each with its activities and transcript, ended a week before the window.
    const c = await claim(a.id, tickets[0], T0 - 9 * 24 * H, T0 - 8 * 24 * H);
    await activities(a.id, c, T0 - 9 * 24 * H);
    await transcript(a.id, c, `claude-code/s-${c}.jsonl`);
    const cols = (t: string) => rows<{ name: string; pk: number }>(`PRAGMA table_info(${t})`);
    const claimCols = (await cols('claims')).filter((x) => !x.pk).map((x) => x.name);
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 400)
                INSERT INTO claims (${claimCols.join(', ')}) SELECT ${claimCols.map((x) => (x === 'request_id' ? `request_id || '-' || k.i` : x === 'nonce' ? `nonce || '-' || k.i` : x)).join(', ')}
                FROM claims, k WHERE claims.id = ?`, c);
    await rows(`INSERT INTO activities (worker_id, id, claim_id, kind, label, source, started_at, ended_at, outcome, received_at, detail_json)
                SELECT a.worker_id, a.id || '-' || c.id, c.id, a.kind, a.label, a.source, a.started_at, a.ended_at, a.outcome, a.received_at, a.detail_json
                FROM activities a, claims c WHERE a.claim_id = ? AND c.id > ?`, c, c);
    await rows(`INSERT INTO transcripts (worker_id, claim_id, repo, path, role, activity_id, first_seen_at)
                SELECT t.worker_id, c.id, t.repo, 'claude-code/s-' || c.id || '.jsonl', t.role, t.activity_id, t.first_seen_at FROM transcripts t, claims c WHERE t.claim_id = ? AND c.id > ?`, c, c);
    expect((await rows<{ n: number }>('SELECT COUNT(*) AS n FROM claims'))[0].n).toBeGreaterThan(400);
    const after = (await state(session)).log;
    expect(after.length).toBe(before.length);
    // The window's own rows: its claims, their activities and transcripts — a scan read the
    // 400 claims, and the per-row reads their 1,200 activities and transcripts again per poll.
    expect(read(before)).toBeLessThanOrEqual(60);
    // An index search reads one entry past its range when one follows: at most one row per lookup.
    expect(read(after)).toBeLessThanOrEqual(read(before) + 5);
  });
});
