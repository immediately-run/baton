// courses.test.tsx — B-212 and B-223: the Courses screens on B-197's `course.show`.
// `CourseGraph` marks a blocked leg as an edge and draws no station for it (R-BTN-126), marks a
// leg over `max_queue` with its intake as text, and gives every group a name; the list's card
// draws the header line, the table's p50 figures from the read and the refused notice; the
// course page's edge panel lists the leg's runs with the log directory as text and an unlisted
// session link as text, its station panel the resting tickets, its tickets table a second page
// by cursor; `?since=` round-trips; hostile strings stay text; and the fixture's station and leg
// names appear nowhere in the screens' source (course-agnostic).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { SCREENS } from '../../src/core/screens';
import { CourseGraph, legMark, type Picked } from '../../src/dashboard/screens/courses/CourseGraph';
import { CoursePage } from '../../src/dashboard/screens/courses/CoursePage';
import { CoursesScreen } from '../../src/dashboard/screens/courses/CoursesScreen';
import { fileLeg, type CourseAnswer, type CourseLeg, type CourseTicket } from '../../src/dashboard/screens/courses/types';
import { goTo, mockFetch, refuse, renderWithShell, repoList, repoRow, resetShell } from './helpers';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const H = 3_600_000;
const HOSTILE = '<img src=x onerror=alert(1)>';
const repos = repoList([repoRow('docs')]);
const screenOf = (id: string) => SCREENS.find((s) => s.id === id)!;
const props = (id: string, params: Record<string, string>) => ({ screen: screenOf(id), params, repository: repos.repositories[0], repos, role: 'administrator' as const });

