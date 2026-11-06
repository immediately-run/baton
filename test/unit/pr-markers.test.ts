// pr-markers.test.ts — B-110's run-tests markers: the trailer parsing (a message's last
// paragraph, last occurrence per key), a marker's shape (an empty-tree commit on the head it
// names), its verification against Baton's record (the claim's nonce and its advance's evidence
// sha — round 1, finding 3: a marker is a record, never the authority), the gate read by commit
// order (finding 17), and the plain-git variant end to end (finding 12) — a real branch, its
// commits read from the checkout's own git (`gh` nowhere in sight), the run-tests close pushing a
// marker and the station function reading it back. S-BTN-43's gate, at the unit level.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitsOf, gateOfBranch, markerOf, trailersOf, verifiedMarkers, type BranchCommit } from '../../src/defaults/pr-markers';
import { testsClose } from '../../src/defaults/pr-close';
import { CREATE_PR_COURSE, stationsPr } from '../../src/defaults/course-pr';
import type { SourceTicket as PostedTicket } from '../../src/defaults/tickets-markdown';

describe('trailersOf — a commit message\'s trailer block', () => {
  it('reads the last paragraph, last occurrence per key; prose and continuations are none', () => {
    expect(trailersOf('a subject\n\nBaton-Tests: green\nBaton-Claim: n1')).toEqual({ 'Baton-Tests': 'green', 'Baton-Claim': 'n1' });
    expect(trailersOf('a subject\n\nsome prose\n\nBaton-Tests: red')).toEqual({ 'Baton-Tests': 'red' });
    expect(trailersOf('a subject\n\nBaton-Tests: green\n\nBaton-Tests: red')).toEqual({ 'Baton-Tests': 'red' });
    // A continuation line is not a trailer of its own; a prose-only message has none.
    expect(trailersOf('work\n\nBaton-Tests: green\n  continued prose\nSigned-off-by: someone')).toEqual({ 'Baton-Tests': 'green', 'Signed-off-by': 'someone' });
    expect(trailersOf('just a subject')).toEqual({});
  });
});

describe('markerOf, verifiedMarkers and gateOfBranch', () => {
  const sha = (c: string) => c.repeat(40);
  const msg = (tests: string, tested: string, claim = 'n1') => `baton: tests ${tests} for B-1\n\nBaton-Tests: ${tests}\nBaton-Tested: ${tested}\nBaton-Claim: ${claim}`;
  const head: BranchCommit = { sha: sha('a'), at: 1, parent: null, empty: false, message: 'work' };
  const green: BranchCommit = { sha: sha('b'), at: 2, parent: sha('a'), empty: true, message: msg('green', sha('a')) };

  it('a marker is an empty-tree commit on the head it names, with all three trailers', () => {
    expect(markerOf(green)).toEqual({ sha: sha('b'), at: 2, tests: 'green', tested: sha('a'), claim: 'n1' });
    expect(markerOf({ ...green, empty: false })).toBeNull(); // content carrying trailers is a push
    expect(markerOf({ ...green, parent: sha('c') })).toBeNull(); // not on the head it names
    expect(markerOf({ ...green, message: 'baton: tests green\n\nBaton-Tests: green\nBaton-Tested: ' + sha('a') })).toBeNull(); // no claim
  });

  it('counts only the evidence Baton recorded for the claim the marker names', () => {
    const record = [{ ticket: 'B-1', leg: 'run-tests', claim_nonce: 'n1', evidence: sha('b') }];
    expect(verifiedMarkers([head, green], 'B-1', record)).toHaveLength(1);
    expect(verifiedMarkers([head, green], 'B-2', record)).toEqual([]); // another ticket's record
    expect(verifiedMarkers([head, green], 'B-1', [{ ...record[0], evidence: sha('c') }])).toEqual([]); // a nonce copied onto a forged commit
    expect(verifiedMarkers([head, green], 'B-1', [{ ...record[0], leg: 'review' }])).toEqual([]);
  });

  it('the gate is the newest counted marker that tested the content head, by order', () => {
    const counted = verifiedMarkers([head, green], 'B-1', [{ ticket: 'B-1', leg: 'run-tests', claim_nonce: 'n1', evidence: sha('b') }]);
    expect(gateOfBranch([head, green], counted)).toBe('green');
    // A later content commit — whatever its date — re-opens it.
    expect(gateOfBranch([head, green, { sha: sha('d'), at: 0, parent: sha('b'), empty: false, message: 'late' }], counted)).toBe('open');
    expect(gateOfBranch([head], [])).toBe('open');
  });
});

