// TenantScreens.tsx — the tenant screens, an administrator's (B-214, B-215; BATON_SPEC §11.4):
//   /repositories  the registry          GET /v1/admin/repositories?retired=1
//   /instances     the instance view     GET /v1/admin/instances
//   /resources     resources and probes  GET /v1/admin/resources
//   /capacities    seats                 GET /v1/admin/capacities
//   /settings      the instance settings GET /v1/admin/settings
//   /state         the capacity envelope GET /v1/admin/tenant
//   /sessions      dashboard sessions    GET /v1/admin/sessions
// Read-only, every one (B-191's Decision 1a): each names the command that changes it and draws
// no control — and no export link: the tenant's whole state is never behind a cookie. Nothing
// is computed here that a read decides: an instance's state, a reading's `stale`, a figure's
// share of its envelope and whether it is over are the reads' own. Every value is a read's
// text (§12.3); a reading's detail and a resource's schema are pretty-printed blobs.
import type { ReactNode } from 'react';
import { ReadGate } from '../../app/Refusal';
import { Link, pathOrNull } from '../../app/router';
import { shortSha } from '../../lib/format';
import { ExtLink, forgeHref } from '../../lib/links';
import { useRead, type Read } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { JsonText } from '../../lib/View';
import { Badge, Band, Card, Cards, KeyValues, PageHeader, RelTime, Section, StatusMark, Table, UtcTime, type Tone } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { Actor, Chips, Fingerprint, HowToChange, NotBuiltBand, YesNo, listOf } from '../credentials/kit';
import type { CapacitiesAnswer, InstanceRow, InstanceSettingsAnswer, InstancesAnswer, ReadingRow, RegistryAnswer, RegistryRow, ResourcesAnswer, SessionsAnswer, TenantAnswer } from '../credentials/types';

/** A tenant read's gate. `forbidden` here is not a repository's refusal: the screens are an
 *  administrator's, and anyone else is told so. */
function TenantGate<T>({ read, children }: { read: Read<T>; children: (data: T) => ReactNode }) {
  if (read.error?.code === 'forbidden' && read.data === undefined) {
    return <div className="refusal" role="alert"><h1>This page is an administrator’s</h1><p><Link to="/">Your repositories</Link></p></div>;
  }
  return <ReadGate read={read} entity="page">{children}</ReadGate>;
}

// ── /repositories — the registry ─────────────────────────────────────────────────────────

export function RegistryScreen(_props: ScreenProps) {
  const read = useRead<RegistryAnswer>('/v1/admin/repositories?retired=1');
  return (
    <>
      <PageHeader title="Registry" sub="Every repository registered on this Baton, with the row the registry holds — the retired ones too." />
      <TenantGate read={read}>
        {(data) => {
          const rows = listOf<RegistryRow>(data.repositories);
          const seeded = new Set(listOf<string>(data.seed_owners));
          const live = rows.filter((r) => r.retired_at == null).length;
          return (
            <>
              <HowToChange ids={['repoAdd', 'repoSet', 'repoRetire']} />
              {seeded.size > 0 ? (
                <Band tone="warn">
                  <p>Marked <Badge tone="warn">SEED OWNERS</Badge>: a repository owned only by the keys the deployment seeded — it leans on the deploy for its owners. Give each an owner key of its own with <span className="mono">--add-owner-key</span>.</p>
                </Band>
              ) : null}
              <Section title="Repositories" count={rows.length} hint={`${live} live, ${rows.length - live} retired.`}>
                <Table<RegistryRow>
                  label="The registry"
                  rows={rows}
                  rowKey={(r, i) => `${r.id}-${i}`}
                  empty="No repository is registered."
                  columns={[
                    { head: 'Id', rowHeader: true, cell: (r) => <RegistryId row={r} seeded={seeded.has(r.id)} /> },
                    { head: 'Forge path', cell: (r) => <ForgePath row={r} /> },
                    { head: 'Forge', cell: (r) => <Text mono value={r.forge} /> },
                    { head: 'Branch', cell: (r) => <Text mono value={r.default_branch} /> },
                    { head: 'Weight', cell: (r) => <Text value={r.weight} /> },
                    { head: 'Head', cell: (r) => (r.head?.sha ? <><Text mono value={shortSha(r.head.sha)} /> · <RelTime at={r.head.received_at} /></> : <span className="mut nw">no board yet</span>) },
                    { head: 'Mode', cell: (r) => <Text mono value={modeOf(r.mode)} /> },
                    { head: 'Courses', cell: (r) => <Chips values={listOf<{ id: string }>(r.courses).map((c) => c.id)} /> },
                    { head: 'Sync keys', cell: (r) => <SyncKeys keys={listOf<{ fingerprint: string; role?: string }>(r.sync_keys)} /> },
                    { head: 'CI identity', cell: (r) => (r.ci_identity == null ? <span className="mut">none</span> : <Text mono value={(r.ci_identity as { kind?: unknown }).kind ?? r.ci_identity} />) },
                  ]}
                />
              </Section>
            </>
          );
        }}
      </TenantGate>
    </>
  );
}