// The fixture course: four stations, three legs and a way back. Its names are checked against
// the screens' source below, so they are words no source would hold by accident.
const STATIONS = ['zarf-drafted', 'zarf-built', 'zarf-vetted', 'zarf-landed'];
const LEGS = ['quux-build', 'quux-vet', 'quux-redo', 'quux-land'];
const FILE = {
  start: STATIONS[0], end: [STATIONS[3]],
  stations: Object.fromEntries(STATIONS.map((s) => [s, {}])),
  legs: {
    [LEGS[0]]: { from: [STATIONS[0]], to: STATIONS[1], max_queue: 2, requires: { capabilities: ['cap-make'] }, max_runs: 3, max_duration: 5400, outputs: [{ name: 'out-result' }] },
    [LEGS[1]]: { from: [STATIONS[1]], to: STATIONS[2], kind: 'person' },
    [LEGS[2]]: { from: [STATIONS[2]], to: STATIONS[1], max_runs: 2 },
    [LEGS[3]]: { from: [STATIONS[2]], to: STATIONS[3] },
  },
};
const leg = (i: number, from: number, to: number, over: Partial<CourseLeg> = {}): CourseLeg => ({
  leg: LEGS[i], from: [STATIONS[from]], to: [STATIONS[to]], queue: { depth: 0, max_queue: null, over: false, intake: 'closed' },
  state: { ready: 0, running: 0, waiting: 0, backing_off: 0, blocked: [] }, window: null, ...over,
});
const RUN = {
  run: 2, claim: 31, leg: LEGS[1], run_id: 'r_0002', ticket_id: 'docs:T-7', runner: 4, hostname: 'host-a', session_name: 's-4', from: STATIONS[1], reached: null,
  started_at: NOW - H, ended_at: null, outcome: 'running', end: null, claim_end: 'running', detail: null,
  session_url: 'https://evil.example/s/9', log_dir: '/var/log/baton/r_0002', transcripts: [{ repo: 'example-org/sessions', path: 'a/b.jsonl', role: 'session' }],
};
const ticket = (id: string, station: number, over: Partial<CourseTicket> = {}): CourseTicket => ({
  ticket_id: `docs:${id}`, title: `${id} title`, station: STATIONS[station], path: [], claim_legs: [], waits_for: null, handoff: null, blocks: [],
  backing_off_until: null, next_leg: LEGS[0], source: 'course', parent: null, children: [], ...over,
});
const course = (over: Partial<CourseAnswer> = {}): CourseAnswer => ({
  course: { id: 'course-a', version: 7, file: FILE, skill: 'a-skill', min_runner_version: 7 },
  refused: null, runners: { declaring: 5, alive: 3 }, intake: 'closed',
  legs: [
    leg(0, 0, 1, { queue: { depth: 4, max_queue: 2, over: true, intake: 'closed' }, state: { ready: 3, running: 0, waiting: 0, backing_off: 0, blocked: [] },
      window: { started: 10, finished: 8, abandoned: 2, wait_p50_s: 5400, run_p50_s: 720, fail_rate: 0.2 } }),
    leg(1, 1, 2, { state: { ready: 1, running: 1, waiting: 0, backing_off: 0, blocked: [{ kind: 'resource', found: 'during', count: 2, tickets: ['docs:T-7', 'docs:T-8'] }, { kind: 'ticket', found: 'before', count: 1, tickets: ['docs:T-9'] }] },
      window: { started: 4, finished: 4, abandoned: 0, wait_p50_s: 30, run_p50_s: 90_000, fail_rate: 0 }, runs: [RUN] }),
    leg(2, 2, 1, { state: { ready: 0, running: 0, waiting: 0, backing_off: 1, blocked: [] } }),
    leg(3, 2, 3, { state: { ready: 0, running: 1, waiting: 0, backing_off: 0, blocked: [] } }),
  ],
  stations: [
    { station: STATIONS[0], start: true, end: false, resting: 235, claimed: 0, arrived_today: 0 },
    { station: STATIONS[1], start: false, end: false, resting: 2, claimed: 1, arrived_today: 3 },
    { station: STATIONS[2], start: false, end: false, resting: 0, claimed: 1, arrived_today: 1 },
    { station: STATIONS[3], start: false, end: true, resting: 0, claimed: 0, arrived_today: 18 },
  ],
  counts: { tickets: 239 }, window: { since: NOW - 7 * 24 * H, until: NOW },
  stats: {
    course: { legs: { [LEGS[0]]: { started: 10, finished: 8, abandoned: 2, waited: { count: 10, median_s: 5400, max_s: 9000 }, ran: { count: 8, median_s: 720, max_s: 800 }, ready_now: { tickets: 3, oldest_s: 7200 }, queue: { depth: 4, max_queue: 2 } } },
      stations: { [STATIONS[1]]: { waited: { count: 2, median_s: 60, max_s: 90 } } }, intake: 'closed' },
    ends: [{ end_reason: 'released:cannot-finish:spec', detail: HOSTILE, claims: 2 }], suspensions: [{ station: STATIONS[2], detail: 'ci', claims: 1 }],
    advice_overridden: { count: 1, tickets: ['docs:T-3'] },
  },
  off_graph: { count: 1, tickets: ['docs:T-5'] }, server_time: NOW, ...over,
});

afterEach(() => {
  cleanup();
  resetShell();
});

