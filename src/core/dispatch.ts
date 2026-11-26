// R-BTN-55: both host shells use these adapters behind the Dispatch port. No store access.
import { importPKCS8, SignJWT } from 'jose';
import { dispatchToken } from './forgeSecrets';
import { DEFAULT_FORGE, FORGE_SHAPES } from './forges';
import type { Config, DispatchTarget } from './ports';

const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'baton' };

async function request(url: string, init: RequestInit, operation: string, token?: string) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    .catch(() => { throw new DispatchTransportError(`${operation}: transport failed`); });
  // Installation errors and token-bearing trigger responses are reported by status only.
  if (!response.ok) {
    if (token) throw new DispatchRefused(response.status, await dispatchRefusal(response, token));
    throw new Error(`${operation}: HTTP ${response.status}`);
  }
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
  if (!config.BATON_GITHUB_APP_ID?.trim() || !config.BATON_GITHUB_APP_KEY?.trim()) return null;
  let jwt: string;
  try {
    const key = await importPKCS8(pkcs8(config.BATON_GITHUB_APP_KEY.trim()), 'RS256');
    jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(config.BATON_GITHUB_APP_ID)
      .setIssuedAt(now - 60).setExpirationTime(now + 480).sign(key);
  } catch {
    throw new Error('GitHub App key could not sign');
  }
  const appHeaders = { ...headers, Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}` };
  const root = FORGE_SHAPES[DEFAULT_FORGE].dispatchOrigin;
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

export async function sendForgeDispatch(config: Config, target: DispatchTarget, now: number): Promise<boolean | null> {
  const { adapter, origin, workflow, ref, inputs } = target;
  const path = target.path.split('/').map(encodeURIComponent).join('/');
  const body = JSON.stringify(inputs ? { ref, inputs } : { ref });
  if (!adapter || adapter.kind === 'github-app') {
    const token = await installationToken(config, path, Math.floor(now / 1000));
    if (!token) return null;
    return dispatchWorkflow(token, target);
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

const DISPATCH_REASON_MAX = 500;
const DISPATCH_BODY_MAX = 8 * 1024;
const DISPATCH_BODY_TIMEOUT_MS = 1000;

export class DispatchTransportError extends Error {}

export class DispatchRefused extends Error {
  constructor(readonly status: number, reason: string) {
    super(reason ? `HTTP ${status}: ${reason}`.slice(0, DISPATCH_REASON_MAX) : `HTTP ${status}`);
  }
}

async function readDispatchBody(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const read = async () => {
    if (Number(res.headers.get('Content-Length')) > DISPATCH_BODY_MAX) return '';
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > DISPATCH_BODY_MAX) return '';
      body += decoder.decode(value, { stream: true });
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<string>((resolve) => {
      timer = setTimeout(() => resolve(''), DISPATCH_BODY_TIMEOUT_MS);
    });
    return await Promise.race([read(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // The stream's underlying cancellation must not extend the diagnostic deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** R-BTN-94: keep a short, single-line reason, not the forge's payload. */
async function dispatchRefusal(res: Response, token: string): Promise<string> {
  try {
    const body = await readDispatchBody(res);
    let reason = body;
    const mediaType = res.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (mediaType?.endsWith('/json') || mediaType?.endsWith('+json') || (!mediaType && /^\s*[\[{]/.test(body))) {
      const data = JSON.parse(body) as { message?: unknown } | null;
      reason = typeof data?.message === 'string' ? data.message : '';
    }
    // Redact before clipping (including a token that would straddle the limit), and after
    // stripping tags in case the original response split the token across markup.
    return reason.replaceAll(token, '[redacted]').replace(/<[^>]*>/g, '').replace(/[<>]/g, '')
      .replaceAll(token, '[redacted]').replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();
  } catch {
    // An unreadable or malformed body cannot hide the HTTP status.
    return '';
  }
}

/** Send the GitHub request with the installation token, never the App JWT. */
export async function dispatchWorkflow(token: string | undefined, target: DispatchTarget): Promise<boolean> {
  token = token?.trim();
  if (!token) return false;
  const path = target.path.split('/').map(encodeURIComponent).join('/');
  await request(`${FORGE_SHAPES[DEFAULT_FORGE].dispatchOrigin}/repos/${path}/actions/workflows/${encodeURIComponent(target.workflow)}/dispatches`, {
    method: 'POST', headers: { ...headers, Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(target.inputs ? { ref: target.ref, inputs: target.inputs } : { ref: target.ref }),
  }, 'GitHub workflow dispatch', token);
  return true;
}
