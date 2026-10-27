// B-91 — a fresh deployment seeds a registered repository's owner keys (BATON_SPEC §3 R-BTN-47,
// §5 R-BTN-58): BATON_REPOSITORIES' `owner_keys` are the repository's first owners, `added_by:
// admin:seed`, written at the start beside the sync keys, so a rebuilt instance serves the owner
// CLI with no manual re-add; a registration that leans on the seed alone is named in
// `baton admin repos`. This repository's own entry in wrangler.toml carries them.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { checkRegistration } from '../../src/core/registry';
import { parseSshKey } from '../../src/core/auth';
import type { Config } from '../../src/core/ports';
import type { Admin } from '../../src/core/admin';
import { keyCall, rows, setAdminKeys, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const OPS = { id: 'ops', github: 'immediately-run/ops', default_branch: 'trunk', sync_workflow: '.github/workflows/sync.yml' };
const seeded = (v: unknown) => ({ BATON_REPOSITORIES: JSON.stringify(v) } as unknown as Config);
/** The start's two owner passes (B-91): read and parse, then write — `BatonCore.start`'s order around the seed. */
const seedOwners = async (c: { admin: Admin }, config: Config) =>
  c.admin.seedOwners(await c.admin.readSeedOwners(config));
const live = async () => (await rows<{ public_key: string }>('SELECT public_key FROM repository_owners WHERE removed_at IS NULL ORDER BY public_key')).map((r) => r.public_key);
let owner: TestKey;

beforeEach(async () => {
  owner = await makeKey('ssh-ed25519', 'seed-owner');
});

describe('the seed’s owner keys (R-BTN-47, R-BTN-58)', () => {
  it('an entry with owner_keys registers them as its owners, admin:seed; a second start finds them in place', async () => {
    await withCore(async (c) => {
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey] }]);
      expect(c.registry.seed(config)).toEqual(['ops']);
      await seedOwners(c, config);
      await seedOwners(c, config);
      expect(await rows('SELECT repository_id, public_key, fingerprint, added_by FROM repository_owners'))
        .toEqual([{ repository_id: 'ops', public_key: owner.publicKey.split(' ').slice(0, 2).join(' '), fingerprint: owner.fingerprint, added_by: 'admin:seed' }]);
      // The owner CLI works against the rebuilt instance: the seeded key owns the repository.
      const another = await makeKey('ssh-ed25519', 'seed-owner-2');
      expect((await keyCall(owner, '/v1/owner/ops/owners', { public_key: another.publicKey })).status).toBe(200);
    });
  });

  it('an empty or repeated owner_keys is invalid-params; an administrator’s key or one of another role is a conflict', async () => {
    const admin = await makeKey('ssh-ed25519', 'seed-admin');
    const worker = await makeKey('ssh-ed25519', 'seed-worker');
    await setAdminKeys(admin);
    await withCore(async (c) => {
      // Read as the administrator's route reads `owner_keys` (`Admin.ownerKeys`), one parse for both.
      await expect(c.admin.readSeedOwners(seeded([{ ...OPS, owner_keys: [] }]))).rejects.toThrow(/BATON_REPOSITORIES\[0\]\.owner_keys/);
      await expect(c.admin.readSeedOwners(seeded([{ ...OPS, owner_keys: [owner.publicKey, owner.publicKey] }]))).rejects.toThrow(/twice/);
      await expect(c.admin.readSeedOwners(seeded([{ ...OPS, owner_keys: ['not a key'] }]))).rejects.toMatchObject({ code: 'invalid-params' });
      await expect(seedOwners(c, seeded([{ ...OPS, owner_keys: [admin.publicKey] }]))).rejects.toMatchObject({ code: 'conflict' });
      // A key of another role (R-BTN-57): a worker's.
      await rows(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by) VALUES (?, 'h', '[]', 'worker', ?, 'seed')`, worker.fingerprint, worker.publicKey);
      await expect(seedOwners(c, seeded([{ ...OPS, owner_keys: [worker.publicKey] }]))).rejects.toMatchObject({ code: 'conflict' });
      // A right-shaped line whose base64 is no key stops the start as a malformed seed does.
      await expect(seedOwners(c, seeded([{ ...OPS, owner_keys: ['ssh-ed25519 AAAA'] }]))).rejects.toMatchObject({ code: 'invalid-params' });
      expect(await rows('SELECT COUNT(*) AS n FROM repository_owners')).toEqual([{ n: 0 }]);
    });
  });

  it('an entry’s every owner key is written, not only the first', async () => {
    const second = await makeKey('ssh-ed25519', 'seed-owner-b');
    const third = await makeKey('ecdsa-sha2-nistp256', 'seed-owner-c');
    await withCore(async (c) => {
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey, second.publicKey, third.publicKey] }]);
      c.registry.seed(config);
      await seedOwners(c, config);
      expect(await live()).toEqual([owner.publicKey, second.publicKey, third.publicKey].map((k) => k.split(' ').slice(0, 2).join(' ')).sort());
      // Each owns the repository: any of them grants.
      const worker = await makeKey('ssh-ed25519', 'seed-multi-worker');
      expect((await keyCall(third, '/v1/owner/ops/owners', { public_key: worker.publicKey })).status).toBe(200);
      // A second start writes nothing new: the repository has its owners.
      await seedOwners(c, config);
      expect(await rows(`SELECT COUNT(*) AS n FROM repository_owners WHERE repository_id = 'ops' AND added_by = 'admin:seed'`)).toEqual([{ n: 3 }]);
    });
  });

  it('an owned repository’s keys are checked too: a seed that would stop a rebuild stops this start, and writes nothing', async () => {
    const admin = await makeKey('ssh-ed25519', 'owned-admin');
    const worker = await makeKey('ssh-ed25519', 'owned-worker');
    const another = await makeKey('ssh-ed25519', 'owned-already');
    await setAdminKeys(admin);
    await withCore(async (c) => {
      // `baton` in production: registered by hand, its owner from `admin repo add`. The seed's
      // entry is checked all the same — one `wrangler.toml` starts on no instance and stops on
      // another (round two, 1).
      c.registry.register(OPS);
      await rows(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at) VALUES ('ops', ?, ?, 'admin:test', 1)`, another.publicKey, another.fingerprint);
      await rows(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by) VALUES (?, 'h', '[]', 'worker', ?, 'seed')`, worker.fingerprint, worker.publicKey);
      for (const keys of [
        [admin.publicKey], // an administrator's key (R-BTN-57)
        [worker.publicKey], // a worker's
        ['ssh-ed25519 AAAA'], // right-shaped, no key at all
      ]) {
        await expect(seedOwners(c, seeded([{ ...OPS, owner_keys: [...keys] }]))).rejects.toBeDefined();
      }
      // The registration the instance had: untouched by every refused start.
      expect(await live()).toEqual([another.publicKey]);
      // Its own key: checks pass, and the write loop's guard keeps the owner it has.
      await seedOwners(c, seeded([{ ...OPS, owner_keys: [owner.publicKey] }]));
      expect(await live()).toEqual([another.publicKey]);
    });
  });

  it('a revoked seed key is skipped, never a failed start: a rotation keeps the instance serving, and an ownerless repository is named (the owner, 2026-10-27)', async () => {
    const admin = await makeKey('ssh-ed25519', 'revoke-admin');
    const second = await makeKey('ssh-ed25519', 'revoke-second');
    await setAdminKeys(admin);
    await withCore(async (c) => {
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey] }]);
      c.registry.seed(config);
      await seedOwners(c, config);
      // A rotation: a second owner beside the seed's, then the administrator revokes the seed's
      // key through the real route's function (`removed_at` and `revoked_at`, R-BTN-57).
      await c.admin.owners(`owner:${owner.fingerprint}`, 'ops', { public_key: second.publicKey });
      c.admin.revokeKey('admin:test', owner.fingerprint);
      // The next start reads the same seed: it starts, writes nothing, and the rotation stands.
      await seedOwners(c, config);
      // (The route stores the line without its comment.)
      expect(await live()).toEqual([second.publicKey.split(' ').slice(0, 2).join(' ')]);
      // A leaked only key: revoked with no owner beside it, the start still succeeds…
      c.admin.revokeKey('admin:test', second.fingerprint);
      await seedOwners(c, config);
      expect(await live()).toEqual([]);
    });
    // …and the gap is named in the read, not hidden by a failed boot.
    expect((await keyCall(admin, '/v1/admin/repositories')).json.seed_owners).toContain('ops');
  });

  it('a key the seed cannot parse in a second entry writes nothing at all: the first entry is left unowned, not half-seeded', async () => {
    await withCore(async (c) => {
      // A right-shaped line whose base64 is no key: the read refuses it before anything is written
      // (the start's order, before any entry registers, is seed-owners-fresh.test.ts').
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey] },
        { ...OPS, id: 'ops2', github: 'immediately-run/ops2', owner_keys: ['ssh-ed25519 AAAA'] }]);
      c.registry.seed(config);
      await expect(seedOwners(c, config)).rejects.toMatchObject({ code: 'invalid-params' });
      expect(await rows('SELECT COUNT(*) AS n FROM repository_owners')).toEqual([{ n: 0 }]);
    });
  });

  it('a repository that already has owners keeps them; one whose owners all left is seeded again from the entry', async () => {
    const another = await makeKey('ssh-ed25519', 'already-owned');
    await withCore(async (c) => {
      c.registry.register(OPS);
      await rows(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at) VALUES ('ops', ?, ?, 'admin:test', 1)`, another.publicKey, another.fingerprint);
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey] }]);
      await seedOwners(c, config);
      expect(await live()).toEqual([another.publicKey]);
      // The seeded owner removed by another owner: a later start brings it back, as a deploy does.
      await rows('UPDATE repository_owners SET removed_at = 2 WHERE fingerprint = ?', another.fingerprint);
      // The key the seed wrote is a sync key now: it holds one role (R-BTN-57), as a worker's.
      await c.registry.registerWithKeys({ ...OPS, id: 'heat', github: 'immediately-run/heat', sync_keys: [{ public_key: owner.publicKey, role: 'sync' }] }, 'admin:t', []);
      await expect(seedOwners(c, config)).rejects.toMatchObject({ code: 'conflict' });
      expect(await live()).toEqual([]);
    });
  });

});

