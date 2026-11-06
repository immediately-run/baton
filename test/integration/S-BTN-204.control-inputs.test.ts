// S-BTN-204 control inputs and provenance (BATON_SPEC §4.4 R-BTN-194, §3.3 R-BTN-73, §11.2
// R-BTN-58; B-126): a notice when a non-owner's push changes a control input, and who last
// wrote each ticket. Must hold: a non-owner's push changing `.baton/baton.json` raises one
// `control-changed` notice naming the path and the pusher; an owner's push — a forge identity
// the owners recorded — raises none, and an unrecorded pusher's raises again; a ticket's
// `EXPEDITE` set by a non-owner raises one naming the ticket's file and the field; a forged
// commit author with a non-owner pusher still raises (the pusher is the delivery's immutable
// `sender.id`, never the author); a missing delivery fails closed as `pusher-unknown`; and each
// ticket is served with `last_written_by` — the pusher of the commit that last changed its
// file, replaced by a later push — in the board, the recommendations and the claim answer.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { captureDispatches, claimItem, cutover, Git, keyCall, placed, recommended, register, rows, setAdminKeys, setClock, ticket, webhookCall } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-06T12:00:00Z');
/** The forge user ids the scenario pushes as: the owner's, and the worker identity's. */
const OWNER_ID = 707;
const WORKER_ID = 424242;

/** A push delivery for docs' default branch (R-BTN-73), as the App sends one: the pusher is the
 *  immutable `sender.id`; the commits carry their changed paths; the author fields are forge
 *  text whoever pushed can set — here naming the owner, which must change nothing. */
function pushOf(before: string, after: string, sender: number, login: string, paths: string[]) {
  return {
    ref: 'refs/heads/main',
    before,
    after,
    repository: { full_name: 'immediately-run/docs', id: 5 },
    pusher: { name: login, email: `${login}@users.noreply.github.com` },
    sender: { id: sender, login, type: 'User' },
    head_commit: { id: after, author: { name: 'Forged Owner', email: 'owner@example.com' } },
    commits: [{ id: after, distinct: true, message: 'change', author: { name: 'Forged Owner', email: 'owner@example.com' }, added: paths, removed: [], modified: [] }],
  };
}

/** The sha the Git helper's next post will use (its counter is the test's own: every head move
 *  below goes through `post`, each taking the next number, hex, padded). */
const shaAfter = (git: Git) => (countOf(git) + 1).toString(16).padStart(40, '0');
const countOf = (git: Git) => parseInt(git.head ?? '0', 16) || 0;

let admin: TestKey;
let owner: TestKey;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ecdsa-sha2-nistp256', 'owner');
  await setAdminKeys(admin);
  await captureDispatches();
  // docs is seeded without owners (vitest.config.ts); its owner key is the test's own.
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  await cutover();
});

