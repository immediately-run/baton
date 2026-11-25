// ConditionsScreen.tsx — `/repositories/{r}/conditions` (B-219; BATON_SPEC §7.3 R-BTN-163,
// §6.4 R-BTN-116): what waits on a person in one repository, the mockup's Needs-you list. One
// read draws it — `GET …/needs-you` (`repo.needs-you`): the open conditions in the read's own
// order (severity, then age), the queued person legs, and V1's listings that are not conditions
// yet (B-57), each under its own name. A second read — the conditions list — is made only when
// the closed ones are asked for (`?open=0`). `?type=` and `?ticket=` are the URL's.
//
// The page decides nothing about who may act: a restart is a control only through the registry
// and the read's `allowed` (none today: resolving is B-56's), and a person leg's options are
// text with the CLI line that answers them — no session writes an attestation. Every value is
// a read's text (§12.3); a link to another origin passes the link rule or is text.
import type { ReactNode } from 'react';
import { Controls } from '../../app/controls/Controls';
import { ReadGate } from '../../app/Refusal';
import { Link, navigate, pathOrNull, useSearch } from '../../app/router';
import { ExtLink } from '../../lib/links';
import { useRead } from '../../lib/reads';
import { Text, textOf } from '../../lib/Text';
import { Band, Empty, NotBuiltNote, PageHeader, Pager, RelTime, Section, usePager, type Tone } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { CardTable, KindMark, kindOf, Options, QUESTION_KIND, QuestionLink, queryOf, Restarts, Severity, TicketLink, withQuery, type Kind } from './kit';
import type { Condition, ConditionsPage, ListingRow, NeedsYou, Question } from './types';

/** V1's Needs-you listings (B-57 makes each a condition), by the name the read serves them
 *  under: Baton's plain name for it, one sentence on what a person does about it, and the
 *  field that says since when. The words are Baton's own; every value in a row is the read's. */
export const LISTINGS: { key: string; label: string; hint: string; when?: string; tone?: Tone; glyph?: string }[] = [
  { key: 'unconfirmed', label: 'Unconfirmed', hint: 'A runner reported its work done and git has not shown it yet. Confirm or release it on the ticket’s page.', when: 'ended_at', glyph: '◆' },
  { key: 'held_items', label: 'Held', hint: 'A hold keeps the ticket from being offered. Lift it on the ticket’s page.', when: 'set_at', tone: 'mut', glyph: '‖' },
  { key: 'blocked_capability', label: 'Nobody can take', hint: 'Blocked for a day on a capability no live runner declares.', when: 'since' },
  { key: 'fence_pending', label: 'Fence pending', hint: 'A reaped claim whose runner may still write: its fence is not confirmed.', when: 'ended_at', tone: 'bad', glyph: '■' },
  { key: 'unacknowledged_releases', label: 'Release not acknowledged', hint: 'A runner was asked to release and has not answered.', when: 'sent_at' },
  { key: 'regressed', label: 'Going backwards', hint: 'Git has shown the claim’s ticket behind where Baton holds it for half an hour.', when: 'regressed_since' },
  { key: 'policy', label: 'Waiting on a required bar', hint: 'The sync posts the leg without a bar the owners require.', when: 'waiting_since' },
  { key: 'course_changed', label: 'Course changed', hint: 'The ticket’s queued leg no longer leaves its station in the course now in force.', when: 'waiting_since' },
  { key: 'bars_mismatch', label: 'Bars read differently', hint: 'The holder and the sync read a leg’s bars differently; the sync’s reading binds.', when: 'at' },
  { key: 'stale_skills', label: 'Runner below a course’s version', hint: 'The runner refreshes its course versions when idle. If the warning persists, the runner operator should check the refresh log and repair any edited, ahead, or diverged home checkout.' },
  { key: 'courses_refused', label: 'Course file refused', hint: 'The version in force stays; fix the file and push.', when: 'refused_at', tone: 'bad', glyph: '■' },
  { key: 'scope', label: 'Scope finding', hint: 'A leg reported outside its ticket’s scope, or a push no open claim covers. Acknowledge it on the ticket’s page.', when: 'updated_at' },
  { key: 'unsigned_control', label: 'Unsigned control change', hint: 'A post moved the head onto control changes no owner key signed.', when: 'at', tone: 'bad', glyph: '■' },
  { key: 'sync_late', label: 'Sync late', hint: 'No sync has answered this want for over 30 minutes.', when: 'wanted_at', tone: 'warn', glyph: '▲' },
  { key: 'mirror_late', label: 'Mirror late', hint: 'The mirror has not acknowledged its oldest pending event for over 30 minutes.', when: 'wanted_at', tone: 'warn', glyph: '▲' },
  { key: 'forge_secret_missing', label: 'Forge secret missing', hint: 'A configured dispatch or webhook has no matching host secret.', tone: 'warn', glyph: '▲' },
  { key: 'pool_unclaimed', label: 'Notice nobody claimed', hint: 'A notice has waited an hour in the pool.', when: 'since' },
  { key: 'no_owner_channel', label: 'No channel reaches the owners', hint: 'Decisions ask the owners and no courier delivers to them.' },
  { key: 'adoptions', label: 'Adoption asked for', hint: 'A session asks to take over a claim made in git. An administrator confirms it on Sync.', when: 'requested_at' },
];

