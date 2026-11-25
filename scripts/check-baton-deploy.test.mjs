import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { check } from './check-baton-deploy.mjs';

const token = { CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}' };

function workflow(...steps) {
  return {
    jobs: {
      build: { steps: [{ uses: 'actions/setup-node@v4', with: { cache: 'npm' } }, { run: 'npm ci' }] },
      deploy: { environment: { name: 'production' }, steps: [
        { uses: 'actions/download-artifact@v4' }, ...steps, { run: 'verify-and-deploy', env: token },
      ] },
    },
  };
}

describe('B-135: production workflow review check', () => {
  it('allows build dependencies and cache only outside production', () => {
    expect(check(stringify(workflow({ uses: 'actions/setup-node@v5', with: { 'package-manager-cache': false } })))).toEqual([]);
  });

  it('does not mistake the prefix directory for an npm command', () => {
    expect(check(stringify(workflow({ run: 'npm --prefix ci run verify' })))).toEqual([]);
  });

  it.each([
    [{ uses: 'actions/setup-node@v4', with: { cache: 'npm', 'package-manager-cache': false } }, 'cache'],
    [{ uses: 'actions/cache/restore@v4' }, 'cache'],
    [{ uses: 'actions/setup-node@v5' }, 'package-manager-cache'],
    [{ run: 'echo Preparing\nnpm ci --ignore-scripts' }, 'npm ci'],
    [{ run: 'npm --prefix=worker clean-install' }, 'npm ci'],
    [{ run: 'npm --prefix worker ci' }, 'npm ci'],
    [{ run: 'npm --prefix "worker bundle" --ignore-scripts clean-install' }, 'npm ci'],
  ])('rejects unsafe production step %j', (step, reason) => {
    expect(check(stringify(workflow(step)))).toEqual([expect.stringContaining(reason)]);
  });

  it('rejects a deploy token reference in the build or workflow environment', () => {
    const candidate = workflow();
    Object.assign(candidate.jobs.build, { env: token });
    expect(check(stringify({ ...candidate, env: token }))).toEqual([
      'workflow env references the deploy token', 'build: references the production deploy token',
    ]);
  });

  it('does not pass a workflow without a literal production environment', () => {
    expect(check(stringify({ jobs: { build: workflow().jobs.build } }))).toEqual([
      'no job declares the production environment',
    ]);
  });
});
