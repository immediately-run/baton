// S-BTN-309: the sync filters forge and git facts to pointers; it never chooses a position.
import type { PostedAttestation } from '../core/board';
import type { Graph } from '../core/graph';
import { LOCAL_ID } from '../core/validate';
import { latestHeadVerdict, ticketOwns, verdictOf, type PrFact } from './course-pr';
import type { SourceTicket } from './tickets-markdown';

export interface OutsideRecord {
  sha: string | null;
  observed_at: number;
  head_accepted_at: number | null;
  runner_pushers: string[] | null;
  positions: Record<string, { station: string; changed_at: number }>;
  verdict_refs: Record<string, string[]>;
  claim_prs: Record<string, string[]>;
  claim_shas: Record<string, string[]>;
  merge_refs: Record<string, string[]>;
}

export interface MentionCommit {
  sha: string;
  message: string;
  paths: string[];
}

const named = (text: string) => new Set((text.match(/[\w-]+/g) ?? []).filter((word) => LOCAL_ID.test(word) && /-[0-9]+[a-z0-9]*$/i.test(word)));
const lower = (login: string | undefined) => login?.toLowerCase();
const repoName = (name: string) => name.toLowerCase().replace(/\.git$/, '');

/** The shared completion test, after mapping PRs to the ticket. A closed unmerged PR
 * does not add a repository requirement on its own. */
export function mappedMerges<T extends Pick<PrFact, 'state' | 'repository' | 'base' | 'defaultBranch' | 'mergeSha'>>(facts: T[], repos: string[], home: string | null) {
  const merged = facts.filter((f) => f.state === 'merged' && f.mergeSha && (f.defaultBranch == null || f.base === f.defaultBranch));
  const mergedRepos = new Set(merged.map((f) => repoName(f.repository ?? home ?? '')));
  const expected = new Set([...facts.filter((f) => f.state !== 'closed').map((f) => f.repository ?? home ?? ''), ...repos].map(repoName));
  return { merged, complete: merged.length > 0 && !facts.some((f) => f.state === 'open') && [...expected].every((r) => mergedRepos.has(r)) };
}

