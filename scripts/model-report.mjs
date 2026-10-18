// The model-checking report (R-BTN-68, amended 2026-10-17): `npm run model:full` writes it on the
// author's machine, the PR body carries it, and CI checks that it is there, for the PR's head and
// passing, whenever the PR changes what the model checks read (.github/workflows/model-report.yml).
// Model checking itself never runs on hosted runners; this check only reads a PR body.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEADING = '### Model checks (`npm run model:full`)';
// the checks a report must show passing, in model/full.mjs's order, each at the size R-BTN-68
// promises: a run with fewer samples, fewer traces or a shallower proof is no report for a PR
// (round 2, 2-r2-1)
export const SIZES = { samples: '10000', traces: '1000', depth: '5' };
export const labels = ({ samples, traces, depth }) =>
  [`npm run model (${samples} samples)`, `model-based tests (${traces} traces)`, `npm run model:verify (depth ${depth})`];
export const CHECKS = labels(SIZES);
// a change to any of these can change a model check's outcome: the model; the core it is held
// to, with the shared modules and migrations it imports; the replay that drives the core with
// model traces, with its helpers; the scenario-trace check; and the lock file, which pins Quint
// and with it Apalache (round 2, 2-r2-0)
const CHECKED = /^(model\/|src\/core\/|src\/shared\/|src\/migrations\/|test\/model\/|test\/helpers\.ts$|test\/lib\/|test\/integration\/trace\.ts$|scripts\/check-traces\.mjs$|package-lock\.json$)/;

/** Whether a PR changing `files` must carry a report. */
export const needsReport = (files) => files.some((f) => CHECKED.test(f));

/**
 * The report for `head`, as Markdown, and whether it passes: every check passed, at full size, on
 * a clean tree. `rows` are [label, passed, minutes]; `dirty` is `git status --porcelain`'s output.
 */
export function renderReport({ head, dirty, quintVersion, platform, rows }) {
  const full = rows.length === CHECKS.length && rows.every(([label], i) => label === CHECKS[i]);
  const lines = [
    `${HEADING}\n`,
    `Commit \`${head}\`${dirty ? ' **with uncommitted changes — not a report for this commit**' : ''}${full ? '' : ' **a reduced run — not a report for a PR**'}; Quint ${quintVersion}; ${platform}.\n`,
    '| check | result | minutes |',
    '|---|---|---|',
    ...rows.map(([label, pass, min]) => `| ${label} | ${pass ? 'pass' : '**FAIL**'} | ${min} |`),
  ];
  return { text: lines.join('\n'), ok: !dirty && full && rows.every(([, pass]) => pass) };
}

/** The verdict on a PR body for `head`: null when it carries a passing report for it, else why not. */
export function reportProblem(body, head) {
  // a body edited on github.com comes back with CRLF line ends
  body = (body ?? '').replace(/\r\n/g, '\n');
  const at = body.indexOf(HEADING);
  if (at < 0) return `no "${HEADING}" report in the PR body`;
  const report = body.slice(at + HEADING.length).split(/\n#{1,3} /)[0];
  const commit = /Commit `([0-9a-f]{40})`/.exec(report)?.[1];
  if (!commit) return 'the report names no full commit SHA';
  if (commit !== head) return `the report is for ${commit.slice(0, 7)}, not the head ${head.slice(0, 7)}`;
  if (report.includes('with uncommitted changes')) return 'the report was run with uncommitted changes';
  const rows = [...report.matchAll(/^\| ([^|]+?) \| ([^|]+?) \| [^|]*\|$/gm)].filter(([, label]) => label !== 'check');
  for (const check of CHECKS) {
    const row = rows.find(([, label]) => label === check);
    if (!row) return `the report has no "${check}" row`;
    if (row[2].trim() !== 'pass') return `"${row[1]}" did not pass`;
  }
  return null;
}

// CI: PR_BODY, HEAD_SHA and BASE_SHA from the pull_request event; a checkout with both commits
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { PR_BODY, HEAD_SHA, BASE_SHA } = process.env;
  // --no-renames: a checked file moved out of the checked set still shows its old path (2-r2-2)
  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', `${BASE_SHA}...${HEAD_SHA}`], { encoding: 'utf8' });
  if (diff.status !== 0) {
    console.log(`✗ could not diff ${BASE_SHA}...${HEAD_SHA}: ${diff.stderr}`);
    process.exit(1);
  }
  const files = diff.stdout.split('\n').filter(Boolean);
  if (!needsReport(files)) {
    console.log('✓ no model report needed: the PR changes nothing the model checks read');
    process.exit(0);
  }
  const problem = reportProblem(PR_BODY, HEAD_SHA);
  console.log(problem
    ? `✗ ${problem}. This PR changes what the model checks read: run \`npm run model:full\` on its head and paste the report into the PR body (R-BTN-68).`
    : `✓ the PR body carries a passing model report for ${HEAD_SHA.slice(0, 7)}`);
  process.exit(problem ? 1 : 0);
}