describe('a seed-only registration is named in a read (B-90, B-91)', () => {
  it('baton admin repos lists every repository, and names those whose owner keys only the seed gave', async () => {
    const admin = await makeKey('ssh-ed25519', 'repos-admin');
    const instanceOwner = await makeKey('ssh-ed25519', 'repos-owner');
    await setAdminKeys(admin);
    await withCore(async (c) => {
      // docs as production has it: registered by hand, its owner added after.
      await rows(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at) VALUES ('docs', ?, ?, 'admin:test', 1)`, instanceOwner.publicKey, instanceOwner.fingerprint);
      // ops as a rebuilt instance has it: from the seed, its owner the seed's.
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey] }]);
      c.registry.seed(config);
      await seedOwners(c, config);
      // plain: seeded with no owner at all.
      c.registry.seed(seeded([{ ...OPS, id: 'plain', github: 'immediately-run/plain' }]));
    });
    const res = await keyCall(admin, '/v1/admin/repositories');
    expect(res.status).toBe(200);
    expect(res.json.repositories.map((r: { id: string }) => r.id)).toEqual(['baton', 'docs', 'ops', 'plain']);
    expect(res.json.repositories.find((r: { id: string }) => r.id === 'ops')).toMatchObject({ github: 'immediately-run/ops', default_branch: 'trunk' });
    // A seeded owner, and a registration with no owner at all: both fail as an owner CLI does.
    expect(res.json.seed_owners).toEqual(['baton', 'ops', 'plain']);
  });

  it('a seed owner beside another owner does not name the repository: the list is the registrations whose owners are all the seed’s', async () => {
    const admin = await makeKey('ssh-ed25519', 'mixed-admin');
    const added = await makeKey('ssh-ed25519', 'mixed-owner');
    await setAdminKeys(admin);
    await withCore(async (c) => {
      // docs as production has it: registered by hand, its owner added after.
      await rows(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at) VALUES ('docs', ?, ?, 'admin:test', 1)`, added.publicKey, added.fingerprint);
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey] }]);
      c.registry.seed(config);
      await seedOwners(c, config);
      // Every key of ops is the seed's; docs has an owner a person added. Exactly so.
      expect((await keyCall(admin, '/v1/admin/repositories')).json.seed_owners).toEqual(['baton', 'ops']);
      // An owner an administrator adds beside the seed's: the repository no longer leans on the deploy alone.
      await rows(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at) VALUES ('ops', ?, ?, 'admin:test', 3)`, added.publicKey, added.fingerprint);
      expect((await keyCall(admin, '/v1/admin/repositories')).json.seed_owners).toEqual(['baton']);
      // The added one removed again, the seed's left: all of the owners are the seed's, and it is named.
      await rows(`UPDATE repository_owners SET removed_at = 4 WHERE repository_id = 'ops' AND added_by = 'admin:test'`);
      expect((await keyCall(admin, '/v1/admin/repositories')).json.seed_owners).toEqual(['baton', 'ops']);
    });
  });

  it('an owner an administrator added leaves the seed list; one answer per read, none of it for a key outside the role', async () => {
    const admin = await makeKey('ssh-ed25519', 'repos-admin-2');
    const instanceOwner = await makeKey('ssh-ed25519', 'repos-owner-2');
    const stranger = await makeKey('ssh-ed25519', 'repos-stranger');
    await setAdminKeys(admin);
    await withCore(async (c) => {
      const config = seeded([{ ...OPS, owner_keys: [owner.publicKey] }]);
      c.registry.seed(config);
      await seedOwners(c, config);
    });
    // The test instance's own two repositories lean on a deploy too: baton has no owner at all.
    expect((await keyCall(admin, '/v1/admin/repositories')).json.seed_owners).toEqual(['baton', 'docs', 'ops']);
    expect((await keyCall(owner, '/v1/admin/repositories')).status).toBe(403);
    expect((await keyCall(stranger, '/v1/admin/repositories')).status).toBe(401);
    // The owner the seed wrote is replaced by one an administrator added: no longer the seed's.
    await withCore((c) => {
      c.store.exec(`UPDATE repository_owners SET removed_at = 2 WHERE repository_id = 'ops'`);
      c.store.exec(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at) VALUES ('ops', ?, ?, 'admin:test', 3)`, instanceOwner.publicKey, instanceOwner.fingerprint);
    });
    const after = await keyCall(admin, '/v1/admin/repositories');
    // baton and docs, seeded with none in the test bindings, still lean on the deploy.
    expect(after.json.seed_owners).toEqual(['baton', 'docs']);
    expect(after.json.repositories.map((r: { id: string }) => r.id)).toContain('ops');
  });
});

