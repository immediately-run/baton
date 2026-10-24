// eligibility.test.ts — why a runner can never claim (B-86 item 3, off `baton board`'s answer,
// B-90): the startup line `baton run` prints when its declaration can match none of its course's
// legs, and `startup`'s B-86 item 1 default — with no `--capabilities`, the runner declares what
// its grant allows, as the board names it. The board fixtures below carry exactly the fields
// `boardView` answers, `granted_capabilities` included (it is no longer a hand-typed extra: the
// key's own board has it, src/core/baton.ts). Pure of node: nothing here imports the runner's
// entry, which would pull `node:fs` into the hosted typecheck's program (S-BTN-166's too).
import { describe, it, expect, vi } from 'vitest';
import { legClauses, neverClaimable, startup, type BoardView } from '../../src/runner/eligibility';
import { BatonRefusal } from '../../src/runner/api';

const COURSE = {
  legs: {
    implement: { from: ['filed'], to: ['pr-open'], requires: 'create-pr' },
    'run-tests': { from: ['pr-open'], to: ['tested'], requires: 'create-pr' },
    release: { from: ['tested'], to: ['done'], requires: 'npm-publish' },
  },
};
/** A board's answer as `GET /v1/repositories/{repo}/board` gives it: these keys, no others. */
const board = (over: Partial<BoardView> = {}): BoardView & { server_time: number } => ({
  repository: { id: 'baton', courses: [{ id: 'create-pr', queues: [{ leg: 'implement' }, { leg: 'run-tests' }] }] },
  ready: [],
  course_files: { 'create-pr': COURSE },
  granted_capabilities: null,
  server_time: 0,
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
  const at = (declared: string[], b = board(), course = 'create-pr', fromFlag?: boolean) =>
    neverClaimable({ repository: 'baton', board: b, course, legs: legClauses(b.course_files?.[course], b.repository?.courses?.find((c) => c.id === course)?.queues ?? []), declared, ...(fromFlag === undefined ? {} : { fromFlag }) });

  it('a declaration that matches a course’s legs is silent; one that matches none says so, ready tickets or not', () => {
    expect(at(['agent-venue'])).toBeNull();
    expect(at(['llm-call'])).toMatch(/^it declares llm-call, so no leg of create-pr/);
    // B-86's incident: a ticket ready on a leg the declaration cannot take is not work, and is
    // no reason to keep quiet about a runner that can never claim anything.
    const ready = board({ ready: [{ id: 'baton:B-1', leg: 'implement', station: 'filed' }] });
    expect(at(['llm-call'], ready)).toMatch(/^it declares llm-call, so no leg of create-pr/);
    expect(at(['agent-venue'], ready)).toBeNull();
  });

  it('names the legs’ clauses and the capabilities the declaration lacks; --capabilities narrows only when it was passed', () => {
    const why = at(['llm-call'], board(), 'create-pr', true)!;
    expect(why).toContain('it declares llm-call');
    expect(why).toContain('implement requires create-pr');
    expect(why).toContain('release requires npm-publish');
    expect(why).toMatch(/needs create-pr, npm-publish/);
    expect(why).toContain('--capabilities llm-call narrows');
    // The grant's own declaration (no flag) gets no advice to drop a flag it never passed.
    expect(at(['llm-call'], board(), 'create-pr', false)).not.toContain('drop the flag');
    // A role expands (§7.2 rule 4): agent-venue fulfils create-pr, so the venue lacks nothing.
    expect(at(['agent-venue'], board({ repository: { id: 'baton', courses: [{ id: 'create-pr', queues: [{ leg: 'implement' }] }] } }))).toBeNull();
  });

  it('a course the repository does not run, and a course with no leg at all, are named as such', () => {
    expect(at(['agent-venue'], board(), 'bug-report')).toMatch(/baton runs create-pr, not bug-report/);
    const empty = board({ repository: { id: 'baton', courses: [{ id: 'bug-report' }] } });
    expect(at(['agent-venue'], empty, 'bug-report')).toMatch(/runs no leg of bug-report with a queue/);
  });
});

