// S-BTN-61 / G-BTN-88: shared readings and seats, with grant-scoped disclosure.
import { beforeEach, expect, it } from 'vitest';
import { call as hostCall } from '#host';
import { cutover, Git, keyCall, ORIGIN, requestId, setAdminKeys, setClock, syncToken, withCore } from '../helpers';
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
  const neither = await makeKey('ssh-ed25519', 'views-neither');
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
  expect((await read(neither, INSTANCES)).status).toBe(401);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'llm:shared', scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/instances', { name: ACCOUNT, serves: ['llm:shared'], repositories: ['docs', 'baton'] })).status).toBe(200);
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
});
