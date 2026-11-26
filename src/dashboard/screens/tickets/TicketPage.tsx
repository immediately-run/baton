// TicketPage.tsx — `/repositories/{r}/tickets/{ticket}` (B-210): every read about one ticket,
// each section from its own read and all polled together — `ticket.show` (head, position, the
// claim with its lease bar and attempts, overrides, open conditions, scope findings, resume,
// the forge link), `ticket.blocks` (why it cannot move), `ticket.history` paged by `before`,
// `ticket.children`, and `legs/{leg}/runs` for each leg the path names. Read-only but for
// `TicketControls` (B-222), drawn under the head. Every value is the read's text through
// `Text`; a URI is a link only through the client's link rule (`ExtLink`), a session link only
// from `session_hosts` (R-BTN-113), a log directory always text (R-BTN-128). Station, leg and
// capability names are data. Route and adopt are the CLI's (Decision 2a), drawn as lines to
// copy. The sections stack at phone width.
import { useState, type ReactNode } from 'react';
import { ReadGate } from '../../app/Refusal';
import { Link, pathOf, pathOrNull } from '../../app/router';
import { shortSha, span } from '../../lib/format';
import { ExtLink } from '../../lib/links';
import { useRead, useReads, type Read } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { JsonText } from '../../lib/View';
import { Band, CliLine, Empty, ErrorNote, KeyValues, Loading, NotBuiltNote, PageHeader, RelTime, Section, StatusMark, Table, UtcTime, useClock } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { Chips, LeaseBar, RunnerLink, StateMark, TicketLink, localOf, reasonOf, reasonTone } from './parts';
import { AcknowledgeFinding, TicketControls } from './TicketControls';
import type { Block, BlocksAnswer, ChildrenAnswer, HistoryAnswer, HistoryRow, LegRun, RunsAnswer, TicketShow } from './types';
import './tickets.css';

const dash = <span className="mut">—</span>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A pointer to an input or an output (R-BTN-82): an `https://` URI is a link only where the
 *  client's link rule passes it; any other URI — `git:`, `s3://` — is text, with its digest. */
export function Pointer({ value }: { value: unknown }) {
  if (typeof value === 'string') return /^https:\/\//.test(value) ? <ExtLink href={value} showHost /> : <Text mono value={value} />;
  if (!isObj(value)) return <JsonText value={value} />;
  const uri = typeof value.uri === 'string' ? value.uri : null;
  return (
    <span className="tp-pointer">
      {typeof value.name === 'string' ? <><Text value={value.name} />: </> : null}
      {uri === null ? ('value' in value ? <JsonText value={value.value} /> : dash) : /^https:\/\//.test(uri) ? <ExtLink href={uri} showHost /> : <Text mono value={uri} />}
      {typeof value.digest === 'string' ? <span className="mut"> · <Text mono value={value.digest} /></span> : null}
      {typeof value.from_leg === 'string' ? <span className="mut"> · from <Text mono value={value.from_leg} /></span> : null}
    </span>
  );
}

function Pointers({ list }: { list: unknown }) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return <ul className="tp-pointers">{list.map((p, i) => <li key={i}><Pointer value={p} /></li>)}</ul>;
}

// ── head ─────────────────────────────────────────────────────────────────────────────────

