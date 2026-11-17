// S-BTN-229 several claims per runner (B-188), the server half: R-BTN-4's bound — the lower of the
// runner's declared `concurrency` and its grant's `max_claims` — the heartbeat's `claims`, its
// claim-named `session_urls`, `legs_finished` and `fenced` list, and per-claim reaps and fences.
import { describe, it, expect, inject, beforeEach } from 'vitest';
import { beat, claimItem, claimRow, cutover, ORIGIN, ownerCall, payload, register, rows, setClock, syncCall, tick } from '../helpers';

const board = inject('board');
const T0 = Date.parse('2026-10-13T12:00:00Z');
// R3-9003 needs these; with them board A holds three tickets one runner can claim.
const CAPS = ['agent-venue', 'human-operator', 'github-admin'];
const owner = (path: string, body: unknown) =>
  ownerCall(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });

beforeEach(async () => {
  await setClock(T0);
  await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A));
  await cutover();
});

/** Bind the worker's credential by an owner's grant on docs with `max_claims` (as `owner grant
 *  add --max-claims` stores it), the grant covering what it declares. */
async function grant(workerId: number, maxClaims: number) {
  const [{ credential_id }] = await rows<{ credential_id: string }>('SELECT credential_id FROM workers WHERE id = ?', workerId);
  const caps = (await rows<{ capability: string }>('SELECT capability FROM worker_capabilities WHERE worker_id = ?', workerId)).map((r) => r.capability);
  await rows(`UPDATE credentials SET created_by = 'owner:owner@example.com' WHERE id = ?`, credential_id);
  await rows(`INSERT INTO worker_grants (credential_id, repository_id, capabilities, max_tier, max_claims, granted_by, granted_at)
              VALUES (?, 'docs', ?, NULL, ?, 'owner:owner@example.com', 0)
              ON CONFLICT (credential_id, repository_id) DO UPDATE SET max_claims = excluded.max_claims`, credential_id, JSON.stringify(caps), maxClaims);
}

describe('S-BTN-229: a runner holds several claims, up to R-BTN-4\'s bound', () => {
  it('the lower of concurrency and the grant\'s max_claims; the heartbeat answers every claim; raising the grant admits one more', async () => {
    const a = await register('vm-a', { concurrency: 3, capabilities: CAPS });
    expect(await rows('SELECT concurrency FROM workers WHERE id = ?', a.id)).toEqual([{ concurrency: 3 }]);
    await grant(a.id, 2);
    const first = await claimItem('vm-a', a.secret);
    const second = await claimItem('vm-a', a.secret);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.json.ticket_id).not.toBe(second.json.ticket_id);
    // The third is past the grant's 2, below the declared 3.
    expect(await claimItem('vm-a', a.secret)).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'max-claims', held: 2, concurrency: 3, max_claims: 2 } });

    // Every active claim, oldest first; `claim` stays the oldest for runners before B-188.
    const told = await beat('vm-a', a.secret, { concurrency: 3, capabilities: CAPS });
    expect(told.json.claims.map((c: { id: number }) => c.id)).toEqual([first.json.claim_id, second.json.claim_id]);
    expect(told.json.claim).toMatchObject({ id: first.json.claim_id });
    // A bare session_url names no claim among several: dropped, never a refused beat.
    expect((await beat('vm-a', a.secret, { concurrency: 3, capabilities: CAPS, session_url: 'https://claude.ai/code/x' })).json.session_url_dropped).toMatch(/several/);

    await grant(a.id, 3);
    expect((await claimItem('vm-a', a.secret)).status).toBe(200);
    expect(await claimItem('vm-a', a.secret)).toMatchObject({ status: 409, json: { rule: 'max-claims', held: 3 } });
  });

  it('a runner declaring 1 — the default — holds one claim as before; concurrency is clamped, never refused', async () => {
    const a = await register('vm-a', { concurrency: 99 });
    expect(await rows('SELECT concurrency FROM workers WHERE id = ?', a.id)).toEqual([{ concurrency: 32 }]);
    // An ungranted key's bound is 1 whatever it declares.
    expect((await claimItem('vm-a', a.secret)).status).toBe(200);
    expect((await claimItem('vm-a', a.secret)).json.rule).toBe('max-claims');
    const b = await register('vm-b', { concurrency: 0 });
    expect(await rows('SELECT concurrency FROM workers WHERE id = ?', b.id)).toEqual([{ concurrency: 1 }]);
  });

  it('one claim\'s force-reap fences that claim alone; the fenced list clears it; silence reaps every claim', async () => {
    const a = await register('vm-a', { concurrency: 2, capabilities: CAPS });
    await grant(a.id, 2);
    const one = (await claimItem('vm-a', a.secret)).json;
    const two = (await claimItem('vm-a', a.secret)).json;
    expect(await (await owner(`/v1/ui/claims/${one.claim_id}/reap`, { confirm: true })).json()).toEqual({ ok: true, fence_pending: true });
    expect(await claimRow(one.claim_id)).toMatchObject({ status: 'reaped', fence_pending: 1 });
    expect(await claimRow(two.claim_id)).toMatchObject({ status: 'active' });
    const told = await beat('vm-a', a.secret, { concurrency: 2, capabilities: CAPS, fenced: [{ claim_id: one.claim_id, terminated: true }] });
    expect(told.json.claims.map((c: { id: number }) => c.id)).toEqual([two.claim_id]);
    expect((await claimRow(one.claim_id)).fence_pending).toBe(0);

    // Silent past its lease: every claim it still holds is reaped (one lease, the runner's).
    const three = (await claimItem('vm-a', a.secret)).json;
    expect(three.claim_id).toBeTruthy();
    await setClock(T0 + 16 * 60_000);
    await tick();
    expect(await rows(`SELECT status FROM claims WHERE id IN (?, ?) ORDER BY id`, two.claim_id, three.claim_id)).toEqual([{ status: 'reaped' }, { status: 'reaped' }]);
  });

  it('session_urls and legs_finished land on their own claims\' runs', async () => {
    const a = await register('vm-a', { concurrency: 2 });
    await grant(a.id, 2);
    const one = (await claimItem('vm-a', a.secret)).json;
    const two = (await claimItem('vm-a', a.secret)).json;
    for (const c of [one, two]) {
      await rows(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, started_at, started_observation) VALUES (?, 1, ?, ?, ?, 0)`, c.claim_id, c.legs?.[0] ?? 'implement', c.station, T0);
    }
    await beat('vm-a', a.secret, { concurrency: 2, session_urls: [
      { claim_id: one.claim_id, url: 'https://claude.ai/code/one' },
      { claim_id: two.claim_id, url: 'https://claude.ai/code/two' },
      { claim_id: 999_999, url: 'https://claude.ai/code/none' },
    ] });
    expect(await rows('SELECT claim_id, session_url FROM claim_legs WHERE claim_id IN (?, ?) ORDER BY claim_id', one.claim_id, two.claim_id)).toEqual([
      { claim_id: one.claim_id, session_url: 'https://claude.ai/code/one' },
      { claim_id: two.claim_id, session_url: 'https://claude.ai/code/two' },
    ]);
  });
});
