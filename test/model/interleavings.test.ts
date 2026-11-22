// B-271: S-BTN-4, S-BTN-17, S-BTN-34, S-BTN-36 and S-BTN-39, interleaved on the real local host.
import { expect, it } from 'vitest';
import { adminSession, advance, claimItem, claimRow, cutover, endClaim, Git, keyCall, observe, placed,
  register, rows, sessionCall, setAdminKeys, setClock } from '../helpers';
import { makeKey } from '../lib/sshKeys';

type Step = readonly [label: string, run: () => Promise<void>];
const FILED = placed('filed', [], [['implement', 'ready']]);
const OPEN: [string, string][] = [['implement', 'pr-open']];
const FIXED: [string, string][] = [...OPEN, ['review', 'reviewed'], ['fix', 'fixed'], ['review', 'reviewed'], ['fix', 'fixed']];

// Pick a stream at each step, preserving each stream's causal order. All streams must finish,
// so every seed exercises each negative probe as well as the corresponding successful path.
async function interleave(seed: number, streams: Step[][], invariant: () => Promise<void>) {
  let state = seed;
  const history: string[] = [];
  while (streams.length) {
    // xorshift32; independent of the random request IDs used by the harness.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const index = (state >>> 0) % streams.length;
    const [label, run] = streams[index].shift()!;
    if (!streams[index].length) streams.splice(index, 1);
    history.push(label);
    try {
      await run();
      await invariant();
    } catch (cause) {
      throw new Error(`seed ${seed}: ${history.join(' -> ')}`, { cause });
    }
  }
}

