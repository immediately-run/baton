// S-BTN-159 quiet start (B-93, BATON_SPEC §15's scenario table): two noises from the runs of
// 2026-10-21 — every runner start printed `no recommendation (no runner holds this secret)`, and
// `remoteSlug` let git's own `error: No such remote 'origin'` into a sync's log while the sync
// succeeded. Must hold: the registration attempt's refusal is not logged (a registered
// runner's still is), and an origin-less checkout is null with empty stderr — in this process
// and, as an operator's console reads it, through the CLI's own esbuild bundle (what
// scripts/baton-cli.mjs loads for `baton repo sync`). Node only: it writes a real git checkout
// and builds that bundle.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { BatonApi, BatonRefusal } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { StateFile } from '../../src/runner/state';
import { setClock, tick } from '../helpers';
import { idleFixture } from '../lib/idleFixture';
import { remoteSlug } from '../../src/defaults/cli';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** `remoteSlug(root)` as a fresh node process sees it, run from the built CLI's own directory:
 *  its answer on stdout, every byte a git it ran wrote on stderr — the line an operator's
 *  console shows. */
const inChild = (bundle: string, root: string): { slug: string | null | 'error'; stderr: string } => {
  const file = join(bundle, '..', 'probe.mjs');
  writeFileSync(file, `import { remoteSlug } from ${JSON.stringify(`./${bundle.split('/').pop()}`)};
process.stdout.write(JSON.stringify(remoteSlug(${JSON.stringify(root)})));\n`);
  const out = spawnSync(process.execPath, [file], { encoding: 'utf8', cwd: join(bundle, '..') });
  return { slug: out.status === 0 ? (JSON.parse(out.stdout || 'null') as string | null) : 'error', stderr: out.stderr ?? '' };
};

/** A fresh session's start: no state file and no runner, the first attempt's beat registering one.
 *  Its state lives in this process's memory — the handful of fields one heartbeat registers — and
 *  its home, state file and spool are its own, under a fresh temp directory. */
const start = (api: BatonApi, log: (l: string) => void, state: Record<string, unknown> = { runner_id: null, claim: null }, now?: () => number): Runner => {
  const home = mkdtempSync(join(tmpdir(), 'baton-fb-'));
  const r = new Runner({ api, home, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 'fresh',
    courses: [{ course: 'create-pr', version: 1 }], stateFile: join(home, 's.json'), beatEvery: 60_000, log, now });
  (r as unknown as { state: unknown }).state = {
    get: () => state,
    set: (patch: Record<string, unknown>) => { Object.assign(state, patch); },
    // A spool nobody wrote: the beat takes nothing, and its remove is the runner's own no-op.
    spool: join(home, 'spool.jsonl'),
  };
  return r;
};

