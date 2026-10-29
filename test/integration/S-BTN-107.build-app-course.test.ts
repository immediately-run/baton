// S-BTN-107 the build-app course (BATON_SPEC §15 S-BTN-107, R-BTN-131; B-40): a fresh repository
// runs `baton repo init`, then `--course build-app`, with one request. Must hold: the request starts at
// `requested` with `define` queued; each drafting leg's successor waits on the owner until the
// ticket's `answer:` names the document it builds on, and an earlier name holds it; `file`'s
// children (tickets naming the request as `parent`) make `verify` wait on `children` until every
// one closes; a verification that files a fix child waits again, and one that passes reaches
// `shipped`. Node only: it writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { setMachineKeys } from '../../src/defaults/ticket-state';
import { ORIGIN, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-10-18T12:00:00Z');
// No --pin: the CLI pins its own commit, the one its courses' sources name (B-33).
const init = (root: string, ...argv: string[]) => initMain(argv, { root, log: () => {} });

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'baton-s107-'));
  /** The remote a leg's close pushes its ticket write to. */
  readonly remote = mkdtempSync(join(tmpdir(), 'baton-s107-remote-'));
  constructor() {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.remote], { stdio: 'ignore' });
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's107@test'], ['config', 'user.name', 's107'], ['remote', 'add', 'origin', this.remote]]) execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
  }
  write(path: string, text: string): void {
    writeFileSync(join(this.dir, path), text);
  }
  /** One close, as a marker course's `close` commits it (R-BTN-83, B-100): the leg's machine
   *  state written into the ticket's own frontmatter, committed alone under `baton:close`. */
  marker(ticket: string, leg: string, reached: string, next: string | null): void {
    const path = join(this.dir, 'tickets', `${ticket.toLowerCase()}.md`);
    const was = existsSync(path) ? readFileSync(path, 'utf8') : `---\nid: ${ticket}\ntitle: ${ticket}\n---\n\n`;
    writeFileSync(path, setMachineKeys(was, { station: reached, next_leg: next, claim: 'n' }));
    execFileSync('git', ['-C', this.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '-qm', `baton:close ${ticket} ${leg}`], { stdio: 'ignore' });
  }
  commit(): void {
    execFileSync('git', ['-C', this.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--allow-empty', '-qm', 'step'], { stdio: 'ignore' });
  }
  /** One sync through the local host; `facts` false passes no recorded facts (and no forge token). */
  async sync(facts = true): Promise<void> {
    const extra: string[] = [];
    if (facts) {
      const file = join(this.dir, '.baton', 'facts.json');
      writeFileSync(file, '[]');
      extra.push('--facts', file);
    }
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, ...extra], {});
    await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: () => {} });
  }
}

let repo: Repo;
let minutes = 0;
/** Each sync takes an observation number; the next is refused until ten minutes pass (R-BTN-62). */
const later = () => setClock(T0 + (minutes += 11) * 60_000);
beforeEach(async () => {
  minutes = 0;
  await setClock(T0);
  repo = new Repo();
});
afterEach(() => {
  rmSync(repo.dir, { recursive: true, force: true });
  rmSync(repo.remote, { recursive: true, force: true });
});

