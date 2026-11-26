import { DEFAULT_FORGE, parsePrUrl } from '../../core/forges';
import { isForgePath, isPullRequestUrl } from '../../core/links';
import type { CodeRepoEntry } from '../course-pr';
import { inferForge, prRepo, publicHost } from './index';
import { hostOf, slugOfUrl } from './remote';
import type { ForgeRegistration, ForgeRepo } from './types';

export interface RegisteredTargets {
  scope?: string[];
  forge_home?: ForgeRegistration;
  forge_repositories?: CodeRepoEntry[];
}

export function fromRemote(url: string, legacy = false): ForgeRepo | null {
  const host = hostOf(url);
  const forge = inferForge(host) ?? (legacy && host ? DEFAULT_FORGE : null);
  const path = slugOfUrl(url);
  return forge && isForgePath(forge, path) ? prRepo({ forge, path, webBase: `https://${host}/${path}` }) : null;
}

export function targetOf(ctx: RegisteredTargets, path?: string): ForgeRepo | null {
  const home = ctx.forge_home;
  if (!home) return null;
  if (!path || path.toLowerCase() === home.path.toLowerCase()) return prRepo(home);
  const entries = ctx.forge_repositories ?? [];
  const entry = entries.find((r) => r.path.toLowerCase() === path.toLowerCase());
  if (entry) return prRepo({ forge: entry.forge, path: entry.path, webBase: entry.web_base });
  if (entries.length) return null;
  const base = prRepo(home);
  const forge = base?.forge ?? DEFAULT_FORGE;
  if (!isForgePath(forge, path)) return null;
  const origin = base ? new URL(base.webBase).origin : `https://${publicHost(forge)}`;
  return prRepo({ forge, path, webBase: `${origin}/${path}` });
}

export function targetPr(ctx: RegisteredTargets, url: string): { repo: ForgeRepo; number: number } | null {
  const ref = parsePrUrl(url);
  if (!ref || (ctx.scope && !ctx.scope.includes(ref.path.toLowerCase()))) return null;
  const { path } = ref;
  const repo = targetOf(ctx, path);
  if (!repo || !isPullRequestUrl(repo.forge, url, repo.webBase)) return null;
  return { repo, number: Number(ref.number) };
}
