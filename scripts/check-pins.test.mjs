import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { checkPin } from './check-pins.mjs';

const workflow = (ref) => stringify({ jobs: { sync: { steps: [
  { uses: 'actions/checkout@v4', with: { ref: 'main' } },
  { uses: 'actions/checkout@v4', with: { repository: 'immediately-run/baton', path: '.baton-cli', ref } },
] } } });

it('rejects a workflow pinned before the protocol change and accepts the change or a descendant', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'baton-sync-pin-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (file, content) => {
    writeFileSync(join(cwd, file), content);
    git('add', '--', file);
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-m', content);
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init', '-b', 'main');
    mkdirSync(join(cwd, 'src/defaults'), { recursive: true });
    const old = commit('src/defaults/evidence.ts', 'original');
    const required = commit('src/defaults/evidence.ts', 'changed');
    const later = commit('README.md', 'unrelated');
    expect(() => checkPin(workflow(old), { cwd, main: 'main' })).toThrow(`latest sync protocol change ${required}`);
    expect(checkPin(workflow(required), { cwd, main: 'main' })).toEqual({ pin: required, required });
    expect(checkPin(workflow(later), { cwd, main: 'main' })).toEqual({ pin: later, required });
    expect(() => checkPin(workflow('main'), { cwd, main: 'main' })).toThrow('full commit SHA');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