it.each([0x12345678, 0x698feb34, 0x253d34aa, 0x71278abb, 0x3afddf82, 0x68377b7f, 0x2ad7ac76, 0x4502013d])(
  'holds the nine interleaving invariants (seed %i)', async (seed) => {
    await setClock(Date.parse('2026-11-19T12:00:00Z'));
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'owner');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    const git = new Git().add('T-1').add('T-2', {}, placed('pr-open', OPEN, [['review', 'ready']])).add('T-3');
    expect(await git.post()).toMatchObject({ status: 200 });
    expect((await keyCall(owner, '/v1/owner/docs/settings', {
      required_bars: [{ course: 'roadmap-pr', leg: 'fix', tag_prefix: 'family:' }],
    }, 'PUT')).status).toBe(200);

    await cutover();
    const a = await register('vm-a', { tags: ['family:a'] });
    const b = await register('vm-b');
    const c = await register('mac');
    const d = await register('test');
    const claim = async (cred: Parameters<typeof claimItem>[0], secret: string, ticket: string) => {
      const result = await claimItem(cred, secret, { ticket_id: ticket });
      expect(result).toMatchObject({ status: 200, json: { claim_id: expect.any(Number) } });
      return result.json.claim_id as number;
    };
    let work = 0, regress = 0, fenced = 0;
    const start = (leg: string, reached?: string, bars?: string[]) => advance('vm-a', a.secret, work, { leg, reached, bars });
    const session = await adminSession(admin);
    const adminClaim = async (action: string) => {
      const res = await sessionCall(session, `/v1/ui/claims/${fenced}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
      });
      expect(res.status).toBe(200);
      return res.json();
    };

    let lastAccepted = 0;
    await interleave(seed, [
      [
        ['claim work', async () => { work = await claim('vm-a', a.secret, 'docs:T-1'); }],
        ['check offered leg gate', async () => {
          expect(await start('review')).toMatchObject({ json: { code: 'not-eligible', rule_code: 'not-queued' } });
          expect((await start('implement')).status).toBe(200);
        }],
        ['start review', async () => { expect((await start('review', 'pr-open')).status).toBe(200); }],
        ...[1, 2].flatMap((i): Step[] => [
          [`start fix ${i}`, async () => {
            // writingLegsBarred and gatesHeld: neither missing nor self-excluding bars can pass.
            expect(await start('fix', 'reviewed')).toMatchObject({ json: { code: 'not-eligible', rule_code: 'policy' } });
            expect(await start('fix', 'reviewed', ['family:a'])).toMatchObject({ json: { code: 'barred-tag' } });
            expect((await start('fix', 'reviewed', ['family:b'])).status).toBe(200);
          }],
          ...(i === 1 ? [['review the fix', async () => { expect((await start('review', 'fixed')).status).toBe(200); }] as const] : []),
        ]),
        ['suspend at fixed', async () => {
          const early = seed % 2 ? await observe() : null;
          if (early) expect(early.status).toBe(200);
          expect((await endClaim('vm-a', a.secret, work, { end_reason: 'suspended:fixed', reached: 'fixed' })).status).toBe(200);
          if (early) git.place('T-1', placed('fixed', FIXED, [['review', 'ready']], { bars: { fix: ['family:b'] } }));
          expect(await git.post(early ? { observation: early.json.observation } : {})).toMatchObject({ status: 200, confirmed: 0 });
          expect((await claimRow(work)).confirmed_at).toBeNull();
        }],
        ['later observation with evidence', async () => {
          git.place('T-1', placed('fixed', FIXED, [['review', 'ready']], { bars: { fix: ['family:b'] } }));
          expect(await git.post()).toMatchObject({ status: 200, confirmed: 1 });
          expect((await claimRow(work)).confirmed_at).not.toBeNull();
        }],
        ['resume at run limit', async () => {
          const resumed = await claim('vm-a', a.secret, 'docs:T-1');
          expect((await advance('vm-a', a.secret, resumed, { leg: 'review' })).status).toBe(200);
          expect(await advance('vm-a', a.secret, resumed, { leg: 'fix', reached: 'reviewed', bars: ['family:b'] }))
            .toMatchObject({ json: { code: 'not-eligible', rule_code: 'max-runs' } });
        }],
      ],
      [
        ['claim review', async () => { regress = await claim('vm-b', b.secret, 'docs:T-2'); }],
        ['start review with an earlier reading outstanding', async () => {
          const early = await observe();
          expect(early.status).toBe(200);
          expect((await observe()).json.code).toBe('sync-busy');
          expect((await advance('vm-b', b.secret, regress, { leg: 'review' })).status).toBe(200);
          git.place('T-2', FILED);
          expect(await git.post({ observation: early.json.observation })).toMatchObject({ status: 200 });
          expect(await rows('SELECT regressed_since FROM claims WHERE id = ?', regress)).toEqual([{ regressed_since: null }]);
          expect(await git.post({ observation: early.json.observation })).toMatchObject({ status: 409, code: 'stale-observation' });
        }],
        ['newer reading sees regression, not withdrawal', async () => {
          expect(await git.post()).toMatchObject({ status: 200, stale_released: 0 });
          expect(await rows('SELECT status, regressed_since FROM claims WHERE id = ?', regress))
            .toEqual([{ status: 'active', regressed_since: expect.any(Number) }]);
        }],
        ['newer reading sees withdrawal', async () => {
          git.close('T-2', 'withdrawn');
          expect(await git.post()).toMatchObject({ status: 200, stale_released: 1 });
          expect(await claimRow(regress)).toMatchObject({ status: 'released', end_reason: 'released:stale-board' });
        }],
      ],
      [
        ['claim fence ticket', async () => { fenced = await claim('mac', c.secret, 'docs:T-3'); }],
        ['refuse a second holder', async () => { expect((await claimItem('test', d.secret, { ticket_id: 'docs:T-3' })).status).toBe(409); }],
        ['force-reap live holder', async () => { expect(await adminClaim('reap')).toMatchObject({ fence_pending: true }); }],
        ['refuse while fenced even after sync', async () => {
          expect(await git.post()).toMatchObject({ status: 200 });
          expect((await claimItem('test', d.secret, { ticket_id: 'docs:T-3' })).status).toBe(409);
        }],
        ['clear fence', async () => { expect(await adminClaim('fence-clear')).toEqual({ ok: true }); }],
        ['claim after fence clear', async () => { await claim('test', d.secret, 'docs:T-3'); }],
      ],
    ], async () => {
      // oneLiveHolderPerTicket includes fences, not just the partial unique index on active claims.
      expect(await rows(`SELECT ticket_id FROM claims WHERE status = 'active' OR fence_pending = 1
                         GROUP BY ticket_id HAVING count(*) > 1`)).toEqual([]);
      // observationsIncrease: accepted numbers never go backwards or exceed those issued.
      const [head] = await rows<{ observation: number; last_handed_out: number }>(
        `SELECT observation, last_handed_out FROM board_head WHERE repository_id = 'docs'`);
      expect(head.observation).toBeGreaterThanOrEqual(lastAccepted);
      expect(head.observation).toBeLessThanOrEqual(head.last_handed_out);
      lastAccepted = head.observation;
      // confirmationAfterEnd and confirmedIsInGit. The generated suspension never regresses once confirmed.
      const confirmations = await rows<{ observation: number; claim_observation: number; end_observation: number; path: string }>(
        `SELECT json_extract(e.detail_json, '$.observation') AS observation, c.claim_observation, c.end_observation, s.path
         FROM events e JOIN claims c ON c.id = e.claim_id JOIN ticket_stations s ON s.ticket_id = c.ticket_id
         WHERE e.kind = 'confirmed'`);
      for (const row of confirmations) {
        expect(row.observation).toBeGreaterThan(Math.max(row.claim_observation, row.end_observation));
        expect(JSON.parse(row.path).slice(0, FIXED.length)).toEqual(FIXED.map(([leg, reached]) => ({ leg, reached })));
      }
      // boundedLoops spans claim resumption; writingLegsBarred checks the bars persisted at start.
      expect(await rows(`SELECT COUNT(*) AS n FROM claim_legs l JOIN claims c ON c.id = l.claim_id
                         WHERE c.ticket_id = 'docs:T-1' AND l.leg = 'fix' HAVING COUNT(*) > 2`)).toEqual([]);
      for (const { bars } of await rows<{ bars: string }>(`SELECT bars FROM claim_legs WHERE leg = 'fix'`)) {
        expect(JSON.parse(bars)).toEqual(['family:b']);
      }
      // Lag on T-1 and activity on T-3 must never be classified as regression or a stale end.
      expect(await rows(`SELECT id FROM claims WHERE ticket_id != 'docs:T-2'
                         AND (regressed_since IS NOT NULL OR end_reason = 'released:stale-board')`)).toEqual([]);
    });
  });
