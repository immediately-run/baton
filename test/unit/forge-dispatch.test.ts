// S-BTN-56: each adapter uses only the registered forge target and its host secret.
import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, expect, it, vi } from 'vitest';
import { sendForgeDispatch } from '../../src/core/dispatch';
import type { DispatchTarget } from '../../src/core/ports';

const base = { BATON_ORIGIN: '', OIDC_ISSUER: '', OIDC_JWKS_URL: '' };
const target = { repository: 'sample', github: 'owner/sample', workflow: 'sync.yml', ref: 'main', inputs: { tickets: '[]' } };
afterEach(() => vi.unstubAllGlobals());

it('uses a GitLab trigger token and maps the tickets input to a pipeline variable', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', fetch);
  const gitlab: DispatchTarget = { ...target, origin: 'https://gitlab.example', adapter: { kind: 'gitlab-trigger', project_id: 42, ref: 'main' } };
  const config = { ...base, BATON_FORGE_SECRETS: JSON.stringify({ sample: { forge: 'gitlab', trigger_token: 'fake-trigger' } }) };
  expect(await sendForgeDispatch(config, gitlab, 0)).toBe(true);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://gitlab.example/api/v4/projects/42/trigger/pipeline', expect.objectContaining({
    method: 'POST', redirect: 'error', body: JSON.stringify({ token: 'fake-trigger', ref: 'main', variables: { tickets: '[]' } }),
  }));
});

it('uses Gitea workflow dispatch and never borrows another forge’s token', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  const gitea: DispatchTarget = { ...target, origin: 'https://gitea.example', adapter: { kind: 'gitea', workflow: '.gitea/workflows/sync.yml', ref: 'main' } };
  const config = (forge: string) => ({ ...base, BATON_FORGE_SECRETS: JSON.stringify({ sample: { forge, trigger_token: 'fake-bot' } }) });
  expect(await sendForgeDispatch(config('gitlab'), gitea, 0)).toBeNull();
  expect(await sendForgeDispatch(config('gitea'), gitea, 0)).toBe(true);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://gitea.example/api/v1/repos/owner/sample/actions/workflows/sync.yml/dispatches', expect.objectContaining({
    method: 'POST', redirect: 'error', headers: expect.objectContaining({ Authorization: 'token fake-bot' }),
    body: JSON.stringify({ ref: 'main', inputs: { tickets: '[]' } }),
  }));
});

it('mints a repository-scoped GitHub App installation token before dispatch', async () => {
  const key = await exportPKCS8((await generateKeyPair('RS256', { extractable: true })).privateKey);
  const requests: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (url.endsWith('/installation')) return Response.json({ id: 42 });
    if (url.endsWith('/access_tokens')) return Response.json({ token: 'fake-installation' });
    return new Response(null, { status: 204 });
  });
  expect(await sendForgeDispatch({ ...base, BATON_GITHUB_APP_ID: '123', BATON_GITHUB_APP_KEY: key }, target, 1_000_000)).toBe(true);
  expect(requests.map((r) => r.url)).toEqual([
    'https://api.github.com/repos/owner/sample/installation',
    'https://api.github.com/app/installations/42/access_tokens',
    'https://api.github.com/repos/owner/sample/actions/workflows/sync.yml/dispatches',
  ]);
  expect(decodeJwt(new Headers(requests[0].init.headers).get('Authorization')!.slice(7))).toMatchObject({ iss: '123', iat: 940, exp: 1480 });
  expect(JSON.parse(requests[1].init.body as string)).toEqual({ repositories: ['sample'], permissions: { actions: 'write' } });
  expect(new Headers(requests[2].init.headers).get('Authorization')).toBe('Bearer fake-installation');
});
