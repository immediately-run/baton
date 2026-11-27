import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtinExecutor, type Executor, type SessionKind } from '../../src/runner/executor';
import { isPlacementFailure } from '../../src/runner/placement';
import type { Runner } from '../../src/runner/runner';
import { GitRepo } from '../lib/gitRepo';
import { runnerClock, testRunner, until } from '../lib/runnerRig';
import { course, cutover, grantRunnerConcurrency, placed, rows, runnerId, syncCall, ticket } from '../helpers';
import relay from '../fixtures/courses/relay/course.json';

const T0 = Date.parse('2026-11-25T12:00:00Z');
const clock = runnerClock(T0);
let dir: string;
let runner: Runner | undefined;
let work: Promise<number> | undefined;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'baton-placement-'));
  await clock.set(T0);
  await cutover();
});

afterEach(async () => {
  runner?.stop();
  try { await work; } finally {
    runner = undefined;
    work = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(executor: Executor, log: (line: string) => void, source = false): Promise<Runner> {
  const home = new GitRepo('baton-placement-home-', { dir: join(dir, 'home') });
  home.write('.baton/baton.json', JSON.stringify({ course: 'relay', skills_version: 3 }));
  home.write('.baton/courses/relay/course.json', JSON.stringify(relay));
  home.write('.baton/courses/relay/legs/check.mjs', "export const run = () => ({ suspend: true, reached: 'checked' }); export const close = () => null;\n");
  if (source) home.write('.baton/tickets.mjs', "export const versions = 'pinned'; export const read = () => ({ ticket: { id: 'T-1' } });\n");
  const sha = home.commit('placement fixture');
  const ids = ['T-1', 'T-2', 'T-3'];
  const res = await syncCall('/v1/sync/board', {
    registry: [course(3, 3, { id: 'relay', course: relay as unknown as Record<string, unknown> })],
    sha, parent_sha: null, tickets: ids.map((id) => ticket(id, { course_id: 'relay', ...(source ? { version: sha } : {}) })), closed: [],
    ...(source ? { source: { kind: 'custom', versions: 'pinned', cli: '0.0.0-test' } } : {}),
    stations: Object.fromEntries(ids.map((id) => [id, placed('built', [['build', 'built']], [['check', 'ready']])])),
  });
  expect(res.status, await res.text()).toBe(200);
  runner = testRunner({
    home: join(dir, 'home'), session: 'placement', courses: [{ course: 'relay', version: 3 }],
    stateFile: join(dir, 'state.json'), clonesDir: join(dir, 'clones'), concurrency: 2, executor, log,
    beatEvery: 60_000, now: clock.now,
  });
  await runner.tick();
  await grantRunnerConcurrency(await runnerId(), 2);
  await runner.tick();
  return runner;
}

const concurrency = async () => (await rows<{ concurrency: number }>('SELECT concurrency FROM runners'))[0]?.concurrency;
const claims = () => rows<{ end_reason: string | null; failed_attempt: number; station: string }>('SELECT end_reason, failed_attempt, station FROM claims ORDER BY id');

describe('S-BTN-327 executor placement', () => {
  it.each<SessionKind>(['leg', 'source'])('pauses after one failed %s placement and recovers through a backed-off probe', async (kind) => {
    const builtin = builtinExecutor();
    let down = true;
    let failedStarts = 0;
    let probes = 0;
    let stoppedProbes = 0;
    const lines: string[] = [];
    const r = await setup({ ...builtin, source: 'pinned', async start(o) {
      const probe = o.brief.session_id.startsWith('source-probe-');
      if (probe) {
        probes++;
        expect(o.brief).toMatchObject({ kind: 'source', paths: [], env: {} });
        expect(o.forgeProof).toBeUndefined();
      }
      if (down && (probe || o.brief.kind === kind)) {
        if (!probe) failedStarts++;
        throw new Error('503: Failed to place sandbox: this node cannot map 4096 MiB of guest memory');
      }
      return builtin.start(o);
    }, async stop(h, reason) {
      if (reason === 'placement-probe') stoppedProbes++;
      await builtin.stop(h, reason);
    } }, (line) => lines.push(line), kind === 'source');

    work = r.work();
    await until(concurrency, (n) => n === 0, 'zero concurrency heartbeat');
    expect(await until(claims, (c) => c[0]?.end_reason != null)).toEqual([
      { end_reason: 'released:host-placement', failed_attempt: 0, station: 'built' },
    ]);
    expect(failedStarts).toBe(1);
    expect(probes).toBe(0);
    await clock.set(T0 + 5_000);
    await until(() => probes, (n) => n === 1, 'first probe');
    expect(await concurrency()).toBe(0);
    expect(await claims()).toHaveLength(1);
    expect(lines.filter((l) => l.includes('not taking claims'))).toHaveLength(1);
    down = false;
    await clock.set(T0 + 14_999);
    expect(await r.tick()).toBeUndefined();
    expect(probes).toBe(1);
    await clock.set(T0 + 15_000);
    await until(claims, (c) => c.some((claim) => claim.end_reason === 'suspended:checked'), 'automatic recovery');
    expect(stoppedProbes).toBe(1);
    expect(await concurrency()).toBe(2);
    expect(failedStarts).toBe(1);
  }, 35_000);

  it('uses executor capacity before taking even the first claim', async () => {
    let freeSlots = 0;
    const lines: string[] = [];
    const r = await setup({ ...builtinExecutor(), source: 'pinned',
      async placementHealth() { return { ready: true, freeSlots }; },
    }, (line) => lines.push(line));
    expect(await r.runOnce()).toBeNull();
    expect(await concurrency()).toBe(0);
    expect(await claims()).toEqual([]);
    freeSlots = 1;
    await clock.set(T0 + 5_000);
    const outcome = await r.runOnce();
    expect(outcome, lines.join('\n')).toMatchObject({ end_reason: 'suspended:checked' });
    expect(await concurrency()).toBe(2);
  });

  it('distinguishes placement failures from unrelated sandbox API errors', () => {
    expect(isPlacementFailure({ code: 'HOST_PLACEMENT' })).toBe(true);
    expect(isPlacementFailure(new Error('503: placement failed'))).toBe(true);
    expect(isPlacementFailure(new Error('500: Cannot verify the API key'))).toBe(false);
  });
});
