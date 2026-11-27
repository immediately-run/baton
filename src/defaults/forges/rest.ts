import { isPullRequestUrl } from '../../core/links';
import type { OpenPrRef, ForgeRepo } from './types';

const MAX_PAGES = 50;
const PAGE_SIZE = 50;
export const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
export const prNumber = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 999_999_999;
export const immutableId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
export const sameRepository = (head: unknown, base: unknown): boolean => immutableId(head) && head === base;
/** A forge's JSON answer is untrusted input: the value at `keys` under `v`, or undefined where a
 *  step along the way is not an object. Callers narrow what it answers before using it. */
export function field(v: unknown, ...keys: (string | number)[]): unknown {
  let at = v;
  for (const key of keys) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Record<string | number, unknown>)[key];
  }
  return at;
}
export const prState = (v: unknown): OpenPrRef['state'] => v === 'open' || v === 'merged' || v === 'closed' ? v : undefined;
export function openRef(number: unknown, branch: unknown, oid: unknown): OpenPrRef {
  if (!prNumber(number) || typeof branch !== 'string' || !branch || branch.length > 1024 || !sha(oid)) throw new Error('malformed PR head');
  return { number, headRefName: branch, headRefOid: oid };
}

export function opened(repo: ForgeRepo, url: unknown): string {
  if (typeof url !== 'string' || !isPullRequestUrl(repo.forge, url, repo.webBase)) throw new Error(`${repo.forge} answered no PR URL for ${repo.path}`);
  return url;
}

export function rest(api: string, name: string, token: () => string, fetchImpl: typeof fetch, auth = 'Bearer', budget = () => {}) {
  const response = async (path: string, payload?: object): Promise<Response> => {
    budget();
    const authorization = `${auth} ${token()}`;
    const res = await fetchImpl(`${api}${path}`, {
      headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'baton-cli' },
      ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    }).catch(() => { throw new Error(`${name} was not reached`); });
    return res;
  };
  const checked = async (path: string, payload?: object): Promise<Response> => {
    const res = await response(path, payload);
    if (!res.ok) throw new Error(`${name} answered ${res.status} at ${path.split('?')[0]}`);
    return res;
  };
  const request = async (path: string, payload?: object): Promise<unknown> => (await checked(path, payload)).json();
  const list = async (path: string, sizeKey = 'per_page', unpack: (body: unknown) => unknown = (body) => body): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await checked(`${path}${path.includes('?') ? '&' : '?'}${sizeKey}=${PAGE_SIZE}&page=${page}`);
      const got = unpack(await res.json());
      if (!Array.isArray(got) || got.length > PAGE_SIZE) throw new Error(`${name} answered a malformed page`);
      out.push(...got);
      // Continuation is a signal only: never send the token to a URL supplied in Link.
      const next = res.headers.get('x-next-page');
      const total = Number(res.headers.get('x-total-count') ?? NaN);
      const link = res.headers.get('link');
      if (next || (link && /;\s*rel="?next(?:"|\s|,|$)/i.test(link)) || (Number.isSafeInteger(total) && total > out.length)) continue;
      if (next !== null || link !== null || got.length < PAGE_SIZE) return out;
    }
    throw new Error(`${name} exceeded ${MAX_PAGES} pages; refusing a partial reading`);
  };
  const unpaged = async (path: string): Promise<unknown[]> => {
    const got: unknown = await request(path);
    if (!Array.isArray(got) || got.length > MAX_PAGES * PAGE_SIZE) throw new Error(`${name} answered an oversized or malformed list`);
    return got;
  };
  return { request, list, unpaged, response };
}
