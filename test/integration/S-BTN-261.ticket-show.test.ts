// S-BTN-261 the ticket's read, extended (B-218; BATON_SPEC §11.4, §14, R-BTN-179): `GET
// …/tickets/{ticket}` (`ticket.show`) keeps every field B-126 served and adds what the ticket's
// page draws. Must hold:
//   1. the fields the read served before stand unchanged, for a key and a session alike;
//   2. it carries the ticket's list row (state, reasons, detail, position), its live claim with
//      the lease, the attempt and the session link and log directory as stored, the earlier
//      failed attempts, the overrides, the open conditions, the open scope findings, a pending
//      fence, parent and children, the resume record and `web_url` built from `web_base`;
//   3. `allowed` names `ticket.unhold` for an administrator's session on a held ticket, and
//      nothing on one not held or for a key;
//   4. an id not on the board is `not-found`; an id of another repository `invalid-params`.
// Owner sessions do not exist yet (B-76): the approver's branch of `allowed` is written and not
// reachable here. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  adminSession, claimItem, cutover, Git, keyCall, ORIGIN, register, rows, sessionCall, setAdminKeys, setClock,
  withCore, setTicketRetry, seedClaimLeg, seedCondition, seedScopeFinding,
} from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const HOUR = 3_600_000;
const LEGACY = ['ticket_id', 'repository', 'course_id', 'title', 'path', 'requires', 'operator_only', 'expedite', 'rank', 'snapshot_sha', 'parent', 'children', 'station'];

type Row = Record<string, any>;
let admin: TestKey;
let owner: TestKey;
let cookie: string;
let git: Git;