/** One fixture repository: a bare origin and a clone whose PR branch the gate marks. */
class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'baton-b110-'));
  readonly origin = mkdtempSync(join(tmpdir(), 'baton-b110-origin-'));
  private n = 0;
  constructor() {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.origin], { stdio: 'ignore' });
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'b110@test'], ['config', 'user.name', 'b110'], ['remote', 'add', 'origin', this.origin]]) {
      execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
    }
  }
  git(...args: string[]): string {
    return execFileSync('git', ['-C', this.dir, ...args], { encoding: 'utf8' }).trim();
  }
  /** One content commit at a controlled time. */
  commit(at: Date, message: string): string {
    writeFileSync(join(this.dir, 'work.log'), `${++this.n}\n`);
    execFileSync('git', ['-C', this.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '-q', '-m', message, '--date', at.toISOString()], { env: { ...process.env, GIT_COMMITTER_DATE: at.toISOString() } });
    return this.git('rev-parse', 'HEAD');
  }
  /** The marker the run-tests stub makes: `git commit-tree` on the tested head, no checkout touched. */
  marker(tested: string, tests: 'green' | 'red', nonce: string, at?: Date): string {
    const env = at ? { ...process.env, GIT_COMMITTER_DATE: at.toISOString(), GIT_AUTHOR_DATE: at.toISOString() } : process.env;
    return execFileSync('git', ['-C', this.dir, 'commit-tree', `${tested}^{tree}`, '-p', tested, '-m', `baton: tests ${tests} for B-1`, '-m', `Baton-Tests: ${tests}\nBaton-Tested: ${tested}\nBaton-Claim: ${nonce}`], { encoding: 'utf8', env }).trim();
  }
  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
    rmSync(this.origin, { recursive: true, force: true });
  }
}

describe('the plain-git variant (B-110)', () => {
  const ticket: PostedTicket = { id: 'B-1', course_id: 'create-pr', path: 'tickets/B-1.mdx', title: 'B-1', requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [] };

  it('the close pushes the marker the run made to the branch it tested; a moved branch refuses it', () => {
    const repo = new Repo();
    try {
      repo.commit(new Date(1_000_000), 'base');
      repo.git('push', '-q', 'origin', 'HEAD:refs/heads/main');
      const tested = repo.commit(new Date(1_001_000), 'the work');
      repo.git('push', '-q', 'origin', 'HEAD:refs/heads/claude/B-1-x');
      const marker = repo.marker(tested, 'red', 'n1');
      const ctx = { checkout: repo.dir, ticket: { id: 'docs:B-1', home: 'docs' }, leg: 'run-tests', claim: { nonce: 'n1' } };
      expect(testsClose(ctx, { reached: 'pr-open', next: 'fix', tests: 'red', branch: 'claude/B-1-x', tested, marker })).toBe(marker);
      expect(execFileSync('git', ['-C', repo.origin, 'rev-parse', 'refs/heads/claude/B-1-x'], { encoding: 'utf8' }).trim()).toBe(marker);
      // The home checkout's own branch never moved: the marker was made with commit-tree.
      expect(repo.git('rev-parse', 'HEAD')).toBe(tested);
      // A branch that moved since the fetch refuses the push: the leg fails rather than mark a head it did not test.
      const stale = repo.marker(tested, 'green', 'n2');
      expect(() => testsClose(ctx, { reached: 'pr-open', next: 'review', tests: 'green', branch: 'claude/B-1-x', tested, marker: stale })).toThrow();
      // A result missing its verdict, branch, head or marker fails the close naming it.
      expect(() => testsClose(ctx, { reached: 'pr-open', next: 'fix' })).toThrow('neither green nor red');
      expect(() => testsClose(ctx, { reached: 'pr-open', next: 'fix', tests: 'red', tested, marker })).toThrow('no PR branch');
      expect(() => testsClose(ctx, { reached: 'pr-open', next: 'fix', tests: 'red', branch: 'claude/B-1-x', marker })).toThrow('no tested head');
    } finally {
      repo.dispose();
    }
  });

  it('the gate routes from the branch\'s own commits — no forge, no adapter, no gh — counting only Baton\'s recorded evidence', () => {
    const repo = new Repo();
    try {
      repo.commit(new Date(1_000_000), 'base');
      const base = repo.git('rev-parse', 'HEAD');
      const work = repo.commit(new Date(1_001_000), 'the work');
      const red = repo.marker(work, 'red', 'n1', new Date(1_002_000));
      repo.git('reset', '-q', '--hard', red);
      const fix = repo.commit(new Date(1_003_000), 'the fix');
      const green = repo.marker(fix, 'green', 'n2', new Date(1_004_000));
      repo.git('reset', '-q', '--hard', green);
      const run = (args: string[]) => execFileSync('git', ['-C', repo.dir, ...args], { encoding: 'utf8' });
      const commits = commitsOf(run, ['HEAD', '--not', base]);
      expect(commits.map((c) => [c.sha, c.empty])).toEqual([[work, false], [red, true], [fix, false], [green, true]]);
      const record = [
        { ticket: 'B-1', leg: 'run-tests', claim_nonce: 'n1', evidence: red },
        { ticket: 'B-1', leg: 'run-tests', claim_nonce: 'n2', evidence: green },
      ];
      const at = (legs: typeof record) => stationsPr({ tickets: [ticket], facts: [{ number: 1, head: 'claude/B-1-x', state: 'open', pushedAt: 0, checks: [], reviews: [], commits }], closed: new Set(), graph: CREATE_PR_COURSE, baton: { legs } }).stations['B-1'];
      // The green gate on the head: review queues — no checks at all on plain git.
      expect(at(record).next).toEqual([{ leg: 'review', state: 'ready', waiting_on: null }]);
      expect(at(record).path.map((s) => `${s.leg}:${s.reached}`)).toEqual(['implement:pr-open', 'run-tests:pr-open', 'fix:fixed', 'run-tests:fixed']);
      // Without Baton's record of the green run, its marker is a push like any other: the gate is open.
      expect(at(record.slice(0, 1)).next).toEqual([{ leg: 'run-tests', state: 'ready', waiting_on: null }]);
    } finally {
      repo.dispose();
    }
  });
});
