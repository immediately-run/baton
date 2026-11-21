// S-BTN-61 / G-BTN-88: shared readings and seats, with grant-scoped disclosure.
import { beforeEach, expect, it } from 'vitest';
import { call as hostCall } from '#host';
import { cutover, Git, keyCall, ORIGIN, requestId, rows, setAdminKeys, setClock, syncToken, tick, withCore } from '../helpers';
import { grantedRunner, SCHEMA } from '../lib/fleet';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-21T12:00:00Z');
const FLEET = '/v1/runner/fleet?repository=docs';
const INSTANCES = '/v1/runner/instances';
const CAP = 'capability:rdp-lab';
const ACCOUNT = 'account:shared';
let admin: TestKey;
let docsOwner: TestKey;
let batonOwner: TestKey;

async function read(key: TestKey, path: string, tag?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  return hostCall(await signedRequest(key, ORIGIN + path, { created, headers: tag ? { 'If-None-Match': tag } : {} }));
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'views-admin');
  docsOwner = await makeKey('ssh-ed25519', 'views-docs-owner');
  batonOwner = await makeKey('ssh-ed25519', 'views-baton-owner');
  await setAdminKeys(admin);
  for (const [repo, owner] of [['docs', docsOwner], ['baton', batonOwner]] as const) {
    expect((await keyCall(admin, '/v1/admin/repositories', { id: repo, owner_keys_add: [owner.publicKey] })).status).toBe(200);
  }
});

it('S-BTN-61: keeps both readings, scopes fleet claims and redacts foreign seat holders', async () => {
  const token = await syncToken({ repository: 'immediately-run/baton', job_workflow_ref: 'immediately-run/baton/.github/workflows/baton-sync.yml@refs/heads/main' });
  expect((await new Git().add('OWN', { requires: [CAP] }).add('OTHER', { requires: [CAP] }).post({ course_data: { 'roadmap-pr': { hello: true } } })).status).toBe(200);
  expect((await new Git(token).add('FOREIGN', { requires: [CAP] }).post()).status).toBe(200);
  await cutover(); await cutover(1, 'baton');
  const docs = await grantedRunner(docsOwner, 'docs', 'views-docs', ['agent-venue', CAP]);
  const baton = await grantedRunner(batonOwner, 'baton', 'views-baton', ['agent-venue', CAP]);
  const thirdOwner = await makeKey('ssh-ed25519', 'views-third-owner');
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [thirdOwner.publicKey] })).status).toBe(200);
  const neither = await grantedRunner(thirdOwner, 'ops', 'views-neither', []);
  expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: 2 }, 'PUT')).status).toBe(200);
  const own = await docs.call('/v1/runner/claim', { request_id: requestId(), ticket_id: 'docs:OWN', rationale: 'do not serve this' });
  expect(own.status).toBe(200);
  expect((await baton.call('/v1/runner/claim', { request_id: requestId(), ticket_id: 'baton:FOREIGN' })).status).toBe(200);
  expect((await docs.beat({ profile: { shape: 3 }, reports: [{ claim_id: own.json.claim_id, payload: { spent: 1 } }, { repository: 'docs', key: 'peer', payload: 2 }, { repository: 'baton', payload: 3 }] })).json.reports_refused).toEqual([2]);
  const fleet = await read(docs.key, FLEET);
  expect(fleet.status).toBe(200);
  const fleetBody = await fleet.text();
  expect(fleetBody).not.toMatch(/FOREIGN|views-baton-host|do not serve this/);
  expect(JSON.parse(fleetBody)).toMatchObject({ claims: [{ ticket_id: 'docs:OWN', runner: { profile: { shape: 3 } }, reports: [{ payload: { spent: 1 } }] }], reports: [{ payload: 2 }], course_data: { 'roadmap-pr': { hello: true } } });
  expect((await read(baton.key, FLEET, fleet.headers.get('ETag')!)).status).toBe(403);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'llm:shared', scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/instances', { name: ACCOUNT, serves: ['llm:shared'], repositories: ['docs', 'baton'] })).status).toBe(200);
  const outside = await read(neither.key, INSTANCES);
  expect(outside.status).toBe(200);
  expect(await outside.json()).toMatchObject({ instances: [] });
  expect(await neither.call('/v1/runner/readings', { readings: [{ instance: ACCOUNT, kind: 'measure', detail: { used: 3 } }] }))
    .toEqual({ status: 200, json: { ok: true, refused: [{ instance: ACCOUNT, code: 'forbidden' }] } });
  for (const [runner, used] of [[docs, 1], [baton, 2]] as const) {
    expect((await runner.call('/v1/runner/readings', { readings: [{ instance: ACCOUNT, kind: 'measure', detail: { used } }] })).json).toEqual({ ok: true, refused: [] });
  }
  for (const [runner, theirs, foreign] of [[docs, 'docs:OWN', 'baton:FOREIGN'], [baton, 'baton:FOREIGN', 'docs:OWN']] as const) {
    const res = await read(runner.key, INSTANCES);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(foreign);
    expect(body).not.toContain(runner === docs ? baton.hostname : docs.hostname);
    expect(JSON.parse(body)).toMatchObject({ instances: [{ name: ACCOUNT, state: 'unknown', readings: expect.arrayContaining([
      { source: `runner:${docs.id}`, kind: 'measure', detail: { used: 1 }, writer: 'runner', observed_at: T0, lapses_at: expect.any(Number), until: null, available: null },
      { source: `runner:${baton.id}`, kind: 'measure', detail: { used: 2 }, writer: 'runner', observed_at: T0, lapses_at: expect.any(Number), until: null, available: null },
    ]) }], capabilities: [{ capability: CAP, capacity: 2, holders: expect.arrayContaining([expect.objectContaining({ ticket_id: theirs, hostname: runner.hostname })]) }] });
  }
  const launch = await read(docs.key, '/v1/runner/launch-candidates');
  expect(launch.status).toBe(200);
  expect(await launch.json()).toEqual({ repositories: [{ repository: 'docs', candidates: [] }] });
  const tag = launch.headers.get('ETag')!;
  expect((await read(docs.key, '/v1/runner/launch-candidates', tag)).status).toBe(304);
  expect((await keyCall(admin, '/v1/admin/capacities', { capability: CAP, capacity: 3 }, 'PUT')).status).toBe(200);
  const opened = await read(docs.key, '/v1/runner/launch-candidates', tag);
  expect(opened.status).toBe(200);
  expect(await opened.json()).toMatchObject({ repositories: [{ repository: 'docs', candidates: [{ ticket_id: 'docs:OTHER' }] }] });
  const launchPath = '/v1/runner/launch-candidates';
  expect((await keyCall(admin, '/v1/admin/freeze', {})).status).toBe(200);
  const frozen = await read(docs.key, launchPath, opened.headers.get('ETag')!);
  expect(frozen.status).toBe(200);
  expect(await frozen.json()).toEqual({ repositories: [{ repository: 'docs', candidates: [] }] });
  const frozenTag = frozen.headers.get('ETag')!;
  expect((await read(docs.key, launchPath, frozenTag)).status).toBe(304);
  expect((await keyCall(admin, '/v1/admin/unfreeze', {})).status).toBe(200);
  const thawed = await read(docs.key, launchPath, frozenTag);
  expect(thawed.status).toBe(200);
  expect(await thawed.json()).toMatchObject({ repositories: [{ repository: 'docs', candidates: [{ ticket_id: 'docs:OTHER' }] }] });
});

