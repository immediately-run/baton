// TicketControls.tsx — the ticket page's controls (B-222 item 2): the registry entries `ui.view`
// places on `repository/tickets/{ticket}`, drawn through B-207's `Controls` and nothing else —
// no route is named here, no role is asked, and no permission is decided. What this file does
// decide is which TARGET each entry is drawn against, from the ticket's own read:
//   - the ticket itself (hold, expedite, and whatever a later entry adds), with the live claim
//     and its runner where there is one (Stop, force-reap), and the one open condition where
//     exactly one is open (an inline resolve, where the registry places one here);
//   - `ticket.unhold` only where the read's `allowed` names it (R-BTN-186);
//   - the completion's confirm and release against the unconfirmed claim, the fence clear
//     against the fenced one — each only while the read names that claim;
//   - the acknowledgement once per open scope finding (`AcknowledgeFinding`).
// A destructive entry opens the confirm dialog, a `202` the code dialog, a refusal is drawn
// beside its control: all `Controls`'. Route and adopt are CLI lines on the page (Decision 2a).
import { Controls } from '../../app/controls/Controls';
import { useShell } from '../../app/shell';
import type { TicketShow } from './types';

export const TICKET_VIEW = 'repository/tickets/{ticket}';

/** Entries drawn against a claim other than the live one, or once per finding: each has a row
 *  of its own below, so the ticket's row leaves them out. */
const COMPLETION = ['claim.confirm', 'claim.release'];
const FENCE = ['claim.fence-clear'];
const FINDING = ['scope.resolve'];
/** Entries that act on the live claim's runner through a message: without a live claim there
 *  is no runner to send to, and the form would ask for one. */
const NEEDS_CLAIM = ['leg.stop'];

/** The ids `Controls` may draw in the ticket's own row: every entry the session holds for the
 *  view, less the ones with a row of their own, less `ticket.unhold` unless the read allows
 *  it, less the claim's while no claim is live. Pure, so a test reads it without React. */
export function ticketRowIds(viewIds: readonly string[], ticket: Pick<TicketShow, 'allowed' | 'claim'>): string[] {
  const allowed = Array.isArray(ticket.allowed) ? ticket.allowed : [];
  return viewIds.filter((id) =>
    !COMPLETION.includes(id) && !FENCE.includes(id) && !FINDING.includes(id)
    && (id !== 'ticket.unhold' || allowed.includes(id))
    && (ticket.claim != null || !NEEDS_CLAIM.includes(id)));
}

export function TicketControls({ ticket, repository }: { ticket: TicketShow; repository: string }) {
  const { actions } = useShell();
  const viewIds = actions.filter((a) => a.ui?.view?.includes(TICKET_VIEW)).map((a) => a.id);
  const id = ticket.ticket_id;
  const claim = ticket.claim;
  const open = Array.isArray(ticket.conditions) ? ticket.conditions : [];
  const target: Record<string, unknown> = {
    repository, ticket: id, ticket_id: id,
    ...(claim ? { claim: claim.claim_id, claim_id: claim.claim_id, to_runner_id: claim.runner_id, reason: 'requested' } : {}),
    // Set only when exactly one condition is open: an inline resolve has one thing to resolve.
    ...(open.length === 1 ? { condition: open[0].condition_id, condition_id: open[0].condition_id } : {}),
  };
  const unconfirmed = ticket.state === 'unconfirmed' && typeof ticket.detail?.claim_id === 'number' ? ticket.detail.claim_id : null;
  const fenced = ticket.fence?.claim_id ?? null;
  return (
    <div className="tp-controls">
      <Controls view={TICKET_VIEW} target={target} allowed={ticketRowIds(viewIds, ticket)} label="Ticket actions" />
      {unconfirmed !== null ? <Controls view={TICKET_VIEW} target={{ repository, ticket_id: id, claim: unconfirmed, claim_id: unconfirmed }} allowed={COMPLETION} label="The unconfirmed completion" /> : null}
      {fenced !== null ? <Controls view={TICKET_VIEW} target={{ repository, ticket_id: id, claim: fenced, claim_id: fenced }} allowed={FENCE} label="The pending fence" /> : null}
    </div>
  );
}

/** One open scope finding's acknowledgement: `scope.resolve`, one click (§12.9). */
export function AcknowledgeFinding({ finding, repository, ticket }: { finding: number; repository: string; ticket: string }) {
  return <Controls view={TICKET_VIEW} target={{ repository, ticket_id: ticket, finding }} allowed={FINDING} label={`Scope finding ${finding}`} />;
}
