// npm run model:verify: Apalache's bounded proof of `safety` on `small` (R3-1243), to depth 5.
//
// `quint verify` sends the compiled model to an Apalache server in one request, whose JSON reader
// refuses a string over 20 MB; the compiled `small` instance reached 19.8 MB on main and passed it
// with R3-1254's queued leg. So quint compiles the model to its JSON IR, written to a file, and
// Apalache's own command line checks that file, reading it whole — the same check, with the same
// `q::init`, `q::step` and `q::inv` that `quint verify` would name. The Apalache distribution is the
// one quint pins and caches (`~/.quint/apalache-dist-<version>`), fetched as quint fetches it.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { fetchApalache, DEFAULT_APALACHE_VERSION_TAG } = require('@informalsystems/quint/dist/src/apalache.js');

const DEPTH = process.env.MODEL_VERIFY_DEPTH ?? '5';
const compiled = spawnSync('npx', ['quint', 'compile', 'model/instances.qnt', '--main=small', '--init=pinit', '--step=pstep',
  '--invariant=safety', '--target=json'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
if (compiled.status !== 0) {
  console.log(compiled.stdout.slice(-4000), compiled.stderr);
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'baton-verify-'));
const file = join(dir, 'small.qnt.json');
writeFileSync(file, compiled.stdout);
console.log(`compiled model/instances.qnt (small): ${(compiled.stdout.length / 1e6).toFixed(1)} MB of JSON IR`);

const bin = await fetchApalache(DEFAULT_APALACHE_VERSION_TAG, 0);
if (bin.isLeft()) {
  console.log(`could not fetch Apalache ${DEFAULT_APALACHE_VERSION_TAG}: ${JSON.stringify(bin.value)}`);
  process.exit(1);
}
const run = spawnSync(bin.value, ['check', '--init=q::init', '--next=q::step', '--inv=q::inv', `--length=${DEPTH}`,
  `--out-dir=${join(dir, 'out')}`, file], { stdio: 'inherit' });
rmSync(dir, { recursive: true, force: true });
// Apalache exits 0 when no invariant is violated up to the depth; 12 with a counterexample.
console.log(run.status === 0 ? `✓ safety holds on small to depth ${DEPTH}` : `✗ Apalache exited ${run.status}`);
process.exit(run.status === 0 ? 0 : 1);
