// R-BTN-68: sample the design-time model, run its regressions, and check reachability.
import { spawnSync } from 'node:child_process';

const quint = (args) => {
  const result = spawnSync('quint', args, { encoding: 'utf8', timeout: 30_000 });
  if (result.error) throw result.error;
  return result;
};
const samples = 100;
const progressSamples = 50;
const sim = (step) => ['model/instances.qnt', '--main=sim', '--init=pinit', `--step=${step}`,
  '--backend=typescript'];
let failed = false;
const check = (label, ok, out) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failed = true; console.log(out); }
};

// Both Quint commands typecheck their entry module and its imports before running.
const t = quint(['test', 'model/regressions.qnt', '--main=regressions', '--backend=typescript']);
check('regression runs', t.status === 0, t.stdout + t.stderr);
const s = quint(['run', ...sim('pstep'), '--invariant=safety', '--max-steps=40', `--max-samples=${samples}`, '--seed=1']);
check(`safety, ${samples} random runs of 40 steps of step`, s.status === 0, s.stdout.slice(-4000) + s.stderr);
const sp = quint(['run', ...sim('pprogress'), '--invariant=safety', '--max-steps=40', `--max-samples=${progressSamples}`, '--seed=1']);
check(`safety, ${progressSamples} random runs of 40 steps of progressStep`, sp.status === 0, sp.stdout.slice(-4000) + sp.stderr);
const wsim = (step) => ['model/witnesses.qnt', '--main=witnesses', '--init=winit', `--step=${step}`,
  '--backend=typescript'];
const witnesses = [
  ['wstep', ['noResumedClaim', 'noAlarmReap', 'noBlockedTicket', 'noRetryRow',
    'noUnblockedEvent', 'noCapabilityRow', 'noResourceRow']],
  ['wprogress', ['noFixLeg']],
];
// Other witnesses are reached deterministically in regressions.qnt (see witnesses.qnt).
for (const [step, names] of witnesses) for (const w of names) {
  // a fixed seed: a witness is a fact about the model, not a lottery
  const r = quint(['run', ...wsim(step), `--invariant=${w}`, '--max-steps=40', '--max-samples=64', '--seed=1', '--verbosity=1']);
  check(`witness ${w} is reached (${step})`, r.status === 1 && /Invariant violated/.test(r.stderr), r.stdout + r.stderr);
}
process.exit(failed ? 1 : 0);