describe('this repository’s seed (wrangler.toml)', () => {
  it('both environments carry baton’s owner_keys, and every entry is a registration and a seed the start accepts', async () => {
    // Production's [vars] and staging's: a malformed entry stops the Worker at its first request
    // (src/core/registry.ts), so each is taken through both checks here.
    const lists = [...inject('wranglerToml').matchAll(/BATON_REPOSITORIES = '(.*)'/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>[]);
    expect(lists.length).toBe(2);
    for (const list of lists) {
      for (const entry of list) {
        expect(() => checkRegistration(entry, 'BATON_REPOSITORIES[0]')).not.toThrow();
        // A request's body is the same entry: `admin repo add` refuses no unknown field (B-91).
        const { owner_keys: _ownerKeys, ...body } = entry;
        expect(() => checkRegistration(body, 'body')).not.toThrow();
      }
      const baton = list.find((e) => e.id === 'baton')!;
      expect(baton).toMatchObject({ default_branch: 'main' });
      // Every entry's owner keys read as the start reads them (`Admin.readSeedOwners`).
      await withCore((c) => c.admin.readSeedOwners(seeded(list)));
      // The owner `admin repo add --owner-key` wrote: one key, an OpenSSH line whose base64 is a key.
      const keys = baton.owner_keys as string[];
      expect(keys).toHaveLength(1);
      const key = await parseSshKey(keys[0]);
      expect(key.type).toBe('ssh-ed25519');
      expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    }
  });
});