describe('S-BTN-204 control inputs and provenance', () => {
  it('a non-owner\u2019s push changing .baton/baton.json raises one notice naming the path and the pusher; an owner\u2019s recorded identity raises none', async () => {
    const git = new Git();
    git.add('T-1');
    await git.post();
    // The worker identity pushes .baton/baton.json to main; the sync posts the new head.
    const parent = git.head!;
    const workerSha = shaAfter(git);
    await webhookCall('push', pushOf(parent, workerSha, WORKER_ID, 'immediately-run-worker', ['.baton/baton.json']));
    await setClock(T0 + 60_000);
    await git.post();
    const events = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'control-changed'`);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail_json)).toMatchObject({
      sha: workerSha, parent_sha: parent,
      changes: [{ path: '.baton/baton.json', commits: [workerSha], pushers: [{ id: WORKER_ID, login: 'immediately-run-worker' }] }],
    });
    // Needs you carries it (§14), naming the repository, the path and the pusher.
    const state = await keyCall(admin, '/v1/admin/state');
    expect((state.json.needs_you as { control_changes: unknown[] }).control_changes).toMatchObject([
      { repository_id: 'docs', sha: workerSha, changes: [{ path: '.baton/baton.json', pushers: [{ login: 'immediately-run-worker' }] }] },
    ]);

    // The owner records their forge identity (`baton owner identity add`): their push raises none.
    expect((await keyCall(owner, '/v1/owner/docs/identities', { forge_user_id: OWNER_ID, login: 'the-owner' })).status).toBe(200);
    const ownerSha = shaAfter(git);
    await setClock(T0 + 120_000);
    await webhookCall('push', pushOf(workerSha, ownerSha, OWNER_ID, 'the-owner', ['.baton/baton.json']));
    await setClock(T0 + 180_000);
    await git.post();
    expect(await rows('SELECT 1 FROM events WHERE kind = ? AND json_extract(detail_json, \'$.sha\') = ?', 'control-changed', ownerSha)).toEqual([]);
    // An unrecorded pusher raises again — recording is what quiets a pusher, never the reverse.
    const otherSha = shaAfter(git);
    await setClock(T0 + 240_000);
    await webhookCall('push', pushOf(ownerSha, otherSha, OWNER_ID + 1, 'other-account', ['.baton/baton.json']));
    await setClock(T0 + 300_000);
    await git.post();
    const again = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'control-changed' AND json_extract(detail_json, '$.sha') = ?`, otherSha);
    expect(again).toHaveLength(1);
    expect(JSON.parse(again[0].detail_json).changes[0].pushers).toEqual([{ id: OWNER_ID + 1, login: 'other-account' }]);
    // The identities are the owner's own read (B-126 item 3): the `pushers` setting, one list.
    const grants = await keyCall(owner, '/v1/owner/docs/grants');
    expect(JSON.parse((grants.json.settings as { pushers: string }).pushers)).toEqual([OWNER_ID]);
  });

  it('a ticket\u2019s EXPEDITE set by a non-owner raises one naming the file and the field; a forged commit author still raises', async () => {
    const git = new Git();
    git.add('T-1', { expedite: false });
    await git.post();
    // The worker pushes the ticket's file with EXPEDITE set; the commit's author fields name
    // the owner (see pushOf) — the pusher, not the author, decides.
    const sha = shaAfter(git);
    await webhookCall('push', pushOf(git.head!, sha, WORKER_ID, 'immediately-run-worker', ['content/roadmap/T-1.mdx']));
    await setClock(T0 + 60_000);
    git.tickets.set('T-1', ticket('T-1', { expedite: true }));
    await git.post();
    const events = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'control-changed'`);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail_json).changes).toMatchObject([
      { path: 'content/roadmap/T-1.mdx', fields: ['EXPEDITE'], commits: [sha], pushers: [{ id: WORKER_ID, login: 'immediately-run-worker' }] },
    ]);
    // A ticket filed afresh sets its frontmatter as its filing: not a change to an input.
    const filed = shaAfter(git);
    await setClock(T0 + 120_000);
    await webhookCall('push', pushOf(sha, filed, WORKER_ID, 'immediately-run-worker', ['content/roadmap/T-2.mdx']));
    git.add('T-2', { expedite: true });
    await git.post();
    expect(await rows('SELECT 1 FROM events WHERE kind = ? AND json_extract(detail_json, \'$.sha\') = ?', 'control-changed', filed)).toEqual([]);
  });

  it('a missing delivery fails closed: the change is pusher-unknown, never assumed an owner\u2019s', async () => {
    const git = new Git();
    git.add('T-1');
    await git.post();
    // No push delivery reached Baton (the App down, a delivery pruned): the field change the
    // rows show is attributed to no one.
    git.tickets.set('T-1', ticket('T-1', { tier: 'critical' }));
    await git.post();
    const events = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'control-changed'`);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].detail_json).changes).toMatchObject([
      { path: 'content/roadmap/T-1.mdx', fields: ['tier'], pushers: [{ id: null, login: null }] },
    ]);
  });

  it('provenance: a ticket body last pushed by the worker is served with that pusher, and a later push replaces it', async () => {
    const git = new Git();
    git.add('T-1', {}, placed('filed', [], [['implement', 'ready']]));
    await git.post();
    const lw = async () => {
      const r = (await rows<{ last_written_by: string | null }>('SELECT last_written_by FROM tickets WHERE id = ?', 'docs:T-1'))[0];
      return r?.last_written_by ? JSON.parse(r.last_written_by) : null;
    };
    // The worker identity pushes the ticket's body.
    const first = shaAfter(git);
    await webhookCall('push', pushOf(git.head!, first, WORKER_ID, 'immediately-run-worker', ['content/roadmap/T-1.mdx']));
    await setClock(T0 + 60_000);
    await git.post();
    expect(await lw()).toMatchObject({ pusher: 'immediately-run-worker', pusher_id: WORKER_ID, commit: first });

    // The board serves it with the ready ticket (B-90), and so does the dashboard's state.
    const board = await keyCall(admin, '/v1/repositories/docs/board');
    expect((board.json.ready as { id: string; last_written_by: unknown }[]).find((t) => t.id === 'docs:T-1')?.last_written_by)
      .toMatchObject({ pusher: 'immediately-run-worker', commit: first });
    const state = await keyCall(admin, '/v1/admin/state');
    expect((state.json.ready as { id: string; last_written_by: unknown }[]).find((t) => t.id === 'docs:T-1')?.last_written_by)
      .toMatchObject({ pusher: 'immediately-run-worker' });

    // The recommendations and the claim answer carry it (§11: before the body is read), and the
    // runner's claim line names the writer.
    const one = await register('vm-a');
    expect(await recommended(one.id)).toContain('docs:T-1');
    const claim = await claimItem('vm-a', one.secret, { ticket_id: 'docs:T-1' });
    expect(claim.json.last_written_by).toMatchObject({ pusher: 'immediately-run-worker', commit: first });

    // A later push by the worker replaces it; `baton ticket show` reads the same record.
    const second = shaAfter(git);
    await setClock(T0 + 120_000);
    await webhookCall('push', pushOf(first, second, WORKER_ID, 'immediately-run-worker', ['content/roadmap/T-1.mdx']));
    await git.post();
    expect(await lw()).toMatchObject({ pusher: 'immediately-run-worker', commit: second });
    const shown = await keyCall(owner, '/v1/repositories/docs/tickets/T-1');
    expect(shown.json).toMatchObject({ ticket_id: 'docs:T-1', last_written_by: { pusher: 'immediately-run-worker', commit: second } });
    // A ticket changed with no delivery traced is pusher-unknown — never credited to an owner.
    await setClock(T0 + 180_000);
    git.tickets.set('T-1', ticket('T-1', { title: 'T-1 — edited' }));
    await git.post();
    const head = (await rows<{ sha: string }>('SELECT sha FROM board_head WHERE repository_id = ?', 'docs'))[0].sha;
    expect(await lw()).toMatchObject({ pusher: 'pusher-unknown', commit: head });
  });
});
