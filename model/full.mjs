// npm run model:full: every model check, on the author's machine (R-BTN-68, amended 2026-10-17:
// model checking does not run on hosted CI runners, whose time limits it outgrew). A pull request
// that changes model/, src/core/, the replay or the trace check pastes this report into its body;
// the review gate checks that its commit is the PR's head. It runs, in order:
//   1. npm run model — typecheck, regression runs, MODEL_SAMPLES (10,000) runs of `step` and
//      30% as many of `progressStep`, and the witnesses;
//   2. the model-based tests with REPLAY_TRACES (1,000) traces driving the core (R3-1244);
//   3. npm run model:verify — Apalache's bounded proof of `safety` on `small` (needs Java).
// Each step runs even when an earlier one fails, so one run reports everything. The report is
// Markdown on stdout; each step's own output goes to stderr.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
const head = git('rev-parse', 'HEAD');
// a report is for a commit: changes not in it, to the files the checks read, make it no one's
const dirty = git('status', '--porcelain', '--', 'model', 'src', 'test', 'scripts', 'package.json', 'package-lock.json');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const quintVersion = lock.packages?.['node_modules/@informalsystems/quint']?.version ?? 'unknown';
const samples = process.env.MODEL_SAMPLES ?? '10000';
const traces = process.env.REPLAY_TRACES ?? '1000';

const steps = [
  [`npm run model (${samples} samples)`, 'npm', ['run', 'model'], { MODEL_SAMPLES: samples }],
  [`model-based tests (${traces} traces)`, 'npx', ['vitest', 'run', '--project', 'local', 'test/model/replay.test.ts'], { REPLAY_TRACES: traces }],
  ['npm run model:verify', 'npm', ['run', 'model:verify'], {}],
];
const rows = [];
for (const [label, cmd, args, env] of steps) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { stdio: ['ignore', process.stderr, process.stderr], env: { ...process.env, ...env } });
  rows.push([label, r.status === 0, Math.round((Date.now() - t0) / 60000)]);
}

const ok = rows.every(([, pass]) => pass) && !dirty;
console.log(`### Model checks (\`npm run model:full\`)\n`);
console.log(`Commit \`${head}\`${dirty ? ' **with uncommitted changes — not a report for this commit**' : ''}; Quint ${quintVersion}; ${process.platform}-${process.arch}.\n`);
console.log('| check | result | minutes |\n|---|---|---|');
for (const [label, pass, min] of rows) console.log(`| ${label} | ${pass ? 'pass' : '**FAIL**'} | ${min} |`);
process.exit(ok ? 0 : 1);
