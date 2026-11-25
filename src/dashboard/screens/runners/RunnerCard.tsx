// RunnerCard.tsx — one runner as the mockup's card (B-211 item 1): the name line with the state
// as a mark and a word, what it declares and is granted, the claim block with its lease bar,
// attempt and current activity — or "idle since", or a dead runner's reap sentence — its newest
// status report, and the controls the registry places on the runner's screen. Every value is
// the read's text (§12.3); a capability is a name, matched by name (R-BTN-174).
import type { ReactNode } from 'react';
import { Controls } from '../../app/controls/Controls';
import { Link, pathOrNull } from '../../app/router';
import { span } from '../../lib/format';
import { ExtLink } from '../../lib/links';
import { Text } from '../../lib/Text';
import { JsonText } from '../../lib/View';
import { Card, CliLine, RelTime, StatusMark, UtcTime, type Tone } from '../../lib/ui';
import { localOf, type RunnerClaim, type RunnerRow } from './types';

/** §11.4: alive with a claim and no activity for this long is silent. */
export const SILENT_MS = 2 * 3_600_000;

export type RunnerState = 'working' | 'silent' | 'idle' | 'dead';
/** The order of a host's cards. */
export const STATE_ORDER: readonly RunnerState[] = ['working', 'silent', 'idle', 'dead'];

const MARK: Record<RunnerState, { tone: Tone; glyph: string; label: string }> = {
  working: { tone: 'ok', glyph: '●', label: 'Working' },
  silent: { tone: 'warn', glyph: '◆', label: 'Silent' },
  idle: { tone: 'mut', glyph: '○', label: 'Idle' },
  dead: { tone: 'bad', glyph: '✕', label: 'Dead' },
};

/** A runner's state at the read's own instant. */
export function stateOf(r: RunnerRow, now: number): RunnerState {
  if (!r.alive) return 'dead';
  if (!r.claim && !r.busy_elsewhere) return 'idle';
  if (!r.claim) return 'working';
  return now - (r.last_activity_at ?? r.claim.claimed_at) > SILENT_MS ? 'silent' : 'working';
}

function TicketLink({ repository, id }: { repository: string; id: string }) {
  const to = pathOrNull('repository/tickets/{ticket}', { repository, ticket: localOf(id) });
  return to ? <Link to={to}><Text mono value={id} /></Link> : <Text mono value={id} />;
}

/** The lease from the claim's start to its end, the read's instant marked, and what is left. */
export function LeaseBar({ claim, now }: { claim: RunnerClaim; now: number }) {
  if (claim.lease_ends_at == null) return <p className="mut">no lease: a legacy runner’s claim ends in git</p>;
  const total = Math.max(1, claim.lease_ends_at - claim.claimed_at);
  const at = Math.min(1, Math.max(0, (now - claim.claimed_at) / total));
  const left = claim.lease_ends_at - now;
  const words = left > 0 ? `lease ends in ${span(left)}` : `lease lapsed ${span(-left)} ago`;
  return (
    <div className="lease">
      <div className={`lease-bar${left > 0 ? '' : ' lease-lapsed'}`} role="img" aria-label={words}>
        <div className="lease-fill" style={{ width: `${Math.round(at * 100)}%` }} />
        <div className="lease-now" style={{ left: `${Math.round(at * 100)}%` }} />
      </div>
      <span className="lease-words">{words}</span>
    </div>
  );
}

function ClaimBlock({ repository, claim, now }: { repository: string; claim: RunnerClaim; now: number }) {
  return (
    <div className="claim-block">
      <p className="claim-line">
        <TicketLink repository={repository} id={claim.ticket_id} />
        {claim.leg != null ? <> · leg <Text mono value={claim.leg} /></> : <> · <span className="mut">no leg started</span></>}
        {' '}· running for {span(now - claim.claimed_at)}
      </p>
      <LeaseBar claim={claim} now={now} />
      <dl className="kv">
        {claim.attempt != null ? (
          <div className="kv-row"><dt>attempt</dt><dd>
            {claim.attempt}{claim.max_runs != null ? <> of {claim.max_runs}</> : null}
            {claim.next_backoff_until != null ? <> · backing off until <UtcTime at={claim.next_backoff_until} /></> : null}
          </dd></div>
        ) : null}
        {claim.deadline_at != null ? <div className="kv-row"><dt>deadline</dt><dd><RelTime at={claim.deadline_at} /></dd></div> : null}
        <div className="kv-row"><dt>activity</dt><dd>
          {claim.activity ? <><Text mono value={claim.activity.kind} />{claim.activity.label != null ? <> · <Text value={claim.activity.label} /></> : null} · since <RelTime at={claim.activity.started_at} /></> : <span className="mut">none reported</span>}
        </dd></div>
        <div className="kv-row"><dt>log</dt><dd>
          {claim.log_dir != null ? <Text mono value={claim.log_dir} /> : <span className="mut">no log directory recorded</span>}
          {claim.leg != null ? <> · <CliLine>baton leg log <Text value={claim.ticket_id} /> <Text value={claim.leg} /></CliLine></> : null}
        </dd></div>
        {claim.session_url != null ? (
          <div className="kv-row"><dt>session</dt><dd><ExtLink href={claim.session_url} kind="session" showHost /></dd></div>
        ) : null}
      </dl>
    </div>
  );
}

