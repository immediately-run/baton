// ticket-state.test.ts — B-100 (BATON_SPEC §5.8, R-BTN-83 as amended): the marker courses' state
// is the ticket itself. The station function places each ticket from the closes its own git
// history holds (a close that is not an edge is ignored); a migration's frontmatter state stands
// where no history does; `closeTicket` writes the machine state into the ticket's frontmatter,
// validates it against the repository's item schema and its own heading, commits the file alone
// on the default branch and pushes — and a mangled or forged ticket fails the leg, naming the
// rule.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PostedTicket } from '../../src/core/board';
import { migrateMarkersMain } from '../../src/defaults/cli';
import {
  CLOSES_MAX, MACHINE_KEYS, PUSH_TRIES, bareTicketId, checkFrontmatter, checkMachine, closesOfHistory, closeTicket,
  legHeadingPresent, machineOf, setMachineKeys, stationsTickets, ticketsBranch, type TicketClose,
} from '../../src/defaults/ticket-state';
import { parseFrontmatter } from '../../src/defaults/tickets-markdown';
import { BUG_REPORT_COURSE, DECISION_COURSE, builtIn } from '../../src/defaults/courses';

const ticket = (id: string, over: Partial<PostedTicket> & { course?: Record<string, unknown> } = {}) =>
  ({ id, course_id: 'bug-report', path: `tickets/${id}.md`, title: id, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [], rank: null, ...over });
const c = (leg: string, reached: string, next: string | null = null): TicketClose => ({ ticket: 'B-1', leg, reached, next, claim: 'n' });
const place = (closes: TicketClose[], tickets = [ticket('B-1')], graph: any = BUG_REPORT_COURSE, done = new Set<string>()) =>
  stationsTickets({ tickets: tickets.map((t) => ({ ...t, course: { ...(t.course ?? {}), closes: closes.filter((x) => x.ticket === t.id) } })), closed: new Set(), done, graph }).stations;

