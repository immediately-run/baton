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
import { branchMatches, latestHeadVerdict, matchPatterns, ticketOwns, verdictOf, type PrFact } from './course-pr';
import { mappedMerges } from './outside-work';
import { parseFrontmatter } from './tickets-markdown';

export function reconcileAnswer(out: string, ask: PrOpenAsk & {
  ticketText: string | null; from: string; displaced: string; to: Record<string, string | null>; branch: string;
}, run: PrExec) {
  const line = out.trim().split('\n').at(-1)?.trim() ?? '';
  if (/^unchanged\s+\S/.test(line)) return { end: 'done', reached: ask.from, next: ask.displaced };
  const home = originSlug(run, ask.checkout);
  const repos = [home, ...(ask.repositories ?? [])].map((r) => r?.toLowerCase());
  const prs = parseFrontmatter(ask.ticketText ?? '')?.prs;
  const ticket = { id: bareId(ask.ticket), repos: ask.repositories ?? [], course: { prs: Array.isArray(prs) ? prs : [] } };
  const owns = (number: number, head: string, repository: string) => ticketOwns(ticket, { number, head, repository }, matchPatterns(ask.branchPatterns), home);
  const apiRun = (host: string, repo: string, path: string) => run('gh', ['api', '--hostname', host, `repos/${repo}${path ? `/${path}` : ''}`], ask.checkout);
  const list = (host: string, repo: string, path: string): any[] => {
    const pages = JSON.parse(run('gh', ['api', '--hostname', host, '--paginate', '--slurp', `repos/${repo}/${path}`], ask.checkout));
    if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) throw new Error('forge did not return a complete PR reading');
    return pages.flat();
  };
  const readPr = (ref: string, owned: boolean) => {
    const m = /^https:\/\/([\w.-]+)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:#(issuecomment|pullrequestreview)-(\d+))?$/.exec(ref);
    if (!m || !repos.includes(m[2].toLowerCase())) throw new Error('name a PR in the ticket repositories');
    const remote = run('git', ['remote', 'get-url', 'origin'], ask.checkout);
    const host = /^(?:https?:\/\/|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([\w.-]+)[/:]/.exec(remote)?.[1];
    if (m[1] !== host) throw new Error('PR is not on the checkout forge');
    const repo = `${m[1]}/${m[2]}`;
    const api = (path: string) => JSON.parse(apiRun(m[1], m[2], path));
    const pr = JSON.parse(run('gh', ['pr', 'view', m[3], '--repo', repo, '--json', 'state,headRefName,headRefOid,baseRefName,mergeCommit,updatedAt'], ask.checkout));
    if (pr.baseRefName !== api('').default_branch) throw new Error('PR does not target the default branch');
    if (owned && !owns(Number(m[3]), pr.headRefName, m[2])) throw new Error('PR is not mapped to this ticket');
    return { pr, m, api };
  };
  const delivered = /^delivered\s+(\S+)\s+(\S.*)$/.exec(line);
  if (delivered && ask.to.delivered === 'confirm') {
    const shas = delivered[1].split(',').map((ref) => {
      if (/^[a-f0-9]{7,40}$/i.test(ref)) return ref;
      const { pr, m } = readPr(ref, false);
      if (m[4] || pr.state !== 'MERGED' || !pr.mergeCommit?.oid) throw new Error('delivered requires a merged PR or commit');
      if (m[2].toLowerCase() !== home?.toLowerCase()) return null; // The sibling's forge verified its default-branch merge.
      return String(pr.mergeCommit.oid);
    }).filter((sha): sha is string => sha != null);
    const checked = shas.length ? verifyDelivered({ checkout: ask.checkout, branch: ask.branch, shas }, run) : [];
    return { end: 'done', reached: 'delivered', next: 'confirm', detail: deliveredDetail(checked.length ? checked : delivered[1].split(','), delivered[2]) };
  }
  const at = /^at\s+(\S+)\s+(\S+)/.exec(line);
  if (!at || !Object.hasOwn(ask.to, at[1]) || at[1] === 'delivered') throw new Error('expected unchanged <reason>, at <station> <ref>, or delivered <refs> <evidence>');
  const station = at[1];
  const { pr, m, api } = readPr(at[2], true);
  if (station === 'merged' ? pr.state !== 'MERGED' : station !== 'concluded' && pr.state !== 'OPEN') throw new Error(`PR does not support ${station}`);
  if (station === 'concluded' && pr.state === 'OPEN') throw new Error('PR is still open');
  if (station === 'merged') {
    const mapped = [...new Set(repos.filter((r): r is string => r != null))].flatMap((repository) => {
      const defaultBranch = JSON.parse(apiRun(m[1], repository, '')).default_branch;
      if (typeof defaultBranch !== 'string' || !defaultBranch) throw new Error('cannot verify the default branch');
      return list(m[1], repository, 'pulls?state=all&per_page=100').filter((p) => owns(p.number, p.head.ref, repository))
        .map((p) => ({ repository, state: p.merged_at ? 'merged' as const : p.state === 'open' ? 'open' as const : 'closed' as const,
          base: p.base.ref, defaultBranch, mergeSha: p.merge_commit_sha, number: p.number }));
    });
    const { complete, merged } = mappedMerges(mapped, ticket.repos, home);
    if (m[4] || !complete || !merged.some((p) => p.repository === m[2].toLowerCase() && p.number === Number(m[3]))) {
      throw new Error('not all mapped repositories have merged PRs, or a mapped PR is still open');
    }
  }
  if (['reviewed', 'approved', 'changes-requested'].includes(station)) {
    if (m[4] !== 'pullrequestreview') throw new Error('name a review on the current PR head');
    const mapped = (r: any, comment = false): PrFact['reviews'][number] => ({ author: r.user?.login ?? '',
      body: r.body, state: comment ? 'COMMENTED' : r.state, headSha: comment ? undefined : r.commit_id,
      submittedAt: Date.parse(comment ? r.created_at : r.submitted_at), url: r.html_url });
    const permissions = new Map<string, boolean>();
    const counts = (r: PrFact['reviews'][number]) => {
      if (!verdictOf(r) || !/^[\w-]+$/.test(r.author)) return false;
      if (!permissions.has(r.author)) {
        permissions.set(r.author, ['write', 'maintain', 'admin'].includes(api(`collaborators/${r.author}/permission`).permission));
      }
      return permissions.get(r.author);
    };
    const native = list(m[1], m[2], `pulls/${m[3]}/reviews?per_page=100`).map((r) => mapped(r)).filter(counts);
    const named = native.find((r) => r.url === at[2] && r.headSha === pr.headRefOid);
    if (!named) throw new Error('review is not a qualifying verdict on the current PR head');
    // Even without a ref update timestamp, any unbound comment newer than a submitted
    // review of this exact SHA can supersede it. Never authorize from an unbound comment.
    const comments = list(m[1], m[2], `issues/${m[3]}/comments?per_page=100`).map((r) => mapped(r, true)).filter((r) => r.submittedAt >= named.submittedAt).filter(counts);
    const latest = latestHeadVerdict({ headSha: pr.headRefOid, reviews: [...native, ...comments] }, named.submittedAt - 1);
    if (latest?.url !== at[2] || verdictOf(latest) !== (station === 'changes-requested' ? 'changes' : 'approve')) {
      throw new Error('review is not the latest qualifying verdict on the current PR head');
    }
  }
  return { end: 'done', reached: station, next: ask.to[station] };
}

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
    // B-93 (review round 2, should-fix 5): a checkout with no `origin` is the answer this asks
    // for — a ticket's PRs may sit in other repositories, and its home may have none — so the
    // failure is the null. The stub's `gitRun` now captures git's stderr
    // (`stdio: ['ignore', 'pipe', 'pipe']`, `src/defaults/cli.ts`), so the `error: No such remote
    // 'origin'` that used to print here reaches only the message this catch drops.
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
  const slug = originSlug(run, ask.checkout);
  // A `repos:` entry naming the checkout's own repository is the home, read first below — not a
  // sibling read twice and named twice ("exists in immediately-run/baton or immediately-run/baton",
  // 2026-11-16's failures, B-256).
  const siblings = (ask.repositories ?? []).filter((r, i, all) => all.indexOf(r) === i && (slug == null || r.toLowerCase() !== slug.toLowerCase()));
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

