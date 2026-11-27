// SyncScreen.tsx — `/repositories/{r}/sync` (B-220; BATON_SPEC §4.3 R-BTN-11, R-BTN-62, §4.7
// R-BTN-85, §16.1 R-BTN-28): the mirror's view of one repository, from `repo.sync`, in this
// order — the mode, the head, the observation counter, the last post, what Baton dispatched,
// the held posts, the pending adoptions, and Discrepancies as the mockup's table. `?since=`
// (`1d`, `7d`, `30d`) is the URL's.
//
// Every control is a registry entry `ui.view` places here, drawn only where the read's
// `allowed` names it: Resync and Accept are one click; Cut over and Confirm adoption are
// destructive and open the confirm dialog, which sends `confirm: true` (§12.2) — what those
// routes take today. A forced resync onto a rewritten head is not built (R-BTN-11) and is no
// control: the page says so, and a rewritten history arrives as a held post to accept. The
// page holds no sync logic; every value is the read's text (§12.3), and the forge link is
// built from `web_base` alone (R-BTN-92).
import { FORGE_SHAPES, isForge } from '../../../core/forges';
import { useMemo } from 'react';
import { Controls } from '../../app/controls/Controls';
import { ReadGate } from '../../app/Refusal';
import { navigate, pathOrNull, useSearch, Link } from '../../app/router';
import { shortSha, span } from '../../lib/format';
import { ExtLink } from '../../lib/links';
import { useRead } from '../../lib/reads';
import { Text, textOf } from '../../lib/Text';
import type { RepoRow } from '../../lib/types';
import { Badge, Band, Empty, KeyValues, Mono, NotBuiltNote, PageHeader, RelTime, Section, StatusMark, Tabs, UtcTime, useClock } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { CardTable, queryOf, TicketLink, withQuery } from '../conditions/kit';

/** `repo.sync` (B-201). Every field is a read's value, untrusted beyond its shape. */
export interface SyncView {
  repository: string;
  head: { sha: string; parent_sha: string | null; received_at: number | null; ticket_count: number | null; observation: number; source: { kind: string; versions: string | null } | null } | null;
  observation: { last: number; last_handed_out: number; outstanding: { number: number; handed_out_at: number; age_s: number; void: boolean } | null };
  last_post: { at: number; sha: string | null; accepted: boolean; code?: string } | null;
  dispatch: {
    sync_workflow: string | null;
    mirror_workflow: string | null;
    last_sync_dispatch_at: number | null;
    window: { last_dispatch_at: number; trailing_at: number | null } | null;
    last_resync_request_at: number | null;
    last_refusal: { at: number; workflow: unknown; reason: unknown } | null;
  };
  held: { sha: string; parent_sha: string | null; head_sha: string | null; ticket_count: number; received_at: number; auto_accept_at: number; accepted_at: number | null }[];
  mode: { mode: string; cutover_at: number | null };
  adoptions?: Record<string, unknown>[];
  discrepancies: { since: number; by_kind: Record<string, number>; rows: Discrepancy[]; truncated: boolean };
  allowed: string[];
  not_built?: Record<string, string>;
}

export interface Discrepancy {
  id: number;
  ticket_id: string | null;
  claim_id: number | null;
  at: number;
  sub?: string;
  kind?: string;
  baton?: unknown;
  git?: unknown;
  observation?: number | null;
  reason?: unknown;
  workflow?: unknown;
}

/** R-BTN-62: an outstanding number is marked once it has waited this long — the sync that took
 *  it has not posted, and at ten minutes the number is void. */
export const OUTSTANDING_MARK_S = 600;

const WINDOWS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };
const HOUR = 3_600_000;

/** The read's `since` for a window: the hour's start, moved up — so the path is stable through
 *  an hour of polls and never reaches further back than the window. The default window is the
 *  read's own, and sends nothing. */
export function sinceOf(window: string, now: number): string | null {
  const days = WINDOWS[window];
  if (!days || window === '7d') return null;
  return new Date(Math.ceil((now - days * 86_400_000) / HOUR) * HOUR).toISOString();
}

/** A commit on the repository's forge, built from `web_base` (R-BTN-92); a plain `git`
 *  repository has no page for one. Drawn through `ExtLink`, which applies the link rule. */
