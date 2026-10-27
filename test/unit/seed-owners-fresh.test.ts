// B-91 — a fresh deployment seeds a registered repository without its owner keys: a rebuilt
// instance registers `baton` from BATON_REPOSITORIES with no owner, and the owner CLI fails
// against it until someone re-adds them by hand. These run a fresh local instance (Node host, an
// in-memory store, an empty database), as test-course's kit does: with this repository's own
// wrangler.toml entry the key it names owns `baton` from the first start, and `admin repos` names
// `baton` in `seed_owners` — as it names every registration whose owners are all the seed's; with
// an instance seeded as before, nothing owns it and `seed_owners` names it. A unit test,
// not a scenario — the local project's setup is the one that reads wrangler.toml
// (test/unit/auth.test.ts does the same).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalHost } from '../../src/local/host'
;
import { openStore } from '../../src/local/store';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const ROOT = resolve(import.meta.dirname, '../..');
const ORIGIN = 'http://127.0.0.1';

/** This repository's entry in wrangler.toml, production's [vars]: every flag `admin repo add`
 *  takes, with the `owner_keys` B-91 adds. */
function batonEntry(): Record<string, unknown> {
  const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
  const vars = /^\[vars\]\n([\s\S]*?)(?=^\[)/m.exec(toml)?.[1] ?? '';
  const raw = /^BATON_REPOSITORIES = '(.*)'$/m.exec(vars)![1];
  return (JSON.parse(raw) as Record<string, unknown>[]).find((e) => e.id === 'baton')!;
}

/** A freshly seeded `baton`: an instance with no history. With this repository's entry it is
 *  owned from its first start — by the key the entry names, `admin:seed` — and `seed_owners` names
 *  it, as the read names every registration whose owners are all the deploy's. */
async function fresh(seed: Record<string, unknown>[], admin: TestKey) {
  const { store } = openStore(':memory:');
  const host = new LocalHost({
    store, alarm: 'manual',
    config: {
      BATON_ORIGIN: ORIGIN, OIDC_ISSUER: '', OIDC_JWKS_URL: '', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', OWNER_EMAILS: '',
      BATON_REPOSITORIES: JSON.stringify(seed),
    },
    adminKeys: { list: () => [admin.publicKey] },
  });
  await host.start();
  return host;
}

const ownerOf = (entry: Record<string, unknown>) => (entry.owner_keys as string[])[0];
/** `GET /v1/admin/repositories` as B-90's `baton admin repos` asks it, signed by `key`. */
const registry = async (host: LocalHost, key: TestKey) => host.handle(await signedRequest(key, `${ORIGIN}/v1/admin/repositories`, {}));

describe('B-91: a rebuilt instance serves the owner CLI without a manual re-add', () => {
  it('baton’s own entry registers it with the owner key it names, and the owner CLI works at once', async () => {
    const admin = await makeKey('ssh-ed25519', 'fresh-admin');
    const entry = batonEntry();
    const host = await fresh([entry], admin);
    const owners = host.core.store.exec<{ public_key: string; added_by: string }>('SELECT public_key, added_by FROM repository_owners').toArray();
    expect(owners).toEqual([{ public_key: ownerOf(entry), added_by: 'admin:seed' }]);
    // `baton admin repos` (B-90): the registry, one JSON answer, the repository already owned —
    // and named in `seed_owners`, since the only owner it has is the seed's.
    const res = await registry(host, admin);
    expect(res.status).toBe(200);
    const repos = (await res.json()) as { repositories: { id: string; github: string }[]; seed_owners?: string[] };
    expect(repos.repositories.map((r) => r.id)).toEqual(['baton']);
    expect(repos.repositories[0]).toMatchObject({ github: 'immediately-run/baton' });
    expect(repos.seed_owners).toEqual(['baton']);
  });

  it('a start (BatonCore.start) seeds them before the first request, from the instance\'s own config', async () => {
    const admin = await makeKey('ssh-ed25519', 'restart-admin');
    const entry = batonEntry();
    const { store } = openStore(':memory:');
    const config = {
      BATON_ORIGIN: ORIGIN, OIDC_ISSUER: '', OIDC_JWKS_URL: '', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', OWNER_EMAILS: '',
      BATON_REPOSITORIES: JSON.stringify([entry]),
    };
    const first = new LocalHost({ store, alarm: 'manual', config, adminKeys: { list: () => [admin.publicKey] } });
    await first.start();
    first.core.store.exec(`UPDATE repository_owners SET removed_at = 1`);
    // The same database, the same config: the next start is the rebuilt instance.
    const rebuilt = new LocalHost({ store, alarm: 'manual', config, adminKeys: { list: () => [admin.publicKey] } });
    await rebuilt.start();
    expect(rebuilt.core.store.exec<{ public_key: string }>('SELECT public_key FROM repository_owners WHERE removed_at IS NULL').toArray())
      .toEqual([{ public_key: ownerOf(entry) }]);
  });

  it('the owner the seed names signs as an owner: its grant is written, as no key of an unowned repository can', async () => {
    const admin = await makeKey('ssh-ed25519', 'owner-route-admin');
    const owner = await makeKey('ssh-ed25519', 'owner-route-owner');
    const worker = await makeKey('ssh-ed25519', 'owner-route-worker');
    const host = await fresh([{ ...batonEntry(), owner_keys: [owner.publicKey] }], admin);
    const body = JSON.stringify({ public_key: worker.publicKey, hostname: 'seeded-owner-host', capabilities: ['agent-venue'] });
    const res = await host.handle(await signedRequest(owner, `${ORIGIN}/v1/owner/baton/grants`, { body }));
    expect(res.status).toBe(200);
    expect(host.core.store.exec<{ credential_id: string; granted_by: string }>('SELECT credential_id, granted_by FROM worker_grants').toArray())
      .toEqual([{ credential_id: worker.fingerprint, granted_by: `owner:${owner.fingerprint}` }]);
  });

  it('an instance seeded as before names baton in admin repos — the gap is visible before it bites', async () => {
    const admin = await makeKey('ssh-ed25519', 'before-admin');
    const { owner_keys: _o, ...withoutOwners } = batonEntry();
    const host = await fresh([withoutOwners], admin);
    const res = await registry(host, admin);
    expect(((await res.json()) as { seed_owners?: string[] }).seed_owners).toEqual(['baton']);
    // And its owner CLI has no owner to sign as: the key of nobody on baton is `unauthenticated`.
    const stranger = await makeKey('ssh-ed25519', 'before-stranger');
    expect((await host.handle(await signedRequest(stranger, `${ORIGIN}/v1/owner/baton/grants`, {}))).status).toBe(401);
  });

  it('a start whose seed names a malformed owner_keys registers nothing: a broken deploy is seen at once', async () => {
    const admin = await makeKey('ssh-ed25519', 'broken-admin');
    const entry = { ...batonEntry(), owner_keys: ['not a key'] };
    await expect(fresh([entry], admin)).rejects.toMatchObject({ code: 'invalid-params' });
  });
});
