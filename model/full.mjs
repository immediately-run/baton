// npm run model:full: every model check, on the author's machine (R-BTN-68, amended 2026-10-17:
// model checking does not run on hosted CI runners, whose time limits it outgrew; amended
// 2026-10-20: about three hours, so it runs weekly on main, and a PR carries `--pr`'s report;
// about two and a quarter since B-37 made the proof cheaper).
// A pull request that changes what the checks read (scripts/model-report.mjs lists it) pastes a
// report into its body, and CI checks it names the PR's head and passes. `--pr` (npm run
// model:pr, about 20–30 minutes) runs `npm run model:quick`, the model-based tests at 200 traces
// and step 4. Without it, in order:
//   1. npm run model — typecheck, regression runs, MODEL_SAMPLES (10,000) runs of `step` and
//      30% as many of `progressStep`, and the witnesses;
//   2. the model-based tests with REPLAY_TRACES (1,000) traces driving the core (R3-1244);
//   3. npm run model:verify — Apalache's bounded proof of `safety` on `small` (needs Java);
//   4. the scenario traces: the integration scenarios write one trace per scenario test, and
//      `npm run traces` checks each against the model (R3-1244) — hosted CI runs no quint since
//      2026-10-20, so this is where they are checked.
// Each step runs even when an earlier one fails, so one run reports everything. The report is
// Markdown on stdout; each step's own output goes to stderr.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PR_TRACES, REPORTS, SIZES, labels, renderReport, stepEnv } from '../scripts/model-report.mjs';

const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
const head = git('rev-parse', 'HEAD');
// a report is for a commit: any change not in it makes it no one's — the whole tree, since the
// checks also read vitest.config.ts, wrangler.toml and the tsconfigs (round 1, 1-A-4)
const dirty = git('status', '--porcelain');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const quintVersion = lock.packages?.['node_modules/@informalsystems/quint']?.version ?? 'unknown';
// the sizes may be lowered to try a change; the report then says it is no report for a PR
const sizes = {
  samples: process.env.MODEL_SAMPLES ?? SIZES.samples,
  traces: process.env.REPLAY_TRACES ?? SIZES.traces,
  depth: process.env.MODEL_VERIFY_DEPTH ?? SIZES.depth,
};
const kind = process.argv.includes('--pr') ? 'pr' : 'full';
const [modelLabel, replayLabel, verifyLabel, tracesLabel] = labels(sizes);
const replay = (label, traces) => [label, 'npx', ['vitest', 'run', '--project', 'local', 'test/model/replay.test.ts'], { REPLAY_TRACES: traces }];
// a fresh set of traces from this tree, then each through the model
const traces = [tracesLabel, 'sh', ['-c', 'rm -rf test/.traces && BATON_SKIP_QUINT=1 npx vitest run test/integration && npm run traces'], {}];

const steps = kind === 'pr'
  ? [[REPORTS.pr.checks[0], 'npm', ['run', 'model:quick'], {}], replay(`model-based tests (${process.env.REPLAY_TRACES ?? PR_TRACES} traces)`, process.env.REPLAY_TRACES ?? PR_TRACES), traces]
  : [[modelLabel, 'npm', ['run', 'model'], { MODEL_SAMPLES: sizes.samples }], replay(replayLabel, sizes.traces),
      [verifyLabel, 'npm', ['run', 'model:verify'], { MODEL_VERIFY_DEPTH: sizes.depth }], traces];
const rows = [];
for (const [label, cmd, args, env] of steps) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { stdio: ['ignore', process.stderr, process.stderr], env: stepEnv(process.env, env) });
  rows.push([label, r.status === 0, Math.round((Date.now() - t0) / 60000)]);
}

const { text, ok } = renderReport({ kind, head, dirty, quintVersion, platform: `${process.platform}-${process.arch}`, rows });
console.log(text);
process.exit(ok ? 0 : 1);
