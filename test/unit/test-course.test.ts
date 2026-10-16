// test-course.test.ts — `baton test-course` (BATON_SPEC §2d, R-BTN-64, R-BTN-65; R3-1248): the kit
// over docs' real roadmap-pr course passes, and over each broken variant fails naming its rule —
// a course file the core refuses, a removal that leaves min_worker_version, leg scripts that do
// not pair with the legs, and a live ticket the proposed file would move back. Node only: it runs
// the local host.
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCourse, readInputs, removed, shortestRoute, type KitInput } from '../../src/local/testCourse';
import { graphOf } from '../../src/core/graph';

const DOCS = join(import.meta.dirname, '../fixtures/courses/roadmap-pr/course.json'); // docs' .baton course, verbatim
const roadmapPr = JSON.parse(readFileSync(DOCS, 'utf8'));
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const input = (over: Partial<KitInput> = {}): KitInput => ({
  course: 'roadmap-pr', proposed: roadmapPr, base: roadmapPr, proposedVersions: { version: 3, min_worker_version: 3 }, baseVersions: { version: 3, min_worker_version: 3 },
  legScripts: null, live: [], ...over,
});
const { adjudicate: _a, ...legsWithout } = roadmapPr.legs;
const { adjudicated: _s, ...stationsWithout } = roadmapPr.stations;
const WITHOUT_ADJUDICATE = { ...roadmapPr, stations: stationsWithout, legs: { ...legsWithout, merge: { ...legsWithout.merge, from: ['reviewed'] } } };

describe('baton test-course', () => {
  it('docs’ roadmap-pr passes: the core accepts it, and a ticket runs its shortest route to a confirmed done', async () => {
    expect(shortestRoute(graphOf(roadmapPr))!.map((s) => s.leg)).toEqual(['implement', 'review', 'merge']);
    expect(await checkCourse(input({ live: [{ id: 'T-1', path: [{ leg: 'implement', reached: 'pr-open' }] }] }))).toEqual([]);
  }, 60_000);

  it('a file the core refuses — a loop no leg bounds — fails naming the course rule', async () => {
    const loop = { ...roadmapPr, stations: { ...roadmapPr.stations, parked: { label: 'Parked' } },
      legs: { ...roadmapPr.legs, park: { from: ['reviewed'], to: 'parked' }, unpark: { from: ['parked'], to: 'reviewed' } } };
    const v = await checkCourse(input({ proposed: loop }));
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.rule === 'course')).toBe(true);
  }, 60_000);

  it('a removal that leaves min_worker_version fails; raising it passes; a rename is no removal', async () => {
    expect(removed(roadmapPr, WITHOUT_ADJUDICATE)).toEqual({ stations: ['adjudicated'], legs: ['adjudicate'] });
    const { fix, ...others } = roadmapPr.legs;
    expect(removed(roadmapPr, { ...roadmapPr, legs: { ...others, address: { ...fix, renamed_from: 'fix' } } })).toEqual({ stations: [], legs: [] });
    const v = await checkCourse(input({ proposed: WITHOUT_ADJUDICATE, proposedVersions: { version: 4, min_worker_version: 3 } }));
    expect(v).toEqual([expect.objectContaining({ rule: 'min-worker-version', message: expect.stringContaining('station adjudicated, leg adjudicate') })]);
    expect(await checkCourse(input({ proposed: WITHOUT_ADJUDICATE, proposedVersions: { version: 4, min_worker_version: 4 } }))).toEqual([]);
    // with no versions known, a removal cannot be shown safe
    expect(await checkCourse(input({ proposed: WITHOUT_ADJUDICATE, proposedVersions: null }))).toEqual([expect.objectContaining({ rule: 'min-worker-version' })]);
  }, 60_000);

  it('leg scripts that do not pair one to one with the legs fail', async () => {
    const legs = Object.keys(roadmapPr.legs);
    expect(await checkCourse(input({ legScripts: legs }))).toEqual([]);
    const v = await checkCourse(input({ legScripts: [...legs.filter((l) => l !== 'fix'), 'deploy'] }));
    expect(v.map((x) => [x.rule, x.message])).toEqual([['legs-scripts', 'leg fix has no legs/fix.mjs'], ['legs-scripts', 'legs/deploy.mjs is no leg of the course']]);
  }, 60_000);

  it('a live ticket the proposed file would move back fails, naming it', async () => {
    const live = [{ id: 'T-7', path: [{ leg: 'implement', reached: 'pr-open' }, { leg: 'review', reached: 'reviewed' }, { leg: 'adjudicate', reached: 'adjudicated' }] }];
    const v = await checkCourse(input({ proposed: WITHOUT_ADJUDICATE, proposedVersions: { version: 4, min_worker_version: 4 }, live }));
    expect(v).toEqual([expect.objectContaining({ rule: 'moves-back', message: expect.stringContaining('T-7') })]);
  }, 60_000);

  it('reads a checkout: the working tree proposes, git’s base is in force, baton.json gives the versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-kit-'));
    dirs.push(root);
    const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
    git('init', '-q');
    mkdirSync(join(root, '.baton/courses/roadmap-pr/legs'), { recursive: true });
    const baton = (min: number) => JSON.stringify({ courses: [{ id: 'roadmap-pr', version: min, min_worker_version: min }] });
    writeFileSync(join(root, '.baton/courses/roadmap-pr/course.json'), JSON.stringify(roadmapPr));
    writeFileSync(join(root, '.baton/baton.json'), baton(3));
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base');
    writeFileSync(join(root, '.baton/courses/roadmap-pr/course.json'), JSON.stringify(WITHOUT_ADJUDICATE));
    writeFileSync(join(root, '.baton/baton.json'), baton(4));
    writeFileSync(join(root, '.baton/courses/roadmap-pr/legs/merge.mjs'), '');
    const board = join(root, 'board.json');
    writeFileSync(board, JSON.stringify({ tickets: [{ id: 'T-1', course_id: 'roadmap-pr' }, { id: 'C-1', course_id: 'chore' }],
      stations: { 'T-1': { path: [{ leg: 'implement', reached: 'pr-open' }] }, 'C-1': { path: [] } } }));
    const k = readInputs(root, 'roadmap-pr', { base: 'HEAD', board });
    expect(k).toMatchObject({ base: roadmapPr, proposed: WITHOUT_ADJUDICATE, baseVersions: { version: 3, min_worker_version: 3 }, proposedVersions: { version: 4, min_worker_version: 4 },
      legScripts: ['merge'], live: [{ id: 'T-1', path: [{ leg: 'implement', reached: 'pr-open' }] }] });
    expect(readInputs(root, 'roadmap-pr')).toMatchObject({ base: null, baseVersions: null });
    expect(() => readInputs(root, 'chore')).toThrow(/no such course file/);
  });
});
