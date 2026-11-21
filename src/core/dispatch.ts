// R-BTN-55: both host shells use these adapters behind the Dispatch port. No store access.
import { importPKCS8, SignJWT } from 'jose';
import { dispatchToken } from './forgeSecrets';
import type { Config, DispatchTarget } from './ports';

const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'baton' };

async function request(url: string, init: RequestInit, operation: string) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    .catch(() => { throw new Error(`${operation}: transport failed`); });
  // Never put a response body, URL or credential in the core's dispatch log.
  if (!response.ok) throw new Error(`${operation}: HTTP ${response.status}`);
  return response;
}

function der(tag: number, bytes: number[]): number[] {
  const length = bytes.length;
  if (length < 128) return [tag, length, ...bytes];
  const size: number[] = [];
  for (let n = length; n; n = Math.floor(n / 256)) size.unshift(n % 256);
  return [tag, 0x80 + size.length, ...size, ...bytes];
}

/** GitHub downloads the App key in PKCS#1; WebCrypto imports PKCS#8. */
function pkcs8(pem: string) {
  if (!pem.startsWith('-----BEGIN RSA PRIVATE KEY-----')) return pem;
  const raw = atob(pem.replace(/-----[^-]+-----|\s/g, ''));
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const wrapped = der(0x30, [0x02, 0x01, 0x00, ...rsaAlgorithm, ...der(0x04, Array.from(raw, (c) => c.charCodeAt(0)))]);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...wrapped))}\n-----END PRIVATE KEY-----`;
}

async function installationToken(config: Config, path: string, now: number) {
  if (!config.BATON_GITHUB_APP_ID || !config.BATON_GITHUB_APP_KEY) return config.GITHUB_DISPATCH_TOKEN;
  let jwt: string;
  try {
    const key = await importPKCS8(pkcs8(config.BATON_GITHUB_APP_KEY.trim()), 'RS256');
    jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(config.BATON_GITHUB_APP_ID)
      .setIssuedAt(now - 60).setExpirationTime(now + 480).sign(key);
  } catch {
    throw new Error('GitHub App key could not sign');
  }
  const appHeaders = { ...headers, Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}` };
  const root = 'https://api.github.com';
  const installation = await request(`${root}/repos/${path}/installation`, { headers: appHeaders }, 'GitHub App installation lookup');
  const id = (await installation.json().catch(() => null) as { id?: number } | null)?.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('GitHub App installation lookup: invalid id');
  const response = await request(`${root}/app/installations/${id}/access_tokens`, {
    method: 'POST', headers: appHeaders, body: JSON.stringify({ repositories: [path.split('/').at(-1)], permissions: { actions: 'write' } }),
  }, 'GitHub App installation token');
  const token = (await response.json().catch(() => null) as { token?: string } | null)?.token;
  if (typeof token !== 'string' || !token) throw new Error('GitHub App installation token: invalid response');
  return token;
}

export async function sendForgeDispatch(config: Config, target: DispatchTarget, now: number): Promise<true | null> {
  const { adapter, origin, github, workflow, ref, inputs } = target;
  const path = github.split('/').map(encodeURIComponent).join('/');
  const body = JSON.stringify(inputs ? { ref, inputs } : { ref });
  if (!adapter || adapter.kind === 'github-app') {
    const token = await installationToken(config, path, Math.floor(now / 1000));
    if (!token) return null;
    await request(`https://api.github.com/repos/${path}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: 'POST', headers: { ...headers, Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }, body,
    }, 'GitHub workflow dispatch');
  } else {
    const token = dispatchToken(config, target.repository!, adapter);
    if (!origin || !token) return null;
    if (adapter.kind === 'gitlab-trigger') {
      await request(`${origin}/api/v4/projects/${adapter.project_id}/trigger/pipeline`, {
        method: 'POST', headers, body: JSON.stringify({ token, ref, ...(inputs ? { variables: inputs } : {}) }),
      }, 'GitLab pipeline trigger');
    } else {
      await request(`${origin}/api/v1/repos/${path}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
        method: 'POST', headers: { ...headers, Authorization: `token ${token}` }, body,
      }, 'Gitea workflow dispatch');
    }
  }
  return true;
}
