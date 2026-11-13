// B-175, the check conclusions built (BATON_SPEC §10 R-BTN-153 "Mapping the status", §9.4's
// `exit_status`, §15 S-BTN-68's slice; G-BTN-93): in a course the owners' `checks` map names,
// only the check command's exit status reaches the station mapped `success` — an advance or a
// completed end arriving there carries `exit_status: 0`, which Baton requires, so an agent's
// `baton-leg-result` or channel `done`, which carries none, reaches only `failure` or
// `timed_out` stations, and no conclusion passes a required check but a command's green exit. A
// `0` belongs to the success station alone, and a timeout or an `exec` error — which has no exit
// status — reaches `timed_out`, or `failure` where no station is mapped to it. The map's own
// validation (one `success`, one `failure`, at most one `timed_out`, never `neutral`) is B-169's
// build (test/integration/B-169.security-corrections.test.ts); the check runner that runs the
// command first and the `forge-check` deliverer that posts the conclusion are B-46's and B-64's.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { call as hostCall } from '#host';
import { advance, claimItem, claimRow, cutover, endClaim, Git, keyCall, ORIGIN, placed, register, rows, setAdminKeys, setClock, syncToken, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-04T12:00:00Z');
const OPS_SYNC = { repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' };

/** A check course whose three ends an owners' map names — B-169's, so the two tests read the
 *  same course. The runner half of R-BTN-153 (`check_command`, the command run first) is B-46's
 *  build; this ticket's is what Baton does with the arrival. */
const CHECK_COURSE = {
  start: 'filed',
  start_leg: 'check',
  end: ['passed', 'failed', 'hung'],
  stations: { filed: { label: 'Filed' }, passed: { label: 'Passed' }, failed: { label: 'Failed' }, hung: { label: 'Hung' } },
  legs: { check: { from: ['filed'], to: ['passed', 'failed', 'hung'] } },
};
const PASS = { passed: 'success', failed: 'failure', hung: 'timed_out' };
const FILED = placed('filed', [], [['check', 'ready']]);

/** A course for the one way an advance can arrive at a mapped station: the map named `passed`
 *  while it was an end (v1), then the course grew a leg out of it (v2) — a stale map's station
 *  is no longer terminal, so the arrival is an advance's `reached`, and it carries the command's
 *  `exit_status: 0` or is refused (R-BTN-153's "an `advance` or end"). */
const PROBE_V1 = {
  start: 'filed',
  start_leg: 'run',
  end: ['passed', 'failed'],
  stations: { filed: { label: 'Filed' }, passed: { label: 'Passed' }, failed: { label: 'Failed' } },
  legs: { run: { from: ['filed'], to: ['passed', 'failed'] } },
};
const PROBE_V2 = {
  ...PROBE_V1,
  end: ['shipped', 'failed'],
  stations: { ...PROBE_V1.stations, shipped: { label: 'Shipped' } },
  legs: { ...PROBE_V1.legs, file: { from: ['passed'], to: ['shipped'] } },
};

let owner: TestKey;
let git: Git;

/** A signed call by an arbitrary key, with a body as given (`undefined`: none). */
async function as(key: TestKey, path: string, body?: unknown, method?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, method, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  { const reg = await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', forge: 'github', remote: 'ssh://git@github.com/immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', sync_keys: [], owner_keys: [owner.publicKey] }); expect(reg.status).toBe(200); }
  git = new Git(await syncToken(OPS_SYNC));
  git.registry = [{ id: 'check', version: 1, min_worker_version: 1, skill: 'next-roadmap-item', course: CHECK_COURSE, step_kinds: ['implement'], branch_pattern: 'claude/{ticket}-*' }];
  for (const id of ['check.1', 'check.2', 'check.3']) git.add(id, { course_id: 'check' }, FILED);
  expect((await git.post()).status).toBe(200);
  await cutover(1, 'ops');
});

/** A claim of `ticket` held to its `check` leg, ready to arrive. */
async function held(w: { secret: string }, ticket: string) {
  const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: `ops:${ticket}` });
  expect(c.claim_id).toBeTypeOf('number');
  expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'check' })).status).toBe(200);
  return { secret: w.secret, claimId: c.claim_id as number };
}

