// S-BTN-4 hung runner force-reaped (BATON_SPEC §15, §9.5 R-BTN-19, G-BTN-14): the fence before
// re-issue and the administrator's clear B-171 builds. Must hold: a claim force-reaped while its
// runner was alive keeps the ticket unissued until `fence-cleared`; an administrator's clear on
// it makes the ticket claimable at once, frees its seats (R-BTN-178) and logs
// `fence-cleared {admin}`; a clear of a claim whose fence is not pending is `conflict`.
// The row's other halves live with their own mechanisms: a re-keyed sidecar's fence clears at
// `fence_deadline` (test/unit/claims.test.ts, G-BTN-14), the sidecar's own report and the
// unacknowledged-release reap too (there, and S-BTN-198 for a retired repository); a leg under
// an executor other than `builtin` whose runner went silent is B-184's (R-BTN-107, unbuilt), the
// 30-minute `baton.fence-pending` condition with the core conditions B-234 builds on, and an
// owner session's and a delegated key's attempt are `forbidden` only once those principals exist
// (R-BTN-155's owner sessions and R-BTN-186's keys, B-124/B-73) — every dashboard session today
// is an administrator's, the only key a session is minted from (R-BTN-57). Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, course, cutover, Git, keyCall, ORIGIN, placed, requestId, rows, sessionCall, setAdminKeys, setClock, sha256, withCore, runnerCall } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-03T12:00:00Z');
const CAP = 'capability:rdp-lab';
let admin: TestKey;
let docsOwner: TestKey;
let w1: TestKey;
let w2: TestKey;

/** The course: `implement` requires the lab (so a claim holds a seat the clear frees),
 * `review` does not — the hung leg is a seated one. */
const HUNG_FILE = {
  start: 'filed', start_leg: 'implement', end: ['done'],
  capability_types: { capability: { description: 'a thing a leg may need', values: '^[-a-z0-9]{1,64}$' } },
  stations: { filed: { label: 'Filed' }, lab: { label: 'In the lab' }, done: { label: 'Done' } },
  legs: {
    implement: { from: ['filed'], to: 'lab', requires: { capabilities: [CAP] } },
    review: { from: ['lab'], to: 'done' },
  },
};
const hungCourse = () => course(1, 1, { id: 'hung-course', skill: 'run-hung', course: HUNG_FILE, step_kinds: ['orient'] });

/** docs' board: two tickets on the course, the first claimed and hung. */
function docsGit() {
  const g = new Git();
  g.registry = [hungCourse()];
  g.add('HUNG1', { course_id: 'hung-course', title: 'the hung ticket' }, placed('filed', [], [['implement', 'ready']]));
  g.add('HUNG2', { course_id: 'hung-course', title: 'the next ticket' }, placed('filed', [], [['implement', 'ready']]));
  return g;
}

/** A runner call signed by `key`, with its secret after the first heartbeat. */
async function runnerAs(key: TestKey, path: string, body?: unknown, secret?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const req = await signedRequest(key, ORIGIN + path, { created, body: body === undefined ? undefined : JSON.stringify(body), headers: secret ? { 'X-Runner-Secret': secret } : {} });
  const res = await hostCall(req);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** Register a granted key as a runner declaring the lab; returns its id and secret. */
async function up(key: TestKey, hostname: string, name: string, over: Record<string, unknown> = {}) {
  const secret = `secret-${name}`;
  const hb = await runnerAs(key, '/v1/runner/heartbeat', {
    hostname, session_name: name, harness: 'opencode', kind: 'vm', billing: {}, capabilities: [CAP],
    tier_ceiling: 'critical', lease_timeout_s: 900, courses: [{ repository: 'docs', course: 'hung-course', version: 1 }],
    secret_hash: await sha256(secret), ...over,
  });
  expect(hb.status).toBe(200);
  return { id: hb.json.runner_id as number, secret };
}

const claimAs = (key: TestKey, secret: string, body: Record<string, unknown>) => runnerAs(key, '/v1/runner/claim', { request_id: requestId(), ...body }, secret);
const advanceAs = (key: TestKey, secret: string, claimId: number, body: Record<string, unknown>) => runnerAs(key, `/v1/runner/claims/${claimId}/advance`, body, secret);
const sessionPost = (cookie: string, path: string, body: unknown) =>
  sessionCall(cookie, path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });
const seatsOf = async (claimId: number) => (await rows<{ capability: string }>('SELECT capability FROM claim_seats WHERE claim_id = ? ORDER BY capability', claimId)).map((r) => r.capability);
const holder = (ticket: string) => (runnerCall(`/v1/runner/tickets/${encodeURIComponent(ticket)}/holder`)).then((r) => r.json() as Promise<{ held_by_other: boolean; fence_pending: boolean }>);

let docs: Git;
beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ecdsa-sha2-nistp256', 'docs-owner');
  w1 = await makeKey('ssh-ed25519', 'w1');
  w2 = await makeKey('sk-ssh-ed25519@openssh.com', 'w2');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: w1.publicKey, hostname: 'vm-12', capabilities: [CAP] })).status).toBe(200);
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: w2.publicKey, hostname: 'vm-13', capabilities: [CAP] })).status).toBe(200);
  docs = docsGit();
  const post = await docs.post();
  if (post.status !== 200) throw new Error(`docs post: ${JSON.stringify(post)}`);
  await cutover(1, 'docs');
  expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: 1 }, 'PUT')).status).toBe(200);
});

