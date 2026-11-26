// CoursePage.tsx — `/repositories/{r}/courses/{course}` (B-223): the course's graph large;
// choosing an edge opens the leg's panel — its fields, its blocked tickets by kind and when the
// block was found (R-BTN-126), its window's runs with session links only as the server passed
// them and log directories as text (R-BTN-128) — and choosing a station opens its resting
// tickets. Below: the tickets on the course, loaded a page at a time by cursor; the off-graph
// rows; the stats tables. `?since=` in the URL is the window. Read-only; every value is
// `course.show`'s text (§12.3) and every station, leg and course name is data.
import { useEffect, useState } from 'react';
import { ReadGate } from '../../app/Refusal';
import { Link, pathOf, pathOrNull, useSearch } from '../../app/router';
import { ExtLink } from '../../lib/links';
import { useRead, useReads, type Read } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { CliLine, KeyValues, PageHeader, RelTime, Section, Table, UtcTime } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { WindowPicker } from '../runners/RunnerScreen';
import { sinceOf, windowWords } from '../runners/types';
import { CourseGraph, queueWords, type Picked } from './CourseGraph';
import { RefusedNotice } from './CoursesScreen';
import { LegTable } from './LegTable';
import { fileLeg, localOf, seconds, type CourseAnswer, type CourseLeg, type CourseStation, type CourseTicket, type Durations } from './types';
import './courses.css';

function TicketLink({ repository, id }: { repository: string; id: string }) {
  const to = pathOrNull('repository/tickets/{ticket}', { repository, ticket: localOf(String(id)) });
  return to ? <Link to={to}><Text mono value={id} /></Link> : <Text mono value={id} />;
}
const TicketList = ({ repository, ids }: { repository: string; ids: readonly string[] }) =>
  <>{ids.map((id, i) => <span key={id}>{i ? ', ' : ''}<TicketLink repository={repository} id={id} /></span>)}</>;

function LegPanel({ repository, file, leg }: { repository: string; file: unknown; leg: CourseLeg }) {
  const f = fileLeg(file, leg.leg);
  const runs = leg.runs ?? [];
  return (
    <div className="course-panel" role="region" aria-label="The chosen leg">
      <h3>Leg <Text mono value={leg.leg} /></h3>
      <KeyValues rows={[
        ['from → to', <><Text value={leg.from.join(', ')} /> → <Text value={leg.to.join(', ')} /></>],
        ['kind', f.kind != null ? <Text mono value={f.kind} /> : <span className="mut">a runner’s leg</span>],
        ['requires', f.requires.length ? <ul className="chips">{f.requires.map((r) => <li key={r} className="chip"><Text value={r} /></li>)}</ul> : <span className="mut">nothing</span>],
        ['max runs', f.maxRuns ?? <span className="mut">no bound</span>],
        ['timeout', f.timeoutS != null ? seconds(f.timeoutS) : <span className="mut">none</span>],
        ['outputs', f.outputs.length ? <Text mono value={f.outputs.join(', ')} /> : <span className="mut">none named</span>],
        ['queue', queueWords(leg) ?? <>{leg.queue.depth} queued, no bound</>],
      ]} />
      <h4>Blocked tickets</h4>
      <Table
        label="Blocked tickets of the leg, by kind and when found"
        rows={leg.state.blocked}
        rowKey={(b) => `${b.kind}:${b.found}`}
        empty="No ticket is blocked on this leg."
        columns={[
          { head: 'Block', rowHeader: true, cell: (b) => <>▲ <Text mono value={b.kind} /></> },
          { head: 'Found', cell: (b) => (b.found === 'during' ? 'during a run' : 'before a start') },
          { head: 'Tickets', align: 'right', cell: (b) => b.count },
          { head: 'Which', cell: (b) => <TicketList repository={repository} ids={b.tickets ?? []} /> },
        ]}
      />
      <h4>Runs in the window</h4>
      <Table
        label="The leg’s runs in the window"
        rows={runs}
        rowKey={(r) => `${r.claim}:${r.run_id ?? r.started_at}`}
        empty="No run of this leg in the window."
        columns={[
          { head: 'Run', rowHeader: true, cell: (r) => <><Text mono value={r.run} /> · <Text mono value={r.run_id} /></> },
          { head: 'Ticket', cell: (r) => <TicketLink repository={repository} id={r.ticket_id} /> },
          { head: 'Runner', cell: (r) => {
            const to = pathOrNull('repository/runners/{runner}', { repository, runner: String(r.runner) });
            const name = r.hostname != null ? <><Text value={r.hostname} /> / <Text value={r.session_name} /></> : <Text mono value={r.runner} />;
            return to ? <Link to={to}>{name}</Link> : name;
          } },
          { head: 'Started', cell: (r) => <UtcTime at={r.started_at} /> },
          { head: 'Ended', cell: (r) => (r.ended_at != null ? <UtcTime at={r.ended_at} /> : <span className="mut">running</span>) },
          { head: 'End', cell: (r) => <><Text value={r.outcome} />{r.end != null ? <> · <Text mono value={r.end} /></> : null}</> },
          { head: 'Session', cell: (r) => (r.session_url != null ? <ExtLink href={r.session_url} kind="session" showHost /> : <span className="mut">—</span>) },
          { head: 'Transcripts', cell: (r) => (r.transcripts?.length ? r.transcripts.map((t, i) => <span key={i}>{i ? ', ' : ''}<Text mono value={`${t.repo}:${t.path}`} /></span>) : <span className="mut">—</span>) },
          { head: 'Log', cell: (r) => <>{r.log_dir != null ? <Text mono value={r.log_dir} /> : <span className="mut">no directory recorded</span>} <CliLine>baton leg log <Text value={r.ticket_id} /> <Text value={r.leg} /></CliLine></> },
        ]}
      />
    </div>
  );
}

