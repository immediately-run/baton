// course-markers.test.ts — B-28 (BATON_SPEC R-BTN-131, R-BTN-83): the marker courses' station
// function places each ticket from the closing markers its legs committed; a marker that is not an
// edge is ignored; the queued leg is the last marker's `next` when it leaves the station; the
// decision course waits on the owner's answer; `markerClose` writes, commits and pushes one line.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PostedTicket } from '../../src/core/board';
import { MARKERS_FILE, markerClose, parseMarkers, stationsMarkers, type Marker } from '../../src/defaults/course-markers';
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
  it('appends the marker, commits it alone and pushes; a refused push is rebased and pushed once more', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-mclose-'));
    mkdirSync(join(dir, '.baton'));
    try {
      const calls: string[] = [];
      let pushes = 0;
      const run = (_cmd: 'git', args: string[]) => {
        calls.push(args.join(' '));
        if (args[0] === 'push' && pushes++ === 0) throw new Error('rejected');
        if (args[0] === 'rev-parse') return args[1] === '--abbrev-ref' ? 'main' : 'abc123';
        return '';
      };
      const sha = await markerClose({ checkout: dir, ticket: { id: 'B-1' }, leg: 'trace', claim: { nonce: 'n9' } }, { reached: 'traced', next: 'origin' }, run);
      expect(sha).toBe('abc123');
      expect(parseMarkers(readFileSync(join(dir, MARKERS_FILE), 'utf8'))).toEqual([{ ticket: 'B-1', leg: 'trace', reached: 'traced', next: 'origin', claim: 'n9' }]);
      expect(calls).toEqual([`add ${MARKERS_FILE}`, 'commit --no-gpg-sign -m baton:close B-1 trace', 'push origin HEAD', 'rev-parse --abbrev-ref HEAD', 'pull --rebase origin main', 'push origin HEAD', 'rev-parse HEAD']);
      await expect(markerClose({ checkout: dir, ticket: { id: 'B-1' }, leg: 'trace' }, {}, run)).rejects.toThrow('the trace leg returned no station reached');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
