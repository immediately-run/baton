// children.test.ts — R3-1258's unit half (BATON_SPEC §4.6 R-BTN-86, §4.7 R-BTN-85): parent
// resolution (cycles, depth, self, foreign, orphan — G-BTN-76's non-call clauses) and the
// `spawned` report's bounds and refusals, pure, beside the integration half S-BTN-49.
import { describe, it, expect } from 'vitest';
import { checkPayload, resolveParents, PARENT_GENERATIONS_MAX } from '../../src/core/board';
import { checkAdvance, checkEnd, SPAWNED_MAX } from '../../src/core/validate';

const R = 'docs';
const posted = (id: string, parent: string | null) => ({ id, parent });

describe('R-BTN-86: parent resolution (pure)', () => {
  it('stores a same-repository parent qualified, and an unknown one orphaned', () => {
    const out = resolveParents(R, [posted('T', null), posted('C1', 'T'), posted('O', 'GHOST')], new Map());
    expect(out.invalid).toEqual([]);
    expect(out.parentOf.get('C1')).toEqual({ qualified: 'docs:T', known: true });
    expect(out.parentOf.get('T')).toEqual({ qualified: null, known: false });
    expect(out.parentOf.get('O')).toEqual({ qualified: 'docs:GHOST', known: false });
  });

  it('drops a parent that is not a local id, names the ticket itself, closes a cycle, or lies too deep', () => {
    const out = resolveParents(R, [
      posted('F', 'other-repo:X'),      // foreign: a qualified id is not a local one
      posted('F2', 'not an id!'),
      posted('S', 'S'),                 // self
      posted('A', 'B'), posted('B', 'A'), // a two-ticket cycle
      posted('D5', 'D4'), posted('D4', 'D3'), posted('D3', 'D2'), posted('D2', 'D1'), posted('D1', null), // four below a root: kept
      posted('E6', 'E5'), posted('E5', 'E4'), posted('E4', 'E3'), posted('E3', 'E2'), posted('E2', 'E1'), posted('E1', null), // five below: over
    ], new Map());
    const by = new Map(out.invalid.map((x) => [x.ticket, x.reason]));
    expect(by.get('F')).toBe('foreign');
    expect(by.get('F2')).toBe('foreign');
    expect(by.get('S')).toBe('self');
    expect(by.get('A')).toBe('cycle');
    expect(by.get('B')).toBe('cycle');
    // D5 is exactly four generations below D1 (R-BTN-149's cap); E6 is five — one too many.
    expect(by.get('E6')).toBe('depth');
    expect(by.has('D5')).toBe(false);
    expect(out.parentOf.get('E6')).toEqual({ qualified: null, known: false });
    expect(out.parentOf.get('D5')).toEqual({ qualified: 'docs:D4', known: true });
    expect(PARENT_GENERATIONS_MAX).toBe(4);
  });

  it('walks the stored rows beside the post: a cycle through the board is caught, a stored chain deepens it', () => {
    // The board holds E1 → E2 (E2 stored with parent E1); the post adds E3 → E1, closing a cycle.
    const board = new Map([['E2', 'docs:E1'], ['E1', null]]);
    const closing = resolveParents(R, [posted('E3', 'E1'), posted('E1', 'E2')], board);
    expect(closing.invalid.map((x) => [x.ticket, x.reason])).toContainEqual(['E3', 'cycle']);
    expect(closing.parentOf.get('E3')).toEqual({ qualified: null, known: false });
    // The post's own value wins for its tickets: E1 re-posted with no parent breaks its half.
    const chain = resolveParents(R, [posted('C2', 'C1'), posted('C3', 'C2')], new Map([['C1', null], ['C0', null]]));
    expect(chain.invalid).toEqual([]);
    // A ticket that points INTO a cycle is as invalid as one on it.
    const into = resolveParents(R, [posted('X', 'A')], new Map([['A', 'docs:B'], ['B', 'docs:A']]));
    expect(into.invalid[0]).toMatchObject({ ticket: 'X', reason: 'cycle' });
  });

  it('counts a closed parent as known (a leaf of the walk), never as a cycle', () => {
    const out = resolveParents(R, [posted('C', 'GONE')], new Map(), new Set(['GONE']));
    expect(out.invalid).toEqual([]);
    expect(out.parentOf.get('C')).toEqual({ qualified: 'docs:GONE', known: true });
  });

  it('bounds the posted parent at the payload check alone; a non-local id is accepted there, never refused', () => {
    const t = (parent: unknown) => ({ id: 'T', course_id: 'roadmap-pr', path: 'tickets/T.mdx', title: 'T', requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], parent });
    expect(() => checkPayload({ sha: 'a'.repeat(40), parent_sha: null, observation: 1, tickets: [t('other:X')] })).not.toThrow();
    expect(() => checkPayload({ sha: 'a'.repeat(40), parent_sha: null, observation: 1, tickets: [t(null)] })).not.toThrow();
    expect(() => checkPayload({ sha: 'a'.repeat(40), parent_sha: null, observation: 1, tickets: [t('x'.repeat(200))] })).toThrowError(/parent/);
    expect(() => checkPayload({ sha: 'a'.repeat(40), parent_sha: null, observation: 1, tickets: [t(42)] })).toThrowError(/parent/);
  });
});

describe('R-BTN-86: the spawned report (pure)', () => {
  const end = (over: Record<string, unknown>) => checkEnd({ end_reason: 'released:requested', reached: 'filed', ...over });
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `C${i}`);

  it('rides a suspended or released end; done and advance take none', () => {
    expect(end({ spawned: ['C1', 'C2'] }).spawned).toEqual(['C1', 'C2']);
    expect(checkEnd({ end_reason: 'suspended:reviewed', reached: 'reviewed', spawned: ['C1'] }).spawned).toEqual(['C1']);
    expect(() => checkEnd({ end_reason: 'done', reached: 'merged', spawned: ['C1'] })).toThrowError(/spawned/);
    expect(() => checkAdvance({ leg: 'review' as string, spawned: ['C1'] as never })).toThrowError(/spawned/);
  });

  it('bounds the list at 50 ids, each a local ticket id, each once', () => {
    expect(SPAWNED_MAX).toBe(50);
    expect(end({ spawned: ids(50) }).spawned).toHaveLength(50);
    expect(() => end({ spawned: ids(51) })).toThrowError(/spawned/);
    expect(() => end({ spawned: ['not an id!'] })).toThrowError(/spawned/);
    expect(() => end({ spawned: ['docs:C1'] })).toThrowError(/spawned/);
    expect(() => end({ spawned: ['C1', 'C1'] })).toThrowError(/spawned/);
    expect(end({}).spawned).toBeNull();
  });
});
