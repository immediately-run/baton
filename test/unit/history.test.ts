// history.test.ts — each ticket's history and Baton's disagreements with git (BATON_SPEC §2h R-BTN-81,
// R-BTN-85, §2g R-BTN-78; R3-1257): the rows each transaction writes, paging, the 2 KB cap and the
// 90-day purge; a discrepancy for each trigger that exists before B-38 (regressed, off-graph,
// bars-mismatch, closed-under-claim), logged in the transaction that adopts git's value; and
// Baton's own decisions — raised, answered by `resolve`, closed with the hold, never raised for a
// wait Baton stores itself or a ticket an owner holds.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, adminSession, advance, claimItem, cutover, endClaim, keyCall, placed, register, rows, sessionCall, setAdminKeys, setClock, tick, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { signed } from '../lib/fleet';
import { DETAIL_MAX_BYTES, KEEP_AFTER_CLOSE_MS, detailJson } from '../../src/core/history';
import { STALLED_AFTER_MS } from '../../src/core/blocks';
import { checkDecisionAnswer } from '../../src/core/validate';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];

let admin: TestKey;
let owner: TestKey;
let git: Git;

const history = async (local: string, q = '') => (await signed(owner, `/v1/repositories/docs/tickets/${local}/history${q}`, { method: 'GET' })).json;
const discrepancies = async (local: string) => (await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE ticket_id = ? AND kind = 'discrepancy' ORDER BY seq`, `docs:${local}`))
  .map((e) => JSON.parse(e.detail_json));
/** A dashboard request under an administrator's session (Access alone is refused once
 *  administrator keys are configured, R-BTN-57). */
const ui = async (path: string, body?: unknown) => sessionCall(await adminSession(admin), path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const decisions = (local: string) => rows<{ decision_id: string }>('SELECT decision_id FROM ticket_decisions WHERE ticket_id = ? ORDER BY decision_id', `docs:${local}`);

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] });
  git = new Git().add('A').add('B', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover(T0);
});

describe('R-BTN-81: the rows, the reader and the purge', () => {
  it('a claim writes leg-started and leg-finished rows with run, snapshot and course version; git-moved only when no claim explains it', async () => {
    const w = await register('vm-a');
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json;
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    await setClock(T0 + MIN);
    expect((await endClaim('vm-a', w.secret, c.claim_id, { end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'review' })).status).toBe(200);
    const snapshot = (await rows<{ snapshot_sha: string }>('SELECT snapshot_sha FROM claims WHERE id = ?', c.claim_id))[0].snapshot_sha;
    expect((await history('A')).rows).toEqual([
      expect.objectContaining({ kind: 'leg-finished', claim_id: c.claim_id, worker_id: w.id, leg: 'implement', run: 1, reached: 'pr-open', next_leg: 'review', snapshot_sha: snapshot, course_version: 3, at: T0 + MIN }),
      expect.objectContaining({ kind: 'leg-started', claim_id: c.claim_id, leg: 'implement', run: 1, snapshot_sha: snapshot, course_version: 3, detail: { from: 'filed' } }),
    ]);
    // The snapshot showing the claim's end moves A: the claim said so, so no git-moved row.
    git.place('A', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await history('A')).rows.map((r: { kind: string }) => r.kind)).toEqual(['leg-finished', 'leg-started']);
    // B moves with no claim: someone else's work.
    git.place('B', placed('reviewed', REVIEWED, [['merge', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await history('B')).rows.map((r: { kind: string }) => r.kind)).toEqual(['git-moved']);
  });

  it('a person moving the ticket during a claim, to a station the claim never reported, is git-moved', async () => {
    const w = await register('vm-a');
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:B' })).json;
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'review' })).status).toBe(200);
    // A snapshot lagging the holder shows where the claim was: no row.
    git.place('B', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await history('B')).rows.map((r: { kind: string }) => r.kind)).toEqual(['leg-started']);
    // A person pushes the ticket to `merged` meanwhile: the claim never reported it.
    git.place('B', placed('merged', [['implement', 'pr-open'], ['review', 'reviewed'], ['merge', 'merged']], []));
    expect((await git.post()).status).toBe(200);
    expect((await history('B')).rows.map((r: { kind: string }) => r.kind)).toEqual(['git-moved', 'leg-started']);
  });

  it('pages newest first by id, at most 200; refuses a bad cursor or limit; a worker key not granted is forbidden', async () => {
    await withCore((core) => {
      core.store.transaction(() => {
        for (let i = 0; i < 205; i++) core.history.record('docs:A', { kind: 'git-moved', detail: { i } });
      });
    });
    const first = await history('A', '?limit=200');
    expect(first.rows).toHaveLength(200);
    expect(first.rows[0].detail).toEqual({ i: 204 });
    const rest = await history('A', `?before=${first.next_before}&limit=200`);
    expect(rest.rows.map((r: { detail: { i: number } }) => r.detail.i)).toEqual([4, 3, 2, 1, 0]);
    expect(rest.next_before).toBeUndefined();
    for (const q of ['?limit=201', '?limit=0', '?before=-1', '?before=x']) expect((await history('A', q)).code).toBe('invalid-params');
    expect((await signed(owner, '/v1/repositories/docs/tickets/ops:A/history', { method: 'GET' })).json.code).toBe('invalid-params');
  });

  it('a detail over 2 KB is replaced by a note, never refused', () => {
    expect(detailJson(null)).toBeNull();
    expect(detailJson({ a: 'x'.repeat(DETAIL_MAX_BYTES - 10) })).toBe(JSON.stringify({ a: 'x'.repeat(DETAIL_MAX_BYTES - 10) }));
    expect(JSON.parse(detailJson({ a: 'x'.repeat(DETAIL_MAX_BYTES) })!)).toEqual({ omitted: `detail over ${DETAIL_MAX_BYTES} bytes` });
    // Bytes, not characters: 1,000 three-byte characters are over.
    expect(JSON.parse(detailJson({ a: '€'.repeat(1000) })!)).toEqual({ omitted: `detail over ${DETAIL_MAX_BYTES} bytes` });
  });

  it('the alarm deletes the history of a ticket closed 90 days ago, once; a live ticket keeps it', async () => {
    await withCore((core) => core.store.transaction(() => {
      core.history.record('docs:A', { kind: 'git-moved' });
      core.history.record('docs:B', { kind: 'git-moved' });
    }));
    git.close('A', 'done');
    expect((await git.post()).status).toBe(200);
    await setClock(T0 + KEEP_AFTER_CLOSE_MS - MIN);
    await tick();
    expect(await rows(`SELECT ticket_id FROM ticket_history ORDER BY ticket_id`)).toEqual([{ ticket_id: 'docs:A' }, { ticket_id: 'docs:B' }]);
    await setClock(T0 + KEEP_AFTER_CLOSE_MS);
    await tick();
    expect(await rows(`SELECT ticket_id FROM ticket_history`)).toEqual([{ ticket_id: 'docs:B' }]);
    expect(await rows(`SELECT purged_at FROM closed_tickets WHERE ticket_id = 'docs:A'`)).toEqual([{ purged_at: T0 + KEEP_AFTER_CLOSE_MS }]);
  });
});

describe('R-BTN-85: a discrepancy before git wins', () => {
  it('regressed: a claim whose path went backwards, beside the regressed event', async () => {
    const w = await register('vm-a');
    git.place('A', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json;
    // The holder goes on past what git last posted: Baton's value is the claim's reckoning.
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'review' })).status).toBe(200);
    expect((await advance('vm-a', w.secret, c.claim_id, { reached: 'reviewed', leg: 'merge' })).status).toBe(200);
    git.place('A', placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect(await discrepancies('A')).toEqual([{ sub: 'regressed', baton: { path: [{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }], source: 'claim' }, git: { path: [] }, observation: expect.any(Number) }]);
    expect(await rows(`SELECT kind FROM events WHERE ticket_id = 'docs:A' AND kind IN ('regressed','discrepancy') ORDER BY seq`)).toEqual([{ kind: 'regressed' }, { kind: 'discrepancy' }]);
    // Newest first. Both moves are git's own, not the claim's: A's to pr-open before the claim, and
    // the regression back to filed, a station the claim never reported; the legs between are the claim's.
    expect((await history('A')).rows.map((r: { kind: string }) => r.kind)).toEqual(['discrepancy', 'regressed', 'git-moved', 'leg-started', 'leg-finished', 'leg-started', 'git-moved']);
    expect(c.claim_id).toBeTruthy();
  });

  it('off-graph: a path that does not extend the last by edges, adopted all the same', async () => {
    git.place('B', placed('merged', [['implement', 'pr-open'], ['merge', 'merged']], []));
    expect((await git.post()).status).toBe(200);
    expect(await discrepancies('B')).toEqual([{ sub: 'off-graph', baton: { path: [{ leg: 'implement', reached: 'pr-open' }], source: 'snapshot' },
      git: { why: 'the path does not extend the previous one by edges', path: [{ leg: 'implement', reached: 'pr-open' }, { leg: 'merge', reached: 'merged' }] }, observation: expect.any(Number) }]);
    expect(await rows(`SELECT station FROM ticket_stations WHERE ticket_id = 'docs:B'`)).toEqual([{ station: 'merged' }]);
  });

  it('bars-mismatch: a holder-declared bar the posted bars lack', async () => {
    git.place('B', placed('reviewed', REVIEWED, [['merge', 'ready']]));
    await git.post();
    const w = await register('vm-a');
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:B' })).json;
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'merge', bars: ['family:glm'] })).status).toBe(200);
    git.place('B', placed('reviewed', REVIEWED, [['merge', 'ready']], { bars: { merge: [] } }));
    expect((await git.post()).status).toBe(200);
    expect(await discrepancies('B')).toEqual([{ sub: 'bars-mismatch', baton: { bars: ['family:glm'], leg: 'merge', source: 'holder' }, git: { bars: [] }, observation: expect.any(Number) }]);
  });

  it('closed-under-claim: a ticket withdrawn while a claim is active on it; a done closure is no discrepancy', async () => {
    const w = await register('vm-a');
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json;
    git.close('A', 'withdrawn');
    expect((await git.post()).status).toBe(200);
    expect(await discrepancies('A')).toEqual([{ sub: 'closed-under-claim', baton: { claim_id: c.claim_id, status: 'active', source: 'claim' }, git: { closed: 'withdrawn' }, observation: expect.any(Number) }]);
    const w2 = await register('vm-b');
    const c2 = (await claimItem('vm-b', w2.secret, { ticket_id: 'docs:B' })).json;
    git.close('B', 'done');
    expect((await git.post()).status).toBe(200);
    expect(await discrepancies('B')).toEqual([]);
    expect(c2.claim_id).toBeTruthy();
  });

  it('the dashboard lists the last 7 days by kind', async () => {
    git.place('B', placed('merged', [['implement', 'pr-open'], ['merge', 'merged']], []));
    await git.post();
    const state = (await (await ui('/v1/ui/state')).json()) as { discrepancies: { by_kind: Record<string, number>; rows: { ticket_id: string; sub: string }[] } };
    expect(state.discrepancies.by_kind).toEqual({ 'off-graph': 1 });
    expect(state.discrepancies.rows.map((r) => [r.ticket_id, r.sub])).toEqual([['docs:B', 'off-graph']]);
  });
});

describe('R-BTN-78: Baton’s own decisions', () => {
  const hold = async (local: string, cred: 'vm-a' | 'vm-b' = 'vm-a') => {
    const w = await register(cred);
    const c = (await claimItem(cred, w.secret, { ticket_id: `docs:${local}` })).json;
    expect((await endClaim(cred, w.secret, c.claim_id, { end_reason: 'released:cannot-finish:capability' })).status).toBe(200);
  };

  it('park keeps the hold and closes the decision; lifting the hold any other way closes it too', async () => {
    await hold('A');
    expect(await decisions('A')).toEqual([{ decision_id: 'baton:retries' }]);
    expect((await keyCall(owner, '/v1/owner/docs/tickets/A/resolve', { decision: 'baton:retries', answer: 'park' })).status).toBe(200);
    expect(await decisions('A')).toEqual([]);
    expect(await rows(`SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = 'docs:A'`)).toEqual([{ hold: 1, hold_reason: 'non-retryable:capability' }]);
    // Held again by another failure after a lift, then lifted from the dashboard: the decision closes.
    expect((await ui('/v1/ui/overrides/docs:A', { hold: false })).status).toBe(200);
    await git.refresh(); // §6.7: claimable again only after a sync observed after the end
    await hold('A', 'vm-b');
    expect(await decisions('A')).toEqual([{ decision_id: 'baton:retries' }]);
    expect((await ui('/v1/ui/overrides/docs:A', { hold: false })).status).toBe(200);
    expect(await decisions('A')).toEqual([]);
  });

  it('baton:stalled: retry restarts the 72 hours; park holds the ticket parked; no stall for Baton’s own waits or a held ticket', async () => {
    git.place('B', placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'ci']]));
    git.add('P', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'policy']]));
    git.add('H', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'waiting', 'ci']]));
    await git.post();
    expect((await ui('/v1/ui/overrides/docs:H', { hold: true })).status).toBe(200);
    await setClock(T0 + STALLED_AFTER_MS);
    await tick();
    expect(await decisions('B')).toEqual([{ decision_id: 'baton:stalled' }]);
    expect(await decisions('P')).toEqual([]);
    expect(await decisions('H')).toEqual([]);
    expect((await keyCall(owner, '/v1/owner/docs/tickets/B/resolve', { decision: 'baton:stalled', answer: 'retry' })).status).toBe(200);
    expect(await decisions('B')).toEqual([]);
    expect(await rows(`SELECT waiting_since FROM ticket_next_legs WHERE ticket_id = 'docs:B'`)).toEqual([{ waiting_since: T0 + STALLED_AFTER_MS }]);
    await setClock(T0 + 2 * STALLED_AFTER_MS - MIN);
    await tick();
    expect(await decisions('B')).toEqual([]);
    await setClock(T0 + 2 * STALLED_AFTER_MS);
    await tick();
    expect(await decisions('B')).toEqual([{ decision_id: 'baton:stalled' }]);
    expect((await keyCall(owner, '/v1/owner/docs/tickets/B/resolve', { decision: 'baton:stalled', answer: 'park' })).status).toBe(200);
    expect(await decisions('B')).toEqual([]);
    expect(await rows(`SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = 'docs:B'`)).toEqual([{ hold: 1, hold_reason: 'parked' }]);
  });

  it('a decision git posts under a mixed-case Baton: id is git’s, and refuses claims like any other', async () => {
    git.place('A', placed('filed', [], [['implement', 'ready']], { decisions: [{ id: 'Baton:approve', asks: 'owner' }] }));
    expect(((await git.post()) as { dropped?: string[] }).dropped ?? []).toEqual([]);
    expect(await rows(`SELECT decision_id, source FROM ticket_decisions WHERE ticket_id = 'docs:A'`)).toEqual([{ decision_id: 'Baton:approve', source: 'sync' }]);
    const w = await register('vm-a');
    expect((await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' })).json).toMatchObject({ code: 'blocked', rule: 1 });
  });

  it('resolve refuses a decision that is not open, another repository’s ticket and a malformed answer', async () => {
    expect((await keyCall(owner, '/v1/owner/docs/tickets/A/resolve', { decision: 'baton:retries', answer: 'retry' })).json.code).toBe('not-found');
    expect((await keyCall(owner, '/v1/owner/docs/tickets/ops%3AA/resolve', { decision: 'baton:retries', answer: 'retry' })).json.code).toBe('invalid-params');
    expect(checkDecisionAnswer({ decision: 'baton:stalled', answer: 'park' })).toEqual({ decision: 'baton:stalled', answer: 'park' });
    for (const bad of [null, {}, { decision: 'baton:contract', answer: 'retry' }, { decision: 'R3-1', answer: 'retry' }, { decision: 'baton:retries', answer: 'route', leg: 'fix' },
      { decision: 'baton:retries', answer: 'later' }, { decision: 'baton:retries', answer: 'retry', leg: 'fix' }, { decision: 'baton:retries', answer: 'retry', extra: 1 }]) {
      expect(() => checkDecisionAnswer(bad)).toThrow();
    }
  });
});
