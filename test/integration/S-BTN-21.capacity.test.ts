// S-BTN-21 capacity (BATON_SPEC §15, §6.11 R-BTN-178; B-106): `capability:rdp-lab` given capacity
// 1 by an administrator; W1 on host `vm-12` and W2 on `vm-13` both declare it, in two
// repositories. Must hold: W1 claims a leg requiring it and holds the seat; W2 claiming one, by
// `ticket_id`, is refused rule 11 `capacity-full` — never a failed attempt — and (prefer being
// R3-1269's, not built) its recommendations omit the leg, so a claim without an id takes its
// next candidate, the one needing no RDP; W1's own seat never refuses its advance into another
// RDP leg, and the advance into a leg without it releases the seat; a force-reap while holding
// keeps the seat fence-pending until `fence-cleared`; raising the capacity to 2 seats two
// claims, lowering to 1 takes no seat back and refuses the next claim; a snapshot changing a
// running leg's `requires.capabilities` changes no held seat; a silent reap frees the seat at
// once; a ticket whose posted `requires` names the capability, on a leg that does not, is
// seated and refused while W1 holds it. The holders are named only where the caller's key is
// granted on the holder's repository (R-BTN-99): W2, granted on ops alone, is told no names.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, course, cutover, Git, keyCall, ORIGIN, placed, requestId, rows, sessionCall, setAdminKeys, setClock, sha256, syncToken, tick, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-03T12:00:00Z');
const CAP = 'capability:rdp-lab';
let admin: TestKey;
let docsOwner: TestKey;
let opsOwner: TestKey;
let w1: TestKey;
let w2: TestKey;
let w3: TestKey;

/** The course both repositories serve (R-BTN-121): `implement` and `review` require the lab,
 * `merge` does not — one RDP leg into another, then a leg without it. */
const RDP_FILE = {
  start: 'filed', start_leg: 'implement', end: ['done'],
  capability_types: { capability: { description: 'a thing a leg may need', values: '^[-a-z0-9]{1,64}$' } },
  stations: { filed: { label: 'Filed' }, lab: { label: 'In the lab' }, review: { label: 'Reviewed' }, done: { label: 'Done' } },
  legs: {
    implement: { from: ['filed'], to: 'lab', requires: { capabilities: [CAP] } },
    review: { from: ['lab'], to: 'review', requires: { capabilities: [CAP] } },
    merge: { from: ['review'], to: 'done' },
  },
};
const rdpCourse = (file = RDP_FILE) =>
  course(1, 1, { id: 'rdp-course', skill: 'run-rdp', course: file, step_kinds: ['orient'] });
/** A course file with the lab dropped from `implement` — the mid-leg snapshot of the third test. */
const NO_RDP_ON_IMPLEMENT = () => {
  const file = JSON.parse(JSON.stringify(RDP_FILE)) as typeof RDP_FILE;
  file.legs.implement = { from: ['filed'], to: 'lab', requires: { capabilities: [] } };
  return file;
};

/** docs' board: RDP1 and RDP2 on the lab course, REQ (its posted requires names the lab on a leg
 * that does not) — the normative shape (§7.1) through the Git helper. */
function docsGit(file = RDP_FILE) {
  const g = new Git();
  g.registry = [rdpCourse(file)];
  g.add('RDP1', { course_id: 'rdp-course', title: 'one lab ticket' }, placed('filed', [], [['implement', 'ready']]));
  g.add('RDP2', { course_id: 'rdp-course', title: 'another lab ticket' }, placed('filed', [], [['implement', 'ready']]));
  g.add('REQ', { course_id: 'rdp-course', title: 'the ticket clause names the lab', requires: [CAP] },
    placed('review', [['implement', 'lab'], ['review', 'review']], [['merge', 'ready']]));
  return g;
}
/** ops' board: the same course, one lab ticket and one already past the lab (the candidate that
 * needs no RDP — prefer's second, taken by a claim without an id until R3-1269 builds prefer). */