/** A row's mode: the registry read carries it as `{mode}` (R-BTN-28), `repo.list` as the word. */
const modeOf = (mode: unknown): unknown => (mode !== null && typeof mode === 'object' && 'mode' in mode ? (mode as { mode: unknown }).mode : mode);

function RegistryId({ row, seeded }: { row: RegistryRow; seeded: boolean }) {
  const retired = row.retired_at != null;
  const board = retired ? null : pathOrNull('repository/board', { repository: row.id });
  return (
    <>
      <div>{board ? <Link to={board}><Text mono value={row.id} /></Link> : <Text mono value={row.id} />}</div>
      {retired ? <div className="sub-line nw"><Badge tone="bad" title="Retired: nothing is offered or accepted for it, and its id is never registered again.">RETIRED</Badge> <RelTime at={row.retired_at} /></div> : null}
      {seeded ? <div className="sub-line nw"><Badge tone="warn" title="Owned only by the keys the deployment seeded.">SEED OWNERS</Badge></div> : null}
    </>
  );
}

function ForgePath({ row }: { row: RegistryRow }) {
  // A retired row's path is the registry's tombstone, not a forge page: text.
  const href = row.retired_at == null ? forgeHref(row.web_base) : null;
  return href ? <ExtLink href={href} showHost><Text mono value={row.github} /></ExtLink> : <Text mono value={row.github} />;
}

function SyncKeys({ keys }: { keys: { fingerprint: string; role?: string }[] }) {
  if (keys.length === 0) return <span className="mut">none</span>;
  return <>{keys.map((k, i) => <div key={i}><Text mono value={k.role} />: <Fingerprint value={k.fingerprint} /></div>)}</>;
}

// ── /instances — the instance view ───────────────────────────────────────────────────────

const STATE_TONE: Record<string, Tone> = { available: 'ok', unavailable: 'warn', unknown: 'mut' };

function InstanceState({ row }: { row: InstanceRow }) {
  return (
    <>
      <StatusMark tone={STATE_TONE[row.state] ?? 'mut'} label={<Text value={row.state} />} />
      {row.state === 'unavailable' && row.until != null ? <> <span className="mut">until</span> <UtcTime at={row.until} /></> : null}
    </>
  );
}

function ReadingWord({ reading }: { reading: ReadingRow }) {
  if (reading.kind !== 'state') return <Text mono value={reading.kind} />;
  return <>{reading.available ? 'available' : 'unavailable'}{!reading.available && reading.until != null ? <> until <UtcTime at={reading.until} /></> : null}</>;
}

/** The newest reading in one line: what it says, from whom, how long ago — `stale` marked. */
function NewestReading({ row }: { row: InstanceRow }) {
  const newest = listOf<ReadingRow>(row.readings)[0];
  if (!newest) return <span className="mut">no reading in force</span>;
  return (
    <>
      <ReadingWord reading={newest} /> · <Text mono value={newest.source?.split(':')[0]} /> · <RelTime at={newest.observed_at} />
      {newest.stale ? <> <Badge tone="warn">STALE</Badge></> : null}
    </>
  );
}

