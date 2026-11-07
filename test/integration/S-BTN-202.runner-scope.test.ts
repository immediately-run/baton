// S-BTN-202's runner half (B-134, §12.9): the runner audits, at each leg's end, the refs the
// leg's window moved in the home checkout — evidence the agent supplies none of — and reports
// the pushes outside the claim answer's `scope` on the advance or end that finishes the leg.
// The core's half (the findings, the hold, the forge cross-check) is S-BTN-202's server file,
// which runs on both hosts; this one drives the real Runner, so it is Node only (it spawns leg
// children and runs git).
//
// The pushed ref's stand-in: a push leaves the remote-tracking ref moved, and the tracking ref
// is the runner's evidence — so the leg moves tracking refs directly (`git update-ref
// refs/remotes/<remote>/<branch>`), exactly the state a push of that branch would leave behind.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BatonApi } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { outsideScope, pushesBetween, readRefState, repoOfUrl, type RefState } from '../../src/runner/audit';
import { scopePaths } from '../../src/core/scope';
import { call as hostCall } from '#host';
import { course, cutover, ORIGIN, placed, rows, setClock, syncCall, ticket, TOKENS } from '../helpers';
import relay from '../fixtures/courses/relay/course.json';

const T0 = Date.parse('2026-11-07T12:00:00Z');
const A_SHA = '0123456789012345678901234567890123456789';
const B_SHA = '9876543210987654321098765432109876543210';

// ── the pure half (src/runner/audit.ts) ───────────────────────────────────────────────────

describe('repoOfUrl', () => {
  it('reads owner/name from every remote URL spelling, and nothing from a local path', () => {
    expect(repoOfUrl('https://github.com/immediately-run/docs.git')).toBe('immediately-run/docs');
    expect(repoOfUrl('https://github.com/immediately-run/docs')).toBe('immediately-run/docs');
    expect(repoOfUrl('ssh://git@github.com/immediately-run/docs')).toBe('immediately-run/docs');
    expect(repoOfUrl('git@github.com:immediately-run/docs.git')).toBe('immediately-run/docs');
    expect(repoOfUrl('https://github.com/Immediately-Run/Docs.GIT')).toBe('immediately-run/docs');
    expect(repoOfUrl('https://gitlab.com/group/sub/repo.git')).toBe('sub/repo'); // a subgroup's repository, named by its last two segments
    expect(repoOfUrl('/srv/git/repositories/docs.git')).toBeNull();   // a git repository's path: no repository to name
    expect(repoOfUrl('https://github.com/')).toBeNull();
    expect(repoOfUrl('https://github.com/a/b/c/d')).toBe('c/d');      // named by its last two segments, as a scope's forge path is
  });
});

describe('pushesBetween', () => {
  /** Two reads of a checkout with two remotes. */
  const read = (tracking: [string, string][], remotes: Record<string, string>): RefState => ({ tracking, remotes });
  const REMOTES = { origin: 'https://github.com/immediately-run/docs.git', intruder: 'https://github.com/immediately-run/fieldhouse.git' };

  it('a tracking ref that appeared or moved names one push of the ref it tracks', () => {
    const before = read([['refs/remotes/intruder/x', A_SHA]], REMOTES);
    const after = read([
      ['refs/remotes/intruder/x', A_SHA],                            // unchanged: no push
      ['refs/remotes/intruder/claude/T-1-x', A_SHA],                 // appeared: one push
      ['refs/remotes/origin/claude/T-1-y', B_SHA],                   // appeared: one push
    ], REMOTES);
    expect(pushesBetween(before, after)).toEqual([
      { kind: 'push', target: 'immediately-run/fieldhouse', ref: 'refs/heads/claude/T-1-x' },
      { kind: 'push', target: 'immediately-run/docs', ref: 'refs/heads/claude/T-1-y' },
    ]);
  });
  it('a deleted tracking ref and a remote that names no repository name nothing', () => {
    const before = read([['refs/remotes/intruder/x', A_SHA], ['refs/remotes/local/x', B_SHA]], { ...REMOTES, local: '/srv/git/docs.git' });
    const after = read([['refs/remotes/local/x', A_SHA]], { ...REMOTES, local: '/srv/git/docs.git' });
    expect(pushesBetween(before, after)).toEqual([]);
  });
  it('a second push of the same branch to the same repository is one action, whatever its reflog', () => {
    const before = read([], REMOTES);
    const after = read([['refs/remotes/intruder/claude/x', A_SHA]], REMOTES);
    expect(pushesBetween(before, after)).toEqual([{ kind: 'push', target: 'immediately-run/fieldhouse', ref: 'refs/heads/claude/x' }]);
    expect(pushesBetween(before, { ...after, tracking: [...after.tracking, ['refs/remotes/intruder/claude/x', B_SHA]] })).toEqual([
      { kind: 'push', target: 'immediately-run/fieldhouse', ref: 'refs/heads/claude/x' }]);
  });
});

