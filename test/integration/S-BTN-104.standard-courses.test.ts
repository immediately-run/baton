// S-BTN-104 the standard courses (BATON_SPEC §13a S-BTN-104, R-BTN-131; B-28): a fresh repository
// runs `baton repo init`, then `--course bug-report` and `--course decision`, with three tickets —
// one on each — and syncs with no course code of its own. The bug report's legs commit their
// closing markers to `.baton/markers.jsonl`; the decision's owner answers in the ticket's
// `answer:`. Must hold: each ticket starts at its course's start with its start leg queued; the
// bug report follows its markers to `closed` (a marker that is not an edge, and a malformed line,
// change nothing; the first marker written by the real close from a claim-shaped ticket id), its
// queued leg the marker's `next`; the decision's `carry-out` waits on the
// owner until `answer:` is set; a repository on the marker courses alone syncs with no forge
// facts at all. Node only: it writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { markerClose } from '../../src/defaults/course-markers';
import { ORIGIN, rows, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-10-18T12:00:00Z');
// No --pin: the CLI pins its own commit, the one its courses' sources name (B-33).
const init = (root: string, ...argv: string[]) => initMain(argv, { root, log: () => {} });

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'baton-s104-'));
  /** The remote a leg's close pushes its marker to. */
  readonly remote = mkdtempSync(join(tmpdir(), 'baton-s104-remote-'));
  constructor() {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.remote], { stdio: 'ignore' });
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 's104@test'], ['config', 'user.name', 's104'], ['remote', 'add', 'origin', this.remote]]) execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
  }
  write(path: string, text: string): void {
    writeFileSync(join(this.dir, path), text);
  }
  /** One closing marker, as a marker course's `close` commits it (R-BTN-83). */
  marker(ticket: string, leg: string, reached: string, next: string | null): void {
    appendFileSync(join(this.dir, '.baton', 'markers.jsonl'), `${JSON.stringify({ ticket, leg, reached, next, claim: 'n' })}\n`);
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

describe('S-BTN-104 the standard courses', () => {
  it('create-pr, bug-report and decision side by side: each from its start; the bug report by its markers; the decision on its answer', async () => {
    expect(await init(repo.dir)).toBe(0);
    expect(await init(repo.dir, '--course', 'bug-report')).toBe(0);
    expect(await init(repo.dir, '--course', 'decision')).toBe(0);
    repo.write('tickets/t1.md', '---\nid: T-1\ntitle: Build it\n---\n');
    repo.write('tickets/b1.md', '---\nid: B-1\ntitle: The save button does nothing\ncourse: bug-report\n---\n');
    repo.write('tickets/d1.md', '---\nid: D-1\ntitle: Which prevention?\ncourse: decision\n---\n');
    repo.commit();
    await repo.sync();
    expect(await rows('SELECT id, course_id FROM tickets ORDER BY id')).toEqual([
      { id: 'docs:B-1', course_id: 'bug-report' }, { id: 'docs:D-1', course_id: 'decision' }, { id: 'docs:T-1', course_id: 'create-pr' },
    ]);
    expect(await stationOf('T-1')).toMatchObject({ station: 'filed', next_leg: 'implement', next_source: 'course' });
    expect(await stationOf('B-1')).toMatchObject({ station: 'reported', next_leg: 'trace', next_source: 'course', path_len: 0 });
    expect(await stationOf('D-1')).toMatchObject({ station: 'raised', next_leg: 'prepare' });

    // The bug report's first two legs close — the first through the real close, with the claim's
    // repository-qualified id — then a marker that is no edge and a malformed line.
    execFileSync('git', ['-C', repo.dir, 'push', '-q', 'origin', 'main'], { stdio: 'ignore' });
    await markerClose({ checkout: repo.dir, ticket: { id: 'docs:B-1', home: 'docs' }, leg: 'trace', claim: { nonce: 'n1' } }, { reached: 'traced', next: 'origin' });
    repo.marker('B-1', 'origin', 'explained', 'dedupe');
    repo.marker('B-1', 'prevent', 'closed', null); // prevent does not leave `explained`
    appendFileSync(join(repo.dir, '.baton', 'markers.jsonl'), 'not a marker\n');
    repo.marker('D-1', 'prepare', 'asked', 'carry-out');
    repo.commit();
    await later();
    await repo.sync();
    expect(await stationOf('B-1')).toMatchObject({ station: 'explained', next_leg: 'dedupe', next_source: 'marker', path_len: 2 });
    expect(await stationOf('D-1')).toMatchObject({ station: 'asked', next_leg: 'carry-out' });
    expect(await nextOf('D-1')).toEqual([{ leg: 'carry-out', state: 'waiting', waiting_on: 'owner' }]);

    // The owner answers; the bug report is a duplicate, folded, and its prevention weighed.
    repo.write('tickets/d1.md', '---\nid: D-1\ntitle: Which prevention?\ncourse: decision\nanswer: b\n---\n');
    repo.marker('B-1', 'dedupe', 'duplicate', 'fold');
    repo.commit();
    await later();
    await repo.sync();
    expect(await nextOf('D-1')).toEqual([{ leg: 'carry-out', state: 'ready', waiting_on: null }]);
    expect(await stationOf('B-1')).toMatchObject({ station: 'duplicate', next_leg: 'fold' });
    repo.marker('B-1', 'fold', 'folded', 'prevent');
    repo.marker('B-1', 'prevent', 'closed', null);
    repo.commit();
    await later();
    await repo.sync();
    expect(await stationOf('B-1')).toMatchObject({ station: 'closed', next_leg: null, path_len: 5 });
    expect(await nextOf('B-1')).toEqual([]);
  }, 120_000);

  it('a repository on the marker courses alone syncs with no forge facts and no token', async () => {
    expect(await init(repo.dir, '--course', 'draft-ticket')).toBe(0);
    const settings = JSON.parse(readFileSync(join(repo.dir, '.baton', 'baton.json'), 'utf8'));
    expect(settings.courses.map((c: { id: string }) => c.id)).toEqual(['draft-ticket']);
    repo.write('tickets/r1.md', '---\nid: R-1\ntitle: File the export ticket\ncourse: draft-ticket\n---\n');
    repo.commit();
    const token = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      await repo.sync(false);
    } finally {
      if (token != null) process.env.GITHUB_TOKEN = token;
    }
    expect(await stationOf('R-1')).toMatchObject({ station: 'requested', next_leg: 'research' });
  }, 60_000);
});