function Readings({ row }: { row: InstanceRow }) {
  const readings = listOf<ReadingRow>(row.readings);
  if (readings.length === 0) return null;
  return (
    <details className="readings">
      <summary>{readings.length === 1 ? 'The reading' : `All ${readings.length} readings`}, by instrument</summary>
      {readings.map((r, i) => (
        <div className="reading" key={i}>
          <div><Actor value={r.source} /> <span className="mut">({r.writer ?? 'instrument'})</span> — <ReadingWord reading={r} />{r.stale ? <> <Badge tone="warn">STALE</Badge></> : null}</div>
          <div className="mut">observed <UtcTime at={r.observed_at} /> · in force until <UtcTime at={r.lapses_at} /></div>
          {r.detail == null ? null : <JsonText value={r.detail} />}
        </div>
      ))}
    </details>
  );
}

export function InstancesScreen(_props: ScreenProps) {
  const read = useRead<InstancesAnswer>('/v1/admin/instances');
  const resources = pathOrNull('tenant/resources');
  return (
    <>
      <PageHeader title="Instances" sub="The shared resources’ instances runners rank from: each one’s state, and the readings its instruments posted." />
      <TenantGate read={read}>
        {(data) => {
          const rows = listOf<InstanceRow>(data.instances);
          return (
            <>
              <HowToChange ids={['readingSet', 'instanceAdd']}>
                <p>A reading is a statement by its instrument — an administrator, a probe, a runner. Baton records each and takes the newest in force as the state.</p>
              </HowToChange>
              <Section title="Instance view" count={rows.length}>
                <Table<InstanceRow>
                  label="Instances"
                  rows={rows}
                  rowKey={(r, i) => `${r.name}-${i}`}
                  empty="No instance is registered."
                  columns={[
                    { head: 'Instance', rowHeader: true, cell: (r) => <Text mono value={r.name} /> },
                    { head: 'Serves', cell: (r) => <Chips values={r.serves} /> },
                    { head: 'Repositories', cell: (r) => <Chips values={r.repositories} none="every repository" /> },
                    { head: 'State', cell: (r) => <InstanceState row={r} /> },
                    { head: 'Newest reading', cell: (r) => <><NewestReading row={r} /><Readings row={r} /></> },
                  ]}
                />
                {resources ? <p className="hint">What each resource is, and the probe keys, are on <Link to={resources}>Resources</Link>.</p> : null}
              </Section>
            </>
          );
        }}
      </TenantGate>
    </>
  );
}

// ── /resources ───────────────────────────────────────────────────────────────────────────

type Resource = NonNullable<ResourcesAnswer['resources']>[number];
type Probe = NonNullable<ResourcesAnswer['probes']>[number];

