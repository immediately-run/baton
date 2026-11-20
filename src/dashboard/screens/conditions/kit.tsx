// kit.tsx — what the Conditions, Attestations and Sync screens share: a ticket id as a link to
// its page, the plain name and mark of a condition's kind, a person leg's options with the one
// CLI line that answers it, and a condition's restarts. Presentation only — no read and no
// call is made here, and every value drawn is a read's text (§12.3).
import type { ReactNode } from 'react';
import { Link, pathOrNull } from '../../app/router';
import { ExtLink } from '../../lib/links';
import { Text, textOf } from '../../lib/Text';
import { Badge, CliLine, type Tone } from '../../lib/ui';
import type { Condition, Question } from './types';
import './conditions.css';

/** A qualified ticket id's two halves; a bare id is its own local id. */
export function splitTicket(id: string, repository: string): { repository: string; local: string } {
  const at = id.indexOf(':');
  return at > 0 ? { repository: id.slice(0, at), local: id.slice(at + 1) } : { repository, local: id };
}

/** A ticket id from a read: a link to its page when it is id-shaped, else its text. */
export function TicketLink({ id, repository, children }: { id: unknown; repository: string; children?: ReactNode }) {
  if (typeof id !== 'string' || id === '') return <span className="mut">—</span>;
  const t = splitTicket(id, repository);
  const to = pathOrNull('repository/tickets/{ticket}', { repository: t.repository, ticket: t.local });
  const label = children ?? <Text mono value={id} />;
  return to ? <Link to={to}>{label}</Link> : <>{label}</>;
}

export interface Kind {
  /** Baton's plain name for the kind. Null for a course's own type: its name is the data. */
  name: string | null;
  glyph: string;
  tone: Tone;
}

/** Core's condition types, each with the plain name it is drawn under — a name is tied to the
 *  type that renders it, so none is drawn that the read cannot return (B-219). The dots form
 *  the hierarchy (R-BTN-160): `hitl.x` is a `hitl`. */
const CORE_KINDS: [type: string, kind: Kind][] = [
  ['interact', { name: 'Interaction request', glyph: '◆', tone: 'run' }],
  ['hitl', { name: 'Waiting on a person', glyph: '▲', tone: 'warn' }],
  ['baton.retries', { name: 'Retries exhausted', glyph: '■', tone: 'bad' }],
  ['baton.contract', { name: 'Contract refused', glyph: '■', tone: 'bad' }],
  ['baton.stalled', { name: 'Stalled', glyph: '▲', tone: 'warn' }],
  ['error', { name: 'Error', glyph: '■', tone: 'bad' }],
  ['warning', { name: 'Warning', glyph: '▲', tone: 'warn' }],
];

/** The kind a condition is drawn under: core's by its type, a course's own by its disposition's
 *  mark and no name of Baton's. */
export function kindOf(c: Pick<Condition, 'type' | 'disposition'>): Kind {
  const type = textOf(c.type);
  for (const [t, kind] of CORE_KINDS) if (type === t || type.startsWith(`${t}.`)) return kind;
  return c.disposition === 'suspend' ? { name: null, glyph: '▲', tone: 'warn' } : { name: null, glyph: '○', tone: 'mut' };
}

/** A queued person leg's kind. */
export const QUESTION_KIND: Kind = { name: 'Question', glyph: '?', tone: 'warn' };

/** The kind column of a row: the mark and the name, never colour alone. A course's own type is
 *  drawn as its name, in the monospace face. */
export function KindMark({ kind, type }: { kind: Kind; type?: unknown }) {
  return (
    <span className={`needs-kind tone-${kind.tone}`}>
      <span className="needs-glyph" aria-hidden="true">{kind.glyph}</span>
      <span>{kind.name ?? <Text mono value={type} />}</span>
    </span>
  );
}

/** A severity above the ordinary, as a mark; nothing for `normal`. */
export function Severity({ value }: { value: unknown }) {
  if (value !== 'critical' && value !== 'high') return null;
  return <Badge tone={value === 'critical' ? 'bad' : 'warn'}><Text value={value} /></Badge>;
}

