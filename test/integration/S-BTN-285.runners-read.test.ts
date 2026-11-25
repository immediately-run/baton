// S-BTN-285 the repository's runners (B-196; BATON_SPEC §8.1 R-BTN-3, §8.2 R-BTN-146, §14):
// `GET /v1/repositories/{repository}/runners` (`repo.runners`) is the fleet a repository's
// readers see. Must hold:
//   1. it lists the runners whose key holds a live grant on the repository — alive or not —
//      and a seed credential's runner that declares one of its courses, in R-BTN-3's order
//      (hostname, then session name); a runner granted only elsewhere is absent;
//   2. a runner's row carries its own statement (harness, kind, isolation, capabilities,
//      courses), the grant's capabilities, role and domain, `alive` by its lease, and the claim
//      it holds here with its running leg, run id, lease end, run number, `max_runs` and
//      current activity; `log_dir` and `session_url` as stored, null where absent;
//   3. a runner holding a claim on another repository is `busy_elsewhere` with no claim here;
//   4. a runner the alarm reaped is listed dead with `reaped_at` and the claim its reap ended;
//   5. the newest status report and transcript are served; what the core does not hold yet
//      (the executor's fields) is named in `not_built`, never invented;
//   6. a session, an owner key and a granted runner key read the same rows; a key granted
//      elsewhere and a stranger are refused; an unknown parameter is `invalid-params`.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { register, rows, sessionCall, setClock, tick, runnerCall } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { claimAndStart, claimElsewhere, fleet, grantedRunner, heartbeat, signed, type Fleet, type Granted, type Json } from '../lib/runnerFleet';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const MIN = 60_000;

let f: Fleet;
let a: Granted;
let b: Granted;
let elsewhere: Granted;
let busy: Granted;

async function list(): Promise<Json> {
  const res = await sessionCall(f.cookie, '/v1/repositories/docs/runners');
  expect(res.status).toBe(200);
  return (await res.json()) as Json;
}
const rowOf = (answer: Json, id: number): Json => (answer.runners as Json[]).find((r) => r.runner_id === id)!;

beforeEach(async () => {
  f = await fleet(T0);
  const docs = { repository: 'docs', owner: f.docsOwner };
  const ops = { repository: 'ops', owner: f.opsOwner };
  a = await grantedRunner('runner-a', 'host-a', [docs]);
  b = await grantedRunner('runner-b', 'host-b', [docs]);
  elsewhere = await grantedRunner('runner-c', 'host-c', [ops], { courses: [{ repository: 'ops', course: 'roadmap-pr', version: 3 }] });
  busy = await grantedRunner('runner-d', 'host-d', [docs, ops]);
});

