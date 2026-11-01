// pr-markers.test.ts — B-110's `Baton-*` trailer commits: the parsing (a message's last
// paragraph, last occurrence per key), and the plain-git variant end to end — a real branch,
// its commits read from the checkout's own git (`gh` nowhere in sight), the run-tests close
// writing the gate's marker and the station function reading it back, the owner's round answer
// the same way. A plain-git repository runs the gate and the owner round identically to a
// forge's (R3-1265): the trailers are the record, the forge's comments one reader beside them.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitsOf, markersOfCommits, trailersOf } from '../../src/defaults/pr-markers';
import { testsClose } from '../../src/defaults/pr-close';
import { CREATE_PR_COURSE, stationsPr, type PrFact } from '../../src/defaults/course-pr';
import type { SourceTicket as PostedTicket } from '../../src/defaults/tickets-markdown';

describe('trailersOf — a commit message\'s trailer block', () => {
  it('reads the last paragraph, last occurrence per key; prose and continuations are none', () => {
    expect(trailersOf('a subject\n\nBaton-Tests: green\nBaton-Claim: n1')).toEqual({ 'Baton-Tests': 'green', 'Baton-Claim': 'n1' });
    expect(trailersOf('a subject\n\nsome prose\n\nBaton-Tests: red')).toEqual({ 'Baton-Tests': 'red' });
    expect(trailersOf('a subject\n\nBaton-Tests: green\n\nBaton-Tests: red')).toEqual({ 'Baton-Tests': 'red' });
    // A continuation line is not a trailer of its own; a prose-only message has none.
    expect(trailersOf('work\n\nBaton-Adjudicated: round\n  continued prose\nSignes-off-by: someone')).toEqual({ 'Baton-Adjudicated': 'round', 'Signes-off-by': 'someone' });
    expect(trailersOf('just a subject')).toEqual({});
  });
});

/** One fixture repository: a bare origin and a clone whose branch the gate marks. */
class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'baton-b110-'));
  readonly origin = mkdtempSync(join(tmpdir(), 'baton-b110-origin-'));
  private n = 0;
  constructor() {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', this.origin], { stdio: 'ignore' });
    for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'b110@test'], ['config', 'user.name', 'b110'], ['remote', 'add', 'origin', this.origin]]) {
      execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
    }
    writeFileSync(join(this.dir, 'package.json'), JSON.stringify({ name: 'plain', scripts: { test: 'node test/ok.mjs' } }, null, 2) + '\n');
  }
  /** One commit at a controlled time — content commits change a file, marker commits are empty. */
  commit(at: Date, message: string, empty = false): string {
    if (!empty) writeFileSync(join(this.dir, 'work.log'), `${++this.n}\n`);
    execFileSync('git', ['-C', this.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', ...(empty ? ['--allow-empty'] : []), '-m', message,
      '--date', at.toISOString(), '--allow-empty-message'], { encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: at.toISOString() } });
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  push(): void {
    execFileSync('git', ['-C', this.dir, 'push', '-q', 'origin', 'HEAD:refs/heads/main'], { stdio: 'ignore' });
  }
  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
    rmSync(this.origin, { recursive: true, force: true });
  }
}