/** A check worker of `ops`, its one session registered once per test. */
const checkWorker = () => register('vm-a', { courses: [{ repository: 'ops', course: 'check', version: 1 }] });

describe('B-175 the check conclusions', () => {
  it('no owners’ map, or one that names another course: any done stands', async () => {
    // The map names only `probe`, so `check`'s stations are ordinary ones.
    git.registry = [...git.registry, { id: 'probe', version: 1, min_worker_version: 1, skill: 'next-roadmap-item', course: PROBE_V1, step_kinds: ['implement'], branch_pattern: 'claude/{ticket}-*' }];
    expect((await git.post()).status).toBe(200);
    expect((await as(owner, '/v1/owner/ops/settings', { checks: { probe: { conclusions: { passed: 'success', failed: 'failure' } } } }, 'PUT')).status).toBe(200);
    const { secret, claimId } = await held(await checkWorker(), 'check.1');
    const out = await endClaim('vm-a', secret, claimId, { end_reason: 'done', reached: 'passed' });
    expect([out.status, (await claimRow(claimId)).status]).toEqual([200, 'completed']);
  });

  it('a success-mapped station is the check command’s alone: an agent’s done, or a numbered exit, is refused; exit_status: 0 lands', async () => {
    expect((await as(owner, '/v1/owner/ops/settings', { checks: { check: { conclusions: PASS } } }, 'PUT')).status).toBe(200);
    const w = await checkWorker();
    const { secret, claimId } = await held(w, 'check.1');
    // An agent's `baton-leg-result` or channel `done` carries no exit status.
    const agent = await endClaim('vm-a', secret, claimId, { end_reason: 'done', reached: 'passed' });
    expect([agent.status, agent.json.code, String(agent.json.message).startsWith('exit_status:')]).toEqual([400, 'invalid-params', true]);
    // A refusal changes nothing: the claim is still held, still active.
    expect((await claimRow(claimId)).status).toBe('active');
    // Nor does a red command's exit buy the green station — nor a suspension's arrival.
    expect((await endClaim('vm-a', secret, claimId, { end_reason: 'done', reached: 'passed', exit_status: 1 })).status).toBe(400);
    expect((await endClaim('vm-a', secret, claimId, { end_reason: 'suspended:passed' })).status).toBe(400);
    // The command's own green exit is the one arrival that stands.
    const done = await endClaim('vm-a', secret, claimId, { end_reason: 'done', reached: 'passed', exit_status: 0 });
    expect([done.status, (await claimRow(claimId)).status]).toEqual([200, 'completed']);
  });

  it('failure and timed_out stations take an agent’s done; a 0 exit belongs to success, a numbered exit to failure, a timeout to neither', async () => {
    expect((await as(owner, '/v1/owner/ops/settings', { checks: { check: { conclusions: PASS } } }, 'PUT')).status).toBe(200);
    // An agent's done toward a timed_out station — and toward a failure one — stands.
    const w = await checkWorker();
    for (const [ticket, body] of [['check.1', { end_reason: 'done', reached: 'hung' }], ['check.2', { end_reason: 'done', reached: 'failed', exit_status: 2 }]] as const) {
      const { secret, claimId } = await held(w, ticket);
      const out = await endClaim('vm-a', secret, claimId, body);
      expect([ticket, out.status, (await claimRow(claimId)).status]).toEqual([ticket, 200, 'completed']);
    }
    // A green exit never names a red station, and a timeout or exec error — which carries no
    // exit status — is the only arrival at a timed_out one.
    const { secret, claimId } = await held(w, 'check.3');
    for (const body of [
      { end_reason: 'done', reached: 'failed', exit_status: 0 },
      { end_reason: 'done', reached: 'hung', exit_status: 0 },
      { end_reason: 'done', reached: 'hung', exit_status: 7 },
    ]) expect([JSON.stringify(body), (await endClaim('vm-a', secret, claimId, body)).status]).toEqual([JSON.stringify(body), 400]);
    expect((await claimRow(claimId)).status).toBe('active');
  });

  it('a map without timed_out: the unmapped station is not constrained here; success stays the command’s', async () => {
    expect((await as(owner, '/v1/owner/ops/settings', { checks: { check: { conclusions: { passed: 'success', failed: 'failure' } } } }, 'PUT')).status).toBe(200);
    // The runner maps a timeout to `failure` where no `timed_out` station is named (R-BTN-153);
    // the core holds no constraint on a station the map does not name.
    const w = await checkWorker();
    const hung = await held(w, 'check.1');
    expect((await endClaim('vm-a', hung.secret, hung.claimId, { end_reason: 'done', reached: 'hung' })).status).toBe(200);
    const passed = await held(w, 'check.2');
    expect((await endClaim('vm-a', passed.secret, passed.claimId, { end_reason: 'done', reached: 'passed' })).status).toBe(400);
  });

  it('an advance arriving at a success-mapped station — a stale map’s, the course having grown a leg out of it — carries exit_status: 0', async () => {
    const probeAt = (version: number, course: unknown) => ({ id: 'probe', version, min_worker_version: 1, skill: 'next-roadmap-item', course, step_kinds: ['implement'], branch_pattern: 'claude/{ticket}-*' });
    git.registry = [...git.registry, probeAt(1, PROBE_V1)];
    expect((await git.post()).status).toBe(200);
    // The map is validated against v1, where `passed` is an end; then v2 makes it a station a
    // leg leaves, so an advance can arrive at it.
    expect((await as(owner, '/v1/owner/ops/settings', { checks: { probe: { conclusions: { passed: 'success', failed: 'failure' } } } }, 'PUT')).status).toBe(200);
    git.registry = git.registry.map((e) => (e as { id: string }).id === 'probe' ? probeAt(2, PROBE_V2) : e);
    git.add('probe.1', { course_id: 'probe' }, placed('filed', [], [['run', 'ready']]));
    expect((await git.post()).status).toBe(200);
    const w = await register('vm-a', { courses: [{ repository: 'ops', course: 'check', version: 1 }, { repository: 'ops', course: 'probe', version: 2 }] });
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'ops:probe.1' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'run' })).status).toBe(200);
    const arrive = { reached: 'passed', leg: 'file' };
    const refused = await advance('vm-a', w.secret, c.claim_id, arrive);
    expect([refused.status, refused.json.code, String(refused.json.message).startsWith('exit_status:')]).toEqual([400, 'invalid-params', true]);
    expect((await rows<{ leg: string }>('SELECT leg FROM claims WHERE id = ?', c.claim_id)).map((r) => r.leg)).toEqual(['run']);
    expect((await advance('vm-a', w.secret, c.claim_id, { ...arrive, exit_status: 0 })).status).toBe(200);
  });

  it('exit_status is an integer from 0 to 255, whatever the map', async () => {
    const { secret, claimId } = await held(await checkWorker(), 'check.1');
    for (const exit_status of [256, -1, '0', 1.5]) {
      const out = await endClaim('vm-a', secret, claimId, { end_reason: 'done', reached: 'failed', exit_status });
      expect([JSON.stringify(exit_status), out.status, out.json.code, String(out.json.message).startsWith('exit_status:')]).toEqual([JSON.stringify(exit_status), 400, 'invalid-params', true]);
    }
    expect((await endClaim('vm-a', secret, claimId, { end_reason: 'done', reached: 'failed', exit_status: 255 })).status).toBe(200);
  });
});
