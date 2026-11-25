// layouts.test.ts — the two pure layout functions the drawings stand on: the runner timeline's
// (B-211: time to x, nesting, ticks) and a course file's columns (B-212: longest path from the
// entry station, back-edges, parallel legs). No DOM.
import { describe, expect, it } from 'vitest';
import { courseLayout, courseParts } from '../../src/dashboard/lib/courseLayout';
import { depthsOf, ticksOf, timelineLayout, timeToX } from '../../src/dashboard/lib/timeline';

const H = 3_600_000;
const T0 = Date.parse('2026-11-20T12:00:00Z');

describe('the timeline layout (B-211)', () => {
  it('maps time to x across the window, clamped at its ends', () => {
    expect(timeToX(T0 - 12 * H, T0 - 24 * H, T0, 1000)).toBe(500);
    expect(timeToX(T0 - 30 * H, T0 - 24 * H, T0, 1000)).toBe(0);
    expect(timeToX(T0 + H, T0 - 24 * H, T0, 1000)).toBe(1000);
    expect(timeToX(5, 10, 10, 1000)).toBe(0);
  });

  it('ticks on whole hours, at most nine, by the window’s length', () => {
    const day = ticksOf(T0 - 24 * H, T0, 960);
    expect(day.step).toBe(3 * H);
    expect(day.ticks.length).toBe(9);
    expect(day.ticks.every((t) => t.at % (3 * H) === 0)).toBe(true);
    expect(ticksOf(T0 - 7 * 24 * H, T0, 960).step).toBe(24 * H);
    expect(ticksOf(T0 - 2 * H, T0, 960).step).toBe(H);
    expect(ticksOf(T0, T0, 960).ticks).toEqual([]);
  });

  it('nests activities by their parent chain, and survives a cycle', () => {
    const d = depthsOf([{ id: 'a', started_at: 0 }, { id: 'b', parent_id: 'a', started_at: 0 }, { id: 'c', parent_id: 'b', started_at: 0 }, { id: 'x', parent_id: 'gone', started_at: 0 }]);
    expect([d.get('a'), d.get('b'), d.get('c'), d.get('x')]).toEqual([0, 1, 2, 0]);
    const loop = depthsOf([{ id: 'p', parent_id: 'q', started_at: 0 }, { id: 'q', parent_id: 'p', started_at: 0 }]);
    expect([...loop.values()].every((n) => n >= 0 && n <= 1)).toBe(true);
  });

  it('draws a claim as a bar with its segments inside, a running one to the window’s end, and none outside the window', () => {
    const claims = [
      { claim_id: 1, started_at: T0 - 12 * H, ended_at: T0 - 6 * H, activities: [
        { id: 'r', started_at: T0 - 11 * H, ended_at: T0 - 8 * H },
        { id: 'v', parent_id: 'r', started_at: T0 - 10 * H, ended_at: T0 - 9 * H },
      ] },
      { claim_id: 2, started_at: T0 - 30 * H, ended_at: T0 - 26 * H },
      { claim_id: 3, started_at: T0 - H, ended_at: null, activities: [{ id: 'now', started_at: T0 - 60_000, ended_at: null }] },
      { claim_id: 4, started_at: T0 - 5 * H, ended_at: T0 - 5 * H },
    ];
    const l = timelineLayout({ since: T0 - 24 * H, until: T0 }, claims, 960);
    expect(l.bars.map((b) => b.claim.claim_id)).toEqual([1, 3, 4]);
    expect([l.bars[0].x, l.bars[0].width]).toEqual([480, 240]);
    expect(l.bars[0].segments.map((s) => [s.activity.id, s.x, s.width, s.depth])).toEqual([['r', 520, 120, 0], ['v', 560, 40, 1]]);
    expect(l.bars[1].x + l.bars[1].width).toBe(960);
    // A bar or segment too short to see is still wide enough to focus, and stays in the lane.
    expect(l.bars[2].width).toBe(3);
    expect(l.bars[1].segments[0].width).toBeGreaterThanOrEqual(3);
    expect(l.bars[1].segments[0].x + l.bars[1].segments[0].width).toBeLessThanOrEqual(960);
    expect(l.depth).toBe(2);
  });
});

