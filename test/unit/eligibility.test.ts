// eligibility.test.ts — why a runner can never claim (B-86 item 3, off `baton board`'s answer,
// B-90): the startup line `baton run` prints when its declaration can match none of its course's
// legs, and `startup`'s B-86 item 1 default — with no `--capabilities`, the runner declares what
// its grant allows. Node only (it imports the runner's entry).
import { describe, it, expect, vi } from 'vitest';
import { legClauses, neverClaimable, type BoardView } from '../../src/runner/eligibility';
import { startup } from '../../src/runner/main';
import { BatonRefusal } from '../../src/runner/api';

const COURSE = {
  legs: {
    implement: { from: ['filed'], to: ['pr-open'], requires: 'create-pr' },
    'run-tests': { from: ['pr-open'], to: ['tested'], requires: 'create-pr' },
    release: { from: ['tested'], to: ['done'], requires: 'npm-publish' },
  },
};
const board = (over: Partial<BoardView> = {}): BoardView => ({
  repository: { id: 'baton', courses: [{ id: 'create-pr', queues: [{ leg: 'implement' }, { leg: 'run-tests' }] }] },
  ready: [],
  course_files: { 'create-pr': COURSE },
  ...over,
});

describe('legClauses', () => {
  it('every leg of the course file, a queue-only leg included, each with its requires clause', () => {
    expect(legClauses(COURSE, [{ leg: 'implement' }, { leg: 'ghost' }])).toEqual([
      { leg: 'implement', requires: 'create-pr' },
      { leg: 'run-tests', requires: 'create-pr' },
      { leg: 'release', requires: 'npm-publish' },
      { leg: 'ghost', requires: '' },
    ]);
    expect(legClauses(null, [{ leg: 'implement' }])).toEqual([{ leg: 'implement', requires: '' }]);
  });
});

describe('neverClaimable (B-86 item 3)', () => {
  const at = (declared: string[], b = board(), course = 'create-pr') =>
    neverClaimable({ repository: 'baton', board: b, course, legs: legClauses(b.course_files?.[course], b.repository?.courses?.find((c) => c.id === course)?.queues ?? []), declared });

  it('a declaration that matches an idle course’s legs is silent; any ready ticket is work, not a mismatch', () => {
    expect(at(['agent-venue'])).toBeNull();
    expect(at(['llm-call'])).toMatch(/^it declares llm-call, so no leg of create-pr/);
    expect(at(['llm-call'], board({ ready: [{ id: 'baton:B-1', leg: 'implement', station: 'filed' }] }))).toBeNull();
  });

  it('names the legs’ clauses, the capabilities the declaration lacks, and that --capabilities narrows', () => {
    const why = at(['llm-call'])!;
    expect(why).toContain('it declares llm-call');
    expect(why).toContain('implement requires create-pr');
    expect(why).toContain('release requires npm-publish');
    expect(why).toMatch(/needs create-pr, npm-publish/);
    expect(why).toContain('--capabilities llm-call narrows');
    // A role expands (§7.2 rule 4): agent-venue fulfils create-pr, so the venue lacks nothing.
    expect(at(['agent-venue'], board({ repository: { id: 'baton', courses: [{ id: 'create-pr', queues: [{ leg: 'implement' }] }] } }))).toBeNull();
  });

  it('a course the repository does not run, and a course with no queue, are named as such', () => {
    expect(at(['agent-venue'], board(), 'bug-report')).toMatch(/baton runs create-pr, not bug-report/);
    const empty = board({ repository: { id: 'baton', courses: [{ id: 'bug-report' }] } });
    expect(at(['agent-venue'], empty, 'bug-report')).toMatch(/runs no leg of bug-report with a queue/);
  });
});

describe('startup (B-86: the grant declares unless --capabilities narrows)', () => {
  const api = (answer: unknown) => ({ boardView: vi.fn(async () => answer as Record<string, any>) });
  const granted = board({ granted_capabilities: ['authentication', 'create-pr', 'drivable-browser', 'llm-call', 'none'] });
  const clauses = [{ leg: 'implement', requires: 'create-pr' }, { leg: 'release', requires: 'npm-publish' }];

  it('no flag: the first declaration is the grant’s own capabilities, with no startup line', async () => {
    expect(await startup(api(granted), { repository: 'baton', capabilities: null }, 'create-pr', () => [{ leg: 'implement', requires: 'create-pr' }]))
      .toEqual({ declare: ['authentication', 'create-pr', 'drivable-browser', 'llm-call', 'none'], line: null });
  });

  it('--capabilities narrows: a declaration that matches nothing gets the one line, and stays the declaration', async () => {
    const s = await startup(api(granted), { repository: 'baton', capabilities: ['llm-call'] }, 'create-pr', () => clauses);
    expect(s.declare).toEqual(['llm-call']);
    expect(s.line).toMatch(/^baton: this runner can never claim: it declares llm-call/);
    expect(s.line).toContain('--capabilities llm-call narrows');
  });

  it('a board Baton refuses is the line in Baton’s own words; a key no grant binds starts at the venue', async () => {
    const refused = { boardView: vi.fn(async () => { throw new BatonRefusal('forbidden', undefined, 'the key is not granted on baton (R-BTN-58)', 403); }) };
    expect(await startup(refused as any, { repository: 'baton', capabilities: null }, 'create-pr', () => []))
      .toEqual({ declare: ['agent-venue'], line: 'baton: this runner can never claim: Baton refused the board of baton (forbidden: the key is not granted on baton (R-BTN-58))' });
    const ungranted = board({ granted_capabilities: null });
    expect((await startup(api(ungranted), { repository: 'baton', capabilities: null }, 'create-pr', () => [])).declare).toEqual(['agent-venue']);
    // A transport failure says nothing and stops nothing.
    const offline = { boardView: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) };
    expect(await startup(offline as any, { repository: 'baton', capabilities: null }, 'create-pr', () => [])).toEqual({ declare: ['agent-venue'], line: null });
  });
});
