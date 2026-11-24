// B-250 — the Runners view reads a constant number of queries, however many runners were ever
// registered (BATON_SPEC §14's /v1/ui/state, §13's indexes; R-BTN-3's kept rows). The view ran
// about six queries for *every* runner row on each poll — reaped ones included — the latest
// transcript (a UNION over `transcripts` and `pending_transcripts`), `runner_capabilities`,
// the latest `status_report`, and more: ~1.9k statements a poll on the B-240 harness with 300
// old runner rows (~3.6k rows_read), polled every 10 seconds (production passed Cloudflare's
// 5,000,000 rows_read/day on 2026-11-14 and 2026-11-15). The answer is unchanged: the served
// `runners` equal what the per-runner reads built, re-run here as they were, across states that
// exercise every tie and fallback (two claims claimed at one instant, two open activities
// started and received at one instant, a transcript re-reported under a second claim at the
// same instant, two pointers of one heartbeat's instant told out of lexical order beside a
// pending pointer at that instant — the lexically first linked path wins, the union read's own
// tie rule — an older pending pointer, a lapsed lease with the claim
// still held, a reaped runner, a course no repository registered, 300 unseen runners). B-270
// (S-BTN-243) now omits the latest transcript and report for runners outside the live set. The
// statement count no longer grows with the runners, the lookups search
// their indexes (migration 0063), and on the Cloudflare host the view's reads stay under the
// ticket's 500-row target on that harness state.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, HOST, adminSession, cutover, register, rows, setAdminKeys, setClock, withCore, keyCall } from '../helpers';
import { readSession } from '../lib/needsYouFixture';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { transcriptUrl } from '../../src/core/links';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const H = 3_600_000;
const TRANSCRIPTS = 'immediately-run/claude-sessions';

type Captured = { sql: string; params: unknown[]; cursor: { rowsRead?: number } };

/** One state answer, with every statement it ran and its cursor. */
async function state(session: string): Promise<{ state: Record<string, any>; log: Captured[] }> {
  const log: Captured[] = [];
  await withCore((c) => {
    const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b250?: (q: string, ...p: unknown[]) => unknown };
    s.__b250 ??= s.exec;
    const orig = s.__b250;
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
      const s = c.store as unknown as { exec: unknown; __b250?: unknown };
      if (s.__b250) s.exec = s.__b250;
    });
  }
}

/** The Runners view's own statements, from the capture: the eight reads `runnersView` makes. */
const VIEW_SQL = [
  /FROM runners ORDER BY hostname, id$/,
  /FROM runner_capabilities ORDER BY capability$/,
  /FROM runner_courses f LEFT JOIN courses/,
  /FROM claims WHERE status = 'active' ORDER BY claimed_at, id$/,
  /FROM activities WHERE ended_at IS NULL$/,
  /AS t FROM transcripts\b/,
  /AS t FROM pending_transcripts\b/,
  /AS runner_id, payload_json, sent_at FROM messages\b/,
];
const viewStatements = (log: Captured[]) => log.filter((l) => VIEW_SQL.some((re) => re.test(l.sql)));
const historyStatements = (log: Captured[]) => log.filter((l) => VIEW_SQL.slice(-3).some((re) => re.test(l.sql)));

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

// ── the per-runner reads B-250 replaced, as they were (src/core/runnerApi.ts before B-250) ─

