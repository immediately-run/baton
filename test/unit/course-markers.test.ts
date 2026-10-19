// course-markers.test.ts — B-28 (BATON_SPEC R-BTN-131, R-BTN-83): the marker courses' station
// function places each ticket from the closing markers its legs committed; a marker that is not an
// edge is ignored; the queued leg is the last marker's `next` when it leaves the station; the
// decision course waits on the owner's answer; `markerClose` writes, commits and pushes one line.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PostedTicket } from '../../src/core/board';
import { MARKERS_ATTRIBUTE, MARKERS_FILE, MARKER_PUSH_TRIES, bareTicketId, markerClose, parseMarkers, stationsMarkers, type Marker } from '../../src/defaults/course-markers';
import { BUG_REPORT_COURSE, DECISION_COURSE, builtIn } from '../../src/defaults/courses';

const ticket = (id: string, over: Partial<PostedTicket> & { course?: Record<string, unknown> } = {}) =>
  ({ id, course_id: 'bug-report', path: `tickets/${id}.md`, title: id, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], rank: null, ...over });
const m = (ticket: string, leg: string, reached: string, next: string | null = null): Marker => ({ ticket, leg, reached, next, claim: 'n' });
const place = (markers: Marker[], tickets = [ticket('B-1')], graph: any = BUG_REPORT_COURSE, done = new Set<string>()) =>
  stationsMarkers({ tickets, closed: new Set(), done, graph, markers }).stations;

describe('stationsMarkers (R-BTN-131)', () => {
  it('no marker: the start, its start leg ready — or waiting on a dependency not done or an open child', () => {
    expect(place([])['B-1']).toEqual({
      station: 'reported', path: [], next_leg: 'trace', next_source: 'course', handoff_url: null,
      next: [{ leg: 'trace', state: 'ready', waiting_on: null }], bars: {},
    });
    expect(place([], [ticket('B-1', { depends_on: ['B-0'] })])['B-1'].next).toEqual([{ leg: 'trace', state: 'waiting', waiting_on: 'dependencies' }]);
    expect(place([], [ticket('B-1', { depends_on: ['B-0'] })], BUG_REPORT_COURSE, new Set(['B-0']))['B-1'].next[0].state).toBe('ready');
    expect(place([], [ticket('B-1', { blocked_by: ['B-2'] })])['B-1'].next[0].waiting_on).toBe('children');
  });

  it('follows the markers in order; the queued leg is the last marker\'s next (marker), an outcome picks the branch', () => {
    const at = place([m('B-1', 'trace', 'traced', 'origin'), m('B-1', 'origin', 'explained', 'dedupe'), m('B-1', 'dedupe', 'duplicate', 'fold')])['B-1'];
    expect(at.station).toBe('duplicate');
    expect(at.path).toEqual([{ leg: 'trace', reached: 'traced' }, { leg: 'origin', reached: 'explained' }, { leg: 'dedupe', reached: 'duplicate' }]);
    expect(at).toMatchObject({ next_leg: 'fold', next_source: 'marker', next: [{ leg: 'fold', state: 'ready', waiting_on: null }] });
  });

  it('a marker that is not an edge is ignored: a leg not leaving the station, an unreachable station, another ticket\'s', () => {
    const at = place([
      m('B-1', 'origin', 'explained'), // origin does not leave `reported`
      m('B-1', 'trace', 'closed'), // trace cannot reach `closed`
      m('B-2', 'trace', 'traced'), // another ticket's
      m('B-1', 'constructor', 'traced'), // an inherited name is no leg
      m('B-1', '__proto__', 'traced'),
      m('B-1', 'trace', 'traced', 'origin'),
    ])['B-1'];
    expect(at.path).toEqual([{ leg: 'trace', reached: 'traced' }]);
    expect(at.next_leg).toBe('origin');
  });

  it('a next that does not leave the station falls back to the course file\'s first leg (course)', () => {
    expect(place([m('B-1', 'trace', 'traced', 'prevent')])['B-1']).toMatchObject({ next_leg: 'origin', next_source: 'course' });
  });

  it('an end station is done: no next leg', () => {
    const run = [m('B-1', 'trace', 'traced'), m('B-1', 'origin', 'explained'), m('B-1', 'dedupe', 'new-cause'), m('B-1', 'file', 'ticketed'), m('B-1', 'prevent', 'closed')];
    expect(place(run)['B-1']).toMatchObject({ station: 'closed', next_leg: null, next: [] });
  });

  it('a leg past its max_runs is ignored and not offered', () => {
    const graph = { start: 'a', start_leg: 'go', end: ['z'], legs: { go: { from: ['a'], to: 'b' }, again: { from: ['b'], to: 'b', max_runs: 1 }, finish: { from: ['b'], to: 'z' } } };
    const at = place([m('B-1', 'go', 'b'), m('B-1', 'again', 'b', 'again'), m('B-1', 'again', 'b', 'again')], [ticket('B-1')], graph)['B-1'];
    expect(at.path).toHaveLength(2);
    expect(at).toMatchObject({ next_leg: 'finish', next_source: 'course', next: [{ leg: 'finish', state: 'ready', waiting_on: null }] });
  });

  it('a closed ticket is not placed', () => {
    expect(stationsMarkers({ tickets: [ticket('B-1')], closed: new Set(['B-1']), graph: BUG_REPORT_COURSE, markers: [] }).stations).toEqual({});
  });

  it('decision: carry-out waits on the owner until the ticket\'s answer is set and not `open`', () => {
    const stations = builtIn('decision')!.stations;
    const ctx = (answer?: string) => ({
      tickets: [ticket('D-1', { course_id: 'decision', course: answer == null ? {} : { answer } })], closed: new Set<string>(), done: new Set<string>(),
      facts: [], markers: [m('D-1', 'prepare', 'asked', 'carry-out')], branchPatterns: [], repository: null, graph: DECISION_COURSE,
    });
    expect(stations(ctx()).stations['D-1'].next).toEqual([{ leg: 'carry-out', state: 'waiting', waiting_on: 'owner' }]);
    expect(stations(ctx('open')).stations['D-1'].next[0].waiting_on).toBe('owner');
    expect(stations(ctx('b — and keep the old flag')).stations['D-1'].next).toEqual([{ leg: 'carry-out', state: 'ready', waiting_on: null }]);
  });
});