describe('stationsTickets (R-BTN-131, B-100)', () => {
  it('no close: the start, its start leg ready — or waiting on a dependency not done or an open child', () => {
    expect(place([])['B-1']).toEqual({
      station: 'reported', path: [], next_leg: 'trace', next_source: 'course', handoff_url: null,
      next: [{ leg: 'trace', state: 'ready', waiting_on: null }], bars: {},
    });
    expect(place([], [ticket('B-1', { depends_on: ['B-0'] })])['B-1'].next).toEqual([{ leg: 'trace', state: 'waiting', waiting_on: 'dependencies' }]);
    expect(place([], [ticket('B-1', { depends_on: ['B-0'] })], BUG_REPORT_COURSE, new Set(['B-0']))['B-1'].next[0].state).toBe('ready');
    expect(place([], [ticket('B-1', { blocked_by: ['B-2'] })])['B-1'].next[0].waiting_on).toBe('children');
  });

  it('a migration\'s frontmatter state stands where no close history does', () => {
    const migrated = ticket('B-1', { course: { station: 'explained', next_leg: 'dedupe', claim: 'm1' } });
    expect(place([], [migrated])['B-1']).toMatchObject({ station: 'explained', path: [], next_leg: 'dedupe', next_source: 'marker', next: [{ leg: 'dedupe', state: 'ready', waiting_on: null }] });
    // A hand-set station that names no station the course has, or carries no closing `claim`
    // (the one writer's signature — round 1, finding 9), is the course's to ignore: the ticket
    // stands at its start (nothing in git says otherwise).
    expect(place([], [ticket('B-1', { course: { station: 'elsewhere', claim: 'x' } })])['B-1']).toMatchObject({ station: 'reported', next_leg: 'trace' });
    expect(place([], [ticket('B-1', { course: { station: 'explained' } })])['B-1']).toMatchObject({ station: 'reported', next_leg: 'trace' });
  });

  it('follows the closes in order; the queued leg is the last close\'s next (marker), an outcome picks the branch', () => {
    const at = place([c('trace', 'traced', 'origin'), c('origin', 'explained', 'dedupe'), c('dedupe', 'duplicate', 'fold')])['B-1'];
    expect(at.station).toBe('duplicate');
    expect(at.path).toEqual([{ leg: 'trace', reached: 'traced' }, { leg: 'origin', reached: 'explained' }, { leg: 'dedupe', reached: 'duplicate' }]);
    expect(at).toMatchObject({ next_leg: 'fold', next_source: 'marker', next: [{ leg: 'fold', state: 'ready', waiting_on: null }] });
  });

  it('a close that is not an edge is ignored: a leg not leaving the station, an unreachable station, another ticket\'s', () => {
    const at = place([
      c('origin', 'explained'), // origin does not leave `reported`
      c('trace', 'closed'), // trace cannot reach `closed`
      { ticket: 'B-2', leg: 'trace', reached: 'traced' }, // another ticket's
      c('constructor', 'traced'), // an inherited name is no leg
      c('__proto__', 'traced'),
      c('trace', 'traced', 'origin'),
    ])['B-1'];
    expect(at.path).toEqual([{ leg: 'trace', reached: 'traced' }]);
    expect(at.next_leg).toBe('origin');
  });

  it('a next that does not leave the station falls back to the course file\'s first leg (course)', () => {
    expect(place([c('trace', 'traced', 'prevent')])['B-1']).toMatchObject({ next_leg: 'origin', next_source: 'course' });
  });

  it('an end station is done: no next leg', () => {
    const run = [c('trace', 'traced'), c('origin', 'explained'), c('dedupe', 'new-cause'), c('file', 'ticketed'), c('prevent', 'closed')];
    expect(place(run)['B-1']).toMatchObject({ station: 'closed', next_leg: null, next: [] });
  });

  it('a leg past its max_runs is ignored and not offered', () => {
    const graph = { start: 'a', start_leg: 'go', end: ['z'], legs: { go: { from: ['a'], to: 'b' }, again: { from: ['b'], to: 'b', max_runs: 1 }, finish: { from: ['b'], to: 'z' } } };
    const at = place([c('go', 'b'), c('again', 'b', 'again'), c('again', 'b', 'again')], [ticket('B-1')], graph)['B-1'];
    expect(at.path).toHaveLength(2);
    expect(at).toMatchObject({ next_leg: 'finish', next_source: 'course', next: [{ leg: 'finish', state: 'ready', waiting_on: null }] });
  });

  it('a closed ticket is not placed', () => {
    expect(stationsTickets({ tickets: [ticket('B-1')], closed: new Set(['B-1']), graph: BUG_REPORT_COURSE }).stations).toEqual({});
  });

  it('decision: carry-out waits on the owner until the ticket\'s answer is set and not `open`', () => {
    const stations = builtIn('decision')!.stations;
    const ctx = (answer?: string) => ({
      tickets: [ticket('D-1', { course_id: 'decision', course: { answer, closes: [c('prepare', 'asked', 'carry-out')] } })], closed: new Set<string>(), done: new Set<string>(),
      facts: [], branchPatterns: [], repository: null, graph: DECISION_COURSE,
    });
    expect(stations(ctx()).stations['D-1'].next).toEqual([{ leg: 'carry-out', state: 'waiting', waiting_on: 'owner' }]);
    expect(stations(ctx('open')).stations['D-1'].next[0].waiting_on).toBe('owner');
    expect(stations(ctx('b — and keep the old flag')).stations['D-1'].next).toEqual([{ leg: 'carry-out', state: 'ready', waiting_on: null }]);
  });
});

