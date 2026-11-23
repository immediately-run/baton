// runner-bundle.test.ts — S-BTN-41's runner as it ships (BATON_SPEC §6.13 R-BTN-72): run from
// a bundle, not from source. The runner spawns each leg through legProcess.mjs by a path beside
// its own module (src/runner/runner.ts LEG_PROCESS), which esbuild does not follow — so each
// bundle must carry the file, or every leg crashes with no outcome. Both bundles: a checkout's
// `.local/` runner bundle (scripts/baton-run.mjs) and the published `dist/baton.mjs`
// (scripts/build-cli.mjs). Node only: it bundles and spawns.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkCliDispatch } from '../../scripts/check-cli-dispatch.mjs';
import { CLI_ENTRIES } from '../../scripts/cli-entries.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

/** Run one trivial leg through the leg process `bundle` names, as the runner does. */
function runLegVia(wrapper: string): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'baton-bundle-leg-'));
  try {
    const script = join(dir, 'leg.mjs');
    writeFileSync(script, 'export async function run(ctx) { return { echoed: ctx.leg }; }\n');
    // R-BTN-133 (B-184): `node legProcess.mjs <call> <script>`, the arguments on stdin's first
    // line, the outcome on stdout's last.
    const child = spawnSync(process.execPath, [wrapper, 'run', script], { input: `${JSON.stringify([{ leg: 'implement' }])}\n`, encoding: 'utf8' });
    expect(child.stderr).toBe('');
    return JSON.parse(child.stdout.trim().split('\n').at(-1)!);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('S-BTN-41 the runner from its bundle (R-BTN-72)', () => {
  it('runs the checkout CLI without loading native TypeScript', () => {
    const home = mkdtempSync(join(tmpdir(), 'baton-checkout-cli-'));
    try {
      const result = spawnSync(process.execPath, ['--no-experimental-strip-types', 'cli/baton.mjs', 'home', 'list'], {
        cwd: ROOT, env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8',
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('no homes configured');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects a command missing from the export table before building the package', () => {
    const cli = readFileSync(join(ROOT, 'cli/baton.mjs'), 'utf8');
    const entries = { ...CLI_ENTRIES, 'baton-run.mjs': CLI_ENTRIES['baton-run.mjs'].map(({ entry, exports }) => ({
      entry, exports: exports.filter((name) => name !== 'queueCommand'),
    })) };
    expect(() => checkCliDispatch(cli, entries)).toThrow(/baton-run\.mjs.*queueCommand/);
  });

  it("a checkout's .local bundle runs a leg", () => {
    // Importing it bundles, as `baton run` from a checkout does.
    const entry = JSON.stringify(join(ROOT, 'scripts', 'baton-run.mjs'));
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', `console.log(typeof (await import(${entry})).default.runMain);`], { cwd: ROOT, encoding: 'utf8' }).trim()).toBe('function');
    expect(runLegVia(join(ROOT, '.local', 'legProcess.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });

  it('the published dist bundle runs a leg', () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-cli.mjs')], { cwd: ROOT });
    expect(readFileSync(join(ROOT, 'dist', 'baton.mjs'), 'utf8')).toMatch(/new URL\("\.\/legProcess\.mjs", import\.meta\.url\)/);
    expect(runLegVia(join(ROOT, 'dist', 'legProcess.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });
});