describe('parseMarkers', () => {
  it('reads one marker a line and skips — reporting — what is not one, never throwing', () => {
    const skipped: string[] = [];
    const out = parseMarkers(['{"ticket":"B-1","leg":"trace","reached":"traced","next":"origin","claim":"n1"}', '', 'not json', '{"ticket":"B-1"}', '{"ticket":"B-2","leg":"trace","reached":"traced"}'].join('\n'), (line, why) => skipped.push(`${line}: ${why}`));
    expect(out).toEqual([{ ticket: 'B-1', leg: 'trace', reached: 'traced', next: 'origin', claim: 'n1' }, { ticket: 'B-2', leg: 'trace', reached: 'traced', next: null, claim: null }]);
    expect(skipped).toEqual(['3: not JSON', '4: no ticket, leg and reached']);
  });
});

describe('markerClose', () => {
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  /** A bare remote with one commit carrying `.baton/`, and `n` clones of it. */
  const remote = (n: number) => {
    const root = mkdtempSync(join(tmpdir(), 'baton-mclose-'));
    const bare = join(root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    const seed = join(root, 'seed');
    execFileSync('git', ['clone', '-q', bare, seed], { stdio: 'ignore' });
    mkdirSync(join(seed, '.baton'));
    writeFileSync(join(seed, '.baton', 'baton.json'), '{}\n');
    git(seed, 'config', 'user.email', 't@t');
    git(seed, 'config', 'user.name', 't');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'seed');
    git(seed, 'push', '-q', 'origin', 'main');
    const clones = Array.from({ length: n }, (_, i) => {
      const c = join(root, `c${i}`);
      execFileSync('git', ['clone', '-q', bare, c], { stdio: 'ignore' });
      git(c, 'config', 'user.email', 't@t');
      git(c, 'config', 'user.name', 't');
      return c;
    });
    return { root, bare, seed, clones };
  };

  it('writes the bare ticket id of a claim-shaped (repository-qualified) id, commits the file alone and pushes; the sync then places the ticket', async () => {
    const { root, seed, clones: [c] } = remote(1);
    try {
      const sha = await markerClose({ checkout: c, ticket: { id: 'docs:B-1', home: 'docs' }, leg: 'trace', claim: { nonce: 'n9' } }, { reached: 'traced', next: 'origin' });
      expect(sha).toBe(git(c, 'rev-parse', 'HEAD'));
      git(seed, 'pull', '-q', 'origin', 'main');
      const markers = parseMarkers(readFileSync(join(seed, MARKERS_FILE), 'utf8'));
      expect(markers).toEqual([{ ticket: 'B-1', leg: 'trace', reached: 'traced', next: 'origin', claim: 'n9' }]);
      expect(git(seed, 'log', '-1', '--format=%s')).toBe('baton:close B-1 trace');
      expect(git(seed, 'show', '--name-only', '--format=', 'HEAD')).toBe(MARKERS_FILE);
      // What the close wrote is what the station function reads.
      expect(place(markers)['B-1']).toMatchObject({ station: 'traced', next_leg: 'origin' });
      expect(bareTicketId({ id: 'B-1' })).toBe('B-1');
      expect(bareTicketId({ id: 'ops:B-1' })).toBe('B-1');
      await expect(markerClose({ checkout: c, ticket: { id: 'B-1' }, leg: 'trace' }, {})).rejects.toThrow('the trace leg returned no station reached');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('two closes racing on one remote both land: the loser rebases with the file merged by union, keeping both lines', async () => {
    const { root, seed, clones: [a, b] } = remote(2);
    try {
      await markerClose({ checkout: a, ticket: { id: 'docs:B-1', home: 'docs' }, leg: 'trace', claim: { nonce: 'a' } }, { reached: 'traced', next: 'origin' });
      // b has not fetched a's marker: its push is refused, and its rebase must not conflict.
      await markerClose({ checkout: b, ticket: { id: 'docs:B-2', home: 'docs' }, leg: 'trace', claim: { nonce: 'b' } }, { reached: 'traced', next: 'origin' });
      expect(git(b, 'status', '--porcelain')).toBe('');
      git(seed, 'pull', '-q', 'origin', 'main');
      expect(parseMarkers(readFileSync(join(seed, MARKERS_FILE), 'utf8')).map((x) => x.ticket)).toEqual(['B-1', 'B-2']);
      // The attribute lives in the checkout's own git dir, never in the repository's tree.
      expect(readFileSync(join(b, '.git', 'info', 'attributes'), 'utf8')).toContain(MARKERS_ATTRIBUTE);
      expect(git(seed, 'ls-files')).not.toContain('.gitattributes');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('only a refused push is retried, at most MARKER_PUSH_TRIES times; a rebase that stops is aborted; any other failure throws at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-mclose-'));
    mkdirSync(join(dir, '.baton'));
    const refused = Object.assign(new Error('Command failed: git push origin HEAD'), { stderr: ' ! [rejected]        HEAD -> main (fetch first)\nerror: failed to push some refs to \'origin\'' });
    const fake = (onPush: () => void, onPull: () => void = () => {}) => {
      const calls: string[] = [];
      const run = (_cmd: 'git', args: string[]) => {
        calls.push(args[0] === 'rev-parse' ? args.join(' ') : args[0] + (args[1] === '--abort' ? ' --abort' : ''));
        if (args[0] === 'push') onPush();
        if (args[0] === 'pull') onPull();
        if (args[0] === 'rev-parse') return args[1] === '--git-path' ? '.git/info/attributes' : args[1] === '--abbrev-ref' ? 'main' : 'abc123';
        return '';
      };
      return { calls, run };
    };
    const close = (run: (cmd: 'git', args: string[]) => string) => markerClose({ checkout: dir, ticket: { id: 'B-1' }, leg: 'trace' }, { reached: 'traced' }, run);
    try {
      const always = fake(() => { throw refused; });
      await expect(close(always.run)).rejects.toThrow('git push');
      expect(always.calls.filter((c) => c === 'push')).toHaveLength(MARKER_PUSH_TRIES);
      expect(always.calls.filter((c) => c === 'pull')).toHaveLength(MARKER_PUSH_TRIES - 1);

      const other = fake(() => { throw Object.assign(new Error('Command failed'), { stderr: 'fatal: could not read from remote repository' }); });
      await expect(close(other.run)).rejects.toThrow('Command failed');
      expect(other.calls.filter((c) => c === 'push' || c === 'pull')).toEqual(['push']);

      // A hook or protected branch refuses: `[remote rejected]`, with git's summary line after it.
      const declined = fake(() => { throw Object.assign(new Error('Command failed: git push origin HEAD'), { stderr: ' ! [remote rejected] HEAD -> main (pre-receive hook declined)\nerror: failed to push some refs to \'origin\'' }); });
      await expect(close(declined.run)).rejects.toThrow('git push');
      expect(declined.calls.filter((c) => c === 'push' || c === 'pull')).toEqual(['push']);

      const stops = fake(() => { throw refused; }, () => { throw new Error('could not apply'); });
      await expect(close(stops.run)).rejects.toThrow('could not apply');
      expect(stops.calls.slice(-2)).toEqual(['pull', 'rebase --abort']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