export function commitHref(row: Pick<RepoRow, 'forge' | 'web_base'> | null, sha: unknown): string | null {
  if (!row || typeof row.web_base !== 'string' || typeof sha !== 'string' || !/^[0-9a-f]{7,64}$/.test(sha)) return null;
  const base = row.web_base.replace(/\/+$/, '');
  const commit = isForge(row.forge) ? FORGE_SHAPES[row.forge].commit : null;
  return commit ? `${base}${commit}${sha}` : null;
}

function Sha({ sha, row }: { sha: unknown; row: RepoRow | null }) {
  if (typeof sha !== 'string' || sha === '') return <span className="mut">—</span>;
  const href = commitHref(row, sha);
  return href ? <ExtLink href={href} showHost><Text mono value={shortSha(sha)} /></ExtLink> : <span title={sha}><Text mono value={shortSha(sha)} /></span>;
}

/** A value Baton held or git showed (R-BTN-85): a scalar as text, anything else as compact
 *  JSON — text either way. */
function Held({ value, struck }: { value: unknown; struck?: boolean }) {
  if (value === undefined || value === null) return <span className="mut">—</span>;
  return <span className={struck ? 'had' : undefined}><Text value={value} /></span>;
}

const only = (allowed: unknown, id: string): string[] => (Array.isArray(allowed) && allowed.includes(id) ? [id] : []);

