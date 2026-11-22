// B-258 (S-BTN-232): the claim supplies the applied answer and prior ends, not the ticket file.
import type { CloseCtx } from './pr-close';
import { archiveTicket } from './tickets-transaction';
import { bareTicketId, ticketsBranch } from './ticket-state';

interface ArchiveCtx extends CloseCtx {
  claim?: CloseCtx['claim'] & { station?: string };
  person_answer?: { leg: string; option: string; answered_at: number; answered_by: string };
  previous_attempts?: {
    end_reason: string | null;
    ended_at: number | null;
    ended_at_sha?: string;
    detail: string | null;
    legs: { leg: string; reached: string | null; outcome: string }[];
  }[];
}

export function archiveClose(ctx: ArchiveCtx, result: { reached?: string }): string {
  const answer = ctx.person_answer;
  if (ctx.leg !== 'archive' || ctx.claim?.station !== 'confirmed' || result?.reached !== 'archived' ||
      answer?.leg !== 'confirm' || answer.option !== 'confirmed' || !/^(owner|human):/.test(answer.answered_by)) {
    throw new Error("archive requires the owner's applied confirmed answer");
  }
  // An archive retry can follow a failed archive attempt. Use the latest completed delivery,
  // not simply the most recent claim. A filed answer followed by a new delivery uses the new end.
  const end = ctx.previous_attempts?.find((p) => p.end_reason === 'suspended:delivered' &&
    p.legs.some((l) => l.reached === 'delivered' && l.outcome === 'finished'));
  const first = end?.ended_at_sha;
  const commits = /^delivered at ([0-9a-f]{10}(?:, [0-9a-f]{10})*)(?:: |$)/.exec(end?.detail ?? '')?.[1]?.split(', ');
  if (!end || end.ended_at == null || end.ended_at > answer.answered_at || !first || !/^[0-9a-f]{40}$/.test(first) || commits?.[0] !== first.slice(0, 10)) {
    throw new Error("archive requires the confirmed delivery's end evidence");
  }
  if (!ctx.ticket.path) throw new Error('archive requires a ticket file in git');
  const branch = ticketsBranch(ctx.checkout, ctx.default_branch);
  return archiveTicket(ctx.checkout, { branch }, bareTicketId(ctx.ticket), {
    delivered: { path: ctx.ticket.path, shas: [first, ...commits.slice(1)] },
  });
}
