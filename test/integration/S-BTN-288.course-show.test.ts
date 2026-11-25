// S-BTN-288 one course (B-197; BATON_SPEC §5.2 R-BTN-69, §5.3 R-BTN-83, §5.4 R-BTN-79, §6.2
// R-BTN-126, §14): `GET /v1/repositories/{repository}/courses/{course}` (`course.show`) joins a
// course's file, its legs' queues and states, its stations, its tickets a page at a time and
// the window's runs and stats. Must hold:
//   1. `course` is the file as last accepted with its version, `refused` the newer version
//      Baton refused, `runners` those declaring the course and how many are alive;
//   2. each leg carries its queue against `max_queue` — `over` and the course's closed intake —
//      and the counts of tickets ready, running, waiting, backing off and blocked by kind and
//      whether the block was found before a start or during a run;
//   3. each station carries its resting and claimed tickets and those that arrived in 24 hours;
//   4. the tickets come 100 a page by cursor, ordered by station in the file's order and then
//      Baton's, each with its path, the live claim's legs, what it waits for, its hand-off
//      pointer, blocks, queued leg and source, parent and children; the legs' and stations'
//      counts are over every ticket, the same on both pages;
//   5. a leg's `runs` are the window's, with the runner, the run id, the session link and the
//      log directory as stored; `?since=` bounds them; `stats` and `off_graph` are `stats`'s;
//   6. a session and an owner key read the same answer.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ORIGIN, sessionCall, withCore } from '../helpers';
import { signedRequest } from '../lib/sshKeys';
import { courseFixture, FILE, H, MANY, type CourseFixture } from '../lib/courseFixture';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
type Json = Record<string, any>;

let f: CourseFixture;

async function show(query = ''): Promise<{ status: number; json: Json }> {
  const res = await sessionCall(f.cookie, `/v1/repositories/docs/courses/roadmap-pr${query}`);
  return { status: res.status, json: (await res.json()) as Json };
}
const legOf = (answer: Json, leg: string): Json => (answer.legs as Json[]).find((l) => l.leg === leg)!;
const stationOf = (answer: Json, station: string): Json => (answer.stations as Json[]).find((s) => s.station === station)!;

beforeEach(async () => {
  f = await courseFixture(T0);
});