describe('the machine state in frontmatter', () => {
  const text = `---\nid: B-1\ntitle: T\n---\n\n## trace\n\nThe work.\n`;

  it('setMachineKeys writes station, next_leg and claim, preserves every other byte, and removes a null next_leg', () => {
    const one = setMachineKeys(text, { station: 'traced', next_leg: 'origin', claim: 'n9' });
    expect(one).toBe(`---\nid: B-1\ntitle: T\nstation: traced\nnext_leg: origin\nclaim: n9\n---\n\n## trace\n\nThe work.\n`);
    expect(machineOf(parseFrontmatter(one))).toEqual({ station: 'traced', next_leg: 'origin', claim: 'n9' });
    // A malformed block-list machine value goes whole: its `- item` continuations are removed
    // with the key, never left dangling under the key above (round 1, finding 6; round 2, 3).
    const listed = setMachineKeys('---\nid: B-1\ntitle: T\nstation:\n  - closed\n---\n\n## trace\n', { station: 'traced', next_leg: null, claim: null });
    expect(listed).toBe('---\nid: B-1\ntitle: T\nstation: traced\n---\n\n## trace\n');
    // CRLF is preserved: the block keeps its own line endings (round 1, finding 6).
    const crlf = setMachineKeys('---\r\nid: B-1\r\ntitle: T\r\n---\r\n\r\n## trace\r\n', { station: 'traced', next_leg: 'origin', claim: 'n9' });
    expect(crlf).toBe('---\r\nid: B-1\r\ntitle: T\r\nstation: traced\r\nnext_leg: origin\r\nclaim: n9\r\n---\r\n\r\n## trace\r\n');
    const again = setMachineKeys(one, { station: 'closed', next_leg: null, claim: null });
    expect(again).toBe(`---\nid: B-1\ntitle: T\nstation: closed\n---\n\n## trace\n\nThe work.\n`);
    // Absent keys read as absent; `null` arrives only from a key written as a literal null.
    expect(machineOf(parseFrontmatter(again))).toEqual({ station: 'closed' });
  });

  it('legHeadingPresent matches this leg\'s own heading alone, case-insensitive; anything else is absent', () => {
    expect(legHeadingPresent(text, 'trace')).toBe(true);
    expect(legHeadingPresent(text, 'TRACE')).toBe(true);
    expect(legHeadingPresent(text, 'origin')).toBe(false);
    expect(legHeadingPresent(`---\nid: B-1\n---\n\n## traced further\n`, 'trace')).toBe(false);
  });

  it('checkMachine names a station, leg or nonce of the wrong shape', () => {
    expect(checkMachine({ station: 'traced', next_leg: 'origin', claim: 'n1' })).toEqual([]);
    expect(checkMachine({ station: 'Traced!', next_leg: null, claim: null })).toEqual(['station "Traced!" is not a station id']);
    expect(checkMachine({ station: 'a', next_leg: 'not a leg', claim: null })).toEqual(['next_leg "not a leg" is not a leg id']);
    expect(checkMachine({ station: 'a', next_leg: null, claim: 'a b' })).toEqual(['claim is not a nonce']);
  });

  it('checkFrontmatter ignores the machine keys the close owns, so a schema that does not know them still passes (round 1, finding 2)', () => {
    const schema = {
      required: ['title', 'id'],
      propertyNames: { enum: ['title', 'id', 'status'] },
    };
    const fm = { title: 'T', id: 'B-1', status: 'available', station: 'traced', next_leg: 'origin', claim: 'n1' };
    expect(checkFrontmatter(schema, fm)).toEqual(['the ticket has an unknown key station', 'the ticket has an unknown key next_leg', 'the ticket has an unknown key claim']);
    expect(checkFrontmatter(schema, fm, MACHINE_KEYS)).toEqual([]);
  });

  it('checkFrontmatter applies the item schema\'s keywords and names each violation; an unimplemented keyword fails closed', () => {
    const schema = {
      required: ['title', 'id'],
      properties: { id: { type: 'string', pattern: '^B-\\d+$' }, status: { enum: ['available', 'done'] } },
      propertyNames: { enum: ['title', 'id', 'status', 'station', 'next_leg', 'claim'] },
    };
    expect(checkFrontmatter(schema, { title: 'T', id: 'B-1', status: 'available', station: 'x' })).toEqual([]);
    expect(checkFrontmatter(schema, { id: 'B-1', status: 'available' })).toEqual(['the ticket has no title']);
    expect(checkFrontmatter(schema, { title: 'T', id: 'B-1', status: 'live' })).toEqual(['status "live" is not one of available, done']);
    expect(checkFrontmatter(schema, { title: 'T', id: 'x1', status: 'available' })).toEqual(['id "x1" does not match ^B-\\d+$']);
    expect(checkFrontmatter(schema, { title: 'T', id: 'B-1', status: 'available', extra: 1 })).toEqual(['the ticket has an unknown key extra']);
    expect(checkFrontmatter({ ...schema, properties: { id: { type: 'string', minimum: 0 } } }, { title: 'T', id: 'B-1' })).toEqual(['id: the property uses "minimum", which the boundary check does not implement']);
    const withRef = { ...schema, definitions: { itemId: { type: 'string', pattern: '^B-\\d+$' } }, properties: { ...schema.properties, id: { $ref: '#/definitions/itemId' } } };
    expect(checkFrontmatter(withRef, { title: 'T', id: 'B-1', status: 'available' })).toEqual([]);
    expect(checkFrontmatter(withRef, { title: 'T', id: 'x', status: 'available' })).toEqual(['id "x" does not match ^B-\\d+$']);
  });
});

