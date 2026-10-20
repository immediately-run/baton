// npm run model:verify: Apalache's bounded proof of `safety` on `small` (R3-1243), to depth 4 —
// 5 since R3-1254 part 2 takes about 10 hours (owner, 2026-10-19; B-37 restores it).
//
// `quint verify` sends the compiled model to an Apalache server in one request, whose JSON reader
// refuses a string over 20 MB; the compiled `small` instance is now about 70 MB (63 MB of it the
// type and name tables, which repeat the State record's type). So quint compiles the model to its
// JSON IR, written to a file, and Apalache's own command line checks that file, reading it whole —
// the same check, with the same `q::init`, `q::step` and `q::inv` that `quint verify` would name.
// The Apalache distribution is the one quint pins and caches (`~/.quint/apalache-dist-<version>`),
// fetched as quint fetches it.
//
// B-37 (measured in its report): the step is `pverify` — `step` less the actions no state of
// `small` enables (properties.qnt says which and why; `verifyShape`, checked with the invariants,
// fails the proof if `small` stops being such an instance) — and Apalache checks the invariants
// once per step over every transition (`search.invariant.mode=after`) instead of once per enabled
// transition. Together a third faster at depth 3; same transitions, same invariants.
// `MODEL_VERIFY_SPLIT=1` checks `safety`'s four groups (`safetyA`…`safetyD`, properties.qnt) in
// four Apalache processes at once — each pays the search, so it needs four free CPUs.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { fetchApalache, DEFAULT_APALACHE_VERSION_TAG } = require('@informalsystems/quint/dist/src/apalache.js');

const DEPTH = process.env.MODEL_VERIFY_DEPTH ?? '4';
const SPLIT = process.env.MODEL_VERIFY_SPLIT === '1';
// `verifyShape` rides with every group: it is what makes `pverify` the same as `step`
const groups = SPLIT ? ['safetyA', 'safetyB', 'safetyC', 'safetyD'].map((g) => [g, `${g},verifyShape`])
  : [['safety', 'safety,verifyShape']];
const dir = mkdtempSync(join(tmpdir(), 'baton-verify-'));
// the ~70 MB of IR per group goes with the directory on every way out, a failed compile or fetch included
const done = (code, message) => {
  if (message) console.log(message);
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
};
for (const [name, invariant] of groups) {
  const file = join(dir, `${name}.qnt.json`);
  // quint's stdout goes straight to the file: piped, it is cut short on a model this size, and
  // `--out` writes an earlier, unflattened stage that Apalache does not read
  const out = openSync(file, 'w');
  const compiled = spawnSync('npx', ['quint', 'compile', 'model/instances.qnt', '--main=small', '--init=pinit', '--step=pverify',
    `--invariant=${invariant}`, '--target=json'], { stdio: ['ignore', out, 'pipe'], encoding: 'utf8' });
  closeSync(out);
  if (compiled.status !== 0) done(1, compiled.stderr);
  console.log(`compiled model/instances.qnt (small, ${invariant}): ${(statSync(file).size / 1e6).toFixed(1)} MB of JSON IR`);
}

const bin = await fetchApalache(DEFAULT_APALACHE_VERSION_TAG, 0);
if (bin.isLeft()) done(1, `could not fetch Apalache ${DEFAULT_APALACHE_VERSION_TAG}: ${JSON.stringify(bin.value)}`);
// Apalache's default heap is 4 GB; depth 4 and over needs more, and split runs share the machine
const heap = process.env.JVM_ARGS ?? (SPLIT ? '-Xmx3G' : '-Xmx8G');
const runs = groups.map(([name, invariant]) => new Promise((resolve) => {
  const p = spawn(bin.value, ['check', '--init=q::init', '--next=q::step', '--inv=q::inv', `--length=${DEPTH}`,
    '--tuning-options=search.invariant.mode=after', `--out-dir=${join(dir, `out-${name}`)}`, join(dir, `${name}.qnt.json`)],
  { stdio: SPLIT ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, JVM_ARGS: heap } });
  if (SPLIT) {
    // one prefixed line per Apalache line, so four interleaved logs stay readable
    const prefix = (stream, to) => {
      let rest = '';
      stream.on('data', (b) => {
        const lines = (rest + b).split('\n');
        rest = lines.pop();
        for (const l of lines) to.write(`[${name}] ${l}\n`);
      });
    };
    prefix(p.stdout, process.stdout);
    prefix(p.stderr, process.stderr);
  }
  p.on('close', (code) => resolve([invariant, code]));
}));
const results = await Promise.all(runs);
// Apalache exits 0 when no invariant is violated up to the depth; 12 with a counterexample.
const failed = results.filter(([, code]) => code !== 0);
done(failed.length ? 1 : 0, failed.length
  ? failed.map(([inv, code]) => `✗ ${inv}: Apalache exited ${code}`).join('\n')
  : `✓ safety holds on small to depth ${DEPTH}${SPLIT ? ' (four groups)' : ''}`);
