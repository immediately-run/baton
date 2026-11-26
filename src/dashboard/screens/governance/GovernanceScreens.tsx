// GovernanceScreens.tsx — the governance screens of one repository (B-200; BATON_SPEC §11.4,
// §12.8 R-BTN-188, R-BTN-189, §5.6 R-BTN-67, §13.1): `/policy`, `/settings`, `/bars` and
// `/consents`. Read-only: a policy, a setting, a bar and a consent are a key's or an approver's
// to change (R-BTN-186), so each screen names the command and draws no control.
//   /policy    GET …/policy and GET /v1/owner/{r}/policy/log
//   /settings  the grants read's `settings`, and the registry's `weight` from
//              `repo.list` (the row the shell hands down)
//   /bars      the grants read's `bars` and `settings.required_bars`
//   /consents  the grants read's `dependency_consents` and `settings.code_repos`
// Nothing is computed here that the reads decide: a guarantee is met or not as the read says,
// a floor is a floor because the read lists it. Every value is a read's text (§12.3) — the
// policy document a pretty-printed blob.
import { ReadGate } from '../../app/Refusal';
import { Link, pathOrNull } from '../../app/router';
import { useRead } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { JsonText } from '../../lib/View';
import { Badge, Band, ErrorNote, KeyValues, Loading, PageHeader, RelTime, Section, StatusMark, Table, UtcTime } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { Actor, Chips, Fingerprint, HowToChange, NotBuiltBand, YesNo, listOf, useGrants } from '../credentials/kit';
import type { BarRow, DependencyConsentRow, PolicyAnswer, PolicyLogAnswer } from '../credentials/types';

// ── /policy ──────────────────────────────────────────────────────────────────────────────

type Version = NonNullable<PolicyLogAnswer['versions']>[number];

