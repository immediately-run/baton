// S-BTN-171 a dependency cycle is refused (B-111, BATON_SPEC §4.4): a repository's sync posts a
// board whose live tickets depend on each other in a loop; the post is refused `invalid-params`,
// naming the cycle `B-1 → B-2 → B-1`, and nothing of it is stored — the head does not move and no
// ticket is created. A diamond and an edge to a ticket the post itself closes are accepted, so the
// refusal is the loop's and not any dependency's. Then `baton tickets check` on the same
// repository finds the same loop before any post, at the first ticket's file. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, rows, setClock } from '../helpers';

const T0 = Date.parse('2026-10-27T09:00:00Z');
const REFUSAL = 'tickets.depends_on: a dependency cycle: B-1 → B-2 → B-1';

beforeEach(async () => {
  await setClock(T0);
});

const head = () => rows<{ sha: string | null }>(`SELECT sha FROM board_head WHERE repository_id = 'docs'`);
const tickets = () => rows<{ local_id: string }>(`SELECT local_id FROM tickets WHERE repository_id = 'docs' ORDER BY local_id`);

describe('S-BTN-171 a dependency cycle is refused', () => {
  it('refuses a post whose live tickets loop, naming the cycle, and stores nothing of it', async () => {
    const git = new Git();
    git.add('B-1', { depends_on: ['B-2'] }).add('B-2', { depends_on: ['B-1'] });
    const res = await git.post();
    expect(res).toMatchObject({ status: 400, code: 'invalid-params', message: REFUSAL });
    // Nothing of the refused post: no head, no ticket.
    expect(await head()).toEqual([{ sha: null }]);
    expect(await tickets()).toEqual([]);
  });

  it('accepts a diamond, and a ticket the same post closes', async () => {
    const git = new Git();
    git.add('B-1').add('B-2', { depends_on: ['B-1'] }).add('B-3', { depends_on: ['B-1'] }).add('B-4', { depends_on: ['B-2', 'B-3'] }).add('B-5', { depends_on: ['B-6'] }).close('B-6', 'done');
    expect((await git.post()).status).toBe(200);
    expect((await tickets()).map((t) => t.local_id)).toEqual(['B-1', 'B-2', 'B-3', 'B-4', 'B-5']);
  });

  it('refuses a self-dependency too, as a cycle of one', async () => {
    const git = new Git();
    git.add('B-1', { depends_on: ['B-1'] });
    expect(await git.post()).toMatchObject({ status: 400, code: 'invalid-params', message: 'tickets.depends_on: a dependency cycle: B-1 → B-1' });
  });
});
