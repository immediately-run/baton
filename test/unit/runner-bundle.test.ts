// runner-bundle.test.ts — S-BTN-41's runner as it ships (BATON_SPEC §6.13 R-BTN-72): run from
// a bundle, not from source. The runner spawns each leg through legProcess.mjs by a path beside
// its own module (src/runner/runner.ts LEG_PROCESS), which esbuild does not follow — so each
// bundle must carry the file, or every leg crashes writing no result. Both bundles: a checkout's
// `.local/baton-run.mjs` (scripts/baton-run.mjs) and the published `dist/baton.mjs`
// (scripts/build-cli.mjs). Node only: it bundles and spawns.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/** Run one trivial leg through the leg process `bundle` names, as the runner does. */
function runLegVia(bundle: string): unknown {
  const named = /new URL\("\.\/legProcess\.mjs", import\.meta\.url\)/.test(readFileSync(bundle, 'utf8'));
  expect(named, `${bundle} names ./legProcess.mjs beside itself`).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), 'baton-bundle-leg-'));
  try {
    const script = join(dir, 'leg.mjs');
    const ctxPath = join(dir, 'ctx.json');
    const resultPath = join(dir, 'result.json');
    writeFileSync(script, 'export async function run(ctx) { return { echoed: ctx.leg }; }\n');
    writeFileSync(ctxPath, JSON.stringify({ leg: 'implement' }));
    const child = spawnSync(process.execPath, [join(dirname(bundle), 'legProcess.mjs'), script, ctxPath, resultPath], { input: '', encoding: 'utf8' });
    expect(child.stderr).toBe('');
    return JSON.parse(readFileSync(resultPath, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('S-BTN-41 the runner from its bundle (R-BTN-72)', () => {
  it("a checkout's .local bundle runs a leg", () => {
    // Importing it bundles, as `baton run` from a checkout does.
    execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(join(ROOT, 'scripts', 'baton-run.mjs'))})`], { cwd: ROOT });
    expect(runLegVia(join(ROOT, '.local', 'baton-run.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });

  it('the published dist bundle runs a leg', () => {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-cli.mjs')], { cwd: ROOT });
    expect(runLegVia(join(ROOT, 'dist', 'baton.mjs'))).toEqual({ ok: true, result: { echoed: 'implement' } });
  });
});
