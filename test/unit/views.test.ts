// R-BTN-99: the machine-key views, grant boundaries and conditional reads.
import { beforeEach, expect, it } from 'vitest';
import { call as hostCall } from '#host';
import { keyCall, ORIGIN, setAdminKeys, setClock, withCore } from '../helpers';
import { grantedRunner, SCHEMA } from '../lib/fleet';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-21T12:00:00Z');
const INSTANCES = '/v1/runner/instances';
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

it('changes tags for a grant, a reading and the UTC hour, but not an unchanged poll', async () => {
  const runner = await grantedRunner(docsOwner, 'docs', 'poll-view', []);
  const first = await read(runner.key, INSTANCES);
  expect(first.status).toBe(200);
  const initial = first.headers.get('ETag')!;
  expect((await read(runner.key, INSTANCES, initial)).status).toBe(304);
  expect((await keyCall(batonOwner, '/v1/owner/baton/grants', { public_key: runner.key.publicKey, hostname: runner.hostname, capabilities: [] })).status).toBe(200);
  const granted = await read(runner.key, INSTANCES, initial);
  expect(granted.status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'service:uptime', scope: 'service', detail_schema: SCHEMA })).status).toBe(200);
  const registered = (await read(runner.key, INSTANCES)).headers.get('ETag')!;
  expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'service:uptime', available: true, valid_for: 4000 }] })).status).toBe(200);
  const measured = await read(runner.key, INSTANCES, registered);
  expect(measured.status).toBe(200);
  const tag = measured.headers.get('ETag')!;
  await setClock(T0 + 3_599_000);
  expect((await read(runner.key, INSTANCES, tag)).status).toBe(304);
  await setClock(T0 + 3_600_000);
  const nextHour = await read(runner.key, INSTANCES, tag);
  expect(nextHour.status).toBe(200);
  const nextTag = nextHour.headers.get('ETag')!;
  await setClock(T0 + 3_999_000);
  expect((await read(runner.key, INSTANCES, nextTag)).status).toBe(304);
  await setClock(T0 + 4_000_000);
  const expired = await read(runner.key, INSTANCES, nextTag);
  expect(expired.status).toBe(200);
  expect(await expired.json()).toMatchObject({ instances: [{ name: 'service:uptime', state: 'unknown', readings: [] }] });
});
