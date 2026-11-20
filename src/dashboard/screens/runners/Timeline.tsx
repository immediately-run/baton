// Timeline.tsx — a runner's window as a drawing (B-211 item 2): one lane, time left to right
// from `since` to the read's instant with hour ticks, each claim a bar marked and labelled by
// how it ended — the word first, the colour second — its activities nested under it by their
// parent chain, a failed one marked by shape. SVG built as elements with text children only
// (§12.3). Every bar and segment is a focusable group with a name of its own; choosing one
// opens its panel. The same claims and activities are a table under the drawing.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, pathOrNull } from '../../app/router';
import { span, utc } from '../../lib/format';
import { ExtLink } from '../../lib/links';
import { Text, textOf } from '../../lib/Text';
import { timelineLayout } from '../../lib/timeline';
import { JsonText } from '../../lib/View';
import { CliLine, Empty, KeyValues, Table, UtcTime } from '../../lib/ui';
import { localOf, type WindowActivity, type WindowClaim } from './types';

export const ENDS = ['running', 'released', 'silent', 'reaped', 'done', 'suspended'] as const;
const GLYPH: Record<string, string> = { running: '●', released: '○', silent: '◆', reaped: '✕', done: '✓', suspended: '‖' };
const endClass = (end: unknown): string => (typeof end === 'string' && (ENDS as readonly string[]).includes(end) ? end : 'other');
const failed = (a: WindowActivity) => a.outcome === 'failed';

const W = 1000;
const PAD = 12;
const TOP = 22;
const BAR = 20;
const SEG = 9;

type Picked = { claim: WindowClaim; activity: WindowActivity | null };

const tickLabel = (at: number, step: number): string => {
  const iso = new Date(at).toISOString();
  return step >= 86_400_000 ? iso.slice(5, 10) : step >= 3_600_000 && iso.slice(11, 16) === '00:00' ? iso.slice(5, 10) : iso.slice(11, 16);
};

export function claimName(c: WindowClaim): string {
  return `claim on ${textOf(c.ticket_id)}${c.leg != null ? `, leg ${textOf(c.leg)}` : ''}: ${textOf(c.end)}, from ${utc(c.started_at)}${c.ended_at != null ? ` to ${utc(c.ended_at)}` : ', still running'}`;
}
export function activityName(a: WindowActivity, c: WindowClaim): string {
  return `activity ${textOf(a.kind)}${a.label != null ? ` ${textOf(a.label)}` : ''} on ${textOf(c.ticket_id)}: ${a.outcome != null ? textOf(a.outcome) : 'open'}, from ${utc(a.started_at)}`;
}

function Panel({ repository, picked, notBuilt }: { repository: string; picked: Picked; notBuilt?: Record<string, string> }) {
  const { claim, activity } = picked;
  const to = pathOrNull('repository/tickets/{ticket}', { repository, ticket: localOf(textOf(claim.ticket_id)) });
  const ticket = to ? <Link to={to}><Text mono value={claim.ticket_id} /></Link> : <Text mono value={claim.ticket_id} />;
  const rows: [string, ReactNode][] = activity
    ? [
      ['activity', <><Text mono value={activity.kind} />{activity.label != null ? <> · <Text value={activity.label} /></> : null}</>],
      ['ticket', ticket],
      ['started', <UtcTime at={activity.started_at} />],
      ['ended', activity.ended_at != null ? <UtcTime at={activity.ended_at} /> : <span className="mut">open</span>],
      ['outcome', activity.outcome != null ? <Text value={activity.outcome} /> : <span className="mut">none yet</span>],
      ['source', <Text mono value={activity.source} />],
      ['detail', activity.detail != null ? <JsonText value={activity.detail} /> : <span className="mut">none</span>],
    ]
    : [
      ['ticket', ticket],
      ['leg', claim.leg != null ? <Text mono value={claim.leg} /> : <span className="mut">none started</span>],
      ['end', <><Text value={claim.end} />{claim.end_reason != null ? <> (<Text mono value={claim.end_reason} />)</> : null}</>],
      ['started', <UtcTime at={claim.started_at} />],
      ['ended', claim.ended_at != null ? <UtcTime at={claim.ended_at} /> : <span className="mut">still running</span>],
      ['detail', claim.detail != null ? <Text value={claim.detail} /> : <span className="mut">none</span>],
    ];
  rows.push(
    ['session', claim.session_url != null ? <ExtLink href={claim.session_url} kind="session" showHost>Open session</ExtLink> : <span className="mut">no session link passed</span>],
    ['log', <>{claim.log_dir != null ? <Text mono value={claim.log_dir} /> : <span className="mut">no log directory recorded</span>}{claim.leg != null ? <> · <CliLine>baton leg log <Text value={claim.ticket_id} /> <Text value={claim.leg} /></CliLine></> : null}</>],
    ['executor', <span className="mut">digest, environment and instance are not recorded{notBuilt?.executor ? <> (<Text mono value={notBuilt.executor} />)</> : null}</span>],
  );
  return (
    <div className="tl-panel" role="region" aria-label="The chosen segment">
      <KeyValues rows={rows} />
    </div>
  );
}