async function oldRunnersView(now: number) {
  const out = [];
  for (const w of await rows<Record<string, any>>(
    `SELECT id, hostname, session_name, harness, kind, isolation, model_id, lease_timeout_ms,
            first_seen_at, last_seen_at, last_activity_at, reaped_at, incarnation, profile_json, client_version, legacy_names_at FROM runners ORDER BY hostname, id`)) {
    const id = w.id;
    const alive = w.reaped_at == null && now - w.last_seen_at < w.lease_timeout_ms;
    const transcript = (await rows<{ repo: string; path: string }>(
      `SELECT repo, path FROM (SELECT repo, path, COALESCE(last_pushed_at, first_seen_at) AS t FROM transcripts WHERE runner_id = ?
       UNION ALL SELECT repo, path, COALESCE(last_pushed_at, first_seen_at) FROM pending_transcripts WHERE runner_id = ?) ORDER BY t DESC LIMIT 1`, id, id))[0];
    const claims = await rows(`SELECT id, ticket_id, nonce, claimed_at FROM claims WHERE runner_id = ? AND status = 'active' ORDER BY claimed_at, id`, id);
    out.push({
      ...w,
      profile: w.profile_json == null ? null : JSON.parse(w.profile_json),
      alive,
      capabilities: await rows('SELECT capability, declared FROM runner_capabilities WHERE runner_id = ? ORDER BY capability', id),
      courses: await rows(`SELECT f.repository_id AS repository, f.course_id AS course, f.version, c.min_runner_version
        FROM runner_courses f LEFT JOIN courses c ON c.repository_id = f.repository_id AND c.id = f.course_id
        WHERE f.runner_id = ? ORDER BY f.repository_id, f.course_id`, id),
      claims,
      claim: claims[0] ?? null,
      activity: (await rows(`SELECT id, kind, label, started_at, claim_id FROM activities WHERE runner_id = ? AND ended_at IS NULL
                             ORDER BY started_at DESC, received_at DESC LIMIT 1`, id))[0] ?? null,
      transcript_url: transcript ? transcriptUrl(transcript.repo, transcript.path) : null,
      last_report: (await rows(`SELECT payload_json, sent_at FROM messages WHERE from_runner_id = ? AND kind = 'status_report' ORDER BY id DESC LIMIT 1`, id))[0] ?? null,
    });
  }
  return out;
}

const served = (x: unknown) => JSON.parse(JSON.stringify(x));

async function sameAsBefore(session: string, now: number) {
  const { state: s } = await state(session);
  const expected = (await oldRunnersView(now)).map((w) => w.alive ? w : { ...w, transcript_url: null, last_report: null });
  expect(s.runners).toEqual(served(expected));
  return s;
}

// ── the state ───────────────────────────────────────────────────────────────────────────────

let n = 0;
async function claim(runner: number, ticket: string, claimedAt: number, endedAt: number | null) {
  n++;
  await rows(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason)
              VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`, ticket, runner, `b250:${n}`, `n${n}`, claimedAt, endedAt == null ? 'active' : 'released', endedAt,
  endedAt == null ? null : 'released:owner');
  return (await rows<{ id: number }>('SELECT MAX(id) AS id FROM claims'))[0].id;
}

/** An open activity; `kind` names its id, so a tie's winner is visible in the served row. */
async function activity(runner: number, claimId: number | null, id: string, started: number, received: number, ended: number | null = null) {
  await rows(`INSERT INTO activities (runner_id, id, claim_id, kind, label, source, started_at, ended_at, outcome, received_at)
              VALUES (?, ?, ?, ?, ?, 'skill', ?, ?, ?, ?)`, runner, id, claimId, claimId == null ? 'orient' : 'implement', id, started, ended, ended == null ? null : 'succeeded', received);
}

async function transcript(runner: number, claimId: number | null, path: string, at: number, pushed: number | null = null) {
  if (claimId == null) {
    await rows(`INSERT INTO pending_transcripts (runner_id, repo, path, role, first_seen_at, last_pushed_at) VALUES (?, ?, ?, 'session', ?, ?)`,
      runner, TRANSCRIPTS, path, at, pushed);
    return;
  }
  await rows(`INSERT INTO transcripts (runner_id, claim_id, repo, path, role, first_seen_at, last_pushed_at) VALUES (?, ?, ?, ?, 'session', ?, ?)`,
    runner, claimId, TRANSCRIPTS, path, at, pushed);
}

/** A `status_report` the dashboard reads, addressed as §9.4 shapes one. */
async function report(runner: number, at: number, text: string) {
  await rows(`INSERT INTO messages (kind, payload_json, from_runner_id, to_runner_id, sent_at, delivered_at, acknowledged_at, status)
              VALUES ('status_report', ?, ?, ?, ?, ?, ?, 'acknowledged')`, JSON.stringify({ text }), runner, runner, at, at, at);
}

/** Bare retained runners by default: seen 40 days ago, half reaped, without declarations. */
async function seedRunners(count: number, live = false) {
  const at = live ? T0 : T0 - 40 * 24 * H;
  await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
              INSERT INTO runners (hostname, session_name, secret_hash, credential_id, harness, kind, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at, reaped_at)
              SELECT 'extra-' || k.i, 's-' || k.i, 'x-' || k.i, 'vm-a', 'opencode', 'vm', 900000, '', ?, ?,
                     CASE WHEN k.i % 2 = 0 THEN ? ELSE NULL END
              FROM k`, count, at, at, live ? null : at + 60_000);
}

