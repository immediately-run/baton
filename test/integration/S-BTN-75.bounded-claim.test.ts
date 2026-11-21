// S-BTN-75 / G-BTN-99: Baton narrows the ordinary claim selection atomically on both hosts.
import { expect, it } from 'vitest';
import { claimItem, cutover, Git, placed, register } from '../helpers';

it('S-BTN-75 filters by queued leg without poisoning the ordinary claim memo', async () => {
  const git = new Git();
  git.add('A', {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
  git.add('B', {}, placed('filed', [], [['implement', 'ready']]));
  expect((await git.post()).status).toBe(200);
  await cutover();
  const worker = await register('vm-a');
  const claim = (legs?: string[]) => claimItem('vm-a', worker.secret, legs ? { legs } : {});
  expect((await claim(['merge'])).json).toMatchObject({ code: 'no-eligible-ticket' });
  expect((await claim(['implement'])).json).toMatchObject({ ticket_id: 'docs:B' });
  const other = await register('vm-b');
  expect((await claimItem('vm-b', other.secret)).json).toMatchObject({ ticket_id: 'docs:A' });
});