function Head({ t, repository }: { t: TicketShow; repository: string }) {
  const lw = t.last_written_by;
  const reason = reasonOf(t, repository);
  return (
    <>
      <KeyValues rows={[
        ['State', <><StateMark state={t.state} />{t.reasons?.length ? <span className="mut"> also {t.reasons.map((r, i) => <span key={r}>{i ? ', ' : ''}<Text value={r} /></span>)}</span> : null}</>],
        ['Course', <Text mono value={t.course ?? t.course_id ?? '—'} />],
        ['Tags', <Chips names={t.tags ?? []} empty="none" />],
        ['Requires', <Chips names={t.requires ?? []} unmet={t.requires_unmet} empty="none" />],
        ['Parent', t.parent ? <TicketLink id={t.parent} repository={repository} /> : dash],
        ['On the forge', t.web_url ? <ExtLink href={t.web_url} showHost><Text mono value={t.path ?? t.web_url} /></ExtLink> : <span className="mut">{t.path ? <Text mono value={t.path} /> : 'no forge page'}</span>],
        ['Last written by', lw ? (
          <>
            <Text value={lw.pusher ?? '—'} />
            {lw.commit ? <span className="mut"> at <Text mono value={shortSha(lw.commit)} /></span> : null}
            {lw.at != null ? <span className="mut"> · <RelTime at={lw.at} /></span> : null}
            {lw.human === true ? <span className="chip tk-flag">human</span> : null}
          </>
        ) : <span className="mut">no one Baton could name</span>],
        ['Overrides', <>{t.overrides?.expedite ? <span className="chip">expedite</span> : null}{t.overrides?.hold ? <span className="chip">hold</span> : null}{!t.overrides?.expedite && !t.overrides?.hold ? <span className="mut">none</span> : null}</>],
      ]} />
      {reason ? <Band tone={reasonTone(t)}>{reason}</Band> : null}
    </>
  );
}

// ── position ─────────────────────────────────────────────────────────────────────────────

function Position({ t }: { t: TicketShow }) {
  const path = Array.isArray(t.station?.path) ? t.station.path : [];
  const pos = t.position;
  const local = localOf(t.ticket_id);
  return (
    <Section title="Position" hint="Where Baton holds it">
      {pos ? (
        <KeyValues rows={[
          ['Station', <Text mono value={pos.station} />],
          ['Path', path.length ? <ol className="tp-path">{path.map((s, i) => <li key={i}><Text mono value={s.leg} /> <span className="mut">→</span> <Text mono value={s.reached} /></li>)}</ol> : <span className="mut">no leg run yet</span>],
          ['Queued leg', pos.next_leg ? <><Text mono value={pos.next_leg} />{pos.next_source ? <span className="mut"> · named by <Text value={pos.next_source} /></span> : null}</> : <span className="mut">none — an end station</span>],
          ...(t.station?.handoff_url ? [['Hand-off', <ExtLink href={t.station.handoff_url} showHost />] as const] : []),
        ]} />
      ) : <Empty>The head snapshot places this ticket at no station.</Empty>}
      <p className="tp-cli mut">Routing and adopting are the CLI’s:</p>
      <p className="tp-cli"><CliLine>baton ticket route {local} &lt;leg&gt;</CliLine></p>
      <p className="tp-cli"><CliLine>baton ticket adopt {local} …</CliLine></p>
    </Section>
  );
}

// ── claim ────────────────────────────────────────────────────────────────────────────────

