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
// way of reading. Review round 1: a refresh materializes only a body read at the head it
// refreshes (`read_sha`; a confirm-only re-post from a checkout behind the head, or an older
// CLI's post naming none, changes no ticket row) and a refresh overtaken while its rows were
// hashed is refused as a new head is; a refresh that writes rows checks the courses it names
// and clears the closure of a ticket it re-adds; an existing ticket that moves onto a dropped
// key keeps its own hold; two tickets of one post never share a key. The sync's and the
// runner's halves are S-BTN-203's (Node only: real git).
import { describe, it, expect, beforeEach } from 'vitest';
import { claimItem, claimRow, cutover, Git, observe, placed, register, rows, setClock, syncCall, withCore } from '../helpers';
import { checkPayload } from '../../src/core/board';

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

  it('a refresh whose body was read at another commit changes no ticket: no rollback, no deletion (round 1)', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    git.add('T-2', tracked('T-2', 'rev-1:dead0000'), FILED);
    await git.post(CURRENT);
    // A confirm-only re-post of the head from a checkout behind it (§7.1): labelled with the
    // head's sha, its body the ancestor's older reading — T-1 before the edit, T-2 not yet
    // added. Writing it would roll the cache back; a refresh materializes only a body read at
    // the head it refreshes (`read_sha`, §4.3).
    const ancestor = 'e'.repeat(40);
    const behind = await git.refresh({
      ...CURRENT, read_sha: ancestor,
      tickets: [tracked('T-1', 'rev-0:00000000', { title: 'T-1 — the old reading' })],
      closed: [], stations: { 'T-1': FILED },
    }) as Record<string, any>;
    expect(behind).toMatchObject({ status: 200, ok: true, unchanged: true });
    expect(behind.tickets_upserted).toBeUndefined();
    expect(behind.tickets_deleted).toBeUndefined();
    expect(await rows('SELECT local_id AS id, version FROM tickets WHERE repository_id = ? ORDER BY id', 'docs')).toEqual([
      { id: 'T-1', version: 'rev-1:aaaaaaaa' },
      { id: 'T-2', version: 'rev-1:dead0000' },
    ]);
    // An older CLI's refresh, naming no read_sha at all, changes no ticket either: absent means
    // not read at the head, never a materialization on the word of a body Baton cannot place.
    const older = await git.refresh({
      ...CURRENT, read_sha: undefined,
      tickets: [tracked('T-1', 'rev-0:00000000', { title: 'T-1 — the old reading' })],
      closed: [], stations: { 'T-1': FILED },
    }) as Record<string, any>;
    expect(older).toMatchObject({ status: 200, ok: true, unchanged: true });
    expect(await rows('SELECT local_id AS id, version FROM tickets WHERE repository_id = ? ORDER BY id', 'docs')).toEqual([
      { id: 'T-1', version: 'rev-1:aaaaaaaa' },
      { id: 'T-2', version: 'rev-1:dead0000' },
    ]);
  });

  it('a refresh another run overtook while its rows were hashed is refused; the newer reading stands (round 1)', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    await git.post(CURRENT);
    // The refresh carries the moved ticket (rev-2) and is held at its row hashing — its number
    // already used (R-BTN-62) — while a second run takes the next number and posts a NEW head
    // (rev-3) that completes first. The refresh's transaction must refuse as the new-head path's
    // does after the same await: never overwrite the newer post's row with the older reading,
    // never drop what the newer post added.
    git.tickets.set('T-1', tracked('T-1', 'rev-2:bbbbbbbb'));
    const out = await withCore(async (c) => {
      const core = c as unknown as {
        registry: { get(id: string): unknown };
        rowsFor: (repo: unknown, p: { sha: string }) => Promise<unknown>;
        board: (repo: unknown, p: unknown) => Promise<unknown>;
        observations: { observe: (r: string) => { observation: number } };
      };
      const repo = core.registry.get('docs');
      const head = git.head!;
      const orig = core.rowsFor.bind(c);
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      // Hold only the refresh's hashing (its payload's sha is the head); the second run's flows on.
      core.rowsFor = async (r2, p) => {
        const hashed = await orig(r2, p);
        if (p.sha === head) await gate;
        return hashed;
      };
      const first = core.observations.observe('docs').observation;
      const p1 = core.board(repo, checkPayload({ ...git.body(head, head), ...CURRENT, read_sha: head, observation: first }))
        .then(() => ({ ok: true }), (e: { code: string }) => ({ code: e.code }));
      const second = core.observations.observe('docs').observation;
      const newer = new Git();
      newer.add('T-1', tracked('T-1', 'rev-3:dddddddd'), FILED);
      const p2 = await core.board(repo, checkPayload({ ...newer.body('f'.repeat(40), head), ...CURRENT, observation: second }))
        .then(() => ({ ok: true }), (e: { code: string }) => ({ code: e.code }));
      release();
      return [await p1, p2];
    });
    expect(out[1]).toEqual({ ok: true });
    expect(out[0]).toMatchObject({ code: expect.stringMatching(/^(head-moved|stale-observation)$/) });
    // The newer reading stands: the refresh never rolled the row back to rev-2.
    expect(await rows('SELECT version FROM tickets WHERE id = ?', 'docs:T-1')).toEqual([{ version: 'rev-3:dddddddd' }]);
  });

  it('a refresh that adds a ticket whose course is not in force is refused, its row unwritten (round 1)', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    await git.post(CURRENT);
    git.add('T-9', tracked('T-9', 'rev-1:cccccccc', { course_id: 'no-such-course' }), FILED);
    const refused = await git.refresh(CURRENT) as Record<string, any>;
    expect([refused.status, refused.code]).toEqual([400, 'invalid-params']);
    expect(refused.message).toContain('no-such-course');
    // Nothing landed: the refresh was refused whole, as the same content as a new head is.
    expect(await rows('SELECT local_id FROM tickets')).toEqual([{ local_id: 'T-1' }]);
  });

  it('a ticket withdrawn in one refresh and re-added in the next is live again, its closure cleared (round 1)', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    await git.post(CURRENT);
    // A tracker withdrawal with no commit: the refresh drops the row and records the closure.
    git.close('T-1', 'withdrawn');
    expect(await git.refresh(CURRENT)).toMatchObject({ ok: true, tickets_deleted: 1 });
    expect(await rows('SELECT ticket_id, closed_as FROM closed_tickets')).toEqual([{ ticket_id: 'docs:T-1', closed_as: 'withdrawn' }]);
    // Re-added with no commit: the ticket is live again and — a live ticket is not closed
    // (R-BTN-12) — its closure row is gone, as a new head's `reopened` clears it.
    git.add('T-1', tracked('T-1', 'rev-2:bbbbbbbb'), FILED);
    expect(await git.refresh(CURRENT)).toMatchObject({ ok: true, tickets_upserted: 1 });
    expect(await rows('SELECT local_id, version FROM tickets')).toEqual([{ local_id: 'T-1', version: 'rev-2:bbbbbbbb' }]);
    expect(await rows('SELECT ticket_id FROM closed_tickets')).toEqual([]);
  });

  it('an existing ticket that moves onto a dropped ticket’s key keeps its own hold — it is not “renumbered onto” (round 1)', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    git.add('T-2', tracked('T-2', 'rev-1:dddddddd'), FILED);
    await git.post(CURRENT);
    await rows(`INSERT INTO ticket_overrides (ticket_id, hold, hold_reason, retry_after, set_by, set_at) VALUES ('docs:T-1', 1, 'one', ?, 'owner:x', ?)`, T0 + 3_600_000, T0);
    await rows(`INSERT INTO ticket_overrides (ticket_id, hold, hold_reason, retry_after, set_by, set_at) VALUES ('docs:T-2', 1, 'two', ?, 'owner:y', ?)`, T0 + 7_200_000, T0);
    // The post drops T-1 while the SURVIVING T-2 takes its key: the move the spec names is a
    // post that ADDS a ticket at the key of one it drops (R-BTN-147) — T-2 was already on the
    // board, so nothing moves: no event, and each keeps its own hold.
    git.close('T-1', 'withdrawn');
    git.tickets.set('T-2', tracked('T-2', 'rev-2:dddddddd', { key: 'linear:issue-T-1' }));
    const res = await git.post(CURRENT) as Record<string, any>;
    expect(res.renumbered).toBeUndefined();
    expect(await rows('SELECT ticket_id, hold_reason FROM ticket_overrides ORDER BY ticket_id')).toEqual([
      { ticket_id: 'docs:T-1', hold_reason: 'one' },
      { ticket_id: 'docs:T-2', hold_reason: 'two' },
    ]);
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'renumbered'`)).toEqual([]);
  });

  it('two live tickets of one post never share a stable key, whichever way it is named (round 1)', async () => {
    const git = new Git();
    git.add('T-1', tracked('T-1', 'rev-1:aaaaaaaa'), FILED);
    git.add('T-2', tracked('T-2', 'rev-1:dddddddd', { key: 'linear:issue-T-1' }), FILED);
    const byKey = await git.post(CURRENT) as Record<string, any>;
    expect([byKey.status, byKey.code]).toEqual([400, 'invalid-params']);
    expect(byKey.message).toContain('linear:issue-T-1');
    // The same collision through two paths that stand for keys (the effective key is `key ?? path`).
    git.tickets.set('T-1', tracked('T-1', 'rev-1:aaaaaaaa', { key: undefined, path: 'tickets/t-1.mdx' }));
    git.tickets.set('T-2', tracked('T-2', 'rev-1:dddddddd', { key: undefined, path: 'tickets/t-1.mdx' }));
    const byPath = await git.post(CURRENT) as Record<string, any>;
    expect([byPath.status, byPath.code]).toEqual([400, 'invalid-params']);
    expect(await rows('SELECT 1 FROM tickets')).toEqual([]);
  });
});
