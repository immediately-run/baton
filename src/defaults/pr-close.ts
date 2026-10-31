// pr-close.ts — the close of the standard courses that read PRs, `create-pr`, `review-pr` and
// `create-spec` (BATON_SPEC §6.13, R-BTN-83, R-BTN-74, R-BTN-131): the closing marker from a
// validated result, written where these courses' convention puts it.
// - `review`: the verdict line, `<!-- baton:verdict approve|changes -->`; `adjudicate`: the
//   adjudication line, `<!-- baton:adjudicated merge|owner -->`; `conclude`: the conclusion line,
//   `<!-- baton:concluded -->` — each as a comment on the PR the agent named after its answer, else
//   on the checkout branch's PR (B-29), the lines the
//   station functions read, written by `close` from the result the agent returned, not by the
//   agent (R-BTN-83). Its URL is the evidence.
// - the marker legs, `create-spec`'s `converse` and `address` — the only PR-course legs whose
//   station function READS a line: one JSON line in `.baton/markers.jsonl`, committed on the
//   default branch itself by `commitMarkerOnDefault` (`course-markers.ts`: git plumbing, fetch,
//   append, `commit-tree`, push — `HEAD` and the working tree untouched, so a checkout left on a
//   PR's branch or detached still writes the default branch the sync reads), and its sha is the
//   evidence. (B-96's review rounds 1 and 2: `converse` and `address` wait on such a line, so a
//   close that left it in an un-pushed checkout left the ticket waiting on a fact no sync saw;
//   and a line committed on `HEAD` landed in a PR, or nowhere.)
// - B-101's review-rounds file protocol (the courses that carry it: `create-pr` and
//   `create-spec`): the round's findings live on the PR's head branch as a file, beside the
//   conversation. The review close commits them — the same markdown the conversation carries,
//   the round number and the verdict line included — to `.baton/reviews/<round>.md` BEFORE the
//   verdict comment is posted (a push after a verdict reads as a fix the course never ran, so
//   the branch moves first and the conversation says the newer thing). The fix (`create-pr`) and
//   address (`create-spec`) closes commit their replies beside the round as
//   `.baton/reviews/<round>-addressed.md`, after reading it from the branch — which is §7.2's
//   "reads the earlier reviews and their replies" as files, and on a plain git repository
//   (R-BTN-92 `forge: git`, no conversation API) the only reviewer↔addresser channel there is.
//   The merge leg's stub clears every reviews file from the branch in one commit as its first
//   act — before the agent that merges, so the squash carries none of it — and the merge close
//   refuses a default branch that still carries the directory.
// - every other leg — `create-pr`'s `implement` — writes nothing: no comment, no marker. Its
//   evidence is the PR itself, which its `verify: 'pr'` checked. A pushed `baton:` commit on a
//   PR branch would move the head past the one the leg verified — a change no course asked for.
// `baton repo init` bundles this into each leg stub, so a stub imports nothing at run time.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bareTicketId, closeTicket, exec, movedOnRemote, PUSH_TRIES, ticketsBranch, tmpIndex, type Exec } from './ticket-state';
import { branchMatches, matchPatterns } from './course-pr';

export type { Exec };

export interface CloseCtx {
  checkout: string;
  ticket: { id: string; path?: string | null; home?: string | null };
  leg: string;
  claim?: { nonce?: string };
  /** The repository's default branch (B-96's review round 2), where a marker leg's line goes:
   *  the claim answer's `default_branch`, which the runner hands the stub in
   *  `BATON_DEFAULT_BRANCH`. Absent — an older runner, a leg run by hand — the close reads
   *  `origin/HEAD`, else `main` (`ticketsBranch`). */
  default_branch?: string | null;
  /** B-101: this course carries the review-rounds file protocol — the review close commits the
   * round to the PR branch, the fix/address close its replies beside it, and the merge close
   * holds the default branch clean of the directory. Set by the stubs of the courses that carry
   * it (`courses.ts` names them); absent, the close behaves as before B-101. */
  review_files?: boolean;
  /** The course's branch patterns (R-BTN-51) as the claim's snapshot carries them — what names
   * the checkout's branch this ticket's PR, so the protocol is written on that branch and no
   * other (B-101). Absent, the default pattern applies (`matchPatterns`). */
  branch_patterns?: string[];
}