type StationRow = { station: string; next_leg: string | null; next_source: string; path_len: number };
const stationOf = async (id: string): Promise<StationRow> => (await rows<StationRow>('SELECT station, next_leg, next_source, path_len FROM ticket_stations WHERE ticket_id = ?', `docs:${id}`))[0];
const nextOf = (id: string) => rows('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${id}`);


const request = (answer?: string) =>
  `---\nid: APP-1\ntitle: An online Blokus\ncourse: build-app\n${answer ? `answer: ${answer}\n` : ''}---\n\nBuild an online version of the board game Blokus.\n`;
const child = (n: number, status?: string) =>
  `---\nid: APP-1-${n}\ntitle: APP-1-${n} — slice ${n}\nparent: APP-1\ncourse: create-pr\norder: ${n}\n${status ? `status: ${status}\n` : ''}---\n`;
const step = async () => {
  repo.commit();
  await later();
  await repo.sync();
};

describe('S-BTN-107 the build-app course', () => {
  it('drafts wait on the owner stage by stage; the filed children hold verify; a failed verification waits on its fix', async () => {
    // create-pr first, as a repository adopting build-app does: the children run on it.
    expect(await init(repo.dir)).toBe(0);
    expect(await init(repo.dir, '--course', 'build-app')).toBe(0);
    repo.write('tickets/app-1.md', request());
    repo.commit();
    await repo.sync();
    expect(await stationOf('APP-1')).toMatchObject({ station: 'requested', next_leg: 'define', path_len: 0 });
    expect(await nextOf('APP-1')).toEqual([{ leg: 'define', state: 'ready', waiting_on: null }]);

    // define drafts PRODUCT.md; design waits until the owner approves it.
    repo.marker('APP-1', 'define', 'defined', 'design');
    await step();
    expect(await stationOf('APP-1')).toMatchObject({ station: 'defined', next_leg: 'design', next_source: 'marker' });
    expect(await nextOf('APP-1')).toEqual([{ leg: 'design', state: 'waiting', waiting_on: 'owner' }]);
    repo.write('tickets/app-1.md', request('define'));
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'design', state: 'ready', waiting_on: null }]);

    // design drafts; the define approval does not open architect.
    repo.marker('APP-1', 'design', 'designed', 'architect');
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'architect', state: 'waiting', waiting_on: 'owner' }]);
    repo.write('tickets/app-1.md', request('design'));
    repo.marker('APP-1', 'architect', 'architected', 'plan');
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'plan', state: 'waiting', waiting_on: 'owner' }]);
    repo.write('tickets/app-1.md', request('architect'));
    repo.marker('APP-1', 'plan', 'planned', 'file');
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'file', state: 'waiting', waiting_on: 'owner' }]);
    repo.write('tickets/app-1.md', request('plan'));
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'file', state: 'ready', waiting_on: null }]);

    // file writes two children on the default course; verify waits on them.
    repo.write('tickets/app-1-1.md', child(1));
    repo.write('tickets/app-1-2.md', child(2));
    repo.marker('APP-1', 'file', 'building', 'verify');
    await step();
    expect(await stationOf('APP-1')).toMatchObject({ station: 'building', next_leg: 'verify', path_len: 5 });
    expect(await nextOf('APP-1')).toEqual([{ leg: 'verify', state: 'waiting', waiting_on: 'children' }]);
    expect(await rows('SELECT id, course_id FROM tickets WHERE id LIKE ? ORDER BY id', 'docs:APP-1-%')).toEqual([
      { id: 'docs:APP-1-1', course_id: 'create-pr' }, { id: 'docs:APP-1-2', course_id: 'create-pr' },
    ]);
    repo.write('tickets/app-1-1.md', child(1, 'done'));
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'verify', state: 'waiting', waiting_on: 'children' }]);
    repo.write('tickets/app-1-2.md', child(2, 'done'));
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'verify', state: 'ready', waiting_on: null }]);

    // The first verification files a fix and waits on it; the second passes.
    repo.write('tickets/app-1-3.md', child(3));
    repo.marker('APP-1', 'verify', 'building', 'verify');
    await step();
    expect(await stationOf('APP-1')).toMatchObject({ station: 'building', next_leg: 'verify', path_len: 6 });
    expect(await nextOf('APP-1')).toEqual([{ leg: 'verify', state: 'waiting', waiting_on: 'children' }]);
    repo.write('tickets/app-1-3.md', child(3, 'done'));
    await step();
    expect(await nextOf('APP-1')).toEqual([{ leg: 'verify', state: 'ready', waiting_on: null }]);
    repo.marker('APP-1', 'verify', 'shipped', null);
    await step();
    expect(await stationOf('APP-1')).toMatchObject({ station: 'shipped', next_leg: null, path_len: 7 });
    expect(await nextOf('APP-1')).toEqual([]);
  }, 180_000);
});