async function opsGit() {
  const g = new Git(await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' }));
  g.registry = [rdpCourse()];
  g.add('RDP-OPS', { course_id: 'rdp-course', title: 'ops lab ticket' }, placed('filed', [], [['implement', 'ready']]));
  g.add('NOP-OPS', { course_id: 'rdp-course', title: 'past the lab' }, placed('review', [['implement', 'lab'], ['review', 'review']], [['merge', 'ready']]));
  return g;
}

/** A worker call signed by `key`, with its secret after the first heartbeat. */
async function workerAs(key: TestKey, path: string, body?: unknown, secret?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const req = await signedRequest(key, ORIGIN + path, { created, body: body === undefined ? undefined : JSON.stringify(body), headers: secret ? { 'X-Worker-Secret': secret } : {} });
  const res = await hostCall(req);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** Register a granted key as a worker declaring the lab; returns its id and secret. */
async function up(key: TestKey, hostname: string, name: string, repository: string, over: Record<string, unknown> = {}) {
  const secret = `secret-${name}`;
  const hb = await workerAs(key, '/v1/runner/heartbeat', {
    hostname, session_name: name, harness: 'opencode', kind: 'vm', billing: {}, capabilities: [CAP],
    tier_ceiling: 'critical', lease_timeout_s: 900, courses: [{ repository, course: 'rdp-course', version: 1 }],
    secret_hash: await sha256(secret), ...over,
  });
  expect(hb.status).toBe(200);
  return { id: hb.json.worker_id as number, secret };
}

const claimAs = (key: TestKey, secret: string, body: Record<string, unknown>) => workerAs(key, '/v1/runner/claim', { request_id: requestId(), ...body }, secret);
const advanceAs = (key: TestKey, secret: string, claimId: number, body: Record<string, unknown>) => workerAs(key, `/v1/runner/claims/${claimId}/advance`, body, secret);
const endAs = (key: TestKey, secret: string, claimId: number, body: Record<string, unknown>) => workerAs(key, `/v1/runner/claims/${claimId}/end`, body, secret);

/** The capabilities a claim holds seats on, in id order. */
const seatsOf = async (claimId: number) => (await rows<{ capability: string }>('SELECT capability FROM claim_seats WHERE claim_id = ? ORDER BY capability', claimId)).map((r) => r.capability);
/** What a worker is recommended, in order (R-BTN-45). */
const recommendedBy = (workerId: number) => withCore((core) => (core.claims as unknown as { recommendations: (id: number, l: number) => { recommendations: { ticket_id: string }[] } })
  .recommendations(workerId, 10).recommendations.map((r) => r.ticket_id));

/** docs' board, kept for the mid-leg snapshot of the third test. */
let docs: Git;
beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ecdsa-sha2-nistp256', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  w1 = await makeKey('ssh-ed25519', 'w1');
  w2 = await makeKey('sk-ssh-ed25519@openssh.com', 'w2');
  w3 = await makeKey('ssh-ed25519', 'w3');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  // W1 and W3 work docs, W2 ops (R-BTN-58); all three are granted the lab.
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: w1.publicKey, hostname: 'vm-12', capabilities: [CAP] })).status).toBe(200);
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: w3.publicKey, hostname: 'vm-14', capabilities: [CAP] })).status).toBe(200);
  expect((await keyCall(opsOwner, '/v1/owner/ops/grants', { public_key: w2.publicKey, hostname: 'vm-13', capabilities: [CAP] })).status).toBe(200);
  docs = docsGit();
  const dpost = await docs.post();
  if (dpost.status !== 200) throw new Error(`docs post: ${JSON.stringify(dpost)}`);
  const opost = await (await opsGit()).post();
  if (opost.status !== 200) throw new Error(`ops post: ${JSON.stringify(opost)}`);
  await cutover(1, 'docs');
  await cutover(1, 'ops');
  // R-BTN-178: an administrator sets the lab's capacity to 1.
  expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: 1 }, 'PUT')).status).toBe(200);
});

