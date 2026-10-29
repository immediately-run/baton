// S-BTN-175 the request (BATON_SPEC §15 S-BTN-175, R-BTN-131, R-BTN-74, §6.1; B-98): a fresh
// repository runs `baton repo init --course create-spec`, and its request is filed the way an
// operator files one — `baton request "<one sentence>" --course create-spec`, through the CLI's own
// entry, which commits the ticket and pushes it to the default branch. Must hold: the ticket lands
// as one commit on the bare origin's main, the sentence as its title and description, `course:
// create-spec`, `available`, `tags: [request]`; the next sync posts it to the board at the course's
// start station, `requested`, with its start leg `converse` ready; and a runner's claim offers
// `converse` — the course started from one sentence, no hand-written ticket. Node only: it writes a
// real repository and runs git and the CLI.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';
import { ORIGIN, claimItem, cutover, register, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-10-28T12:00:00Z');
// The CLI's own entry, as an operator runs it.
const CLI = resolve(import.meta.dirname, '..', '..', 'cli', 'baton.mjs');
// No --pin: the CLI pins its own commit, the one its courses' sources name (B-33).
const init = (root: string, ...argv: string[]) => initMain(argv, { root, log: () => {} });

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'baton-s175-'));
  /** The bare origin the request pushes to — what the sync workflow's checkout is level with. */
  readonly bare = mkdtempSync(join(tmpdir(), 'baton-s175-origin-'));
  constructor() {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.bare], { stdio: 'ignore' });
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's175@test'], ['config', 'user.name', 's175'], ['remote', 'add', 'origin', this.bare]]) {
      execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
    }
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
  }
  git(...a: string[]): string {
    return execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8' }).trim();
  }
  /** The scaffold and the fixtures' first ticket, committed and pushed to the origin's main. */
  publish(): void {
    this.git('add', '-A');
    this.git('commit', '-qm', 'scaffold');
    this.git('push', '-q', 'origin', 'HEAD:main');
  }
  /** `baton request` as an operator runs it: the CLI's entry, the checkout as its home. */
  request(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
    const out = spawnSync(process.execPath, [CLI, 'request', ...argv], { cwd: this.dir, encoding: 'utf8', env: { ...process.env, BATON_HOME: this.dir } });
    return { status: out.status, stdout: out.stdout, stderr: out.stderr };
  }
  /** The sync as the workflow runs it: a checkout of the default branch (what the request pushed),
   *  with recorded facts and the harness's sync credential. */
  async sync(): Promise<void> {
    this.git('fetch', '-q', 'origin');
    this.git('checkout', '-q', '--detach', 'origin/main');
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, '[]');
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts], {});
    const log: string[] = [];
    const code = await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: (l) => log.push(l) });
    if (code !== 0) throw new Error(`sync exited ${code}: ${log.join('\n')}`);
  }
}

let repo: Repo | null;
let minutes = 0;
/** The repository a run works in, or null in a runtime that writes none: this scenario mkdtemps,
 *  pushes and spawns the CLI, so the Workers runtime — which has neither (`node:fs` is a stub
 *  there) — skips it (R-BTN-29, S-BTN-31) instead of failing on them. Asked by the call itself:
 *  `tryMkdtemp` is node's own in Node, and throws on the Workers runtime's stub. */
const onNode = (): Repo | null => {
  try {
    return new Repo();
  } catch {
    return null;
  }
};
/** Each sync takes an observation number; the next is refused until ten minutes pass (R-BTN-62). */
const later = () => setClock(T0 + (minutes += 11) * 60_000);
beforeEach(async () => {
  minutes = 0;
  await setClock(T0);
  repo = onNode();
});
afterEach(() => {
  if (!repo) return;
  rmSync(repo.dir, { recursive: true, force: true });
  rmSync(repo.bare, { recursive: true, force: true });
});

type StationRow = { station: string; next_leg: string | null; next_source: string; path_len: number };
const stationOf = async (id: string): Promise<StationRow> => (await rows<StationRow>('SELECT station, next_leg, next_source, path_len FROM ticket_stations WHERE ticket_id = ?', `docs:${id}`))[0];
const nextOf = (id: string) => rows<{ leg: string; state: string; waiting_on: string | null }>('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${id}`);

const SENTENCE = 'Decide the export format, so two implementations agree';

describe('S-BTN-175 the request', () => {
  it('one sentence, one commit on the default branch: the board places it at create-spec’s start with converse ready, and a claim offers converse', async () => {
    if (repo === null) return; // the Workers runtime: no repository, and nothing this scenario tests
    expect(await init(repo.dir, '--course', 'create-spec')).toBe(0);
    repo.publish();
    const before = repo.git('rev-parse', 'HEAD');

    // The request, as an operator files it.
    const filed = repo.request(SENTENCE, '--course', 'create-spec');
    expect(filed).toMatchObject({ status: 0, stderr: '' });
    expect(filed.stdout).toBe('baton request: filed B-1 (course create-spec) — the next claim starts converse at requested\n');

    // One commit on the origin's main, on top of the scaffold, the ticket file and nothing else —
    // and the caller's own branch, HEAD and tree untouched by it.
    const published = execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
    expect(execFileSync('git', ['-C', repo.bare, 'rev-parse', 'main^'], { encoding: 'utf8' }).trim()).toBe(before);
    expect(execFileSync('git', ['-C', repo.bare, 'show', '--name-only', '--format=%s', published], { encoding: 'utf8' }).trim().split('\n'))
      .toEqual(['B-1: request — Decide the export format, so two implementations agree — create-spec', '', 'tickets/B-1.mdx']);
    expect(repo.git('rev-parse', 'HEAD')).toBe(before);
    // The file is the markdown source's ticket, the sentence its title and description.
    const text = execFileSync('git', ['-C', repo.bare, 'show', 'main:tickets/B-1.mdx'], { encoding: 'utf8' });
    expect(parseFrontmatter(text)).toMatchObject({ id: 'B-1', course: 'create-spec', status: 'available', tags: ['request'], title: `B-1 — ${SENTENCE}`, description: SENTENCE });

    // The next sync posts it at the course's start, its start leg ready — the next claim starts `converse`.
    await later();
    await repo.sync();
    expect(await rows('SELECT id, course_id FROM tickets')).toEqual([{ id: 'docs:B-1', course_id: 'create-spec' }]);
    expect(await stationOf('B-1')).toMatchObject({ station: 'requested', next_leg: 'converse', next_source: 'course', path_len: 0 });
    expect(await nextOf('B-1')).toEqual([{ leg: 'converse', state: 'ready', waiting_on: null }]);

    // A runner's claim offers `converse`: the course starts, from one sentence.
    await cutover();
    const w1 = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-spec', version: 1 }] });
    const { status, json } = await claimItem('vm-a', w1.secret);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ticket_id: 'docs:B-1', station: 'requested', legs: ['converse'] });
  }, 120_000);
});
