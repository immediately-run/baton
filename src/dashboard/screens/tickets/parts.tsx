// parts.tsx — what the Board, the Tickets table and the ticket's page draw alike: a ticket's
// state as a shape and its word, the reason band under a row, requirement chips, the lease bar,
// links to a ticket and a runner, and the list read followed by its cursor. Every word that
// names a state, a station, a leg or a capability is the read's own, drawn as text (§12.3); the
// only words of the dashboard's own here are the sentences around them. No state and no order
// is computed here: both are the read's.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, pathOrNull } from '../../app/router';
import { span } from '../../lib/format';
import { useReads, type Read } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { RelTime, StatusMark, useClock, type Tone } from '../../lib/ui';
import type { RunnerName, TicketRow, TicketsAnswer } from './types';

/** Each state word's shape and tone: the state reads without its colour. A word this table
 *  does not hold is drawn as its text beside the plain mark. */
export const STATE_MARKS: Record<string, { glyph: string; tone: Tone }> = {
  unconfirmed: { glyph: '◆', tone: 'warn' },
  running: { glyph: '●', tone: 'ok' },
  'waiting-person': { glyph: '?', tone: 'warn' },
  held: { glyph: '‖', tone: 'mut' },
  blocked: { glyph: '▲', tone: 'warn' },
  'backing-off': { glyph: '↻', tone: 'mut' },
  suspended: { glyph: '◇', tone: 'mut' },
  ready: { glyph: '○', tone: 'mut' },
  closed: { glyph: '✓', tone: 'ok' },
};

export function StateMark({ state }: { state: unknown }) {
  const word = typeof state === 'string' ? state : '';
  const mark = STATE_MARKS[word] ?? { glyph: '○', tone: 'mut' as Tone };
  return <StatusMark tone={mark.tone} glyph={mark.glyph} label={<Text value={word || '—'} />} />;
}

/** A qualified id's local part — what a ticket's URL names it by. */
export const localOf = (id: string): string => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id);
const repositoryOf = (id: string): string | null => (id.includes(':') ? id.slice(0, id.indexOf(':')) : null);

/** A ticket's id as a link to its page — in this repository, or another the id names — or as
 *  text where the id is not id-shaped. */
export function TicketLink({ id, repository, children }: { id: unknown; repository: string; children?: ReactNode }) {
  if (typeof id !== 'string' || id === '') return <span className="mut">—</span>;
  const to = pathOrNull('repository/tickets/{ticket}', { repository: repositoryOf(id) ?? repository, ticket: localOf(id) });
  const label = children ?? <Text mono value={id} />;
  return to ? <Link to={to}>{label}</Link> : <>{label}</>;
}

/** A runner by its names, linking its page (the runners slice's screen). */
export function RunnerLink({ runner, repository }: { runner: Partial<RunnerName> & { runner_id?: unknown }; repository: string }) {
  const to = typeof runner.runner_id === 'number' ? pathOrNull('repository/runners/{runner}', { repository, runner: String(runner.runner_id) }) : null;
  const label = (
    <>
      <Text value={runner.hostname ?? `runner ${String(runner.runner_id ?? '—')}`} />
      {runner.session_name && runner.session_name !== runner.hostname ? <span className="mut"> · <Text value={runner.session_name} /></span> : null}
    </>
  );
  return to ? <Link to={to}>{label}</Link> : <span>{label}</span>;
}

/** Capability names as chips, as the ticket and its course stated them (R-BTN-174); one no
 *  live runner declares is marked by a shape and a word, not by colour alone. */
