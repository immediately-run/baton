// bounded-git.test.ts — B-94: no git call a stub or the runner makes can outlive its bound, and
// a runner's death always leaves a line. The defaults' `exec` (what every standard course's
// `close` runs) and the runner's own `git` are bounded and non-interactive, so a wedged
// `git push` fails the leg in seconds rather than holding the claim for hours; the bound the
// close's three attempts spend is pinned under the lease's margin; the runner can state its
// claim, its leg and its last beat in one line for a signal or `exit` hook.
// Node only: it spawns processes and drives the production seams with a real hanging git.
import { afterAll, afterEach, describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, CLOSE_TIMEOUT_MS, GIT_NONINTERACTIVE_ENV } from '../../src/defaults/course-markers';
import { git, GIT_TIMEOUT_MS } from '../../src/runner/home';
import { BEAT_MS, Runner } from '../../src/runner/runner';
import type { BatonApi } from '../../src/runner/api';
import { exitHook, stopLine } from '../../src/runner/main';
import { StateFile } from '../../src/runner/state';

/** A real git that never returns: `git -c alias.hang='!sleep 3600' hang` shells out to a sleep,
 * so the production seams (exec, git) meet the wedge they are bounded against. */
const HANGING_GIT_ARGS = ['-c', 'alias.hang=!sleep 3600', 'hang'];
/** A stand-in git binary on PATH that hangs outright — for `exec`, which takes any command. */
const hangingGitBin = (): { dir: string; git: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-hang-'));
  const git = join(dir, 'git');
  writeFileSync(git, '#!/bin/sh\nexec sleep 3600\n');
  chmodSync(git, 0o755);
  return { dir, git };
};

