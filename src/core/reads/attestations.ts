// reads/attestations.ts — `attestation.list` (BATON_SPEC §12.8 R-BTN-181, R-BTN-185; §6.4
// R-BTN-116; B-213): a repository's typed statements with their writers, and the types this
// caller may write.
//
// The general attestation store is not built (B-146). This read projects the statements
// Baton actually keeps: person answers, applied forge arrivals, and outside-work evidence.
//
// `writable_types` is the types the caller may write through `POST …/attestations` — the rule
// that route judges by (`answerWord`): `std:decision@1` for an owner key of the repository
// where the policy admits one, nothing for anyone else. No dashboard session writes one: an
// administrator's is no owner (R-BTN-57), and an owner's session is B-76's.
import { ARRIVAL_TYPE, EVIDENCE_TYPE } from '../outsideWork';
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
        types: [DECISION_TYPE_NAME, ARRIVAL_TYPE, EVIDENCE_TYPE],
        not_built: { store: 'B-146', session_write: 'B-76', revoke: 'B-146' },
      };
      // One type is held: any other names nothing to list.
      if (q.type !== undefined && !tail.types.includes(q.type)) {
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
      const where: string[] = ['1 = 1'];
      const params: unknown[] = [repository, repository, repository];
      if (q.type !== undefined) { where.push('type = ?'); params.push(q.type); }
      if (subject !== null) {
        where.push('ticket_id = ?');
        params.push(subject);
      }
      if (after !== null) {
        where.push('(at < ? OR (at = ? AND seq < ?))');
        params.push(after[0], after[0], after[1]);
      }
      const limit = 100;
      const rows = cx.sql<{ seq: number; at: number; ticket_id: string; actor: string; detail_json: string | null; type: string }>(
        `SELECT * FROM (
          SELECT seq * 3 AS seq, at, ticket_id, actor, detail_json, '${DECISION_TYPE_NAME}' AS type
            FROM events WHERE repository_id = ? AND kind = 'question-answered'
          UNION ALL
          SELECT h.id * 3 + 1, h.at, h.ticket_id, 'sync',
            json_object('ref', json_extract(h.detail_json, '$.ref'), 'leg', h.leg, 'reached', h.reached, 'next', h.next_leg), '${ARRIVAL_TYPE}'
            FROM tickets t JOIN ticket_history h ON h.ticket_id = t.id
            WHERE t.repository_id = ? AND h.kind = 'fact-arrival' AND json_extract(h.detail_json, '$.outside') = 1
          UNION ALL
          SELECT e.insertion_order * 3 + 2, e.found_at, e.ticket_id, 'sync', json_object('ref', e.ref, 'kind', e.kind, 'leg', e.leg), '${EVIDENCE_TYPE}'
            FROM tickets t JOIN ticket_evidence e ON e.ticket_id = t.id WHERE t.repository_id = ?
        ) WHERE ${where.join(' AND ')} ORDER BY at DESC, seq DESC LIMIT ?`, ...params, limit + 1);
      const p = pageOf(cx, call, rows, (last) => [last.at, last.seq], limit);
      return {
        attestations: p.items.map((e) => {
          let d: Record<string, unknown> = {};
          try {
            d = JSON.parse(e.detail_json ?? '{}') as Record<string, unknown>;
          } catch { /* stored by the core: never malformed */ }
          return {
            id: e.seq,
            type: e.type,
            subject: { ticket: e.ticket_id },
            value: e.type === DECISION_TYPE_NAME ? { leg: d.leg ?? null, option: d.option ?? null } : d,
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