/** What one rich runner holds: two active claims claimed at one instant, two open activities
 *  started and received at one instant, a transcript re-reported under a second claim at the
 *  same instant, two pointers of one first heartbeat — the same `first_seen_at` — told out of
 *  lexical order beside a pending pointer at that same instant (the lexically first linked
 *  path wins; a pending pointer loses a tie to a linked one), an older linked one, an older
 *  pending pointer, two status reports (the later one wins), an ended
 *  claim with its ended activity, and — straight in the tables — a course no repository
 *  registered and a capability row out of order. */
async function fill(runner: number, tickets: string[]) {
  const ended = await claim(runner, tickets[0], T0 - 72 * H, T0 - 48 * H);
  await activity(runner, ended, 'ended-act', T0 - 72 * H, T0 - 72 * H, T0 - 71 * H);
  await transcript(runner, ended, `claude-code/old-${runner}.jsonl`, T0 - 72 * H);
  const a = await claim(runner, tickets[1], T0 - 5 * H, null);
  const b = await claim(runner, tickets[2], T0 - 5 * H, null);
  await activity(runner, a, 'tie-z', T0 - 2 * H, T0 - 2 * H);
  await activity(runner, a, 'tie-a', T0 - 2 * H, T0 - 2 * H);
  await activity(runner, b, 'newer', T0 - H, T0 - 30 * 60_000);
  await transcript(runner, a, `claude-code/s-${runner}.jsonl`, T0 - 4 * H);
  await transcript(runner, b, `claude-code/s-${runner}.jsonl`, T0 - 4 * H); // re-reported under the second claim
  await transcript(runner, a, `claude-code/older-${runner}.jsonl`, T0 - 5 * H);
  // Two pointers of one first heartbeat — a heartbeat stamps every pointer it reports with the
  // same `first_seen_at` — told out of lexical order, at the pending one's instant: a linked
  // pointer beats a pending one at one instant and the lexically first path wins within the
  // table, so this pair is what the view serves, here and in the per-runner reads above.
  await transcript(runner, a, `claude-code/tie-z-${runner}.jsonl`, T0 - H);
  await transcript(runner, a, `claude-code/tie-a-${runner}.jsonl`, T0 - H);
  await transcript(runner, null, `claude-code/pending-tied-${runner}.jsonl`, T0 - H);
  await transcript(runner, null, `claude-code/pending-older-${runner}.jsonl`, T0 - 3 * H);
  await report(runner, T0 - 4 * H, 'first');
  await report(runner, T0 - 30 * 60_000, 'second');
  await rows(`INSERT INTO runner_courses (runner_id, repository_id, course_id, version) VALUES (?, 'docs', 'unregistered', 9)`, runner);
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

describe('B-250 the Runners view in one read per list', { timeout: 180_000 }, () => {
  it('serves what the per-runner reads served — empty, then across ties, fallbacks, lapsed and reaped runners', async () => {
    await sameAsBefore(session, T0);
    const a = await register('vm-a', { capabilities: ['create-pr', 'agent-venue'], profile: { cli: { commit: 'a1b2c3d', ref: 'main', pinned: 1 } } });
    const b = await register('vm-b');
    const gone = await register('mac');
    await sameAsBefore(session, T0);
    await fill(a.id, tickets.slice(0, 3));
    const [{ lease_timeout_ms: lease }] = await rows<{ lease_timeout_ms: number }>('SELECT lease_timeout_ms FROM runners WHERE id = ?', b.id);
    await rows(`UPDATE runners SET last_seen_at = ? WHERE id = ?`, T0 - lease, b.id); // exactly lapsed, holding nothing
    await fill(gone.id, tickets.slice(3, 6));
    await rows('UPDATE runners SET reaped_at = ? WHERE id = ?', T0 - 1, gone.id);
    // The lapsed runner's only open activities are a tied pair — the tie decides its served row.
    await activity(b.id, null, 'b-tie-z', T0 - H, T0 - H);
    await activity(b.id, null, 'b-tie-a', T0 - H, T0 - H);
    // Its pointers wait as pending ones (it holds no claim): two of one heartbeat's instant,
    // told out of lexical order. Both are hidden until the runner is live again.
    await transcript(b.id, null, 'claude-code/b-pending-z.jsonl', T0 - H);
    await transcript(b.id, null, 'claude-code/b-pending-a.jsonl', T0 - H);
    await report(b.id, T0 - H, 'before expiry');
    const s = await sameAsBefore(session, T0);
    // The state exercises what it claims to: an alive runner with two claims at one instant,
    // a lapsed one, a reaped one, and the lists' orders and latests.
    expect(s.runners).toHaveLength(3);
    expect(s.runners.map((w: any) => [w.hostname, w.alive])).toEqual([['owner-mac', false], ['vm-a', true], ['vm-b', false]]);
    expect(s.runners[1].capabilities).toEqual([
      { capability: 'authentication', declared: 'agent-venue' },
      { capability: 'create-pr', declared: 'create-pr' },
      { capability: 'drivable-browser', declared: 'agent-venue' },
      { capability: 'llm-call', declared: 'agent-venue' },
    ]);
    expect(s.runners[1].courses).toEqual([
      { repository: 'docs', course: 'roadmap-pr', version: 3, min_runner_version: 3 },
      { repository: 'docs', course: 'unregistered', version: 9, min_runner_version: null },
    ]);
    expect(s.runners[1].claims.map((c: any) => c.ticket_id)).toEqual([tickets[1], tickets[2]]);
    expect(s.runners[1].activity.id).toBe('newer');
    expect(s.runners[1].transcript_url).toBe(transcriptUrl(TRANSCRIPTS, `claude-code/tie-a-${a.id}.jsonl`)); // the heartbeat pair's instant: linked before pending, `a` before `z`
    expect(JSON.parse(s.runners[1].last_report.payload_json).text).toBe('second');
    expect(s.runners[0].activity.id).toBe('newer'); // the reaped runner's open activity is served as it was
    expect(['b-tie-a', 'b-tie-z']).toContain(s.runners[2].activity.id); // one tied row, the same one both reads pick
    for (const w of [s.runners[0], s.runners[2]]) {
      expect(w.transcript_url).toBeNull();
      expect(w.last_report).toBeNull();
    }
    expect(s.runners[2].claims).toEqual([]);
    // S-BTN-170: the dashboard and admin state agree at lease equality and after renewal.
    const dashboardHistory = async (fleetRow: typeof s.runners[number]) => {
      const path = '/v1/repositories/docs/runners';
      const list = await readSession(session, path);
      const detail = await readSession(session, `${path}/${b.id}`);
      expect([list.status, detail.status]).toEqual([200, 200]);
      const row = list.json.runners.find((w: any) => w.runner_id === b.id);
      expect(row).toMatchObject({
        alive: fleetRow.alive,
        transcript_url: fleetRow.transcript_url,
        last_report: fleetRow.last_report && {
          payload: JSON.parse(fleetRow.last_report.payload_json), sent_at: fleetRow.last_report.sent_at,
        },
      });
      expect(detail.json.runner).toMatchObject(row);
    };
    await dashboardHistory(s.runners[2]);
    await rows('UPDATE runners SET last_seen_at = ? WHERE id = ?', T0, b.id);
    const renewed = await sameAsBefore(session, T0);
    expect(renewed.runners[2].transcript_url).toBe(transcriptUrl(TRANSCRIPTS, 'claude-code/b-pending-a.jsonl'));
    expect(JSON.parse(renewed.runners[2].last_report.payload_json).text).toBe('before expiry');
    await dashboardHistory(renewed.runners[2]);
    // Later: the lease lapses on the held claims too — the alarm has not run (B-229's window).
    await setClock(T0 + 21 * H);
    await rows('UPDATE runners SET last_seen_at = ? WHERE id = ?', T0 + 21 * H, a.id);
    session = await adminSession(admin); // a session lives 4 hours (R-BTN-155)
    await sameAsBefore(session, T0 + 21 * H);
    // However many runners were ever registered: the rows R-BTN-3 keeps are served the same.
    await seedRunners(300);
    const big = await sameAsBefore(session, T0 + 21 * H);
    expect(big.runners).toHaveLength(303);
    // The tie cases the scenarios hold: the two open activities at one instant and the
    // re-reported transcript at one instant served one row each, identically to before.
    const tie = big.runners.find((w: any) => w.hostname === 'vm-a');
    expect(tie.activity.id).toBe('newer'); // the tie pair lost to it in both reads
    expect(tie.transcript_url).toBe(transcriptUrl(TRANSCRIPTS, `claude-code/tie-a-${a.id}.jsonl`)); // its instant's winner, identically to before
  });

  it('runs the same statements however many runners were ever registered; the lookups search their indexes', async () => {
    const a = await register('vm-a');
    await fill(a.id, tickets.slice(0, 3));
    await state(session); // the session's first read does its own one-time work
    for (let i = 1; i < 10; i++) await register('vm-b', { session_name: `extra-${i}` }); // with vm-a: the criterion's ten runners
    const small = await quiet(session);
    await seedRunners(290); // ten live and 290 unseen: the criterion's 300
    const large = await quiet(session);
    const smallView = viewStatements(small);
    const largeView = viewStatements(large);
    expect(smallView.length).toBe(largeView.length);
    expect(smallView.length).toBeLessThanOrEqual(12);
    // The view reads the retained roster and active lists in index order.
    const plans = new Map<string, string[]>();
    for (const l of largeView) {
      const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${l.sql}`, ...l.params)).map((r) => r.detail);
      plans.set(l.sql, plan);
      const table = /FROM (runners|claims|activities|messages|transcripts|pending_transcripts)\b/.exec(l.sql)?.[1]!;
      const scans = plan.filter((d) => d.startsWith(`SCAN ${table}`) && !/USING (COVERING )?INDEX/.test(d));
      expect(scans, `${l.sql}\n${plan.join('\n')}`).toEqual([]);
    }
    expect(plans.get(smallView.find((l) => /FROM runners ORDER BY/.test(l.sql))!.sql)).toContain('SCAN runners USING INDEX runners_by_hostname');
    expect(plans.get(largeView.find((l) => /FROM claims WHERE status/.test(l.sql))!.sql)).toContain('SCAN claims USING INDEX claims_active_by_runner');
    expect(plans.get(largeView.find((l) => /FROM activities WHERE ended_at/.test(l.sql))!.sql)).toContain('SCAN activities USING INDEX activities_open');
  });

  it('bounds all three latest lookups as live and expired runners accumulate months of history (S-BTN-243)', async () => {
    const live = await register('vm-a');
    const expired = await register('vm-b');
    await rows('UPDATE runners SET last_seen_at = ? WHERE id = ?', T0 - 100 * 24 * H, expired.id);
    for (const runner of [live, expired]) {
      const ticket = runner === live ? tickets[0] : tickets[1];
      const id = await claim(runner.id, ticket, T0 - 100 * 24 * H, T0 - 99 * 24 * H);
      await transcript(runner.id, id, 'latest-linked', T0 - H, T0);
      await transcript(runner.id, null, 'latest-pending', T0 - H, T0);
    }
    const small = await state(session);
    const count = 3000;
    const series = 'WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)';
    for (const runner of [live, expired]) {
      await rows(`${series}
        INSERT INTO transcripts (runner_id, claim_id, repo, path, role, first_seen_at)
        SELECT c.runner_id, c.id, ?, 'linked-' || i, 'session', ? + i * ? FROM k CROSS JOIN claims c WHERE c.runner_id = ?`,
        count, TRANSCRIPTS, T0 - 100 * 24 * H, H / 2, runner.id);
      await rows(`${series}
        INSERT INTO pending_transcripts (runner_id, repo, path, role, first_seen_at)
        SELECT ?, ?, 'pending-' || i, 'session', ? + i * ? FROM k`, count, runner.id, TRANSCRIPTS, T0 - 100 * 24 * H, H / 2);
      await rows(`${series}
        INSERT INTO messages (kind, from_runner_id, to_runner_id, sent_at, status, payload_json)
        SELECT 'status_report', ?, ?, ? + i * ?, 'acknowledged', '{"text":"history"}' FROM k`, count, runner.id, runner.id, T0 - 100 * 24 * H, H / 2);
      // Higher id wins even with a lower sent_at than the last inserted history row.
      await report(runner.id, T0 - 100 * 24 * H, 'latest');
    }
    const large = await state(session);
    expect(large.state.runners).toEqual(served(await oldRunnersView(T0)).map((w: any) => w.alive ? w : { ...w, transcript_url: null, last_report: null }));
    expect(large.state.runners).toEqual(small.state.runners.map((w: any) => w.alive ? {
      ...w, last_report: { payload_json: '{"text":"latest"}', sent_at: T0 - 100 * 24 * H },
    } : w));
    for (const table of ['transcripts', 'pending_transcripts', 'messages']) {
      expect(await rows(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 2 * (count + 1) }]);
    }
    const history = historyStatements(large.log);
    const searches = [
      /^SEARCH t USING (COVERING )?INDEX transcripts_latest \(runner_id=\?\)$/,
      /^SEARCH t USING (COVERING )?INDEX pending_transcripts_latest \(runner_id=\?\)$/,
      /^SEARCH m USING (COVERING )?INDEX messages_reports \(from_runner_id=\?\)$/,
    ];
    expect(history).toHaveLength(searches.length);
    for (const [i, l] of history.entries()) {
      expect(l.params).toEqual([JSON.stringify([live.id])]);
      const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${l.sql}`, ...l.params)).map((r) => r.detail);
      expect(plan, plan.join('\n')).toContainEqual(expect.stringMatching(searches[i]));
      expect(plan.filter((d) => /^(SCAN (?!j\b)|USE TEMP B-TREE)/.test(d))).toEqual([]);
    }
    if (HOST === 'cloudflare') {
      const cost = (log: Captured[]) => historyStatements(log).map((l) => l.cursor.rowsRead!);
      // The empty report lookup can now fetch one row; other reads must not grow.
      const before = cost(small.log);
      const after = cost(large.log);
      expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
      expect(after[2]).toBeLessThanOrEqual(before[2] + 2);
      expect(after.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12);
    }

    // R-BTN-87's 50 is a target, not a cap. Populate each lookup for 50 more live runners.
    await seedRunners(50, true);
    await rows(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at)
      SELECT ?, id, 'history-' || id, 'test', '', ?, 'released', ? FROM runners WHERE hostname GLOB 'extra-*'`, tickets[2], T0 - H, T0);
    await rows(`INSERT INTO transcripts (runner_id, claim_id, repo, path, role, first_seen_at)
      SELECT c.runner_id, c.id, ?, 'linked-' || c.runner_id, 'session', ? FROM claims c WHERE c.ticket_id = ?`, TRANSCRIPTS, T0, tickets[2]);
    await rows(`INSERT INTO pending_transcripts (runner_id, repo, path, role, first_seen_at)
      SELECT id, ?, 'pending-' || id, 'session', ? FROM runners WHERE hostname GLOB 'extra-*'`, TRANSCRIPTS, T0);
    await rows(`INSERT INTO messages (kind, from_runner_id, to_runner_id, sent_at, status, payload_json)
      SELECT 'status_report', id, id, ?, 'acknowledged', '{"text":"extra"}' FROM runners WHERE hostname GLOB 'extra-*'`, T0);
    const fleet = await state(session);
    const alive = fleet.state.runners.filter((w: any) => w.alive);
    expect(alive).toHaveLength(51);
    expect(fleet.state.runners).toHaveLength(52);
    expect(fleet.state.runners).toEqual(served(await oldRunnersView(T0)).map((w: any) => w.alive ? w : { ...w, transcript_url: null, last_report: null }));
    const fleetHistory = historyStatements(fleet.log);
    expect(fleetHistory).toHaveLength(3);
    for (const l of fleetHistory) expect(l.params).toEqual([JSON.stringify(alive.map((w: any) => w.id))]);
    if (HOST === 'cloudflare') {
      const total = fleetHistory.reduce((sum, l) => sum + l.cursor.rowsRead!, 0);
      expect(total).toBeLessThanOrEqual(12 * alive.length);
    }
  });

  it.runIf(HOST === 'cloudflare')('reads within the target on the B-240 harness state with 300 old runners', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    await fill(a.id, tickets.slice(0, 3));
    await fill(b.id, tickets.slice(3, 6));
    await seedRunners(300);
    await state(session); // the session's first read does its own one-time work
    const log = await quiet(session);
    // The Runners view's own statements and rows: 300 old runners cost their 300 rows (the
    // served rows themselves, R-BTN-3) and nothing per runner beyond them.
    const view = viewStatements(log);
    expect(view.length).toBeLessThanOrEqual(12);
    const read = view.reduce((s, l) => s + (l.cursor.rowsRead ?? 0), 0);
    expect(read).toBeLessThanOrEqual(500);
    expect(read).toBeGreaterThan(300); // the runners' own rows, still served
  });
});
