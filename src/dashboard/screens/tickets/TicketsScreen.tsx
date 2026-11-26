// TicketsScreen.tsx — `/repositories/{r}/tickets` (B-209 item 2): the mockup's Tickets table from
// `GET …/tickets` (`repo.tickets`) alone — a real table of ticket (qualified id, title linking
// its page), state (shape and word) with the reason band under the row, course position, and
// requires as chips with one no live runner declares marked. The tabs carry the read's `counts`;
// the tab and the text filter are `?state=` and `?q=` in the URL,
// so a view is a link. "Showing n of total" and a load-more follow the read's cursor. No sort
// control: the order is Baton's (R-BTN-61). No control and nothing computed here: the state,
// its reasons and the counts are the read's. At phone width each row is a card, state first.
import { useEffect, useRef, useState } from 'react';
import { ReadGate } from '../../app/Refusal';
import { navigate, useSearch } from '../../app/router';
import { span } from '../../lib/format';
import { Text } from '../../lib/Text';
import { Band, Empty, FilterInput, PageHeader, Tabs, useClock, type Tab } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { Chips, RunnerLink, StateMark, TicketLink, reasonOf, reasonTone, useTicketPages } from './parts';
import type { TicketRow, TicketsAnswer } from './types';
import './tickets.css';

/** The tabs, each the `?state=` it sets and the state words whose counts it sums — the tab
 *  mapping is §11.4's (a held ticket counts under Blocked); the numbers are the read's. */
export const TICKET_TABS: readonly { id: string; label: string; states: readonly string[] | null }[] = [
  { id: '', label: 'All', states: null },
  { id: 'ready', label: 'Ready', states: ['ready'] },
  { id: 'running', label: 'Running', states: ['running'] },
  { id: 'blocked', label: 'Blocked', states: ['held', 'blocked', 'waiting-person', 'backing-off', 'suspended'] },
  { id: 'unconfirmed', label: 'Unconfirmed', states: ['unconfirmed'] },
  { id: 'closed-today', label: 'Closed today', states: ['closed'] },
];

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A tab's count from the read's `counts`; null (drawn as nothing) where the read carries none. */
export function tabCount(counts: Record<string, unknown> | undefined, states: readonly string[] | null): number | null {
  if (!counts) return null;
  if (states === null) return n(counts.total);
  let sum = 0;
  for (const s of states) {
    const c = n(counts[s]);
    if (c === null) return null;
    sum += c;
  }
  return sum;
}

/** The screen's query, read from and written to the URL. */
function useQuery(): { state: string; q: string; set: (part: Partial<{ state: string; q: string }>) => void } {
  const search = useSearch();
  const p = new URLSearchParams(search);
  const cur = { state: p.get('state') ?? '', q: p.get('q') ?? '' };
  const set = (part: Partial<typeof cur>) => {
    const next = { ...cur, ...part };
    const out = new URLSearchParams();
    for (const k of ['state', 'q'] as const) if (next[k] !== '') out.set(k, next[k]);
    const qs = out.toString();
    navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: 'q' in part });
  };
  return { ...cur, set };
}