let bundleDir: string;
let bundle: string;
beforeAll(async () => {
  // src/defaults/cli.ts, bundled exactly as scripts/baton-cli.mjs bundles it for `repo sync` —
  // inside the checkout's .local/, where the bundle's externals (esbuild) resolve.
  mkdirSync(join(ROOT, '.local'), { recursive: true }); // gitignored, as scripts/baton-cli.mjs makes it
  bundleDir = mkdtempSync(join(ROOT, '.local', 'baton-bundle-'));
  bundle = join(bundleDir, 'baton-cli.mjs');
  await build({
    entryPoints: [join(ROOT, 'src/defaults/cli.ts')],
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    packages: 'external', loader: { '.json': 'json', '.txt': 'text' }, logLevel: 'silent',
  });
});
afterAll(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

// The Runners project's filesystem is a memfs with no child processes; this scenario is Node's,
// as `baton repo sync`'s bundle is.
const nodeOnly = !(globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent?.includes('Cloudflare');
describe.skipIf(!nodeOnly)('S-BTN-159 a quiet start', () => {
  it('the registration beat’s refusal is not logged: a quiet start says nothing', async () => {
    const lines: string[] = [];
    const calls = { heartbeats: 0, recommendations: 0, claims: 0 };
    let registered = false;
    // B-86's grant (as S-BTN-41 answers it): a granted machine's first answer settles the
    // declaration the beat declared nothing of, so one beat serves the whole start.
    const GRANT = { grant: { capabilities: ['agent-venue', 'create-pr', 'drivable-browser', 'llm-call'] } };
    const api = {
      setSecret: () => {},
      // `sent`: the list this beat carried, as B-86's `rewriteSettings` records it server-side.
      heartbeat: async (body: Record<string, unknown>) => { calls.heartbeats++; registered = true; return { runner_id: 7, incarnation: 1, messages: [], sent: body.capabilities ?? [], ...GRANT }; },
      // `authRunner`'s refusal (src/core/runnerApi.ts) — a secret no registered runner holds.
      recommendations: async () => {
        calls.recommendations++;
        if (!registered) throw new BatonRefusal('unauthenticated', undefined, 'no runner holds this secret', 401);
        return { recommendations: [{ ticket_id: 'B-9' }] };
      },
      claim: async () => { calls.claims++; throw new BatonRefusal('no-eligible-ticket', undefined, 'nothing to claim', 409); },
    } as unknown as BatonApi;
    const r = start(api, (l) => lines.push(l));
    expect(await r.runOnce()).toBeNull(); // nothing claimable, on a session whose first beat registered it
    // Two beats, as B-86's grant-driven declaration spends them (#104): the first declares nothing
    // and is answered the grant, the second carries the settled list before the claim. Then the
    // single unnamed claim follows the settled heartbeat.
    expect(calls).toEqual({ heartbeats: 2, recommendations: 0, claims: 1 });
    expect(lines).toEqual(["baton: declaring agent-venue, create-pr, drivable-browser, llm-call — the grant's capabilities, no --capabilities given",
      'baton: idle — no-eligible-ticket: nothing to claim']);
    r.stop();
  });

  it('a registered runner makes one unnamed claim and logs a gate refusal', async () => {
    const lines: string[] = [];
    const asked: (string | null)[] = [];
    let refuseGates = false;
    const api = {
      setSecret: () => {},
      heartbeat: async (body: Record<string, unknown>) => ({ runner_id: 7, incarnation: 1, messages: [], sent: body.capabilities ?? [], grant: { capabilities: ['create-pr'] } }),
      recommendations: async () => { throw new Error('unexpected recommendation read'); },
      claim: async (body: { ticket_id?: string }) => {
        asked.push(body.ticket_id ?? null);
        if (refuseGates) throw new BatonRefusal('not-eligible', undefined, 'every gate refused this runner', 403);
        throw new BatonRefusal('no-eligible-ticket', undefined, 'nothing to claim', 409);
      },
    } as unknown as BatonApi;
    const r = start(api, (l) => lines.push(l), { runner_id: 7, claim: null });
    await r.runOnce();
    expect(asked).toEqual([null]); // the server chooses and claims in one transaction
    expect(lines).toEqual(["baton: declaring create-pr — the grant's capabilities, no --capabilities given",
      'baton: idle — no-eligible-ticket: nothing to claim']);
    refuseGates = true;
    lines.length = 0;
    await r.runOnce();
    await r.runOnce();
    expect(lines).toEqual(['baton: idle — not-eligible: every gate refused this runner']);
    r.stop();
  });

  it('logs both idle causes once, notifies the owner, and claims the held ticket after the owner retries it', async () => {
    const { start, w, sent, retry } = await idleFixture();
    const lines: string[] = [];
    let now = start;
    const api = new BatonApi({ url: 'https://baton.invalid', auth: () => ({}), transport: async (req) => {
      const res = await w.call(new URL(req.url).pathname, req.body ? await req.json() : undefined, req.method);
      return Response.json(res.json, { status: res.status });
    } });
    const home = mkdtempSync(join(tmpdir(), 'baton-idle-'));
    const stateFile = join(home, 'runner.json');
    new StateFile(stateFile).set({ runner_id: w.id, incarnation: 1, secret: w.secret });
    const runner = new Runner({ api, home, repository: 'docs', hostname: w.hostname, harness: 'opencode', session: 'idle',
      capabilities: ['agent-venue'], courses: [{ course: 'roadmap-pr', version: 3 }], stateFile, now: () => now, log: (line) => lines.push(line) });
    // Only the leg execution is stubbed; the claim and retry are real core operations.
    const run = vi.spyOn(runner as unknown as { runInSlot: (claim: Record<string, unknown>) => Promise<null> }, 'runInSlot').mockResolvedValue(null);
    try {
      expect(await runner.runOnce()).toBeNull();
      for (const minutes of [10, 20, 29, 30, 31]) {
        now = start + minutes * 60_000;
        await setClock(now);
        await runner.tick();
        expect(await runner.runOnce()).toBeNull();
        await tick();
        expect(sent).toHaveLength(minutes < 30 ? 0 : 1);
      }
      expect(sent).toEqual([{ kind: 'unblocked', repository: 'docs', tickets: [] }]);
      expect((await retry()).status).toBe(200);
      await runner.runOnce();
      expect(run).toHaveBeenCalledOnce();
      const claim = run.mock.calls[0][0];
      expect(claim.ticket_id).toBe('docs:RETRY');
      expect(lines.filter((l) => l.startsWith('baton: idle'))).toEqual([
        "baton: idle — no-eligible-ticket: no ready ticket fits this worker: 1 held attempts-exhausted (baton:retries open: docs:RETRY), 1 missing capability (rule 4) (docs:HIGH; human-operator)",
        `baton: idle for 31m, ended by claim ${claim.claim_id}`,
      ]);
    } finally {
      runner.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('an origin-less checkout gives null with its stderr empty, in process and through the bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-slug-'));
    try {
      spawnSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
      // The real quiet case this ticket names: git HAS found a repository, and it has no origin
      // (`git remote get-url origin` writes `error: No such remote 'origin'` and exits 2).
      expect(remoteSlug(dir)).toBeNull();
      // Through the CLI's bundle, where git's complaint would print: the log stays empty.
      expect(inChild(bundle, dir)).toEqual({ slug: null, stderr: '' });
      // A remote still reads as before — nothing was made quiet by a wrong slug.
      spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git'], { stdio: 'ignore' });
      expect(remoteSlug(dir)).toBe('o/r');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // And a directory that belongs to no repository at all — its own temp tree outside every
    // checkout, not a missing path inside one — is null too, and git's `fatal: not a git
    // repository` (exit 128) stays out of the operator's log: there is no repository that should
    // have an origin, so there is nothing to report.
    const outside = mkdtempSync(join(tmpdir(), 'baton-norepo-'));
    try {
      expect(inChild(bundle, outside)).toEqual({ slug: null, stderr: '' });
      expect(remoteSlug(outside)).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }, 60_000);
});
