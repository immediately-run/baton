// board-check.test.ts — the board post's validation (BATON_SPEC §4.4): the dependency cycle a
// post is refused for (B-111), naming it as `B-1 → B-2 → B-1`; a diamond and an edge to a closed
// ticket accepted; and `bodyDependencies`, the `**Depends on:**` line that B-111 checks the
// markdown source's `depends_on` against. B-113 round 1: a self-qualified edge (the posting
// repository's own id spelled out) reads as its local id in the one-board graph, so a loop
// however spelled is refused. Pure and host-neutral: the validator, no route.
import { describe, it, expect } from 'vitest';
import { bodyDependencies, checkPayload, dependsCycles } from '../../src/core/board';
import { ticket } from '../helpers';

/** A normative post of `tickets`, with `closed` as given: what `checkPayload` reads. The
 *  posting repository's id (B-113 round 1), when the caller knows it, reads a self-qualified
 *  `depends_on` entry as the local id alone in the one-board cycle graph. */
const post = (tickets: Record<string, unknown>[], closed: { id: string; as: 'done' | 'withdrawn' }[] = [], repo?: string) =>
  checkPayload({ sha: '0'.repeat(40), parent_sha: null, observation: 1, tickets, closed }, repo);

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

  it('accepts an interim state.items post with no cycles (and refuses one with, below)', () => {
    // An interim post carries no `dependsOn` here; a loop among them is refused since round 1
    // (1-A-4) — the case below — and this one pins that a clean interim post still passes.
    expect(() => checkPayload({ sha: '0'.repeat(40), parent_sha: null, observation: 1, state: { items: [{ id: 'T-1', title: 'T', status: 'available', queue: 'q', node: 'n' }] }, ready: ['T-1'] })).not.toThrow();
  });
});

