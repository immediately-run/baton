// S-BTN-57 / G-BTN-84 / G-BTN-85: the core gives data and admits the first passing preference.
import { expect, it } from 'vitest';
import { claimItem, cutover, Git, register, runnerCall, setClock } from '../helpers';

it('serves all pages up to 500, ignores hook declarations, and accepts the runner’s order', async () => {
  await setClock(Date.parse('2026-11-21T12:00:00Z'));
  const git = new Git();
  for (let i = 1; i <= 502; i++) git.add(`T-${i}`, { rank: i, ...(i === 1 ? { course: { offered: true } } : {}) });
  expect((await git.post({ hooks: { module: 'never-loaded.js' } })).status).toBe(200);
  await cutover();
  const w = await register();
  const r = await runnerCall('/v1/runner/recommendations?all=1', { secret: w.secret });
  const body = await r.json() as { recommendations: { ticket_id: string }[]; truncated: boolean };
  expect(body.truncated).toBe(true);
  expect(body.recommendations).toHaveLength(500);
  expect(body.recommendations[0]).toMatchObject({ ticket_id: 'docs:T-1', course: { data: { offered: true } } });
  expect(body.recommendations[0]).not.toHaveProperty('score');
  expect(body.recommendations[0]).not.toHaveProperty('advice');
  expect(body.recommendations.at(-1)?.ticket_id).toBe('docs:T-500');
  const prefer = [{ ticket_id: 'docs:T-1', leg: 'review' }, { ticket_id: 'docs:T-500' }, { ticket_id: 'docs:T-2' }];
  expect(await claimItem('vm-a', w.secret, { prefer })).toMatchObject({ status: 200, json: { ticket_id: 'docs:T-500' } });
}, 60_000);