describe('S-BTN-4 hung runner force-reaped (R-BTN-19)', () => {
  it('unissued until the fence clears; the administrator\'s clear makes the ticket claimable at once, frees its seats and logs fence-cleared {admin}', async () => {
    const W1 = await up(w1, 'vm-12', 'w1');
    const W2 = await up(w2, 'vm-13', 'w2');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:HUNG1' });
    expect(c1.status).toBe(200);
    // The hung tool call: the leg runs, its seat held.
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { leg: 'implement' })).status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([CAP]);
    // The dashboard force-reaps the live runner (§9.5): the claim is fence-pending, the runner
    // is not reaped, and the ticket and its seat stay held.
    const session = await adminSession(admin);
    const reap = await sessionPost(session, `/v1/ui/claims/${c1.json.claim_id}/reap`, { confirm: true });
    expect(reap.status).toBe(200);
    expect(await reap.json()).toMatchObject({ fence_pending: true });
    expect((await rows<{ reaped_at: number | null }>('SELECT reaped_at FROM runners WHERE id = ?', W1.id))[0].reaped_at).toBeNull();
    expect((await claimAs(w2, W2.secret, { ticket_id: 'docs:HUNG1' })).status).toBe(409);
    expect((await claimAs(w2, W2.secret, { ticket_id: 'docs:HUNG2' })).status).toBe(409); // rule 11: the seat
    expect(await holder('docs:HUNG1')).toEqual({ held_by_other: false, fence_pending: true });
    // Needs you lists the fence-pending claim with the dialog's facts: the runner, its
    // last-seen and the deadline the clear would not wait for.
    const state = (await (await sessionCall(session, '/v1/ui/state')).json()) as { needs_you: { fence_pending: { id: number; ticket_id: string; hostname: string; session_name: string; last_seen_at: number; ended_at: number; lease_timeout_ms: number }[] } };
    expect(state.needs_you.fence_pending).toEqual([expect.objectContaining({
      id: c1.json.claim_id, ticket_id: 'docs:HUNG1', hostname: 'vm-12', session_name: 'w1', last_seen_at: T0, lease_timeout_ms: 900_000 })]);
    // The clear — one POST under the administrator's session — ends the fence now.
    const cleared = await sessionPost(session, `/v1/ui/claims/${c1.json.claim_id}/fence-clear`, { confirm: true });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ok: true });
    expect((await rows<{ fence_pending: number }>('SELECT fence_pending FROM claims WHERE id = ?', c1.json.claim_id))[0].fence_pending).toBe(0);
    expect(await seatsOf(c1.json.claim_id)).toEqual([]);
    expect(await rows(`SELECT actor, json_extract(detail_json, '$.by') AS by, json_extract(detail_json, '$.admin') AS admin FROM events WHERE kind = 'fence-cleared'`))
      .toEqual([{ actor: `admin:${admin.fingerprint}`, by: 'admin', admin: admin.fingerprint }]);
    expect(await holder('docs:HUNG1')).toEqual({ held_by_other: false, fence_pending: false });
    // Claimable at once: the fence's hold and its seat are gone, and one reading since the reap
    // (§6.7 — the next claimant's re-read of git, R-BTN-25, the dialog's only protection)
    // admits W2's claim of the ticket that was fenced; its seat goes to W2.
    const awaiting = await claimAs(w2, W2.secret, { ticket_id: 'docs:HUNG1' });
    expect(awaiting.status).toBe(409);
    expect(awaiting.json).toMatchObject({ rule: 1, rule_code: 'awaiting-sync' });
    await docs.refresh();
    const took = await claimAs(w2, W2.secret, { ticket_id: 'docs:HUNG1' });
    expect(took.status).toBe(200);
    expect(await seatsOf(took.json.claim_id)).toEqual([CAP]);
    // With the seat taken again, the other ticket is back to refused rule 11.
    expect((await claimAs(w1, W1.secret, { ticket_id: 'docs:HUNG2' })).status).toBe(409);
  });

  it('the clear is confirmed, and a claim whose fence is not pending is conflict', async () => {
    const W1 = await up(w1, 'vm-12', 'w1');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:HUNG1' });
    expect(c1.status).toBe(200);
    const session = await adminSession(admin);
    // §12.2: destructive, so the body names its confirmation.
    const bare = await sessionPost(session, `/v1/ui/claims/${c1.json.claim_id}/fence-clear`, {});
    expect(bare.status).toBe(400);
    expect(await bare.json()).toMatchObject({ code: 'invalid-params' });
    // An active claim holds no pending fence: conflict, never a second reap by another name.
    const active = await sessionPost(session, `/v1/ui/claims/${c1.json.claim_id}/fence-clear`, { confirm: true });
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ code: 'conflict' });
    expect((await rows<{ status: string }>('SELECT status FROM claims WHERE id = ?', c1.json.claim_id))[0].status).toBe('active');
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'fence-cleared'`)).toEqual([]);
    // No claim at all: not-found, like force-reap.
    expect(await (await sessionPost(session, '/v1/ui/claims/999/fence-clear', { confirm: true })).json()).toMatchObject({ code: 'not-found' });
    // A claim whose fence already cleared — by its sidecar's report — is conflict too.
    await sessionPost(session, `/v1/ui/claims/${c1.json.claim_id}/reap`, { confirm: true });
    const report = await runnerAs(w1, '/v1/runner/heartbeat', {
      hostname: 'vm-12', session_name: 'w1', harness: 'opencode', kind: 'vm', billing: {}, capabilities: [CAP],
      tier_ceiling: 'critical', lease_timeout_s: 900, courses: [{ repository: 'docs', course: 'hung-course', version: 1 }],
      fenced: { claim_id: c1.json.claim_id, terminated: true },
    }, W1.secret);
    expect(report.status).toBe(200);
    const again = await sessionPost(session, `/v1/ui/claims/${c1.json.claim_id}/fence-clear`, { confirm: true });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'conflict' });
  });
});
