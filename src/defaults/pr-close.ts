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
// - every other leg — `create-pr`'s `implement`, `fix` and `merge` — writes nothing: no comment,
//   no marker. Its evidence is the PR itself, which its `verify: 'pr'` checked, or nothing at all
//   (a merge is read from the forge's own PR state). A pushed `baton:` commit on a PR branch, or
//   an unpushed one carried by the next push, would move the head past the one the leg verified —
//   a change no course asked for.
// `baton repo init` bundles this into each leg stub, so a stub imports nothing at run time.
import { closeTicket, exec } from './ticket-state';

/** What `close` runs: `git` or `gh`, in the checkout, answering stdout. Tests inject it. */
export type Exec = (cmd: 'git' | 'gh', args: string[], cwd: string) => string;

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

/** Write the closing marker, push it, and return its evidence: the comment's URL, the pushed
 *  commit's sha, or the head it ran on when the leg writes nothing. A comment needs no push — the
 *  forge is the record the sync reads. A ticket write does: the sync reads the ticket's own
 *  git history from the default branch, and a write left in an un-pushed checkout is one no
 *  reading sees (B-96's review round 1) — so it is committed on that branch itself (round 2). */
export async function prClose(ctx: CloseCtx, result: { reached?: string; next?: string | null; verdict?: unknown; adjudication?: unknown; pr?: unknown }, run: Exec = exec): Promise<string> {
  const comment = commentLine(ctx.leg, result);
  if (comment != null) {
    const body = `${comment}\nbaton: ${ctx.ticket.id} ${ctx.leg}, claim ${ctx.claim?.nonce ?? '?'}`;
    // On the PR the agent named (B-29: a ticket's PRs may be in other repositories, and its home
    // may have none); else `gh pr comment` with no number, on the checkout branch's PR.
    if (result?.pr != null && !(typeof result.pr === 'string' && PR_URL.test(result.pr))) throw new Error(`the ${ctx.leg} leg named no PR URL to write on, got ${JSON.stringify(result.pr)}`);
    return run('gh', ['pr', 'comment', ...(typeof result?.pr === 'string' ? [result.pr] : []), '--body', body], ctx.checkout);
  }
  if (typeof result?.reached !== 'string' || result.reached === '') throw new Error(`the ${ctx.leg} leg returned no station reached`);
  // Only the legs whose station function READS a marker (B-96): create-spec's interactive
  // converse and address. Every other PR-course leg (implement, fix, merge) writes no marker —
  // a pushed `baton:` commit on each PR branch would move the head past the one `verify: 'pr'`
  // checked, a change no course asked for.
  if (!MARKER_LEGS.has(ctx.leg)) return run('git', ['rev-parse', 'HEAD'], ctx.checkout);
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
