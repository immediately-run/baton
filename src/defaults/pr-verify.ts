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
import { forgeClient, listCli } from './forges';
import { targetOf, type RegisteredTargets } from './forges/targets';
import { branchMatches, matchPatterns } from './course-pr';
import type { OpenPrRef } from './forges/types';
import { parseFrontmatter, resolveTicketRepo, strList } from './tickets-markdown';

/** What the verification runs: `git` and `gh` in the checkout, answering trimmed stdout and
 * throwing on any non-zero exit — `course-markers`' `exec` shape, bound by the stub. */
export type PrExec = (cmd: 'git' | 'gh', args: string[], cwd: string) => string;

/** What `verifyPrOpen` is asked: where to look, and for whose PR. */
export interface PrOpenAsk extends RegisteredTargets {
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
  return strList(fm?.repos).map((r) => resolveTicketRepo(r, reposMap)).filter((r): r is string => r !== null);
}

/** The checkout's repository as its origin names it (`owner/name`), for the failure that names
 * where the stub looked; null when there is no origin to read. */
function originSlug(run: PrExec, checkout: string): string | null {
  try {
    const url = run('git', ['remote', 'get-url', 'origin'], checkout);
    return /[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\s*$/.exec(url)?.[1] ?? null;
  } catch {
    // B-93 (review round 2, should-fix 5): a checkout with no `origin` is the answer this asks
    // for — a ticket's PRs may sit in other repositories, and its home may have none — so the
    // failure is the null. The stub's `gitRun` now captures git's stderr
    // (`stdio: ['ignore', 'pipe', 'pipe']`, `src/defaults/cli.ts`), so the `error: No such remote
    // 'origin'` that used to print here reaches only the message this catch drops.
    return null;
  }
}

/** One PR as `gh pr list --json` answers it. */
type PrListItem = OpenPrRef;

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
export async function verifyPrOpen(ask: PrOpenAsk, run: PrExec): Promise<void> {
  const id = bareId(ask.ticket);
  const patterns = matchPatterns(ask.branchPatterns).map((p) => p.replace(/\{ticket\}/g, id));
  const slug = ask.forge_home?.path ?? originSlug(run, ask.checkout);
  // A `repos:` entry naming the checkout's own repository is the home, read first below — not a
  // sibling read twice and named twice ("exists in immediately-run/baton or immediately-run/baton",
  // 2026-11-16's failures, B-256).
  const siblings = (ask.repositories ?? []).filter((r, i, all) => all.indexOf(r) === i && (slug == null || r.toLowerCase() !== slug.toLowerCase()));
  const label = (repo: string | null): string => repo ?? slug ?? 'the checkout’s repository';
  /** One repository's matching open PRs, or the error that says it could not be read (the
   * command's own message: `gh pr list …` is the only call this makes). */
  const of = async (repo: string | null): Promise<PrListItem[]> => {
    const target = targetOf(ask, repo ?? undefined);
    const prs = target
      ? await forgeClient(target, { run, checkout: ask.checkout }).listOpenPrs()
      : ask.forge_home
        ? [] // Plain git, or outside the registry's effective code repositories.
        : listCli((args) => run('gh', args, ask.checkout), repo ?? undefined);
    return prs.filter((p) => p.sameRepository !== false && patterns.some((pat) => branchMatches(pat, p.headRefName)));
  };
  const found: { repo: string | null; prs: PrListItem[] | null; error: string | null }[] = [];
  for (const repo of [null, ...siblings]) {
    try { found.push({ repo, prs: await of(repo), error: null }); }
    catch (e) { found.push({ repo, prs: null, error: msg(e) }); }
  }
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

/** B-257: an implement agent's answer that the ticket is already delivered — the commits it
 *  names, which the stub checks are on the default branch, and the evidence it gives (what it
 *  ran), which is shown to the person who confirms and never trusted on its own. */
export interface DeliveredAnswer {
  /** The commits, as the agent wrote them (7 to 40 hex digits), in order, distinct. */
  shas: string[];
  /** The rest of the line: what the agent ran to find it delivered. */
  evidence: string;
  /** The line it was read from, trimmed. */
  line: string;
}

/** A `delivered` line: the word, one or more abbreviated or full commit ids with commas between,
 *  and the evidence. */
const DELIVERED_LINE = /^delivered\s+([0-9a-f]{7,40}(?:,[0-9a-f]{7,40})*)(?:\s+(.*))?$/;

/**
 * The `delivered` answer in `out`, or null when the agent gave none: backwards from its last
 * non-blank line, the first that opens with the word `delivered` followed by commit ids — read as
 * `answer.ts` reads a verdict, so a summary after the line loses nothing, and the word in prose
 * (`delivered the feature in #12`) is never an answer. A line naming commits and no evidence is
 * refused: the person who confirms reads what the agent ran.
 */
export function findDelivered(out: string): DeliveredAnswer | null {
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = DELIVERED_LINE.exec(lines[i]);
    if (m == null) continue;
    const evidence = (m[2] ?? '').trim();
    if (evidence === '') throw new Error(`the implement agent answered ${JSON.stringify(lines[i])} with no evidence — the line is \`delivered <sha> <what you ran to find it delivered>\``);
    return { shas: [...new Set(m[1].split(','))], evidence, line: lines[i] };
  }
  return null;
}

/** What `verifyDelivered` is asked: the checkout, the commits the agent named, and the
 *  repository's default branch — the claim's, which the stub resolves as the close does
 *  (`ticketsBranch`: `BATON_DEFAULT_BRANCH`, else the checkout's `origin/HEAD`, else `main`). */
export interface DeliveredAsk {
  checkout: string;
  shas: string[];
  branch: string;
}

/**
 * B-257: each commit the agent named, resolved to its full sha and checked to be on the default
 * branch as `origin` has it now — fetched first, so a commit only in the agent's checkout, on
 * another branch or unpushed is refused, naming it. Returns the full shas in the agent's order.
 * The agent's word that the work is done is not checked here and never closes the ticket: a
 * person confirms it (the course's `confirm` leg).
 */
export function verifyDelivered(ask: DeliveredAsk, run: PrExec): string[] {
  if (ask.shas.length === 0) throw new Error('the implement agent answered delivered naming no commit');
  const branch = ask.branch;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..')) throw new Error(`cannot verify the delivered answer — ${JSON.stringify(branch)} is no branch name`);
  const tracking = `refs/remotes/origin/${branch}`;
  try {
    run('git', ['fetch', '-q', 'origin', `+refs/heads/${branch}:${tracking}`], ask.checkout);
  } catch (e) {
    throw new Error(`cannot verify the delivered answer — fetching ${branch} from origin failed: ${msg(e)}`);
  }
  return ask.shas.map((sha) => {
    let full: string;
    try {
      full = run('git', ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], ask.checkout).trim();
    } catch {
      throw new Error(`the implement agent answered delivered at ${sha}, which names no commit this checkout knows — refused`);
    }
    if (!/^[0-9a-f]{40}$/.test(full)) throw new Error(`the implement agent answered delivered at ${sha}, which names no commit this checkout knows — refused`);
    if (!ancestor(full, tracking, run, ask.checkout)) {
      throw new Error(`the implement agent answered delivered at ${sha}, which is not on ${branch} — refused: the commit a delivered answer names is on the default branch`);
    }
    return full;
  });
}

/** The end's `detail` for a delivered answer (§10.4 free text, at most 200 characters): the
 *  commits, shortened, and the agent's evidence with every character free text refuses blanked. */
export function deliveredDetail(shas: string[], evidence: string): string {
  const head = `delivered at ${shas.map((s) => s.slice(0, 10)).join(', ')}`;
  const said = evidence.replace(/[\u0000-\u001f\u007f-\u009f<>{}]/g, ' ').replace(/\s+/g, ' ').trim();
  const text = said === '' ? head : `${head}: ${said}`;
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`;
}