/** A fixture course of four stations in a line with one way back, and a fifth reached two ways. */
const LINE = {
  start: 's-one', end: ['s-four'],
  stations: { 's-one': {}, 's-two': {}, 's-three': {}, 's-four': {} },
  legs: {
    'l-a': { from: ['s-one'], to: 's-two' },
    'l-b': { from: ['s-two'], to: 's-three' },
    'l-back': { from: ['s-three'], to: 's-two' },
    'l-c': { from: ['s-three'], to: 's-four' },
  },
};

describe('the course layout (B-212 item 1)', () => {
  it('places a four-station course in four columns and marks the way back as a back-edge', () => {
    const l = courseLayout(LINE);
    expect(l.cols).toBe(4);
    expect(l.rows).toBe(1);
    expect(l.stations.map((s) => [s.id, s.col])).toEqual([['s-one', 0], ['s-two', 1], ['s-three', 2], ['s-four', 3]]);
    expect(l.stations.map((s) => s.x)).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(l.edges.map((e) => [e.leg, e.kind])).toEqual([['l-a', 'straight'], ['l-b', 'straight'], ['l-back', 'back'], ['l-c', 'straight']]);
    expect(l.hasBack).toBe(true);
    // A straight edge's label sits at its midpoint.
    expect([l.edges[0].lx, l.edges[0].ly]).toEqual([0.25, 0.5]);
  });

  it('keeps a column in the file’s order, centres a short one, and tells a skip from a step', () => {
    const l = courseLayout({
      start: 'a', stations: { a: {}, b2: {}, b1: {}, c: {} },
      legs: { x: { from: 'a', to: ['b2', 'b1'] }, y: { from: ['b2', 'b1'], to: 'c' }, far: { from: 'a', to: 'c' }, twin: { from: 'a', to: 'b2' } },
    });
    expect([l.cols, l.rows]).toEqual([3, 2]);
    const at = (id: string) => l.stations.find((s) => s.id === id)!;
    expect([at('b2').row, at('b1').row]).toEqual([0, 1]);
    expect([at('a').y, at('b2').y, at('b1').y, at('c').y]).toEqual([0.5, 0.25, 0.75, 0.5]);
    expect(l.edges.find((e) => e.leg === 'far')!.kind).toBe('skip');
    expect(l.hasSkip).toBe(true);
    // One leg from two stations is two edges; two legs between one pair are told apart.
    expect(l.edges.filter((e) => e.leg === 'y').map((e) => e.from)).toEqual(['b2', 'b1']);
    const pair = l.edges.filter((e) => e.from === 'a' && e.to === 'b2');
    expect(pair.map((e) => [e.leg, e.nth, e.of])).toEqual([['x', 0, 2], ['twin', 1, 2]]);
    expect(pair[0].ly).not.toBe(pair[1].ly);
  });

  it('reads anything as a course file without throwing', () => {
    for (const junk of [null, 7, 'x', [], {}, { stations: 3, legs: 'no' }, { legs: { a: null, b: { from: 4, to: [{}, 'z'] } } }]) {
      const l = courseLayout(junk);
      expect(l.cols).toBeGreaterThanOrEqual(1);
      expect(l.stations.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true);
    }
    // A station only a leg names is still drawn; a self-loop is a back-edge.
    expect(courseParts({ legs: { a: { from: 'p', to: 'q' } } }).stations).toEqual(['p', 'q']);
    expect(courseLayout({ stations: { p: {} }, legs: { again: { from: 'p', to: 'p' } } }).edges[0].kind).toBe('back');
  });
});
