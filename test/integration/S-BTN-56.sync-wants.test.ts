// S-BTN-56 / G-BTN-83: pulls survive failed hints and a run cannot clear a mid-run want.
import { describe, expect, it } from 'vitest';
import { HOST, keyCall, mirrorCall, payload, rows, setAdminKeys, setClock, syncCall, webhookCall, withCore } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import type { Ports } from '../../src/core/ports';
import { logEvent } from '../../src/core/db';

const T0 = Date.parse('2026-12-01T12:00:00Z');
const wanted = async () => (await syncCall('/v1/sync/wanted')).json();
const observe = async () => ((await (await syncCall('/v1/sync/observation', {})).json()) as { observation: number }).observation;
const fence = () => rows('SELECT sync_wanted_at, sync_wanted_after FROM repositories WHERE id = ?', 'docs');
const board = (observation: number, sha: string, parent: string | null, force = false) =>
  syncCall('/v1/sync/board', payload(sha, parent, { items: [], ready: [] }, { observation, force }));

describe(`S-BTN-56 sync wants (${HOST})`, () => {
  it('records before dispatch, retries a failure once, and preserves a want made mid-run', async () => {
    await setClock(T0);
    const calls: unknown[] = [];
    const work: Promise<unknown>[] = [];
    await withCore((c) => {
      const { ports } = c as unknown as { ports: Ports };
      ports.dispatch = {
        send: async () => { calls.push(c.syncWants.wanted('docs', 'sync')); return false; },
        defer: (p) => { work.push(p); },
      };
    });
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    expect(await wanted()).toEqual({ wanted: false, head_sha: null });
    const push = { repository: { full_name: 'immediately-run/docs' }, pusher: { name: 'alice' }, head_commit: null };
    expect((await webhookCall('push', push, { id: 'want-first' })).status).toBe(204);
    await Promise.all(work.splice(0));
    expect(calls).toEqual(Array(2).fill({ wanted: true, since: T0, head_sha: null }));
    expect(await fence()).toEqual([{ sync_wanted_at: T0, sync_wanted_after: 0 }]);

    const n = await observe();
    await setClock(T0 + 1_000);
    expect((await webhookCall('push', push, { id: 'want-second' })).status).toBe(204);
    expect(calls).toHaveLength(2); // coalesced hint, but the want moves immediately
    expect(await fence()).toEqual([{ sync_wanted_at: T0, sync_wanted_after: n }]);
    expect((await board(n, a, null)).status).toBe(200);
    expect(await wanted()).toEqual({ wanted: true, since: T0, head_sha: a });
    const held = await board(await observe(), b, a, true);
    expect(held.status).toBe(409);
    expect(await wanted()).toEqual({ wanted: false, head_sha: b });
    expect(await (await syncCall('/v1/sync/head')).json()).toMatchObject({ sha: a });
  });

  it('answers mirror polling without acknowledging and reports overdue wants and missing secrets', async () => {
    await setClock(T0);
    await withCore((c) => {
      c.store.transaction(() => {
        logEvent(c.store, T0 - 10, 'blocked', 'baton', {}, null, null, 'docs');
        logEvent(c.store, T0, 'claimed', 'baton', {}, null, null, 'docs');
      });
    });
    expect((await mirrorCall('/v1/sync/want', {})).status).toBe(403);
    expect((await syncCall('/v1/sync/want', {})).status).toBe(200);
    const before = await rows('SELECT mirror_acked_seq AS cursor FROM repositories WHERE id = ?', 'docs');
    expect(await (await mirrorCall('/v1/sync/wanted')).json()).toEqual({ wanted: true, since: T0, head_sha: null });
    expect(await rows('SELECT mirror_acked_seq AS cursor FROM repositories WHERE id = ?', 'docs')).toEqual(before);
    await setClock(T0 + 30 * 60_000 + 1);
    const listings = await withCore((c) => c.syncNeedsYou(c.now(), 'docs'));
    expect(listings).toMatchObject({ sync_late: [{ kind: 'baton.sync-late' }], mirror_late: [{ kind: 'baton.mirror-late' }],
      forge_secret_missing: [{ kind: 'baton.forge-secret-missing', use: 'dispatch' }] });
    await mirrorCall('/v1/sync/events?after=10000');
    expect(await (await mirrorCall('/v1/sync/wanted')).json()).toEqual({ wanted: false, head_sha: null });
  });

  it('lets a repository owner record a want on a plain git registration', async () => {
    await setClock(T0);
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'owner');
    const sync = await makeKey('ssh-ed25519', 'sync');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', {
      id: 'plain', forge: 'git', github: 'team/plain', remote: 'ssh://git@git.example/team/plain.git', default_branch: 'main',
      owner_keys: [owner.publicKey], sync_keys: [{ public_key: sync.publicKey, role: 'sync' }],
    })).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/docs/sync-want', {})).status).toBe(403);
    expect((await keyCall(owner, '/v1/owner/plain/sync-want', {})).status).toBe(200);
    expect((await keyCall(sync, '/v1/sync/wanted')).json).toEqual({ wanted: true, since: T0, head_sha: null });
  });
});