describe('the plain-git variant (B-110)', () => {
  it('the close writes the gate\'s marker on the branch and the reading finds it: red and green both', () => {
    const repo = new Repo();
    try {
      repo.commit(new Date(1_000_000), 'the work');
      repo.push();
      // A red gate: the close commits the empty marker and pushes it; its sha is the evidence.
      const red = testsClose({ checkout: repo.dir, ticket: { id: 'docs:B-1', home: 'docs' }, leg: 'run-tests', claim: { nonce: 'n1' } },
        { reached: 'pr-open', next: 'fix', tests: 'red', tail: 'npm run test exited 1;\nFAIL test/thing\n✗ 1 failed' });
      const markers = markersOfCommits(commitsOf((args) => execFileSync('git', ['-C', repo.dir, ...args], { encoding: 'utf8' })));
      expect(markers).toEqual([{ at: expect.any(Number), sha: red, tests: 'red', claim: 'n1' }]);
      // The marker's message names the failing script's last lines, and its trailers are a block.
      const message = execFileSync('git', ['-C', repo.dir, 'log', '-1', '--format=%B'], { encoding: 'utf8' });
      expect(message).toContain('baton: tests red for B-1');
      expect(message).toContain('FAIL test/thing');
      expect(trailersOf(message)).toMatchObject({ 'Baton-Tests': 'red', 'Baton-Claim': 'n1' });
      // Green writes the same marker with the other word, and no tail.
      repo.commit(new Date(2_000_000), 'the fix', false);
      const green = testsClose({ checkout: repo.dir, ticket: { id: 'docs:B-1', home: 'docs' }, leg: 'run-tests', claim: { nonce: 'n2' } },
        { reached: 'fixed', next: 'review', tests: 'green' });
      const message2 = execFileSync('git', ['-C', repo.dir, 'show', '-s', '--format=%B', green], { encoding: 'utf8' });
      expect(message2).toContain('baton: tests green for B-1');
      expect(trailersOf(message2)).toEqual({ 'Baton-Tests': 'green', 'Baton-Claim': 'n2' });
      // A close with no verdict fails the leg naming what it wanted.
      expect(() => testsClose({ checkout: repo.dir, ticket: { id: 'docs:B-1', home: 'docs' }, leg: 'run-tests' }, { reached: 'pr-open', next: 'fix' }))
        .toThrow('neither green nor red');
    } finally {
      repo.dispose();
    }
  });

  it('the gate and the owner round route identically from the branch\'s commits — no forge, no adapter, no gh', () => {
    const repo = new Repo();
    try {
      // The branch: the work, a red gate, the fix, a green gate — then three changes rounds and
      // the owner's round answer. Times are the commit dates, so the reading orders them itself.
      const t = (s: number) => new Date(s);
      repo.commit(t(1_000_000), 'the work');
      repo.commit(t(1_001_000), 'baton: tests red for B-1\n\nnpm run test failed\n\nBaton-Tests: red\nBaton-Claim: n1', true);
      repo.commit(t(1_002_000), 'the fix');
      repo.commit(t(1_003_000), 'baton: tests green for B-1\n\nBaton-Tests: green\nBaton-Claim: n2', true);
      repo.push();
      const run = (args: string[]) => execFileSync('git', ['-C', repo.dir, ...args], { encoding: 'utf8' });
      // Read the branch afresh each placement: the case below commits more onto it.
      const at = (markers2: PrFact['markers'], reviews: PrFact['reviews'] = []): ReturnType<typeof stationsPr>['stations'][string] => {
        const commits = commitsOf(run);
        const pushes = commits.filter((c) => markersOfCommits([c]).length === 0).map((c) => c.at);
        const ticket: PostedTicket = { id: 'B-1', course_id: 'create-pr', path: 'tickets/B-1.mdx', title: 'B-1', requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [] };
        return stationsPr({ tickets: [ticket], facts: [{ number: 1, head: 'claude/B-1-x', state: 'open', pushedAt: pushes.at(-1) ?? 0, pushes, checks: [], reviews, markers: markers2 }], closed: new Set(), graph: CREATE_PR_COURSE }).stations['B-1'];
      };
      // The green gate on the head: review queues — ci is finished, no checks at all on plain git.
      const markers = () => markersOfCommits(commitsOf(run));
      expect(at(markers()).next).toEqual([{ leg: 'review', state: 'ready', waiting_on: null }]);
      expect(at(markers()).path.map((s) => `${s.leg}:${s.reached}`)).toEqual(['implement:pr-open', 'run-tests:pr-open', 'fix:fixed', 'run-tests:fixed']);
      // Three changes rounds with a fix push between each (each round's gate marker omitted —
      // the walk reads pushes and verdicts alone) and the owner's answer on the branch: a fourth
      // round, budgeted.
      // The rounds are a second apart too: %at carries seconds, and the reading orders by it.
      const v = (s: number) => ({ author: 'r', state: 'CHANGES_REQUESTED' as const, submittedAt: s });
      const rounds = [v(2_001_000), v(2_002_000), v(2_003_000)];
      repo.commit(t(2_001_500), 'round 1 fix');
      repo.commit(t(2_002_500), 'round 2 fix');
      repo.push();
      expect(at(markers(), rounds)).toMatchObject({ station: 'reviewed', next: [{ leg: 'adjudicate', state: 'waiting', waiting_on: 'owner' }] });
      repo.commit(t(2_004_000), 'adjudicate: one more round\n\nBaton-Adjudicated: round', true);
      repo.push();
      const fourth = at(markers(), rounds);
      expect(fourth).toMatchObject({ station: 'reviewed', next: [{ leg: 'review', state: 'ready', waiting_on: null }] });
      expect(fourth.decisions).toBeUndefined();
    } finally {
      repo.dispose();
    }
  });
});
