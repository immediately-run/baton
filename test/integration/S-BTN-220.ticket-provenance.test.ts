// S-BTN-220 ticket provenance (BATON_SPEC §4.4 R-BTN-194, §3.3 R-BTN-73; B-126): who last wrote
// each ticket. Must hold: a ticket whose body the worker identity pushed is served with that
// pusher — the push delivery's immutable `sender.id` and its login, never the commit author —
// and, beside it, B-127's brief mark naming the owner key that signed the brief; a later push by
// the worker replaces both; a change no delivery accounts for (none seen, or one past the
// recording bounds) is `pusher-unknown`, never credited to an owner; and the record rides the
// board read, the dashboard's ready rows, the recommendations, the claim answer and the ticket
// read. Provenance is information only: no event is raised, nothing is held (the owner,
// 2026-11-13 — B-126's `control-changed` notice was dropped). Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { captureDispatches, claimItem, cutover, Git, keyCall, placed, recommended, register, rows, setAdminKeys, setClock, ticket, webhookCall } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-13T12:00:00Z');
/** The forge user id the scenario's worker identity pushes as. */
const WORKER_ID = 424242;
/** The owner key that signed the brief, as B-127's mark names it. */
const FP = 'SHA256:' + 'k'.repeat(43);

/** A push delivery for docs' default branch (R-BTN-73), as the App sends one: the pusher is the
 *  immutable `sender.id`; the commits carry their changed paths; the author fields are forge
 *  text whoever pushed can set — here naming the owner, which must change nothing. */
function pushOf(before: string, after: string, sender: number, login: string, paths: string[], commits?: unknown[]) {
  return {
    ref: 'refs/heads/main',
    before,
    after,
    repository: { full_name: 'immediately-run/docs', id: 5 },
    pusher: { name: login, email: `${login}@users.noreply.github.com` },
    sender: { id: sender, login, type: 'User' },
    head_commit: { id: after, author: { name: 'Forged Owner', email: 'owner@example.com' } },
    commits: commits ?? [{ id: after, distinct: true, message: 'change', author: { name: 'Forged Owner', email: 'owner@example.com' }, added: [], removed: [], modified: paths }],
  };
}

/** The sha the Git helper's next post will use (its counter: each post takes the next number,
 *  hex, padded to 40). */
const shaAfter = (git: Git) => ((parseInt(git.head ?? '0', 16) || 0) + 1).toString(16).padStart(40, '0');

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

const lw = async (id = 'docs:T-1') => {
  const r = (await rows<{ last_written_by: string | null }>('SELECT last_written_by FROM tickets WHERE id = ?', id))[0];
  return r?.last_written_by ? JSON.parse(r.last_written_by) : null;
};

describe('S-BTN-220 ticket provenance', () => {
  it('a ticket body pushed by the worker is served with that pusher and the brief’s signer, everywhere a ticket is served; a later push replaces both', async () => {
    const git = new Git();
    git.add('T-1', {}, placed('filed', [], [['implement', 'ready']]));
    await git.post();
    // A first snapshot has no range: nothing is recorded.
    expect(await lw()).toBeNull();

    // The worker identity pushes the ticket's body; the sync posts the head with the brief's
    // mark (B-127: an owner key signed the commit that last changed the brief).
    const first = shaAfter(git);
    await webhookCall('push', pushOf(git.head!, first, WORKER_ID, 'immediately-run-worker', ['content/roadmap/T-1.mdx']));
    await setClock(T0 + 60_000);
    git.tickets.set('T-1', ticket('T-1', { title: 'T-1 — rewritten', brief: { signed: true, signer: FP, commit: first } }));
    expect((await git.post()).status).toBe(200);
    expect(await lw()).toEqual({ pusher: 'immediately-run-worker', pusher_id: WORKER_ID, commit: first, at: T0 });

    // The board serves it with the ready ticket (B-90), and so does the dashboard's state.
    const want = { last_written_by: { pusher: 'immediately-run-worker', pusher_id: WORKER_ID, commit: first }, brief: { signed: true, signer: FP, commit: first } };
    const board = await keyCall(admin, '/v1/repositories/docs/board');
    expect((board.json.ready as { id: string }[]).find((t) => t.id === 'docs:T-1')).toMatchObject(want);
    const state = await keyCall(admin, '/v1/admin/state');
    expect((state.json.ready as { id: string }[]).find((t) => t.id === 'docs:T-1')).toMatchObject(want);

    // The ticket read (`baton ticket show`) carries both.
    const shown = await keyCall(owner, '/v1/repositories/docs/tickets/T-1');
    expect(shown.status).toBe(200);
    expect(shown.json).toMatchObject({ ticket_id: 'docs:T-1', ...want });

    // The recommendations and the claim answer carry it (§11: before the body is read).
    const one = await register('vm-a');
    expect(await recommended(one.id)).toContain('docs:T-1');
    const claim = await claimItem('vm-a', one.secret, { ticket_id: 'docs:T-1' });
    expect(claim.json).toMatchObject(want);

    // A later push by the worker, its brief now unsigned, replaces both.
    const second = shaAfter(git);
    await setClock(T0 + 120_000);
    await webhookCall('push', pushOf(first, second, WORKER_ID, 'immediately-run-worker', ['content/roadmap/T-1.mdx']));
    git.tickets.set('T-1', ticket('T-1', { title: 'T-1 — rewritten again', brief: { signed: false, commit: second } }));
    expect((await git.post()).status).toBe(200);
    expect(await lw()).toMatchObject({ pusher: 'immediately-run-worker', commit: second });
    const again = await keyCall(owner, '/v1/repositories/docs/tickets/T-1');
    expect(again.json).toMatchObject({ last_written_by: { commit: second }, brief: { signed: false, commit: second } });
    expect((again.json.brief as Record<string, unknown>).signer).toBeUndefined();
  });

  it('a change no delivery accounts for is pusher-unknown, never credited to an owner', async () => {
    const git = new Git();
    git.add('T-1').add('T-2');
    await git.post();
    // No push delivery reached Baton (the App down, a delivery pruned): the row the post changed
    // is attributed to no one.
    await setClock(T0 + 60_000);
    git.tickets.set('T-1', ticket('T-1', { title: 'T-1 — edited' }));
    await git.post();
    expect(await lw()).toEqual({ pusher: 'pusher-unknown', commit: git.head, at: T0 + 60_000 });
    // An unchanged ticket no traced commit touched records nothing.
    expect(await lw('docs:T-2')).toBeNull();

    // A traced push of T-2 by the worker, then one past the recording bounds (31 commits): the
    // newer push may have changed T-2's file, so its writer is unknown, not the older pusher.
    const traced = shaAfter(git);
    await webhookCall('push', pushOf(git.head!, traced, WORKER_ID, 'immediately-run-worker', ['content/roadmap/T-2.mdx']));
    const after = (parseInt(traced, 16) + 1).toString(16).padStart(40, '0');
    const many = Array.from({ length: 31 }, (_, i) => ({ id: (i + 0x100).toString(16).padStart(40, '0'), added: ['x'], removed: [], modified: [] }));
    await webhookCall('push', pushOf(traced, after, 777, 'someone', [], many));
    // The sync posts the new head straight from the old one (the Git helper's counter moved past
    // the intermediate push's sha, which Baton never saw posted).
    await setClock(T0 + 120_000);
    (git as unknown as { n: number }).n = parseInt(traced, 16);
    expect((await git.post()).status).toBe(200);
    expect(git.head).toBe(after);
    expect(await lw('docs:T-2')).toMatchObject({ pusher: 'pusher-unknown', commit: after });
  });
});
