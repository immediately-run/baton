// S-BTN-286 what a poll of the runners costs (B-196 item 3; the `rows_read` outages of
// 2026-11-14 and -15, B-250's finding): `repo.runners` runs the same number of statements with
// 10 runner rows as with 300 — one read of the rows and one per kind of detail, never a query
// per runner — and lists a reaped runner and one unseen past the longest window from its own
// columns. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { rows, sessionCall, withCore } from '../helpers';
import { claimAndStart, fleet, grantedRunner, type Fleet, type Granted, type Json } from '../lib/runnerFleet';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86_400_000;

let f: Fleet;
let a: Granted;

/** One read, with the number of statements it ran: the fewest of three (an alarm a host runs
 *  meanwhile adds statements to a capture, never takes any away). */
async function counted(path: string): Promise<{ json: Json; statements: number }> {
  let best: { json: Json; statements: number } | null = null;
  for (let i = 0; i < 3; i++) {
    let n = 0;
    await withCore((c) => {
      const s = c.store as unknown as { exec: (q: string, ...p: unknown[]) => unknown; __s286?: (q: string, ...p: unknown[]) => unknown };
      s.__s286 ??= s.exec;
      const orig = s.__s286;
      s.exec = (q: string, ...p: unknown[]) => {
        n++;
        return orig.call(s, q, ...p);
      };
    });
    try {
      const res = await sessionCall(f.cookie, path);
      expect(res.status).toBe(200);
      const json = (await res.json()) as Json;
      if (!best || n < best.statements) best = { json, statements: n };
    } finally {
      await withCore((c) => {
        const s = c.store as unknown as { exec: unknown; __s286?: unknown };
        if (s.__s286) s.exec = s.__s286;
      });
    }
  }
  return best!;
}

/** `count` more runner rows under `a`'s granted key: a third live, a third reaped, a third
 *  unseen for 40 days. */
async function more(count: number, tag: string) {
  const cred = (await rows<{ credential_id: string }>('SELECT credential_id FROM runners WHERE id = ?', a.id))[0].credential_id;
  await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
              INSERT INTO runners (hostname, session_name, secret_hash, credential_id, harness, kind, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at, reaped_at)
              SELECT 'host-a', '${tag}-' || k.i, '${tag}-' || k.i, ?, 'opencode', 'vm', 900000, '',
                     CASE WHEN k.i % 3 = 2 THEN ${T0 - 40 * DAY} ELSE ${T0} END, CASE WHEN k.i % 3 = 2 THEN ${T0 - 40 * DAY} ELSE ${T0} END,
                     CASE WHEN k.i % 3 = 1 THEN ${T0} ELSE NULL END
              FROM k`, count, cred);
}

beforeEach(async () => {
  f = await fleet(T0);
  a = await grantedRunner('runner-a', 'host-a', [{ repository: 'docs', owner: f.docsOwner }]);
  await claimAndStart(a, 'docs:T-1', 'implement');
});

describe('S-BTN-286 a poll of the runners costs the same at 10 rows and at 300 (B-196)', () => {
  it('the statement count does not grow with the runner rows', async () => {
    await more(9, 'few');
    const ten = await counted('/v1/repositories/docs/runners');
    expect((ten.json.runners as Json[]).length).toBe(10);
    await more(290, 'many');
    const many = await counted('/v1/repositories/docs/runners');
    expect((many.json.runners as Json[]).length).toBe(300);
    expect(many.statements).toBe(ten.statements);
    // Reaped and long-unseen rows are told from their own columns.
    const reaped = (many.json.runners as Json[]).find((r) => r.session_name === 'many-1')!;
    expect(reaped).toMatchObject({ alive: false, reaped_at: T0, capabilities: [], courses: [], claim: null });
    const unseen = (many.json.runners as Json[]).find((r) => r.session_name === 'many-2')!;
    expect(unseen).toMatchObject({ alive: false, reaped_at: null, last_seen_at: T0 - 40 * DAY, capabilities: [], claim: null });
    // The one with a claim still carries it.
    expect((many.json.runners as Json[]).find((r) => r.runner_id === a.id)!.claim).toMatchObject({ ticket_id: 'docs:T-1', leg: 'implement' });
  });
});