export function Chips({ names, unmet, empty }: { names: readonly unknown[]; unmet?: readonly unknown[]; empty?: ReactNode }) {
  const list = names.filter((n): n is string => typeof n === 'string');
  if (list.length === 0) return <span className="mut">{empty ?? '—'}</span>;
  const missing = new Set(unmet ?? []);
  return (
    <span className="chips">
      {list.map((n) => missing.has(n)
        ? <span key={n} className="chip chip-unmet" title="No live runner granted on this repository declares it"><span aria-hidden="true">▲ </span><Text value={n} /><span className="chip-note"> · no live runner</span></span>
        : <span key={n} className="chip"><Text value={n} /></span>)}
    </span>
  );
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** A lease drawn as the mockup's runner cards draw it: a bar from `from` to `to`, now marked,
 *  and the time left in words. The clock is the browser's (display only). */
export function LeaseBar({ from, to, label = 'lease' }: { from: unknown; to: unknown; label?: string }) {
  const now = useClock();
  const a = num(from);
  const b = num(to);
  if (a === null || b === null || b <= a) return <span className="mut">no {label} end</span>;
  const at = Math.max(0, Math.min(1, (now - a) / (b - a)));
  const left = b - now;
  return (
    <span className="lease" role="img" aria-label={`${label}: ${left > 0 ? `${span(left)} left` : `ended ${span(-left)} ago`}`}>
      <span className="lease-track"><span className="lease-fill" style={{ width: `${(at * 100).toFixed(1)}%` }} /><span className="lease-now" style={{ left: `${(at * 100).toFixed(1)}%` }} /></span>
      <span className={`lease-left${left <= 0 ? ' tone-bad' : ''}`}>{left > 0 ? `${span(left)} left` : `ended ${span(-left)} ago`}</span>
    </span>
  );
}

/** Why a ticket stands where it does, in one line under its row, from the state's `detail`
 *  alone. Null where the state says it all (a plain ready, a plain running). */
export function reasonOf(row: Pick<TicketRow, 'state' | 'detail' | 'eligible_runners' | 'failed_rule'>, repository: string): ReactNode | null {
  const d = row.detail ?? {};
  switch (row.state) {
    case 'held':
      return <>Held by <Text value={d.set_by ?? 'an operator'} />{str(d.reason) ? <>: <Text value={d.reason} /></> : null}{num(d.since) !== null ? <> · <RelTime at={d.since} /></> : null}</>;
    case 'blocked': {
      const ref = str(d.ref);
      if (d.kind === 'capability') return <>No capable runner — needs <Text mono value={ref ?? '—'} /></>;
      if (d.kind === 'ticket') return <>Waiting on <TicketLink id={ref} repository={repository} /></>;
      if (d.kind === 'decision') return <>Decision open: <Text mono value={ref ?? '—'} /></>;
      return <>Blocked on <Text value={d.kind ?? 'a block'} /> <Text mono value={ref ?? ''} /></>;
    }
    case 'backing-off':
      return <>Backing off — <Text value={d.attempt ?? '—'} /> of <Text value={d.max_runs ?? '—'} /> failed attempts{num(d.until) !== null ? <>; offered again <RelTime at={d.until} /></> : null}</>;
    case 'waiting-person':
      return <>Decision open — a person answers <Text mono value={d.leg ?? '—'} />{str(d.question_id) ? <> (question <Text mono value={d.question_id} />)</> : null}</>;
    case 'unconfirmed':
      return <><Text value={d.hostname ?? 'A runner'} /> reported it done <RelTime at={d.reported_at} />; no snapshot has confirmed it yet</>;
    case 'suspended':
      return str(d.waits_for) ? <>Resting at <Text mono value={d.station ?? '—'} /> — waits for <Text value={d.waits_for} /></> : <>Resting{str(d.station) ? <> at <Text mono value={d.station} /></> : null}: its queued leg is not posted ready</>;
    case 'closed':
      return <>Closed{str(d.end) ? <> as <Text mono value={d.end} /></> : null}{num(d.at) !== null ? <> <RelTime at={d.at} /></> : null}</>;
    case 'running': {
      const stalled = d.stalled === true;
      const wait = num(d.condition_wait);
      if (!stalled && wait === null) return null;
      const to = wait !== null ? pathOrNull('repository/conditions/{condition}', { repository, condition: String(wait) }) : null;
      return (
        <>
          {stalled ? <>Stalled — no activity since <RelTime at={d.last_activity_at ?? d.since} /></> : null}
          {stalled && wait !== null ? ' · ' : null}
          {wait !== null ? <>Waits on {to ? <Link to={to}>condition <Text mono value={wait} /></Link> : <>condition <Text mono value={wait} /></>}</> : null}
        </>
      );
    }
    case 'ready':
      if (Array.isArray(row.eligible_runners) && row.eligible_runners.length === 0) return <>Nobody can take it — <Text mono value={row.failed_rule ?? 'no rule named'} /></>;
      return null;
    default:
      return null;
  }
}

/** Does the reason need a person's eye? The band's tone. */
export const reasonTone = (row: Pick<TicketRow, 'state' | 'detail'>): 'warn' | 'mut' =>
  (['unconfirmed', 'waiting-person', 'blocked'].includes(row.state) || (row.state === 'running' && row.detail?.stalled === true) || row.state === 'ready' ? 'warn' : 'mut');

// ── a list read followed by its cursor ───────────────────────────────────────────────────

export interface Pages {
  /** The first page's read: the gate for loading and refusals, and the `counts`. */
  first: Read<TicketsAnswer>;
  rows: TicketRow[];
  /** A further page stands behind the last one loaded. */
  more: boolean;
  loadMore: () => void;
  /** A later page has not answered yet. */
  loading: boolean;
}

const withCursor = (base: string, cursor: string) => `${base}${base.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`;

/** At most this many pages are followed without a click (the envelope's 5,000 tickets). */
const AUTO_PAGES = 50;

/** `base` (a `repo.tickets` path with its filters) page by page: each page's `next_cursor`
 *  names the next. With `auto` every page is followed to the end (the Board's two sections);
 *  without it `loadMore` takes one more. A changed `base` starts again from its first page. */
export function useTicketPages(base: string, auto = false): Pages {
  const [held, setHeld] = useState<{ base: string; cursors: string[] }>({ base, cursors: [] });
  const cursors = held.base === base ? held.cursors : [];
  const reads = useReads([base, ...cursors.map((c) => withCursor(base, c))]) as Read<TicketsAnswer>[];
  const last = reads[reads.length - 1];
  const next = typeof last?.data?.next_cursor === 'string' && last.data.next_cursor !== '' ? last.data.next_cursor : null;
  const loadMore = () => {
    if (next !== null && !cursors.includes(next)) setHeld({ base, cursors: [...cursors, next] });
  };
  useEffect(() => {
    if (auto && next !== null && cursors.length < AUTO_PAGES && !cursors.includes(next)) setHeld({ base, cursors: [...cursors, next] });
    // `cursors.join` stands for the list: a new array with the same cursors is the same.
  }, [auto, next, base, cursors.join('\n')]);
  const seen = new Set<string>();
  const rows: TicketRow[] = [];
  for (const r of reads) {
    for (const t of Array.isArray(r.data?.tickets) ? r.data.tickets : []) {
      if (!t || typeof t.ticket_id !== 'string' || seen.has(t.ticket_id)) continue;
      seen.add(t.ticket_id);
      rows.push(t);
    }
  }
  return { first: reads[0], rows, more: next !== null, loadMore, loading: reads.slice(1).some((r) => r.data === undefined && !r.error) };
}
