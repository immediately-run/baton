// RootScreen.tsx — the root screen, `/` (B-208 item 1): the caller's repositories as cards, from
// `GET /v1/repositories` alone — the read the shell already holds, handed down as `repos`. Each
// card: the forge path (linking the forge through `web_base`, R-BTN-92, the host shown), the
// head's short sha and age, the mode as a text mark, the three counts, the runners alive, the
// course ids; it opens the repository's board. Ordered by `needs_you` descending, then id — the
// repository that needs a person first, and by nothing the read does not carry. No control and
// no second read. Forge paths, shas and titles are a read's text (§12.3).
import { useEffect } from 'react';
import { CountText, NEEDS_LABEL, isShadow } from '../../app/Strip';
import { Link, navigate, pathOrNull } from '../../app/router';
import { shortSha } from '../../lib/format';
import { ExtLink, forgeHref } from '../../lib/links';
import { Text } from '../../lib/Text';
import type { RepoRow } from '../../lib/types';
import { Badge, Band, Card, Cards, CliLine, Empty, PageHeader, RelTime } from '../../lib/ui';
import type { ScreenProps } from '../contract';

const needs = (r: RepoRow) => (typeof r.needs_you === 'number' ? r.needs_you : 0);

/** `needs_you` descending, then id. */
export function orderRepositories(rows: readonly RepoRow[]): RepoRow[] {
  return [...rows].sort((a, b) => needs(b) - needs(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function RepositoryCard({ row }: { row: RepoRow }) {
  const board = pathOrNull('repository/board', { repository: row.id });
  const to = (id: string) => pathOrNull(id, { repository: row.id }) ?? '/';
  const forge = forgeHref(row.web_base);
  const path = row.github ?? row.id;
  const courses = (row.courses ?? []).map((c) => c.id).filter((id) => typeof id === 'string');
  return (
    <Card
      className="repo-card"
      title={board ? <Link to={board}><Text value={row.id} /></Link> : <Text value={row.id} />}
      aside={isShadow(row) ? <Badge title="Git holds this repository’s claims; Baton records them.">SHADOW</Badge> : <Badge tone="ok"><Text value={row.mode ?? '—'} /></Badge>}
    >
      <p className="repo-forge">
        {forge ? <ExtLink href={forge} showHost><Text mono value={path} /></ExtLink> : <Text mono value={path} />}
      </p>
      <p className="repo-counts">
        <Link to={to('repository/board')}>running now <CountText n={row.running} /></Link>
        <span aria-hidden="true"> · </span>
        <Link to={to('repository/tickets')}>ready <CountText n={row.ready} /></Link>
        <span aria-hidden="true"> · </span>
        <Link to={to('repository/conditions')} className={needs(row) > 0 ? 'strip-needs' : undefined}>{NEEDS_LABEL} <CountText n={row.needs_you} /></Link>
      </p>
      <dl className="kv repo-kv">
        <div className="kv-row"><dt>head</dt><dd>{row.head ? <><Text mono value={shortSha(row.head.sha)} />{row.head.received_at != null ? <> · <RelTime at={row.head.received_at} /></> : null}</> : <span className="mut">no board received yet</span>}</dd></div>
        <div className="kv-row"><dt>runners</dt><dd><CountText n={row.runners_alive} /> alive of <CountText n={row.runners_total} /></dd></div>
        <div className="kv-row"><dt>courses</dt><dd>{courses.length ? courses.map((id, i) => <span key={id}>{i ? ', ' : ''}<Text mono value={id} /></span>) : <span className="mut">none</span>}</dd></div>
      </dl>
    </Card>
  );
}

export function RootScreen({ repos, role }: ScreenProps) {
  const rows = orderRepositories(repos.repositories);
  // B-208: an owner's session with one repository is sent to its board.
  const only = role === 'owner' && rows.length === 1 ? pathOrNull('repository/board', { repository: rows[0].id }) : null;
  useEffect(() => {
    if (only) navigate(only, { replace: true });
  }, [only]);
  if (only) return null;
  const seeded = (repos.seed_owners ?? []).filter((id) => typeof id === 'string');
  return (
    <>
      <PageHeader title="Repositories" sub={role === 'owner' ? 'The repositories your key owns.' : 'Every repository registered on this Baton.'} />
      {role === 'administrator' && seeded.length > 0 ? (
        <Band tone="warn">
          <p>
            Owned only by the seeded owner keys: {seeded.map((id, i) => <span key={id}>{i ? ', ' : ''}<Text mono value={id} /></span>)}.
            Give each an owner of its own:
          </p>
          <p><CliLine>baton admin repo set &lt;repository&gt; --add-owner-key &lt;public key&gt;</CliLine></p>
        </Band>
      ) : null}
      {rows.length === 0 ? (
        role === 'owner' ? (
          <Empty>Your key owns no repository. An owner of one adds your key: <CliLine>baton owner owners &lt;repository&gt; --add &lt;public key&gt;</CliLine></Empty>
        ) : (
          <Empty>No repository is registered. Register one: <CliLine>baton admin repo add &lt;forge path&gt; --owner-key &lt;public key&gt;</CliLine></Empty>
        )
      ) : (
        <Cards>{rows.map((row) => <RepositoryCard key={row.id} row={row} />)}</Cards>
      )}
    </>
  );
}
