import { isPullRequestUrl } from '../../core/links';
import type { OpenPrRef, ForgeRepo } from './types';

const MAX_PAGES = 50;
const PAGE_SIZE = 50;
export const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
export const prNumber = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 999_999_999;
export function openRef(number: unknown, branch: unknown, oid: unknown): OpenPrRef {
  if (!prNumber(number) || typeof branch !== 'string' || !branch || branch.length > 1024 || !sha(oid)) throw new Error('malformed PR head');
  return { number, headRefName: branch, headRefOid: oid };
}

export function opened(repo: ForgeRepo, url: unknown): string {
  if (typeof url !== 'string' || !isPullRequestUrl(repo.forge, url, repo.webBase)) throw new Error(`${repo.forge} answered no PR URL for ${repo.path}`);
  return url;
}

export function rest(api: string, name: string, token: () => string, fetchImpl: typeof fetch, auth = 'Bearer', budget = () => {}) {
  const request = async (path: string, payload?: object): Promise<any> => {
    budget();
    const authorization = `${auth} ${token()}`;
    const res = await fetchImpl(`${api}${path}`, {
      headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'baton-cli' },
      ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    }).catch(() => { throw new Error(`${name} was not reached`); });
    if (!res.ok) throw new Error(`${name} answered ${res.status} at ${path.split('?')[0]}`);
    return res.json();
  };
  const list = async (path: string, sizeKey = 'per_page'): Promise<any[]> => {
    const out: any[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const got: unknown = await request(`${path}${path.includes('?') ? '&' : '?'}${sizeKey}=${PAGE_SIZE}&page=${page}`);
      if (!Array.isArray(got) || got.length > PAGE_SIZE) throw new Error(`${name} answered a malformed page`);
      out.push(...got);
      if (got.length < PAGE_SIZE) return out;
    }
    throw new Error(`${name} exceeded ${MAX_PAGES} pages; refusing a partial reading`);
  };
  return { request, list };
}
