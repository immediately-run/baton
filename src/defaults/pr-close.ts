// pr-close.ts — the `pr` course's close (BATON_SPEC §6.13, R-BTN-83): the closing marker from
// a validated result, written where the `pr` course's convention puts it — a JSON line per leg
// run in `.baton/markers.jsonl`, committed, its sha the evidence. The leg stubs `baton init`
// writes import this; the `review` stub's verdict is a comment line on the PR, which the
// repository's agent posts and the sync's verdict marker reads.
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Write the closing marker and return its commit's sha (git before the report, R-BTN-83). */
export async function prClose(ctx: { checkout: string; ticket: { id: string; path: string | null }; leg: string; claim: { nonce: string } }, result: { reached?: string }): Promise<string> {
  const git = (...a: string[]) => execFileSync('git', ['-C', ctx.checkout, ...a], { encoding: 'utf8' }).trim();
  const markers = join('.baton', 'markers.jsonl');
  appendFileSync(join(ctx.checkout, markers), `${JSON.stringify({ ticket: ctx.ticket.id, leg: ctx.leg, ...(result?.reached ? { reached: result.reached } : {}), claim: ctx.claim?.nonce })}\n`);
  git('add', markers);
  git('commit', '--allow-empty', '--no-gpg-sign', '-m', `baton:close ${ctx.ticket.id} ${ctx.leg}`);
  return git('rev-parse', 'HEAD');
}
