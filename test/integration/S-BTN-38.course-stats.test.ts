// S-BTN-38 a course measures itself (BATON_SPEC §13a, §2d, §11; R3-1248): after a claim runs legs,
// suspends and another resumes and gives the ticket back, a worker key granted on docs reads
// `GET /v1/repositories/docs/stats`; an `ops`-only key tries the same. Must hold: docs' key gets
// leg wait and run times, ends by reason and detail, suspensions by station and overridden advice,
// with no worker, profile or report in it; the `ops` key is refused `forbidden`. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { advance, claimItem, cutover, endClaim, Git, keyCall, ORIGIN, placed, register, setAdminKeys, setClock, withCore, workerCall } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
let docsKey: TestKey;
let opsKey: TestKey;
let git: Git;

/** `GET path`, signed by `key`. */
async function readAs(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  const opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  docsKey = await makeKey('ssh-ed25519', 'docs-reader');
  opsKey = await makeKey('ssh-ed25519', 'ops-reader');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: docsKey.publicKey, hostname: 'docs-host', capabilities: ['agent-venue'] })).status).toBe(200);
  expect((await keyCall(opsOwner, '/v1/owner/ops/grants', { public_key: opsKey.publicKey, hostname: 'ops-host', capabilities: ['agent-venue'] })).status).toBe(200);
  git = new Git().add('T-1', { rank: 1 }).add('T-2', { rank: 2 });
  await git.post();
  await cutover();
});

describe('S-BTN-38 a course measures itself', () => {
  it('a key granted on docs reads its course record — aggregates and ids, no worker; an ops-only key is forbidden', async () => {
    // One claim runs implement for 20 minutes and suspends at pr-open, waiting on CI.
    const w1 = await register('vm-a');
    const { json: c1 } = await claimItem('vm-a', w1.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', w1.secret, c1.claim_id, { leg: 'implement' })).status).toBe(200);
    await setClock(T0 + 20 * MIN);
    expect((await endClaim('vm-a', w1.secret, c1.claim_id, { end_reason: 'suspended:pr-open', reached: 'pr-open', detail: 'waiting on ci' })).status).toBe(200);
    git.place('T-1', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    expect(await git.post()).toMatchObject({ status: 200, confirmed: 1 });
    // Ten minutes later another worker takes it up, reviews for 30 minutes and gives it back.
    await setClock(T0 + 30 * MIN);
    const w2 = await register('vm-b');
    const { json: c2 } = await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-1' });
    expect(c2.claim_id).toBeTruthy();
    expect((await advance('vm-b', w2.secret, c2.claim_id, { leg: 'review' })).status).toBe(200);
    await setClock(T0 + 60 * MIN);
    expect((await endClaim('vm-b', w2.secret, c2.claim_id, { end_reason: 'released:requested' })).status).toBe(200);

    const r = await readAs(docsKey, '/v1/repositories/docs/stats');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      ok: true, repository: 'docs',
      courses: { 'roadmap-pr': {
        // implement: the ticket's first claim, so no arrival to measure a wait from; review waited
        // the ten minutes between the suspension and the next claim. Ready now: T-1's review
        // since the post at +20 min, T-2's implement since the first post.
        legs: { implement: { started: 1, finished: 1, abandoned: 0, waited: { count: 0 }, ran: { count: 1, median_s: 1200, max_s: 1200 }, ready_now: { tickets: 1, oldest_s: 3600 } },
          review: { started: 1, finished: 0, abandoned: 1, waited: { count: 1, median_s: 600, max_s: 600 }, ran: { count: 0 }, ready_now: { tickets: 1, oldest_s: 2400 } } },
        stations: { 'pr-open': { waited: { count: 1, median_s: 600, max_s: 600 } } },
      } },
      suspensions: [{ station: 'pr-open', detail: 'waiting on ci', claims: 1 }],
      advice_overridden: { count: 0, tickets: [] }, hook_failures: [], off_graph: { count: 0, tickets: [] }, foreign_writes: { count: 0, tickets: [] },
    });
    expect(r.json.ends).toEqual(expect.arrayContaining([
      { end_reason: 'suspended:pr-open', detail: 'waiting on ci', claims: 1 },
      { end_reason: 'released:requested', detail: null, claims: 1 },
    ]));
    // Aggregates and ids only: no worker, hostname, key or session in it.
    const text = JSON.stringify(r.json);
    for (const s of ['worker', 'vm-a', 'vm-b', 'host', docsKey.fingerprint, 'session']) expect(text).not.toContain(s);
    // A window that starts after the work holds none of it.
    await setClock(T0 + 90 * MIN);
    expect((await readAs(docsKey, `/v1/repositories/docs/stats?since=${new Date(T0 + 61 * MIN).toISOString()}`)).json).toMatchObject({ ends: [], suspensions: [], courses: {} });

    // Overridden advice and an off-graph post are counted, with the ticket they name: W3 claims
    // T-2 over the first recommendation, and the sync then posts a path T-2 could not have run.
    await git.refresh(); // a reading after T-1's last end: claimable again, and first in the order
    const w3 = await register('test');
    const { json: c3 } = await claimItem('test', w3.secret, { ticket_id: 'docs:T-2' });
    expect(c3.claim_id).toBeTruthy();
    git.place('T-2', placed('reviewed', [['review', 'reviewed']], [['merge', 'ready']]));
    expect(await git.post()).toMatchObject({ status: 200 });
    expect((await readAs(docsKey, `/v1/repositories/docs/stats?since=${new Date(T0 + 61 * MIN).toISOString()}`)).json).toMatchObject({
      advice_overridden: { count: 1, tickets: ['docs:T-2'] }, off_graph: { count: 1, tickets: ['docs:T-2'] } });

    // Refused: the ops-only key; a bearer (seed) worker key, which has no grant (round 1, 1-A-0);
    // an unsigned call; a malformed window and a malformed segment. An unknown repository is not-found.
    expect(await readAs(opsKey, '/v1/repositories/docs/stats')).toMatchObject({ status: 403, json: { code: 'forbidden' } });
    expect((await workerCall('/v1/repositories/docs/stats', { cred: 'vm-a' })).status).toBe(403);
    expect((await hostCall(new Request(`${ORIGIN}/v1/repositories/docs/stats`))).status).toBe(401);
    expect((await workerCall('/v1/repositories/nope/stats', { cred: 'vm-a' })).status).toBe(404);
    expect((await readAs(docsKey, '/v1/repositories/docs/stats?since=yesterday')).json).toMatchObject({ code: 'invalid-params' });
    expect(await readAs(docsKey, '/v1/repositories/%zz/stats')).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
  });
});
