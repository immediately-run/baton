// S-BTN-244 retention (B-238; BATON_SPEC §2 R-BTN-149): the alarm prunes, a batch a tick, what
// Baton would otherwise keep forever. Repository events older than 90 days go only below every
// live mirror's acknowledged cursor (a mirror's `GET /v1/sync/events` acknowledges the cursor it
// starts from), a tenant event never; board snapshots older than 90 days go, never a head's; a
// runner unseen 30 days loses its capability, tag and course rows and keeps its row (R-BTN-3);
// the claims of a ticket whose history R-BTN-81 purged go with their legs and activities once
// their events have gone — an open ticket's claims stay (R-BTN-24, R-BTN-106). Runs on both hosts.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Git, HOST, advance, claimItem, cutover, endClaim, mirrorCall, register, rows, setClock, tick, withCore, runnerCall } from '../helpers';
import type { EventArchive, Ports } from '../../src/core/ports';

const T0 = Date.parse('2026-08-01T12:00:00Z');
const DAY = 86_400_000;

type Scheduler = { get(): Promise<number | null>; set(at: number): Promise<void> };
let scheduler: Scheduler | null = null;

/** Only the ticks the test runs (the fake clock is behind the real one, so an armed alarm would
 *  run beside them and prune in between). */
async function quietAlarm() {
  await withCore(async (c) => {
    const ports = (c as unknown as { ports: { scheduler: Scheduler } }).ports;
    scheduler ??= ports.scheduler;
    await scheduler.set(Date.now() + 3_600_000);
    ports.scheduler = { get: async () => Date.now() + 3_600_000, set: async () => {} };
  });
}

afterEach(async () => {
  await withCore((c) => {
    if (scheduler) (c as unknown as { ports: { scheduler: Scheduler } }).ports.scheduler = scheduler;
  });
  scheduler = null;
});

const count = async (sql: string, ...p: unknown[]) => (await rows<{ n: number }>(sql, ...p))[0].n;
const maxSeq = async () => count('SELECT COALESCE(MAX(seq), 0) AS n FROM events');
/** docs' mirror reads its feed from `after`: the acknowledgement (§12, §16). */
const ack = async (after: number) => expect((await mirrorCall(`/v1/sync/events?after=${after}`)).status).toBe(200);
const useArchive = (archive: EventArchive) => withCore((c) => {
  (c as unknown as { ports: Ports }).ports.archiveEvents = archive;
});

let git: Git;