export function Timeline({ repository, window, notBuilt }: { repository: string; window: { since: number; until: number; claims: WindowClaim[] }; notBuilt?: Record<string, string> }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const claims = Array.isArray(window.claims) ? window.claims : [];
  const layout = timelineLayout<WindowActivity, WindowClaim>(window, claims, W - 2 * PAD);
  const height = TOP + BAR + Math.max(1, layout.depth) * (SEG + 3) + 26;
  const onKey = (p: Picked) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    setPicked(p);
  };
  // The panel follows the latest answer: the chosen claim and activity are found again by id.
  const live = picked ? claims.find((c) => c.claim_id === picked.claim.claim_id) : undefined;
  const shown: Picked | null = picked && live ? { claim: live, activity: picked.activity ? live.activities.find((a) => a.id === picked.activity!.id) ?? null : null } : null;
  const flat = claims.flatMap((c) => [{ claim: c, activity: null as WindowActivity | null }, ...(c.activities ?? []).map((a) => ({ claim: c, activity: a as WindowActivity | null }))]);
  return (
    <div className="tl">
      {claims.length === 0 ? <Empty>No claim on this repository in the window.</Empty> : (
        <>
          <div className="tl-box">
            <svg className="tl-svg" viewBox={`0 0 ${W} ${height}`} role="group" aria-label={`Timeline from ${utc(window.since)} to ${utc(window.until)}`}>
              <rect className="tl-lane" x={PAD} y={TOP - 4} width={W - 2 * PAD} height={height - TOP - 18} rx={5} />
              {layout.ticks.map((t) => (
                <g key={t.at} className="tl-tick">
                  <line x1={PAD + t.x} y1={TOP - 4} x2={PAD + t.x} y2={height - 22} />
                  <text x={PAD + t.x} y={height - 6} textAnchor="middle">{tickLabel(t.at, layout.step)}</text>
                </g>
              ))}
              <text className="tl-now" x={W - PAD} y={12} textAnchor="end">now</text>
              {layout.bars.map((b) => {
                const end = endClass(b.claim.end);
                const label = `${GLYPH[end] ?? '·'} ${localOf(textOf(b.claim.ticket_id))} ${textOf(b.claim.end)}`;
                return (
                  <g key={b.claim.claim_id}>
                    <g className={`tl-bar tl-end-${end}`} role="button" tabIndex={0} aria-label={claimName(b.claim)}
                      aria-pressed={shown?.claim.claim_id === b.claim.claim_id && !shown.activity}
                      onClick={() => setPicked({ claim: b.claim, activity: null })} onKeyDown={onKey({ claim: b.claim, activity: null })}>
                      <rect x={PAD + b.x} y={TOP} width={b.width} height={BAR} rx={4} />
                      {b.width > label.length * 6.4 + 8 ? <text x={PAD + b.x + 5} y={TOP + 14}>{label}</text> : <text x={PAD + b.x + Math.min(b.width, 10) / 2} y={TOP + 14} textAnchor="middle">{b.width >= 10 ? GLYPH[end] ?? '·' : ''}</text>}
                    </g>
                    {b.segments.map((s) => {
                      const y = TOP + BAR + 3 + s.depth * (SEG + 3);
                      const bad = failed(s.activity);
                      return (
                        <g key={s.activity.id} className={`tl-seg${bad ? ' tl-seg-failed' : ''}${s.activity.ended_at == null ? ' tl-seg-open' : ''}`} role="button" tabIndex={0}
                          aria-label={activityName(s.activity, b.claim)}
                          aria-pressed={shown?.activity?.id === s.activity.id && shown.claim.claim_id === b.claim.claim_id}
                          onClick={() => setPicked({ claim: b.claim, activity: s.activity })} onKeyDown={onKey({ claim: b.claim, activity: s.activity })}>
                          <rect x={PAD + s.x} y={y} width={s.width} height={SEG} rx={2} />
                          {bad ? <path d={`M${PAD + s.x + s.width / 2 - 3},${y + 1.5} l6,6 m0,-6 l-6,6`} /> : null}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
          <ul className="tl-legend" aria-label="Legend">
            {ENDS.map((e) => <li key={e} className={`tl-key tl-end-${e}`}><span aria-hidden="true">{GLYPH[e]}</span> claim, {e}</li>)}
            <li className="tl-key tl-key-seg">▮ activity</li>
            <li className="tl-key tl-key-failed">✕ activity, failed</li>
          </ul>
          {shown ? <Panel repository={repository} picked={shown} notBuilt={notBuilt} /> : <p className="mut tl-hint">Choose a bar or a segment for its detail.</p>}
          <Table
            label="The window’s claims and activities"
            rows={flat}
            rowKey={(r) => `${r.claim.claim_id}:${r.activity?.id ?? ''}`}
            columns={[
              { head: 'What', cell: (r) => (r.activity ? <span className="tl-nested">activity <Text mono value={r.activity.kind} /></span> : <strong>claim</strong>) },
              { head: 'Ticket · leg / label', rowHeader: true, cell: (r) => (r.activity
                ? (r.activity.label != null ? <Text value={r.activity.label} /> : <span className="mut">—</span>)
                : <><Text mono value={r.claim.ticket_id} />{r.claim.leg != null ? <> · <Text mono value={r.claim.leg} /></> : null}</>) },
              { head: 'Started', cell: (r) => <UtcTime at={r.activity ? r.activity.started_at : r.claim.started_at} /> },
              { head: 'Lasted', cell: (r) => {
                const from = r.activity ? r.activity.started_at : r.claim.started_at;
                const to = r.activity ? r.activity.ended_at : r.claim.ended_at;
                return to != null ? span(to - from) : <span className="mut">open</span>;
              } },
              { head: 'End / outcome', cell: (r) => (r.activity
                ? (r.activity.outcome != null ? <span className={failed(r.activity) ? 'tone-bad' : undefined}>{failed(r.activity) ? '✕ ' : ''}<Text value={r.activity.outcome} /></span> : <span className="mut">open</span>)
                : <><span aria-hidden="true">{GLYPH[endClass(r.claim.end)] ?? '·'} </span><Text value={r.claim.end} /></>) },
              { head: 'Detail', cell: (r) => <button type="button" className="btn btn-quiet" onClick={() => setPicked(r)}>Show</button> },
            ]}
          />
        </>
      )}
    </div>
  );
}