function Body({ data, repository, row, window, onWindow }: { data: SyncView; repository: string; row: RepoRow | null; window: string; onWindow: (w: string) => void }) {
  const now = useClock();
  const shadow = data.mode?.mode === 'shadow';
  const out = data.observation?.outstanding ?? null;
  const late = out !== null && (out.void === true || out.age_s >= OUTSTANDING_MARK_S);
  const held = Array.isArray(data.held) ? data.held : [];
  const adoptions = Array.isArray(data.adoptions) ? data.adoptions : null;
  const disc = data.discrepancies ?? { since: 0, by_kind: {}, rows: [], truncated: false };
  const rows = Array.isArray(disc.rows) ? disc.rows : [];
  const kinds = Object.entries(disc.by_kind ?? {});
  const d = data.dispatch ?? ({} as SyncView['dispatch']);
  return (
    <>
      <Band tone={shadow ? 'warn' : 'mut'}>
        <div className="sync-line">
          {shadow ? <Badge title="Git holds this repository’s claims; Baton records them.">SHADOW</Badge> : <Badge tone="ok"><Text value={data.mode?.mode} /></Badge>}
          <span className="sync-grow">
            {shadow
              ? <>Git holds <Text mono value={repository} />’s claims, and Baton records them. Cutting over is one-way: Baton allocates its work from then on.</>
              : <>Baton allocates <Text mono value={repository} />’s work{data.mode?.cutover_at != null ? <> — cut over <RelTime at={data.mode.cutover_at} /></> : null}.</>}
          </span>
          <Controls view="repository/sync" allowed={only(data.allowed, 'repo.cutover')} target={{ repository }} label="Mode" />
        </div>
      </Band>

      <Section title="Head">
        <div className="sync-line">
          <span className="sync-grow">
            {data.head ? (
              <>
                <Sha sha={data.head.sha} row={row} /> · received <RelTime at={data.head.received_at} /> · <Text value={data.head.ticket_count} /> tickets
                {data.head.source ? <> · source <Text mono value={data.head.source.kind} />{data.head.source.versions ? <> (<Text mono value={data.head.source.versions} />)</> : null}</> : null}
              </>
            ) : <span className="mut">No board received yet: the repository’s sync has not posted.</span>}
          </span>
          <Controls view="repository/sync" allowed={only(data.allowed, 'repo.resync')} target={{ repository }} label="Resync" />
        </div>
        {d.sync_workflow ? null : <p className="mut">This repository registers no sync workflow: Baton has nothing to dispatch, and its sync runs where it is run.</p>}
        <p className="mut">
          Forcing the head onto a rewritten history is not built (<Mono>{data.not_built?.force_resync ?? 'R-BTN-11'}</Mono>): a rewritten history arrives below as a held post, and is accepted there.
        </p>
      </Section>

      <Section title="Observations" hint="The counter that orders what each sync saw.">
        <KeyValues rows={[
          ['last accepted', <Text mono value={data.observation?.last} />],
          ['last handed out', <Text mono value={data.observation?.last_handed_out} />],
          ['outstanding', out === null
            ? <span className="mut">none — every number handed out was posted</span>
            : (
              <StatusMark
                tone={late ? 'warn' : 'run'}
                label={<>number <Text mono value={out.number} />, handed out {span(out.age_s * 1000)} ago{out.void ? ' — void: the next sync takes a new one' : late ? ' — late' : ''}</>}
              />
            )],
        ]} />
      </Section>

      <Section title="Last post">
        {data.last_post ? (
          <p className="sync-line">
            <StatusMark tone={data.last_post.accepted ? 'ok' : 'warn'} label={data.last_post.accepted ? 'accepted' : 'refused and held'} />
            <Sha sha={data.last_post.sha} row={row} />
            <RelTime at={data.last_post.at} />
            {data.last_post.code ? <span><Text mono value={data.last_post.code} /> — a rewritten history is held until it is accepted, or for 24 hours</span> : null}
          </p>
        ) : <Empty>No post is recorded.</Empty>}
        <p className="mut">A post refused before it was judged — a lost race, a stale observation — leaves no record here.</p>
      </Section>

      <Section title="Dispatches" hint="What Baton asked the forge to run.">
        <KeyValues rows={[
          ['sync workflow', d.sync_workflow ? <Text mono value={d.sync_workflow} /> : <span className="mut">none</span>],
          ['mirror workflow', d.mirror_workflow ? <Text mono value={d.mirror_workflow} /> : <span className="mut">none</span>],
          ['last sync dispatch', <RelTime at={d.last_sync_dispatch_at} />],
          ['window', d.window ? <>opened <RelTime at={d.window.last_dispatch_at} />{d.window.trailing_at != null ? <> · a trailing dispatch <RelTime at={d.window.trailing_at} /></> : null}</> : <span className="mut">—</span>],
          ['last resync asked here', <RelTime at={d.last_resync_request_at} />],
          ['last refusal', d.last_refusal ? <><RelTime at={d.last_refusal.at} /> · <Text mono value={d.last_refusal.workflow} /> — <Text value={d.last_refusal.reason} /></> : <span className="mut">none in this window</span>],
        ]} />
        {data.not_built?.wants ? <NotBuiltNote what="The list of outstanding wants" ticket={data.not_built.wants} /> : null}
      </Section>

      <Section title="Held posts" count={held.length} tone={held.length ? 'warn' : 'mut'} hint="A rewritten history waits here; the head stands meanwhile.">
        {held.length === 0 ? <Empty>No post is held.</Empty> : (
          <ul className="needs-list">
            {held.map((h) => (
              <li className="needs-row" key={textOf(h.sha)}>
                <span className="needs-kind tone-warn"><span className="needs-glyph" aria-hidden="true">‖</span><span>{h.accepted_at != null ? 'Accepted' : 'Held'}</span></span>
                <div className="needs-main">
                  <div className="needs-title"><Sha sha={h.sha} row={row} /> over <Sha sha={h.head_sha} row={row} /> · <Text value={h.ticket_count} /> tickets</div>
                  <div className="needs-detail">
                    <span>received <RelTime at={h.received_at} /></span>
                    {h.accepted_at != null
                      ? <span>accepted <RelTime at={h.accepted_at} /> — the sync’s next post of it becomes the head</span>
                      : <span>accepted by itself <RelTime at={h.auto_accept_at} /> (<UtcTime at={h.auto_accept_at} />)</span>}
                  </div>
                </div>
                <div className="needs-act">
                  {h.accepted_at == null ? <Controls view="repository/sync" allowed={only(data.allowed, 'repo.accept-post')} target={{ repository, sha: h.sha }} label="Held post" /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {adoptions !== null ? (
        <Section title="Adoptions" count={adoptions.length} tone={adoptions.length ? 'warn' : 'mut'} hint="A session asks to take over a claim made in git.">
          {adoptions.length === 0 ? <Empty>No adoption is asked for.</Empty> : (
            <ul className="needs-list">
              {adoptions.map((a, i) => (
                <li className="needs-row" key={`${textOf(a.ticket_id)} ${i}`}>
                  <span className="needs-kind tone-warn"><span className="needs-glyph" aria-hidden="true">▲</span><span>Adoption asked for</span></span>
                  <div className="needs-main">
                    <div className="needs-title"><TicketLink id={a.ticket_id} repository={repository} /></div>
                    <div className="needs-detail">
                      <span>by <Text mono value={a.session_name} /> on <Text mono value={a.hostname} /> (runner <Text mono value={a.runner_id} />)</span>
                      <span>holding it now: <Text mono value={a.legacy_session} /></span>
                      <span>asked <RelTime at={a.requested_at} /></span>
                    </div>
                  </div>
                  <div className="needs-act">
                    <Controls view="repository/sync" allowed={only(data.allowed, 'adoption.confirm')} target={{ ticket: textOf(a.ticket_id), runner: textOf(a.session_name), claim: textOf(a.claim_id) }} label="Adoption" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="Discrepancies" count={rows.length} tone={rows.length ? 'warn' : 'mut'} hint="Where git overruled Baton.">
        <Tabs
          label="Window"
          value={window}
          onChange={onWindow}
          tabs={[{ id: '1d', label: '24 hours' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }]}
        />
        {kinds.length > 0 ? (
          <p className="mut">{kinds.map(([k, n], i) => <span key={k}>{i ? ' · ' : ''}<Text mono value={k} /> <Text value={n} /></span>)} since <UtcTime at={disc.since} /></p>
        ) : null}
        <CardTable
          label="Discrepancies"
          empty={`Git and Baton agreed since ${span(Math.max(0, now - disc.since))} ago.`}
          rows={rows}
          rowKey={(r, i) => `${textOf(r.id)} ${i}`}
          columns={[
            { head: 'Kind', rowHeader: true, cell: (r) => <Text mono value={r.sub ?? r.kind} /> },
            { head: 'Ticket', cell: (r) => {
              if (typeof r.ticket_id !== 'string') return <span className="mut">—</span>;
              const at = r.ticket_id.indexOf(':');
              const to = pathOrNull('repository/tickets/{ticket}', { repository, ticket: at > 0 ? r.ticket_id.slice(at + 1) : r.ticket_id });
              // The ticket page's history section holds the row this came from.
              return to ? <Link to={`${to}#history`}><Text mono value={r.ticket_id} /></Link> : <Text mono value={r.ticket_id} />;
            } },
            { head: 'Baton had', cell: (r) => (r.sub ? <Held value={r.baton} struck /> : <Held value={r.workflow} />) },
            { head: 'Git showed', cell: (r) => (r.sub ? <Held value={r.git} /> : <Held value={r.reason} />) },
            { head: 'Observation', cell: (r) => (r.observation != null ? <Text mono value={r.observation} /> : <span className="mut">—</span>) },
            { head: 'Age', cell: (r) => <RelTime at={r.at} /> },
          ]}
        />
        {disc.truncated ? <p className="mut">Only the newest rows of the window are drawn.</p> : null}
      </Section>
    </>
  );
}

export function SyncScreen({ params, repository: row }: ScreenProps) {
  const repository = params.repository;
  const search = useSearch();
  const raw = queryOf(search).get('since') ?? '7d';
  const window = raw in WINDOWS ? raw : '7d';
  const hour = Math.floor(useClock() / HOUR);
  const since = useMemo(() => sinceOf(window, (hour + 1) * HOUR - 1), [window, hour]);
  const read = useRead<SyncView>(`/v1/repositories/${encodeURIComponent(repository)}/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  const onWindow = (w: string) => navigate(withQuery(search, { since: w === '7d' ? null : w }), { replace: true });
  return (
    <>
      <PageHeader title="Sync" sub="The mirror’s view: what git’s sync told Baton, and where the two disagreed." />
      <ReadGate read={read} entity="repository" id={repository}>
        {(data) => <Body data={data} repository={repository} row={row} window={window} onWindow={onWindow} />}
      </ReadGate>
    </>
  );
}