describe('the defaults’ close is bounded and non-interactive (B-94)', () => {
  it('names a finite bound and a non-interactive environment', () => {
    expect(Number.isInteger(CLOSE_TIMEOUT_MS)).toBe(true);
    expect(CLOSE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CLOSE_TIMEOUT_MS).toBeLessThanOrEqual(5 * 60_000);
    expect(GIT_NONINTERACTIVE_ENV).toMatchObject({ GIT_TERMINAL_PROMPT: '0' });
    expect(GIT_NONINTERACTIVE_ENV.GIT_SSH_COMMAND).toContain('BatchMode=yes');
    expect(GIT_NONINTERACTIVE_ENV.GIT_SSH_COMMAND).toContain('ConnectTimeout=');
  });

  it('the real exec kills a hanging git at its bound and throws (review round 1: the production seam, not a replica)', () => {
    const { dir, git: bin } = hangingGitBin();
    const started = Date.now();
    let killed = false;
    try {
      exec(bin, [], dir, 150);
    } catch (e) {
      killed = (e as NodeJS.ErrnoException).code === 'ETIMEDOUT' || (e as { killed?: boolean }).killed === true || String(e).includes('SPAWN');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(killed).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('the close’s three attempts stay under the lease’s margin (the bound is lease arithmetic, named and pinned)', () => {
    // callClose tries three times (src/runner/runner.ts) with the synchronous exec, so the
    // runner's loop is blocked for 3 × CLOSE_TIMEOUT_MS with no beat possible; the lease goes
    // at lease_timeout − 4 min (§9.2), 900 s at today's floor.
    expect(3 * CLOSE_TIMEOUT_MS).toBeLessThan(900_000 - 240_000);
  });
});

describe('the runner’s own git is bounded and non-interactive (B-94)', () => {
  it('names its bound (well under a beat) and environment', () => {
    expect(Number.isInteger(GIT_TIMEOUT_MS)).toBe(true);
    expect(GIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(GIT_TIMEOUT_MS).toBeLessThan(BEAT_MS);
    expect(GIT_NONINTERACTIVE_ENV).toMatchObject({ GIT_TERMINAL_PROMPT: '0' });
    expect(GIT_NONINTERACTIVE_ENV.GIT_SSH_COMMAND).toContain('BatchMode=yes');
    expect(GIT_NONINTERACTIVE_ENV.GIT_SSH_COMMAND).toContain('ConnectTimeout=');
  });

  it('the real git kills a hanging git at its bound (review round 1: the production seam)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-hang-'));
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
    const started = Date.now();
    let killed = false;
    try {
      git(dir, HANGING_GIT_ARGS, 150);
    } catch (e) {
      killed = (e as NodeJS.ErrnoException).code === 'ETIMEDOUT' || (e as { killed?: boolean }).killed === true || String(e).includes('SPAWN');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(killed).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('the runner’s last line (B-94)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-lastline-'));
  const stateFile = join(dir, 'state.json');
  const runner = (over: { log?: (l: string) => void } = {}) => {
    // A minimal API: the runner never calls it in these tests.
    const api = { setSecret: () => {}, heartbeat: async () => { throw new Error('not used'); } } as unknown as BatonApi;
    return new Runner({
      api, home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 'last',
      courses: [{ course: 'create-pr', version: 1 }], stateFile, log: over.log,
    });
  };
  afterEach(() => {
    rmSync(stateFile, { force: true });
    rmSync(`${stateFile}.spool.jsonl`, { force: true });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('says no claim and no leg before anything happens, the last beat never', () => {
    const r = runner();
    expect(r.lastLine('stopping on SIGTERM')).toBe('stopping on SIGTERM: no claim, no leg in flight, last beat never');
  });

  it('names the claim and the last beat from the state file', () => {
    const state = new StateFile(stateFile);
    state.set({ claim: { id: 77, ticket_id: 'docs:B-1', nonce: 'n' }, last_ok: Date.parse('2026-10-21T17:28:00Z') });
    const r = runner();
    const line = r.lastLine('exiting');
    expect(line).toContain('claim 77 on docs:B-1');
    expect(line).toContain('last beat 2026-10-21T17:28:00.000Z');
    expect(line).toContain('no leg in flight');
  });

  it('installs its fatal hooks once, not once per runner (they are process-wide)', () => {
    // The guard is process-wide: a second runner does not stack another pair of handlers on
    // the process (which would both log and both exit on the same failure).
    const g = globalThis as { __batonFatalHooks?: boolean };
    const was = g.__batonFatalHooks;
    delete g.__batonFatalHooks;
    const before = {
      uncaught: new Set(process.listeners('uncaughtException')),
      rejection: new Set(process.listeners('unhandledRejection')),
    };
    // `process.listeners`'s overloads take one event name each; this helper takes either.
    const listenersOf = (event: string): unknown[] => (process.listeners as unknown as (e: string) => unknown[])(event);
    const addedFor = (event: string, before: Set<unknown>) => listenersOf(event).filter((l) => !before.has(l));
    const added: { uncaught: unknown[]; rejection: unknown[] } = { uncaught: [], rejection: [] };
    try {
      for (let i = 0; i < 3; i++) (runner() as unknown as { ensureFatalHooks: () => void }).ensureFatalHooks();
      added.uncaught = addedFor('uncaughtException', before.uncaught);
      added.rejection = addedFor('unhandledRejection', before.rejection);
      expect(added.uncaught).toHaveLength(1);
      expect(added.rejection).toHaveLength(1);
      expect(g.__batonFatalHooks).toBe(true);
    } finally {
      // Leave the process as this test found it: the handlers are exercised by tests elsewhere
      // and the guard is global, so restore both.
      for (const l of added.uncaught) process.off('uncaughtException', l as (e: unknown) => void);
      for (const l of added.rejection) process.off('unhandledRejection', l as (e: unknown) => void);
      if (was) g.__batonFatalHooks = true;
      else delete g.__batonFatalHooks;
    }
  });
});

describe('the shutdown hooks’ lines (B-94)', () => {
  it('stopLine names the signal; a runner not yet built still leaves a line', () => {
    expect(stopLine(null, 'SIGTERM')).toBe('the runner stopped on SIGTERM before its first claim');
    expect(stopLine({ lastLine: (why: string) => `${why}: no claim, no leg in flight, last beat never` }, 'SIGTERM'))
      .toBe('stopping on SIGTERM: no claim, no leg in flight, last beat never');
  });

  it('exitHook writes its line with the exit code and the last state, on SIGTERM', () => {
    const lines: string[] = [];
    const hook = exitHook({ lastLine: (why: string) => `${why}: claim 9 on docs:B-2, leg review, last beat 2026-10-21T17:28:00.000Z` }, (l) => lines.push(l));
    hook(143);
    expect(lines).toEqual(['baton: the runner is exiting, code 143 (exiting: claim 9 on docs:B-2, leg review, last beat 2026-10-21T17:28:00.000Z)']);
    hook(undefined);
    expect(lines[1]).toContain('code ?');
  });
});