describe('S-BTN-288 one course, joined (B-197)', () => {
  it('the file, the refusal, the legs’ queues and states, the stations, the paged tickets, the runs and the stats', async () => {
    const { status, json } = await show();
    expect(status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(['counts', 'course', 'intake', 'legs', 'next_cursor', 'off_graph', 'refused', 'runners', 'server_time', 'stations', 'stats', 'tickets', 'window']);
    expect(json.course).toMatchObject({ id: 'roadmap-pr', version: 3, skill: 'next-roadmap-item', min_runner_version: 3 });
    expect(json.course.file).toEqual(FILE);
    expect(json.refused).toMatchObject({ version: 4, refused_at: T0 });
    expect(json.refused.reason).toMatch(/oneOf/);
    // Two runners declare the course; the one last seen three hours ago holds no lease.
    expect(json.runners).toEqual({ declaring: 2, alive: 1 });
    expect(json.window).toEqual({ since: T0 - 24 * H, until: T0 });
    expect(json.counts).toEqual({ tickets: MANY + 6 });

    // The legs, in the file's order, with from and to as lists.
    expect((json.legs as Json[]).map((l) => l.leg)).toEqual(Object.keys(FILE.legs));
    const implement = legOf(json, 'implement');
    expect(implement).toMatchObject({ from: ['filed'], to: ['pr-open'] });
    expect(implement.queue.max_queue).toBe(1);
    expect(implement.queue.depth).toBeGreaterThan(1);
    expect(implement.queue).toMatchObject({ over: true, intake: 'closed' });
    expect(json.intake).toBe('closed');
    expect(implement.state).toEqual({
      ready: MANY + 1, running: 1, waiting: 0, backing_off: 0,
      blocked: [
        { kind: 'resource', found: 'during', count: 1, tickets: ['docs:D1'] },
        { kind: 'ticket', found: 'before', count: 1, tickets: ['docs:A2'] },
      ],
    });
    expect(legOf(json, 'review')).toMatchObject({ from: ['pr-open', 'fixed'], to: ['reviewed'], queue: { over: false, intake: 'closed' } });
    expect(legOf(json, 'review').state).toEqual({ ready: 2, running: 0, waiting: 0, backing_off: 0, blocked: [] });
    expect(legOf(json, 'fix').state).toEqual({ ready: 0, running: 0, waiting: 1, backing_off: 0, blocked: [] });

    // The stations, in the file's order.
    expect((json.stations as Json[]).map((s) => s.station)).toEqual(Object.keys(FILE.stations));
    expect(stationOf(json, 'filed')).toEqual({ station: 'filed', start: true, end: false, resting: MANY + 2, claimed: 1, arrived_today: 0 });
    expect(stationOf(json, 'pr-open')).toEqual({ station: 'pr-open', start: false, end: false, resting: 2, claimed: 0, arrived_today: 1 });
    expect(stationOf(json, 'reviewed')).toMatchObject({ resting: 1 });
    expect(stationOf(json, 'merged')).toMatchObject({ end: true, resting: 0, arrived_today: 0 });

    // The first page: 100 tickets at the first station, in Baton's order.
    const first = json.tickets as Json[];
    expect(first.length).toBe(100);
    expect(first.every((t) => t.station === 'filed')).toBe(true);
    expect(first.slice(0, 4).map((t) => t.ticket_id)).toEqual(['docs:A1', 'docs:A2', 'docs:D1', 'docs:T-001']);
    expect(Object.keys(first[0]).sort()).toEqual(['backing_off_until', 'blocks', 'children', 'claim_legs', 'handoff', 'next_leg', 'parent', 'path', 'source', 'station', 'ticket_id', 'title', 'waits_for']);
    expect(first[0]).toMatchObject({ title: 'A1 — a fixture ticket', path: [], claim_legs: [], waits_for: null, handoff: null, blocks: [], next_leg: 'implement', source: 'marker', parent: null, children: [] });
    expect(first[1].blocks).toEqual([{ leg: '', kind: 'ticket', ref: 'docs:A1', since: T0, until: null }]);
    expect(first[2].claim_legs).toEqual([{ claim_id: f.running.claim_id, leg: 'implement', run_id: expect.stringMatching(/^r_/), from: 'filed', reached: null, started_at: T0, outcome: 'running' }]);
    expect(typeof json.next_cursor).toBe('string');

    // The second page: the rest, and the same counts — they are the whole's, not the page's.
    const second = await show(`?cursor=${encodeURIComponent(json.next_cursor)}`);
    expect(second.status).toBe(200);
    const rest = second.json.tickets as Json[];
    expect(rest.length).toBe(MANY + 6 - 100);
    expect('next_cursor' in second.json).toBe(false);
    expect(rest.map((t) => t.station).filter((s, i, all) => all.indexOf(s) === i)).toEqual(['filed', 'pr-open', 'reviewed']);
    expect(new Set([...first, ...rest].map((t) => t.ticket_id)).size).toBe(MANY + 6);
    expect(second.json.legs.map((l: Json) => l.state)).toEqual(json.legs.map((l: Json) => l.state));
    expect(second.json.stations).toEqual(json.stations);
    const b1 = rest.find((t) => t.ticket_id === 'docs:B1')!;
    expect(b1).toMatchObject({ station: 'pr-open', path: [{ leg: 'implement', reached: 'pr-open' }], handoff: 'https://example.com/handoff/B1', next_leg: 'review' });
    const c1 = rest.find((t) => t.ticket_id === 'docs:C1')!;
    expect(c1.path).toEqual([{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }]);
    expect(c1.waits_for).toMatchObject({ leg: 'fix', on: 'ci' });

    // The window's runs of the first leg, newest first: the running one, and the one that
    // finished three hours ago.
    const runs = implement.runs as Json[];
    expect(runs.map((r) => [r.ticket_id, r.outcome, r.claim_end])).toEqual([['docs:D1', 'running', 'running'], ['docs:E1', 'finished', 'released']]);
    expect(runs[0]).toMatchObject({ run: 1, claim: f.running.claim_id, runner: f.running.runner, hostname: 'vm-a', session_name: 's-vm-a', leg: 'implement', from: 'filed', reached: null,
      started_at: T0, ended_at: null, end: null, session_url: null, log_dir: null, transcripts: [] });
    expect(runs[0].run_id).toMatch(/^r_/);
    expect(runs[1]).toMatchObject({ claim: f.finished.claim_id, runner: f.finished.runner, reached: 'pr-open', started_at: T0 - 3 * H, ended_at: T0 - 3 * H, end: 'released:requested' });
    expect((legOf(json, 'review').runs as Json[]).map((r) => r.outcome)).toEqual(['abandoned']);
    expect(legOf(json, 'merge').runs).toEqual([]);

    // `stats` and `off_graph` are `GET …/stats`'s for the same window.
    const stats = (await (await sessionCall(f.cookie, `/v1/repositories/docs/stats?since=${encodeURIComponent(new Date(T0 - 24 * H).toISOString())}`)).json()) as Json;
    expect(json.stats.course.legs).toEqual(stats.courses['roadmap-pr'].legs);
    expect(json.stats.ends).toEqual(stats.ends);
    expect(json.off_graph).toEqual({ count: 1, tickets: ['docs:C1'] });
    expect(json.off_graph).toEqual(stats.off_graph);
    expect(implement.window).toEqual({ started: 2, finished: 1, abandoned: 0, wait_p50_s: expect.anything(), run_p50_s: 0, fail_rate: 0 });

    // `?since=` bounds the runs: two hours back holds the running one alone.
    const narrow = await show('?since=2h');
    expect(narrow.status).toBe(200);
    expect(narrow.json.window).toEqual({ since: T0 - 2 * H, until: T0 });
    expect((legOf(narrow.json, 'implement').runs as Json[]).map((r) => r.ticket_id)).toEqual(['docs:D1']);
    expect(legOf(narrow.json, 'review').runs).toEqual([]);
    expect(legOf(narrow.json, 'implement').window.started).toBe(1);

    // An owner key reads the same answer (R-BTN-179), under its own cursor.
    const created = Math.floor((await withCore((c) => c.now())) / 1000);
    const keyed = (await (await hostCall(await signedRequest(f.owner, `${ORIGIN}/v1/repositories/docs/courses/roadmap-pr`, { created }))).json()) as Json;
    const { next_cursor: _a, ...mine } = json;
    const { next_cursor: _b, ...theirs } = keyed;
    expect(theirs).toEqual(mine);
  });
});