/** The restarts a condition offers — the id, what it does, the default marked — as text. A
 *  restart is a button only through the registry (`Controls`), where the read allows one. */
export function Restarts({ condition }: { condition: Pick<Condition, 'restarts' | 'default'> }) {
  const entries = Object.entries(condition.restarts ?? {});
  if (entries.length === 0) return null;
  return (
    <ul className="needs-restarts" aria-label="Restarts">
      {entries.map(([id, description]) => (
        <li key={id}>
          <Text mono value={id} />
          {id === condition.default ? <span className="mut"> (default)</span> : null}
          {textOf(description) !== '' ? <> — <Text value={description} /></> : null}
        </li>
      ))}
    </ul>
  );
}

/** A person leg's options. No session answers one (R-BTN-57; an owner's session is B-76), so
 *  each option is drawn with what it does and the CLI line that chooses it — run where an owner
 *  key or a human-only key is. Where the read says this caller may answer, the line is the
 *  caller's own to run; where it does not, the reason is drawn. */
export function Options({ question }: { question: Question }) {
  const options = Array.isArray(question.options) ? question.options : [];
  return (
    <div className="needs-answer">
      <ul className="needs-options" aria-label="Options">
        {options.map((o) => (
          <li key={textOf(o.id)}>
            <span className="needs-option"><Text mono value={o.id} />{o.action ? <> — <Text value={o.action} /></> : null}</span>
            <CliLine>baton decision answer -i KEY <Text value={question.ticket_id} /> <Text value={o.id} /></CliLine>
          </li>
        ))}
      </ul>
      <p className="mut needs-why">
        {question.answerable
          ? 'Your key may answer: run the line where the key is.'
          : <>This page cannot answer it{question.why ? <> — <Text value={question.why} /></> : null}. </>}
        {question.answerable ? null : question.human_only
          ? 'KEY is a human-only key: this repository’s policy counts a person’s answer from one alone.'
          : 'KEY is an owner key of this repository, or a human-only key.'}
      </p>
    </div>
  );
}

export interface CardColumn<R> {
  /** The column's heading — Baton's own word; at phone width it labels the cell. */
  head: string;
  cell: (row: R, index: number) => ReactNode;
  rowHeader?: boolean;
}

/** A real table that becomes one card a row at phone width, each cell under its heading
 *  (B-213, B-220: "the table collapses to cards"). `rowClass` marks a row by a word of its own
 *  state; the state is also drawn as text in a cell — never colour alone. */
export function CardTable<R>({ label, columns, rows, rowKey, empty, rowClass }: { label: string; columns: readonly CardColumn<R>[]; rows: readonly R[]; rowKey: (row: R, index: number) => string | number; empty: ReactNode; rowClass?: (row: R) => string | undefined }) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap cards-at-phone">
      <table className="table" aria-label={label}>
        <thead>
          <tr>{columns.map((c) => <th key={c.head} scope="col">{c.head}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={rowKey(row, r)} className={rowClass?.(row)}>
              {columns.map((c) => c.rowHeader
                ? <th key={c.head} scope="row" data-label={c.head}>{c.cell(row, r)}</th>
                : <td key={c.head} data-label={c.head}>{c.cell(row, r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The query of the page's URL as the screen reads and writes it: filters are part of the
 *  address (B-219, B-213, B-220), so a reload or a shared link lands on the same view. */
export function queryOf(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

/** The page's own path with `changes` applied to its query: an empty or null value drops the
 *  parameter. */
export function withQuery(search: string, changes: Record<string, string | null>): string {
  const q = new URLSearchParams(search);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === '') q.delete(k);
    else q.set(k, v);
  }
  const text = q.toString();
  return `${window.location.pathname}${text ? `?${text}` : ''}`;
}

/** A question's link — where git holds it — as a link only when it passes the link rule. */
export function QuestionLink({ url }: { url: unknown }) {
  if (typeof url !== 'string' || url === '') return null;
  return <ExtLink href={url} showHost>the question</ExtLink>;
}
