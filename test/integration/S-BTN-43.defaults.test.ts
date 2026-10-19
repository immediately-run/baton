// S-BTN-43 a repository with no course code (BATON_SPEC §13a S-BTN-43, §2f R-BTN-74; R3-1249):
// a fresh repository with a `tickets/` wiki of five items (one `depends_on` another, one
// `done`, one with an unknown frontmatter field, one file without `id`) runs `baton repo init` and
// its sync with no `.baton/tickets.mjs` or `sync.mjs`; a PR opens for one ticket, checks pass,
// a review requests changes, a fix is pushed, a review approves, the PR merges and the item is
// marked `done`; then `baton repo init --eject tickets` and an edit to the copy. Must hold: four
// tickets on the `pr` course (the file without `id` is none, the `done` one closed); the
// dependent ticket is not ready until its dependency is done; the ticket moves
// filed → pr-open (review waiting on ci, then ready) → reviewed (fix ready) → fixed → reviewed
// (merge ready) → merged; after the eject the edited source's tickets are posted; Baton's
// src/core/ gains no line (the boundary test asserts the defaults' exemption and core's
// non-import); a second run where the PR is authored and reviewed by one identity, with
// `<!-- baton:verdict … -->` comment-only reviews, moves the same way; a red check makes
// `review` ready. Node only: it writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
// No --pin: the CLI pins its own commit, the one its courses' sources name (B-33).
const init = (root: string, ...argv: string[]) => initMain(argv, { root, log: () => {} });
import type { PrFact } from '../../src/defaults/course-pr';
import { ORIGIN, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-10-16T12:00:00Z');

/** The fixture repository: a git tree with a tickets/ wiki, no course code of its own. */
class Repo {
  readonly dir: string;
  facts: PrFact[] = [];
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'baton-s43-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'relay@test');
    g('config', 'user.name', 'relay test');
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
    this.write('tickets/first.md', '---\nid: T-1\ntitle: First\ntier: routine\nmystery: unknown-field\n---\n');
    this.write('tickets/second.md', '---\nid: T-2\ntitle: Second\ndepends_on: [T-1]\n---\n');
    // T-3 depends on an archived done item, which the source reads from tickets/archive/.
    this.write('tickets/third.md', '---\nid: T-3\ntitle: Third\ndepends_on: [T-0]\n---\n');
    mkdirSync(join(this.dir, 'tickets', 'archive'), { recursive: true });
    this.write('tickets/archive/zero.md', '---\nid: T-0\nstatus: done\n---\n');
    this.write('tickets/done.md', '---\nid: T-9\nstatus: done\n---\n');
    this.write('tickets/noid.md', '---\ntitle: no id here\n---\n');
    this.write('tickets/notes.txt', 'not markdown\n');
  }
  write(path: string, text: string): void {
    writeFileSync(join(this.dir, path), text);
  }
  commit(): string {
    execFileSync('git', ['-C', this.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--allow-empty', '-qm', 'wiki'], { stdio: 'ignore' });
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  /** One sync: recorded facts, the harness's sync credential, the local host's transport. */
  async sync(...extra: string[]): Promise<void> {
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, JSON.stringify(this.facts));
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts, ...extra], {});
    await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: () => {} });
  }
}

let repo: Repo;
beforeEach(async () => {
  await setClock(T0);
  repo = new Repo();
});
afterEach(() => rmSync(repo.dir, { recursive: true, force: true }));