export function PolicyScreen({ params }: ScreenProps) {
  const repository = encodeURIComponent(params.repository);
  const policy = useRead<PolicyAnswer>(`/v1/repositories/${repository}/policy`);
  const log = useRead<PolicyLogAnswer>(`/v1/owner/${repository}/policy/log`);
  return (
    <>
      <PageHeader title="Policy" sub="The one versioned document of this repository’s rules about authority and trust — held in Baton, never in git." />
      <ReadGate read={policy} entity="policy" id={params.repository}>
        {(p) => {
          const versions = [...listOf<Version>(log.data?.versions)].sort((a, b) => b.version - a.version);
          const current = versions.find((v) => v.version === p.version);
          const floors = listOf<NonNullable<PolicyAnswer['floors']>[number]>(p.floors);
          const floored = new Map<string, string[]>();
          for (const f of floors) for (const g of listOf<string>(f.guarantees)) floored.set(g, [...(floored.get(g) ?? []), f.name]);
          const guarantees = Object.entries(p.guarantees && typeof p.guarantees === 'object' ? p.guarantees : {});
          return (
            <>
              <HowToChange ids={['policySet', 'policyApply', 'policyFloorAdd']}>
                <p>A change names the version it builds on; one that would break a floor is refused.</p>
              </HowToChange>
              <Section title="In force">
                <KeyValues rows={[
                  ['version', <Text mono value={p.version} />],
                  ['hash', <Fingerprint value={p.hash} />],
                  ['preset applied', current ? (current.preset == null ? <span className="mut">none — set knob by knob</span> : <Text mono value={current.preset} />) : <span className="mut">—</span>],
                  ['changed by', current ? <Actor value={current.changed_by} /> : <span className="mut">—</span>],
                  ['changed', current ? <UtcTime at={current.at} /> : <span className="mut">—</span>],
                ]} />
              </Section>
              <Section title="Guarantees" count={guarantees.length} hint="Each is a condition over the policy, met or not as Baton computes it. A floor is a guarantee Baton refuses to let a change break.">
                {guarantees.length === 0 ? <p className="empty">The read names no guarantee.</p> : (
                  <ul className="guarantees">
                    {guarantees.map(([name, met]) => (
                      <li key={name}>
                        <StatusMark tone={met ? 'ok' : 'mut'} label={<><Text mono value={name} /> — {met ? 'met' : 'not met'}</>} />
                        {floored.has(name) ? <> <Badge tone={met ? 'ok' : 'bad'} title={`A floor: ${floored.get(name)!.join(', ')}`}>FLOOR</Badge></> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Floors" count={floors.length}>
                <Table
                  label="Floors"
                  rows={floors}
                  rowKey={(f, i) => `${f.name}-${i}`}
                  empty="No floor is registered: Baton refuses no policy change for a guarantee’s sake."
                  columns={[
                    { head: 'Floor', rowHeader: true, cell: (f) => <Text mono value={f.name} /> },
                    { head: 'Guarantees it holds', cell: (f) => <Chips values={f.guarantees} /> },
                    { head: 'Removed by', cell: (f) => <Text mono value={f.remove_by} /> },
                    { head: 'Added by', cell: (f) => <Actor value={f.added_by} /> },
                    { head: 'Added', cell: (f) => <RelTime at={f.added_at} /> },
                  ]}
                />
              </Section>
              <Section title="The document" hint="As Baton holds it, pretty-printed.">
                <div className="doc-box" tabIndex={0} aria-label="The policy document"><JsonText value={p.policy} /></div>
              </Section>
              <Section title="Versions" count={log.data ? versions.length : undefined} hint="Newest first.">
                {log.data === undefined ? (log.error ? <ErrorNote error={log.error} what="The policy log" /> : <Loading what="the versions" />) : (
                  <Table<Version>
                    label="Policy versions"
                    rows={versions}
                    rowKey={(v) => v.version}
                    empty="No version is recorded."
                    columns={[
                      { head: 'Version', rowHeader: true, cell: (v) => <><Text mono value={v.version} />{v.version === p.version ? <> <Badge tone="ok">IN FORCE</Badge></> : null}</> },
                      { head: 'Hash', cell: (v) => <Fingerprint value={v.hash} /> },
                      { head: 'Previous hash', cell: (v) => (v.previous_hash == null ? <span className="mut">—</span> : <Fingerprint value={v.previous_hash} />) },
                      { head: 'Changed by', cell: (v) => <Actor value={v.changed_by} /> },
                      { head: 'Approver', cell: (v) => <Actor value={v.approver} /> },
                      { head: 'Preset', cell: (v) => (v.preset == null ? <span className="mut">—</span> : <Text mono value={v.preset} />) },
                      { head: 'At', cell: (v) => <UtcTime at={v.at} /> },
                      { head: 'Changed knobs', cell: (v) => <Chips values={v.changed} none="none" /> },
                    ]}
                  />
                )}
              </Section>
            </>
          );
        }}
      </ReadGate>
    </>
  );
}

// ── /settings ────────────────────────────────────────────────────────────────────────────

/** Each owner setting's one line, in Baton's own words. A setting the read carries and this
 *  table does not is still drawn, with no line. */
const SETTING_MEANING: Record<string, string> = {
  retry: 'How a failed leg is retried: the waits between attempts and the failures after which the ticket stops. Baton’s default when unset.',
  transcript_repos: 'The repositories a transcript pointer under one of this repository’s claims may name.',
  unblocked_trigger: 'What Baton dispatches when a blocked ticket of this repository becomes unblocked.',
  remind_after: 'Seconds a sent notice waits for its decision before it is queued again.',
  scope_policy: 'What happens when a leg reports work outside its ticket’s scope: report it, or hold the ticket.',
  runner_pushers: 'The forge identities this repository’s runners push as.',
  pushers: 'Forge authors whose words count — a verdict, an approval — beside those the forge reports can push.',
  require_signed_control: 'Whether control inputs count only at commits an owner signed.',
  code_repos: 'The forge repositories this repository’s tickets’ work may change.',
};
/** The registry's own columns that ride in the read's `settings` row, drawn under The registry. */
const REGISTRY_KEYS = new Set(['repository_id', 'forge', 'web_base', 'required_bars']);

/** The settings Baton stores as a flag (0 or 1): drawn as the word. */
const FLAG_SETTINGS = new Set(['require_signed_control']);

/** JSON text as its value; the text itself where it is not JSON. */
function parsedOr(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function SettingValue({ name, value }: { name: string; value: unknown }) {
  if (value === null || value === undefined) return <span className="mut">not set</span>;
  if (typeof value === 'boolean' || (FLAG_SETTINGS.has(name) && (value === 0 || value === 1))) return <YesNo value={value} />;
  // Baton stores a list or an object setting as JSON text: drawn as the list or the blob it is.
  const held = typeof value === 'string' && /^\s*[[{]/.test(value) ? parsedOr(value) : value;
  if (Array.isArray(held)) {
    if (held.length === 0) return <span className="mut">none</span>;
    return held.every((v) => typeof v === 'string' || typeof v === 'number') ? <Chips values={held} /> : <JsonText value={held} />;
  }
  if (held !== null && typeof held === 'object') return <JsonText value={held} />;
  return <Text mono value={held} />;
}

export function SettingsScreen({ params, repository }: ScreenProps) {
  const read = useGrants(params.repository);
  const bars = pathOrNull('repository/bars', { repository: params.repository });
  return (
    <>
      <PageHeader title="Settings" sub="What this repository’s owners set in Baton, which no push changes." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => {
          const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
          const rows = Object.entries(settings).filter(([k]) => !REGISTRY_KEYS.has(k));
          return (
            <>
              <HowToChange ids={['settingsSet']} />
              <Section title="Owner settings" count={rows.length}>
                <Table<[string, unknown]>
                  label="Owner settings"
                  rows={rows}
                  rowKey={([k]) => k}
                  empty="The read carries no owner setting."
                  columns={[
                    { head: 'Setting', rowHeader: true, width: '22%', cell: ([k]) => <Text mono value={k} /> },
                    { head: 'Value', cell: ([k, v]) => <SettingValue name={k} value={v} /> },
                    { head: 'What it decides', cell: ([k]) => <span className="setting-meaning">{SETTING_MEANING[k] ?? '—'}</span> },
                  ]}
                />
                {bars ? <p className="hint">The required bars are on <Link to={bars}>Bars</Link>.</p> : null}
              </Section>
              <Section title="The registry’s" hint="An administrator’s, shown here so an owner need not ask.">
                <KeyValues rows={[
                  ['weight', <Text mono value={repository?.weight} />],
                  ['forge', <Text mono value={repository?.forge ?? settings.forge} />],
                  ['default branch', <Text mono value={repository?.default_branch} />],
                ]} />
                <HowToChange ids={['registrySet']} />
              </Section>
            </>
          );
        }}
      </ReadGate>
    </>
  );
}

// ── /bars ────────────────────────────────────────────────────────────────────────────────

interface RequiredBarRow { course?: string; leg?: string; except?: string[]; tag_prefix?: string }

/** `settings.required_bars` arrives as the stored JSON text or as a list. */
function requiredBarsOf(settings: Record<string, unknown> | null | undefined): RequiredBarRow[] {
  const v = settings?.required_bars;
  if (Array.isArray(v)) return v as RequiredBarRow[];
  if (typeof v !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as RequiredBarRow[]) : [];
  } catch {
    return [];
  }
}

export function BarsScreen({ params }: ScreenProps) {
  const read = useGrants(params.repository);
  return (
    <>
      <PageHeader title="Bars" sub="Tags this repository’s owners bar from its legs, and the bars every leg must carry — limits no push changes." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => {
          const bars = listOf<BarRow>(data.bars);
          const required = requiredBarsOf(data.settings);
          const now = typeof data.server_time === 'number' ? data.server_time : null;
          return (
            <>
              <HowToChange ids={['barAdd', 'barLift', 'requiredBarsSet', 'requiredBarsClear']}>
                <p>Lifting a bar loosens: it is an approver’s, by key — never a session’s.</p>
              </HowToChange>
              <Section title="Owner bars" count={bars.length} hint="In force and scheduled.">
                <Table<BarRow>
                  label="Owner bars"
                  rows={bars}
                  rowKey={(b, i) => `${b.id}-${i}`}
                  empty="No owner bar is in force or scheduled."
                  columns={[
                    { head: 'Id', rowHeader: true, cell: (b) => <Text mono value={b.id} /> },
                    { head: 'State', cell: (b) => (now !== null && typeof b.starts_at === 'number' && b.starts_at > now
                      ? <StatusMark tone="mut" label="scheduled" /> : <StatusMark tone="warn" label="in force" />) },
                    { head: 'Course', cell: (b) => (b.course === '*' ? <span className="mut">every course</span> : <Text mono value={b.course} />) },
                    { head: 'Tag', cell: (b) => <Text mono value={b.tag} /> },
                    { head: 'Legs', cell: (b) => <Chips values={b.legs} none="every leg" /> },
                    { head: 'Applies at', cell: (b) => <Text mono value={b.applies} /> },
                    { head: 'Starts', cell: (b) => <UtcTime at={b.starts_at} /> },
                    { head: 'Ends', cell: (b) => (b.ends_at == null ? <span className="mut">until lifted</span> : <UtcTime at={b.ends_at} />) },
                    { head: 'Releases holders', cell: (b) => <YesNo value={b.release_holders} /> },
                    { head: 'Reason', cell: (b) => <Text value={b.reason} /> },
                    { head: 'Set by', cell: (b) => <Actor value={b.set_by} /> },
                  ]}
                />
              </Section>
              <Section title="Required bars" count={required.length} hint="A leg they cover must bar a tag with the prefix.">
                <Table<RequiredBarRow>
                  label="Required bars"
                  rows={required}
                  rowKey={(_, i) => i}
                  empty="No bar is required of this repository’s legs."
                  columns={[
                    { head: 'Course', rowHeader: true, cell: (b) => <Text mono value={b.course} /> },
                    { head: 'Leg', cell: (b) => <Text mono value={b.leg} /> },
                    { head: 'Except legs', cell: (b) => <Chips values={b.except} none="none" /> },
                    { head: 'Tag prefix', cell: (b) => <Text mono value={b.tag_prefix} /> },
                  ]}
                />
              </Section>
            </>
          );
        }}
      </ReadGate>
    </>
  );
}

// ── /consents ────────────────────────────────────────────────────────────────────────────

interface CodeRepoRow { path?: string; forge?: string; host?: string; web_base?: string }

export function ConsentsScreen({ params }: ScreenProps) {
  const read = useGrants(params.repository);
  return (
    <>
      <PageHeader title="Consents" sub="What this repository’s owners agreed to let another repository do with it, and the repositories its own tickets reach." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => {
          const consents = listOf<DependencyConsentRow>(data.dependency_consents);
          const code = listOf<CodeRepoRow>(data.settings?.code_repos);
          const by = data.not_built?.code_repo_consents;
          return (
            <>
              <Section title="Dependency consents" count={consents.length} hint="Repositories whose tickets may depend on this repository’s, though they see less of it.">
                <Table<DependencyConsentRow>
                  label="Dependency consents"
                  rows={consents}
                  rowKey={(c, i) => `${c.repository}-${i}`}
                  empty="This repository’s owners have consented to no other repository’s dependencies."
                  columns={[
                    { head: 'Dependent repository', rowHeader: true, cell: (c) => <Text mono value={c.repository} /> },
                    { head: 'Consented', cell: () => <YesNo value yes="consented" /> },
                    { head: 'Given by', cell: (c) => <Actor value={c.granted_by} /> },
                    { head: 'Given', cell: (c) => <RelTime at={c.granted_at} /> },
                  ]}
                />
                <Band>
                  <p>Read-only here, and no <span className="mono">baton</span> command gives or withdraws this consent yet. It is one request signed with an owner’s key:</p>
                  <p><code className="cli">POST /v1/owner/&lt;repository&gt;/dependency-consents {'{"repository": "<dependent>", "confirm": true}'}</code></p>
                  <p>A withdrawal sends <span className="mono">{'"withdraw": true'}</span> in place of <span className="mono">{'"confirm": true'}</span>, and removes the row: a withdrawn consent is not listed.</p>
                </Band>
              </Section>
              <Section title="Code repositories" count={code.length} hint="The forge repositories this repository’s owners list for its tickets’ work.">
                <Table<CodeRepoRow>
                  label="Code repositories"
                  rows={code}
                  rowKey={(c, i) => `${c.path}-${i}`}
                  empty="The owners list no code repository."
                  columns={[
                    { head: 'Path', rowHeader: true, cell: (c) => <Text mono value={c.path} /> },
                    { head: 'Forge', cell: (c) => <Text mono value={c.forge} /> },
                    { head: 'Host', cell: (c) => <Text mono value={c.host} /> },
                  ]}
                />
                <HowToChange ids={['settingsSet']} />
              </Section>
              <NotBuiltBand lead="A listed repository’s own consent to being a code repository is not built yet" by={typeof by === 'string' && by ? by : 'R-BTN-140'}>
                <p>Baton records which repositories a home lists, never whether each agreed: there is no such consent to show, give or withdraw.</p>
              </NotBuiltBand>
            </>
          );
        }}
      </ReadGate>
    </>
  );
}