function ClaimSection({ t, repository }: { t: TicketShow; repository: string }) {
  const now = useClock();
  const c = t.claim;
  const attempts = Array.isArray(t.attempts) ? t.attempts : [];
  const local = localOf(t.ticket_id);
  return (
    <Section title="Claim" hint="The live claim, and the failed attempts before it">
      {c ? (
        <div className="tp-claim">
          <KeyValues rows={[
            ['Runner', <RunnerLink runner={c} repository={repository} />],
            ['Leg', c.leg ? <><Text mono value={c.leg} />{c.run_id ? <span className="mut"> · run <Text mono value={c.run_id} /></span> : null}</> : dash],
            ['Running for', <>{span(Math.max(0, now - c.claimed_at))}{c.stalled ? <> <StatusMark tone="warn" label="stalled" /></> : null}{c.alive === false ? <> <StatusMark tone="bad" label="runner silent" /></> : null}</>],
            ['Lease', <LeaseBar from={c.claimed_at} to={c.lease_ends_at} />],
            ['Deadline', c.deadline_at != null ? <><UtcTime at={c.deadline_at} /> <span className="mut">(<RelTime at={c.deadline_at} />)</span></> : <span className="mut">none</span>],
            ['Attempt', <><Text value={c.attempt} /> of <Text value={c.max_runs} />{c.next_backoff_until != null ? <span className="mut"> · backing off until <UtcTime at={c.next_backoff_until} /></span> : null}</>],
            ['Session', c.session_url ? <ExtLink href={c.session_url} kind="session" showHost /> : <span className="mut">none reported</span>],
            ['Log directory', c.log_dir ? <Text mono value={c.log_dir} /> : <span className="mut">none set</span>],
          ]} />
          {c.leg ? <p className="tp-cli"><CliLine>baton leg log {local} {c.leg}</CliLine></p> : null}
        </div>
      ) : <Empty>No runner holds this ticket.</Empty>}
      {t.fence ? <Band tone="warn">A reaped claim’s fence is pending: claim <Text mono value={t.fence.claim_id} /> of <Text value={t.fence.hostname} />{t.fence.since != null ? <>, reaped <RelTime at={t.fence.since} /></> : null}. Nothing claims the ticket until the runner reports the fence or an administrator clears it.</Band> : null}
      {attempts.length ? (
        <Table
          label="Earlier attempts"
          rows={attempts}
          rowKey={(a) => a.claim_id}
          columns={[
            { head: 'Attempt', cell: (a) => <Text value={a.run} />, rowHeader: true },
            { head: 'Runner', cell: (a) => <RunnerLink runner={a} repository={repository} /> },
            { head: 'Started', cell: (a) => <RelTime at={a.started_at} /> },
            { head: 'Ended', cell: (a) => <RelTime at={a.ended_at} /> },
            { head: 'End', cell: (a) => <Text mono value={a.end_reason ?? '—'} /> },
            { head: 'Detail', cell: (a) => (a.detail != null ? <Text value={a.detail} /> : dash) },
          ]}
        />
      ) : null}
      {t.resume ? (
        <p className="tp-resume mut">
          Last claim ended <Text mono value={t.resume.end_reason} /> <RelTime at={t.resume.ended_at} />
          {t.resume.branches?.length ? <> · branches {t.resume.branches.map((b, i) => <span key={b}>{i ? ', ' : ''}<Text mono value={b} /></span>)}</> : null}
          {t.resume.prs?.length ? <> · {t.resume.prs.map((p, i) => <span key={p}>{i ? ', ' : ''}<ExtLink href={p} /></span>)}</> : null}
        </p>
      ) : null}
    </Section>
  );
}

// ── why it cannot move ───────────────────────────────────────────────────────────────────

function Why({ read, repository }: { read: Read<BlocksAnswer>; repository: string }) {
  const blocks = Array.isArray(read.data?.blocks) ? read.data.blocks : [];
  const other = Array.isArray(read.data?.other) ? read.data.other : [];
  return (
    <Section title="Why it cannot move" count={read.data ? blocks.length + other.length : undefined} hint="Blocks, and what else keeps it from being offered">
      {read.data === undefined ? (read.error ? <ErrorNote error={read.error} what="The blocks read" /> : <Loading />) : (
        <>
          <Table<Block>
            label="Blocks"
            rows={blocks}
            rowKey={(b, i) => `${b.kind} ${b.ref} ${b.leg ?? ''} ${i}`}
            empty="No block holds this ticket."
            columns={[
              { head: 'Kind', cell: (b) => <Text value={b.kind} />, rowHeader: true },
              { head: 'On', cell: (b) => (b.kind === 'ticket' ? <TicketLink id={b.ref} repository={repository} /> : <Text mono value={b.ref} />) },
              { head: 'Leg', cell: (b) => (b.leg ? <Text mono value={b.leg} /> : <span className="mut">every leg</span>) },
              { head: 'Since', cell: (b) => <RelTime at={b.since} /> },
              { head: 'Until', cell: (b) => (b.until != null ? <RelTime at={b.until} /> : dash) },
            ]}
          />
          {other.length ? (
            <Table
              label="What else keeps it from being offered"
              rows={other}
              rowKey={(o, i) => `${o.kind} ${i}`}
              columns={[
                { head: 'Also', cell: (o) => <Text value={o.kind} />, rowHeader: true },
                { head: 'Detail', cell: (o) => <JsonText value={o.detail} /> },
              ]}
            />
          ) : null}
        </>
      )}
      <NotBuiltNote what="The queued leg’s prerequisites" ticket="B-10" />
    </Section>
  );
}

