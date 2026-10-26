// S-BTN-166 the CLI's reads (B-90; BATON_SPEC §11): `baton board`, `baton admin repos` and
// `baton owner grants` each make one request and get one JSON answer — the dashboard's own
// queries behind the signed principal, so an operator or an agent with a key can see the
// instance's state without a browser session. Must hold: each route answers for the seeded
// two-repository instance (the registry; the repository's owners, grants and settings; the
// board's repository, ready and per-tier sections); a key without the right role is refused
// with its code — an owner reads its own repository and no other, an administrator's key is no
// owner's, a worker key granted on the repository reads its board and is told what its grant
// allows, and a key granted nowhere is refused `forbidden`, an unknown one `unauthenticated`.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { cutover, hbBody, keyCall, ORIGIN, payload, setAdminKeys, setClock, sha256, syncCall, syncToken, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const board = inject('board');
const T0 = Date.parse('2026-10-16T12:00:00Z');
const OPS_SHA = 'f'.repeat(40);

let admin: TestKey;
let docsOwner: TestKey;
let opsOwner: TestKey;
let granted: TestKey;
let stranger: TestKey;

/** A GET signed by `key` at the core's clock. */
async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** A granted key's heartbeat (its registration, as `baton run` starts it). */
async function heartbeat(key: TestKey, hostname: string, over: Record<string, unknown> = {}) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const body = hbBody('vm-a', { hostname, session_name: hostname, secret_hash: await sha256('secret-reads'), ...over });
  const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/runner/heartbeat`, { created, body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** A `GET` signed by `key`, with its worker secret once it registered. */
async function workerAs(key: TestKey, path: string, body?: unknown, secret?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, {
    created, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: secret ? { 'X-Worker-Secret': secret } : {},
  }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ecdsa-sha2-nistp256', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  granted = await makeKey('ssh-ed25519', 'granted');
  stranger = await makeKey('ssh-ed25519', 'stranger');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
  await syncCall('/v1/sync/board', payload(OPS_SHA, null, board.states.A),
    await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' }));
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
});

describe('S-BTN-166 the CLI’s reads (B-90)', () => {
  it('an administrator reads the registry: both repositories, one JSON answer', async () => {
    const res = await read(admin, '/v1/admin/repositories');
    expect(res.status).toBe(200);
    expect((res.json.repositories as { id: string }[]).map((r) => r.id)).toEqual(['baton', 'docs', 'ops']);
    const docs = (res.json.repositories as { id: string; head: { sha: string } | null; courses: { id: string }[] }[]).find((r) => r.id === 'docs')!;
    expect(docs.head?.sha).toBe(board.shas.A);
    expect(docs.courses.map((c) => c.id)).toContain('roadmap-pr');
    // The dashboard's own answer, not a second one (no new core query).
    const again = await read(admin, '/v1/admin/repositories');
    expect(JSON.stringify(again.json.repositories)).toBe(JSON.stringify(res.json.repositories));
    // Writes keep their route: the read is a GET, and a GET of a write is not a silent success.
    expect((await read(docsOwner, '/v1/admin/repositories')).json.code).toBe('forbidden');
  });

  it('an owner reads its grants and settings; another repository and an administrator’s key are refused', async () => {
    const res = await read(docsOwner, '/v1/owner/docs/grants');
    expect(res.status).toBe(200);
    expect(res.json.repository).toBe('docs');
    expect((res.json.owners as { fingerprint: string }[]).map((o) => o.fingerprint)).toContain(docsOwner.fingerprint);
    expect(res.json.grants).toEqual([{
      credential_id: granted.fingerprint, hostname: 'granted-host', label: null, repository_id: 'docs',
      capabilities: JSON.stringify(['authentication', 'create-pr', 'drivable-browser', 'llm-call']),
      max_tier: null, granted_by: `owner:${docsOwner.fingerprint}`, granted_at: T0,
      // R-BTN-58: the other repositories this key is granted on — none yet.
      other_repositories: [],
    }]);
    expect((res.json.settings as Record<string, unknown>).repository_id).toBe('docs');
    expect(res.json.bars).toEqual([]);
    // The same key granted on another repository too: its holder's one decision, named here.
    expect((await keyCall(opsOwner, '/v1/owner/ops/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
    expect(((await read(docsOwner, '/v1/owner/docs/grants')).json.grants as { other_repositories: string[] }[])[0].other_repositories).toEqual(['ops']);
    expect(((await read(opsOwner, '/v1/owner/ops/grants')).json.grants as { other_repositories: string[] }[])[0].other_repositories).toEqual(['docs']);
    // Owning one repository confers nothing on another (R-BTN-58); an administrator's key is no owner's (R-BTN-57).
    expect((await read(docsOwner, '/v1/owner/ops/grants')).json).toMatchObject({ code: 'forbidden' });
    expect((await read(admin, '/v1/owner/docs/grants')).json.code).toBe('forbidden');
    expect((await read(stranger, '/v1/owner/docs/grants')).json.code).toBe('unauthenticated');
  });

  it('the board answers its repository, ready and per-tier sections to an owner and to a key granted on it', async () => {
    for (const key of [docsOwner, granted]) {
      const res = await read(key, '/v1/repositories/docs/board');
      expect(res.status).toBe(200);
      expect(res.json.repository).toMatchObject({ id: 'docs', head: { sha: board.shas.A }, mode: { mode: 'shadow' } });
      const ready = res.json.ready as { repository_id: string; id: string; leg: string }[];
      expect(ready.length).toBeGreaterThan(0);
      expect(ready.every((r) => r.repository_id === 'docs')).toBe(true);
      const tiers = Object.values(res.json.ready_by_tier as Record<string, string[]>).flat();
      expect(tiers.length).toBeGreaterThan(0);
      expect(tiers.every((id) => id.startsWith('docs:'))).toBe(true);
      // B-86: the courses' legs with their clauses, for the startup line.
      expect(Object.keys(res.json.course_files['roadmap-pr'].legs)).toContain('implement');
    }
    // A key Baton does not know cannot heartbeat at all — the board read above is its only answer.
    expect((await heartbeat(stranger, 'stranger-host')).status).toBe(401);
  });

  it('a board read is refused where the key holds no role, with its code', async () => {
    expect((await read(opsOwner, '/v1/repositories/ops/board')).status).toBe(200);
    expect((await read(opsOwner, '/v1/repositories/docs/board')).json.code).toBe('forbidden');
    // A key Baton does not know is unauthenticated; a granted key knows its repository only.
    expect((await read(stranger, '/v1/repositories/docs/board')).json.code).toBe('unauthenticated');
    expect((await read(admin, '/v1/repositories/nope/board')).json.code).toBe('not-found');
    expect((await read(admin, '/v1/admin/repositories/extra')).json.code).toBe('not-found');
    // The grant is the repository's alone: revoked, the read is refused.
    expect((await keyCall(docsOwner, `/v1/owner/docs/grants/${encodeURIComponent(granted.fingerprint)}/revoke`, {})).status).toBe(200);
    expect((await read(granted, '/v1/repositories/docs/board')).json.code).toBe('forbidden');
  });

  it('a granted key’s board names its grant, as its heartbeat does; an owner’s or an administrator’s names none', async () => {
    const hb = await heartbeat(granted, 'granted-host');
    const keyed = await read(granted, '/v1/repositories/docs/board');
    // One fact, one answer: the board's field is the heartbeat answer's grant, name for name
    // (the heartbeat names it `grant.capabilities`, B-86; the board `granted_capabilities`,
    // which also carries `none` — a name that says nothing, dropped where it is compared).
    const names = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x) => x !== 'none') : []);
    expect(names(keyed.json.granted_capabilities)).toEqual(names(hb.json.grant?.capabilities));
    expect(keyed.json.granted_capabilities).toContain('create-pr');
    for (const key of [docsOwner, admin]) {
      const res = await read(key, '/v1/repositories/docs/board');
      expect(res.status).toBe(200);
      expect(res.json.granted_capabilities).toBeNull(); // no grant binds an owner's or an admin's key
    }
  });

});
