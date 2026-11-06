// S-BTN-202 opaque ticket versions (BATON_SPEC §4.2 R-BTN-74, §4.3 R-BTN-11/R-BTN-62/R-BTN-147,
// §4.4, §4.5 R-BTN-5/R-BTN-34; B-183), the board's half: a ticket's `version` is its source's
// opaque string, stored on the row and compared for equality only; a source declares how it
// reads (`versions`: pinned at a version, current as it is now); a refresh — the head's own
// reading again — may add, close or change any ticket whose version differs from the row Baton
// holds; the observation hands each live ticket's last accepted version back, for the source's
// own code to judge against; a dropped-and-re-added ticket with the same `key` and a new id is
// `renumbered`, its hold and backoff moving to the new id; a post from a `custom` source with
// `versions: "current"` to a repository whose policy's floors include `tickets-approved` is
// refused, naming the guarantee; the claim answer names the ticket's version and the source's
// way of reading. The sync's and the runner's halves are S-BTN-203's (Node only: real git).
import { describe, it, expect, beforeEach } from 'vitest';
import { claimItem, claimRow, cutover, Git, observe, placed, register, rows, setClock, syncCall } from '../helpers';

const T0 = Date.parse('2026-11-06T12:00:00Z');
/** The source declaration the CLI's sync posts for a tracker-backed source. */
const CURRENT = { source: { kind: 'custom' as const, versions: 'current' as const, cli: '0.0.0-test' } };

/** The ticket a tracker posts: no `path` (§4.4: a custom current source may post a pathless
 *  ticket), a stable `key`, an opaque `version` — a store stamp over a digest, the spec's
 *  recommendation (§4.2). */
const tracked = (id: string, version: string, over: Record<string, unknown> = {}) => ({
  id, version, key: `linear:issue-${id}`, path: undefined, course_id: 'roadmap-pr', title: `${id} — a tracked ticket`, tier: 'routine', requires: [],
  operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: ['immediately-run/docs'], rank: 0, ...over,
});
const FILED = placed('filed', [], [['implement', 'ready']]);

beforeEach(async () => {
  await setClock(T0);
  await cutover();
});

