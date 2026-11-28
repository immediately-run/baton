// BoardScreen.tsx — `/repositories/{r}/board` (B-209 item 1): the repository as it stands. Two
// sections, each one filtered `repo.tickets` read followed to its end by cursor: Ready — in
// Baton's matching order (R-BTN-61), each row its requirements, the eligible live runners by
// name, and for a ticket none can take the failed rule as text — and Running — the live claims
// as holders: runner, leg, running for, the lease as a bar with now marked, `stalled` and the
// condition a leg waits on, as the read says them. Above Ready, `GET …/board`'s
// The capabilities the read names as granted. No control
// (a ticket's are on its page), no order and no state computed here. Rows are cards at 375 px.
import type { ReactNode } from 'react';
import { ReadGate } from '../../app/Refusal';
import { Link, pathOrNull } from '../../app/router';
import { span } from '../../lib/format';
import { ExtLink } from '../../lib/links';
import { useRead } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { Empty, ErrorNote, Loading, PageHeader, Section, StatusMark, useClock } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { Chips, LeaseBar, RunnerLink, TicketLink, useTicketPages, type Pages } from '../tickets/parts';
import type { BoardAnswer, TicketRow, TicketsAnswer } from '../tickets/types';
import '../tickets/tickets.css';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function TicketCell({ row, repository }: { row: TicketRow; repository: string }) {
  return (
    <TicketLink id={row.ticket_id} repository={repository}>
      <Text mono value={row.ticket_id} />
      {row.title != null ? <span className="tk-title"> <Text value={row.title} /></span> : null}
    </TicketLink>
  );
}

function ReadyRow({ row, repository }: { row: TicketRow; repository: string }) {
  const runners = Array.isArray(row.eligible_runners) ? row.eligible_runners : null;
  return (
    <tr className="tk-row">
      <th scope="row" className="tk-id"><TicketCell row={row} repository={repository} />{row.expedite ? <span className="chip tk-flag">expedite</span> : null}</th>
      <td data-label="Rank"><Text value={row.rank ?? 'Unranked'} />{row.ready_position != null ? <> · ready #{row.ready_position}</> : null}</td>
      <td data-label="Requires"><Chips names={row.requires ?? []} unmet={row.requires_unmet} empty="none" /></td>
      <td data-label="Who can take it">
        {runners === null ? <span className="mut">—</span>
          : runners.length === 0 ? <StatusMark tone="warn" label={<>nobody can take it — <Text mono value={row.failed_rule ?? 'no rule named'} /></>} />
            : runners.map((w, i) => <span key={w.runner_id}>{i ? ', ' : ''}<RunnerLink runner={w} repository={repository} /></span>)}
      </td>
    </tr>
  );
}

function RunningRow({ row, repository }: { row: TicketRow; repository: string }) {
  const now = useClock();
  const d = row.detail ?? {};
  const since = num(d.since);
  const wait = num(d.condition_wait);
  const condition = wait !== null ? pathOrNull('repository/conditions/{condition}', { repository, condition: String(wait) }) : null;
  return (
    <tr className="tk-row">
      <th scope="row" className="tk-id"><TicketCell row={row} repository={repository} /></th>
      <td data-label="Rank"><Text value={row.rank ?? 'Unranked'} /></td>
      <td data-label="Runner"><RunnerLink runner={{ runner_id: d.runner_id as number, hostname: d.hostname as string, session_name: d.session_name as string }} repository={repository} /></td>
      <td data-label="Leg">{d.leg != null ? <Text mono value={d.leg} /> : <span className="mut">—</span>}</td>
      <td data-label="Leg page">{d.session_url
        ? <ExtLink kind="session" href={d.session_url} showHost />
        : <span className="mut">{d.session_link === true ? 'Link unavailable' : 'No leg page reported'}</span>}</td>
      <td data-label="Running for">{since !== null ? span(Math.max(0, now - since)) : <span className="mut">—</span>}</td>
      <td data-label="Lease"><LeaseBar from={d.since} to={d.lease_ends_at} /></td>
      <td data-label="Notes">
        {d.stalled === true ? <StatusMark tone="warn" label="stalled" title="Alive, with no activity for over two hours" /> : null}
        {d.alive === false ? <StatusMark tone="bad" label="runner silent" /> : null}
        {wait !== null ? <span className="bd-wait">{condition ? <Link to={condition}>waits on condition <Text mono value={wait} /></Link> : <>waits on condition <Text mono value={wait} /></>}</span> : null}
        {d.stalled !== true && d.alive !== false && wait === null ? <span className="mut">—</span> : null}
      </td>
    </tr>
  );
}

function Gate({ pages, children }: { pages: Pages; children: (first: TicketsAnswer) => ReactNode }) {
  return <ReadGate<TicketsAnswer> read={pages.first} entity="ticket list">{children}</ReadGate>;
}

export function BoardScreen({ params }: ScreenProps) {
  const repo = params.repository;
  const base = `/v1/repositories/${encodeURIComponent(repo)}`;
  const board = useRead<BoardAnswer>(`${base}/board`);
  const ready = useTicketPages(`${base}/tickets?state=ready`, true);
  const running = useTicketPages(`${base}/tickets?state=running`, true);
  const granted = board.data?.granted_capabilities;
  return (
    <>
      <PageHeader title="Board" sub="The repository as it stands: what is running, and what is ready, in Baton’s order." />
      <Section title="Ready" count={ready.first.data ? ready.rows.length : undefined} hint="Repository queue; actual offers depend on the runner">
        {board.error && !board.data ? <ErrorNote error={board.error} what="The board read" /> : null}
        <Gate pages={ready}>
          {() => (ready.rows.length === 0 ? <Empty>No ticket is ready.</Empty> : (
            <div className="table-wrap tk-wrap">
              <table className="table tk-table bd-ready" aria-label="Ready tickets">
                <thead><tr><th scope="col">Ticket</th><th scope="col">Rank</th><th scope="col">Requires</th><th scope="col">Who can take it</th></tr></thead>
                <tbody>{ready.rows.map((row) => <ReadyRow key={row.ticket_id} row={row} repository={repo} />)}</tbody>
              </table>
            </div>
          ))}
        </Gate>
        {ready.loading ? <Loading what="more ready tickets" /> : null}
      </Section>
      <Section title="Running" count={running.first.data ? running.rows.length : undefined} hint="Live claims and their holders">
        <Gate pages={running}>
          {() => (running.rows.length === 0 ? <Empty>No ticket is claimed.</Empty> : (
            <div className="table-wrap tk-wrap">
              <table className="table tk-table bd-running" aria-label="Running tickets">
                <thead><tr><th scope="col">Ticket</th><th scope="col">Rank</th><th scope="col">Runner</th><th scope="col">Leg</th><th scope="col">Leg page</th><th scope="col">Running for</th><th scope="col">Lease</th><th scope="col">Notes</th></tr></thead>
                <tbody>{running.rows.map((row) => <RunningRow key={row.ticket_id} row={row} repository={repo} />)}</tbody>
              </table>
            </div>
          ))}
        </Gate>
        {running.loading ? <Loading what="more claims" /> : null}
      </Section>
      <Section title="Granted capabilities" hint="As the board read names them for its caller">
        {Array.isArray(granted)
          ? <Chips names={granted} empty="none" />
          : <Empty>The board read names a grant’s capabilities to the granted runner’s own key, and none to a dashboard session. Each runner’s grant is on its page.</Empty>}
      </Section>
    </>
  );
}