describe('a qualified depends_on names another repository\'s ticket (B-113)', () => {
  it('the shape takes a qualified id in depends_on, in both post shapes, and keeps blocked_by local', () => {
    expect(post([ticket('B-1', { depends_on: ['baton:B-111', 'B-2'] }), ticket('B-2')]).tickets).toHaveLength(2);
    // The interim shape's `dependsOn` carries them too (B-111's round 1 read, kept).
    expect(() => checkPayload({
      sha: '0'.repeat(40), parent_sha: null, observation: 1,
      state: { items: [{ id: 'T-1', title: 'T', status: 'available', queue: 'q', node: 'n', dependsOn: ['baton:B-1'] }] }, ready: ['T-1'],
    })).not.toThrow();
    // A malformed qualified id, and `blocked_by` — a parent's children, R-BTN-47 — stays local.
    expect(() => post([ticket('B-1', { depends_on: ['NotARepo:x'] })])).toThrow('depends_on must be a list');
    expect(() => post([ticket('B-1', { depends_on: ['docs:B-1:x'] })])).toThrow('depends_on must be a list');
    expect(() => post([ticket('B-1', { blocked_by: ['baton:B-1'] })])).toThrow('blocked_by must be a list');
  });

  it('a qualified edge is no node of the one-board cycle graph — the cross-board walk is the post\'s judgment', () => {
    // B-1 → baton:B-9 → B-2 → B-1 would loop only if baton's board answered; the shape check
    // holds one board's own graph and follows no qualified edge (§4.4).
    expect(post([ticket('B-1', { depends_on: ['baton:B-9'] })]).tickets).toHaveLength(1);
    // The same holds with the posting repository named, for an edge that is another
    // repository's however read (round 1).
    expect(post([ticket('B-1', { depends_on: ['baton:B-9'] })], [], 'docs').tickets).toHaveLength(1);
  });

  it('a self-qualified edge is its local id in the one-board graph: a loop however spelled is refused (round 1)', () => {
    // `docs:T-2` posted by docs is the local edge `T-2` (§3.1) — before round 1 both cycle
    // checks missed the loop: the one-board graph keyed bare local ids, and the cross-board
    // walk skipped what it detected as one board's own.
    expect(() => post([ticket('T-1', { depends_on: ['docs:T-2'] }), ticket('T-2', { depends_on: ['docs:T-1'] })], [], 'docs'))
      .toThrow('a dependency cycle: T-1 → T-2 → T-1');
    // The mixed spelling — one edge bare, one self-qualified — is the same loop.
    expect(() => post([ticket('T-1', { depends_on: ['T-2'] }), ticket('T-2', { depends_on: ['docs:T-1'] })], [], 'docs'))
      .toThrow('a dependency cycle: T-1 → T-2 → T-1');
    // A self-dependency spelled self-qualified is T-1 → T-1.
    expect(() => post([ticket('T-1', { depends_on: ['docs:T-1'] })], [], 'docs')).toThrow('a dependency cycle: T-1 → T-1');
    // Another repository's qualified edge among them stays no node: T-1 → baton:B-9 is fine.
    expect(post([ticket('T-1', { depends_on: ['docs:T-2', 'baton:B-9'] }), ticket('T-2')], [], 'docs').tickets).toHaveLength(2);
    // Without the repository named (a test kit's post), the spelling is not normalized here;
    // the cross-board walk and the board route's own call, which names it, are the judgment.
    expect(post([ticket('T-1', { depends_on: ['docs:T-2'] }), ticket('T-2', { depends_on: ['docs:T-1'] })]).tickets).toHaveLength(2);
  });

  it('the interim shape reads a self-qualified edge as its local id too (round 1)', () => {
    const items = (ids: string[], repo?: string) => checkPayload({
      sha: '0'.repeat(40), parent_sha: null, observation: 1,
      state: { items: [
        { id: 'T-1', title: 'T', status: 'available', queue: 'q', node: 'n', dependsOn: ['docs:T-2'] },
        { id: 'T-2', title: 'T', status: 'available', queue: 'q', node: 'n', dependsOn: ids },
      ] },
      ready: ['T-1', 'T-2'],
    }, repo);
    expect(() => items(['docs:T-1'], 'docs')).toThrow('state.items: a dependency cycle: T-1 → T-2 → T-1');
    // Another repository's edge closes no loop here.
    expect(() => items(['baton:T-1'], 'docs')).not.toThrow();
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

describe('B-111 round 1: every cycle, and the stack', () => {
  it('two disjoint cycles are both named, each once', () => {
    const loops = dependsCycles([
      { id: 'A', depends_on: ['B'] }, { id: 'B', depends_on: ['A'] },
      { id: 'C', depends_on: ['D'] }, { id: 'D', depends_on: ['C'] },
    ]);
    expect(loops).toEqual([['A', 'B', 'A'], ['C', 'D', 'C']]);
  });

  it('a self-edge is A → A, and a diamond is no loop', () => {
    expect(dependsCycles([{ id: 'A', depends_on: ['A'] }])).toEqual([['A', 'A']]);
    expect(dependsCycles([
      { id: 'A', depends_on: ['B', 'C'] }, { id: 'B', depends_on: ['D'] }, { id: 'C', depends_on: ['D'] }, { id: 'D', depends_on: [] },
    ])).toEqual([]);
  });

  it('a legal 10 000-ticket chain is walked, not overflowed (TICKETS_MAX)', () => {
    // The board admits 10 000 tickets; one chain that long must answer "no cycle", not a
    // RangeError from the engine (round 1, 1-A-3).
    const chain = Array.from({ length: 10_000 }, (_, i) => ({ id: `T${i + 1}`, depends_on: i + 1 < 10_000 ? [`T${i + 2}`] : [] }));
    expect(dependsCycles(chain)).toEqual([]);
    // And the same chain closed into a loop is one cycle, named.
    chain[chain.length - 1].depends_on = ['T1'];
    expect(dependsCycles(chain)).toHaveLength(1);
  });

  it('the interim state.items shape refuses a cycle too (round 1, 1-A-4)', () => {
    const post = {
      sha: 'a'.repeat(40), parent_sha: null, observation: 1,
      state: { items: [
        { id: 'A', title: 'A', status: 'ready', queue: 'q', node: 'n', dependsOn: ['B'] },
        { id: 'B', title: 'B', status: 'ready', queue: 'q', node: 'n', dependsOn: ['A'] },
      ] },
      ready: ['A', 'B'],
    };
    expect(() => checkPayload(post)).toThrow(/state\.items: a dependency cycle: A → B → A/);
  });
});
