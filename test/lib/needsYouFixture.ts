// needsYouFixture.ts — what S-BTN-275 to S-BTN-281 stand on: two repositories (`docs`, with an
// owner key and a granted reader; `ops`, another owner's), an administrator's session, and in
// `docs` a course with a person leg (`decide`), a declared `suspend` type (`ask.owner`) and a
// leg that runs with a deadline, so a run can raise conditions. Helpers read as a key or as the
// session and raise a condition as the claiming runner.
import { expect } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { adminSession, advance, beat, claimItem, course, cutover, Git, keyCall, ORIGIN, placed, register, runnerCall, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from './sshKeys';
import { call as hostCall } from '#host';

export const T0 = Date.parse('2026-11-20T12:00:00Z');
export const MIN = 60_000;
export const LINK = 'https://claude.ai/s/r_0000000000000000000000000';
export const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];
export const QUESTION = { id: 'q-1', severity: 'high', options: [{ id: 'ship', reached: 'adjudicated' }, { id: 'hold', reached: 'parked' }] };

/** `decide` is the person leg; `ask.owner` a declared `suspend` type with two restarts;
 *  `implement` runs with a deadline, which a raise needs. */
export const COURSE = {
  ...roadmapPr,
  conditions: { 'ask.owner': { disposition: 'suspend', restarts: { retry: 'run it again', park: 'hold it' }, default: 'retry' } },
  stations: { ...roadmapPr.stations, parked: { label: 'Parked' } },
  legs: {
    ...roadmapPr.legs,
    implement: { ...roadmapPr.legs.implement, max_duration: 600 },
    merge: { ...roadmapPr.legs.merge, from: ['reviewed', 'adjudicated', 'parked'] },
    decide: { from: ['reviewed'], to: ['adjudicated', 'parked'], kind: 'person', asks: 'owner' } as Record<string, unknown>,
  },
};

export type Json = Record<string, any>;

export interface Fixture {
  admin: TestKey;
  owner: TestKey;
  opsOwner: TestKey;
  reader: TestKey;
  cookie: string;
  git: Git;
}

/** The two repositories, the keys, the first board of `docs` (ticket `A`, cut over) and the
 *  administrator's session. */
export async function fixture(): Promise<Fixture> {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'docs-owner');
  const opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  const reader = await makeKey('ssh-ed25519', 'docs-reader');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: reader.publicKey, hostname: 'docs-deliver', capabilities: ['agent-venue'] })).status).toBe(200);
  const git = new Git().add('A');
  git.registry = [course(3, 3, { course: COURSE })];
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
  const cookie = await adminSession(admin);
  return { admin, owner, opsOwner, reader, cookie, git };
}

/** `GET path`, signed by `key`. */
export async function readAs(key: TestKey, path: string): Promise<{ status: number; json: Json; etag: string | null }> {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Json, etag: res.headers.get('ETag') };
}

/** `GET path` under the session cookie, as the dashboard sends it. */
export async function readSession(cookie: string, path: string): Promise<{ status: number; json: Json }> {
  const res = await sessionCall(cookie, path, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  return { status: res.status, json: (await res.json()) as Json };
}

/** `POST path` under the session cookie, as the dashboard sends it (R-BTN-16). */
export async function postSession(cookie: string, path: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await sessionCall(cookie, path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

/** A runner claims `docs:<local>`, starts `implement` and reports its session link: the run a
 *  condition is raised from. */
export async function running(local = 'A', cred: 'vm-a' | 'vm-b' = 'vm-a') {
  const w = await register(cred);
  const { json: c } = await claimItem(cred, w.secret, { ticket_id: `docs:${local}` });
  const a = await advance(cred, w.secret, c.claim_id, { leg: 'implement' });
  expect(a.status).toBe(200);
  expect((await beat(cred, w.secret, { session_url: LINK })).status).toBe(200);
  return { cred, secret: w.secret as string, claimId: c.claim_id as number, runId: a.json.run_id as string };
}

/** `POST /v1/runner/claims/{id}/conditions` as the claiming runner; the new condition's id. */
export async function raise(run: { cred: 'vm-a' | 'vm-b'; secret: string; claimId: number }, body: Record<string, unknown>): Promise<number> {
  const res = await runnerCall(`/v1/runner/claims/${run.claimId}/conditions`, { cred: run.cred, secret: run.secret, body });
  const json = (await res.json()) as Json;
  expect([res.status, json.code]).toEqual([200, undefined]);
  return json.condition_id as number;
}

/** Ticket `local` waiting on the person leg, its question posted. */
export function atDecide(git: Git, local: string, question: Record<string, unknown> = QUESTION) {
  return git.add(local, { question }, placed('reviewed', REVIEWED, [['decide', 'ready']]));
}
