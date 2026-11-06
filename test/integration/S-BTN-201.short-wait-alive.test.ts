// S-BTN-201 the runner outlives its short waits (BATON_SPEC §15's scenario table, §8's runner):
// through a short wait (R-BTN-40) no leg child is alive and the beat's own interval is unref'd,
// so the wait's fallback timer is the process's only keep-alive — and it must be ref'd.
// 2026-11-05, run-20261104-144136 died exactly there: B-7's fix done, the review gated on CI,
// the event loop emptied as the wait began, and the runner exited 0 mid-claim with no line, no
// hand-off and the home lock left behind. This is the process-level shape: a spawned runner
// that enters the wait must still be a process many fallback timers later. Node only: it
// bundles and spawns.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..', '..');

let bundleDir: string;
beforeAll(async () => {
  // Inside the checkout's .local/, as scripts/baton-cli.mjs makes it: gitignored, and the
  // bundle's externals (jose) resolve from the repository's node_modules.
  mkdirSync(join(ROOT, '.local'), { recursive: true });
  bundleDir = mkdtempSync(join(ROOT, '.local', 'baton-bundle-'));
  const driver = join(bundleDir, 'driver.ts');
  writeFileSync(driver, `import { join } from 'node:path';
import { Runner } from ${JSON.stringify(join(ROOT, 'src/runner/runner'))};
const home = ${JSON.stringify(join(bundleDir, 'home'))};
const r = new Runner({ api: { setSecret: () => {} } as never, home, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
  session: 'waitout', courses: [], stateFile: join(home, 's.json'), beatEvery: 50, log: () => {} });
const state: Record<string, unknown> = { worker_id: 1, claim: null };
(r as unknown as { state: unknown }).state = { get: () => state, set: () => {}, spool: join(home, 'spool.jsonl') };
(r as unknown as { inflight: unknown }).inflight = { claimId: 1, ticket: 'baton:B-x', child: null, waiters: [] };
const leg = (r as unknown as { waitOut(leg: string, course: unknown): Promise<string> });
process.stdout.write('waiting\\n');
void leg.waitOut('review', { graph: { shortWaits: [] } }).then(
  (how) => process.stdout.write('done ' + how + '\\n'),
  (e) => process.stderr.write('REJECTED: ' + String(e) + '\\n'));
`);
  await build({ entryPoints: [driver], outfile: join(bundleDir, 'driver.mjs'), bundle: true,
    platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'silent' });
});
afterAll(() => {
  if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
});

// The Workers project's filesystem is a memfs with no child processes; this scenario is Node's.
const nodeOnly = !(globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent?.includes('Cloudflare');
describe.skipIf(!nodeOnly)('S-BTN-201 the runner outlives its short waits', () => {
  it('a runner holding a short wait stays a process: no silent exit-0 mid-claim', async () => {
    const child = spawn(process.execPath, [join(bundleDir, 'driver.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] as const });
    // The handshake: the driver prints just before entering the wait, so the observation
    // window below measures the wait itself, never the boot.
    const saidWaiting = new Promise<void>((resolve, reject) => {
      let out = '';
      let err = '';
      child.stdout!.on('data', (c: Buffer) => { out += String(c); if (out.includes('waiting')) resolve(); });
      child.stderr!.on('data', (c: Buffer) => { err += String(c); });
      child.on('exit', (code: number | null) => { if (!out.includes('waiting')) reject(new Error(`the driver exited before it waited (code ${code}): ${err.slice(0, 500)}`)); });
    });
    await saidWaiting;
    // Long enough for many fallback timers (the driver beats every 50 ms) to arm and fire —
    // with the timer unref'd, every one of them was a process that evaporated here.
    await new Promise((res) => setTimeout(res, 1200));
    expect(child.exitCode).toBeNull(); // still running: the wait holds the process alive
    expect(child.signalCode).toBeNull();
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  }, 8000);
});
