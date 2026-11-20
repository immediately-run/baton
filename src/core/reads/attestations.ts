// reads/attestations.ts — `attestation.list` (BATON_SPEC §12.8 R-BTN-181, R-BTN-185; §6.4
// R-BTN-116; B-213): a repository's typed statements with their writers, and the types this
// caller may write.
//
// R-BTN-181's attestation store is not built (B-146). The one attestation Baton reads and
// applies today is a person leg's answer, a `std:decision@1` (questions.ts), and what it keeps
// of each applied one is its `question-answered` event: the ticket, the leg, the option and
// who answered — the sync reading git, an owner key, or a human-only key. This read serves
// exactly those, newest first, in R-BTN-181's row shape as far as the record goes: no
// attestation of another type, none that lapses and none revoked exists to list, and
// `not_built` says so. Nothing is invented.
//
// `writable_types` is the types the caller may write through `POST …/attestations` — the rule
// that route judges by (`answerWord`): `std:decision@1` for an owner key of the repository
// where the policy admits one, nothing for anyone else. No dashboard session writes one: an
// administrator's is no owner (R-BTN-57), and an owner's session is B-76's.
import { BatonError } from '../http';
import { DECISION_TYPE_NAME, TICKET_ID } from '../validate';
import { answerWord } from './conditions';
import { cursorOf, pageOf, queryOf, type ReadRoute } from './kit';

/** R-BTN-181's writer classes, as far as a stored answer names one. */
function writerOf(by: string): { credential: string | null; class: string } {
  const i = by.indexOf(':');
  if (i < 0) return { credential: null, class: by };
  return { credential: by.slice(i + 1), class: by.slice(0, i) };
}

export const ATTESTATION_READS: ReadRoute[] = [
  {
    action: 'attestation.list',
    run(cx, call) {
      const q = queryOf(call);
      const repository = call.repository!;
      if (q.live !== undefined && q.live !== '1') throw new BatonError('invalid-params', 'live: 1, or nothing');
      const word = answerWord(cx, call.principal, repository);
      const tail = {
        writable_types: word.answerable ? [DECISION_TYPE_NAME] : [],
        writable_why: word.why,
        types: [DECISION_TYPE_NAME],
        not_built: { store: 'B-146', session_write: 'B-76', revoke: 'B-146' },
      };
      // One type is held: any other names nothing to list.
      if (q.type !== undefined && q.type !== DECISION_TYPE_NAME) {
        if (!/^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*@[0-9]+$/.test(q.type)) throw new BatonError('invalid-params', 'type: a schema id, <library>:<name>@<version>');
        return { attestations: [], ...tail };
      }
      let subject: string | null = null;
      if (q.subject !== undefined) {
        subject = q.subject.includes(':') ? q.subject : `${repository}:${q.subject}`;
        if (!TICKET_ID.test(subject)) throw new BatonError('invalid-params', 'subject: a ticket id');
        // Another repository's ticket holds nothing here.
        if (!subject.startsWith(`${repository}:`)) return { attestations: [], ...tail };
      }
      const after = cursorOf<[number, number]>(cx, call);
      if (after !== null && !(Array.isArray(after) && after.length === 2 && after.every((n) => Number.isSafeInteger(n)))) throw new BatonError('invalid-params', 'cursor: the previous page’s');
      const where = [`kind = 'question-answered'`, 'repository_id = ?'];
      const params: unknown[] = [repository];
      if (subject !== null) {
        where.push('ticket_id = ?');
        params.push(subject);
      }
      if (after !== null) {
        where.push('(at < ? OR (at = ? AND seq < ?))');
        params.push(after[0], after[0], after[1]);
      }
      const limit = 100;
      const rows = cx.sql<{ seq: number; at: number; ticket_id: string; actor: string; detail_json: string | null }>(
        `SELECT seq, at, ticket_id, actor, detail_json FROM events WHERE ${where.join(' AND ')} ORDER BY at DESC, seq DESC LIMIT ?`, ...params, limit + 1);
      const p = pageOf(cx, call, rows, (last) => [last.at, last.seq], limit);
      return {
        attestations: p.items.map((e) => {
          let d: Record<string, unknown> = {};
          try {
            d = JSON.parse(e.detail_json ?? '{}') as Record<string, unknown>;
          } catch { /* stored by the core: never malformed */ }
          return {
            id: e.seq,
            type: DECISION_TYPE_NAME,
            subject: { ticket: e.ticket_id },
            value: { leg: d.leg ?? null, option: d.option ?? null },
            writer: writerOf(typeof d.answered_by === 'string' ? d.answered_by : e.actor),
            domain: null,
            at: e.at,
            lapses_at: null,
            revoked_at: null,
          };
        }),
        ...(p.next_cursor ? { next_cursor: p.next_cursor } : {}),
        ...tail,
      };
    },
  },
];
