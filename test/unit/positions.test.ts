// positions.test.ts — the queued leg across course changes (BATON_SPEC §2h R-BTN-83, R-BTN-64;
// R3-1257): a renamed queued leg is read through `renamed_from`, both when the course file is
// accepted and when a snapshot still posts the old name; a queued leg the file no longer has
// leaving the station waits on `course-changed` from the file's acceptance, before any snapshot
// posts it, and the wait ends when a later file has the leg again. Confirmation, replacement and
// the owner's re-route are B-38's.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, course, placed, rows, setClock, withCore } from '../helpers';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];

let git: Git;
const queued = (local: string) => rows<{ next_leg: string | null }>('SELECT next_leg FROM ticket_stations WHERE ticket_id = ?', `docs:${local}`);
const nextLegs = (local: string) => rows<{ leg: string; state: string; waiting_on: string | null }>('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${local}`);

beforeEach(async () => {
  await setClock(T0);
  git = new Git().add('F', {}, placed('reviewed', REVIEWED, [['fix', 'ready']])).add('J', {}, placed('reviewed', REVIEWED, [['adjudicate', 'ready']]));
  expect((await git.post()).status).toBe(200);
});

describe('R-BTN-83: the queued leg across course changes', () => {
  it('a renamed queued leg is stored under its new name, from the file and from a snapshot posting the old one', async () => {
    const { fix, ...legs } = roadmapPr.legs;
    const RENAMED = { ...roadmapPr, legs: { ...legs, address: { ...fix, renamed_from: ['fix'] }, review: { ...legs.review } } };
    // The registry is applied before the stations: the file's acceptance renames F's queued leg,
    // and the snapshot that still posts `fix` is read through renamed_from.
    git.registry = [course(4, 3, { course: RENAMED })];
    expect((await git.post()).status).toBe(200);
    expect(await queued('F')).toEqual([{ next_leg: 'address' }]);
    expect(await nextLegs('F')).toEqual([{ leg: 'address', state: 'ready', waiting_on: null }]);
  });

  it('a next leg posted with the queued one that does not leave the station waits on course-changed too', async () => {
    git.place('F', placed('reviewed', REVIEWED, [['fix', 'ready'], ['implement', 'ready']], { next_leg: 'fix' }));
    expect((await git.post()).status).toBe(200);
    expect(await nextLegs('F')).toEqual([{ leg: 'fix', state: 'ready', waiting_on: null }, { leg: 'implement', state: 'waiting', waiting_on: 'course-changed' }]);
  });

  it('the file’s acceptance alone sets the wait; a later file with the leg back lets the next snapshot clear it', async () => {
    const { adjudicate: _a, ...legs } = roadmapPr.legs;
    const { adjudicated: _s, ...stations } = roadmapPr.stations;
    const REMOVED = { ...roadmapPr, stations, legs: { ...legs, merge: { ...legs.merge, from: ['reviewed'] } } };
    // Accepted with J's station posted as before: J waits from the acceptance on.
    await withCore((core) => {
      core.store.transaction(() => {
        core.store.exec(`UPDATE courses SET course_json = ?, version = 4 WHERE repository_id = 'docs' AND id = 'roadmap-pr'`, JSON.stringify(REMOVED));
        core.stations.reset();
        core.stations.recheckCourse('docs', 'roadmap-pr');
      });
    });
    expect(await nextLegs('J')).toEqual([{ leg: 'adjudicate', state: 'waiting', waiting_on: 'course-changed' }]);
    expect(await nextLegs('F')).toEqual([{ leg: 'fix', state: 'ready', waiting_on: null }]);
    // Snapshots that go on posting it ready keep the wait's start: Needs you's age is from T0.
    await setClock(T0 + 60_000);
    git.registry = [course(4, 3, { course: REMOVED })];
    expect((await git.post()).status).toBe(200);
    await setClock(T0 + 120_000);
    expect((await git.post()).status).toBe(200);
    expect(await rows(`SELECT waiting_since FROM ticket_next_legs WHERE ticket_id = 'docs:J'`)).toEqual([{ waiting_since: T0 }]);
    // The original file comes back: the next snapshot posts adjudicate ready, and it is ready.
    git.registry = [course(5, 3)];
    expect((await git.post()).status).toBe(200);
    expect(await nextLegs('J')).toEqual([{ leg: 'adjudicate', state: 'ready', waiting_on: null }]);
  });
});