beforeEach(async () => {
  await setClock(T0);
  await quietAlarm();
  git = new Git();
  for (const id of ['T-1', 'T-2', 'T-3']) git.add(id);
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-244 R-BTN-149 retention', () => {
  it('events older than 90 days go below the mirror’s acknowledged cursor; tenant events and younger ones stay', async () => {
    await useArchive(async () => {});
    const fill = (n: number, at: number, repo: string | null) => rows(
      `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
       INSERT INTO events (at, kind, actor, detail_json, repository_id) SELECT ?, 'admin', 'test', '{}', ? FROM k`, n, at, repo);
    await fill(10, T0, null);
    await fill(40, T0, 'docs');
    await fill(20, T0, 'baton');
    const middle = (await rows<{ seq: number }>(`SELECT seq FROM events WHERE repository_id = 'docs' AND actor = 'test' ORDER BY seq LIMIT 1 OFFSET 20`))[0].seq;
    await setClock(T0 + 89 * DAY);
    await fill(5, T0 + 89 * DAY, 'docs');

    // 91 days on: docs has a mirror that has read nothing, so nothing goes — baton's included
    // (every live mirror's cursor bounds every repository's events).
    await setClock(T0 + 91 * DAY);
    await tick();
    expect(await count(`SELECT COUNT(*) AS n FROM events WHERE actor = 'test' AND at = ?`, T0)).toBe(70);
    // The mirror reads from `middle`: the old events below it go, at and above it stay.
    await ack(middle);
    expect(await count(`SELECT mirror_acked_seq AS n FROM repositories WHERE id = 'docs'`)).toBe(middle);
    await tick();
    expect(await count(`SELECT COUNT(*) AS n FROM events WHERE repository_id IS NOT NULL AND at = ? AND seq < ?`, T0, middle)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM events WHERE repository_id = 'docs' AND actor = 'test' AND at = ?`, T0)).toBe(20);
    // A cursor read again from lower acknowledges nothing back; one past the log is the log's end.
    await ack(0);
    expect(await count(`SELECT mirror_acked_seq AS n FROM repositories WHERE id = 'docs'`)).toBe(middle);
    await ack(1_000_000_000);
    expect(await count(`SELECT mirror_acked_seq AS n FROM repositories WHERE id = 'docs'`)).toBe(await maxSeq());
    await tick();
    // Every old repository event gone; the tenant's, and those under 90 days, kept.
    expect(await count(`SELECT COUNT(*) AS n FROM events WHERE repository_id IS NOT NULL AND at = ?`, T0)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM events WHERE repository_id IS NULL AND at = ?`, T0)).toBe(10);
    expect(await count(`SELECT COUNT(*) AS n FROM events WHERE at = ?`, T0 + 89 * DAY)).toBe(5);
  });

  it('a tick deletes at most 1,000 rows', async () => {
    await useArchive(async () => {});
    await rows(`WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < 2500)
                INSERT INTO events (at, kind, actor, detail_json, repository_id) SELECT ?, 'admin', 'test', '{}', 'docs' FROM k`, T0);
    await setClock(T0 + 91 * DAY);
    await ack(await maxSeq());
    const old = () => count(`SELECT COUNT(*) AS n FROM events WHERE repository_id IS NOT NULL AND at <= ?`, T0);
    const start = await old();
    expect(start).toBeGreaterThanOrEqual(2500);
    await tick();
    expect(await old()).toBe(start - 1000);
    await tick();
    expect(await old()).toBe(start - 2000);
    await tick();
    // All but the acknowledged cursor's own event: R-BTN-149 prunes below it.
    expect(await old()).toBe(1);
  });

  it('keeps old acknowledged events when no archive is configured', async () => {
    await withCore((c) => { (c as unknown as { ports: Ports }).ports.archiveEvents = undefined; });
    const before = await rows('SELECT seq FROM events WHERE repository_id IS NOT NULL ORDER BY seq');
    expect(before.length).toBeGreaterThan(0);
    await setClock(T0 + 91 * DAY);
    await ack(await maxSeq());
    await tick();
    expect(await rows('SELECT seq FROM events WHERE repository_id IS NOT NULL AND at = ? ORDER BY seq', T0)).toEqual(before);
  });

  it.runIf((HOST as string) === 'local')('prunes snapshots during archive I/O without a second export, then rechecks the mirror cursor', async () => {
    const expired = git.head;
    expect((await git.post()).status).toBe(200);
    expect(git.head).not.toBe(expired);
    const snapshots = () => count(`SELECT COUNT(*) AS n FROM board_snapshots WHERE repository_id = 'docs' AND sha = ?`, expired);
    await rows(`INSERT INTO events (at, kind, actor, detail_json, repository_id) VALUES (?, 'admin', 'test', '{}', 'docs')`, T0);
    await setClock(T0 + 91 * DAY);
    await ack(await maxSeq());
    const oldRows = () => rows('SELECT seq FROM events WHERE repository_id IS NOT NULL AND at = ? ORDER BY seq', T0);
    const before = await oldRows();
    expect(before.length).toBeGreaterThan(1);
    let started!: () => void;
    let release!: () => void;
    const archiving = new Promise<void>((resolve) => { started = resolve; });
    const archived = new Promise<void>((resolve) => { release = resolve; });
    let writes = 0;
    await useArchive(async () => {
      if (++writes !== 1) return;
      started();
      await archived;
    });
    const pruning = tick();
    await Promise.race([archiving, pruning]);
    let ran = false;
    const nextTurn = snapshots().then((n) => { ran = true; return n; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ran).toBe(true);
      expect(await nextTurn).toBe(1);
      // The batch is still eligible: only the in-flight guard prevents a second export.
      await tick();
      expect(writes).toBe(1);
      expect(await snapshots()).toBe(0);
      expect(await oldRows()).toEqual(before);
      await rows(`UPDATE repositories SET mirror_acked_seq = 0 WHERE id = 'docs'`);
    } finally {
      release();
      await Promise.all([pruning, nextTurn]);
    }
    expect(await oldRows()).toEqual(before);
  });

  it('after archive failure retains all events; the retry exports the mirror format and deletes only that batch', async () => {
    const add = (kind: string) => rows<{ seq: number }>(`INSERT INTO events
      (at, kind, actor, detail_json, repository_id) VALUES (?, ?, 'owner:private', '{"reason":"test","session":"private"}', 'docs') RETURNING seq`, T0, kind);
    const [visible] = await add('admin');
    const [internal] = await add('blocked');
    const [later] = await add('admin');
    await setClock(T0 + 91 * DAY);
    const feed = await (await mirrorCall(`/v1/sync/events?after=${visible.seq - 1}`)).json<{ events: unknown[]; cutover_at: number | null }>();
    await ack(later.seq);
    const eligible = await rows<{ seq: number }>('SELECT seq FROM events WHERE repository_id IS NOT NULL AND at = ? AND seq < ? ORDER BY seq', T0, later.seq);
    expect(eligible).toContainEqual(internal);

    await useArchive(async () => { throw new Error('archive unavailable'); });
    await expect(tick()).rejects.toThrow('archive unavailable');
    expect(await rows('SELECT seq FROM events WHERE repository_id IS NOT NULL AND at = ? AND seq < ? ORDER BY seq', T0, later.seq)).toEqual(eligible);

    // Advance the ack during the write: `later` becomes eligible but wasn't in the selected batch.
    const archived: number[] = [];
    await withCore((c) => {
      (c as unknown as { ports: Ports }).ports.archiveEvents = async (parts) => {
        const found = c.store.exec<{ seq: number }>('SELECT seq FROM events WHERE repository_id IS NOT NULL AND at = ? AND seq < ? ORDER BY seq', T0, later.seq).toArray();
        expect(found).toEqual(eligible);
        const docs = parts.find(({ repository }) => repository === 'docs')!;
        expect(docs.day).toBe('2026-08-01');
        const page = JSON.parse(docs.ndjson);
        expect(page.repository).toBe('docs');
        expect(page.events.find((e: { seq: number }) => e.seq === visible.seq)).toEqual(feed.events[0]);
        expect(page).toMatchObject({ cutover_at: feed.cutover_at, next: internal.seq });
        expect(docs.ndjson).not.toContain('private');
        archived.push(...parts.flatMap((p) => JSON.parse(p.ndjson).events.map((e: { seq: number }) => e.seq)));
        c.store.exec(`INSERT INTO events (at, kind, actor) VALUES (?, 'admin', 'test')`, T0);
        c.store.exec(`UPDATE repositories SET mirror_acked_seq = (SELECT MAX(seq) FROM events) WHERE id = 'docs'`);
      };
    });
    await tick();
    expect(archived.sort((a, b) => a - b)).toEqual(eligible.map((e) => e.seq));
    expect(await rows('SELECT seq FROM events WHERE repository_id IS NOT NULL AND at = ? ORDER BY seq', T0)).toEqual([later]);
  });

  it('board snapshots older than 90 days go, never a head’s', async () => {
    const first = git.head;
    expect((await git.post()).status).toBe(200);
    const second = git.head;
    await setClock(T0 + 50 * DAY);
    expect((await git.post()).status).toBe(200);
    const third = git.head;
    await setClock(T0 + 91 * DAY);
    await tick();
    const shas = async () => (await rows<{ sha: string }>(`SELECT sha FROM board_snapshots WHERE repository_id = 'docs' ORDER BY received_at`)).map((r) => r.sha);
    expect(await shas()).toEqual([third]);
    // The head is never pruned, however old.
    await setClock(T0 + 200 * DAY);
    await tick();
    expect(await shas()).toEqual([third]);
    expect([first, second]).not.toContain(third);
  });

  it('a runner unseen 30 days loses its capability, tag and course rows and keeps its row', async () => {
    const quiet = await register('vm-a', { tags: ['gpu'] });
    const deps = async (id: number) => Promise.all(['runner_capabilities', 'runner_tags', 'runner_courses'].map((t) => count(`SELECT COUNT(*) AS n FROM ${t} WHERE runner_id = ?`, id)));
    const before = await deps(quiet.id);
    expect(before.every((n) => n > 0)).toBe(true);
    await setClock(T0 + 29 * DAY);
    const live = await register('vm-b', { tags: ['gpu'] });
    await tick();
    expect(await deps(quiet.id)).toEqual(before);
    await setClock(T0 + 31 * DAY);
    await tick();
    expect(await deps(quiet.id)).toEqual([0, 0, 0]);
    expect(await count('SELECT COUNT(*) AS n FROM runners WHERE id = ?', quiet.id)).toBe(1);
    expect((await deps(live.id)).every((n) => n > 0)).toBe(true);
    // The second runner falls silent too, later: the prune goes on from where it stopped.
    await setClock(T0 + 61 * DAY);
    await tick();
    expect(await deps(live.id)).toEqual([0, 0, 0]);
  });

  it('a purged ticket’s claims go with their legs and activities once their events have; an open ticket’s stay', async () => {
    await useArchive(async () => {});
    const w = await register('vm-a');
    const run = async (ticket: string, end: Record<string, unknown> = { end_reason: 'released:requested', reached: 'pr-open', next: 'review' }) => {
      const c = (await claimItem('vm-a', w.secret, { ticket_id: ticket })).json;
      await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' });
      await runnerCall('/v1/runner/activities', { secret: w.secret, body: { activities: [
        { id: `p-${ticket}`, claim_id: c.claim_id, kind: 'push', source: 'skill', started_at: T0, ended_at: T0, outcome: 'succeeded', detail: { branch: `claude/${ticket}` } },
      ] } });
      expect((await endClaim('vm-a', w.secret, c.claim_id, end)).status).toBe(200);
      return c.claim_id as number;
    };
    const closed = await run('docs:T-1');
    const open = await run('docs:T-2');
    // T-3's claim ends completed and is never confirmed: Needs you's, held (§6.7, R-BTN-39).
    const unconfirmed = await run('docs:T-3', { end_reason: 'suspended:pr-open', reached: 'pr-open' });
    const of = async (claim: number) => Promise.all([
      count('SELECT COUNT(*) AS n FROM claims WHERE id = ?', claim),
      count('SELECT COUNT(*) AS n FROM claim_legs WHERE claim_id = ?', claim),
      count('SELECT COUNT(*) AS n FROM activities WHERE claim_id = ?', claim),
    ]);
    expect((await of(closed)).every((n) => n > 0)).toBe(true);
    git.close('T-1', 'done').close('T-3', 'done');
    expect((await git.post()).status).toBe(200);

    // 91 days after the close R-BTN-81 purges T-1's history; its claim waits for its events,
    // which wait for the mirror.
    await setClock(T0 + 91 * DAY);
    await tick();
    expect(await count(`SELECT COUNT(*) AS n FROM closed_tickets WHERE ticket_id = 'docs:T-1' AND purged_at IS NOT NULL AND claims_due_at IS NOT NULL`)).toBe(1);
    expect((await of(closed)).every((n) => n > 0)).toBe(true);
    // The mirror acknowledges; the events go, and a day later the claim with its rows.
    await ack(await maxSeq());
    await tick();
    expect(await count('SELECT COUNT(*) AS n FROM events WHERE claim_id = ?', closed)).toBe(0);
    await setClock(T0 + 92 * DAY + 1);
    await tick();
    expect(await of(closed)).toEqual([0, 0, 0]);
    expect(await count(`SELECT COUNT(*) AS n FROM closed_tickets WHERE ticket_id = 'docs:T-1' AND claims_due_at IS NULL`)).toBe(1);
    // The unconfirmed claim stays while it is held; its ticket is tried again a day later.
    expect((await of(unconfirmed)).every((n) => n > 0)).toBe(true);
    expect(await count(`SELECT claims_due_at AS n FROM closed_tickets WHERE ticket_id = 'docs:T-3'`)).toBe(T0 + 93 * DAY + 1);
    // T-2 is open: its events are 90 days old and went, its claim and rows stay.
    expect(await count('SELECT COUNT(*) AS n FROM events WHERE claim_id = ?', open)).toBe(0);
    expect((await of(open)).every((n) => n > 0)).toBe(true);
  });
});
