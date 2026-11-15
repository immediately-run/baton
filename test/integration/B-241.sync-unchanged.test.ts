// B-241 — a board post whose tickets did not move reads their rows once and writes none
// (BATON_SPEC §4.3 R-BTN-11's refresh, §2e R-BTN-70's stations, R-BTN-75–78's blocks, R-BTN-63's
// bars judgement). The sync re-posts every live ticket on every push and every refresh; Baton
// read each ticket's station, next legs, bars, course, needs, decisions and answers one query
// at a time — about 14 statements per ticket even when nothing changed (2,563 statements for 4
// writes on a 180-ticket board; production passed Cloudflare's 5,000,000 rows_read/day on
// 2026-11-14). The repository's rows are now read once per post, so the statements a refresh
// runs no longer grow with its tickets, a refresh that moves nothing writes no ticket's row,
// and the leg runs it judges are read through `claim_legs_unjudged` (0055). The sync scenarios
// (S-BTN-40, -44, -45, -46, -47, -67, -188 and the rest) keep what a post does.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, HOST, cutover, placed, register, rows, setClock, withCore } from '../helpers';

const T0 = Date.parse('2026-11-15T12:00:00Z');

type Captured = { sql: string; params: unknown[]; cursor: { rowsRead?: number; rowsWritten?: number } };

/** Run `fn` and return every statement the core ran meanwhile, with its cursor. */
async function captured(fn: () => Promise<{ status: number }>): Promise<Captured[]> {
  const log: Captured[] = [];
  await withCore((c) => {
    const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __b241?: (q: string, ...p: unknown[]) => unknown };
    s.__b241 ??= s.exec;
    const orig = s.__b241;
    s.exec = (q: string, ...p: unknown[]) => {
      const cursor = orig.call(s, q, ...p) as Captured['cursor'];
      log.push({ sql: q, params: p, cursor });
      return cursor;
    };
  });
  try {
    expect((await fn()).status).toBe(200);
    return log;
  } finally {
    await withCore((c) => {
      const s = c.store as unknown as { exec: unknown; __b241?: unknown };
      if (s.__b241) s.exec = s.__b241;
    });
  }
}

/** A board of `n` tickets at stations of every shape: queued and waiting legs, bars, needs, a
 *  decision, a ticket further along its path. */
function board(n: number) {
  const git = new Git();
  for (let i = 1; i <= n; i++) {
    const id = `T-${i}`;
    if (i % 4 === 0) git.add(id, {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']], { bars: { review: ['model:a'] } }));
    else if (i % 4 === 1) git.add(id, {}, placed('filed', [], [['implement', 'waiting', 'findings']]));
    else if (i % 4 === 2) git.add(id, {}, { ...placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]), next: [{ leg: 'review', state: 'ready', needs: ['llm:any'] }] });
    else git.add(id, {}, placed('filed', [], [['implement', 'ready']], { decisions: [{ id: `D-${i}`, asks: 'owner', url: 'https://github.com/immediately-run/docs/pull/7' }] }));
  }
  return git;
}

/** The tables a post writes per ticket. */
const PER_TICKET = /\b(INSERT INTO|UPDATE|DELETE FROM) (tickets|ticket_stations|ticket_next_legs|ticket_bars|leg_needs|ticket_decisions|ticket_requires|ticket_blocks)\b/;

async function refreshOf(n: number) {
  const git = board(n);
  expect((await git.post()).status).toBe(200);
  await cutover();
  expect((await git.refresh()).status).toBe(200); // the first refresh after the head settles what the post queued
  return captured(() => git.refresh());
}

beforeEach(async () => {
  await setClock(T0);
});

describe('B-241 a board post reads its tickets once and skips the unchanged', () => {
  it("an unchanged refresh writes no ticket's rows", async () => {
    const log = await refreshOf(24);
    const writes = log.filter((l) => PER_TICKET.test(l.sql) && (l.cursor.rowsWritten ?? 1) > 0);
    expect(writes.map((w) => w.sql.replace(/\s+/g, ' ').slice(0, 120))).toEqual([]);
  });

  it('runs the same statements for 12 tickets as for 48 — none per unchanged ticket', async () => {
    const git = board(12);
    expect((await git.post()).status).toBe(200);
    await cutover();
    expect((await git.refresh()).status).toBe(200);
    const small = await captured(() => git.refresh());
    const more = board(48);
    for (const [id, t] of more.tickets) if (!git.tickets.has(id)) git.add(id, {}, more.stations[id]).tickets.set(id, t);
    expect((await git.post()).status).toBe(200);
    expect((await git.refresh()).status).toBe(200);
    const large = await captured(() => git.refresh());
    expect(large.length).toBe(small.length);
    expect(large.length).toBeLessThanOrEqual(80);
  });

  it('a placed ticket with a leg run to judge is judged as before: its bars-mismatch logged once', async () => {
    const git = board(8);
    expect((await git.post()).status).toBe(200);
    await cutover();
    // A leg run on T-4 declaring a tag the snapshot's bars for `review` lack, started before
    // the next reading: the first post after it logs one `bars-mismatch`, a later one none.
    const w = await register('vm-a');
    await rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason)
                VALUES ('docs:T-4', ?, 'b241', 'n', '', ?, 'released', ?, 'released:owner')`, w.id, T0 - 2, T0 - 1);
    const claim = (await rows<{ id: number }>('SELECT MAX(id) AS id FROM claims'))[0].id;
    await rows(`INSERT INTO claim_legs (claim_id, seq, run_id, leg, from_station, bars, started_at, started_observation)
                VALUES (?, 1, 'r-b241', 'review', 'pr-open', '["model:b"]', ?, 0)`, claim, T0 - 2);
    const log = await captured(() => git.refresh());
    const judged = log.filter((l) => /FROM claim_legs l CROSS JOIN claims c/.test(l.sql));
    expect(judged).toHaveLength(1);
    const plan = (await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${judged[0].sql}`, ...judged[0].params)).map((r) => r.detail);
    expect(plan.some((d) => /USING INDEX claim_legs_unjudged/.test(d)), plan.join('\n')).toBe(true);
    const mismatches = () => rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'bars-mismatch' AND ticket_id = 'docs:T-4'`);
    expect((await mismatches()).map((e) => JSON.parse(e.detail_json).declared_only)).toEqual([['model:b']]);
    expect((await git.refresh()).status).toBe(200);
    expect(await mismatches()).toHaveLength(1);
  });

  it.runIf(HOST === 'cloudflare')("an unchanged refresh's rows_read is a few rows per ticket", async () => {
    const log = await refreshOf(48);
    const read = log.reduce((s, l) => s + (l.cursor.rowsRead ?? 0), 0);
    // Measured: about 17 rows a ticket, under 1,000 for these 48 — each repository-wide read
    // costs one or two rows a ticket; before B-241 a refresh also ran some fourteen statements a
    // ticket (on the 180-ticket board of the measurement, 4,293 rows over 3,165 statements).
    expect(read).toBeLessThanOrEqual(1000);
  });
});