export function outsideAttestations(input: {
  tickets: SourceTicket[];
  facts: PrFact[];
  graph: Graph;
  patterns: string[];
  repository: string | null;
  record: OutsideRecord;
  commits: MentionCommit[];
  mentionSince: number | null;
  ticketDir: string;
  filingCommit: (path: string) => string | null;
  ownPr: (pr: PrFact) => boolean;
}): PostedAttestation[] {
  const { graph, facts, tickets, repository, record } = input;
  const out: PostedAttestation[] = [];
  const runners = new Set(record.runner_pushers?.map(lower));
  const prMentions = input.mentionSince == null ? [] : facts.filter((f) => f.state === 'merged' && (f.defaultBranch == null || f.base === f.defaultBranch) && f.pusher === true && !!f.url
    && f.mergedAt != null && f.mergedAt > input.mentionSince! && f.mergedAt <= record.observed_at && !input.ownPr(f))
    .map((f) => ({ fact: f, ids: named(`${f.title ?? ''}\n${f.body ?? ''}`) })).filter((p) => p.ids.size <= 3);
  const mentionedCommits = input.commits.filter((c) => c.paths.some((p) => !p.startsWith(`${input.ticketDir}/`) && !p.startsWith('.baton/')))
    .map((c) => ({ ...c, ids: named(c.message) })).filter((c) => c.ids.size <= 3);
  for (const ticket of tickets) {
    const position = record.positions[ticket.id];
    const station = position?.station ?? graph.start;
    if (graph.ends.has(station)) continue;
    const mine = facts.filter((f) => ticketOwns(ticket, f, input.patterns, repository));
    const claimPrs = new Set(record.claim_prs[ticket.id]);
    const claimShas = new Set(record.claim_shas[ticket.id]);
    const mergeRefs = new Set(record.merge_refs[ticket.id]);
    const verdictRefs = new Set(record.verdict_refs[ticket.id]);
    const postEvidence = (ref: string, kind: 'mention' | 'merged-early') => out.push({ type: 'std:evidence@1', ticket: ticket.id, ref, value: { ref, kind } });
    const arrive = (fact: NonNullable<ReturnType<Graph['legs']['get']>>['arrives'], ref: string, verdict?: 'approve' | 'changes') => {
      let found = false;
      for (const [leg, def] of graph.legs) {
        const a = def.arrives;
        if (!a || a.fact !== fact?.fact || !def.from.includes(station) || (a.verdict != null && a.verdict !== verdict)) continue;
        const next = typeof a.next === 'string' ? a.next : verdict ? a.next?.[verdict] : undefined;
        out.push({ type: 'std:arrival@1', ticket: ticket.id, ref, value: { ref, leg, reached: def.to[0], ...(next ? { next } : {}) } });
        found = true;
      }
      return found;
    };
    const { merged, complete } = mappedMerges(mine, ticket.repos ?? [], repository);
    const last = [...merged].sort((a, b) => (b.mergedAt ?? 0) - (a.mergedAt ?? 0)).find((f) => f.mergeSha && !mergeRefs.has(f.mergeSha) && !mergeRefs.has(f.url ?? ''));
    let mergeArrived = false;
    if (last?.mergeSha) {
      const allHand = merged.every((f) => !mergeRefs.has(f.mergeSha ?? '') && !mergeRefs.has(f.url ?? ''));
      mergeArrived = complete && allHand && arrive({ fact: 'pr-merged' }, last.mergeSha);
      if (!mergeArrived) postEvidence(last.mergeSha, 'merged-early');
    }
    if (runners.size && !mergeArrived) {
      const heads = new Set<string>();
      for (const f of mine) {
        if (f.state !== 'open' || f.pusher !== true) continue;
        if (f.url && f.author && !runners.has(lower(f.author)) && !claimPrs.has(f.url)) arrive({ fact: 'pr-opened' }, f.url);
        const push = f.headPush;
        const latest = latestHeadVerdict(f, push?.at ?? f.pushedAt);
        if (latest?.url && push && latest.submittedAt > (position?.changed_at ?? 0)
          && latest.submittedAt >= push.at && f.headSha && !heads.has(f.headSha) && !verdictRefs.has(latest.url)
          && !runners.has(lower(latest.author)) && lower(latest.author) !== lower(f.author) && lower(latest.author) !== lower(push.actor)) {
          heads.add(f.headSha);
          arrive({ fact: 'pr-verdict' }, latest.url, verdictOf(latest)!);
        }
        const changes = f.reviews.filter((v) => verdictOf(v) === 'changes').sort((a, b) => b.submittedAt - a.submittedAt)[0];
        if (changes && push && f.headSha && push.at > changes.submittedAt && (!latest || latest.submittedAt < push.at)
          && !runners.has(lower(push.actor)) && !claimShas.has(f.headSha) && push.changesWork) {
          arrive({ fact: 'pr-pushed' }, f.headSha);
        }
      }
    }
    const reachable = new Set([repository ?? '', ...(ticket.repos ?? [])].map(repoName));
    for (const { fact, ids } of prMentions) {
      if (ids.has(ticket.id) && reachable.has(repoName(fact.repository ?? repository ?? '')) && !claimShas.has(fact.mergeSha ?? '')) postEvidence(fact.url!, 'mention');
    }
    const merges = new Set(facts.filter(input.ownPr).flatMap((f) => f.mergeSha ?? []));
    const commits = mentionedCommits.filter((c) => c.ids.has(ticket.id) && !claimShas.has(c.sha) && !merges.has(c.sha));
    const filing = commits.length && ticket.path ? input.filingCommit(ticket.path) : null;
    for (const commit of commits) if (commit.sha !== filing) postEvidence(commit.sha, 'mention');
  }
  return [...new Map(out.filter((a) => a.ref && a.ref.length <= 200)
    .map((a) => [`${a.ticket}:${a.type}:${a.ref}`, a])).values()];
}