// ── conditions and scope findings ────────────────────────────────────────────────────────

function Conditions({ t, repository }: { t: TicketShow; repository: string }) {
  const conditions = Array.isArray(t.conditions) ? t.conditions : [];
  const scope = Array.isArray(t.scope) ? t.scope : [];
  return (
    <Section title="Open conditions and scope findings" count={conditions.length + scope.length} tone={conditions.length + scope.length ? 'warn' : 'mut'}>
      <Table
        label="Open conditions"
        rows={conditions}
        rowKey={(c) => c.condition_id}
        empty="No condition is open on this ticket."
        columns={[
          { head: 'Condition', rowHeader: true, cell: (c) => {
            const to = pathOrNull('repository/conditions/{condition}', { repository, condition: String(c.condition_id) });
            return to ? <Link to={to}><Text mono value={c.condition_id} /></Link> : <Text mono value={c.condition_id} />;
          } },
          { head: 'Type', cell: (c) => <Text mono value={c.type} /> },
          { head: 'Leg', cell: (c) => (c.leg ? <Text mono value={c.leg} /> : dash) },
          { head: 'Severity', cell: (c) => <Text value={c.severity ?? '—'} /> },
          { head: 'Restarts', cell: (c) => (c.restarts?.length ? <>{c.restarts.map((r, i) => <span key={r}>{i ? ', ' : ''}<Text mono value={r} /></span>)} <span className="mut">· resolve on its page</span></> : <span className="mut">none offered</span>) },
        ]}
      />
      {scope.length ? (
        <Table
          label="Open scope findings"
          rows={scope}
          rowKey={(f) => f.id}
          columns={[
            { head: 'Finding', cell: (f) => <Text mono value={f.id} />, rowHeader: true },
            { head: 'Kind', cell: (f) => <Text value={f.kind} /> },
            { head: 'Target', cell: (f) => <Text mono value={f.target} /> },
            { head: 'Ref', cell: (f) => (f.ref != null ? <Text mono value={f.ref} /> : dash) },
            { head: 'Raised', cell: (f) => <RelTime at={f.at} /> },
            { head: '', cell: (f) => <AcknowledgeFinding finding={f.id} repository={repository} ticket={t.ticket_id} /> },
          ]}
        />
      ) : null}
    </Section>
  );
}

// ── history ──────────────────────────────────────────────────────────────────────────────