describe('CourseGraph (B-212 item 2)', () => {
  it('marks the blocked leg as an edge, never a station, and the over-queue leg with its intake', () => {
    const c = course();
    expect(c.legs.map((l) => legMark(l))).toEqual(['ready', 'blocked', 'backing-off', 'running']);
    const picks: Picked[] = [];
    renderWithShell(<CourseGraph file={FILE} stations={c.stations} legs={c.legs} size="large" onPick={(p) => picks.push(p)} label="the course" />);
    // Four stations in four columns, and no fifth node for the blocked leg.
    const nodes = [...document.querySelectorAll('.cg-node')];
    expect(nodes.map((n) => n.getAttribute('data-station'))).toEqual(STATIONS);
    const xs = nodes.map((n) => Number(n.querySelector('circle')!.getAttribute('cx')));
    expect(new Set(xs).size).toBe(4);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(nodes.map((n) => n.querySelector('.cg-count')!.textContent)).toEqual(['235', '2', '0', '0']);
    const edges = [...document.querySelectorAll('.cg-edge')];
    expect(edges.map((e) => e.getAttribute('data-leg'))).toEqual(LEGS);
    const blocked = edges[1];
    expect(blocked.getAttribute('class')).toBe('cg-edge cg-blocked');
    expect(blocked.querySelector('.cg-label')!.textContent).toBe(`▲ ${LEGS[1]}`);
    // The counts ride the edge by shape; the legend under the drawing names each shape.
    expect(blocked.querySelector('.cg-words')!.textContent).toBe('▲ 3  ● 1  ○ 1');
    expect(screen.getByRole('list', { name: 'Legend' }).textContent).toContain('▲ blocked● running↻ backing off○ ready');
    expect(document.querySelectorAll('circle').length).toBe(5); // four stations and the end's ring
    // The leg over its bound: a marked edge with "intake closed" as text.
    expect(edges[0].getAttribute('class')).toBe('cg-edge cg-ready cg-over');
    expect(edges[0].querySelector('.cg-queue')!.textContent).toBe('queue 4 of 2 · intake closed');
    expect(edges[2].querySelector('.cg-label')!.textContent).toBe(`↻ ${LEGS[2]}`);
    expect(edges[3].querySelector('.cg-label')!.textContent).toBe(`● ${LEGS[3]}`);
    // The way back is an arc (a curve), the others straight lines.
    expect(edges.map((e) => /[CQ]/.test(e.querySelector('.cg-line')!.getAttribute('d')!))).toEqual([false, false, true, false]);
    // Every node and edge is a focusable group with an accessible name.
    for (const g of [...nodes, ...edges]) {
      expect([g.tagName.toLowerCase(), g.getAttribute('role'), g.getAttribute('tabindex')]).toEqual(['g', 'button', '0']);
      expect(g.getAttribute('aria-label')!.length).toBeGreaterThan(12);
    }
    expect(blocked.getAttribute('aria-label')).toBe(`leg ${LEGS[1]}, from ${STATIONS[1]} to ${STATIONS[2]}: blocked — 3 blocked, 1 running, 1 ready`);
    expect(nodes[3].getAttribute('aria-label')).toBe(`station ${STATIONS[3]}, an end: 0 resting, 18 arrived in 24 hours`);
    fireEvent.click(blocked);
    fireEvent.keyDown(nodes[0], { key: 'Enter' });
    expect(picks).toEqual([{ kind: 'leg', id: LEGS[1] }, { kind: 'station', id: STATIONS[0] }]);
  });

  it('draws hostile names as text, and reads a file of any shape', () => {
    const file = { start: HOSTILE, stations: { [HOSTILE]: {}, b: {} }, legs: { [`leg ${HOSTILE}`]: { from: HOSTILE, to: 'b' } } };
    renderWithShell(<CourseGraph file={file} stations={[]} legs={[]} label={HOSTILE} />);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.cg-node')!.getAttribute('aria-label')).toContain(HOSTILE);
    expect(fileLeg({ legs: { a: { requires: 'x', outputs: 7, max_runs: 'many' } } }, 'a')).toEqual({ kind: null, requires: [], maxRuns: null, maxQueue: null, timeoutS: null, outputs: [] });
    expect(fileLeg(FILE, LEGS[0])).toEqual({ kind: null, requires: ['cap-make'], maxRuns: 3, maxQueue: 2, timeoutS: 5400, outputs: ['out-result'] });
    expect(fileLeg(null, 'a').requires).toEqual([]);
  });
});