/** The directory on a ticket's PR branch where the review-rounds protocol lives (B-101): the
 * conversation between the reviewer and the addresser, carried as files, deleted from the branch
 * in one commit before the squash merge so main never sees it. On a repository with no forge
 * (R-BTN-92 `forge: git`) it is the only channel between them. */
export const REVIEWS_DIR = '.baton/reviews';

/** Where the review agent leaves the round's markdown in the checkout, uncommitted — the same
 * findings it posted to the conversation (B-101). The close commits them to the branch as
 * `<round>.md` and deletes the draft; the stub removes a stale one before the agent runs. */
export const ROUND_DRAFT = `${REVIEWS_DIR}/round.md`;

/** Where the fix (`create-pr`) or address (`create-spec`) agent leaves its replies in the
 * checkout, uncommitted (B-101). The close commits them beside the round as
 * `<round>-addressed.md` and deletes the draft. */
export const ADDRESSED_DRAFT = `${REVIEWS_DIR}/addressed.md`;

/** The review files one ref holds (`git ls-tree -r --name-only <ref> -- .baton/reviews`): one
 * path per line, empty when the ref carries none. */
const reviewFilesAt = (run: Exec, checkout: string, ref: string): string[] =>
  run('git', ['ls-tree', '-r', '--name-only', ref, '--', REVIEWS_DIR], checkout).split('\n').map((l) => l.trim()).filter((l) => l !== '');

/** A reviews path's basename: `.baton/reviews/2.md` → `2.md`. */
const baseName = (path: string): string => (path.startsWith(`${REVIEWS_DIR}/`) ? path.slice(REVIEWS_DIR.length + 1) : path);

/** The round a round file or its replies name (`2.md` → 2, `2-addressed.md` → 2); null for
 * anything else in the directory (B-101). */
const roundOf = (path: string): number | null => {
  const m = /^(\d+)(?:-addressed)?\.md$/.exec(baseName(path));
  return m ? Number(m[1]) : null;
};

/** The next round a branch's reviews directory opens (B-101): one more than the highest round
 * any file there names — a round file and its replies name the same round. */
export const nextRound = (files: string[]): number => 1 + Math.max(0, ...files.map(roundOf).filter((n): n is number => n != null));

/** The latest round a branch's reviews directory carries a round FILE for (`2.md`, not
 * `2-addressed.md`); null when none — an addresser with nothing on the branch to answer. */
export const latestRound = (files: string[]): number | null => {
  let out: number | null = null;
  for (const f of files) {
    const m = /^(\d+)\.md$/.exec(baseName(f));
    if (m) out = Math.max(out ?? 0, Number(m[1]));
  }
  return out;
};

/** What the protocol's git is handed: the checkout, the ticket whose branch is written, and the
 * course's branch patterns (B-101). */
export interface ReviewsCtx {
  checkout: string;
  ticket: { id: string; home?: string | null };
  branch_patterns?: string[];
}

/** The mapped patterns that name this ticket's branches (R-BTN-51, B-101): the snapshot's own
 * patterns, else the default, each with `{ticket}` replaced by the bare id — the same match
 * `ticketOwns` gives a PR. */
const ticketPatterns = (t: { id: string; home?: string | null }, branchPatterns?: string[]): string[] =>
  matchPatterns(branchPatterns).map((p) => p.replace(/\{ticket\}/g, bareTicketId(t)));

/** The checkout's branch when the course's patterns map it to this ticket (B-101): the PR's
 * head branch, where the review-rounds protocol lives. A detached checkout, or one on a branch
 * the patterns do not map to the ticket, is refused naming both — the protocol is written on
 * the PR's branch and no other. */