describe('outsideScope and scopePaths', () => {
  const actions = [{ kind: 'push' as const, target: 'immediately-run/docs' }, { kind: 'push' as const, target: 'Immediately-Run/Fieldhouse' }];
  it('the scope is the home and the repos that resolve, compared case-blind; a short name reads under the home owner', () => {
    expect(scopePaths({ forge: 'github', github: 'immediately-run/fieldhouse', repos: '["docs", "not a path", "o/site"]' }))
      .toEqual(new Set(['immediately-run/fieldhouse', 'immediately-run/docs', 'o/site']));
    expect(outsideScope(actions, ['immediately-run/docs'])).toEqual([{ kind: 'push', target: 'Immediately-Run/Fieldhouse' }]);
    expect(outsideScope(actions, ['immediately-run/docs', 'immediately-run/fieldhouse'])).toEqual([]);
  });
  it('no scope in the claim answer (a Baton before B-134) audits nothing', () => {
    expect(outsideScope(actions, null)).toEqual([]);
  });
});

describe('readRefState', () => {
  it('parses the remotes and the tracking refs, skipping each remote\'s HEAD symref; a git that fails answers null', () => {
    const state = readRefState((args) => {
      if (args[0] === 'remote') return [
      'intruder\thttps://github.com/immediately-run/fieldhouse.git (fetch)',
      'intruder\thttps://github.com/immediately-run/fieldhouse.git (push)',
      'origin\thttps://github.com/immediately-run/docs.git (fetch)',
      ].join('\n');
      return [
      `${A_SHA} refs/remotes/intruder/HEAD`,
      `refs/remotes/intruder/claude/x ${A_SHA}`,
      `refs/remotes/origin/main ${B_SHA}`,
      'refs/remotes/origin/weird not-a-sha',
      ].join('\n');
    });
    expect(state).toEqual({
      remotes: { intruder: 'https://github.com/immediately-run/fieldhouse.git', origin: 'https://github.com/immediately-run/docs.git' },
      tracking: [['refs/remotes/intruder/claude/x', A_SHA], ['refs/remotes/origin/main', B_SHA]],
    });
    expect(readRefState(() => { throw new Error('not a git'); })).toBeNull();
  });
});

// ── the Runner's half, against the real core ─────────────────────────────────────────────

/** One leg script: its run moves remote-tracking refs exactly as pushes of those branches
 *  would, and its close commits the closing record. */
const PUSHING_LEG = `import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const git = (ctx, ...a) => execFileSync('git', ['-C', ctx.checkout, ...a], { encoding: 'utf8' });
export async function run(ctx) {
  // The leg pushes a branch to another repository of the org (leaving the intruder remote's
  // tracking ref moved) and one to its own home (the origin remote's) — the tracking refs a
  // push of each leaves behind, moved directly.
  git(ctx, 'remote', 'add', 'intruder', 'https://github.com/immediately-run/fieldhouse.git');
  git(ctx, 'remote', 'add', 'origin', 'https://github.com/immediately-run/docs.git');
  const sha = git(ctx, 'rev-parse', 'HEAD').trim();
  git(ctx, 'update-ref', 'refs/remotes/intruder/claude/T-1-x', sha);
  git(ctx, 'update-ref', 'refs/remotes/origin/claude/T-1-y', sha);
  return { reached: 'built', next: 'check' };
}
export async function close(ctx, result) {
  const git2 = (ctx2, ...a) => execFileSync('git', ['-C', ctx2.checkout, ...a], { encoding: 'utf8' });
  appendFileSync([ctx.checkout, '.baton', 'closes.jsonl'].join('/'), JSON.stringify({ leg: ctx.leg }) + '\\n');
  git2(ctx, 'add', '.baton/closes.jsonl');
  git2(ctx, 'commit', '--allow-empty', '--no-gpg-sign', '-qm', 'baton:close ' + ctx.leg);
  return git2(ctx, 'rev-parse', 'HEAD').trim();
}
`;

/** The home repository: a real git checkout whose `.baton/` the runner reads at the claim's
 *  snapshot, posting its real head sha (R-BTN-34's fetch never fires). */