describe('the Courses list (B-212 item 3)', () => {
  it('draws a card per course from the summary: header line, small graph, the table’s figures, the refusal', async () => {
    const { calls } = mockFetch({
      '/v1/repositories/docs/courses': { courses: [{ id: 'course-a', version: 7 }, { id: 'course-b', version: null }] },
      '/v1/repositories/docs/courses/course-a?summary=1&since=7d': course({ summary: true, refused: { version: 8, reason: `oneOf is ${HOSTILE}` } }),
      '/v1/repositories/docs/courses/course-b?summary=1&since=7d': course({ summary: true, course: { id: 'course-b', version: null, file: null, skill: null, min_runner_version: null }, legs: [], stations: [], refused: { version: 1, reason: 'no start' } }),
    });
    renderWithShell(<CoursesScreen {...props('repository/courses', { repository: 'docs' })} />, { repos, now: NOW });
    await screen.findByRole('heading', { name: 'Courses' });
    await screen.findByText(/stays in force/);
    const cards = [...document.querySelectorAll('.course-card')] as HTMLElement[];
    expect(cards.length).toBe(2);
    const a = within(cards[0]);
    expect(a.getByRole('link', { name: 'course-a' }).getAttribute('href')).toBe('/repositories/docs/courses/course-a');
    expect(cards[0].querySelector('.card-aside')!.textContent).toBe('v7');
    expect(cards[0].querySelector('.course-line')!.textContent).toBe(`runners 5 declaring, 3 alive · 239 tickets on it · window 7 d · ▲ intake closed · ${STATIONS[3]} 18 in 24 h`);
    // The refused notice names the version kept; its reason is text.
    expect(cards[0].querySelector('.band')!.textContent).toContain(`version 8, was refused: oneOf is ${HOSTILE}`);
    expect(document.querySelector('img')).toBeNull();
    // The small graph: a drawing, not a control.
    expect(cards[0].querySelectorAll('.cg-node').length).toBe(4);
    expect(cards[0].querySelector('.cg-edge')!.getAttribute('role')).toBe('img');
    // The table: the read's figures, nothing computed here.
    const rows = a.getAllByRole('row');
    expect([...rows[0].querySelectorAll('th')].map((h) => h.textContent)).toEqual(['Leg', 'From → to', 'State', 'Queue', 'Requires', 'Outputs', 'Timeout', 'Max runs', 'p50 wait', 'p50 run', 'Runs', 'Fail rate']);
    expect([...rows[1].children].map((c) => c.textContent)).toEqual([LEGS[0], `${STATIONS[0]} → ${STATIONS[1]}`, '○ 3 ready', '4 of 2 ▲ intake closed', 'cap-make', 'out-result', '1.5 h', '3', '1.5 h', '12 min', '10', '20 %']);
    expect([...rows[2].children].map((c) => c.textContent).slice(2, 4)).toEqual(['▲ 3 blocked · 1 running · 1 ready', '0']);
    expect(rows[2].children[9].textContent).toBe('1 d');
    // A course whose only file was refused.
    expect(cards[1].textContent).toContain('No file of this course was ever accepted.');
    expect(cards[1].textContent).toContain('No version is in force.');
    // The summary read only: no full course read, no ticket page.
    expect(calls.map((c) => c.path).sort()).toEqual(['/v1/repositories/docs/courses', '/v1/repositories/docs/courses/course-a?summary=1&since=7d', '/v1/repositories/docs/courses/course-b?summary=1&since=7d']);
  });

  it('says so when the repository has no course', async () => {
    mockFetch({ '/v1/repositories/docs/courses': { courses: [] } });
    renderWithShell(<CoursesScreen {...props('repository/courses', { repository: 'docs' })} />, { repos });
    expect(await screen.findByText(/This repository has no course/)).toBeDefined();
  });
});

