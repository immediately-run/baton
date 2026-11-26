// runnerFleet.ts — what the runner-read scenarios (S-BTN-285 to -287, B-196) stand a fleet on:
// two repositories, their owners, and runners registered with granted keys through the runner
// routes themselves — a heartbeat, a claim, an advance, activities — each signed with its key.
import { expect } from 'vitest';
import { adminSession, cutover, Git, hbBody, keyCall, ORIGIN, requestId, setAdminKeys, setClock, sha256, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from './sshKeys';
import { call as hostCall } from '#host';

export type Json = Record<string, any>;

/** A runner registered with a granted key: its id, its key and its secret. */
export type Granted = { id: number; key: TestKey; secret: string; hostname: string };

/** A call signed with `key` at the core's clock; `secret` rides as the runner session's. */
export async function signed(key: TestKey, path: string, body?: unknown, secret?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, {
    created, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: secret ? { 'X-Runner-Secret': secret } : {},
  }));
  return { status: res.status, json: (await res.json()) as Json, res };
}

/** A heartbeat of a granted key's runner: its first registers it. */
export async function heartbeat(key: TestKey, hostname: string, secret: string, over: Json = {}, first = false) {
  const body = hbBody('vm-a', { hostname, session_name: `s-${hostname}`, ...(first ? { secret_hash: await sha256(secret) } : {}), ...over });
  return signed(key, '/v1/runner/heartbeat', body, first ? undefined : secret);
}

/** Grant `key` on each of `repositories` by its owner, then register its runner. */
export async function grantedRunner(name: string, hostname: string, grants: { repository: string; owner: TestKey }[], over: Json = {}): Promise<Granted> {
  const key = await makeKey('ssh-ed25519', name);
  for (const g of grants) {
    expect((await keyCall(g.owner, `/v1/owner/${g.repository}/grants`, { public_key: key.publicKey, hostname, capabilities: ['agent-venue'] })).status).toBe(200);
  }
  const secret = `secret-${name}`;
  const hb = await heartbeat(key, hostname, secret, over, true);
  expect([hb.status, hb.json.code]).toEqual([200, undefined]);
  return { id: hb.json.runner_id as number, key, secret, hostname };
}

/** `w` claims `ticket` and starts `leg`; the claim's id. */
export async function claimAndStart(w: Granted, ticket: string, leg: string, over: Json = {}) {
  const c = await signed(w.key, '/v1/runner/claim', { request_id: requestId(), ticket_id: ticket }, w.secret);
  expect([c.status, c.json.code]).toEqual([200, undefined]);
  const a = await signed(w.key, `/v1/runner/claims/${c.json.claim_id}/advance`, { leg, ...over }, w.secret);
  expect([a.status, a.json.code]).toEqual([200, undefined]);
  return { claim_id: c.json.claim_id as number, run_id: a.json.run_id as string | undefined };
}

export type Fleet = { admin: TestKey; docsOwner: TestKey; opsOwner: TestKey; git: Git; cookie: string };

/** `docs` with four ready tickets, cut over, and `ops` registered beside it; an administrator's
 *  session. */
export async function fleet(at: number): Promise<Fleet> {
  await setClock(at);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  const opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  const git = new Git().add('T-1').add('T-2').add('T-3').add('T-4');
  expect((await git.post()).status).toBe(200);
  await cutover(at);
  return { admin, docsOwner, opsOwner, git, cookie: await adminSession(admin) };
}