describe('startup (B-86: the grant declares unless --capabilities narrows)', () => {
  const api = (answer: unknown) => ({ boardView: vi.fn(async () => answer as Record<string, any>) });
  const granted = ['authentication', 'create-pr', 'drivable-browser', 'llm-call', 'none'];
  const clauses = [{ leg: 'implement', requires: 'create-pr' }, { leg: 'release', requires: 'npm-publish' }];

  it('no flag: the first declaration is the grant’s own capabilities, which the board names', async () => {
    expect(await startup(api(board({ granted_capabilities: granted })), { repository: 'baton', capabilities: null }, 'create-pr', () => [{ leg: 'implement', requires: 'create-pr' }]))
      .toEqual({ declare: granted, line: null });
  });

  it('--capabilities narrows: a declaration that matches nothing gets the one line, and stays the declaration', async () => {
    const s = await startup(api(board({ granted_capabilities: granted })), { repository: 'baton', capabilities: ['llm-call'] }, 'create-pr', () => clauses);
    expect(s.declare).toEqual(['llm-call']);
    expect(s.line).toMatch(/^baton: this runner can never claim: it declares llm-call/);
    expect(s.line).toContain('--capabilities llm-call narrows');
  });

  it('a grant narrower than the legs is named as such, with no advice to drop a flag that was never passed', async () => {
    const s = await startup(api(board({ granted_capabilities: ['authentication', 'llm-call', 'none'] })), { repository: 'baton', capabilities: null }, 'create-pr', () => clauses);
    expect(s.declare).toEqual(['authentication', 'llm-call', 'none']);
    expect(s.line).toMatch(/^baton: this runner can never claim: it declares authentication, llm-call, none/);
    expect(s.line).not.toContain('--capabilities');
  });

  it('an unread declaration says nothing: an ungranted key, an empty grant and a transient failure all leave it to the heartbeat', async () => {
    // A key no grant binds (a bearer token's): agent-venue, as before, and no line.
    expect(await startup(api(board()), { repository: 'baton', capabilities: null }, 'create-pr', () => clauses))
      .toEqual({ declare: null, line: null });
    expect(await startup(api(board({ granted_capabilities: [] })), { repository: 'baton', capabilities: null }, 'create-pr', () => clauses))
      .toEqual({ declare: null, line: null });
    // A transport failure, and an older server with no such route: nothing said, nothing declared.
    const offline = { boardView: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) };
    expect(await startup(offline as any, { repository: 'baton', capabilities: null }, 'create-pr', () => clauses)).toEqual({ declare: null, line: null });
    const older = { boardView: vi.fn(async () => { throw new BatonRefusal('not-found', undefined, 'no route GET /v1/repositories/baton/board', 404); }) };
    expect(await startup(older as any, { repository: 'baton', capabilities: null }, 'create-pr', () => clauses)).toEqual({ declare: null, line: null });
    // A transient `unavailable` is no verdict either.
    const busy = { boardView: vi.fn(async () => { throw new BatonRefusal('unavailable', undefined, 'the store is busy', 503); }) };
    expect(await startup(busy as any, { repository: 'baton', capabilities: null }, 'create-pr', () => clauses)).toEqual({ declare: null, line: null });
    // The flag stands whatever the board says.
    expect((await startup(offline as any, { repository: 'baton', capabilities: ['llm-call'] }, 'create-pr', () => clauses)).declare).toEqual(['llm-call']);
  });

  it('a refusal is Baton’s own words, never a verdict of ineligibility; an ungranted key’s is not even that', async () => {
    const revoked = { boardView: vi.fn(async () => { throw new BatonRefusal('forbidden', undefined, 'the key is not granted on baton (R-BTN-58)', 403); }) };
    expect(await startup(revoked as any, { repository: 'baton', capabilities: null }, 'create-pr', () => clauses)).toEqual({ declare: null, line: null });
    const unknown = { boardView: vi.fn(async () => { throw new BatonRefusal('unauthenticated', undefined, 'this credential is not registered or is revoked', 401); }) };
    const s = await startup(unknown as any, { repository: 'baton', capabilities: null }, 'create-pr', () => clauses);
    expect(s.line).toMatch(/^baton: Baton refused the board of baton \(unauthenticated: /);
    expect(s.line).not.toMatch(/^baton: this runner can never claim/);
  });

  it('a fault in the caller’s clauses is no startup line, never a crash', async () => {
    expect(await startup(api(board({ granted_capabilities: granted })), { repository: 'baton', capabilities: null }, 'create-pr', () => { throw new TypeError('x'); }))
      .toEqual({ declare: granted, line: null });
  });
});