export function ResourcesScreen(_props: ScreenProps) {
  const read = useRead<ResourcesAnswer>('/v1/admin/resources');
  const instances = pathOrNull('tenant/instances');
  return (
    <>
      <PageHeader title="Resources" sub="The outside things a leg may need — an account, a service — and the keys of the probes that report on them." />
      <TenantGate read={read}>
        {(data) => {
          const resources = listOf<Resource>(data.resources);
          const probes = listOf<Probe>(data.probes);
          return (
            <>
              <HowToChange ids={['resourceAdd', 'instanceAdd', 'probeAdd', 'keyRevoke']} />
              <Section title="Resources" count={resources.length}>
                {resources.length === 0 ? <p className="empty">No resource is registered.</p> : (
                  <Cards>
                    {resources.map((r, i) => (
                      <Card key={`${r.name}-${i}`} title={<Text mono value={r.name} />} aside={<Badge><Text value={r.scope} /></Badge>}>
                        <KeyValues rows={[
                          ['instances', listOf<string>(r.instances).length === 0 ? <span className="mut">none</span>
                            : <>{listOf<string>(r.instances).map((name, n) => <span key={n}>{n ? ', ' : ''}{instances ? <Link to={instances}><Text mono value={name} /></Link> : <Text mono value={name} />}</span>)}</>],
                        ]} />
                        <p className="hint">Detail schema — what a reading’s detail must be:</p>
                        <div className="doc-box" tabIndex={0} aria-label={`The detail schema of ${r.name}`}><JsonText value={r.detail_schema} /></div>
                      </Card>
                    ))}
                  </Cards>
                )}
              </Section>
              <Section title="Probe keys" count={probes.length} hint="Instrument keys: each signs the readings its probe posts.">
                <Table<Probe>
                  label="Probe keys"
                  rows={probes}
                  rowKey={(p, i) => `${p.fingerprint}-${i}`}
                  empty="No probe key is registered."
                  columns={[
                    { head: 'Key', rowHeader: true, cell: (p) => <Fingerprint value={p.fingerprint} /> },
                    { head: 'Label', cell: (p) => <Text value={p.label} /> },
                    { head: 'Listed instances', cell: (p) => <Chips values={p.instances} none="none listed" /> },
                    { head: 'Added by', cell: (p) => <Actor value={p.added_by} /> },
                  ]}
                />
              </Section>
            </>
          );
        }}
      </TenantGate>
    </>
  );
}

// ── /capacities ──────────────────────────────────────────────────────────────────────────

type Capacity = NonNullable<CapacitiesAnswer['capacities']>[number];
type Holder = NonNullable<Capacity['holders']>[number];

/** A holding claim: its ticket and its runner, each linking its page where the ids fit one. */
function HolderLinks({ holder }: { holder: Holder }) {
  const id = typeof holder.ticket_id === 'string' ? holder.ticket_id : '';
  const at = id.indexOf(':');
  const repository = at > 0 ? id.slice(0, at) : '';
  const ticket = pathOrNull('repository/tickets/{ticket}', { repository, ticket: id.slice(at + 1) });
  const runner = pathOrNull('repository/runners/{runner}', { repository, runner: String(holder.runner_id) });
  return (
    <div>
      {ticket ? <Link to={ticket}><Text mono value={id} /></Link> : <Text mono value={holder.ticket_id} />}
      <span className="mut"> · runner </span>
      {runner ? <Link to={runner}><Text mono value={holder.runner_id} /></Link> : <Text mono value={holder.runner_id} />}
      <span className="mut"> · claim </span><Text mono value={holder.claim_id} />
    </div>
  );
}

export function CapacitiesScreen(_props: ScreenProps) {
  const read = useRead<CapacitiesAnswer>('/v1/admin/capacities');
  return (
    <>
      <PageHeader title="Capacities" sub="A capability with a capacity has that many seats across every repository; a claim holds one while its leg runs." />
      <TenantGate read={read}>
        {(data) => {
          const rows = listOf<Capacity>(data.capacities);
          return (
            <>
              <HowToChange ids={['capacitySet', 'capacityClear']}>
                <p>A lower capacity never takes back a held seat. Not the tenant’s capacity envelope — that is on <StateLink />.</p>
              </HowToChange>
              <Section title="Capacities" count={rows.length}>
                <Table<Capacity>
                  label="Capacities"
                  rows={rows}
                  rowKey={(c, i) => `${c.capability}-${i}`}
                  empty="No capability has a capacity: every capability’s seats are unlimited."
                  columns={[
                    { head: 'Capability', rowHeader: true, cell: (c) => <Text mono value={c.capability} /> },
                    { head: 'Seats held', cell: (c) => <><Text value={c.held} /> of <Text value={c.capacity} /></> },
                    { head: 'Held by', cell: (c) => (listOf<Holder>(c.holders).length === 0 ? <span className="mut">no claim</span> : <>{listOf<Holder>(c.holders).map((h, i) => <HolderLinks key={i} holder={h} />)}</>) },
                    { head: 'Set by', cell: (c) => <Actor value={c.set_by} /> },
                    { head: 'Set', cell: (c) => <RelTime at={c.set_at} /> },
                  ]}
                />
              </Section>
            </>
          );
        }}
      </TenantGate>
    </>
  );
}