type StationRow = { station: string; next_leg: string | null };
type NextRow = { leg: string; state: string; waiting_on: string | null };
const stationOf = (id: string): Promise<StationRow[]> => rows('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', `docs:${id}`);
const nextOf = (id: string): Promise<NextRow[]> => rows('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${id}`);

/** One fact in the shape R-BTN-96's adapter records. */
function fact(number: number, state: PrFact['state'], checks: (string | null)[], reviews: PrFact['reviews'], pushedAt?: number): PrFact {
  return { number, head: `claude/T-1-${number}`, state, pushedAt: pushedAt ?? reviews.at(-1)?.submittedAt ?? T0, checks, reviews };
}
function rev(author: string, state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED', ago: number, body = ''): PrFact['reviews'][number] {
  return { author, state, submittedAt: T0 - ago, body };
}

describe('S-BTN-43 a repository with no course code', () => {
  it('init then sync: four tickets on the pr course, the dependent not ready, the timeline to merged', async () => {
    expect(await init(repo.dir)).toBe(0);
    repo.commit();
    await repo.sync();
    // Four tickets from five items — the no-id file (and the .txt) are none; the done one is
    // closed as done; the one with an unknown field (T-1) is a ticket like the rest.
    expect(await rows('SELECT id, course_id FROM tickets ORDER BY id')).toEqual([
      { id: 'docs:T-1', course_id: 'create-pr' },
      { id: 'docs:T-2', course_id: 'create-pr' },
      { id: 'docs:T-3', course_id: 'create-pr' },
    ]);
    expect(await rows('SELECT ticket_id, closed_as FROM closed_tickets ORDER BY ticket_id')).toEqual([{ ticket_id: 'docs:T-0', closed_as: 'done' }, { ticket_id: 'docs:T-9', closed_as: 'done' }]);
    // The archived done dependency counts: T-3's implement is ready.
    expect((await nextOf('T-3'))[0]).toMatchObject({ leg: 'implement', state: 'ready' });
    // The dependent ticket is not ready until its dependency is done.
    expect((await stationOf('T-2'))[0]).toMatchObject({ station: 'filed', next_leg: 'implement' });
    expect((await nextOf('T-2'))[0]).toMatchObject({ state: 'waiting', waiting_on: 'dependencies' });

    // A PR opens for T-1; checks run; review waits on ci then is ready.
    repo.facts = [fact(7, 'open', [null], [])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ state: 'waiting', waiting_on: 'ci' });
    repo.facts = [fact(7, 'open', ['success'], [])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ state: 'ready', waiting_on: null });

    // A review requests changes; a fix is pushed; a review approves; the PR merges.
    repo.facts = [fact(7, 'open', ['success'], [rev('r1', 'CHANGES_REQUESTED', 100)])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
    repo.facts = [fact(7, 'open', ['success'], [rev('r1', 'CHANGES_REQUESTED', 100)], T0 - 50)];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'fixed', next_leg: 'review' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'review', state: 'ready' });
    repo.facts = [fact(7, 'open', ['success'], [rev('r1', 'CHANGES_REQUESTED', 100), rev('r1', 'APPROVED', 10)], T0 - 50)];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'merge', state: 'ready' });
    repo.facts = [fact(7, 'merged', ['success'], [rev('r1', 'CHANGES_REQUESTED', 100), rev('r1', 'APPROVED', 10)], T0 - 50)];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'merged' });

    // The item is marked done; the dependent ticket's implement turns ready.
    repo.write('tickets/first.md', '---\nid: T-1\ntitle: First\nstatus: done\n---\n');
    repo.commit();
    await repo.sync();
    expect((await stationOf('T-2'))[0]).toMatchObject({ station: 'filed', next_leg: 'implement' });
    expect((await nextOf('T-2'))[0]).toMatchObject({ state: 'ready', waiting_on: null });
  }, 60_000);

  it('--eject tickets, then an edit to the copy: the edited source’s tickets are posted', async () => {
    await init(repo.dir);
    repo.commit();
    await repo.sync();
    expect(await rows('SELECT count(*) AS n FROM tickets')).toEqual([{ n: 3 }]);
    await init(repo.dir, '--eject', 'tickets');
    const ejected = readFileSync(join(repo.dir, '.baton', 'tickets.mjs'), 'utf8');
    repo.write('.baton/tickets.mjs', ejected.replace(
      'return ticketsMarkdown(files, ctx.settings);',
      "const out = ticketsMarkdown(files, ctx.settings);\n    return { tickets: out.tickets.map((t) => (t.id === 'T-2' ? { ...t, title: 'EDITED BY HAND' } : t)), closed: out.closed };",
    ));
    repo.commit();
    await repo.sync();
    expect(await rows('SELECT id, title FROM tickets WHERE id = ?', 'docs:T-2')).toEqual([{ id: 'docs:T-2', title: 'EDITED BY HAND' }]);
  }, 60_000);

  it('one identity, comment-only verdict reviews, moves the same way; a red check makes review ready', async () => {
    await init(repo.dir);
    repo.commit();
    // The same identity authors and reviews; GitHub refuses self-approval, so the verdict is
    // the marker line a comment-only review opens with.
    repo.facts = [fact(7, 'open', ['failure'], [rev('me', 'COMMENTED', 100, '<!-- baton:verdict changes --> one thing')])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
    repo.facts = [fact(7, 'open', ['failure'], [rev('me', 'COMMENTED', 100, '<!-- baton:verdict changes --> one thing'), rev('me', 'COMMENTED', 10, '<!-- baton:verdict approve -->')], T0 - 50)];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    // The red check made review ready all along — the review reads it and asks for a fix.
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'merge', state: 'ready' });
  }, 60_000);
});

