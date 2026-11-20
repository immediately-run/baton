// Strip.tsx — the overview strip (B-208 item 2), drawn by the shell on every repository screen
// from the screen's `repo.list` row and from nothing else: "running now n · ready n · needs you
// n", each a link to Board, Tickets and Conditions; the head's short sha and its age; a SHADOW
// mark where the repository is not cut over; the exclusive goal where one is set. No control,
// no second read. The third count is labelled "conditions" until B-57 lands: it counts open
// conditions only (B-204), and the label says what the number is.
import { shortSha } from '../lib/format';
import { Text } from '../lib/Text';
import type { RepoRow } from '../lib/types';
import { Badge, RelTime } from '../lib/ui';
import { Link, pathOrNull } from './router';

/** The third count's label (B-204, B-208): "needs you" once B-57 counts queued person legs too. */
export const NEEDS_LABEL = 'conditions';

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** A count as text; an em dash where the read carries none — never a made-up zero. */
export function CountText({ n }: { n: unknown }) {
  const v = num(n);
  return <span className="mono strip-n">{v === null ? '—' : String(v)}</span>;
}

/** Is the repository's mode anything but cut over? (R-BTN-28: `shadow` until the cut-over.) */
export const isShadow = (row: RepoRow) => row.mode !== undefined && row.mode !== 'cut-over';

export function Strip({ row }: { row: RepoRow }) {
  const to = (id: string) => pathOrNull(id, { repository: row.id }) ?? '/';
  const needs = num(row.needs_you);
  return (
    <nav className="strip" aria-label="Repository overview">
      <span className="strip-counts">
        <Link to={to('repository/board')} className="strip-item">running now <CountText n={row.running} /></Link>
        <span aria-hidden="true" className="strip-dot">·</span>
        <Link to={to('repository/tickets')} className="strip-item">ready <CountText n={row.ready} /></Link>
        <span aria-hidden="true" className="strip-dot">·</span>
        <Link to={to('repository/conditions')} className={`strip-item${needs ? ' strip-needs' : ''}`}>{NEEDS_LABEL} <CountText n={row.needs_you} /></Link>
      </span>
      <span className="strip-meta">
        <span className="strip-head">head <Text mono value={row.head ? shortSha(row.head.sha) : '—'} />{row.head?.received_at != null ? <> · received <RelTime at={row.head.received_at} /></> : null}</span>
        {isShadow(row) ? <Badge title="Git holds this repository’s claims; Baton records them.">SHADOW</Badge> : null}
        {row.exclusive_goal ? <Link to={to('repository/goals')} className="strip-goal">exclusive goal: <Text value={row.exclusive_goal.title} /></Link> : null}
      </span>
    </nav>
  );
}