describe('closeTicket', () => {
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  /** A bare remote with one commit carrying the tickets and their schema, and `n` clones. */
  const remote = (n: number, files: Record<string, string> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'baton-tclose-'));
    const bare = join(root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    const seed = join(root, 'seed');
    execFileSync('git', ['clone', '-q', bare, seed], { stdio: 'ignore' });
    mkdirSync(join(seed, 'tickets'), { recursive: true });
    writeFileSync(join(seed, 'tickets', 'B-1.md'), files['tickets/B-1.md'] ?? `---\nid: B-1\ntitle: The save button does nothing\n---\n\n## trace\n\nThe work.\n`);
    writeFileSync(join(seed, 'tickets', 'B-2.md'), files['tickets/B-2.md'] ?? `---\nid: B-2\ntitle: Another\n---\n\n## trace\n\nThe work.\n`);
    writeFileSync(join(seed, 'tickets', 'item.schema.json'), JSON.stringify({
      required: ['title', 'id'],
      properties: { id: { type: 'string', pattern: '^B-\\d+$' }, title: { type: 'string' } },
      propertyNames: { enum: ['title', 'id', 'status', 'station', 'next_leg', 'claim'] },
    }));
    git(seed, 'config', 'user.email', 't@t');
    git(seed, 'config', 'user.name', 't');
    git(seed, 'add', '-A');
    git(seed, 'commit', '-qm', 'seed');
    git(seed, 'push', '-q', 'origin', 'main');
    const clones = Array.from({ length: n }, (_, i) => {
      const cl = join(root, `c${i}`);
      execFileSync('git', ['clone', '-q', bare, cl], { stdio: 'ignore' });
      git(cl, 'config', 'user.email', 't@t');
      git(cl, 'config', 'user.name', 't');
      return cl;
    });
    return { root, bare, seed, clones };
  };

  it('writes the machine state into the ticket alone, commits on the default branch and pushes; the history is the record the station function reads', async () => {
    const { root, seed, clones: [cl] } = remote(1);
    try {
      const sha = await closeTicket({ checkout: cl, ticket: { id: 'docs:B-1', home: 'docs', path: 'tickets/B-1.md' }, leg: 'trace', claim: { nonce: 'n9' } }, { reached: 'traced', next: 'origin' });
      git(seed, 'pull', '-q', 'origin', 'main');
      expect(git(seed, 'show', '--name-only', '--format=', 'HEAD')).toBe('tickets/B-1.md');
      expect(git(seed, 'log', '-1', '--format=%s')).toBe('baton:close B-1 trace');
      expect(readFileSync(join(seed, 'tickets', 'B-1.md'), 'utf8')).toBe(`---\nid: B-1\ntitle: The save button does nothing\nstation: traced\nnext_leg: origin\nclaim: n9\n---\n\n## trace\n\nThe work.\n`);
      // The ticket's own history is the record: closesOfHistory reads it back, and the station
      // function places from it.
      const closes = closesOfHistory((args) => git(seed, ...args), 'B-1', 'tickets/B-1.md');
      expect(closes).toEqual([{ ticket: 'B-1', leg: 'trace', reached: 'traced', next: 'origin', claim: 'n9' }]);
      expect(place(closes)['B-1']).toMatchObject({ station: 'traced', next_leg: 'origin' });
      expect(sha).toBe(git(seed, 'rev-parse', 'HEAD'));
      expect(bareTicketId({ id: 'B-1' })).toBe('B-1');
      expect(bareTicketId({ id: 'ops:B-1' })).toBe('B-1');
      await expect(closeTicket({ checkout: cl, ticket: { id: 'B-1', path: 'tickets/B-1.md' }, leg: 'trace' }, {})).rejects.toThrow('the trace leg returned no station reached');
      await expect(closeTicket({ checkout: cl, ticket: { id: 'B-1' }, leg: 'trace' }, { reached: 'traced' })).rejects.toThrow('no file path');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('a ticket the agent mangled fails the leg naming the rule: a missing heading, a broken schema, no frontmatter', async () => {
    const noHeading = remote(1, { 'tickets/B-1.md': `---\nid: B-1\ntitle: T\n---\n\nThe agent wrote no section.\n` });
    try {
      await expect(closeTicket({ checkout: noHeading.clones[0], ticket: { id: 'B-1', path: 'tickets/B-1.md' }, leg: 'trace' }, { reached: 'traced' })).rejects.toThrow(`the ticket has no '## trace' heading`);
    } finally {
      rmSync(noHeading.root, { recursive: true, force: true });
    }
    const brokenSchema = remote(1, { 'tickets/B-1.md': `---\nid: B-1\nstatus: live\n---\n\n## trace\n\nThe work.\n` });
    try {
      // `title` is required and absent; the seed's schema has no `status` property to check —
      // the required list is the rule that names this one.
      await expect(closeTicket({ checkout: brokenSchema.clones[0], ticket: { id: 'B-1', path: 'tickets/B-1.md' }, leg: 'trace' }, { reached: 'traced' })).rejects.toThrow('the ticket has no title');
    } finally {
      rmSync(brokenSchema.root, { recursive: true, force: true });
    }
    const badSchema = remote(1);
    try {
      // A schema that is present but unreadable fails the check closed (round 2, finding 1):
      // never silently skipped.
      const path = join(badSchema.seed, 'tickets', 'item.schema.json');
      writeFileSync(path, '{ not json');
      execFileSync('git', ['-C', badSchema.seed, 'add', '-A'], { stdio: 'ignore' });
      execFileSync('git', ['-C', badSchema.seed, 'commit', '-qm', 'break the schema'], { stdio: 'ignore' });
      execFileSync('git', ['-C', badSchema.seed, 'push', '-q', 'origin', 'main'], { stdio: 'ignore' });
      execFileSync('git', ['-C', badSchema.clones[0], 'pull', '-q', 'origin', 'main'], { stdio: 'ignore' });
      await expect(closeTicket({ checkout: badSchema.clones[0], ticket: { id: 'B-1', path: 'tickets/B-1.md' }, leg: 'trace' }, { reached: 'traced' })).rejects.toThrow('is not a schema the close can check');
    } finally {
      rmSync(badSchema.root, { recursive: true, force: true });
    }
    const noFrontmatter = remote(1, { 'tickets/B-1.md': `just prose, no fence\n` });
    try {
      await expect(closeTicket({ checkout: noFrontmatter.clones[0], ticket: { id: 'B-1', path: 'tickets/B-1.md' }, leg: 'trace' }, { reached: 'traced' })).rejects.toThrow('no frontmatter block');
    } finally {
      rmSync(noFrontmatter.root, { recursive: true, force: true });
    }
  }, 120_000);

  it('a forged station is overwritten by the claim\'s own state: the close is the one writer', async () => {
    const forged = remote(1, { 'tickets/B-1.md': `---\nid: B-1\ntitle: T\nstation: closed\nnext_leg: null\nclaim: fake\n---\n\n## trace\n\nThe work.\n` });
    try {
      await closeTicket({ checkout: forged.clones[0], ticket: { id: 'B-1', path: 'tickets/B-1.md' }, leg: 'trace', claim: { nonce: 'real' } }, { reached: 'traced', next: 'origin' });
      git(forged.seed, 'pull', '-q', 'origin', 'main');
      expect(machineOf(parseFrontmatter(readFileSync(join(forged.seed, 'tickets', 'B-1.md'), 'utf8')))).toEqual({ station: 'traced', next_leg: 'origin', claim: 'real' });
    } finally {
      rmSync(forged.root, { recursive: true, force: true });
    }
  }, 60_000);

  it('two closes racing on one remote both land: each ticket is its own file, and the loser rebuilds on the winner\'s parent', async () => {
    const { root, seed, clones: [a, b] } = remote(2);
    try {
      await closeTicket({ checkout: a, ticket: { id: 'docs:B-1', home: 'docs', path: 'tickets/B-1.md' }, leg: 'trace', claim: { nonce: 'a' } }, { reached: 'traced', next: 'origin' });
      // b has not fetched a's commit: its push is refused, it refetches, rebuilds on the new
      // parent and both tickets carry their state.
      await closeTicket({ checkout: b, ticket: { id: 'docs:B-2', home: 'docs', path: 'tickets/B-2.md' }, leg: 'trace', claim: { nonce: 'b' } }, { reached: 'traced', next: 'origin' });
      expect(git(b, 'status', '--porcelain')).toBe('');
      git(seed, 'pull', '-q', 'origin', 'main');
      expect(machineOf(parseFrontmatter(readFileSync(join(seed, 'tickets', 'B-1.md'), 'utf8')))).toMatchObject({ station: 'traced', claim: 'a' });
      expect(machineOf(parseFrontmatter(readFileSync(join(seed, 'tickets', 'B-2.md'), 'utf8')))).toMatchObject({ station: 'traced', claim: 'b' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('closesOfHistory bounds itself at CLOSES_MAX and answers nothing for a checkout git cannot read', () => {
    const calls: string[][] = [];
    const run = (args: string[]): string => {
      calls.push(args);
      if (args[0] === 'log') {
        const lines = Array.from({ length: CLOSES_MAX + 5 }, (_, i) => `${(i).toString(16).padStart(40, '0')}\tbaton:close B-1 trace`);
        lines.push(`${'f'.repeat(40)}\tan ordinary commit`);
        return lines.join('\n');
      }
      return '---\nstation: traced\nnext_leg: origin\n---\n';
    };
    // The log holds more closes than the bound: the fold keeps the first CLOSES_MAX, oldest first.
    const out = closesOfHistory(run, 'B-1', 'tickets/B-1.md');
    expect(out).toHaveLength(CLOSES_MAX);
    expect(out[0]).toMatchObject({ ticket: 'B-1', leg: 'trace', reached: 'traced', next: 'origin' });
    const failing = (): string => {
      throw new Error('not a repository');
    };
    expect(closesOfHistory(failing, 'B-1', 'tickets/x.md')).toEqual([]);
  });

  it('only a refused push is retried, at most PUSH_TRIES times; any other failure throws at once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-tclose-'));
    const refused = Object.assign(new Error('Command failed: git push'), { stderr: ' ! [rejected]        abc -> main (fetch first)\nerror: failed to push some refs to \'origin\'' });
    const fake = (onPush: () => void) => {
      const calls: string[] = [];
      const run = (cmd: string, args: string[]): string => {
        calls.push(args[0] === 'push' ? 'push' : args[0] === 'fetch' ? 'fetch' : args[0]);
        if (args[0] === 'push') onPush();
        if (args[0] === 'rev-parse' && args[1] === '--git-path') return '.git/baton-ticket-index';
        if (args[0] === 'rev-parse') return 'abc123';
        if (args[0] === 'show') return args[1]?.includes('item.schema') ? '{}' : `---\nid: B-1\ntitle: T\n---\n\n## trace\n\nThe work.\n`;
        return '';
      };
      return { calls, run };
    };
    const close = (run: (cmd: string, args: string[]) => string) => closeTicket({ checkout: dir, ticket: { id: 'B-1', path: 'tickets/B-1.md' }, leg: 'trace' }, { reached: 'traced' }, run as never);
    try {
      const always = fake(() => { throw refused; });
      await expect(close(always.run)).rejects.toThrow('git push');
      expect(always.calls.filter((x) => x === 'push')).toHaveLength(PUSH_TRIES);
      expect(always.calls.filter((x) => x === 'fetch')).toHaveLength(PUSH_TRIES);

      const other = fake(() => { throw Object.assign(new Error('Command failed'), { stderr: 'fatal: could not read from remote repository' }); });
      await expect(close(other.run)).rejects.toThrow('Command failed');
      expect(other.calls.filter((x) => x === 'push')).toEqual(['push']);

      // A hook or protected branch refuses: `[remote rejected]`, with git's summary line after it.
      const declined = fake(() => { throw Object.assign(new Error('Command failed: git push'), { stderr: ' ! [remote rejected] abc -> main (pre-receive hook declined)\nerror: failed to push some refs to \'origin\'' }); });
      await expect(close(declined.run)).rejects.toThrow('git push');
      expect(declined.calls.filter((x) => x === 'push')).toEqual(['push']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ticketsBranch names the caller\'s word, else origin/HEAD, else main', () => {
    const run = (_cmd: string, args: string[]): string => {
      if (args[0] === 'symbolic-ref') return 'origin/release/1.0';
      throw new Error('no');
    };
    const failing = (_cmd: string, _args: string[]): string => {
      throw new Error('no origin');
    };
    expect(ticketsBranch('/x', 'dev')).toBe('dev');
    expect(ticketsBranch('/x', null, run)).toBe('release/1.0');
    expect(ticketsBranch('/x', 'not a branch', failing)).toBe('main');
  });
});

describe('migrateMarkersMain (B-100)', () => {
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  /** A repository on the marker courses with in-flight marker lines to fold. */
  const repo = () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-migrate-'));
    const bare = join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    const dir = join(root, 'work');
    execFileSync('git', ['clone', '-q', bare, dir], { stdio: 'ignore' });
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    mkdirSync(join(dir, 'tickets'), { recursive: true });
    mkdirSync(join(dir, '.baton', 'courses', 'bug-report'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'courses', 'bug-report', 'course.json'), JSON.stringify(BUG_REPORT_COURSE));
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ items: 'tickets', default_course: 'bug-report', courses: [{ id: 'bug-report', version: 1, min_worker_version: 1 }] }));
    writeFileSync(join(dir, 'tickets', 'b1.md'), '---\nid: B-1\ntitle: The save button\ncourse: bug-report\n---\n\n## trace\n\nThe work.\n');
    writeFileSync(join(dir, 'tickets', 'b2.md'), '---\nid: B-2\ntitle: Folded already\nstatus: done\ncourse: bug-report\n---\n\n## trace\n\nThe work.\n');
    writeFileSync(join(dir, 'tickets', 'b3.md'), '---\nid: B-3\ntitle: A PR ticket\ncourse: create-pr\n---\n');
    mkdirSync(join(dir, '.baton', 'courses', 'create-spec'), { recursive: true });
    writeFileSync(join(dir, 'tickets', 's1.md'), '---\nid: S-1\ntitle: Specify the export format\ncourse: create-spec\n---\n\nWrite down what an export file must contain.\n');
    writeFileSync(join(dir, '.baton', 'markers.jsonl'), [
      '{"ticket":"B-1","leg":"trace","reached":"traced","next":"origin","claim":"n1"}',
      '{"ticket":"B-1","leg":"origin","reached":"explained","next":"dedupe","claim":"n2"}',
      '{"ticket":"B-1","leg":"prevent","reached":"closed"}', // not an edge from `explained`: ignored
      '{"ticket":"B-2","leg":"trace","reached":"traced","next":"origin","claim":"old"}', // a closed ticket: dropped
      '{"ticket":"B-3","leg":"implement","reached":"pr-open"}', // a PR course's: dropped
      'not json', // skipped, reported
    ].join('\n') + '\n');
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'seed'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'push', '-q', 'origin', 'main'], { stdio: 'ignore' });
    return { root, dir, bare };
  };

  it('folds in-flight lines into their tickets\' frontmatter, drops the rest, and deletes the file — once', async () => {
    const { root, dir, bare } = repo();
    try {
      const lines: string[] = [];
      expect(await migrateMarkersMain([], { root: dir, log: (l) => lines.push(l) })).toBe(0);
      expect(readFileSync(join(dir, 'tickets', 'b1.md'), 'utf8')).toBe('---\nid: B-1\ntitle: The save button\ncourse: bug-report\nstation: closed\n---\n\n## trace\n\nThe work.\n');
      expect(readFileSync(join(dir, 'tickets', 'b2.md'), 'utf8')).not.toContain('station:');
      expect(existsSync(join(dir, '.baton', 'markers.jsonl'))).toBe(false);
      expect(lines.some((l) => l.includes('B-1 → 3 close(s) replayed, station closed'))).toBe(true);
      expect(lines.some((l) => l.includes("B-2's lines dropped"))).toBe(true);
      expect(lines.some((l) => l.includes('B-3\'s lines dropped'))).toBe(true);
      expect(lines.some((l) => l.includes('skipped — not JSON'))).toBe(true);
      // One commit, pushed: origin carries the fold.
      expect(git(dir, 'log', '-1', '--format=%s')).toBe('baton: markers.jsonl folded into the tickets (B-100)');
      expect(git(bare, 'log', '-1', '--format=%s')).toBe('baton: markers.jsonl folded into the tickets (B-100)');
      // And the replayed history is what the station function folds — a migrated ticket's next
      // close folds from where the migration left it, never from `start` (round 1, finding 1).
      // The raw last line (the off-graph `prevent`) wrote its state too; the fold ignores it,
      // exactly as it ignores a native close that is no edge.
      const fm = parseFrontmatter(readFileSync(join(dir, 'tickets', 'b1.md'), 'utf8'));
      expect(machineOf(fm)).toEqual({ station: 'closed' });
      const replayed = closesOfHistory((args) => git(dir, ...args), 'B-1', 'tickets/b1.md');
      expect(replayed.map((x) => [x.leg, x.reached])).toEqual([['trace', 'traced'], ['origin', 'explained'], ['prevent', 'closed']]);
      expect(place(replayed)['B-1']).toMatchObject({ station: 'explained', next_leg: 'dedupe' });
      // A second run has nothing to migrate.
      expect(await migrateMarkersMain([], { root: dir, log: () => {} })).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
