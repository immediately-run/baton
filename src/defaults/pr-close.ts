// pr-close.ts — the close of the standard courses that read PRs, `create-pr` and `review-pr`
// (BATON_SPEC §6.13, R-BTN-83, R-BTN-74, R-BTN-131): the closing marker from a validated result,
// written where these courses' convention puts it.
// - `review`: the verdict line, `<!-- baton:verdict approve|changes -->`; `adjudicate`: the
//   adjudication line, `<!-- baton:adjudicated merge|owner -->`; `conclude`: the conclusion line,
//   `<!-- baton:concluded -->` — each as a comment on the checkout branch's PR, the lines the
//   station functions read, written by `close` from the result the agent returned, not by the
//   agent (R-BTN-83). Its URL is the evidence.
// - every other leg: a JSON line in `.baton/markers.jsonl`, committed; its sha is the evidence.
// `baton repo init` bundles this into each leg stub, so a stub imports nothing at run time.
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** What `close` runs: `git` or `gh`, in the checkout, answering stdout. Tests inject it. */
export type Exec = (cmd: 'git' | 'gh', args: string[], cwd: string) => string;
const exec: Exec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

export interface CloseCtx {
  checkout: string;
  ticket: { id: string; path?: string | null };
  leg: string;
  claim?: { nonce?: string };
}

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
export async function prClose(ctx: CloseCtx, result: { reached?: string; verdict?: unknown; adjudication?: unknown }, run: Exec = exec): Promise<string> {
  const line = commentLine(ctx.leg, result);
  if (line != null) {
    const body = `${line}\nbaton: ${ctx.ticket.id} ${ctx.leg}, claim ${ctx.claim?.nonce ?? '?'}`;
    // `gh pr comment` with no number comments on the PR of the checkout's current branch.
    return run('gh', ['pr', 'comment', '--body', body], ctx.checkout);
  }
  const markers = join('.baton', 'markers.jsonl');
  appendFileSync(join(ctx.checkout, markers), `${JSON.stringify({ ticket: ctx.ticket.id, leg: ctx.leg, ...(result?.reached ? { reached: result.reached } : {}), claim: ctx.claim?.nonce ?? null })}\n`);
  run('git', ['add', markers], ctx.checkout);
  run('git', ['commit', '--no-gpg-sign', '-m', `baton:close ${ctx.ticket.id} ${ctx.leg}`], ctx.checkout);
  return run('git', ['rev-parse', 'HEAD'], ctx.checkout);
}