class Home {
  readonly dir: string;
  head: string | null = null;
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'baton-s202-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 's202@test');
    g('config', 'user.name', 's202');
    this.write('.baton/baton.json', `${JSON.stringify({ course: 'relay', skills_version: 3 })}\n`);
    this.write('.baton/courses/relay/course.json', `${JSON.stringify(relay, null, 2)}\n`);
    this.write('.baton/courses/relay/legs/build.mjs', PUSHING_LEG);
    for (const leg of ['check', 'merge']) {
      this.write(`.baton/courses/relay/legs/${leg}.mjs`, `import { execFileSync } from 'node:child_process';
export async function run(ctx) {
  return { reached: '${leg === 'check' ? 'checked' : 'merged'}'${leg === 'check' ? ", next: 'merge'" : ''} };
}
export async function close(ctx) {
  const git = (c, ...a) => execFileSync('git', ['-C', c.checkout, ...a], { encoding: 'utf8' });
  git(ctx, 'commit', '--allow-empty', '--no-gpg-sign', '-qm', 'baton:close ' + ctx.leg);
  return git(ctx, 'rev-parse', 'HEAD').trim();
}
`);
    }
  }
  write(path: string, text: string): void {
    const file = join(this.dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  sha(): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  async post(): Promise<void> {
    execFileSync('git', ['-C', this.dir, 'add', '.baton'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--no-gpg-sign', '-q', '-m', 'legs'], { stdio: 'ignore' });
    const sha = this.sha();
    const res = await syncCall('/v1/sync/board', {
      registry: [course(3, 3, { id: 'relay', course: relay as unknown as Record<string, unknown> })],
      sha, parent_sha: this.head,
      tickets: [ticket('T-1', { course_id: 'relay', repos: [] })], closed: [], stations: { 'T-1': placed('filed', [], [['build', 'ready']]) },
    });
    if (res.status !== 200) throw new Error(`board post: ${res.status} ${await res.text()}`);
    this.head = sha;
  }
}

let home: Home;
let n = 0;
const clock = { now: T0 };
let runner: Runner | null = null;

function makeRunner(): Runner {
  const stateFile = join(tmpdir(), `baton-s202-runner-${process.pid}-${++n}.json`);
  const api = new BatonApi({
    url: 'https://baton.test',
    transport: (req) => hostCall(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
  });
  runner = new Runner({
    api, home: home.dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
    session: `s202-${n}`, courses: [{ course: 'relay', version: 3 }],
    stateFile, beatEvery: 40, now: () => clock.now, log: () => {},
  });
  return runner;
}

beforeEach(async () => {
  clock.now = T0;
  await setClock(T0);
  home = new Home();
  await cutover();
});

afterEach(() => {
  runner?.stop();
  runner = null;
  rmSync(home.dir, { recursive: true, force: true });
});

describe('S-BTN-202 the runner audits a leg\'s pushes (B-134)', () => {
  it('a leg that pushes outside its ticket\'s scope is reported on the advance that finishes it, and Baton raises the finding', async () => {
    await home.post();
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ ticket: 'docs:T-1', end_reason: 'done', reached: 'merged' });
    // The build leg's audit: the intruder push is outside the ticket's scope (its home alone —
    // the ticket names no repos), the home push inside it. One finding, one event, and the
    // claim's scope was the home.
    expect(await rows(`SELECT ticket_id, json_extract(detail_json, '$.target') AS target, json_extract(detail_json, '$.ref') AS ref
                       FROM events WHERE kind = 'scope-exceeded'`)).toEqual([
      { ticket_id: 'docs:T-1', target: 'immediately-run/fieldhouse', ref: 'refs/heads/claude/T-1-x' }]);
    expect(await rows(`SELECT repository_id, ticket_id, kind, target FROM scope_findings WHERE resolved_at IS NULL`)).toEqual([
      { repository_id: 'docs', ticket_id: 'docs:T-1', kind: 'scope-exceeded', target: 'immediately-run/fieldhouse' }]);
    expect(await rows('SELECT count(*) AS n FROM events WHERE kind = \'unclaimed-write\'')).toEqual([{ n: 0 }]);
  });

  it('an unreadable audit skips itself, never the leg', async () => {
    await home.post();
    const r = makeRunner();
    (r as unknown as { o: { auditRefs?: unknown } }).o.auditRefs = () => { throw new Error('git is gone'); };
    const out = await r.runOnce();
    expect(out).toMatchObject({ ticket: 'docs:T-1', end_reason: 'done', reached: 'merged' });
    expect(await rows('SELECT count(*) AS n FROM events WHERE kind = \'scope-exceeded\'')).toEqual([{ n: 0 }]);
  });
});