function StateLink() {
  const to = pathOrNull('tenant/state');
  return to ? <Link to={to}>State</Link> : <>State</>;
}

// ── /settings — the instance settings ────────────────────────────────────────────────────

export function InstanceSettingsScreen(_props: ScreenProps) {
  const read = useRead<InstanceSettingsAnswer>('/v1/admin/settings');
  return (
    <>
      <PageHeader title="Instance settings" sub="What this Baton’s administrators set for every repository." />
      <TenantGate read={read}>
        {(data) => (
          <>
            <HowToChange ids={['instanceSettingsSet']}>
              <p>Each flag replaces its own list whole; <span className="mono">none</span> clears one back to what stands without it.</p>
            </HowToChange>
            <Section title="Settings">
              <Table<[string, ReactNode, string]>
                label="Instance settings"
                rows={[
                  ['link_hosts', <Chips values={data.link_hosts} none="none — no link to another origin is drawn" />, 'The hosts a link in a ticket’s or a reading’s view may point to. A link to any other host is drawn as text.'],
                  ['session_hosts', <Chips values={data.session_hosts} none="none — no session link is accepted" />, 'The hosts a runner’s session link may point to. A link to any other host is dropped and logged.'],
                  ['check_app_id', data.check_app_id == null ? <span className="mut">not set</span> : <Text mono value={data.check_app_id} />, 'The id of the forge app that posts checks. An id, never a key.'],
                  ['recommended_client', <Text mono value={data.recommended_client} />, 'The client version this Baton recommends; a runner below it is listed as a stale client.'],
                ]}
                rowKey={(r) => r[0]}
                columns={[
                  { head: 'Setting', rowHeader: true, width: '20%', cell: (r) => <Text mono value={r[0]} /> },
                  { head: 'Value', cell: (r) => r[1] },
                  { head: 'What it decides', cell: (r) => <span className="setting-meaning">{r[2]}</span> },
                ]}
              />
            </Section>
          </>
        )}
      </TenantGate>
    </>
  );
}

// ── /state — the capacity envelope ───────────────────────────────────────────────────────

/** Baton's own words for the envelope's figures. A figure the read names and this table does
 *  not is drawn under its own name. */
const FIGURE_LABEL: Record<string, { label: string; unit?: string }> = {
  live_runners: { label: 'Live runners' },
  repositories: { label: 'Repositories' },
  live_tickets: { label: 'Live tickets' },
  history_rows: { label: 'History rows' },
  requests_per_second: { label: 'Requests a second', unit: '5-minute mean' },
  burst_in_5s: { label: 'Largest burst', unit: 'requests in any 5 seconds of the last 5 minutes' },
};

const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : '—');

/** One figure against its envelope: the numbers as text, and a bar only where the read gives
 *  an envelope value. */
function MeterCard({ label, value, envelope, ratio, over, note }: { label: ReactNode; value: unknown; envelope?: unknown; ratio?: unknown; over?: boolean; note?: ReactNode }) {
  const has = typeof envelope === 'number' && envelope > 0;
  const share = typeof ratio === 'number' && Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : null;
  return (
    <Card className={`meter-card${over ? ' meter-over' : ''}`} title={label} aside={over ? <StatusMark tone="warn" label="over 80%" /> : undefined}>
      <p className="meter-figure">{num(value)}{has ? <span className="meter-of"> / {num(envelope)}</span> : null}</p>
      {has && share !== null ? (
        <div className="meter" role="img" aria-label={`${num(value)} of ${num(envelope)}`}><div className="meter-fill" style={{ width: `${Math.round(share * 100)}%` }} /></div>
      ) : null}
      {note ? <p className="meter-note">{note}</p> : null}
    </Card>
  );
}

