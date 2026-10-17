// pr-close.ts — the `pr` course's close (BATON_SPEC §6.13, R-BTN-83, R-BTN-74): the closing
// marker from a validated result, written where the `pr` course's convention puts it.
// - `review`: the verdict line, `<!-- baton:verdict approve|changes -->`, as a comment on the
//   checkout branch's PR — the line the station function reads (R-BTN-74), written by `close`
//   from the result the agent returned, not by the agent (R-BTN-83). Its URL is the evidence.
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

/** Write the closing marker and return its evidence: the comment's URL or the commit's sha. */
export async function prClose(ctx: CloseCtx, result: { reached?: string; verdict?: unknown }, run: Exec = exec): Promise<string> {
  if (ctx.leg === 'review') {
    if (result?.verdict !== 'approve' && result?.verdict !== 'changes') {
      throw new Error(`the review returned no verdict (approve or changes), got ${JSON.stringify(result?.verdict)}`);
    }
    const body = `${verdictLine(result.verdict)}\nbaton: ${ctx.ticket.id} review, claim ${ctx.claim?.nonce ?? '?'}`;
    // `gh pr comment` with no number comments on the PR of the checkout's current branch.
    return run('gh', ['pr', 'comment', '--body', body], ctx.checkout);
  }
  const markers = join('.baton', 'markers.jsonl');
  appendFileSync(join(ctx.checkout, markers), `${JSON.stringify({ ticket: ctx.ticket.id, leg: ctx.leg, ...(result?.reached ? { reached: result.reached } : {}), claim: ctx.claim?.nonce ?? null })}\n`);
  run('git', ['add', markers], ctx.checkout);
  run('git', ['commit', '--no-gpg-sign', '-m', `baton:close ${ctx.ticket.id} ${ctx.leg}`], ctx.checkout);
  return run('git', ['rev-parse', 'HEAD'], ctx.checkout);
}