const TIME_FIELD = /(^|_)(at|since)$/;

/** One value of a listing's row: a time as a relative time, anything else as text. */
function FieldValue({ name, value }: { name: string; value: unknown }) {
  if (TIME_FIELD.test(name) && typeof value === 'number') return <RelTime at={value} />;
  if (Array.isArray(value)) return <Text value={value.length} />;
  return <Text value={value} />;
}

/** The ticket a listing's row is about, where it names one. */
function ticketOf(row: ListingRow): string | null {
  if (typeof row.ticket_id === 'string') return row.ticket_id;
  const payload = row.payload;
  if (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).ticket_id === 'string') return (payload as Record<string, string>).ticket_id;
  return null;
}

function ListingRowItem({ listing, row, repository }: { listing: (typeof LISTINGS)[number]; row: ListingRow; repository: string }) {
  const ticket = ticketOf(row);
  const kind: Kind = { name: listing.label, glyph: listing.glyph ?? '▲', tone: listing.tone ?? 'warn' };
  const fields = Object.entries(row).filter(([k, v]) => k !== 'ticket_id' && k !== listing.when && k !== 'repository_id' && v !== null && v !== undefined && v !== '');
  const sync = listing.key === 'adoptions' ? pathOrNull('repository/sync', { repository }) : null;
  return (
    <li className="needs-row">
      <KindMark kind={kind} />
      <div className="needs-main">
        {ticket ? <div className="needs-title"><TicketLink id={ticket} repository={repository} /></div> : null}
        <dl className="fields">
          {fields.map(([k, v]) => (
            <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd><FieldValue name={k} value={v} /></dd></div>
          ))}
        </dl>
        <div className="needs-detail">{listing.hint}</div>
      </div>
      <div className="needs-act">
        {listing.when && row[listing.when] != null ? <span className="mut">since <RelTime at={row[listing.when]} /></span> : null}
        {sync ? <Link to={sync}>Sync</Link> : null}
      </div>
    </li>
  );
}

function QuestionRow({ question, repository }: { question: Question; repository: string }) {
  return (
    <li className="needs-row">
      <KindMark kind={QUESTION_KIND} />
      <div className="needs-main">
        <div className="needs-title">
          <TicketLink id={question.ticket_id} repository={repository} />
          {question.title ? <Text value={question.title} /> : null}
        </div>
        <div className="needs-detail">
          <span>leg <Text mono value={question.leg} /></span>
          {question.asks ? <span>asks <Text mono value={question.asks} /></span> : null}
          <Severity value={question.severity} />
          {question.expires_at != null ? <span>expires <RelTime at={question.expires_at} /></span> : null}
          <QuestionLink url={question.url} />
        </div>
        <Options question={question} />
      </div>
    </li>
  );
}

