// pr-close.ts — the close of the standard courses that read PRs, `create-pr` and `review-pr`
// (BATON_SPEC §6.13, R-BTN-83, R-BTN-74, R-BTN-131): the closing marker from a validated result,
// written where these courses' convention puts it.
// - `review`: the verdict line, `<!-- baton:verdict approve|changes -->`; `adjudicate`: the
//   adjudication line, `<!-- baton:adjudicated merge|owner -->`; `conclude`: the conclusion line,
//   `<!-- baton:concluded -->` — each as a comment on the PR the agent named after its answer, else
//   on the checkout branch's PR (B-29), the lines the
//   station functions read, written by `close` from the result the agent returned, not by the
//   agent (R-BTN-83). Its URL is the evidence.
// - every other leg: a JSON line in `.baton/markers.jsonl`, committed (`commitMarker`, shared
//   with the marker courses); its sha is the evidence.
// `baton repo init` bundles this into each leg stub, so a stub imports nothing at run time.
import { bareTicketId, commitMarker, exec } from './course-markers';

/** What `close` runs: `git` or `gh`, in the checkout, answering stdout. Tests inject it. */
export type Exec = (cmd: 'git' | 'gh', args: string[], cwd: string) => string;

export interface CloseCtx {
  checkout: string;
  ticket: { id: string; path?: string | null; home?: string | null };
  leg: string;
  claim?: { nonce?: string };
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

/** Write the closing marker and return its evidence: the comment's URL or the commit's sha. */
export async function prClose(ctx: CloseCtx, result: { reached?: string; next?: string | null; verdict?: unknown; adjudication?: unknown; pr?: unknown }, run: Exec = exec): Promise<string> {
  const line = commentLine(ctx.leg, result);
  if (line != null) {
    const body = `${line}\nbaton: ${ctx.ticket.id} ${ctx.leg}, claim ${ctx.claim?.nonce ?? '?'}`;
    // On the PR the agent named (B-29: a ticket's PRs may be in other repositories, and its home
    // may have none); else `gh pr comment` with no number, on the checkout branch's PR.
    if (result?.pr != null && !(typeof result.pr === 'string' && PR_URL.test(result.pr))) throw new Error(`the ${ctx.leg} leg named no PR URL to write on, got ${JSON.stringify(result.pr)}`);
    return run('gh', ['pr', 'comment', ...(typeof result?.pr === 'string' ? [result.pr] : []), '--body', body], ctx.checkout);
  }
  if (typeof result?.reached !== 'string' || result.reached === '') throw new Error(`the ${ctx.leg} leg returned no station reached`);
  commitMarker(ctx.checkout, { ticket: bareTicketId(ctx.ticket), leg: ctx.leg, reached: result.reached, next: result.next ?? null, claim: ctx.claim?.nonce ?? null }, run);
  return run('git', ['rev-parse', 'HEAD'], ctx.checkout);
}