it('S-BTN-57: keeps claim reports through a long claim and invalidates a pre-expiry poll after cleanup', async () => {
  const HOUR = 3_600_000;
  const STEP = 600_000;
  await setClock(T0 + STEP);
  expect((await new Git().add('LONG').post()).status).toBe(200);
  await cutover();
  const runner = await grantedRunner(docsOwner, 'docs', 'long-claim', ['agent-venue']);
  const own = await runner.call('/v1/runner/claim', { request_id: requestId(), ticket_id: 'docs:LONG' });
  expect(own.status).toBe(200);
  const claim = own.json.claim_id;
  expect(await runner.beat({ lease_timeout_s: 43_200, reports: [{ claim_id: claim, payload: 'claim' }, { repository: 'docs', payload: 'repo' }] })).toMatchObject({ status: 200 });
  const repoExpiry = T0 + STEP + 6 * HOUR;
  await setClock(repoExpiry);
  await tick();
  expect(await (await read(runner.key, FLEET)).json()).toMatchObject({ claims: [{ claim_id: claim, reports: [{ payload: 'claim' }] }], reports: [] });
  expect((await runner.call(`/v1/runner/claims/${claim}/end`, { end_reason: 'released:requested', reached: 'filed' })).status).toBe(200);
  const claimExpiry = repoExpiry + 6 * HOUR;
  await setClock(claimExpiry - 1_000);
  const before = await read(runner.key, FLEET);
  expect(await before.json()).toMatchObject({ claims: [], reports: [{ claim_id: claim, payload: 'claim' }] });
  const tag = before.headers.get('ETag')!;
  await setClock(claimExpiry);
  const expired = await read(runner.key, FLEET, tag);
  expect(expired.status).toBe(200);
  expect(await expired.json()).toMatchObject({ claims: [], reports: [] });
  await tick();
  expect(await rows('SELECT claim_id FROM runner_reports')).toEqual([]);
  const cleaned = await read(runner.key, FLEET, tag);
  expect(cleaned.status).toBe(200);
  expect(await cleaned.json()).toMatchObject({ claims: [], reports: [] });
});