function Chips({ row }: { row: RunnerRow }) {
  const granted = new Set(row.granted ?? []);
  if (row.capabilities.length === 0) return <p className="mut chips-none">no capability on record</p>;
  return (
    <ul className="chips" aria-label="Capabilities declared">
      {row.capabilities.map((c) => (
        <li key={c.capability} className={`chip${granted.has(c.capability) ? ' chip-on' : ''}`}>
          <Text value={c.capability} />{granted.has(c.capability) ? <span className="chip-mark"> ✓ granted</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function RunnerCard({ repository, row, now, heading, notBuilt }: { repository: string; row: RunnerRow; now: number; heading?: ReactNode; notBuilt?: Record<string, string> }) {
  const state = stateOf(row, now);
  const mark = MARK[state];
  const page = pathOrNull('repository/runners/{runner}', { repository, runner: String(row.runner_id) });
  const name = <><Text value={row.hostname} /> / <Text value={row.session_name} /></>;
  const ceilings = Object.entries(row.tier_ceilings ?? {});
  const idle = state === 'idle';
  // Controls: the registry's entries for the runner's screen; Stop only where a claim is held.
  const target: Record<string, unknown> = { repository, to_runner_id: row.runner_id, ...(row.claim ? { ticket_id: row.claim.ticket_id, reason: 'requested' } : {}) };
  const allowed = row.reaped_at != null ? [] : row.claim ? null : ['runner.status-request', 'runner.wind-down'];
  return (
    <Card
      className={`runner-card runner-${state}`}
      title={heading ?? (page ? <Link to={page}>{name}</Link> : name)}
      aside={<StatusMark tone={mark.tone} glyph={mark.glyph} label={mark.label} />}
    >
      <p className="runner-line">
        <Text mono value={row.harness} /> · <Text mono value={row.kind} /> · <Text mono value={row.isolation} />
        {ceilings.length ? <> · ceiling {ceilings.map(([repo, tier], i) => <span key={repo}>{i ? ', ' : ''}<Text mono value={tier} /> on <Text mono value={repo} /></span>)}</> : null}
        {' '}· last seen <RelTime at={row.last_seen_at} />
        {row.last_report ? <> · last report <RelTime at={row.last_report.sent_at} /></> : null}
      </p>
      <Chips row={row} />
      {row.granted == null ? <p className="mut runner-note">A seed or bearer key: no grant binds it (<Text mono value={row.credential.kind} />).</p> : null}
      {row.claim ? <ClaimBlock repository={repository} claim={row.claim} now={now} /> : null}
      {row.claims.length > 1 ? (
        <p className="runner-note">and {row.claims.length - 1} more: {row.claims.slice(1).map((c, i) => <span key={c.claim_id}>{i ? ', ' : ''}<TicketLink repository={repository} id={c.ticket_id} /></span>)}</p>
      ) : null}
      {row.busy_elsewhere ? <p className="runner-note">working on another repository</p> : null}
      {idle ? <p className="runner-note">idle since <RelTime at={row.last_activity_at ?? row.last_seen_at} /></p> : null}
      {state === 'dead' ? (
        <p className="runner-note runner-reap">
          {row.reaped_at != null ? <>lost its heartbeat; reaped at <UtcTime at={row.reaped_at} /></> : <>lost its heartbeat: last seen <UtcTime at={row.last_seen_at} />, not reaped yet</>}
          {row.reaped_claim ? <>; its claim on <TicketLink repository={repository} id={row.reaped_claim.ticket_id} /> was reaped</> : null}
        </p>
      ) : null}
      {row.last_report ? (
        <div className="runner-report">
          <span className="mut">status report, <RelTime at={row.last_report.sent_at} /></span>
          <JsonText value={row.last_report.payload} />
        </div>
      ) : null}
      <p className="runner-line">
        {row.transcript_url != null ? <><ExtLink href={row.transcript_url} showHost>transcript</ExtLink> · </> : null}
        executor: <span className="mut">not recorded{notBuilt?.executor ? <> (<Text mono value={notBuilt.executor} />)</> : null}</span>
      </p>
      {/* A poll can retain the runner card but replace its claim. Discard the old Stop dialog. */}
      <Controls key={row.claim?.claim_id ?? 'idle'} view="repository/runners/{runner}" target={target} allowed={allowed} label={`Actions on runner ${row.runner_id}`} />
    </Card>
  );
}