function ConditionRow({ condition, repository }: { condition: Condition; repository: string }) {
  const kind = kindOf(condition);
  const page = pathOrNull('repository/conditions/{condition}', { repository, condition: textOf(condition.condition_id) });
  const interact = textOf(condition.type) === 'interact' || textOf(condition.type).startsWith('interact.');
  return (
    <li className="needs-row">
      <KindMark kind={kind} type={condition.type} />
      <div className="needs-main">
        <div className="needs-title">
          <TicketLink id={condition.ticket_id} repository={repository} />
          <span>leg <Text mono value={condition.leg} /></span>
        </div>
        <div className="needs-detail">
          {kind.name !== null ? <Text mono value={condition.type} /> : null}
          <Severity value={condition.severity} />
          <span>raised <RelTime at={condition.raised_at} /></span>
          {!interact && condition.url ? <ExtLink href={condition.url} showHost>where it is asked</ExtLink> : null}
        </div>
        <Restarts condition={condition} />
      </div>
      <div className="needs-act">
        {/* R-BTN-195: the session link Baton holds for the run, a link only on an allowed host. */}
        {interact && condition.url ? <ExtLink href={condition.url} kind="session" showHost>Open session</ExtLink> : null}
        <Controls
          view="repository/conditions/{condition}"
          allowed={condition.allowed ?? []}
          label="Restarts"
          target={{ repository, ticket_id: condition.ticket_id, condition_id: condition.condition_id, condition: condition.condition_id }}
        />
        {page ? <Link to={page}>Resolve page</Link> : null}
      </div>
    </li>
  );
}

const rank = (s: unknown): number => (s === 'critical' ? 0 : s === 'high' ? 1 : 2);

/** The closed and open conditions together, by id — drawn only when asked for (`?open=0`). */
function AllConditions({ repository, type, ticket }: { repository: string; type: string; ticket: string }) {
  const pager = usePager();
  const q = new URLSearchParams();
  if (type) q.set('type', type);
  if (ticket) q.set('ticket', ticket);
  if (pager.after) q.set('cursor', pager.after);
  const text = q.toString();
  const read = useRead<ConditionsPage>(`/v1/repositories/${encodeURIComponent(repository)}/conditions${text ? `?${text}` : ''}`);
  return (
    <Section title="Every condition" hint="Open and closed, oldest first.">
      <ReadGate read={read} entity="condition">
        {(page) => {
          const rows = Array.isArray(page.conditions) ? page.conditions : [];
          return (
            <>
              <CardTable
                label="Every condition of the repository"
                empty="No condition matches."
                rows={rows}
                rowKey={(c) => c.condition_id}
                columns={[
                  { head: 'Condition', rowHeader: true, cell: (c) => {
                    const to = pathOrNull('repository/conditions/{condition}', { repository, condition: textOf(c.condition_id) });
                    return to ? <Link to={to}><Text mono value={c.condition_id} /></Link> : <Text mono value={c.condition_id} />;
                  } },
                  { head: 'Type', cell: (c) => <Text mono value={c.type} /> },
                  { head: 'Ticket', cell: (c) => <TicketLink id={c.ticket_id} repository={repository} /> },
                  { head: 'Leg', cell: (c) => <Text mono value={c.leg} /> },
                  { head: 'Raised', cell: (c) => <RelTime at={c.raised_at} /> },
                  { head: 'Outcome', cell: (c) => <><Text value={c.outcome} />{c.closed_at != null ? <> · <RelTime at={c.closed_at} /></> : null}</> },
                ]}
              />
              <Pager pager={pager} next={page.cursor} />
            </>
          );
        }}
      </ReadGate>
    </Section>
  );
}

