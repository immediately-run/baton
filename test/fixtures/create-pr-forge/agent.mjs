import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const { BATON_LEG: leg, BATON_TICKET_FILE: ticket, TEST_PR_URL: pr, TEST_VERDICT: verdict, TEST_MERGE_BASE: base } = process.env;
const ref = 'origin/claude/T-1-fixture';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
if (leg === 'review') {
  console.log(`${verdict} ${pr}`);
} else if (leg === 'fix') {
  git('switch', '-c', 'claude/T-1-fixture', ref);
  git('commit', '--allow-empty', '-m', 'Address review');
  git('push', 'origin', 'HEAD');
} else if (leg === 'merge') {
  const attempt = spawnSync('gh', ['pr', 'merge', pr], { encoding: 'utf8' });
  if (attempt.error) throw attempt.error;
  // An agent that reports a refusal exits normally. It is the shipped leg that must fail.
  if (attempt.status !== 0) {
    console.log(attempt.stderr.trim());
  } else if (base === 'main') {
    git('merge', '--ff-only', ref);
    writeFileSync(ticket, readFileSync(ticket, 'utf8').replace('status: available', 'status: done'));
    git('commit', '-m', 'Close the merged ticket', '--', ticket);
    git('push', 'origin', 'HEAD:main');
  } else if (base === 'staging') {
    git('push', 'origin', `${ref}:refs/heads/staging`);
  } else {
    throw new Error(`unexpected merge base: ${base}`);
  }
} else {
  throw new Error(`unexpected agent leg: ${leg}`);
}