export function StateScreen(_props: ScreenProps) {
  const read = useRead<TenantAnswer>('/v1/admin/tenant');
  return (
    <>
      <PageHeader title="State" sub="This Baton against its capacity envelope — targets it is built for, which refuse nothing — and what needs an administrator." />
      <TenantGate read={read}>
        {(data) => {
          const figures = listOf<NonNullable<TenantAnswer['figures']>[number]>(data.figures);
          const keys = data.needs_you?.keys ?? null;
          const over = listOf<{ figure: string; value?: number; envelope?: number }>(data.needs_you?.capacity);
          const unknown = listOf<NonNullable<NonNullable<TenantAnswer['needs_you']>['instances_unknown']>[number]>(data.needs_you?.instances_unknown);
          const oldClients = listOf<NonNullable<NonNullable<TenantAnswer['needs_you']>['stale_clients']>[number]>(data.needs_you?.stale_clients);
          const noCourse = listOf<NonNullable<NonNullable<TenantAnswer['needs_you']>['stale_skills_no_course']>[number]>(data.needs_you?.stale_skills_no_course);
          const needs = (keys ? 1 : 0) + over.length + unknown.length + oldClients.length + noCourse.length;
          const instancesPath = pathOrNull('tenant/instances', {});
          const day = data.day;
          return (
            <>
              {data.sealed_at != null ? (
                <Band tone="bad"><p><strong>Sealed</strong> <UtcTime at={data.sealed_at} /> for its move: an administrator’s reads alone are served.</p></Band>
              ) : data.frozen_at != null ? (
                <Band tone="warn"><p><strong>Frozen</strong> <UtcTime at={data.frozen_at} />: new claims and owner writes are refused until it is unfrozen or sealed.</p></Band>
              ) : null}
              <Section title="Needs an administrator" count={needs} tone={needs ? 'warn' : 'mut'}>
                {needs === 0 ? <p className="empty">Nothing: the runner key list seeded, no figure is over 80% of its envelope, no needed instance is unknown, and every live runner declares a course and a current client.</p> : (
                  <>
                    {keys ? (
                      <Band tone="warn">
                        <p><strong>The runner key list (BATON_KEYS)</strong></p>
                        {keys.refused ? <p>The list was refused and the keys in force stay: <Text value={keys.refused} /></p> : null}
                        {listOf<string>(keys.revoked_listed).length ? <p>It names keys an administrator revoked, which stay revoked: <Chips values={keys.revoked_listed} /></p> : null}
                      </Band>
                    ) : null}
                    {over.map((f, i) => (
                      <Band tone="warn" key={i}>
                        <p><strong>{FIGURE_LABEL[f.figure]?.label ?? <Text mono value={f.figure} />}</strong> is over 80% of the envelope: {num(f.value)} of {num(f.envelope)}. Beyond the envelope the answer is another Baton.</p>
                      </Band>
                    ))}
                    {unknown.map((u, i) => (
                      <Band tone="warn" key={`unknown-${i}`}>
                        <p><strong>Instance <Text mono value={u.instance} /></strong> has been unknown since <UtcTime at={u.since} />, and a posted leg needs what it serves: no instrument’s reading is in force. {instancesPath ? <Link to={instancesPath}>Instances</Link> : null}</p>
                      </Band>
                    ))}
                    {oldClients.map((w, i) => (
                      <Band tone="warn" key={`client-${i}`}>
                        <p><strong>Runner <Text mono value={w.hostname} /> / <Text mono value={w.session_name} /></strong> runs client <Text mono value={w.client_version} />, below the recommended <Text mono value={w.recommended} />. Update it at your own pace: nothing updates itself.</p>
                      </Band>
                    ))}
                    {noCourse.map((w, i) => (
                      <Band tone="warn" key={`course-${i}`}>
                        <p><strong>Runner <Text mono value={w.hostname} /> / <Text mono value={w.session_name} /></strong> declares no course: restart it from a pulled checkout.</p>
                      </Band>
                    ))}
                  </>
                )}
              </Section>
              <Section title="Capacity" hint="Each figure against the envelope.">
                <Cards>
                  {figures.map((f, i) => (
                    <MeterCard key={`${f.figure}-${i}`} label={FIGURE_LABEL[f.figure]?.label ?? <Text mono value={f.figure} />} value={f.value} envelope={f.envelope} ratio={f.ratio} over={!!f.over} note={FIGURE_LABEL[f.figure]?.unit} />
                  ))}
                  <MeterCard label="Live claims" value={data.live_claims} note="No envelope figure names claims." />
                </Cards>
                <p className="hint">The request figures are this process’s own count since it last started; a restart empties them.</p>
              </Section>
              <Section title="Today’s usage" hint="Against the hosting plan’s daily limits. Nothing is refused at a limit.">
                <Cards>
                  <MeterCard label="Requests handled" value={day?.requests} envelope={day?.limits?.requests} ratio={ratioOf(day?.requests, day?.limits?.requests)} note={<>UTC day <Text mono value={day?.day} /></>} />
                  <MeterCard label="Rows written" value={day?.rows_written} envelope={day?.limits?.rows_written} ratio={ratioOf(day?.rows_written, day?.limits?.rows_written)} />
                </Cards>
              </Section>
              <Section title="Moving this Baton">
                <HowToChange ids={['freeze', 'unfreeze', 'seal', 'exportState', 'importState']}>
                  <p>The export is the terminal’s alone: this page offers no download.</p>
                </HowToChange>
                <KeyValues rows={[
                  ['frozen', data.frozen_at == null ? <YesNo value={false} /> : <UtcTime at={data.frozen_at} />],
                  ['sealed', data.sealed_at == null ? <YesNo value={false} /> : <UtcTime at={data.sealed_at} />],
                ]} />
              </Section>
              {data.not_built?.storage_bytes ? (
                <NotBuiltBand lead="The store’s size is not reported yet" by={data.not_built.storage_bytes}>
                  <p>Neither host tells Baton how many bytes its store holds, so no storage figure is drawn.</p>
                </NotBuiltBand>
              ) : null}
            </>
          );
        }}
      </TenantGate>
    </>
  );
}

