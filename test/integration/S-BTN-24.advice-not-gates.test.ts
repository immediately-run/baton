// S-BTN-24 advice, not gates (BATON_SPEC §15, R-BTN-45, §6.6's gate table; R3-1232): a runner claims
// A ticket ranked fifth can be claimed without an override; a barred runner is refused.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { claimItem, cutover, Git, placed, register, rows, setClock } from '../helpers';

const T0 = Date.parse('2026-10-16T12:00:00Z');
let git: Git;

beforeEach(async () => {
  await setClock(T0);
  git = new Git();
  for (let i = 1; i <= 5; i++) git.add(`T-${i}`, { rank: i });
  git.add('LINE', { rank: 7 }, placed('filed', [], [['implement', 'ready']], { bars: { implement: ['account:go_plus'] } }));
  await git.post();
  await cutover();
});

describe('S-BTN-24 advice, not gates', () => {
  it('the order is advice; a barred tag is a gate', async () => {
    const first = await register('vm-a');
    const c = await claimItem('vm-a', first.secret, { ticket_id: 'docs:T-5' });
    expect(c.status).toBe(200);
    expect(await rows(`SELECT 1 FROM events WHERE kind = 'advice-overridden' AND claim_id = ?`, c.json.claim_id)).toEqual([]);


    const fourth = await register('test', { tags: ['account:go_plus', 'family:qwen'] });
    expect(await claimItem('test', fourth.secret, { ticket_id: 'docs:LINE' })).toMatchObject({ status: 409, json: { code: 'barred-tag', rule: 8 } });
    const offered = await claimItem('test', fourth.secret);
    expect(offered.json.ticket_id).toBe('docs:T-1');
  });
});
