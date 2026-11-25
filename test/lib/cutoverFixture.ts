// cutoverFixture.ts — what S-BTN-170 and S-BTN-305 stand on (B-203, B-216): a state with
// something in most of its sections, over two repositories, so "this section equals that read"
// is never the equality of two empty lists where the fixture could make one. Built on
// needsYouFixture (docs with an owner, a granted reader and a person leg; ops with another
// owner; an administrator and its session), through Baton's own routes wherever one exists.
//
//   docs   A  held by a seed runner, running `implement`, a condition raised from the run
//          B  requires a capability no runner declares
//          C  held by an administrator
//          D  waiting on its person leg, its question posted
//          a force post held; a `regressed` discrepancy on A
//   ops    P  claimed by K, a key its owner granted there
//          Q  ready; an `off-graph` discrepancy on it
//   the instance: a runner that declares no course (granted nowhere), a resource with one
//          instance and a reading on it, a probe key.
import { expect } from 'vitest';
import { cutover, Git, keyCall, register, requestId, setClock, syncToken, withCore } from '../helpers';
import { grantedRunner, SCHEMA, type FleetRunner } from './fleet';
import { atDecide, fixture, MIN, postSession, raise, readAs, running, T0, type Fixture, type Json } from './needsYouFixture';
import { makeKey } from './sshKeys';

export interface CutoverFixture extends Fixture {
  /** The live repositories, in the registry's order. */
  repositories: string[];
  opsGit: Git;
  /** The key granted on ops, registered and holding `ops:P`. */
  k: FleetRunner;
  /** The seed runner's run of `docs:A`. */
  run: { cred: 'vm-a' | 'vm-b'; secret: string; claimId: number; runId: string };
  condition: number;
  /** The instant every read of the fixture is made at. */
  now: number;
}

export async function cutoverFixture(): Promise<CutoverFixture> {
  const f = await fixture();
  f.git.add('B', { requires: ['human-operator'] }).add('C');
  atDecide(f.git, 'D');
  expect((await f.git.post()).status).toBe(200);

  const opsGit = new Git(await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' }));
  opsGit.add('P').add('Q');
  expect((await opsGit.post()).status).toBe(200);
  await cutover(T0, 'ops');

  const run = await running('A');
  const condition = await raise(run, { type: 'ask.owner' });
  const k = await grantedRunner(f.opsOwner, 'ops', 'k', ['agent-venue']);
  const claimed = await k.call('/v1/runner/claim', { request_id: requestId(), ticket_id: 'ops:P' });
  expect([claimed.status, claimed.json.code]).toEqual([200, undefined]);
  // A live runner that declares no course: granted nowhere, and one of Needs you's listings.
  await register('vm-b', { courses: [] });

  expect((await postSession(f.cookie, '/v1/ui/overrides/docs:C', { hold: true })).status).toBe(200);
  await withCore((c) => c.store.transaction(() => {
    c.history.discrepancy('docs:A', 'regressed', { station: 'pr-open' }, { station: 'filed' }, 7);
    c.history.discrepancy('ops:Q', 'off-graph', { station: 'x' }, { station: 'y' }, 3);
  }));

  expect((await keyCall(f.admin, '/v1/admin/resources', { name: 'llm:cap', scope: 'account', detail_schema: SCHEMA })).status).toBe(200);
  expect((await keyCall(f.admin, '/v1/admin/instances', { name: 'acct:one', serves: ['llm:cap'], repositories: ['docs'] })).status).toBe(200);
  expect((await keyCall(f.admin, '/v1/admin/readings', { readings: [{ instance: 'acct:one', available: true, valid_for: 3600, detail: { used: 3 } }] })).json).toEqual({ ok: true, refused: [] });
  const probe = await makeKey('ssh-ed25519', 'probe');
  expect((await keyCall(f.admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'cap probe', instances: ['acct:one'] })).status).toBe(200);

  // A rewritten history, held (R-BTN-11): the last write, a minute on, and the clock stays there.
  const now = T0 + MIN;
  await setClock(now);
  const forced = (await f.git.post({ force: true })) as Json;
  expect([forced.status, forced.code]).toEqual([409, 'snapshot-rejected']);

  const repositories = ((await readAs(f.admin, '/v1/repositories')).json.repositories as { id: string }[]).map((r) => r.id);
  return { ...f, repositories, opsGit, k, run, condition, now };
}

/** `GET path` with the administrator's key: its JSON, having answered `200`. */
export async function read(f: Fixture, path: string): Promise<Json> {
  const res = await readAs(f.admin, path);
  expect([path, res.status, res.json.code, res.json.message]).toEqual([path, 200, undefined, undefined]);
  return res.json;
}

/** A list read followed over every page: `items` of each answer, by its `next_cursor`. */
export async function everyPage(f: Fixture, path: string, items: string): Promise<Json[]> {
  const out: Json[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const json = await read(f, cursor === undefined ? path : `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`);
    out.push(...(json[items] as Json[]));
    if (typeof json.next_cursor !== 'string') return out;
    cursor = json.next_cursor;
  }
  throw new Error(`${path}: more than 100 pages`);
}

/** Is `id` a ticket of `repository`? */
export const ofRepository = (repository: string) => (id: unknown): boolean => typeof id === 'string' && id.startsWith(`${repository}:`);
