// board-check.test.ts — the board post's validation (BATON_SPEC §4.4): the dependency cycle a
// post is refused for (B-111), naming it as `B-1 → B-2 → B-1`; a diamond and an edge to a closed
// ticket accepted; and `bodyDependencies`, the `**Depends on:**` line that B-111 checks the
// markdown source's `depends_on` against. Pure and host-neutral: the validator, no route.
import { describe, it, expect } from 'vitest';
import { bodyDependencies, checkPayload } from '../../src/core/board';
import { ticket } from '../helpers';

/** A normative post of `tickets`, with `closed` as given: what `checkPayload` reads. */
const post = (tickets: Record<string, unknown>[], closed: { id: string; as: 'done' | 'withdrawn' }[] = []) =>
  checkPayload({ sha: '0'.repeat(40), parent_sha: null, observation: 1, tickets, closed });

describe('a board post with a dependency cycle is refused (B-111)', () => {
  it('refuses a two-ticket cycle, naming it once and naming the field', () => {
    const cycle = [ticket('B-1', { depends_on: ['B-2'] }), ticket('B-2', { depends_on: ['B-1'] })];
    expect(() => post(cycle)).toThrow('a dependency cycle: B-1 → B-2 → B-1');
    // `invalid-params`, as every refusal of the post's shape is (§11).
    try {
      post(cycle);
    } catch (e) {
      expect((e as { code: string }).code).toBe('invalid-params');
    }
  });

  it('refuses a longer cycle and a self-dependency alike', () => {
    expect(() => post([ticket('B-1', { depends_on: ['B-3'] }), ticket('B-2', { depends_on: ['B-1'] }), ticket('B-3', { depends_on: ['B-2'] })])).toThrow('B-1 → B-3 → B-2 → B-1');
    expect(() => post([ticket('B-1', { depends_on: ['B-1'] })])).toThrow('a dependency cycle: B-1 → B-1');
  });

  it('accepts a diamond, and an edge to a closed ticket', () => {
    const diamond = [ticket('B-1'), ticket('B-2', { depends_on: ['B-1'] }), ticket('B-3', { depends_on: ['B-1'] }), ticket('B-4', { depends_on: ['B-2', 'B-3'] })];
    expect(post(diamond).tickets).toHaveLength(4);
    // A closed ticket left the board with the ticket that depended on it: there is nothing to loop
    // over, and a live ticket depending on an id nothing names is not a cycle either (§4.4; naming
    // that id is `baton tickets check`'s business, not the board's).
    expect(post([ticket('B-1', { depends_on: ['B-2'] })], [{ id: 'B-2', as: 'done' }]).tickets).toHaveLength(1);
    expect(post([ticket('B-1', { depends_on: ['B-9'] })]).tickets).toHaveLength(1);
  });

  it('refuses a cycle only among the live: a ticket the post also closes is refused as both', () => {
    // A post names a ticket once, live or closed (§4.4): `closed` dead is refused before the cycle.
    expect(() => post([ticket('B-1', { depends_on: ['B-2'] }), ticket('B-2', { depends_on: ['B-1'] })], [{ id: 'B-2', as: 'done' }])).toThrow('B-2 is also live');
  });

  it('refuses a cycle in the interim state.items shape not at all: it has no depends_on', () => {
    // The interim post carries no dependencies; the check bites the normative one alone.
    expect(() => checkPayload({ sha: '0'.repeat(40), parent_sha: null, observation: 1, state: { items: [{ id: 'T-1', title: 'T', status: 'available', queue: 'q', node: 'n' }] }, ready: ['T-1'] })).not.toThrow();
  });
});

describe('bodyDependencies: the **Depends on:** line (B-111)', () => {
  const ID = /[A-Z]+-\d+/;

  it('reads to the next blank line or **Label:** line, joins its lines, de-duplicates', () => {
    expect(bodyDependencies('intro\n\n**Depends on:** B-1\nand B-2, B-1 again\n\n**Used by:** B-3\n', ID)).toEqual(['B-1', 'B-2']);
    expect(bodyDependencies('**Depends on:** B-1\n**Label:** B-2\n', ID)).toEqual(['B-1']);
    expect(bodyDependencies('**Depends on:**\nB-1\nB-2\n', ID)).toEqual(['B-1', 'B-2']);
  });

  it('is null without the line, and never reads a mention inside prose or a **Used by:** line', () => {
    expect(bodyDependencies('no line\n', ID)).toBeNull();
    expect(bodyDependencies('prose mentions **Depends on:** B-1\n', ID)).toBeNull();
    expect(bodyDependencies('prose\n\n**Used by:** B-1\n', ID)).toBeNull();
  });

  it('keeps the first id whole: the marker is 15 characters, so B-1 never reads as 1', () => {
    expect(bodyDependencies('**Depends on:** B-1, B-22\n', ID)).toEqual(['B-1', 'B-22']);
  });
});