// G-BTN-69's refusals: each fails the sync before anything is posted, naming what to fix.
describe('S-BTN-43 the sync refuses, posting nothing', () => {
  const posted = async () => (await rows('SELECT count(*) AS n FROM tickets'))[0];
  // A refused run already holds its observation number; the next run is `sync-busy` until the
  // number is 10 minutes old (R-BTN-62), so each retry here moves the clock past that.
  let minutes = 0;
  const later = () => setClock(T0 + (minutes += 11) * 60_000);

  it('a course with no sync.mjs that is not a standard course, a ticket on an unlisted course, a bad stations return, no baton.json', async () => {
    mkdirSync(join(repo.dir, '.baton')); // the harness keeps its recorded facts there
    await expect(repo.sync()).rejects.toThrow('has no .baton/baton.json — run `baton repo init` first');
    await init(repo.dir);
    const settingsFile = join(repo.dir, '.baton', 'baton.json');
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));

    // A ticket on a course baton.json does not list.
    repo.write('tickets/stray.md', '---\nid: S-1\ncourse: epic\n---\n');
    repo.commit();
    await later();
    await expect(repo.sync()).rejects.toThrow('ticket S-1 is on course epic, which .baton/baton.json\'s courses do not list');
    expect(await posted()).toEqual({ n: 0 });

    // A listed course that is not a standard one, with a course file but no sync.mjs.
    mkdirSync(join(repo.dir, '.baton', 'courses', 'epic'), { recursive: true });
    writeFileSync(join(repo.dir, '.baton', 'courses', 'epic', 'course.json'), readFileSync(join(repo.dir, '.baton', 'courses', 'create-pr', 'course.json')));
    writeFileSync(settingsFile, JSON.stringify({ ...settings, courses: [...settings.courses, { id: 'epic', version: 1 }] }));
    repo.commit();
    await later();
    await expect(repo.sync()).rejects.toThrow('course epic has no sync.mjs and is not a standard course');
    expect(await posted()).toEqual({ n: 0 });

    // A station function returning a bare map instead of {stations, markers, course_data}.
    writeFileSync(join(repo.dir, '.baton', 'courses', 'epic', 'sync.mjs'), "export default { stations: () => ({ 'S-1': { station: 'filed' } }) };\n");
    repo.commit();
    await later();
    await expect(repo.sync()).rejects.toThrow('.baton/courses/epic/sync.mjs: stations(ctx) must return {stations, markers, course_data}');
    expect(await posted()).toEqual({ n: 0 });
  }, 60_000);

  it('a checkout behind the head posts nothing: a slow run for an older push never moves the board back', async () => {
    await init(repo.dir);
    const older = repo.commit();
    repo.write('tickets/fourth.md', '---\nid: T-4\ntitle: Fourth\n---\n');
    repo.commit();
    await repo.sync();
    expect(await posted()).toEqual({ n: 4 });
    execFileSync('git', ['-C', repo.dir, 'checkout', '-q', '--detach', older], { stdio: 'ignore' });
    await repo.sync();
    // The older reading (no T-4) was not posted: the head and its four tickets stand.
    expect(await posted()).toEqual({ n: 4 });
  }, 60_000);
});

describe('S-BTN-43 --latest, as the workflow runs it', () => {
  it('after its number the run fetches the newest main and posts that board, not the older checkout it started on', async () => {
    await init(repo.dir);
    repo.commit();
    // A bare origin, and a second clone that pushes one commit the local checkout lacks.
    const bare = mkdtempSync(join(tmpdir(), 'baton-s43-origin-'));
    const other = mkdtempSync(join(tmpdir(), 'baton-s43-other-'));
    try {
      execFileSync('git', ['clone', '-q', '--bare', repo.dir, bare], { stdio: 'ignore' });
      execFileSync('git', ['-C', repo.dir, 'remote', 'add', 'origin', bare], { stdio: 'ignore' });
      execFileSync('git', ['clone', '-q', bare, other], { stdio: 'ignore' });
      writeFileSync(join(other, 'tickets', 'fifth.md'), '---\nid: T-5\ntitle: Fifth\n---\n');
      for (const a of [['add', '-A'], ['-c', 'user.email=o@t', '-c', 'user.name=o', 'commit', '-qm', 'T-5'], ['push', '-q', 'origin', 'HEAD:main']]) execFileSync('git', ['-C', other, ...a], { stdio: 'ignore' });
      const newest = execFileSync('git', ['-C', other, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      await repo.sync('--latest', 'main');
      expect(await rows('SELECT id FROM tickets WHERE id = ?', 'docs:T-5')).toEqual([{ id: 'docs:T-5' }]);
      // The checkout now sits at the newest main, detached: the commit it posted.
      expect(execFileSync('git', ['-C', repo.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(newest);
    } finally {
      rmSync(bare, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  }, 60_000);
});