/** A day's count as a share of its limit, for the bar's width alone. */
const ratioOf = (value: unknown, limit: unknown): number | undefined =>
  (typeof value === 'number' && typeof limit === 'number' && limit > 0 ? value / limit : undefined);

// ── /sessions ────────────────────────────────────────────────────────────────────────────

type Session = NonNullable<SessionsAnswer['sessions']>[number];

export function SessionsScreen(_props: ScreenProps) {
  const read = useRead<SessionsAnswer>('/v1/admin/sessions');
  return (
    <>
      <PageHeader title="Sessions" sub="The dashboard sessions that stand now. A session is its minting key’s, and lives at most 12 hours." />
      <TenantGate read={read}>
        {(data) => {
          const rows = listOf<Session>(data.sessions);
          return (
            <>
              <HowToChange ids={['open']}>
                <p>That mints a one-time sign-in link. A session ends when its holder logs out, when it expires, or as soon as its key leaves the administrators’ list — there is no command that revokes one session.</p>
              </HowToChange>
              <Section title="Live sessions" count={rows.length}>
                <Table<Session>
                  label="Live sessions"
                  rows={rows}
                  rowKey={(_, i) => i}
                  empty="No session stands."
                  columns={[
                    { head: 'Key', rowHeader: true, cell: (s) => <><Fingerprint value={s.key_fingerprint} />{s.current ? <> <Badge tone="ok">THIS SESSION</Badge></> : null}</> },
                    { head: 'Role', cell: (s) => <Text mono value={s.role} /> },
                    { head: 'Signed in', cell: (s) => <RelTime at={s.created_at} /> },
                    { head: 'Expires', cell: (s) => <UtcTime at={s.expires_at} /> },
                  ]}
                />
              </Section>
              {data.not_built?.last_seen_at ? (
                <NotBuiltBand lead="A session’s last use and its client’s address are not recorded yet" by={data.not_built.last_seen_at}>
                  <p>Baton keeps a session’s key and its two times, nothing more: there is no “last seen” and no address to show.</p>
                </NotBuiltBand>
              ) : null}
            </>
          );
        }}
      </TenantGate>
    </>
  );
}
