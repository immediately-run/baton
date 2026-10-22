// pr-verify.ts — the `create-pr` implement stub's verification (B-81, BATON_SPEC §5.8 R-BTN-131,
// §2f R-BTN-74): the outcome the leg claims, read from the forge, not the agent's word for it.
// The stub returned `pr-open` for any agent that exited 0; one that committed nothing and opened
// no PR advanced its claim to a review of nothing (the first acceptance run, 2026-10-21), and no
// sync ever contradicted it in time. Here the stub asks the forge — with the agent's own
// credentials, `gh` in the checkout — for an open PR on a branch the course's branch patterns map
// to the ticket, in the checkout's repository or one the ticket's `repos:` names (B-29), and for
// the checkout's branch, when it feeds such a PR, being the head the PR shows: the review reads
// what is pushed. What cannot be verified fails the leg naming what was looked for; the stub
// reports, never retries (R-BTN-131). Pure over injected commands, so tests drive it with no
// forge; the stub binds `gh` and `git`. Course code in the CLI, never core (§2b).
import { branchMatches, matchPatterns } from './course-pr';
import { parseFrontmatter } from './tickets-markdown';

/** What the verification runs: `git` and `gh` in the checkout, answering trimmed stdout and
 * throwing on any non-zero exit — `course-markers`' `exec` shape, bound by the stub. */
export type PrExec = (cmd: 'git' | 'gh', args: string[], cwd: string) => string;

/** What `verifyPrOpen` is asked: where to look, and for whose PR. */
export interface PrOpenAsk {
  checkout: string;
  /** The claim's ticket, its id repository-qualified (`docs:B-1`, R-BTN-51). */
  ticket: { id: string; home?: string | null };
  /** The course's branch patterns (R-BTN-51): `branch_pattern` and `previous_branch_pattern`. */
  branchPatterns?: string[];
  /** The repositories the ticket's `repos:` names, already resolved (`ticketRepositories`). */
  repositories?: string[];
}

/** The bare ticket id the patterns map, as `course-markers`' marker writes it: `docs:B-1` → `B-1`. */
const bareId = (t: { id: string; home?: string | null }): string => {
  if (t.home && t.id.startsWith(`${t.home}:`)) return t.id.slice(t.home.length + 1);
  const colon = t.id.indexOf(':');
  return colon < 0 ? t.id : t.id.slice(colon + 1);
};

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The repositories a ticket's `repos:` names (B-29), resolved as the markdown source resolves
 * them (R-BTN-74): `owner/name` stands; a short name through the `repos` map `.baton/baton.json`
 * carries. A name the map does not resolve is dropped — the sync fails it loudly when it reads
 * the file; this reads the checkout as the agent left it. */
export function ticketRepositories(text: string | null, reposMap?: Record<string, string>): string[] {
  const fm = text == null ? null : parseFrontmatter(text);
  const names = Array.isArray(fm?.repos) ? fm!.repos : fm?.repos == null || fm!.repos === '' ? [] : [fm!.repos];
  return names
    .map((r) => (typeof r === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) ? r : reposMap?.[r]))
    .filter((r): r is string => typeof r === 'string' && r !== '');
}

/** The checkout's repository as its origin names it (`owner/name`), for the failure that names
 * where the stub looked; null when there is no origin to read. */