function History({ base }: { base: string }) {
  const [befores, setBefores] = useState<number[]>([]);
  const reads = useReads([`${base}/history`, ...befores.map((b) => `${base}/history?before=${b}`)]) as Read<HistoryAnswer>[];
  const rows: HistoryRow[] = [];
  const seen = new Set<number>();
  for (const r of reads) for (const row of Array.isArray(r.data?.rows) ? r.data.rows : []) if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
  const last = reads[reads.length - 1];
  const next = typeof last?.data?.next_before === 'number' ? last.data.next_before : null;
  const first = reads[0];
  return (
    <Section title="History" count={first.data ? rows.length : undefined} hint="Newest first">
      {first.data === undefined ? (first.error ? <ErrorNote error={first.error} what="The history read" /> : <Loading />) : (
        <>
          <Table<HistoryRow>
            label="History"
            rows={rows}
            rowKey={(r) => r.id}
            empty="Nothing has happened to this ticket yet."
            columns={[
              { head: 'When', cell: (r) => <RelTime at={r.at} />, rowHeader: true },
              { head: 'Kind', cell: (r) => <Text mono value={r.kind} /> },
              { head: 'Leg', cell: (r) => (r.leg ? <><Text mono value={r.leg} />{r.run != null ? <span className="mut"> · run <Text value={r.run} /></span> : null}{r.run_id ? <span className="mut"> · <Text mono value={r.run_id} /></span> : null}</> : dash) },
              { head: 'Reached', cell: (r) => (r.reached ? <Text mono value={r.reached} /> : dash) },
              { head: 'Next leg', cell: (r) => (r.next_leg ? <Text mono value={r.next_leg} /> : dash) },
              { head: 'Rationale', cell: (r) => r.rationale === undefined ? dash : <JsonText value={r.rationale} /> },
              { head: 'Inputs and outputs', cell: (r) => {
                const d = isObj(r.detail) ? r.detail : null;
                const inputs = r.inputs ?? d?.inputs;
                const outputs = d?.outputs;
                const rest = d ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'inputs' && k !== 'outputs')) : r.detail;
                return (
                  <>
                    <Pointers list={inputs} />
                    <Pointers list={outputs} />
                    {rest != null && !(isObj(rest) && Object.keys(rest).length === 0) ? <JsonText value={rest} /> : null}
                    {!Array.isArray(inputs) && !Array.isArray(outputs) && (rest == null || (isObj(rest) && Object.keys(rest).length === 0)) ? dash : null}
                  </>
                );
              } },
            ]}
          />
          {next !== null ? <p className="tk-foot"><button type="button" className="btn" onClick={() => setBefores((b) => (b.includes(next) ? b : [...b, next]))}>Earlier</button></p> : null}
        </>
      )}
    </Section>
  );
}

// ── children ─────────────────────────────────────────────────────────────────────────────

function Children({ read, repository }: { read: Read<ChildrenAnswer>; repository: string }) {
  const rows = Array.isArray(read.data?.children) ? read.data.children : [];
  return (
    <Section title="Children" count={read.data ? rows.length : undefined}>
      {read.data === undefined ? (read.error ? <ErrorNote error={read.error} what="The children read" /> : <Loading />) : (
        <Table
          label="Children"
          rows={rows}
          rowKey={(c) => c.ticket_id}
          empty="This ticket has no children."
          columns={[
            { head: 'Ticket', cell: (c) => <TicketLink id={c.ticket_id} repository={repository} />, rowHeader: true },
            { head: 'Station', cell: (c) => (c.closed ? <span className="mut">closed as <Text mono value={c.closed.as} /> <RelTime at={c.closed.closed_at} /></span> : c.station ? <Text mono value={c.station} /> : dash) },
            { head: 'Blocked', cell: (c) => (c.blocked ? <StatusMark tone="warn" label="blocked" /> : <span className="mut">no</span>) },
          ]}
        />
      )}
    </Section>
  );
}

// ── leg runs ─────────────────────────────────────────────────────────────────────────────

/** The legs whose runs the page reads: those the path names, the queued one and the claim's,
 *  each once, in that order. */
export function legsOf(t: Pick<TicketShow, 'station' | 'position' | 'claim'>): string[] {
  const out: string[] = [];
  const add = (leg: unknown) => {
    if (typeof leg === 'string' && leg !== '' && !out.includes(leg)) out.push(leg);
  };
  for (const s of Array.isArray(t.station?.path) ? t.station.path : []) add(s?.leg);
  add(t.claim?.leg);
  add(t.position?.next_leg);
  return out;
}

