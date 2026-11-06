// S-BTN-203 opaque ticket versions, the sync's and the runner's halves (BATON_SPEC §4.2
// R-BTN-74, §4.3 R-BTN-11/R-BTN-62, §4.5 R-BTN-5/R-BTN-34; B-183), Node only: a real sync over
// a real repository. A fixture `custom` ticket source with `versions: "current"` — backed by a
// JSON file outside git, its version the store's own stamp over a digest of the ticket, its order
// judged by the source's code alone — carries a tracker's edit to the board with no commit; a
// claim on a ticket that changed before the leg starts releases `stale-board`, one whose ticket
// did not change runs; the observation hands each live ticket's version back, and a source whose
// store read is behind what the board holds refuses, failing the run and posting nothing. The
// markdown source is pinned: each ticket's version is its file's blob id at the posted commit, an
// unrelated commit changes no version and stales no claim, and a refresh writes no ticket row.
// The board's half is S-BTN-202's, on both hosts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { Runner } from '../../src/runner/runner';
import { BatonApi } from '../../src/runner/api';
import { ORIGIN, TOKENS, claimRow, claimItem, cutover, observe, register, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-11-06T12:00:00Z');

/** The fixture source B-183 names: a tracker-backed `custom` source with `versions: "current"`
 *  over a JSON file outside git. The version is `<rev>:<digest>` — the store's own stamp over a
 *  digest of what `read` returns, the spec's recommendation over a timestamp alone — and the
 *  SOURCE, never Baton, judges order: a read whose rev is behind the version the observation
 *  handed back for a ticket it would post again refuses, failing the run (§4.3, R-BTN-150). */
const trackerSource = (store: string): string => `import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const STORE = ${JSON.stringify(store)};
const digest = (t) => createHash('sha256').update(JSON.stringify({ id: t.id, title: t.title, body: t.body ?? '', status: t.status ?? 'live' })).digest('hex').slice(0, 16);
const revOf = (v) => { const m = /^(\\d+):/.exec(v ?? ''); return m ? Number(m[1]) : null; };
const readStore = () => JSON.parse(readFileSync(STORE, 'utf8'));
export default {
  versions: 'current',
  async tickets(ctx) {
    const store = readStore();
    const tickets = store.tickets.filter((t) => t.status !== 'withdrawn').map((t) => ({
      id: t.id, version: store.rev + ':' + digest(t), key: 'tracker:' + (t.key ?? t.id), course_id: 'create-pr',
      title: t.title, tier: t.tier ?? 'routine', requires: [], operator_only: false, expedite: false,
      depends_on: [], blocked_by: [], repos: [], rank: t.rank ?? 0,
    }));
    for (const t of tickets) {
      const mine = revOf(t.version);
      const theirs = revOf((ctx.versions ?? {})[t.id]);
      if (mine != null && theirs != null && mine < theirs) throw new Error('the store read for ' + t.id + ' is behind the board (rev ' + mine + ' < ' + theirs + ') — refusing to post');
    }
    return { tickets, closed: store.tickets.filter((t) => t.status === 'withdrawn').map((t) => ({ id: t.id, as: 'withdrawn' })) };
  },
  async read(id) {
    const t = readStore().tickets.find((x) => x.id === id);
    if (t == null || t.status === 'withdrawn') return null;
    const store = readStore();
    return { version: store.rev + ':' + digest(t), ticket: t };
  },
};
`;

/** One scaffolded repository, as S-BTN-43's: git, an origin, `baton repo init`, no course code of
 *  its own — plus (when `tracker` is set) the fixture source and its store file outside git. */
class Repo {
  readonly dir: string;
  readonly store: string;
  private readonly tracker: boolean;
  constructor(tracker: boolean) {
    this.tracker = tracker;
    this.dir = mkdtempSync(join(tmpdir(), tracker ? 'baton-s203t-' : 'baton-s203m-'));
    this.store = join(mkdtempSync(join(tmpdir(), 'baton-s203-store-')), 'store.json');
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'relay@test');
    g('config', 'user.name', 'relay test');
    g('remote', 'add', 'origin', 'https://github.com/immediately-run/docs.git');
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
    if (tracker) {
      writeFileSync(join(this.dir, 'tickets', 'README.md'), 'the tickets wiki\n');
    } else {
      writeFileSync(join(this.dir, 'tickets', 'one.mdx'), '---\nid: T-1\ntitle: One\ntier: routine\n---\nThe body.\n');
      writeFileSync(join(this.dir, 'tickets', 'two.mdx'), '---\nid: T-2\ntitle: Two\ntier: routine\n---\nAnother body.\n');
    }
    this.tracker = tracker;
  }

  /** `baton repo init`, the fixture source and the runnable leg: everything after the tree. */
  async setup(): Promise<Repo> {
    expect(await initMain([], { root: this.dir, log: () => {} })).toBe(0);
    if (this.tracker) writeFileSync(join(this.dir, '.baton', 'tickets.mjs'), trackerSource(this.store));
    // A leg the runner can run: it writes its marker and ends the claim, so one claim is one leg.
    writeFileSync(join(this.dir, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs'), `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function run(ctx) {
  const id = ctx.ticket.id.split(':').pop();
  writeFileSync(join(ctx.checkout, 'leg-ran-' + id + '.txt'), String(ctx.ticket.version ?? ''));
  return { end: 'done', reached: 'filed' };
}
export async function close() { return 'https://example.test/close'; }
`);
    this.writeStore({ rev: 5, tickets: [
      { id: 'T-100', key: 'C-100', title: 'The first tracked ticket', body: 'As first filed.', rank: 0 },
      { id: 'T-101', key: 'C-101', title: 'The second tracked ticket', body: 'As first filed.', rank: 1 },
    ] });
    this.commit();
    return this;
  }
  writeStore(store: unknown): void {
    writeFileSync(this.store, `${JSON.stringify(store, null, 2)}\n`);
  }
  readStore(): { rev: number; tickets: Record<string, unknown>[] } {
    return JSON.parse(readFileSync(this.store, 'utf8')) as { rev: number; tickets: Record<string, unknown>[] };
  }
  commit(message = 'wiki'): string {
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('add', '-A');
    g('commit', '--allow-empty', '-qm', message);
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  blob(path: string): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', `HEAD:${path}`], { encoding: 'utf8' }).trim();
  }
  head(): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  /** One sync: no facts, the harness's sync credential, the local host's transport. Its logged
   *  outcome line, for assertions. */
  async sync(): Promise<string> {
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, '[]');
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts], {});
    const lines: string[] = [];
    const code = await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: (l) => lines.push(l) });
    return `exit ${code}: ${lines.at(-1) ?? ''}`;
  }
  /** The runner over this home, as S-BTN-147's: one session, one credential. */
  runner(session: string): Runner {
    const api = new BatonApi({
      url: ORIGIN,
      transport: (req) => hostCall(req),
      auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
    });
    return new Runner({
      api, home: this.dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session,
      courses: [{ course: 'create-pr', version: 1 }], stateFile: join(tmpdir(), `baton-s203-${session}.json`),
      beatEvery: 60_000, log: () => {},
    });
  }
}

let repo: Repo;
const repos: Repo[] = [];
beforeEach(async () => {
  await setClock(T0);
  await cutover();
});
afterEach(() => {
  for (const r of repos) rmSync(r.dir, { recursive: true, force: true });
  repos.length = 0;
});

describe('S-BTN-203 ticket versions through the sync and the runner', () => {
  it('a current-source ticket edited with no commit reaches the board in a refresh; a new one boards the same way', async () => {
    repo = new Repo(true);
    repos.push(repo);
    await repo.setup();
    expect(await repo.sync()).toMatch(/^exit 0: baton: advanced at /);
    const before = (await rows<{ local_id: string; version: string }>('SELECT local_id, version FROM tickets ORDER BY local_id'));
    expect(before).toHaveLength(2);
    expect(before[0]).toMatchObject({ local_id: 'T-100', version: expect.stringMatching(/^5:[0-9a-f]{16}$/) });

    // The tracker edits T-100 and adds T-200 — no commit anywhere.
    const store = repo.readStore();
    store.tickets = store.tickets.map((t) => (t.id === 'T-100' ? { ...t, body: 'Edited in the tracker with no commit.' } : t));
    store.tickets.push({ id: 'T-200', key: 'C-200', title: 'Added in the tracker', body: 'New.', rank: 2 });
    store.rev = 6;
    repo.writeStore(store);
    // The same commit again: a refresh under a newer number, carrying the changed tickets.
    expect(await repo.sync()).toMatch(/^exit 0: baton: confirmed at /);
    const after = await rows<{ local_id: string; version: string; title: string }>('SELECT local_id, version, title FROM tickets ORDER BY local_id');
    expect(after.map(({ local_id }) => local_id)).toEqual(['T-100', 'T-101', 'T-200']);
    expect(after[0].version).toMatch(/^6:/);
    expect(after[0].version).not.toBe(before[0].version);
    // The store's digest moved with the edit: the same rev would still change the version.
    expect((await observe()).json.versions['T-100']).toBe(after[0].version);
  });

  it('a claim whose ticket changed before the leg starts releases stale-board; one whose ticket did not change runs', async () => {
    repo = new Repo(true);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    const runner = repo.runner(`s203-${process.pid}`);
    // The store still at rev 5: the claim runs its leg (its marker names the claim's version).
    const first = await runner.runOnce();
    expect(first).not.toBeNull();
    expect(readFileSync(join(repo.dir, 'leg-ran-T-100.txt'), 'utf8')).toMatch(/^5:[0-9a-f]{16}$/);
    // The tracker edits T-101 with no commit and no sync: the next claim is decided on rev 5 and
    // the runner reads the store as it is now — the versions differ, so the claim releases
    // stale-board before any leg runs (§4.5).
    const store = repo.readStore();
    store.tickets = store.tickets.map((t) => (t.id === 'T-101' ? { ...t, body: 'Edited after the claim was decided.' } : t));
    store.rev = 6;
    repo.writeStore(store);
    const second = await runner.runOnce();
    expect(second).not.toBeNull();
    expect(existsSync(join(repo.dir, 'leg-ran-T-101.txt'))).toBe(false);
    const ended = (await rows<{ status: string; end_reason: string }>(`SELECT status, end_reason FROM claims WHERE ticket_id = ? ORDER BY id DESC LIMIT 1`, 'docs:T-101'))[0];
    expect(ended).toEqual({ status: 'released', end_reason: 'released:stale-board' });
    // A sync of the moved store, and the ticket claims and runs again on the new version.
    await repo.sync();
    const third = await runner.runOnce();
    expect(third).not.toBeNull();
    expect(readFileSync(join(repo.dir, 'leg-ran-T-101.txt'), 'utf8')).toMatch(/^6:[0-9a-f]{16}$/);
  });

  it('a fixture source whose store read is behind the board refuses: the run fails and posts nothing', async () => {
    repo = new Repo(true);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    const before = await rows<{ version: string }>('SELECT version FROM tickets WHERE local_id = ?', 'T-100');
    // A lagging replica: the store's own stamp is older than what the observation handed back.
    const store = repo.readStore();
    store.rev = 3;
    repo.writeStore(store);
    await expect(repo.sync()).rejects.toThrow(/behind the board \(rev 3 < 5\)/);
    // Nothing was posted: the row Baton holds is still the rev-5 reading's.
    expect(await rows<{ version: string }>('SELECT version FROM tickets WHERE local_id = ?', 'T-100')).toEqual(before);
    // The failed run's number stays out for its ten minutes (R-BTN-62): past them, the store
    // recovering, the next run posts as usual.
    await setClock(T0 + 11 * 60_000);
    store.rev = 7;
    repo.writeStore(store);
    expect(await repo.sync()).toMatch(/^exit 0: baton: confirmed at /);
    expect((await rows<{ version: string }>('SELECT version FROM tickets WHERE local_id = ?', 'T-100'))[0].version).toMatch(/^7:/);
  });

  it('the markdown source is pinned: a ticket’s version is its file’s blob id, an unrelated commit changes no version and stales no claim', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    const one = repo.blob('tickets/one.mdx');
    expect(await rows<{ local_id: string; version: string; key: string | null }>('SELECT local_id, version, key FROM tickets ORDER BY local_id')).toEqual([
      { local_id: 'T-1', version: one, key: 'tickets/one.mdx' },
      { local_id: 'T-2', version: repo.blob('tickets/two.mdx'), key: 'tickets/two.mdx' },
    ]);
    // A claim on T-1, then an unrelated commit: T-1's blob id — its version — cannot move, and
    // the reading does not stale the claim (R-BTN-35: progress is not staleness).
    const { secret } = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-pr', version: 1 }] });
    const c = await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' });
    expect(c.json).toMatchObject({ version: one, ticket_source: { kind: 'markdown', versions: 'pinned' } });
    writeFileSync(join(repo.dir, 'README.md'), 'an unrelated change\n');
    repo.commit('an unrelated commit');
    expect(await repo.sync()).toMatch(/^exit 0: baton: advanced at /);
    expect(await rows<{ version: string }>('SELECT version FROM tickets WHERE local_id = ?', 'T-1')).toEqual([{ version: one }]);
    expect(await claimRow(c.json.claim_id)).toMatchObject({ status: 'active' });
    // A refresh of an unchanged markdown board writes no ticket row: no version moves without a
    // commit (§4.3), so its refreshes are unchanged in effect.
    const before = await rows('SELECT id, row_hash FROM tickets ORDER BY id');
    expect(await repo.sync()).toMatch(/^exit 0: baton: confirmed at /);
    expect(await rows('SELECT id, row_hash FROM tickets ORDER BY id')).toEqual(before);
  });
});
