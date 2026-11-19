// B-287: mixed busy/idle polling, a cold indexed decision, unchanged snapshots and paged UI.
import { beforeEach, describe, expect, it } from 'vitest';
import { schedulingVersion } from '../../src/core/stateVersion';
import { Git, HOST, adminSession, beat, call, claimItem, cutover, register, rows, runnerCall, sessionCall, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-19T12:00:00Z');
beforeEach(() => setClock(T0));
type Entry = { sql: string; params: unknown[]; cursor: { rowsRead?: number; rowsWritten?: number } };
async function measure<T>(fn: () => Promise<T>) {
  const log: Entry[] = [];
  let restore: () => void = () => {};
  await withCore((c) => {
    const original = c.store.exec;
    c.store.exec = ((sql: string, ...params: unknown[]) => {
      const cursor = original.call(c.store, sql, ...params);
      log.push({ sql, params, cursor });
      return cursor;
    }) as typeof original;
    restore = () => { c.store.exec = original; };
  });
  try {
    const value = await fn();
    return { value, log, read: log.reduce((n, e) => n + (e.cursor.rowsRead ?? 0), 0), written: log.reduce((n, e) => n + (e.cursor.rowsWritten ?? 0), 0) };
  } finally { restore(); }
}
const version = () => withCore((c) => schedulingVersion(c.store));
const sameProjection = async () => {
  expect(await rows('SELECT * FROM ready_ticket_source EXCEPT SELECT * FROM ready_tickets')).toEqual([]);
  expect(await rows('SELECT * FROM ready_tickets EXCEPT SELECT * FROM ready_ticket_source')).toEqual([]);
};

async function busyBoard() {
  const git = new Git();
  for (let i = 1; i <= 180; i++) git.add(`T-${i}`, { rank: i, requires: ['human-operator'] });
  git.add('WORK', { rank: 0 });
  expect((await git.post()).status).toBe(200);
  await cutover();
  const idle = await register('vm-a');
  const busy = await register('vm-b');
  const held = (await claimItem('vm-b', busy.secret, { ticket_id: 'docs:WORK' })).json;
  expect(held.claim_id).toBeTypeOf('number');
  await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM k WHERE i<600)
    INSERT INTO claims(ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, end_reason, ended_at, confirmed_at, ended_at_sha, end_observation)
    SELECT 'docs:T-' || (1+i%180), ?, 'old-' || i, 'n', '', ?, 'completed', 'suspended:reviewed', ?, ?, 'abc', 0 FROM k`, busy.id, T0-1000, T0-1000, T0-1000);
  await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM k WHERE i<3000)
    INSERT INTO events(at, kind, actor, repository_id) SELECT ?, 'claimed', 'test', 'docs' FROM k`, T0-1000);
  // Prime the runner credential's first-use/client-version metadata, not its idle memo.
  await runnerCall('/v1/runner/state', { cred: 'vm-a', secret: idle.secret });
  // Settle source versions and the fingerprint after the seed's server-side changes.
  await git.refresh();
  await git.refresh();
  return { git, idle, busy, held };
}

