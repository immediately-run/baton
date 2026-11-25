// R-BTN-82 / S-BTN-48: the same bounded record goes in a close and comes back in sync.
import { checkOutputs, LOCAL_ID } from '../core/validate';
import type { PostedAttestation } from '../core/board';

const PREFIX = 'Baton-Output: ';
const MAX = 256 * 1024;

/** A forge comment vouches for the immutable commit it is attached to, not arbitrary Git authorship. */
export const TICKET_OUTPUT_WITNESS = 'baton: ticket close outputs';

export function syncAttestationBatch(confirmation: PostedAttestation[], outputs: PostedAttestation[], observation: number): PostedAttestation[] {
  const limit = 100;
  if (confirmation.length + outputs.length <= limit) return [...confirmation, ...outputs];
  // Both streams get room. Consecutive observations page through the same evidence instead of
  // taking its first page forever; a later sweep can revisit a marker seen while its claim lived.
  const capacity = Math.min(confirmation.length, limit - Math.min(outputs.length, limit / 2));
  const page = (items: PostedAttestation[], size: number) => {
    if (size === 0 || items.length <= size) return items.slice(0, size);
    const start = ((observation - 1) % Math.ceil(items.length / size)) * size;
    return items.slice(start, start + size);
  };
  return [...page(confirmation, capacity), ...page(outputs, limit - capacity)];
}

interface OutputContext {
  ticket: { id: string; home?: string | null };
  leg: string;
  run_id?: string;
  claim?: { nonce?: string };
}

export function outputLine(ctx: OutputContext, raw: unknown): string | null {
  const outputs = checkOutputs(raw);
  if (!outputs.length) return null;
  if (!ctx.run_id || !ctx.claim?.nonce) throw new Error('output evidence requires an online run and claim nonce');
  const ticket = ctx.ticket.id.split(':').at(-1);
  return PREFIX + encodeURIComponent(JSON.stringify({ ticket, leg: ctx.leg, run_id: ctx.run_id, claim_nonce: ctx.claim.nonce, outputs }));
}

/** Call only on default-branch commits of a plain-git home or pusher-verified forge text. */
export function outputAttestation(body: string, ref: string): PostedAttestation | null {
  const lines = body.split('\n').filter((line) => line.startsWith(PREFIX));
  if (lines.length !== 1 || lines[0].length > MAX) return null;
  try {
    const { ticket, leg, run_id, claim_nonce, outputs: raw } = JSON.parse(decodeURIComponent(lines[0].slice(PREFIX.length)));
    if (typeof ticket !== 'string' || !LOCAL_ID.test(ticket) || typeof leg !== 'string'
      || typeof run_id !== 'string' || typeof claim_nonce !== 'string') return null;
    const outputs = checkOutputs(raw);
    return outputs.length ? { type: 'std:git.output@1', ticket, ref, value: { leg, run_id, claim_nonce, outputs } } : null;
  } catch {
    return null;
  }
}