function originSlug(run: PrExec, checkout: string): string | null {
  try {
    const url = run('git', ['remote', 'get-url', 'origin'], checkout);
    return /[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\s*$/.exec(url)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** One PR as `gh pr list --json` answers it. */
interface PrListItem {
  number?: unknown;
  headRefName?: unknown;
  headRefOid?: unknown;
}

/** Whether git knows `oid` in the checkout (`cat-file -e`): a comparison over an object the
 * checkout never saw — a PR head someone else pushed — is skipped, never guessed. */
const known = (oid: string, run: PrExec, checkout: string): boolean => {
  try {
    run('git', ['cat-file', '-e', oid], checkout);
    return true;
  } catch {
    return false;
  }
};

/** `git merge-base --is-ancestor a b`, over objects `known` already vouched for: exit 1 is a
 * plain false, so a throw here is a failure to run git, not an answer. */
const ancestor = (a: string, b: string, run: PrExec, checkout: string): boolean => {
  try {
    run('git', ['merge-base', '--is-ancestor', a, b], checkout);
    return true;
  } catch {
    return false;
  }
};

/** Verify what the implement leg is about to claim (B-81), throwing the failure that names what
 * was looked for: an open PR on a matching branch must exist in one of the repositories the
 * ticket reads, and the checkout's branch, when it feeds one, must be a head the PR contains.
 * One repository's PRs are enough — a ticket's change may sit in any of them (B-29) — but a
 * forge nothing answers fails the leg: what cannot be verified is not reported. Reading the
 * forge over `gh` — the credentials the agent itself opened the PR with — this is course code's
 * own read of the forge, never core's (§2b). */
export function verifyPrOpen(ask: PrOpenAsk, run: PrExec): void {
  const id = bareId(ask.ticket);
  const patterns = matchPatterns(ask.branchPatterns).map((p) => p.replace(/\{ticket\}/g, id));
  const siblings = ask.repositories ?? [];
  const slug = originSlug(run, ask.checkout);
  const label = (repo: string | null): string => repo ?? slug ?? 'the checkout’s repository';
  /** One repository's matching open PRs, or the error that says it could not be read (the
   * command's own message: `gh pr list …` is the only call this makes). */
  const of = (repo: string | null): PrListItem[] => {
    const args = ['pr', 'list', '--state', 'open', '--limit', '300', '--json', 'number,headRefName,headRefOid', ...(repo ? ['--repo', repo] : [])];
    let text: string;
    try {
      text = run('gh', args, ask.checkout);
    } catch (e) {
      throw new Error(msg(e));
    }
    let prs: unknown;
    try {
      prs = JSON.parse(text);
    } catch {
      prs = null;
    }
    if (!Array.isArray(prs)) throw new Error(`gh pr list${repo ? ` --repo ${repo}` : ''} answered no PR list: ${text.slice(0, 200)}`);
    return prs.filter((p): p is PrListItem => p != null && typeof p === 'object' && typeof (p as PrListItem).headRefName === 'string' && patterns.some((pat) => branchMatches(pat, (p as PrListItem).headRefName as string)));
  };
  // Every repository the ticket reads, home first: its PR is the usual one, and the checkout
  // comparison below reads only it. A repository that cannot be read is named, never guessed.
  const found = [null, ...siblings].map((repo) => {
    try {
      return { repo, prs: of(repo) as PrListItem[] | null, error: null as string | null };
    } catch (e) {
      return { repo, prs: null as PrListItem[] | null, error: msg(e) as string | null };
    }
  });
  // The checkout's branch, when it feeds a matching home PR, is the head that PR shows — equal,
  // or behind a PR that moved past it; a head the PR does not contain is work the forge lacks
  // (B-81: the review reads what is pushed).
  let branch = '';
  try {
    branch = run('git', ['branch', '--show-current'], ask.checkout);
  } catch {
    branch = '';
  }
  if (branch !== '') {
    let head: string | null = null;
    try {
      head = run('git', ['rev-parse', 'HEAD'], ask.checkout);
    } catch {
      head = null;
    }
    for (const pr of found[0].prs ?? []) {
      if (pr.headRefName !== branch || typeof pr.headRefOid !== 'string' || pr.headRefOid === '' || head == null) continue;
      if (head === pr.headRefOid) continue;
      if (!known(pr.headRefOid, run, ask.checkout)) continue; // never an object here: nothing to compare
      if (!ancestor(head, pr.headRefOid, run, ask.checkout)) {
        throw new Error(`the checkout’s branch ${branch} is at ${head.slice(0, 10)}, but its open PR #${String(pr.number)} is at ${pr.headRefOid.slice(0, 10)} — push the branch: the review reads what is pushed`);
      }
    }
  }
  if (found.some((f) => (f.prs ?? []).length > 0)) return;
  const unread = found.filter((f) => f.error != null);
  const read = found.filter((f) => f.prs != null).map((f) => label(f.repo));
  if (read.length === 0) {
    throw new Error(`cannot verify ${id}’s PR — no repository the ticket reads could be read: ${unread.map((f) => `${label(f.repo)} (${f.error})`).join('; ')}`);
  }
  throw new Error(`the implement agent exited 0, but no open PR on a branch matching ${patterns.join(' or ')} for ticket ${id} exists in ${read.join(' or ')}${unread.length ? ` — ${unread.map((f) => label(f.repo)).join(' or ')} could not be read` : ''} — open one from a matching branch with its head pushed, or the leg fails here`);
}
