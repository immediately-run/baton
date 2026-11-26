// S-BTN-56 / G-BTN-83: pulls survive failed hints and a run cannot clear a mid-run want.
import { describe, expect, it } from 'vitest';
import { captureDispatches, Git, HOST, keyCall, mirrorCall, payload, placed, rows, setAdminKeys, setClock, syncCall, tick, webhookCall, withCore } from '../helpers';
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

  it('backfills the newest legacy held post by observation, not by wall time or accepted head', async () => {
    await setClock(T0);
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const d = 'd'.repeat(40);
    expect((await board(await observe(), a, null)).status).toBe(200);
    expect((await board(await observe(), d, a, true)).status).toBe(409);
    expect((await board(await observe(), b, a, true)).status).toBe(409);
    await withCore((c) => {
      c.store.exec("UPDATE board_head SET posted_sha = NULL WHERE repository_id = 'docs'");
      c.store.exec('DELETE FROM _baton_migrations WHERE id = 84');
      c.migrate();
    });
    expect(await wanted()).toEqual({ wanted: false, head_sha: b });
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
    const usage = () => rows("SELECT value FROM baton_settings WHERE key = 'usage'");
    const beforeUsage = await usage();
    expect(await (await mirrorCall('/v1/sync/wanted')).json()).toEqual({ wanted: true, since: T0, head_sha: null });
    expect(await rows('SELECT mirror_acked_seq AS cursor FROM repositories WHERE id = ?', 'docs')).toEqual(before);
    expect(await usage()).toEqual(beforeUsage);
    await setClock(T0 + 30 * 60_000 + 1);
    const listings = await withCore((c) => c.syncNeedsYou(c.now(), 'docs'));
    expect(listings).toMatchObject({ sync_late: [{ kind: 'baton.sync-late' }], mirror_late: [{ kind: 'baton.mirror-late' }],
      forge_secret_missing: [{ kind: 'baton.forge-secret-missing', use: 'dispatch' }] });
    await mirrorCall('/v1/sync/events?after=10000');
    expect(await (await mirrorCall('/v1/sync/wanted')).json()).toEqual({ wanted: false, head_sha: null });
  });

  it('shares one window across webhooks, sync and owner requests; sends one trailing hint', async () => {
    await setClock(T0);
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'owner');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    const sent = await captureDispatches();
    const push = { repository: { full_name: 'immediately-run/docs' }, pusher: { name: 'alice' }, head_commit: null };
    expect((await webhookCall('push', push)).status).toBe(204);
    await setClock(T0 + 1_000);
    expect((await syncCall('/v1/sync/want', {})).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/docs/sync-want', {})).status).toBe(200);
    await setClock(T0 + 29_999);
    await tick();
    expect(sent).toEqual(['docs:sync']);
    await setClock(T0 + 30_000);
    await tick();
    expect(sent).toEqual(['docs:sync', 'docs:sync']);
    await tick();
    expect(sent).toHaveLength(2);
  });

  it('wakes a targetless GitHub home and a plain home that registered the source, without enrolling either in the backstop', async () => {
    await setClock(T0);
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'owner');
    const sync = await makeKey('ssh-ed25519', 'sync');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', {
      id: 'plain', forge: 'git', github: 'team/plain', remote: 'ssh://git@git.example/team/plain.git', default_branch: 'main',
      owner_keys: [owner.publicKey], sync_keys: [{ public_key: sync.publicKey, role: 'sync' }],
    })).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/plain/settings', { code_repos: [
      { path: 'immediately-run/docs', forge: 'github', host: 'github.com', repo_id: '42', owner_id: '1' },
    ] }, 'PUT')).status).toBe(200);
    await rows("UPDATE repositories SET dispatch = NULL WHERE id = 'docs'");
    const sent = await captureDispatches();
    const push = { repository: { id: 42, full_name: 'immediately-run/docs' }, pusher: { name: 'alice' }, head_commit: null };
    expect((await webhookCall('push', push)).status).toBe(204);
    expect(await wanted()).toMatchObject({ wanted: true });
    expect((await keyCall(sync, '/v1/sync/wanted')).json).toMatchObject({ wanted: true });
    expect(await rows('SELECT repository_id FROM webhook_syncs')).toEqual([]);
    expect((await board(await observe(), 'a'.repeat(40), null)).status).toBe(200);
    // A stamp from before the target was removed must not re-wake the repository.
    await rows("INSERT INTO webhook_syncs (repository_id, last_dispatch_at) VALUES ('docs', ?)", T0);
    await setClock(T0 + 10 * 60_000 + 1);
    await tick();
    expect(await wanted()).toMatchObject({ wanted: false });
    expect(sent).toEqual([]);
  });

  it('records an unblocking even with no push target or trigger', async () => {
    await setClock(T0);
    await rows("UPDATE repositories SET dispatch = NULL WHERE id = 'docs'");
    const git = new Git().add('B', {}, placed('filed', [], [['implement', 'ready']]))
      .add('A', { blocked_by: ['B'] }, placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect(await wanted()).toMatchObject({ wanted: false });
    git.close('B', 'done');
    git.tickets.get('A')!.blocked_by = [];
    expect((await git.post()).status).toBe(200);
    expect(await rows("SELECT kind FROM events WHERE ticket_id = 'docs:A' AND kind = 'unblocked'")).toEqual([{ kind: 'unblocked' }]);
    expect(await wanted()).toMatchObject({ wanted: true });
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