describe('the course page (B-223)', () => {
  const PAGE1 = [ticket('T-1', 0), ticket('T-2', 0, { blocks: [{ leg: '', kind: 'ticket', ref: 'docs:T-1', since: NOW, until: null }] }),
    ticket('T-7', 1, { claim_legs: [{ claim_id: 31, leg: LEGS[1], run_id: 'r_0002', from: STATIONS[1], reached: null, started_at: NOW - H, outcome: 'running' }], path: [{ leg: LEGS[0], reached: STATIONS[1] }] })];
  const PAGE2 = [ticket('T-8', 1, { handoff: HOSTILE, title: HOSTILE, path: [{ leg: LEGS[0], reached: STATIONS[1] }], waits_for: { leg: LEGS[1], on: 'ci', since: NOW }, parent: 'T-1', children: ['docs:T-9'], next_leg: LEGS[1], source: 'marker' })];
  const base = '/v1/repositories/docs/courses/course-a';

  it('opens an edge’s panel of runs and a station’s panel of resting tickets, and loads the tickets by cursor', async () => {
    const { calls } = mockFetch({
      [base]: course({ tickets: PAGE1, next_cursor: 'cur-2' }),
      [`${base}?cursor=cur-2`]: course({ tickets: PAGE2 }),
    });
    goTo('/repositories/docs/courses/course-a');
    renderWithShell(<CoursePage {...props('repository/courses/{course}', { repository: 'docs', course: 'course-a' })} />, { repos, now: NOW });
    await screen.findByRole('heading', { level: 1, name: 'Course course-a' });
    expect(document.querySelector('.cg-large')).not.toBeNull();

    // The blocked edge: its panel.
    const edge = document.querySelector(`.cg-edge[data-leg="${LEGS[1]}"]`)!;
    fireEvent.keyDown(edge, { key: 'Enter' });
    const panel = screen.getByRole('region', { name: 'The chosen leg' });
    expect(edge.getAttribute('aria-pressed')).toBe('true');
    expect(panel.textContent).toContain('kindperson');
    const blocked = within(panel).getByRole('table', { name: 'Blocked tickets of the leg, by kind and when found' });
    expect(within(blocked).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['▲ resourceduring a run2docs:T-7, docs:T-8', '▲ ticketbefore a start1docs:T-9']);
    const runs = within(panel).getByRole('table', { name: 'The leg’s runs in the window' });
    const run = within(runs).getAllByRole('row')[1];
    expect(run.textContent).toContain('2 · r_0002');
    // The runner links its page; the log directory is text beside the CLI line (R-BTN-128).
    expect(within(run).getByRole('link', { name: 'host-a / s-4' }).getAttribute('href')).toBe('/repositories/docs/runners/4');
    expect(run.textContent).toContain('/var/log/baton/r_0002');
    expect(run.textContent).toContain(`baton leg log docs:T-7 ${LEGS[1]}`);
    expect(run.textContent).toContain('example-org/sessions:a/b.jsonl');
    // An unlisted session host is drawn as a neutral label, not an address or a link.
    expect(run.textContent).not.toContain('https://evil.example/s/9');
    expect(within(run).queryByRole('link', { name: /Open leg page/ })).toBeNull();
    expect(document.querySelector('a[href^="https://evil"]')).toBeNull();

    // A station: its resting tickets, linking their pages (the claimed one is not resting).
    fireEvent.click(document.querySelector(`.cg-node[data-station="${STATIONS[0]}"]`)!);
    const station = screen.getByRole('region', { name: 'The chosen station' });
    expect(within(station).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([['docs:T-1', '/repositories/docs/tickets/T-1'], ['docs:T-2', '/repositories/docs/tickets/T-2']]);
    expect(station.textContent).toContain('Showing 2 of 235');
    fireEvent.click(document.querySelector(`.cg-node[data-station="${STATIONS[1]}"]`)!);
    expect(screen.getByRole('region', { name: 'The chosen station' }).textContent).toContain('Its resting tickets are on a page not loaded yet.');

    // The tickets table, then a second page by cursor.
    const table = screen.getByRole('table', { name: 'The tickets on the course' });
    expect(within(table).getAllByRole('row').length).toBe(1 + 3);
    expect(within(table).getAllByRole('row')[3].textContent).toContain(`${LEGS[0]} → ${STATIONS[1]}`);
    expect(within(table).getAllByRole('row')[3].textContent).toContain(`${LEGS[1]} (running)`);
    expect(screen.getByText('3 of 239 loaded')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await screen.findByText('4 of 239 loaded');
    expect(calls.map((c) => c.path)).toContain(`${base}?cursor=cur-2`);
    const last = within(table).getAllByRole('row')[4];
    // A hostile hand-off pointer and title are text; parent and children link their pages.
    expect(last.textContent).toContain(HOSTILE);
    expect(document.querySelector('img')).toBeNull();
    expect(last.textContent).toContain(`${LEGS[1]}: ci`);
    expect(last.textContent).toContain(`${LEGS[1]} (marker)`);
    expect(within(last).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/repositories/docs/tickets/T-8', '/repositories/docs/tickets/T-1', '/repositories/docs/tickets/T-9']);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    // The station panel now holds the second page's resting ticket too.
    expect(screen.getByRole('region', { name: 'The chosen station' }).textContent).toContain('docs:T-8');

    // Off-graph rows and the stats tables, as the read gives them.
    expect(screen.getByRole('heading', { name: 'Off-graph transitions' }).closest('section')!.textContent).toContain('docs:T-5');
    const waits = screen.getByRole('table', { name: 'Each leg’s wait and run times in the window' });
    expect(within(waits).getAllByRole('row')[1].textContent).toBe(`${LEGS[0]}10821.5 h (max 2.5 h, n 10)12 min (max 13 min, n 8)3 (oldest 2 h)`);
    const ends = screen.getByRole('table', { name: 'Claims ended in the window, by reason and detail' });
    expect(within(ends).getAllByRole('row')[1].textContent).toBe(`released:cannot-finish:spec${HOSTILE}2`);
    expect(screen.getByRole('table', { name: 'Suspensions in the window, by station' }).textContent).toContain(`${STATIONS[2]}ci1`);
    expect(document.body.textContent).toContain('Advice overridden: 1 — docs:T-3');
  });

  it('?since= round-trips, and an unknown course is “No such course”', async () => {
    const { calls } = mockFetch({
      [`${base}?since=3d`]: course({ tickets: [], window: { since: NOW - 3 * 24 * H, until: NOW } }),
      [`${base}?since=7d`]: course({ tickets: [] }),
      '/v1/repositories/docs/courses/nope': () => refuse('not-found'),
    });
    goTo('/repositories/docs/courses/course-a?since=3d');
    const first = renderWithShell(<CoursePage {...props('repository/courses/{course}', { repository: 'docs', course: 'course-a' })} />, { repos, now: NOW });
    await screen.findByText(/window 3 d/);
    const picker = screen.getByRole('navigation', { name: 'Window' });
    expect(within(picker).getByText('3 d').getAttribute('aria-current')).toBe('true');
    fireEvent.click(within(picker).getByText('7 d'));
    await screen.findByText(/window 7 d/);
    expect(window.location.search).toBe('?since=7d');
    expect(calls.map((c) => c.path)).toEqual([`${base}?since=3d`, `${base}?since=7d`]);
    first.unmount();
    renderWithShell(<CoursePage {...props('repository/courses/{course}', { repository: 'docs', course: 'nope' })} />, { repos });
    expect(await screen.findByRole('heading', { name: 'No such course' })).toBeDefined();
  });
});

describe('course-agnostic (B-212 item 4, B-223 item 3)', () => {
  it('no station, leg or course name of a course is a word of the screens’ source', () => {
    const root = resolve(import.meta.dirname, '../../src/dashboard');
    const files = [join(root, 'lib/courseLayout.ts'), join(root, 'lib/timeline.ts'),
      ...['courses', 'runners'].flatMap((d) => readdirSync(join(root, 'screens', d)).map((f) => join(root, 'screens', d, f)))];
    expect(files.length).toBeGreaterThan(8);
    // The fixture's own names, and the names of the courses this repository ships and tests with.
    const shipped = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/courses/roadmap-pr/course.json'), 'utf8')) as { stations: Record<string, unknown>; legs: Record<string, unknown> };
    const words = [...STATIONS, ...LEGS, 'course-a', 'roadmap-pr', ...Object.keys(shipped.stations), ...Object.keys(shipped.legs)]
      // Baton's own words for a leg's state and a claim's end are not a course's.
      .filter((w) => !['fix'].includes(w));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const w of words) expect([file.slice(root.length + 1), w, new RegExp(`(^|[^A-Za-z-])${w}([^A-Za-z-]|$)`).test(text)]).toEqual([file.slice(root.length + 1), w, false]);
    }
  });
});