function StationPanel({ repository, station, tickets, more }: { repository: string; station: CourseStation; tickets: readonly CourseTicket[]; more: boolean }) {
  const here = tickets.filter((t) => t.station === station.station && t.claim_legs.length === 0);
  return (
    <div className="course-panel" role="region" aria-label="The chosen station">
      <h3>Station <Text mono value={station.station} /></h3>
      <p className="course-line">{station.resting} resting · {station.claimed} under a claim{station.end ? <> · {station.arrived_today} arrived in 24 h</> : null}</p>
      {here.length ? (
        <ul className="course-resting">
          {here.map((t) => <li key={t.ticket_id}><TicketLink repository={repository} id={t.ticket_id} /> <Text value={t.title} /></li>)}
        </ul>
      ) : <p className="empty">{station.resting ? 'Its resting tickets are on a page not loaded yet.' : 'No ticket rests here.'}</p>}
      {more && here.length < station.resting ? <p className="mut">Showing {here.length} of {station.resting}: load more tickets below for the rest.</p> : null}
    </div>
  );
}

const dur = (d: Durations | undefined) => (d && d.count ? <>{seconds(d.median_s)} <span className="mut">(max {seconds(d.max_s)}, n {d.count})</span></> : <span className="mut">—</span>);

function Body({ repository, course, first, since }: { repository: string; course: string; first: CourseAnswer; since: string | null }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  // The pages after the first, each read by the cursor the page before it gave.
  const [cursors, setCursors] = useState<string[]>([]);
  useEffect(() => setCursors([]), [since, course, repository]);
  const base = `/v1/repositories/${encodeURIComponent(repository)}/courses/${encodeURIComponent(course)}`;
  const query = (cursor: string) => `${base}?${since ? `since=${encodeURIComponent(since)}&` : ''}cursor=${encodeURIComponent(cursor)}`;
  const pages = useReads(cursors.map(query)) as Read<CourseAnswer>[];
  const loaded = pages.filter((p) => p.data !== undefined);
  const tickets = [...(first.tickets ?? []), ...loaded.flatMap((p) => p.data!.tickets ?? [])];
  const last = cursors.length === 0 ? first : pages[pages.length - 1]?.data;
  const next = last?.next_cursor;
  const pending = pages.length > loaded.length;
  const file = first.course.file;
  const leg = picked?.kind === 'leg' ? first.legs.find((l) => l.leg === picked.id) : undefined;
  const station = picked?.kind === 'station' ? first.stations.find((s) => s.station === picked.id) : undefined;
  const stats = first.stats.course;
  return (
    <>
      <RefusedNotice course={first} />
      <p className="course-line">
        runners <strong>{first.runners.declaring}</strong> declaring, <strong>{first.runners.alive}</strong> alive
        {' '}· {first.counts.tickets} tickets · window {windowWords(first.window.until - first.window.since)}
        {first.intake === 'closed' ? <span className="tone-warn"> · ▲ intake closed</span> : null}
      </p>
      {file != null ? (
        <CourseGraph file={file} stations={first.stations} legs={first.legs} size="large" picked={picked} onPick={setPicked} label={`Course ${course}: its stations and legs`} />
      ) : <p className="empty">No file of this course was ever accepted.</p>}
      {leg ? <LegPanel repository={repository} file={file} leg={leg} /> : station ? <StationPanel repository={repository} station={station} tickets={tickets} more={!!next} /> : (
        <p className="mut course-hint">Choose a leg for its runs and blocked tickets, or a station for the tickets resting there.</p>
      )}
      {first.runs_truncated ? <p className="mut">The window holds more runs than are listed: the newest are shown.</p> : null}

      <Section title="Legs">
        <LegTable file={file} legs={first.legs} onPick={(id) => setPicked({ kind: 'leg', id })} />
      </Section>
      <div className="course-stats">
      <Section title="Stations">
        <Table
          label="The course’s stations"
          rows={first.stations}
          rowKey={(s) => s.station}
          columns={[
            { head: 'Station', rowHeader: true, cell: (s) => <button type="button" className="btn btn-quiet" onClick={() => setPicked({ kind: 'station', id: s.station })}><Text mono value={s.station} /></button> },
            { head: 'Kind', cell: (s) => (s.start ? 'entry' : s.end ? 'end' : <span className="mut">—</span>) },
            { head: 'Resting', align: 'right', cell: (s) => s.resting },
            { head: 'Under a claim', align: 'right', cell: (s) => s.claimed },
            { head: 'Arrived in 24 h', align: 'right', cell: (s) => s.arrived_today },
            { head: 'Wait before a claim (p50)', align: 'right', cell: (s) => dur(stats?.stations?.[s.station]?.waited) },
          ]}
        />
      </Section>
      </div>

      <Section title="Tickets on the course" count={first.counts.tickets} hint="by station, then Baton’s order">
        <Table
          label="The tickets on the course"
          rows={tickets}
          rowKey={(t) => t.ticket_id}
          empty="No ticket is on this course."
          columns={[
            { head: 'Ticket', rowHeader: true, cell: (t) => <><TicketLink repository={repository} id={t.ticket_id} /> <Text value={t.title} /></> },
            { head: 'Station', cell: (t) => <Text mono value={t.station} /> },
            { head: 'Path', cell: (t) => (t.path.length ? t.path.map((p, i) => <span key={i} className="path-step">{i ? ' ' : ''}<Text mono value={p.leg} /> → <Text mono value={p.reached} /></span>) : <span className="mut">none yet</span>) },
            { head: 'Claim’s legs', cell: (t) => (t.claim_legs.length ? t.claim_legs.map((l, i) => <span key={i}>{i ? ', ' : ''}<Text mono value={l.leg} /> (<Text value={l.outcome} />)</span>) : <span className="mut">—</span>) },
            { head: 'Waits for', cell: (t) => (t.waits_for ? <><Text mono value={t.waits_for.leg} />: <Text value={t.waits_for.on} /></> : t.backing_off_until != null ? <>backoff, <RelTime at={t.backing_off_until} /></> : <span className="mut">—</span>) },
            { head: 'Hand-off', cell: (t) => (t.handoff != null ? <Text mono value={t.handoff} /> : <span className="mut">—</span>) },
            { head: 'Blocks', cell: (t) => (t.blocks.length ? t.blocks.map((b, i) => <span key={i}>{i ? ', ' : ''}▲ <Text mono value={b.kind} /> <Text value={b.ref} /></span>) : <span className="mut">—</span>) },
            { head: 'Queued leg', cell: (t) => (t.next_leg != null ? <><Text mono value={t.next_leg} /> <span className="mut">(<Text value={t.source} />)</span></> : <span className="mut">—</span>) },
            { head: 'Parent', cell: (t) => (t.parent != null ? <TicketLink repository={repository} id={t.parent} /> : <span className="mut">—</span>) },
            { head: 'Children', cell: (t) => (t.children.length ? <TicketList repository={repository} ids={t.children} /> : <span className="mut">—</span>) },
          ]}
        />
        <p className="course-more">
          <span className="mut">{tickets.length} of {first.counts.tickets} loaded</span>
          {next ? <button type="button" className="btn" disabled={pending} onClick={() => setCursors((c) => (c.includes(next) ? c : [...c, next]))}>More</button> : null}
          {pending ? <span className="mut" role="status">Loading…</span> : null}
        </p>
      </Section>

      <Section title="Off-graph transitions" count={first.off_graph.count} hint="in the window" tone={first.off_graph.count ? 'warn' : 'mut'}>
        {first.off_graph.tickets.length
          ? <ul className="course-resting">{first.off_graph.tickets.map((id) => <li key={id}>▲ <TicketLink repository={repository} id={id} /></li>)}</ul>
          : <p className="empty">None in the window.</p>}
      </Section>

      <div className="course-stats">
      <Section title="Stats" hint={<>the last {windowWords(first.window.until - first.window.since)}</>}>
        <h3 className="course-h3">Legs: waited and ran</h3>
        <Table
          label="Each leg’s wait and run times in the window"
          rows={Object.entries(stats?.legs ?? {})}
          rowKey={([id]) => id}
          empty="No leg ran or is queued in the window."
          columns={[
            { head: 'Leg', rowHeader: true, cell: ([id]) => <Text mono value={id} /> },
            { head: 'Started', align: 'right', cell: ([, l]) => l.started },
            { head: 'Finished', align: 'right', cell: ([, l]) => l.finished },
            { head: 'Given up', align: 'right', cell: ([, l]) => l.abandoned },
            { head: 'Waited (p50)', align: 'right', cell: ([, l]) => dur(l.waited) },
            { head: 'Ran (p50)', align: 'right', cell: ([, l]) => dur(l.ran) },
            { head: 'Ready now', align: 'right', cell: ([, l]) => <>{l.ready_now.tickets}{l.ready_now.oldest_s != null ? <span className="mut"> (oldest {seconds(l.ready_now.oldest_s)})</span> : null}</> },
          ]}
        />
        <h3 className="course-h3">Ends, by reason and detail</h3>
        <Table
          label="Claims ended in the window, by reason and detail"
          rows={first.stats.ends}
          rowKey={(e, i) => `${e.end_reason}:${e.detail ?? ''}:${i}`}
          empty="No claim ended in the window."
          columns={[
            { head: 'End', rowHeader: true, cell: (e) => <Text mono value={e.end_reason} /> },
            { head: 'Detail', cell: (e) => <Text value={e.detail} /> },
            { head: 'Claims', align: 'right', cell: (e) => e.claims },
          ]}
        />
        <h3 className="course-h3">Suspensions</h3>
        <Table
          label="Suspensions in the window, by station"
          rows={first.stats.suspensions}
          rowKey={(e, i) => `${e.station}:${e.detail ?? ''}:${i}`}
          empty="No claim was suspended in the window."
          columns={[
            { head: 'Station', rowHeader: true, cell: (e) => <Text mono value={e.station} /> },
            { head: 'Waiting on', cell: (e) => <Text value={e.detail} /> },
            { head: 'Claims', align: 'right', cell: (e) => e.claims },
          ]}
        />
        <p className="course-line">
          Advice overridden: {first.stats.advice_overridden.count}
          {first.stats.advice_overridden.tickets.length ? <> — <TicketList repository={repository} ids={first.stats.advice_overridden.tickets} /></> : null}
        </p>
        <p className="mut">The ends, suspensions and overrides are the repository’s, as its stats read gives them.</p>
      </Section>
      </div>
    </>
  );
}

export function CoursePage({ params }: ScreenProps) {
  const repository = params.repository;
  const course = params.course;
  const since = sinceOf(useSearch());
  const read = useRead<CourseAnswer>(`/v1/repositories/${encodeURIComponent(repository)}/courses/${encodeURIComponent(course)}${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  const list = pathOf('repository/courses', { repository });
  const here = pathOrNull('repository/courses/{course}', { repository, course }) ?? list;
  return (
    <ReadGate read={read} entity="course" id={course} back={{ to: list, label: 'Courses' }}>
      {(data) => (
        <>
          <PageHeader
            title={<>Course <Text mono value={data.course.id} /></>}
            sub={<>{data.course.version != null ? <>version <Text mono value={data.course.version} /></> : 'no version in force'} · <Link to={list}>all courses</Link></>}
          >
            <WindowPicker path={here} since={since} />
          </PageHeader>
          <Body repository={repository} course={course} first={data} since={since} />
        </>
      )}
    </ReadGate>
  );
}