describe('S-BTN-285 the repository’s runners (B-196)', () => {
  it('lists the granted runners with their claim, the busy one without, and not the one granted elsewhere', async () => {
    const held = await claimAndStart(a, 'docs:T-1', 'implement');
    expect((await signed(a.key, '/v1/runner/activities', { activities: [
      { id: 'act-1', claim_id: held.claim_id, kind: 'push', source: 'skill', started_at: T0, ended_at: T0 + 1000, outcome: 'succeeded', detail: { branch: 'claude/T-1-x' } },
      { id: 'act-2', claim_id: held.claim_id, kind: 'implement', source: 'skill', label: 'writing the read', started_at: T0 + 2000 },
    ] }, a.secret)).status).toBe(200);
    await claimElsewhere(busy.id, 'ops:X-1', T0);
    await rows(`INSERT INTO messages (kind, payload_json, from_runner_id, to_runner_id, sent_at, delivered_at, acknowledged_at, status)
                VALUES ('status_report', ?, ?, ?, ?, ?, ?, 'acknowledged')`, JSON.stringify({ text: 'on the read' }), a.id, a.id, T0 + 3000, T0 + 3000, T0 + 3000);
    await rows(`INSERT INTO transcripts (runner_id, claim_id, repo, path, role, first_seen_at) VALUES (?, ?, 'immediately-run/claude-sessions', 'claude-code/s-a.jsonl', 'session', ?)`,
      a.id, held.claim_id, T0);
    const seed = await register('vm-b');

    const answer = await list();
    expect(Object.keys(answer).sort()).toEqual(['not_built', 'runners', 'server_time']);
    expect(answer.not_built).toEqual({ executor: 'B-184' });
    // hostname, then session name; the runner granted only on ops is absent.
    expect((answer.runners as Json[]).map((r) => r.hostname)).toEqual(['host-a', 'host-b', 'host-d', 'vm-b']);
    expect(rowOf(answer, elsewhere.id)).toBeUndefined();

    const ra = rowOf(answer, a.id);
    expect(Object.keys(ra).sort()).toEqual(['alive', 'busy_elsewhere', 'capabilities', 'claim', 'claims', 'courses', 'credential', 'granted', 'harness', 'hostname', 'isolation', 'kind',
      'last_activity_at', 'last_report', 'last_seen_at', 'lease_timeout_s', 'reaped_at', 'reaped_claim', 'runner_id', 'session_name', 'tags', 'transcript_url']);
    expect(ra).toMatchObject({ hostname: 'host-a', session_name: 's-host-a', alive: true, reaped_at: null, harness: 'opencode', kind: 'vm', lease_timeout_s: 900,
      busy_elsewhere: false, reaped_claim: null });
    expect(ra.credential).toMatchObject({ kind: 'runner', granted: true });
    // The grant's capabilities, expanded as it stores them (R-BTN-174).
    expect(ra.granted).toContain('create-pr');
    expect((ra.capabilities as Json[]).length).toBeGreaterThan(0);
    for (const c of ra.capabilities as Json[]) expect(Object.keys(c).sort()).toEqual(['capability', 'declared']);
    expect(ra.courses).toEqual([{ course: 'roadmap-pr', version: 3, min_runner_version: 3 }]);
    expect(ra.last_report).toEqual({ payload: { text: 'on the read' }, sent_at: T0 + 3000 });
    expect(ra.transcript_url).toMatch(/^https:\/\/github\.com\/immediately-run\/claude-sessions\/blob\/HEAD\/claude-code\/s-a\.jsonl$/);
    expect(ra.claim).toEqual({
      claim_id: held.claim_id, ticket_id: 'docs:T-1', station: 'filed', leg: 'implement', run_id: expect.stringMatching(/^r_/), claimed_at: T0,
      lease_ends_at: ra.last_seen_at + 900_000, deadline_at: null, attempt: 1, max_runs: null, next_backoff_until: null,
      session_url: null, session_link: false, log_dir: null, activity: { kind: 'implement', label: 'writing the read', started_at: T0 + 2000 },
    });
    expect(ra.claims).toEqual([ra.claim]);
    // No model, no profile on the list (B-196).
    expect('model_id' in ra || 'profile' in ra || 'executor' in ra).toBe(false);

    // Busy elsewhere: said, with no detail and no claim here.
    expect(rowOf(answer, busy.id)).toMatchObject({ busy_elsewhere: true, claim: null, claims: [] });
    expect(rowOf(answer, b.id)).toMatchObject({ alive: true, claim: null, busy_elsewhere: false });
    // A seed credential's runner, which no grant binds: listed, its grant null.
    expect(rowOf(answer, seed.id)).toMatchObject({ granted: null, credential: { kind: 'token', granted: false, role: null, domain: null } });

    // An owner key and a granted runner key read the same rows (R-BTN-179).
    const keyed = await signed(f.docsOwner, '/v1/repositories/docs/runners');
    expect(keyed.status).toBe(200);
    expect(keyed.json.runners).toEqual(answer.runners);
    expect((await signed(a.key, '/v1/repositories/docs/runners')).json.runners).toEqual(answer.runners);
    // A key granted elsewhere, and a stranger.
    expect((await signed(elsewhere.key, '/v1/repositories/docs/runners')).status).toBe(403);
    expect((await signed(await makeKey('ssh-ed25519', 'stranger'), '/v1/repositories/docs/runners')).status).toBe(401);
    expect((await sessionCall(f.cookie, '/v1/repositories/docs/runners?all=1')).status).toBe(400);
    // A seed credential's bearer holds no grant: the repository is not its to read.
    expect((await runnerCall('/v1/repositories/docs/runners')).status).toBe(403);
    expect((await sessionCall(f.cookie, '/v1/repositories/nowhere/runners')).status).toBe(403);
  });

  it('a runner the alarm reaped is listed dead, with the claim its reap ended', async () => {
    const lost = await claimAndStart(b, 'docs:T-2', 'implement');
    // `a` keeps its lease; `b` falls silent past its own.
    await setClock(T0 + 10 * MIN);
    expect((await heartbeat(a.key, a.hostname, a.secret)).status).toBe(200);
    await setClock(T0 + 20 * MIN);
    await tick();
    expect((await heartbeat(a.key, a.hostname, a.secret)).status).toBe(200);

    const res = await signed(f.docsOwner, '/v1/repositories/docs/runners');
    expect(res.status).toBe(200);
    const dead = rowOf(res.json, b.id);
    expect(dead.alive).toBe(false);
    expect(dead.reaped_at).toBe(T0 + 20 * MIN);
    expect(dead.claim).toBeNull();
    expect(dead.reaped_claim).toEqual({ claim_id: lost.claim_id, ticket_id: 'docs:T-2', ended_at: T0 + 20 * MIN, end_reason: 'reaped:silent' });
    expect(rowOf(res.json, a.id)).toMatchObject({ alive: true, reaped_at: null, reaped_claim: null });
  });
});