async function show(local: string): Promise<{ status: number; json: Row }> {
  const res = await sessionCall(cookie, `/v1/repositories/docs/tickets/${encodeURIComponent(local)}`);
  return { status: res.status, json: (await res.json()) as Row };
}
async function keyed(key: TestKey, local: string): Promise<{ status: number; json: Row }> {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/repositories/docs/tickets/${local}`, { created }));
  return { status: res.status, json: (await res.json()) as Row };
}
const post = (path: string, body: unknown) => sessionCall(cookie, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  git = new Git();
  git.add('T-1').add('T-2', { parent: 'T-1' }).add('T-3');
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  cookie = await adminSession(admin);
});

describe('S-BTN-261 the ticket’s read (B-218)', () => {
  it('keeps what it served and adds the ticket’s row, with nothing held', async () => {
    const before = await withCore((c) => c.claims.ticketView('docs:T-1'));
    const { status, json } = await show('T-1');
    expect(status).toBe(200);
    for (const k of LEGACY) expect([k, json[k]]).toEqual([k, (before as Row)[k]]);
    expect(json.children).toEqual([{ ticket_id: 'docs:T-2', station: 'filed' }]);
    expect([json.state, json.reasons, json.detail]).toEqual(['ready', [], {}]);
    expect(json.position).toEqual({ station: 'filed', path_len: 0, next_leg: 'implement', next_source: 'marker' });
    expect([json.course, json.tags, json.claim, json.attempts, json.conditions, json.scope, json.fence, json.resume, json.allowed]).toEqual(['roadmap-pr', [], null, [], [], [], null, null, []]);
    expect(json.overrides).toEqual({ expedite: false, hold: null });
    // R-BTN-92: the ticket's file under the repository's `web_base`.
    const base = (await rows<{ web_base: string }>(`SELECT web_base FROM repositories WHERE id = 'docs'`))[0].web_base;
    expect(json.web_url.startsWith(`${base}/`)).toBe(true);
    expect(json.web_url.endsWith('content/roadmap/T-1.mdx')).toBe(true);
    expect((await show('T-2')).json.parent).toBe('docs:T-1');
    // The qualified id names the same ticket; an owner's key reads the same answer but `allowed`.
    expect((await show('docs:T-1')).json).toEqual(json);
    const k = await keyed(owner, 'T-1');
    expect(k.status).toBe(200);
    expect(k.json).toEqual(json);
  });

  it('carries the claim, the attempts, the overrides, the conditions, the scope findings and the fence', async () => {
    const w = await register('vm-a');
    const first = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect(first.status).toBe(200);
    const claim = first.json.claim_id as number;
    // Before its first advance the claim names the leg it was offered, and no run.
    expect((await show('T-1')).json.claim).toMatchObject({ leg: 'implement', run_id: null, session_url: null, log_dir: null });
    await seedClaimLeg({
      claim_id: claim, seq: 1, run_id: 'r_01TESTRUN', leg: 'implement', from_station: 'filed', bars: '[]',
      started_at: T0, started_observation: 1, session_url: 'https://claude.ai/code/session_1',
      leg_log_dir: '/var/log/baton/T-1/implement',
    });
    await seedCondition({
      repository_id: 'docs', ticket_id: 'docs:T-1', claim_id: claim, run_id: 'r_1', leg: 'implement', type: 'x.wait',
      disposition: 'interrupt', severity: 'high', restarts_json: '{"retry":"Run it again","park":"Leave it"}',
      raised_at: T0, outcome: 'open',
    });
    await seedScopeFinding({
      repository_id: 'docs', ticket_id: 'docs:T-1', claim_id: claim, kind: 'scope-exceeded',
      target: 'immediately-run/other', detail_json: '{"kind":"push","ref":"refs/heads/x","claim":1}', raised_at: T0,
      updated_at: T0,
    });
    expect((await post(`/v1/ui/overrides/${encodeURIComponent('docs:T-1')}`, { expedite: true })).status).toBe(200);

    const live = (await show('T-1')).json;
    expect([live.state, live.detail.claim_id]).toEqual(['running', claim]);
    expect(live.claim).toMatchObject({
      claim_id: claim, runner_id: w.id, hostname: 'vm-a', session_name: 's-vm-a', leg: 'implement', run_id: 'r_01TESTRUN', leg_started_at: T0, claimed_at: T0, attempt: 1, max_runs: 3, next_backoff_until: null,
      session_url: 'https://claude.ai/code/session_1', log_dir: '/var/log/baton/T-1/implement', alive: true, stalled: false,
    });
    expect(live.claim.lease_ends_at).toBeGreaterThan(T0);
    expect(live.conditions).toEqual([{ condition_id: expect.any(Number), type: 'x.wait', severity: 'high', leg: 'implement', restarts: ['retry', 'park'] }]);
    expect(live.scope).toEqual([{ id: expect.any(Number), kind: 'scope-exceeded', target: 'immediately-run/other', ref: 'refs/heads/x', at: T0 }]);
    expect(live.overrides).toEqual({ expedite: true, hold: null });
    expect(live.expedite).toBe(true);

    // The administrator force-reaps the live claim: the runner is alive, so its fence is pending.
    expect((await post(`/v1/ui/claims/${claim}/reap`, { confirm: true })).status).toBe(200);
    const reaped = (await show('T-1')).json;
    expect(reaped.claim).toBeNull();
    expect(reaped.fence).toEqual({ claim_id: claim, runner_id: w.id, hostname: 'vm-a', since: T0 });
    expect(reaped.resume).toMatchObject({ end_reason: 'reaped:owner', ended_at: T0 });

    // An earlier failed attempt is listed with how it ended.
    await rows(`UPDATE claims SET failed_attempt = 1, end_reason = 'released:cannot-finish:transient', end_detail = 'the build host was down', fence_pending = 0 WHERE id = ?`, claim);
    const after = (await show('T-1')).json;
    expect(after.attempts).toEqual([{ run: 1, claim_id: claim, runner_id: w.id, hostname: 'vm-a', started_at: T0, ended_at: T0, end_reason: 'released:cannot-finish:transient', detail: 'the build host was down' }]);
    expect(after.fence).toBeNull();
  });

  it('allowed names ticket.unhold for an administrator’s session on a held ticket, and for no key', async () => {
    expect((await show('T-3')).json.allowed).toEqual([]);
    expect((await post(`/v1/ui/overrides/${encodeURIComponent('docs:T-3')}`, { hold: true })).status).toBe(200);
    const held = (await show('T-3')).json;
    expect([held.state, held.allowed]).toEqual(['held', ['ticket.unhold']]);
    expect(held.overrides.hold).toEqual({ set_by: expect.stringMatching(/^owner:/), reason: 'owner', since: T0 });
    expect(held.detail).toEqual(held.overrides.hold);
    expect((await keyed(owner, 'T-3')).json.allowed).toEqual([]);
    expect((await post(`/v1/ui/overrides/${encodeURIComponent('docs:T-3')}`, { hold: false })).status).toBe(200);
    expect((await show('T-3')).json.allowed).toEqual([]);
    // A backoff shows on the detail while it lasts.
    await setTicketRetry('docs:T-3', T0 + HOUR);
    expect((await show('T-3')).json.detail).toEqual({ attempt: 0, max_runs: 3, until: T0 + HOUR });
  });

  it('an id not on the board is not-found; another repository’s id is invalid-params', async () => {
    const none = await show('T-404');
    expect([none.status, none.json.code]).toEqual([404, 'not-found']);
    const other = await show('ops:T-1');
    expect([other.status, other.json.code]).toEqual([400, 'invalid-params']);
    const q = await sessionCall(cookie, '/v1/repositories/docs/tickets/T-1?x=1');
    expect(q.status).toBe(400);
  });
});