describe('S-BTN-21 capacity (R-BTN-178)', () => {
  it('the read the confirm prints: every course whose legs require the capability, with the type', async () => {
    const view = await keyCall(admin, `/v1/admin/capacities?capability=${encodeURIComponent(CAP)}`);
    expect(view.status).toBe(200);
    // Both repositories' courses require it on implement and review, with the type's definition.
    expect(view.json.requiring).toEqual([
      { repository: 'docs', course: 'rdp-course', version: 1, legs: ['implement', 'review'], type: { description: 'a thing a leg may need', values: '^[-a-z0-9]{1,64}$' } },
      { repository: 'ops', course: 'rdp-course', version: 1, legs: ['implement', 'review'], type: { description: 'a thing a leg may need', values: '^[-a-z0-9]{1,64}$' } },
    ]);
    expect(view.json.capacities).toEqual([{ capability: CAP, capacity: 1, set_by: `admin:${admin.fingerprint}`, set_at: T0 }]);
    // Setting is an admin event (R-BTN-57).
    expect(await rows(`SELECT detail_json FROM events WHERE kind = 'admin' AND json_extract(detail_json, '$.act') = 'capacity-set'`))
      .toEqual([{ detail_json: JSON.stringify({ act: 'capacity-set', capability: CAP, capacity: 1 }) }]);
  });

  it('one capacity-1 capability has one holder across every repository, whatever claims next', async () => {
    const W1 = await up(w1, 'vm-12', 'w1', 'docs');
    const W2 = await up(w2, 'vm-13', 'w2', 'ops');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:RDP1' });
    expect(c1.status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([CAP]); // the claim holds the seat

    // W2, in another repository, claiming the lab ticket by id: rule 11, never a failed attempt,
    // and no holder named (W2's key is granted on ops alone; W1's claim is docs').
    const refused = await claimAs(w2, W2.secret, { ticket_id: 'ops:RDP-OPS' });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: 'capacity-full', rule: 11, rule_code: 'capacity-full', capability: CAP });
    expect(refused.json.message).not.toContain('claim ');
    expect((await rows(`SELECT id FROM claims WHERE ticket_id = 'ops:RDP-OPS'`))).toEqual([]);
    expect(await withCore((core) => (core.claims as unknown as { failedAttempts: (t: string) => number[] }).failedAttempts('ops:RDP-OPS'))).toEqual([]);

    // The recommendations omit the full leg and offer the candidate that needs no RDP — what a
    // `prefer` claim walks (R-BTN-100's fall-through is R3-1269's, not built).
    expect(await recommendedBy(W2.id)).toEqual(['ops:NOP-OPS']);
    const took = await claimAs(w2, W2.secret, {});
    expect(took.status).toBe(200);
    expect(took.json.ticket_id).toBe('ops:NOP-OPS');
    expect(await seatsOf(took.json.claim_id)).toEqual([]);
    expect((await endAs(w2, W2.secret, took.json.claim_id, { status: 'released', end_reason: 'released:requested', reached: 'review' })).status).toBe(200);

    // Where the caller's key IS granted on the holder's repository, the holders are named —
    // hostnames and tickets both (R-BTN-99, R-BTN-178); W3, granted on docs, sees W1's claim.
    const W3 = await up(w3, 'vm-14', 'w3', 'docs');
    const named = await claimAs(w3, W3.secret, { ticket_id: 'docs:RDP2' });
    expect(named.status).toBe(409);
    expect(named.json).toMatchObject({ code: 'capacity-full', rule: 11 });
    expect(named.json.message).toContain(`claim ${c1.json.claim_id} on docs:RDP1 by vm-12`);

    // W1's own seat never refuses its advance into the other RDP leg, and the advance into
    // `merge` releases it.
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { leg: 'implement' })).status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([CAP]);
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { reached: 'lab', leg: 'review' })).status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([CAP]); // rewritten, the same set
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { reached: 'review', leg: 'merge' })).status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([]); // a leg not requiring it releases it
    expect((await endAs(w1, W1.secret, c1.json.claim_id, { status: 'completed', end_reason: 'done', reached: 'done' })).status).toBe(200);
  });

  it('a snapshot mid-leg changing the leg\'s requires changes no held seat', async () => {
    const W1 = await up(w1, 'vm-12', 'w1', 'docs');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:RDP1' });
    expect(c1.status).toBe(200);
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { leg: 'implement' })).status).toBe(200);
    // A snapshot whose course file drops the lab from the running leg: the held seat stands.
    docs.registry = [rdpCourse(NO_RDP_ON_IMPLEMENT())];
    expect((await docs.post()).status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([CAP]);
    // ... and the advance into `review`, still requiring it, keeps holding it.
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { reached: 'lab', leg: 'review' })).status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([CAP]);
  });

  it('a force-reap keeps the seat until the fence clears; a silent reap frees it at once', async () => {
    const W1 = await up(w1, 'vm-12', 'w1', 'docs');
    const W2 = await up(w2, 'vm-13', 'w2', 'ops');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:RDP1' });
    expect(c1.status).toBe(200);
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { leg: 'implement' })).status).toBe(200);
    // The owner force-reaps W1's live claim: fenced, the seat waits for the incarnation (§9.5).
    // (The dashboard under an administrator's key takes a session, R-BTN-56.)
    const session = await adminSession(admin);
    const reap = await sessionCall(session, `/v1/ui/claims/${c1.json.claim_id}/reap`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ confirm: true }) });
    expect(reap.status).toBe(200);
    expect(await reap.json()).toMatchObject({ fence_pending: true });
    expect(await seatsOf(c1.json.claim_id)).toEqual([CAP]);
    // W2 is still refused, the fence-pending holder keeping its seat.
    expect((await claimAs(w2, W2.secret, { ticket_id: 'ops:RDP-OPS' })).status).toBe(409);
    // The sidecar reports the fence: the seat releases with it.
    const cleared = await workerAs(w1, '/v1/runner/heartbeat', {
      hostname: 'vm-12', session_name: 'w1', harness: 'opencode', kind: 'vm', billing: {}, capabilities: [CAP],
      tier_ceiling: 'critical', lease_timeout_s: 900, courses: [{ repository: 'docs', course: 'rdp-course', version: 1 }],
      fenced: { claim_id: c1.json.claim_id, terminated: true },
    }, W1.secret);
    expect(cleared.status).toBe(200);
    expect(await seatsOf(c1.json.claim_id)).toEqual([]);
    const took = await claimAs(w2, W2.secret, { ticket_id: 'ops:RDP-OPS' });
    expect(took.status).toBe(200);
    expect(await seatsOf(took.json.claim_id)).toEqual([CAP]);

    // A silent reap — W2 stops beating, its lease lapses — frees the seat at once (not fenced).
    await setClock(T0 + 2 * 3_600_000);
    await tick();
    expect((await rows<{ status: string }>('SELECT status FROM claims WHERE id = ?', took.json.claim_id))[0].status).toBe('reaped');
    expect(await seatsOf(took.json.claim_id)).toEqual([]);
    const again = await claimAs(w1, W1.secret, { ticket_id: 'docs:RDP2' });
    expect(again.status).toBe(200);
  });

  it('a fence that lapses by time releases the seat with it (the alarm, not the sidecar)', async () => {
    const W1 = await up(w1, 'vm-12', 'w1', 'docs');
    const W3 = await up(w3, 'vm-14', 'w3', 'docs');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:RDP1' });
    expect(c1.status).toBe(200);
    expect((await advanceAs(w1, W1.secret, c1.json.claim_id, { leg: 'implement' })).status).toBe(200);
    // Force-reaped while alive: fenced, the seat kept, W3 refused.
    const session = await adminSession(admin);
    const reap = await sessionCall(session, `/v1/ui/claims/${c1.json.claim_id}/reap`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ confirm: true }) });
    expect(await reap.json()).toMatchObject({ fence_pending: true });
    expect((await claimAs(w3, W3.secret, { ticket_id: 'docs:RDP2' })).status).toBe(409);
    // No fence report ever comes: W1 goes silent, its own lease timeout lapses, and the alarm's
    // fence deadline releases the seat (R-BTN-19, R-BTN-178).
    await setClock(T0 + 2 * 3_600_000);
    await tick();
    expect((await rows<{ fence_pending: number }>('SELECT fence_pending FROM claims WHERE id = ?', c1.json.claim_id))[0].fence_pending).toBe(0);
    expect(await seatsOf(c1.json.claim_id)).toEqual([]);
    const took = await claimAs(w3, W3.secret, { ticket_id: 'docs:RDP2' });
    expect(took.status).toBe(200);
  });

  it('raising the capacity seats two, lowering takes no seat back and refuses the next', async () => {
    expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: 2 }, 'PUT')).status).toBe(200);
    const W1 = await up(w1, 'vm-12', 'w1', 'docs');
    const W2 = await up(w2, 'vm-13', 'w2', 'ops');
    const W3 = await up(w3, 'vm-14', 'w3', 'docs');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:RDP1' });
    const c2 = await claimAs(w2, W2.secret, { ticket_id: 'ops:RDP-OPS' });
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect((await rows<{ n: number }>('SELECT count(*) AS n FROM claim_seats WHERE capability = ?', CAP))[0].n).toBe(2);
    // Lowered below the seats held: none taken back, the next claim refused.
    expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: 1 }, 'PUT')).status).toBe(200);
    expect((await rows<{ n: number }>('SELECT count(*) AS n FROM claim_seats WHERE capability = ?', CAP))[0].n).toBe(2);
    const refused = await claimAs(w3, W3.secret, { ticket_id: 'docs:RDP2' });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: 'capacity-full', rule: 11 });
  });

  it('a ticket whose posted requires names the lab, on a leg that does not, is seated', async () => {
    const W1 = await up(w1, 'vm-12', 'w1', 'docs');
    const W2 = await up(w2, 'vm-13', 'w2', 'ops');
    const c1 = await claimAs(w1, W1.secret, { ticket_id: 'docs:RDP1' });
    expect(c1.status).toBe(200);
    // REQ's queued leg (`merge`) requires nothing; its ticket's clause requires the lab — the
    // rule-4 set is both, so its claim would be seated, and W2's is refused while W1 holds.
    expect((await claimAs(w2, W2.secret, { ticket_id: 'ops:RDP-OPS' })).status).toBe(409);
    expect((await endAs(w1, W1.secret, c1.json.claim_id, { status: 'released', end_reason: 'released:requested', reached: 'filed' })).status).toBe(200);
    const req = await claimAs(w1, W1.secret, { ticket_id: 'docs:REQ' });
    expect(req.status).toBe(200);
    expect(await seatsOf(req.json.claim_id)).toEqual([CAP]);
    // Seated on the clause alone, it refuses the lab to everyone else.
    expect((await claimAs(w2, W2.secret, { ticket_id: 'ops:RDP-OPS' })).status).toBe(409);
  });

  it('a capacity is refused its invalid names and out-of-range numbers', async () => {
    for (const body of [
      { capability: 'agent-venue', capacity: 1 }, // a role names no thing
      { capability: 'human-operator', capacity: 1 }, // the built-in's own statement
      { capability: 'credential:DEPLOY_TOKEN', capacity: 1 }, // a secret this runner alone receives
      { capability: 'runner:vm-12', capacity: 1 }, // per runner identity
      { capability: 'capability:*', capacity: 1 }, // a grant's wildcard, not a thing
      { capability: 'capability:rdp-lab', capacity: 0 },
      { capability: 'capability:rdp-lab', capacity: 65 },
      { capability: 'capability:rdp-lab', capacity: 'one' },
      { capability: 'capability:rdp-lab' },
      { capability: 'capability:rdp-lab', capacity: 1, extra: true },
    ]) {
      const res = await keyCall(admin, '/v1/admin/capacities', body, 'PUT');
      expect({ body, status: res.status, code: res.json.code }).toMatchObject({ status: 400, code: 'invalid-params' });
    }
    // The owner's key is no administrator's (R-BTN-57).
    expect((await keyCall(docsOwner, '/v1/admin/capacities', { capability: CAP, capacity: 1 }, 'PUT')).status).toBe(403);
    // Clearing: the capability's seats become unlimited again.
    expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: null }, 'PUT')).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/capacities')).json).toEqual({ capacities: [] });
  });
});
