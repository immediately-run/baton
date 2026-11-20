// CredentialScreens.tsx — the credential screens of one repository (B-199; BATON_SPEC §11.4,
// §12.1 R-BTN-179): `/grants`, `/owners`, `/tokens`, `/mcp-keys`, `/sync-keys` and
// `/check-runners`, each one field of the ONE read `GET /v1/owner/{repository}/grants`
// (`owner.grant.list`) — no second read. Read-only: no credential write admits a session, so
// each screen names the command that changes it and draws no control. A kind Baton does not
// hold yet (registration tokens, MCP keys, the check-runner) says so plainly and names what
// builds it — the read's `not_built` — with no row invented. Every value is a read's text.
import { ReadGate } from '../../app/Refusal';
import { Link, pathOrNull } from '../../app/router';
import { Text } from '../../lib/Text';
import { Band, CliLine, PageHeader, RelTime, Section, Table } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { COMMANDS } from './commands';
import { Actor, Chips, Fingerprint, HowToChange, NotBuiltBand, YesNo, listOf, useGrants } from './kit';
import type { GrantRow, GrantsAnswer, OwnerRow, SyncKeyRow } from './types';

/** The ticket or rule the read names for a kind it does not hold, else the one known here. */
const builtBy = (data: GrantsAnswer | undefined, kind: string, fallback: string): string => {
  const named = data?.not_built?.[kind];
  return typeof named === 'string' && named !== '' ? named : fallback;
};

// ── /grants ──────────────────────────────────────────────────────────────────────────────

export function GrantsScreen({ params }: ScreenProps) {
  const read = useGrants(params.repository);
  return (
    <>
      <PageHeader title="Grants" sub="The runner keys that may work on this repository, each with the capabilities and the tier its grant allows." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => {
          const grants = listOf<GrantRow>(data.grants);
          return (
            <>
              <HowToChange ids={['grantAdd', 'grantRevoke']} />
              <Section title="Grants in force" count={grants.length}>
                <Table<GrantRow>
                  label="Grants in force"
                  rows={grants}
                  rowKey={(g, i) => `${g.credential_id}-${i}`}
                  empty="No runner key is granted on this repository."
                  columns={[
                    { head: 'Key', rowHeader: true, cell: (g) => <Fingerprint value={g.credential_id} /> },
                    { head: 'Hostname', cell: (g) => <Text mono value={g.hostname} /> },
                    { head: 'Label', cell: (g) => <Text value={g.label} className="label-cell" /> },
                    { head: 'Capabilities', cell: (g) => <Chips values={parsedList(g.capabilities)} /> },
                    { head: 'Max tier', cell: (g) => (g.max_tier == null ? <span className="mut">any</span> : <Text mono value={g.max_tier} />) },
                    { head: 'Claims at once', cell: (g) => <Text value={g.max_claims} /> },
                    { head: 'Role', cell: (g) => <GrantRole grant={g} /> },
                    { head: 'Granted', cell: (g) => <><RelTime at={g.granted_at} /><div className="sub-line">by <Actor value={g.granted_by} /></div></> },
                    { head: 'Also granted on', cell: (g) => <OtherRepositories ids={listOf<string>(g.other_repositories)} /> },
                  ]}
                />
              </Section>
              <NotBuiltBand lead="A grant’s acceptance by its holder, and its sync and checker marks, are not built yet" by={builtBy(data, 'grant_acceptance', 'R-BTN-146')}>
                <p>Every grant listed is in force from the moment it is made: none is pending.</p>
              </NotBuiltBand>
            </>
          );
        }}
      </ReadGate>
    </>
  );
}

/** A grant's role and domain (R-BTN-180), and who set them. A grant with no role is a runner's. */
function GrantRole({ grant }: { grant: GrantRow }) {
  return (
    <>
      {grant.role == null ? <span className="mut">runner</span> : <Text mono value={grant.role} />}
      {grant.domain == null ? null : <> · domain <Text mono value={grant.domain} /></>}
      {grant.set_by == null ? null : <div className="sub-line">set by <Actor value={grant.set_by} /></div>}
    </>
  );
}

/** A grant's capabilities arrive as the stored JSON text or as a list: either is a list here. */
function parsedList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [v];
  } catch {
    return [v];
  }
}

