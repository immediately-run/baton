#!/usr/bin/env node
// B-346: use a full checkout with origin/main fetched. This check never moves a pin.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const WORKFLOW = '.github/workflows/baton-sync.yml';
const PROTOCOL_FILES = [
  'src/defaults/cli.ts', // Also held the sync implementation before it was split out.
  'src/defaults/sync.ts',
  'src/defaults/evidence.ts',
  'src/core/routes/sync.ts',
  'src/core/claims.ts', // The observation's unconfirmed list.
  'src/core/observations.ts',
  'src/shared/syncProtocol.ts',
];

export function checkPin(workflow, { cwd = '.', main = 'origin/main' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git('rev-parse', '--is-shallow-repository') === 'true') throw new Error('fetch full Git history before checking the sync pin');
  const steps = parse(workflow)?.jobs?.sync?.steps;
  const pins = Array.isArray(steps) ? steps.filter((s) => /^actions\/checkout@/.test(s?.uses ?? '') &&
    s.with?.repository === 'immediately-run/baton' && s.with.path === '.baton-cli') : [];
  const pin = pins[0]?.with.ref;
  if (pins.length !== 1 || typeof pin !== 'string' || !/^[0-9a-f]{40}$/i.test(pin)) {
    throw new Error(`${WORKFLOW}: expected one .baton-cli checkout pinned to a full commit SHA`);
  }
  const mainCommit = git('rev-parse', '--verify', '--end-of-options', `${main}^{commit}`);
  const pinnedCommit = git('rev-parse', '--verify', '--end-of-options', `${pin}^{commit}`);
  // On main, a merge can itself introduce the change (including conflict resolutions).
  const required = git('log', '--first-parent', '-1', '--format=%H', mainCommit, '--', ...PROTOCOL_FILES);
  if (!required) throw new Error(`no sync protocol history found on ${main}`);
  const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', required, pinnedCommit], { cwd, encoding: 'utf8' });
  if (ancestry.status === 1) throw new Error(`${WORKFLOW}: sync pin ${pin} does not contain ${main}'s latest sync protocol change ${required}; a repository owner must update the pin`);
  if (ancestry.status !== 0) throw ancestry.error ?? new Error(ancestry.stderr.trim() || 'cannot check sync pin ancestry');
  return { pin, required };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const { pin, required } = checkPin(readFileSync(WORKFLOW, 'utf8'), { main: process.argv[2] });
    console.log(`check:pins: sync pin ${pin} contains protocol change ${required}`);
  } catch (error) {
    console.error(`check:pins: ${error.message}`);
    process.exitCode = 1;
  }
}
