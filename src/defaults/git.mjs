// One argv-only git seam for the CLI, defaults and runner (B-94, S-BTN-41).
import { execFile, execFileSync } from 'node:child_process';
import { GIT_NONINTERACTIVE_ENV } from '../client/git-env.mjs';

export const GIT_TIMEOUT_MS = 30_000;

const argv = (root, args) => root == null ? args : ['-C', root, ...args];
const { GIT_SSH_COMMAND: defaultSsh, ...noPrompts } = GIT_NONINTERACTIVE_ENV;
const limits = ({ timeoutMs = GIT_TIMEOUT_MS, cwd, env, maxBuffer = 16 << 20 }) => ({
  cwd,
  timeout: timeoutMs,
  killSignal: 'SIGKILL',
  maxBuffer,
  env: { ...process.env, LC_ALL: 'C', ...noPrompts, ...env },
});

// Probe in the same checkout and environment, including leading config overrides. Git's
// GIT_SSH_COMMAND would otherwise take precedence over the user's core.sshCommand.
function sshProbe(root, args) {
  let i = 0;
  while (args[i] === '-c' || args[i] === '--config-env' || args[i] === '-C' || args[i]?.startsWith('--config-env=')) {
    i += args[i].startsWith('--config-env=') ? 1 : 2;
  }
  return argv(root, [...args.slice(0, i), 'config', '--get', 'core.sshCommand']);
}

function gitSync(root, args, limitsOpts, output) {
  const opts = limits(limitsOpts);
  const start = performance.now();
  if (opts.env.GIT_SSH_COMMAND == null && opts.env.GIT_SSH == null) {
    try {
      execFileSync('git', sshProbe(root, args), { ...opts, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      if (e.status !== 1) throw e; // only "unset" permits the fallback
      opts.env.GIT_SSH_COMMAND = defaultSsh;
    }
  }
  opts.timeout -= Math.ceil(performance.now() - start);
  if (opts.timeout <= 0) throw Object.assign(new Error('git timed out before dispatch'), { code: 'ETIMEDOUT' });
  return execFileSync('git', argv(root, args), { ...opts, ...output });
}

/** Preserve raw output: `git show` reads file bytes, including a trailing newline. */
export function git(root, args, options = {}) {
  const { input, stdio = [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] } = options;
  return gitSync(root, args, options, { encoding: 'utf8', stdio, input });
}

export const gitText = (root, ...args) => git(root, args).trim();

export function gitBuffer(root, args) {
  return gitSync(root, args, {}, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Clone/fetch in a runner slot must not block the heartbeat. */
export async function gitAsync(root, args, timeoutMs) {
  const opts = limits({ timeoutMs });
  const start = performance.now();
  const run = (args) => new Promise((resolve, reject) => {
    const child = execFile('git', args, { ...opts, encoding: 'utf8' },
      (e, stdout, stderr) => e ? reject(Object.assign(e, { stderr })) : resolve(stdout));
    child.stdin?.end();
  });
  if (opts.env.GIT_SSH_COMMAND == null && opts.env.GIT_SSH == null) {
    try {
      await run(sshProbe(root, args));
    } catch (e) {
      if (e.code !== 1) throw e;
      opts.env.GIT_SSH_COMMAND = defaultSsh;
    }
  }
  opts.timeout -= Math.ceil(performance.now() - start);
  if (opts.timeout <= 0) throw new Error('git timed out before dispatch');
  return run(argv(root, args)).catch((e) => {
    throw new Error(`git ${args[0]}: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  });
}