function OtherRepositories({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="mut">no other</span>;
  return (
    <>
      {ids.map((id, i) => {
        const to = pathOrNull('repository/grants', { repository: id });
        return <span key={i}>{i ? ', ' : ''}{to ? <Link to={to}><Text mono value={id} /></Link> : <Text mono value={id} />}</span>;
      })}
    </>
  );
}

// ── /owners ──────────────────────────────────────────────────────────────────────────────

export function OwnersScreen({ params, repos, role }: ScreenProps) {
  const read = useGrants(params.repository);
  const seeded = (repos.seed_owners ?? []).includes(params.repository);
  return (
    <>
      <PageHeader title="Owners" sub="The keys that own this repository: they grant runner keys, set its bars, settings and policy." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => {
          const owners = listOf<OwnerRow>(data.owners);
          return (
            <>
              <HowToChange ids={['ownerAdd', 'ownerRemove']} />
              {seeded ? (
                <Band tone="warn">
                  <p>This repository is owned only by the keys the deployment seeded{owners.length === 0 ? ' (it has no owner key of its own)' : ''}. Give it an owner of its own{role === 'administrator' ? ':' : ' — an administrator runs:'}</p>
                  <p><CliLine>{COMMANDS.seedOwnerAdd.line}</CliLine></p>
                </Band>
              ) : null}
              <Section title="Owner keys" count={owners.length}>
                <Table<OwnerRow>
                  label="Owner keys"
                  rows={owners}
                  rowKey={(o, i) => `${o.fingerprint}-${i}`}
                  empty="This repository has no owner key."
                  columns={[
                    { head: 'Key', rowHeader: true, cell: (o) => <Fingerprint value={o.fingerprint} /> },
                    { head: 'Kind', cell: (o) => <Text mono value={o.kind} /> },
                    { head: 'Human-only', cell: (o) => <YesNo value={o.human_only} yes="human-only" no="no" /> },
                    { head: 'Added by', cell: (o) => <Actor value={o.added_by} /> },
                    { head: 'Added', cell: (o) => <RelTime at={o.added_at} /> },
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

// ── /sync-keys ───────────────────────────────────────────────────────────────────────────

export function SyncKeysScreen({ params }: ScreenProps) {
  const read = useGrants(params.repository);
  return (
    <>
      <PageHeader title="Sync keys" sub="The keys this repository’s sync and mirror prove themselves with, each in one role." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => {
          const keys = listOf<SyncKeyRow>(data.sync_keys);
          return (
            <>
              <HowToChange ids={['syncKeyAdd', 'mirrorKeyAdd', 'syncKeyRemove']} />
              <Section title="Sync keys" count={keys.length}>
                <Table<SyncKeyRow>
                  label="Sync keys"
                  rows={keys}
                  rowKey={(k, i) => `${k.fingerprint}-${i}`}
                  empty="This repository has no sync key: its sync proves itself by its CI identity, or does not run."
                  columns={[
                    { head: 'Key', rowHeader: true, cell: (k) => <Fingerprint value={k.fingerprint} /> },
                    { head: 'Role', cell: (k) => <Text mono value={k.role} /> },
                    { head: 'Added by', cell: (k) => <Actor value={k.added_by} /> },
                    { head: 'Added', cell: (k) => <RelTime at={k.added_at} /> },
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

// ── the kinds that are not built: /tokens, /mcp-keys, /check-runners ─────────────────────

export function TokensScreen({ params }: ScreenProps) {
  const read = useGrants(params.repository);
  return (
    <>
      <PageHeader title="Tokens" sub="Registration tokens: an owner-minted token with which a session that has no key registers one." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => (
          <NotBuiltBand lead="Registration tokens are not built yet" by={builtBy(data, 'tokens', 'R-BTN-117')}>
            <p>No token can be minted, so there is none to list. A runner works here with a key an owner grants — see <GrantsLink repository={params.repository} />.</p>
          </NotBuiltBand>
        )}
      </ReadGate>
    </>
  );
}

export function McpKeysScreen({ params }: ScreenProps) {
  const read = useGrants(params.repository);
  return (
    <>
      <PageHeader title="MCP keys" sub="Delegated keys: a bearer an owner’s tool holds, acting as an owner for the actions listed when it was minted." />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => (
          <NotBuiltBand lead="MCP keys are not built yet" by={builtBy(data, 'mcp_keys', 'B-124')}>
            <p>Baton serves no MCP endpoint and registers no delegated key, so there is none to list.</p>
          </NotBuiltBand>
        )}
      </ReadGate>
    </>
  );
}

export function CheckRunnersScreen({ params }: ScreenProps) {
  const read = useGrants(params.repository);
  return (
    <>
      <PageHeader title="Check-runners" />
      <ReadGate read={read} entity="repository" id={params.repository}>
        {(data) => (
          <NotBuiltBand lead="The check-runner is not built, and will not be" by={builtBy(data, 'check_runners', 'B-290')}>
            <p>The owner cut the check-runner on 2026-11-19; the ticket named here removes what was built of it, this page included. There is nothing to list.</p>
          </NotBuiltBand>
        )}
      </ReadGate>
    </>
  );
}

function GrantsLink({ repository }: { repository: string }) {
  const to = pathOrNull('repository/grants', { repository });
  return to ? <Link to={to}>Grants</Link> : <>Grants</>;
}