describe('S-BTN-202 opaque ticket versions', () => {
  it('a current-source ticket edited with no commit reaches the board in a refresh: changed, added and closed tickets', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    git.add('T-3', tracked('T-3', 'rev-1:dead0000'), FILED);
    expect(await git.post(CURRENT)).toMatchObject({ status: 200, ok: true });
    expect(await rows<{ version: string; key: string | null; path: string }>('SELECT version, key, path FROM tickets WHERE id = ?', 'docs:T-1'))
      .toEqual([{ version: 'rev-1:aaaaaaaa', key: 'linear:issue-T-1', path: '' }]);

    // The tracker moves with no commit: a refresh of the same head under a newer number changes
    // T-1's row (its version differs from the row Baton holds), adds T-2 and closes T-3
    // (§4.3, R-BTN-11). Materialization upserts by row_hash, version among its inputs.
    git.tickets.set('T-1', tracked('T-1', 'rev-2:bbbbbbbb', { title: 'T-1 — edited in the tracker' }));
    git.add('T-2', tracked('T-2', 'rev-9:cccccccc'), FILED);
    git.close('T-3', 'withdrawn');
    expect(await git.refresh(CURRENT)).toMatchObject({ status: 200, ok: true, unchanged: true, tickets_upserted: 2, tickets_deleted: 1 });
    expect(await rows('SELECT local_id AS id, version, title FROM tickets WHERE repository_id = ? ORDER BY id', 'docs')).toEqual([
      { id: 'T-1', version: 'rev-2:bbbbbbbb', title: 'T-1 — edited in the tracker' },
      { id: 'T-2', version: 'rev-9:cccccccc', title: 'T-2 — a tracked ticket' },
    ]);
    // The closed ticket left the board and its closure stands — a tracker's withdrawal reaches
    // the board with no commit.
    expect(await rows('SELECT ticket_id FROM closed_tickets')).toEqual([{ ticket_id: 'docs:T-3' }]);

    // The same versions again write no row: a refresh of an unchanged store changes nothing.
    expect(await git.refresh(CURRENT)).toMatchObject({ status: 200, ok: true, unchanged: true, tickets_upserted: 0, tickets_deleted: 0 });
  });

  it('a tracker withdrawal in a refresh releases the claim on it; one whose ticket did not change runs on', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    git.add('T-2', tracked('T-2', 'rev-1:dddddddd'), FILED);
    await git.post(CURRENT);
    const one = await register('vm-a');
    const two = await register('vm-b');
    const c1 = await claimItem('vm-a', one.secret, { ticket_id: 'docs:T-1' });
    const c2 = await claimItem('vm-b', two.secret, { ticket_id: 'docs:T-2' });
    // The claim answer names the ticket's version and the source's way of reading (§4.5).
    expect(c1.json).toMatchObject({ version: 'rev-1:aaaaaaaa', ticket_source: { kind: 'custom', versions: 'current' } });
    git.close('T-1', 'withdrawn');
    expect(await git.refresh(CURRENT)).toMatchObject({ ok: true, stale_released: 1 });
    expect(await claimRow(c1.json.claim_id)).toMatchObject({ status: 'released', end_reason: 'released:stale-board' });
    expect(await claimRow(c2.json.claim_id)).toMatchObject({ status: 'active' });
  });

  it('the observation returns each live ticket’s last accepted version (§4.3), for the source to judge against', async () => {
    const MIN = 60_000;
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    git.add('T-2', tracked('T-2', 'rev-1:dddddddd'), FILED);
    await git.post(CURRENT);
    expect((await observe()).json.versions).toEqual({ 'T-1': 'rev-1:aaaaaaaa', 'T-2': 'rev-1:dddddddd' });
    // The observation's own number is outstanding for its ten minutes (R-BTN-62): the next run
    // waits past them before it reads again.
    await setClock(T0 + 11 * MIN);
    git.tickets.set('T-2', tracked('T-2', 'rev-2:eeeeeeee'));
    await git.refresh(CURRENT);
    expect((await observe()).json.versions).toEqual({ 'T-1': 'rev-1:aaaaaaaa', 'T-2': 'rev-2:eeeeeeee' });
  });

  it('a dropped-and-re-added ticket with the same key and a new id is renumbered: the new id takes the hold and backoff', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    await git.post(CURRENT);
    // The old id's owner state: a hold with a backoff (§6.10).
    await rows(`INSERT INTO ticket_overrides (ticket_id, hold, hold_reason, retry_after, set_by, set_at) VALUES ('docs:T-1', 1, 'owner', ?, 'owner:x', ?)`, T0 + 3_600_000, T0);
    // The tracker renumbers: the same key returns under a new id (R-BTN-147).
    git.close('T-1', 'withdrawn');
    git.add('T-9', tracked('T-9', 'rev-1:aaaaaaaa', { key: 'linear:issue-T-1' }), FILED);
    expect(await git.post(CURRENT)).toMatchObject({ ok: true, renumbered: [{ from: 'T-1', to: 'T-9', key: 'linear:issue-T-1' }] });
    expect(await rows('SELECT detail_json FROM events WHERE kind = ?', 'renumbered'))
      .toEqual([{ detail_json: JSON.stringify({ from: 'T-1', to: 'T-9', key: 'linear:issue-T-1' }) }]);
    expect(await rows('SELECT ticket_id, hold, retry_after FROM ticket_overrides'))
      .toEqual([{ ticket_id: 'docs:T-9', hold: 1, retry_after: T0 + 3_600_000 }]);
    // A re-added id with a DIFFERENT key is a plain drop: no hold moves — the new id carries no
    // override, and the dropped id's owner state stays where it was (R-BTN-12).
    git.close('T-9', 'withdrawn');
    git.add('T-8', tracked('T-8', 'rev-1:aaaaaaaa', { key: 'linear:issue-other' }), FILED);
    expect(await git.post(CURRENT)).toMatchObject({ ok: true, deleted: 1 });
    expect(await rows('SELECT ticket_id FROM ticket_overrides')).toEqual([{ ticket_id: 'docs:T-9' }]);
  });

  it('a current source posting to a repository with a tickets-approved floor is refused, naming the guarantee; pinned and markdown posts are not', async () => {
    // The deployment's floor (§12.8, R-BTN-189), seeded as the owner route writes it: the
    // guarantee is defined over a ticket file's approval (R-BTN-184).
    await rows(`INSERT INTO policy_floors (repository_id, name, guarantees, remove_by, added_by, added_at) VALUES ('docs', 'floor', '["tickets-approved"]', 'human', 'admin:x', ?)`, T0);
    try {
      const git = new Git();
      git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
      const refused = await git.post(CURRENT);
      const body = refused as unknown as { status: number; code?: string; message?: string };
      expect([body.status, body.code, body.message]).toEqual([400, 'invalid-params', expect.stringContaining('tickets-approved')]);
      expect(await rows('SELECT 1 FROM tickets')).toEqual([]);
      // A pinned custom source, and the markdown default, post as before: the refusal is about
      // reading only as it is now, never about whose source it is (their tickets carry a path,
      // which a pinned source still needs).
      git.tickets.set('T-1', tracked('T-1', 'rev-1:aaaaaaaa', { path: 'tickets/t-1.mdx' }));
      expect(await git.post({ source: { kind: 'custom', versions: 'pinned', cli: '0.0.0-test' } })).toMatchObject({ status: 200, ok: true });
      expect(await git.post({ source: { kind: 'markdown', versions: 'pinned', cli: '0.0.0-test' } })).toMatchObject({ status: 200, ok: true });
    } finally {
      await rows(`DELETE FROM policy_floors WHERE repository_id = 'docs'`);
    }
  });

  it('versions and keys are validated on write (§12.3); a pathless ticket needs a key, and only a custom current source may post one', async () => {
    const git = new Git();
    // A version outside §12.3's grammar is refused whole.
    const refusal = async () => {
      const res = await git.post(CURRENT);
      expect([res.status, (res as Record<string, unknown>).code]).toEqual([400, 'invalid-params']);
    };
    git.add('T-1', tracked('T-1', 'a version with spaces'), FILED);
    await refusal();
    // A ticket with no path and no key names nothing stable: refused.
    git.tickets.set('T-1', { ...tracked('T-1', 'rev-1:bbbbbbbb'), key: undefined });
    await refusal();
    // With the key, and the source reading current, a pathless ticket is accepted (§4.4).
    git.tickets.set('T-1', tracked('T-1', 'rev-1:bbbbbbbb'));
    expect(await git.post(CURRENT)).toMatchObject({ status: 200 });
    expect(await rows('SELECT key FROM tickets WHERE id = ?', 'docs:T-1')).toEqual([{ key: 'linear:issue-T-1' }]);
    // The same pathless ticket from a pinned source — markdown or custom — is refused: only a
    // source that reads as it is now may post a ticket with no file.
    git.tickets.set('T-1', { ...tracked('T-1', 'rev-1:cccccccc'), key: undefined, path: undefined });
    expect((await git.post({ source: { kind: 'custom', versions: 'pinned', cli: '0.0.0-test' } })).status).toBe(400);
    expect((await git.post({ source: { kind: 'markdown', versions: 'pinned', cli: '0.0.0-test' } })).status).toBe(400);
    // A declared source that is neither markdown nor custom, or a mode that is neither pinned
    // nor current, is refused (§4.4).
    expect((await git.post({ source: { kind: 'forge' as never, cli: 't' } })).status).toBe(400);
    expect((await git.post({ source: { kind: 'custom', versions: 'sometimes' as never, cli: 't' } })).status).toBe(400);
  });

  it('a board that declared no source keeps today’s reading: no version held, the claim answer names none', async () => {
    const git = new Git();
    git.add('T-1', {}, FILED);
    await git.post();
    expect(await rows('SELECT version, key FROM tickets WHERE id = ?', 'docs:T-1')).toEqual([{ version: '', key: 'content/roadmap/T-1.mdx' }]);
    const { secret } = await register('vm-a');
    const c = await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' });
    expect(c.json).toMatchObject({ version: '' });
    expect(c.json.ticket_source).toBeUndefined();
    // The observation still hands back the (empty) version it holds.
    expect((await observe()).json.versions).toEqual({ 'T-1': '' });
  });
});