/** One repository's read for `verifyPrsMerged`: the ticket's open and merged PRs there, or why
 * the forge did not answer. */
interface MergedRead {
  repo: string | null;
  open: PrListItem[] | null;
  merged: PrListItem[] | null;
  error: string | null;
}

/** Verify what the merge leg is about to claim (R-BTN-131: a stub whose leg claims a PR verifies
 * it on the forge before it reports a position): every PR of the ticket — on a branch the
 * course's patterns map to it, in the checkout's repository and each one its `repos:` names — is
 * merged, none still open, at least one merged. The stub returned `merged` for any merge agent
 * that exited 0; on 2026-11-23 B-259's agent rightly refused to merge PR #357 over red CI, said
 * so and exited 0, and the leg reported `merged` with the PR open. A PR still open, no merged PR,
 * or a repository the forge does not answer for fails the leg, naming it; a PR closed unmerged
 * counts as none, as the station function reads it. Returns the merged PRs, `#n` or
 * `owner/name#n`. */
export function verifyPrsMerged(ask: PrOpenAsk, run: PrExec): string[] {
  const id = bareId(ask.ticket);
  const patterns = matchPatterns(ask.branchPatterns).map((p) => p.replace(/\{ticket\}/g, id));
  const slug = originSlug(run, ask.checkout);
  const siblings = (ask.repositories ?? []).filter((r, i, all) => all.indexOf(r) === i && (slug == null || r.toLowerCase() !== slug.toLowerCase()));
  const label = (repo: string | null): string => repo ?? slug ?? 'the checkout’s repository';
  const list = (repo: string | null, state: 'open' | 'merged'): PrListItem[] => {
    const args = ['pr', 'list', '--state', state, '--limit', '300', '--json', 'number,headRefName', ...(repo ? ['--repo', repo] : [])];
    const text = run('gh', args, ask.checkout);
    let prs: unknown;
    try {
      prs = JSON.parse(text);
    } catch {
      prs = null;
    }
    if (!Array.isArray(prs)) throw new Error(`gh pr list --state ${state}${repo ? ` --repo ${repo}` : ''} answered no PR list: ${text.slice(0, 200)}`);
    return prs.filter((p): p is PrListItem => p != null && typeof p === 'object' && typeof (p as PrListItem).headRefName === 'string' && patterns.some((pat) => branchMatches(pat, (p as PrListItem).headRefName as string)));
  };
  const found: MergedRead[] = [null, ...siblings].map((repo) => {
    try {
      return { repo, open: list(repo, 'open'), merged: list(repo, 'merged'), error: null };
    } catch (e) {
      return { repo, open: null, merged: null, error: msg(e) };
    }
  });
  const name = (f: MergedRead, p: PrListItem): string => `${f.repo ? f.repo : ''}#${String(p.number)} (${String(p.headRefName)})`;
  const unread = found.filter((f) => f.error != null);
  if (unread.length > 0) {
    throw new Error(`cannot verify ${id}’s PRs merged — ${unread.map((f) => `${label(f.repo)} (${f.error})`).join('; ')} could not be read: the leg reports merged only when the forge shows every PR merged`);
  }
  const open = found.flatMap((f) => (f.open ?? []).map((p) => name(f, p)));
  if (open.length > 0) {
    throw new Error(`the merge agent exited 0, but ${id}’s PR ${open.join(', ')} is still open — not merged; the leg reports merged only when every PR of the ticket is`);
  }
  const merged = found.flatMap((f) => (f.merged ?? []).map((p) => `${f.repo ? f.repo : ''}#${String(p.number)}`));
  if (merged.length === 0) {
    throw new Error(`the merge agent exited 0, but no merged PR on a branch matching ${patterns.join(' or ')} for ticket ${id} exists in ${found.map((f) => label(f.repo)).join(' or ')} — the leg reports merged only when the forge shows one`);
  }
  return merged;
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