export function reviewsBranch(ctx: ReviewsCtx, run: Exec = exec): string {
  const branch = run('git', ['branch', '--show-current'], ctx.checkout).trim();
  if (branch === '') throw new Error("the checkout is on no branch (detached HEAD) — the review-rounds protocol is written on the PR's branch");
  const patterns = ticketPatterns(ctx.ticket, ctx.branch_patterns);
  if (!patterns.some((p) => branchMatches(p, branch))) {
    throw new Error(`the checkout's branch ${branch} matches none of ${patterns.join(' or ')} — the review-rounds protocol is written on the ticket's PR branch, so leave the checkout on it`);
  }
  return branch;
}

/** The branch the protocol writes on (B-101): the checkout's own, when the course's patterns
 * map it to the ticket — or null when no branch of the patterns is on origin at all: the
 * ticket's PRs are then in other repositories (or this checkout has no origin), the round file
 * on their branches is the agent's to commit (its instructions say so), and this close writes
 * none here. A branch of the patterns on origin with the checkout elsewhere is refused: the
 * protocol belongs on that branch, and the leg's instructions say to leave the checkout on it.
 * Callers fetch the branch before listing it — the agent's own push may not have moved the
 * remote-tracking ref, and the branch the close writes is the one the PR and its squash read. */