export function ConditionsScreen({ params, role }: ScreenProps) {
  const repository = params.repository;
  const search = useSearch();
  const query = queryOf(search);
  const type = query.get('type') ?? '';
  const ticket = query.get('ticket') ?? '';
  const closed = query.get('open') === '0';
  const read = useRead<NeedsYou>(`/v1/repositories/${encodeURIComponent(repository)}/needs-you`);
  const set = (changes: Record<string, string | null>) => navigate(withQuery(search, changes), { replace: true });

  const typeFits = (t: unknown) => type === '' || textOf(t) === type || textOf(t).startsWith(`${type}.`);
  const ticketFits = (id: unknown) => ticket === '' || textOf(id) === ticket || textOf(id) === `${repository}:${ticket}`;

  return (
    <>
      <PageHeader title="Conditions" sub="What waits on a person in this repository." />
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <label>Type <input className="input" type="search" aria-label="Condition type" placeholder="a type, or its prefix" value={type} onChange={(e) => set({ type: e.target.value.trim() })} /></label>
        <label>Ticket <input className="input" type="search" aria-label="Ticket" placeholder="a ticket id" value={ticket} onChange={(e) => set({ ticket: e.target.value.trim() })} /></label>
        <label><input type="checkbox" checked={closed} onChange={(e) => set({ open: e.target.checked ? '0' : null })} /> Show closed conditions</label>
      </form>
      <ReadGate read={read} entity="repository" id={repository}>
        {(data) => {
          const conditions = (Array.isArray(data.conditions) ? data.conditions : []).filter((c) => typeFits(c.type) && ticketFits(c.ticket_id));
          // A person leg is no condition type: a type filter leaves the questions out.
          const questions = (Array.isArray(data.questions) ? data.questions : []).filter((q) => type === '' && ticketFits(q.ticket_id));
          const listings = data.listings && typeof data.listings === 'object' ? data.listings : {};
          const others = type !== '' ? [] : LISTINGS.flatMap((l) => (Array.isArray(listings[l.key]) ? listings[l.key] : []).filter((r) => ticket === '' || ticketFits(ticketOf(r))).map((row) => ({ listing: l, row })));
          const unnamed = Object.keys(listings).filter((k) => !LISTINGS.some((l) => l.key === k) && Array.isArray(listings[k]) && listings[k].length > 0);
          // The read's order within each kind — severity, then age — with the questions among
          // the conditions of their own severity.
          const needs = [
            ...questions.map((q) => ({ rank: rank(q.severity), key: `q ${textOf(q.ticket_id)} ${textOf(q.leg)}`, node: <QuestionRow question={q} repository={repository} /> })),
            ...conditions.map((c) => ({ rank: rank(c.severity), key: `c ${textOf(c.condition_id)}`, node: <ConditionRow condition={c} repository={repository} /> })),
          ].map((x, i) => ({ ...x, i })).sort((a, b) => a.rank - b.rank || a.i - b.i);
          const sync = pathOrNull('repository/sync', { repository });
          const elsewhere = Array.isArray(data.elsewhere) ? data.elsewhere : [];
          return (
            <>
              {typeof data.held_posts === 'number' && data.held_posts > 0 && sync ? (
                <Band tone="warn"><p>A rewritten history is held: <Link to={sync}><Text value={data.held_posts} /> held on Sync</Link>, where it is accepted.</p></Band>
              ) : null}
              <Section title="Needs you" count={needs.length} tone={needs.length ? 'warn' : 'mut'}>
                {needs.length === 0
                  ? <Empty>Nothing needs you right now.</Empty>
                  : <ul className="needs-list">{needs.map((x) => <FragmentRow key={x.key}>{x.node}</FragmentRow>)}</ul>}
                {conditions.some((c) => c.restarts && Object.keys(c.restarts).length > 0) ? <NotBuiltNote what="Resolving a condition by one of its restarts" ticket={data.not_built?.resolve ?? 'B-56'} /> : null}
              </Section>
              <Section title="Also waiting" count={others.length} tone={others.length ? 'warn' : 'mut'} hint="Listed by Baton, and not conditions yet.">
                {others.length === 0
                  ? <Empty>Nothing else is waiting.</Empty>
                  : <ul className="needs-list">{others.map(({ listing, row }, i) => <ListingRowItem key={`${listing.key} ${i}`} listing={listing} row={row} repository={repository} />)}</ul>}
                {unnamed.length > 0 ? <p className="mut">Also listed: {unnamed.map((k, i) => <span key={k}>{i ? ', ' : ''}<Text mono value={k} /> (<Text value={listings[k].length} />)</span>)}.</p> : null}
              </Section>
              {elsewhere.length > 0 ? (
                <p className="mut">
                  What waits on a person for the whole instance — {elsewhere.map((k, i) => <span key={textOf(k)}>{i ? ', ' : ''}<Text mono value={k} /></span>)} — is not this repository’s
                  {role === 'administrator' ? <>: see <Link to="/state">State</Link>.</> : '.'}
                </p>
              ) : null}
            </>
          );
        }}
      </ReadGate>
      {closed ? <AllConditions repository={repository} type={type} ticket={ticket} /> : null}
    </>
  );
}

/** A list item built elsewhere, keyed here. */
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