/** Station, holder and how long — or what it waits for — as the read's text. */
function Position({ row, repository }: { row: TicketRow; repository: string }) {
  const now = useClock();
  const d = row.detail ?? {};
  const pos = row.position;
  const since = n(d.since);
  return (
    <span className="tk-pos">
      {pos ? <Text mono value={pos.station} /> : <span className="mut">—</span>}
      {pos?.next_leg ? <span className="mut"> → <Text mono value={pos.next_leg} /></span> : null}
      {row.state === 'running' ? (
        <span className="tk-holder">
          <RunnerLink runner={{ runner_id: d.runner_id as number, hostname: d.hostname as string, session_name: d.session_name as string }} repository={repository} />
          {since !== null ? <span className="mut"> · {span(Math.max(0, now - since))}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

function Row({ row, repository }: { row: TicketRow; repository: string }) {
  const reason = reasonOf(row, repository);
  return (
    <>
      <tr className={reason ? 'tk-row tk-has-band' : 'tk-row'}>
        <th scope="row" className="tk-id">
          <TicketLink id={row.ticket_id} repository={repository}>
            <Text mono value={row.ticket_id} />
            {row.title != null ? <span className="tk-title"> <Text value={row.title} /></span> : null}
          </TicketLink>
          {row.expedite ? <span className="chip tk-flag">expedite</span> : null}
        </th>
        <td className="tk-state" data-label="State">
          <StateMark state={row.state} />
          {row.reasons?.length ? <span className="tk-also mut"> also {row.reasons.map((r, i) => <span key={r}>{i ? ', ' : ''}<Text value={r} /></span>)}</span> : null}
        </td>
        <td data-label="Position"><Position row={row} repository={repository} /></td>
        <td data-label="Requires"><Chips names={row.requires ?? []} unmet={row.requires_unmet} empty="none" /></td>
      </tr>
      {reason ? (
        <tr className={`tk-band tk-band-${reasonTone(row)}`}>
          <td colSpan={5}>{reason}</td>
        </tr>
      ) : null}
    </>
  );
}

export function TicketsScreen({ params }: ScreenProps) {
  const repo = params.repository;
  const query = useQuery();
  // The text box holds what is typed; the URL (and so the read) follows it.
  const [typed, setTyped] = useState(query.q);
  useEffect(() => setTyped(query.q), [query.q]);
  const qs = new URLSearchParams();
  if (query.state) qs.set('state', query.state);
  if (query.q) qs.set('q', query.q);
  const base = `/v1/repositories/${encodeURIComponent(repo)}/tickets${qs.toString() ? `?${qs.toString()}` : ''}`;
  const pages = useTicketPages(base);
  // The tabs' counts are the whole repository's, whatever the filter: the last answer's stand
  // while the next view loads, so the bar — and the box being typed in — never unmounts.
  const counts = useRef<Record<string, number> | undefined>(undefined);
  if (pages.first.data?.counts) counts.current = pages.first.data.counts;
  const tabs: Tab[] = TICKET_TABS.map((t) => ({ id: t.id, label: t.label, count: tabCount(counts.current, t.states) ?? undefined }));
  return (
    <>
      <PageHeader title="Tickets" sub="Every ticket under its one state, in Baton’s order." />
      <div className="tk-bar">
        <Tabs label="Ticket states" tabs={tabs} value={TICKET_TABS.some((t) => t.id === query.state) ? query.state : ''} onChange={(id) => query.set({ state: id })} />
        <div className="tk-filters">
          <FilterInput label="Filter by id or title" placeholder="Filter by id or title" value={typed} onChange={(v) => { setTyped(v); query.set({ q: v }); }} />
        </div>
      </div>
      {query.state && !TICKET_TABS.some((t) => t.id === query.state) ? <Band>Showing the state <Text mono value={query.state} />.</Band> : null}
      <ReadGate<TicketsAnswer> read={pages.first} entity="ticket list">
        {(first) => {
          const total = n(first.matched) ?? pages.rows.length;
          return (
            <>
              {pages.rows.length === 0 ? (
                <Empty>{query.state || query.q ? 'No ticket matches this view.' : 'This repository has no ticket on its board.'}</Empty>
              ) : (
                <div className="table-wrap tk-wrap">
                  <table className="table tk-table" aria-label="Tickets">
                    <thead>
                      <tr>
                        <th scope="col">Ticket</th>
                        <th scope="col">State</th>
                        <th scope="col">Position</th>

                        <th scope="col">Requires</th>
                      </tr>
                    </thead>
                    <tbody>{pages.rows.map((row) => <Row key={row.ticket_id} row={row} repository={repo} />)}</tbody>
                  </table>
                </div>
              )}
              <p className="tk-foot mut">
                <span>{`Showing ${pages.rows.length} of ${total}`}</span>
                {pages.more ? <> · <button type="button" className="btn" onClick={pages.loadMore} disabled={pages.loading}>Load more</button></> : null}
              </p>
            </>
          );
        }}
      </ReadGate>
    </>
  );
}