function protocolBranch(ctx: ReviewsCtx, run: Exec = exec): string | null {
  try {
    return reviewsBranch(ctx, run);
  } catch {
    const patterns = ticketPatterns(ctx.ticket, ctx.branch_patterns);
    const elsewhere = run('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], ctx.checkout)
      .split('\n').map((l) => l.trim().replace(/^origin\//, ''))
      .filter((b) => b !== '' && patterns.some((p) => branchMatches(p, b)));
    if (elsewhere.length > 0) {
      throw new Error(`the checkout is on no branch of ${patterns.join(' or ')} (its origin holds ${elsewhere.join(', ')}) — the review-rounds protocol is written on the ticket's PR branch, so leave the checkout on it`);
    }
    return null;
  }
}

/** A change to commit on the PR branch: one file written, or paths removed (B-101). */
interface BranchChange {
  write?: { path: string; text: string };
  remove?: string[];
}

/** Commit `change` on the checkout's branch — `reviewsBranch`'s, the PR's head (B-101) — and
 * push it: git plumbing exactly `closeTicket`'s (a temporary index built from the FETCHED branch
 * head, `commit-tree`, one push, re-read and retried only on a remote that moved), so `HEAD`
 * and the working tree are never touched; the local branch is fast-forwarded to the commit when
 * it still stands where the remote did, so the next leg in this checkout reads the branch whole.
 * Returns the branch and its new commit; null when there was nothing to change. */
export async function commitOnBranch(ctx: ReviewsCtx, change: BranchChange, message: string, run: Exec = exec): Promise<{ branch: string; commit: string } | null> {
  const branch = reviewsBranch(ctx, run);
  const ref = `origin/${branch}`;
  const index = tmpIndex(ctx.checkout, run);
  const git = (args: string[], opts: { env?: Record<string, string>; input?: string } = {}): string => run('git', args, ctx.checkout, opts);
  try {
    for (let tries = 1; ; tries++) {
      // The explicit refspec, not the remote's own fetch setting (closeTicket's rule): a
      // checkout with no `remote.origin.fetch` would never move `origin/<branch>`.
      git(['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/${ref}`]);
      let parent: string;
      try {
        parent = git(['rev-parse', '--verify', `${ref}^{commit}`]);
      } catch {
        throw new Error(`origin holds no branch ${branch} — push the PR's branch before the review-rounds protocol is written on it`);
      }
      rmSync(index, { force: true });
      git(['read-tree', parent], { env: { GIT_INDEX_FILE: index } });
      if (change.write != null) {
        const blob = git(['hash-object', '-w', '--stdin'], { input: change.write.text });
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${change.write.path}`], { env: { GIT_INDEX_FILE: index } });
      }
      for (const path of change.remove ?? []) git(['update-index', '--force-remove', path], { env: { GIT_INDEX_FILE: index } });
      const tree = git(['write-tree'], { env: { GIT_INDEX_FILE: index } });
      if (tree === git(['rev-parse', `${parent}^{tree}`])) return null; // nothing on the branch to change
      const commit = git(['commit-tree', tree, '-p', parent, '-m', message]);
      try {
        git(['push', 'origin', `${commit}:refs/heads/${branch}`]);
        // The local branch joins the push when it still stands where the remote did — never
        // otherwise: a branch that moved keeps its own head, and origin's is what the PR reads.
        try {
          git(['update-ref', `refs/heads/${branch}`, commit, parent]);
        } catch { /* moved or gone: origin's branch is the record */ }
        return { branch, commit };
      } catch (e) {
        if (!movedOnRemote(e) || tries >= PUSH_TRIES) throw e;
      }
    }
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

/** Every `.baton/reviews/` file leaves the ticket's PR branch in one commit (B-101) — the merge
 * leg's first act, before the agent that merges, so the squash it lands carries none of the
 * protocol and main never sees the conversation. The branch is the checkout's own, when the
 * course's patterns map it to the ticket; any other (a ticket whose PRs are all in other
 * repositories, a checkout left on the default branch) clears nothing here — the merge close
 * still holds the default branch clean after. Returns the branch and its clearing commit, or
 * null when there was nothing to clear. */
export async function clearReviewFiles(ctx: ReviewsCtx, run: Exec = exec): Promise<{ branch: string; commit: string } | null> {
  let branch: string;
  try {
    branch = reviewsBranch(ctx, run);
  } catch {
    return null; // not this ticket's branch: nothing here to clear
  }
  // The branch's own head, fetched: the remote's is what the PR and its squash read. A fetch
  // that fails leaves the last-fetched remote-tracking ref standing — the one this checkout's
  // own closes updated — so the listing below still reads it; only a branch origin never held
  // (no ref at all) clears nothing.
  try {
    run('git', ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], ctx.checkout);
  } catch { /* the last-fetched ref stands; the listing decides */ }
  let files: string[];
  try {
    files = reviewFilesAt(run, ctx.checkout, `origin/${branch}`);
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return commitOnBranch(ctx, { remove: files }, `baton:reviews ${bareTicketId(ctx.ticket)} cleared`, run);
}

/** A pull-request URL a leg may name for its line (B-29); the stubs build their check from its
 * source. (`prRefs` reads `prs:` entries more loosely: a `/files` or `#…` tail is still the PR.) */
export const PR_URL = /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+$/;

/** The legs whose close writes a line on a PR — `commentLine`'s — and so may name the PR. */
export const COMMENTING_LEGS: ReadonlySet<string> = new Set(['review', 'adjudicate', 'conclude']);

/** The verdict line a review's comment opens with (R-BTN-74). */
export const verdictLine = (verdict: 'approve' | 'changes'): string => `<!-- baton:verdict ${verdict} -->`;

/** The comment line each commenting leg writes from its result, or a refusal naming what is
 * missing. */
function commentLine(leg: string, result: { verdict?: unknown; adjudication?: unknown }): string | null {
  if (leg === 'review') {
    if (result?.verdict !== 'approve' && result?.verdict !== 'changes') {
      throw new Error(`the review returned no verdict (approve or changes), got ${JSON.stringify(result?.verdict)}`);
    }
    return verdictLine(result.verdict);
  }
  if (leg === 'adjudicate') {
    if (result?.adjudication !== 'merge' && result?.adjudication !== 'owner') {
      throw new Error(`the adjudication returned neither merge nor owner, got ${JSON.stringify(result?.adjudication)}`);
    }
    return `<!-- baton:adjudicated ${result.adjudication} -->`;
  }
  if (leg === 'conclude') return '<!-- baton:concluded -->';
  return null;
}

/** The PR-course legs whose station function reads a marker line (B-96): the interactive legs a
 *  course suspends on. A leg added here must have a station function that reads it back. */
const MARKER_LEGS = new Set(['converse', 'address']);

/** The agent's draft at `path` in the checkout (B-101): the round's markdown, or the replies —
 * whatever the leg's instructions name. A missing or empty draft fails the leg naming the path:
 * the protocol's files are the channel, and the close is what writes them, from the agent's
 * draft alone. */
function draftOf(path: string, checkout: string, leg: string): string {
  let draft = '';
  try {
    draft = readFileSync(join(checkout, path), 'utf8');
  } catch {
    throw new Error(`the ${leg} leg left no ${path} in the checkout — the review-rounds protocol is written from that draft (B-101); the leg's instructions name the path`);
  }
  if (draft.trim() === '') throw new Error(`${path} is empty — the review-rounds protocol is written from that draft (B-101)`);
  return draft;
}

/** Write the closing marker, push it, and return its evidence: the comment's URL, the pushed
 *  commit's sha, or the head it ran on when the leg writes nothing. A comment needs no push — the
 *  forge is the record the sync reads. A ticket write does: the sync reads the ticket's own
 *  git history from the default branch, and a write left in an un-pushed checkout is one no
 *  reading sees (B-96's review round 1) — so it is committed on that branch itself (round 2).
 *
 *  B-101's review-rounds file protocol (`review_files`), where the course carries it, is written
 *  beside all of that on the PR's head branch: the review's round before its comment (a push
 *  after a verdict reads as a fix the course never ran), the fix/address replies beside the
 *  round, and nothing else changes — the comment stays the conversation, the marker the record. */
export async function prClose(ctx: CloseCtx, result: { reached?: string; next?: string | null; verdict?: unknown; adjudication?: unknown; pr?: unknown }, run: Exec = exec): Promise<string> {
  const comment = commentLine(ctx.leg, result);
  // The round on the branch BEFORE the conversation carries the verdict (B-101): pushed first,
  // the verdict's timestamp postdates the protocol's push, and the course's timeline — where a
  // push between verdicts is a fix — reads the round as what it is, the review's own writing.
  if (ctx.review_files === true && ctx.leg === 'review') {
    // `commentLine` validated the verdict; the file's first line is the same machine-written
    // verdict line the comment opens with, never the agent's word for it.
    const verdict = result.verdict as 'approve' | 'changes';
    const branch = protocolBranch(ctx, run);
    if (branch != null) {
      run('git', ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], ctx.checkout);
      const round = nextRound(reviewFilesAt(run, ctx.checkout, `origin/${branch}`));
      const draft = draftOf(ROUND_DRAFT, ctx.checkout, ctx.leg);
      await commitOnBranch(
        { checkout: ctx.checkout, ticket: ctx.ticket, branch_patterns: ctx.branch_patterns },
        { write: { path: `${REVIEWS_DIR}/${round}.md`, text: `${comment}\n\n# Round ${round} — ${verdict}\n\n${draft.trim()}\n` } },
        `baton:review ${bareTicketId(ctx.ticket)} round ${round}`,
        run,
      );
      rmSync(join(ctx.checkout, ROUND_DRAFT), { force: true });
    }
  }
  if (comment != null) {
    const body = `${comment}\nbaton: ${ctx.ticket.id} ${ctx.leg}, claim ${ctx.claim?.nonce ?? '?'}`;
    // On the PR the agent named (B-29: a ticket's PRs may be in other repositories, and its home
    // may have none); else `gh pr comment` with no number, on the checkout branch's PR.
    if (result?.pr != null && !(typeof result.pr === 'string' && PR_URL.test(result.pr))) throw new Error(`the ${ctx.leg} leg named no PR URL to write on, got ${JSON.stringify(result.pr)}`);
    return run('gh', ['pr', 'comment', ...(typeof result?.pr === 'string' ? [result.pr] : []), '--body', body], ctx.checkout);
  }
  if (typeof result?.reached !== 'string' || result.reached === '') throw new Error(`the ${ctx.leg} leg returned no station reached`);
  // The addresser's replies beside the round it answers (B-101): `create-pr`'s fix and
  // `create-spec`'s address. The next round's reviewer reads the rounds and these replies from
  // the branch — the file channel §7.2's "reads the earlier reviews and their replies" names.
  if (ctx.review_files === true && (ctx.leg === 'fix' || ctx.leg === 'address')) {
    const branch = protocolBranch(ctx, run);
    if (branch != null) {
      run('git', ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], ctx.checkout);
      const round = latestRound(reviewFilesAt(run, ctx.checkout, `origin/${branch}`));
      if (round == null) throw new Error(`no review round is on ${REVIEWS_DIR}/ of branch ${branch} to answer — the review close writes the round before its verdict is posted (B-101)`);
      const draft = draftOf(ADDRESSED_DRAFT, ctx.checkout, ctx.leg);
      const wrote = await commitOnBranch(
        { checkout: ctx.checkout, ticket: ctx.ticket, branch_patterns: ctx.branch_patterns },
        { write: { path: `${REVIEWS_DIR}/${round}-addressed.md`, text: `# Round ${round} — addressed\n\n${draft.trim()}\n` } },
        `baton:address ${bareTicketId(ctx.ticket)} round ${round}`,
        run,
      );
      rmSync(join(ctx.checkout, ADDRESSED_DRAFT), { force: true });
      // `fix` writes nothing else: its evidence is the replies' pushed commit. `address` goes
      // on to its marker — the ticket's own record, which the sync reads for the owner's wait.
      if (ctx.leg === 'fix' && wrote != null) return wrote.commit;
    }
  }
  // Only the legs whose station function READS a marker (B-96): create-spec's interactive
  // converse and address. Every other PR-course leg (implement, fix, merge) writes no marker —
  // a pushed `baton:` commit on each PR branch would move the head past the one `verify: 'pr'`
  // checked, a change no course asked for.
  if (!MARKER_LEGS.has(ctx.leg)) {
    // B-101: the merge's clearing ran before the agent (the merge stub's first act, so the
    // squash it lands carries none of the protocol); this holds the line after — a default
    // branch that carries the directory was squashed dirty, and the leg says so rather than
    // closing clean over it.
    if (ctx.review_files === true && ctx.leg === 'merge') {
      const branch = ticketsBranch(ctx.checkout, ctx.default_branch ?? null, run);
      run('git', ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], ctx.checkout);
      let carries = true;
      try {
        run('git', ['cat-file', '-e', `origin/${branch}:${REVIEWS_DIR}`], ctx.checkout);
      } catch {
        carries = false;
      }
      if (carries) throw new Error(`the default branch still carries ${REVIEWS_DIR}/ after the merge — the squash landed the review protocol on it (B-101); remove the directory in a commit on the default branch and note it on the ticket`);
    }
    return run('git', ['rev-parse', 'HEAD'], ctx.checkout);
  }
  // Only the legs whose station function READS the ticket's own record (B-96, B-100):
  // create-spec's interactive converse and address. Every other PR-course leg (implement, fix,
  // merge) writes no state — a pushed `baton:` commit on each PR branch would move the head past
  // the one `verify: 'pr'` checked, a change no course asked for.
  // The ticket's own frontmatter is the record (B-100): the close writes the leg's machine
  // state into the ticket file — on the default branch itself, never on the checkout's `HEAD`,
  // which may sit on a PR's branch or be detached — with the boundary check, and its sha is the
  // evidence. No heading check here (round 1, finding 3): these legs' work is the conversation
  // and its PR, which may never land on the default branch (an owner who stops before the PR is
  // open still leaves the record); the marker courses' legs, whose work IS the ticket, keep it.
  return closeTicket({ ...ctx, heading: false }, result, run);
}
