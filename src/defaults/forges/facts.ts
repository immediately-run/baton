import { DEFAULT_FORGE, FORGE_SHAPES } from '../../core/forges';
import { gitText } from '../git.mjs';
import type { PostedAttestation } from '../../core/board';
import { sameRepo, type CodeRepoEntry, type PrFact } from '../course-pr';
import { remoteSlug } from '../remote-slug';
import { forgeReader, inferForge, prRepo, publicHost } from './index';
import { hostOf } from './remote';
import type { FactContext, FactRead, ForgeRegistration, ForgeRepo } from './types';

export async function readForgeFacts(root: string, log: FactContext['log'], owns: FactContext['owns'],
  siblings: { repository: string; tickets: string[] }[] = [],
  obs: { home?: ForgeRegistration; code_repos?: CodeRepoEntry[]; codeRepos?: CodeRepoEntry[]; pushers?: FactContext['pushers']; outputEvidence?: PostedAttestation[]; ticketOutputEvidence?: PostedAttestation[]; readPrs?: boolean; ownsOutput?: FactContext['ownsOutput']; outside?: FactContext['outside']; mentionSince?: FactContext['mentionSince'] } = {}): Promise<PrFact[]> {
  const slug = obs.home?.path ?? remoteSlug(root);
  if (!slug) throw new Error(`${root} has no origin remote to read PRs from — pass --facts <file> for recorded facts`);
  const fallback = (path: string, host: string) => prRepo({ forge: inferForge(host) ?? DEFAULT_FORGE, path, webBase: `https://${host}/${path}` })!;
  const legacy = () => {
    const origin = gitText(root, 'remote', 'get-url', 'origin');
    const host = hostOf(origin);
    return host && (!origin.startsWith('ssh://') || inferForge(host)) ? fallback(slug, inferForge(host) ? host : publicHost(DEFAULT_FORGE)) : null;
  };
  const home = obs.home ? prRepo(obs.home) : legacy();
  const entries = obs.code_repos ?? obs.codeRepos ?? [];
  const reads: { repo: ForgeRepo; read: FactRead }[] = home ? [{ repo: home, read: { tickets: [], ticketOutputs: obs.ticketOutputEvidence, readPrs: obs.readPrs } }] : [];
  for (const s of siblings) {
    if (home && sameRepo(s.repository, home.path)) continue;
    const entry = entries.find((e) => sameRepo(e.path, s.repository));
    if (entry) reads.push({ repo: prRepo({ forge: entry.forge, path: entry.path, webBase: entry.web_base })!, read: { ...s, entry } });
    else if (!entries.length) reads.push({ repo: home ? { ...home, path: s.repository, webBase: `${new URL(home.webBase).origin}/${s.repository}` } : fallback(s.repository, new URL(FORGE_SHAPES[DEFAULT_FORGE].defaultOrigin!).host), read: s });
    else log(`baton: ${s.repository} not in code_repos — its PRs are not read (R-BTN-140)`);
  }
  const out: PrFact[] = [];
  const client = forgeReader({ log, owns, outputEvidence: obs.outputEvidence, ownsOutput: obs.ownsOutput, pushers: obs.pushers ?? [], outside: obs.outside, mentionSince: obs.mentionSince });
  if (!home && reads.length) log(`baton: the home is a plain git repository, not on a forge — reading only the repositories tickets name in repos: (${reads.length})`);
  for (const { repo, read } of reads) out.push(...await client(repo).facts(read));
  return out;
}