describe('S-BTN-243 bounded reads without changing matching', { timeout: 120_000 }, () => {
  it('keeps an idle answer across busy activities and identical snapshots, and measures cold and warm reads', async () => {
    const { git, idle, busy, held } = await busyBoard();
    const cold = await measure(() => claimItem('vm-a', idle.secret));
    expect(cold.value.json.code).toBe('no-eligible-ticket');
    const v = await version();
    await setClock(T0 + 120_000);
    expect((await runnerCall('/v1/runner/activities', { cred: 'vm-b', secret: busy.secret, body: { activities: [
      { id: 'working', claim_id: held.claim_id, kind: 'push', source: 'skill', started_at: T0, ended_at: T0 + 1000, outcome: 'succeeded', detail: { branch: 'work' } },
    ] } })).status).toBe(200);
    expect(await version()).toBe(v);
    const sync = await measure(() => git.refresh());
    expect(sync.value.status).toBe(200);
    expect(await version()).toBe(v);
    const warm = await measure(() => claimItem('vm-a', idle.secret));
    expect(warm.value.json.code).toBe('no-eligible-ticket');
    expect(warm.log.some((e) => e.sql.includes('FROM ready_tickets'))).toBe(false);
    const indexed = cold.log.find((e) => e.sql.includes('FROM ready_tickets q'))!;
    expect(indexed).toBeDefined();
    const plan = await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${indexed.sql}`, ...indexed.params);
    expect(plan.some((p) => p.detail.includes('ready_tickets_order'))).toBe(true);
    expect(plan.some((p) => p.detail.includes('TEMP B-TREE'))).toBe(false);
    if (HOST === 'cloudflare') {
      // Includes the observation response's mandatory 181 ticket versions, not just board POST.
      expect(cold.read).toBeLessThan(750);
      expect(warm.read).toBeLessThan(60);
      expect(sync.read).toBeLessThan(350);
      expect(sync.written).toBeLessThan(20);
      expect(sync.log.some((e) => e.sql.includes('FROM tickets t LEFT JOIN ticket_stations'))).toBe(false);
    }
    // A declaration change is relevant even when the board has not moved.
    expect((await beat('vm-a', idle.secret, { tags: ['new-tag'] })).status).toBe(200);
    expect(await version()).toBeGreaterThan(v);
    await sameProjection();
    await rows("DELETE FROM ticket_requires WHERE ticket_id = 'docs:T-1'");
    const accepted = await measure(() => claimItem('vm-a', idle.secret));
    expect(accepted.value.json.ticket_id).toBe('docs:T-1');
    if (HOST === 'cloudflare') {
      expect(accepted.read).toBeLessThan(800);
      expect(accepted.written).toBeLessThan(150);
    }
    await sameProjection();
  });

  it('invalidates idle answers when an identical observation crosses the last end', async () => {
    const git = new Git().add('A');
    await git.post(); await cutover();
    const w = await register('vm-a');
    await runnerCall('/v1/runner/state', { cred: 'vm-a', secret: w.secret });
    const h = (await rows<{ n: number }>("SELECT last_handed_out + 1 AS n FROM board_head WHERE repository_id='docs'"))[0];
    await rows(`INSERT INTO claims(ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, end_reason, ended_at, confirmed_at, ended_at_sha, end_observation)
      VALUES ('docs:A', ?, 'previous', 'n', ?, ?, 'completed', 'suspended:reviewed', ?, ?, ?, ?)`, w.id, git.head, T0, T0, T0, git.head, h.n);
    await git.refresh(); // observation equals the end: not fresh enough yet
    expect((await claimItem('vm-a', w.secret)).json.code).toBe('no-eligible-ticket');
    const v = await version();
    const fresh = await measure(() => git.refresh());
    expect(fresh.value.status).toBe(200);
    expect(fresh.log.some((e) => e.sql.includes('FROM tickets t LEFT JOIN ticket_stations'))).toBe(false);
    expect(await version()).toBeGreaterThan(v);
    expect((await claimItem('vm-a', w.secret)).json.ticket_id).toBe('docs:A');
    await sameProjection();
  });

  it('maintains candidates transactionally and does not retain a rolled-back version', async () => {
    const git = new Git().add('A').add('B', { rank: 3 });
    await git.post(); await cutover();
    await sameProjection();
    const before = await version();
    await withCore((c) => {
      expect(() => c.store.transaction(() => {
        c.store.exec("UPDATE tickets SET rank = -100 WHERE id = 'docs:B'");
        c.store.exec("INSERT INTO ticket_overrides(ticket_id, hold, set_by, set_at) VALUES ('docs:A', 1, 'test', 0)");
        throw new Error('rollback');
      })).toThrow('rollback');
    });
    expect(await version()).toBe(before);
    await sameProjection();
    await rows("INSERT INTO ticket_overrides(ticket_id, hold, set_by, set_at) VALUES ('docs:A', 1, 'test', 0)");
    await sameProjection();
    expect(await rows("SELECT ticket_id FROM ready_tickets WHERE ticket_id='docs:A'")).toEqual([]);
    await rows("UPDATE ticket_overrides SET hold=0, retry_after=? WHERE ticket_id='docs:A'", T0+1000);
    await sameProjection();
    const w = await register('vm-a');
    const recs = async (reference: boolean) => {
      await withCore((c) => { c.claims.reference = reference; });
      return (await (await runnerCall('/v1/runner/recommendations', { secret: w.secret })).json()) as Record<string, unknown>;
    };
    expect(await recs(false)).toEqual(await recs(true));
    await setClock(T0+1001);
    expect(await recs(false)).toEqual(await recs(true));
    await withCore((c) => { c.claims.reference = false; });
    const claim = await measure(() => claimItem('vm-a', w.secret, { ticket_id: 'docs:A' }));
    expect(claim.value.status).toBe(200);
    if (HOST === 'cloudflare') { expect(claim.read).toBeLessThan(500); expect(claim.written).toBeLessThan(150); }
    await sameProjection();
  });

  it('does not confuse a same-head tracker edit with an unchanged snapshot', async () => {
    const git = new Git().add('A', { requires: ['human-operator'] });
    await git.post(); await cutover();
    await git.refresh(); await git.refresh();
    const w = await register('vm-a');
    expect((await claimItem('vm-a', w.secret)).json.code).toBe('no-eligible-ticket');
    // Changing the submitted placement at the same head must take the full validation path.
    git.stations.A = { ...(git.stations.A as Record<string, unknown>), next: [{ leg: 'implement', state: 'waiting', waiting_on: 'findings' }] };
    const changed = await measure(() => git.refresh());
    expect(changed.value.status).toBe(200);
    expect(changed.log.some((e) => e.sql.includes('FROM tickets t LEFT JOIN ticket_stations'))).toBe(true);
    await sameProjection();
    expect(await rows("SELECT ticket_id FROM ready_tickets WHERE ticket_id='docs:A'")).toEqual([]);
    git.add('NEW', { version: 'tracker-v2' });
    expect((await git.refresh()).status).toBe(200);
    expect(await rows("SELECT version FROM tickets WHERE id='docs:NEW'")).toEqual([{ version: 'tracker-v2' }]);
    await sameProjection();
  });

  it('pages dashboard rows, isolates ETags from activities, and reads latest pointers without history scans', async () => {
    const admin = await makeKey('ssh-ed25519', 'read-admin');
    await setAdminKeys(admin);
    const git = new Git();
    for (let i = 0; i < 30; i++) git.add(`A-${String(i).padStart(2, '0')}`);
    await git.post(); await cutover();
    const w = await register('vm-a');
    const cookie = await adminSession(admin);
    const path = '/v1/ui/repositories/docs/tickets?limit=10';
    const first = await sessionCall(cookie, path);
    const page = await first.json() as { tickets: { id: string }[]; cursor: string };
    expect(page.tickets).toHaveLength(10);
    const next = await (await sessionCall(cookie, `${path}&after=${encodeURIComponent(page.cursor)}`)).json() as { tickets: { id: string }[] };
    expect(next.tickets).toHaveLength(10);
    expect(new Set([...page.tickets, ...next.tickets].map((t) => t.id)).size).toBe(20);
    const tag = first.headers.get('ETag')!;
    await rows("INSERT INTO messages(kind, from_runner_id, to_runner_id, sent_at, status, payload_json) VALUES ('status_report', ?, ?, ?, 'pending', '{}')", w.id, w.id, T0);
    expect((await sessionCall(cookie, path, { headers: { 'If-None-Match': tag } })).status).toBe(304);
    expect((await call(path, { headers: { 'If-None-Match': tag } })).status).toBe(401);
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM k WHERE i<3000)
      INSERT INTO messages(kind, from_runner_id, to_runner_id, sent_at, status, payload_json) SELECT 'status_report', ?, ?, ?, 'pending', '{"text":"last"}' FROM k`, w.id, w.id, T0);
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM k WHERE i<3000)
      INSERT INTO pending_transcripts(runner_id, repo, path, role, first_seen_at)
      SELECT ?, 'immediately-run/claude-sessions', 'log-' || i, 'session', ? + i FROM k`, w.id, T0);
    const read = await measure(() => sessionCall(cookie, '/v1/ui/repositories/docs/runners?limit=10'));
    expect(read.value.status).toBe(200);
    const body = await read.value.json() as { runners: { transcript_url: string; last_report: { payload_json: string } }[] };
    expect(body.runners).toHaveLength(1);
    expect(body.runners[0].transcript_url).toContain('log-3000');
    expect(JSON.parse(body.runners[0].last_report.payload_json)).toEqual({ text: 'last' });
    for (const entry of read.log.filter((e) => e.sql.includes('FROM pending_transcripts WHERE') || e.sql.includes('FROM messages WHERE id IN'))) {
      const plan = await rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${entry.sql}`, ...entry.params);
      expect(plan.some((p) => /pending_transcripts_latest|messages_reports/.test(p.detail))).toBe(true);
    }
    if (HOST === 'cloudflare') { expect(read.read).toBeLessThan(100); expect(read.written).toBeLessThan(5); }
  });
});
