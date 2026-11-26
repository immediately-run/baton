// The request command's protected-branch fallback, backed by the course clients.
import { DEFAULT_FORGE, FORGES as NAMED_FORGES, hasPrs, isForge, type PrForge } from '../core/forges';
import { forgeClient, inferForge, prRepo, tokenOf } from './forges';
import { hostOf } from './forges/remote';
import type { OpenPr } from './forges/types';
export { forgeApi, protectedRefusal, tokenOf } from './forges';
export { hostOf, NAMED_FORGES, type PrForge };

export function requestForge(named: string | undefined, originUrl: string | null): PrForge | null {
  if (named != null) return isForge(named) && hasPrs(named) ? named : null;
  return originUrl && inferForge(hostOf(originUrl)) === DEFAULT_FORGE ? DEFAULT_FORGE : null;
}

export async function openRequestPr(pr: OpenPr & { forge: PrForge; host: string; repo: string }, token: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const webBase = `https://${pr.host}/${pr.repo}`;
  try {
    const repo = prRepo({ forge: pr.forge, path: pr.repo, webBase })!;
    return await forgeClient(repo, { env: { [tokenOf(pr.forge)]: token }, fetchImpl }).openPr(pr);
  } catch (e) {
    const message = (e as Error).message;
    throw new Error(`${pr.forge} (${pr.host}) could not open the PR from ${pr.head}: ${message} — the request is pushed on ${pr.head}; open the PR yourself`);
  }
}
