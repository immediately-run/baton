// S-BTN-75 / G-BTN-99: Baton narrows the ordinary claim selection atomically on both hosts.
import { expect, it } from 'vitest';
import { advance, claimItem, cutover, endClaim, Git, placed, register } from '../helpers';

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
  expect((await git.post()).status).toBe(200);
  const successor = await register('mac');
  expect((await claimItem('mac', successor.secret, { legs: ['review'] })).json)
    .toMatchObject({ ticket_id: 'docs:B', station: 'pr-open', legs: ['review'] });
});
