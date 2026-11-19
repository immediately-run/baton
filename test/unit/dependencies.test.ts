// dependencies.test.ts — the cross-repository `depends_on` checks (B-113, §4.4), pure over a
// fake store, the way the checks are pure over the caller's transaction: the walk's bound
// (`BOARDS_MAX`) is a refusal, not a silent stop — round 1 found the bound written but never
// thrown, so a graph over it was sometimes truncated and sometimes walked past, never refused —
// and the sync's dependencies read answers a self-qualified id (the posting repository's own id
// spelled out, §3.1, round 1) against that same board, with `url` null for a closed target,
// whose file the archive moved along a path no closing keeps.
import { describe, it, expect } from 'vitest';
import { BOARDS_MAX, checkCrossBoardCycle, resolveDependencies, type Sql } from '../../src/core/dependencies';

/** One board as the fake store holds it: its live tickets (local id → `depends_on`), its closed
 *  ones, and the registration the target lookups read. */
interface Board {
  live?: Record<string, string[]>;
  closed?: Record<string, 'done' | 'withdrawn'>;
  station?: string | null;
  webBase?: string | null;
  forge?: 'github' | 'gitlab' | 'gitea' | 'git';
  retired?: boolean;
}

/** The `Sql` the checks take, answering from `boards`: each query by the table it reads, the
 *  way `sliceOf`'s own one-statement reads shape them. */
const sqlOf = (boards: Record<string, Board>): Sql => <T>(q: string, ...a: unknown[]): T[] => {
  const repo = (v: unknown): string => String(v).split(':')[0];
  if (q.includes('FROM tickets')) {
    const b = boards[a[0] as string];
    return Object.entries(b?.live ?? {}).map(([local, depends_on]) => ({ local, path: `tickets/${local}.mdx`, depends_on: JSON.stringify(depends_on) })) as T[];
  }
  if (q.includes('FROM closed_tickets')) {
    const b = boards[repo(a[0])];
    return Object.entries(b?.closed ?? {}).map(([local, closed_as]) => ({ ticket_id: `${repo(a[0])}:${local}`, closed_as })) as T[];
  }
  if (q.includes('FROM repositories')) {
    const b = boards[a[0] as string];
    return b ? ([{ id: a[0] as string, forge: b.forge ?? 'github', web_base: b.webBase ?? `https://github.com/immediately-run/${a[0]}`, default_branch: 'main', retired_at: b.retired ?? false ? 1 : null }] as T[]) : [];
  }
  if (q.includes('count(*)')) return [{ n: 0 }] as T[]; // owners, grants: nothing less visible
  if (q.includes('FROM dependency_consents')) return [] as T[];
  if (q.includes('FROM ticket_stations')) {
    const b = boards[repo(a[0])];
    return b?.station === undefined ? [{ station: 'filed' }] as T[] : (b.station != null ? [{ station: b.station }] as T[] : [] as T[]);
  }
  throw new Error(`the fake store does not read this: ${q}`);
};

