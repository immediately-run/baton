// S-BTN-229 several claims per runner (B-188), the server half: R-BTN-4's bound — the lower of the
// runner's declared `concurrency` and its grant's `max_claims` — the heartbeat's `claims`, its
// claim-named `session_urls`, `legs_finished` and `fenced` list, and per-claim reaps and fences.
import { describe, it, expect, inject, beforeEach } from 'vitest';
import {
  grantRunnerConcurrency, beat, claimItem, claimRow, cutover, ORIGIN, ownerCall, payload, register, rows,
  setClock, syncCall, tick, seedClaimLeg,
} from '../helpers';

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

describe('S-BTN-229: a runner holds several claims, up to R-BTN-4\'s bound', () => {
  it('the lower of concurrency and the grant\'s max_claims; the heartbeat answers every claim; raising the grant admits one more', async () => {
    const a = await register('vm-a', { concurrency: 3, capabilities: CAPS });
    expect(await rows('SELECT concurrency FROM runners WHERE id = ?', a.id)).toEqual([{ concurrency: 3 }]);
    await grantRunnerConcurrency(a.id, 2);
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

    await grantRunnerConcurrency(a.id, 3);
    expect((await claimItem('vm-a', a.secret)).status).toBe(200);
    expect(await claimItem('vm-a', a.secret)).toMatchObject({ status: 409, json: { rule: 'max-claims', held: 3 } });
  });

  it('a runner declaring 1 — the default — holds one claim as before; concurrency is clamped, never refused', async () => {
    const a = await register('vm-a', { concurrency: 99 });
    expect(await rows('SELECT concurrency FROM runners WHERE id = ?', a.id)).toEqual([{ concurrency: 32 }]);
    // An ungranted key's bound is 1 whatever it declares.
    expect((await claimItem('vm-a', a.secret)).status).toBe(200);
    expect((await claimItem('vm-a', a.secret)).json.rule).toBe('max-claims');
    const b = await register('vm-b', { concurrency: 0 });
    expect(await rows('SELECT concurrency FROM runners WHERE id = ?', b.id)).toEqual([{ concurrency: 1 }]);
  });

  it('one claim\'s force-reap fences that claim alone; the fenced list clears it; silence reaps every claim', async () => {
    const a = await register('vm-a', { concurrency: 2, capabilities: CAPS });
    await grantRunnerConcurrency(a.id, 2);
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
    await setClock(T0 + 8 * 60_000);
    await tick(); // Baton is still serving.
    await setClock(T0 + 16 * 60_000);
    await tick();
    expect(await rows(`SELECT status FROM claims WHERE id IN (?, ?) ORDER BY id`, two.claim_id, three.claim_id)).toEqual([{ status: 'reaped' }, { status: 'reaped' }]);
  });

  it('session_urls and legs_finished land on their own claims\' runs', async () => {
    const a = await register('vm-a', { concurrency: 2 });
    await grantRunnerConcurrency(a.id, 2);
    const one = (await claimItem('vm-a', a.secret)).json;
    const two = (await claimItem('vm-a', a.secret)).json;
    for (const c of [one, two]) {
      await seedClaimLeg({ claim_id: c.claim_id, seq: 1, leg: c.legs?.[0] ?? 'implement', from_station: c.station, started_at: T0, started_observation: 0 });
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
