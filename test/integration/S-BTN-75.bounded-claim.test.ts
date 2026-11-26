// S-BTN-75 / G-BTN-99: Baton narrows the ordinary claim selection atomically on both hosts.
import { expect, it } from 'vitest';
import { advance, claimItem, cutover, endClaim, Git, placed, register, rows, setClock } from '../helpers';

it('S-BTN-75 filters by queued leg without poisoning the ordinary claim memo', async () => {
  const git = new Git();
  git.add('A', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
  git.add('B', {}, placed('filed', [], [['implement', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
  const worker = await register('vm-a');
  const claim = (legs?: string[]) => claimItem('vm-a', worker.secret, legs ? { legs } : {});
  expect((await claim(['merge'])).json).toMatchObject({ code: 'no-eligible-ticket' });
  const selected = await claim(['implement']);
  expect(selected.json).toMatchObject({ ticket_id: 'docs:B', legs: ['implement'] });
  expect((await advance('vm-a', worker.secret, selected.json.claim_id, { leg: 'implement' })).status).toBe(200);
  expect((await endClaim('vm-a', worker.secret, selected.json.claim_id, {
    end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'review', ended_at_sha: 'https://example.test/evidence',
  })).status).toBe(200);
  expect((await claim(['implement'])).json).toMatchObject({ code: 'no-eligible-ticket' });
  const other = await register('vm-b');
  expect((await claimItem('vm-b', other.secret)).json).toMatchObject({ ticket_id: 'docs:A' });
  git.place('B', placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
  expect((await git.post({ attestations: [{ type: 'std:git.evidence@1', ticket: 'B', ref: String(selected.json.claim_id),
    value: { claim: selected.json.claim_id, evidence: 'https://example.test/evidence', found: true } }] })).status).toBe(200);
  const successor = await register('mac');
  expect((await claimItem('mac', successor.secret, { legs: ['review'] })).json)
    .toMatchObject({ ticket_id: 'docs:B', station: 'pr-open', legs: ['review'] });
});

it.each(['first', 'successor'])('S-BTN-75 refuses an expired %s advance without recording a start', async (boundary) => {
  const now = 1_800_000_000_000;
  await setClock(now);
  const git = new Git();
  git.add('A', {}, placed('filed', [], [['implement', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
  const worker = await register('vm-a');
  const { json: { claim_id: claim } } = await claimItem('vm-a', worker.secret);
  if (boundary === 'successor') {
    expect((await advance('vm-a', worker.secret, claim, { leg: 'implement', start_before: now + 1000 })).status).toBe(200);
  }
  await setClock(now + 1000);
  const body = boundary === 'first' ? { leg: 'implement' } : { reached: 'pr-open', leg: 'review' };
  const refused = await advance('vm-a', worker.secret, claim, { ...body, start_before: now + 1000 });
  expect(refused.json).toMatchObject({ code: 'not-eligible', rule_code: 'run-deadline' });
  expect(await rows('SELECT leg, finished_at FROM claim_legs WHERE claim_id = ?', claim))
    .toEqual(boundary === 'first' ? [] : [{ leg: 'implement', finished_at: null }]);
});