describe('checkCrossBoardCycle: the bound is a refusal (B-113 round 1)', () => {
  /** A chain of boards, each ticket waiting on the next board's, `n` foreign boards after the
   *  posting one; the last waits on nothing. */
  const chain = (foreign: number): Record<string, Board> => {
    const boards: Record<string, Board> = {};
    for (let i = 0; i <= foreign; i++) boards[`a${i}`] = { live: { T: i < foreign ? [`a${i + 1}:T`] : [] } };
    return boards;
  };

  it('a graph over BOARDS_MAX boards is refused, naming the board that crossed the bound', () => {
    // a0 (the posting repository) plus BOARDS_MAX foreign boards is one board over the bound.
    const boards = chain(BOARDS_MAX);
    expect(() => checkCrossBoardCycle(sqlOf(boards), 'a0', [{ id: 'T', depends_on: ['a1:T'] }]))
      .toThrow(`a dependency graph over more than ${BOARDS_MAX} repositories is out of scale, and a${BOARDS_MAX}:T takes it to ${BOARDS_MAX + 1}`);
  });

  it(`a graph of exactly ${BOARDS_MAX} boards walks whole, and a two-board cycle is still refused`, () => {
    // The posting repository and BOARDS_MAX - 1 foreign ones: the bound's own size, refused never.
    const boards = chain(BOARDS_MAX - 1);
    expect(() => checkCrossBoardCycle(sqlOf(boards), 'a0', [{ id: 'T', depends_on: ['a1:T'] }])).not.toThrow();
    // A two-board cycle, one edge each way, named as its path with qualified ids.
    expect(() => checkCrossBoardCycle(sqlOf({ baton: { live: { 'B-1': ['docs:T-1'] } }, docs: { live: { 'T-1': ['baton:B-1'] } } }), 'baton', [{ id: 'B-1', depends_on: ['docs:T-1'] }]))
      .toThrow('a dependency cycle across repositories: baton:B-1 → docs:T-1 → baton:B-1');
  });

  it('a one-board loop, however spelled, is this board\'s own post\'s refusal — the walk skips it', () => {
    // The §4.4 split (round 1): the one-board graph refuses this loop however its edges are
    // spelled (board-check.test.ts); the cross-board walk names loops over two or more.
    expect(() => checkCrossBoardCycle(sqlOf({ docs: { live: { 'T-1': ['docs:T-2'], 'T-2': ['docs:T-1'] } } }), 'docs', [{ id: 'T-1', depends_on: ['docs:T-2'] }, { id: 'T-2', depends_on: ['docs:T-1'] }])).not.toThrow();
  });
});

describe('resolveDependencies: the sync\'s read (B-113 round 1)', () => {
  it('answers a self-qualified id against the posting repository\'s own board, read as its local id', () => {
    // §3.1: a checkout whose repos map names no id of its own sends every qualified id to the
    // read; the posting repository's own board answers its own spelling, so the run survives.
    const sql = sqlOf({ docs: { live: { 'T-1': [] } } });
    expect(resolveDependencies(sql, 'docs', ['docs:T-1'])).toEqual([{
      ticket: 'docs:T-1', repository: 'docs', local: 'T-1', done: false, withdrawn: false, closed: false,
      station: 'filed', url: 'https://github.com/immediately-run/docs/blob/main/tickets/T-1.mdx',
    }]);
    // The own board's refusals are the read's: an id neither live nor closed there names itself.
    expect(() => resolveDependencies(sql, 'docs', ['docs:T-9'])).toThrow('depends_on names docs:T-9, which is neither live nor closed on docs (B-113)');
  });

  it('answers url null for a closed target — the archive moved its file, and no closing keeps the path', () => {
    const sql = sqlOf({ ops: { closed: { 'B-1': 'done' }, station: null } });
    expect(resolveDependencies(sql, 'fieldhouse', ['ops:B-1'])).toMatchObject([{ ticket: 'ops:B-1', done: true, closed: true, station: null, url: null }]);
    // A live target's link is still built from its registration.
    expect(resolveDependencies(sqlOf({ ops: { live: { 'B-2': [] } } }), 'fieldhouse', ['ops:B-2'])).toMatchObject([{ ticket: 'ops:B-2', url: 'https://github.com/immediately-run/ops/blob/main/tickets/B-2.mdx' }]);
  });

  it('still refuses an unregistered repository and a bare local id, naming them', () => {
    const sql = sqlOf({ docs: {} });
    expect(() => resolveDependencies(sql, 'docs', ['ghost:B-1'])).toThrow('depends_on names ghost:B-1, which is not a repository registered here (B-113)');
    expect(() => resolveDependencies(sql, 'docs', ['B-1'])).toThrow('B-1 is not a qualified id <repository>:<local> (B-113)');
  });
});