function Runs({ base, legs, repository }: { base: string; legs: string[]; repository: string }) {
  const reads = useReads(legs.map((leg) => `${base}/legs/${encodeURIComponent(leg)}/runs`)) as Read<RunsAnswer>[];
  const rows: (LegRun & { _leg: string })[] = [];
  reads.forEach((r, i) => {
    for (const run of Array.isArray(r.data?.runs) ? r.data.runs : []) rows.push({ ...run, _leg: legs[i] });
  });
  const failed = reads.find((r) => r.error && r.data === undefined);
  const waiting = reads.some((r) => r.data === undefined && !r.error);
  return (
    <Section title="Leg runs" count={waiting ? undefined : rows.length} hint="Each run of each leg on the path">
      {legs.length === 0 ? <Empty>No leg has run and none is queued.</Empty> : (
        <>
          {failed?.error ? <ErrorNote error={failed.error} what="A leg’s runs" /> : null}
          {waiting && rows.length === 0 ? <Loading /> : (
            <Table
              label="Leg runs"
              rows={rows}
              rowKey={(r, i) => `${r._leg} ${r.run} ${i}`}
              empty="No run of these legs is recorded."
              columns={[
                { head: 'Leg', cell: (r) => <><Text mono value={r._leg} /> <span className="mut">run <Text value={r.run} /></span></>, rowHeader: true },
                { head: 'Run id', cell: (r) => (r.run_id ? <Text mono value={r.run_id} /> : dash) },
                { head: 'Runner', cell: (r) => (typeof r.runner === 'number' ? <RunnerLink runner={{ runner_id: r.runner, hostname: `runner ${r.runner}` }} repository={repository} /> : dash) },
                { head: 'Started', cell: (r) => <RelTime at={r.started_at} /> },
                { head: 'Ended', cell: (r) => (r.ended_at != null ? <RelTime at={r.ended_at} /> : <span className="mut">running</span>) },
                { head: 'End', cell: (r) => (r.end ? <Text mono value={r.end} /> : dash) },
                { head: 'Session', cell: (r) => (r.session_url ? <ExtLink href={r.session_url} kind="session" showHost /> : dash) },
                { head: 'Logs and transcripts', cell: (r) => (
                  <>
                    {r.log_dir ? <Text mono value={r.log_dir} /> : null}
                    {Array.isArray(r.transcripts) ? r.transcripts.map((x, i) => <div key={i}><Text mono value={`${x.repo ?? ''}:${x.path ?? ''}`} /></div>) : null}
                    {!r.log_dir && !(Array.isArray(r.transcripts) && r.transcripts.length) ? dash : null}
                  </>
                ) },
              ]}
            />
          )}
        </>
      )}
    </Section>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────────────────

function Body({ t, base, repository, blocks, kids }: { t: TicketShow; base: string; repository: string; blocks: Read<BlocksAnswer>; kids: Read<ChildrenAnswer> }) {
  const title: ReactNode = <><Text mono value={t.ticket_id} />{t.title != null ? <span className="tp-title"> <Text value={t.title} /></span> : null}</>;
  return (
    <>
      <PageHeader title={title} sub={<Link to={pathOf('repository/tickets', { repository })}>All tickets</Link>} />
      <TicketControls ticket={t} repository={repository} />
      <Head t={t} repository={repository} />
      <Position t={t} />
      <ClaimSection t={t} repository={repository} />
      <Why read={blocks} repository={repository} />
      <Conditions t={t} repository={repository} />
      <History base={base} />
      <Children read={kids} repository={repository} />
      <Runs base={base} legs={legsOf(t)} repository={repository} />
    </>
  );
}

export function TicketPage({ params }: ScreenProps) {
  const repository = params.repository;
  const base = `/v1/repositories/${encodeURIComponent(repository)}/tickets/${encodeURIComponent(params.ticket)}`;
  const show = useRead<TicketShow>(base);
  const [blocks, kids] = useReads([`${base}/blocks`, `${base}/children`]) as [Read<BlocksAnswer>, Read<ChildrenAnswer>];
  return (
    <ReadGate<TicketShow> read={show} entity="ticket" id={params.ticket} back={{ to: pathOf('repository/tickets', { repository }), label: 'All tickets' }}>
      {(t) => <Body t={t} base={base} repository={repository} blocks={blocks} kids={kids} />}
    </ReadGate>
  );
}
