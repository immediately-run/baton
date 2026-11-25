// Sidebar.tsx — the frame's sidebar (B-206 item 1): the brand and this Baton's origin, the
// repository picker, the current repository's screens with their counts, the tenant screens for
// an administrator's session, the freshness line, and the footer — theme and logout. Every
// count comes from the repository's `repo.list` row and from nothing else (B-208): no screen
// supplies one. Tenant entries are shown by `repo.list.session.role`; nothing else is hidden by
// a role — the server's answer draws or refuses.
import type { ReactNode } from 'react';
import { span, utcClock } from '../lib/format';
import { useFreshness, useNow } from '../lib/reads';
import type { RepoList, RepoRow, SessionRole } from '../lib/types';
import { NAV_LABEL, REPOSITORY_NAV, TENANT_NAV, navIdOf, type NavGroup } from './nav';
import { Link, navigate, pathOrNull, type Route } from './router';
import { ThemeToggle } from './theme';

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** A sidebar entry's count, from the `repo.list` row alone: Tickets — ready and running;
 *  Runners — alive of total; Conditions — what needs a person; Sync — a week's discrepancies. */
export function navCount(id: string, row: RepoRow): { text: string; label: string; warn?: boolean } | null {
  const ready = num(row.ready);
  const running = num(row.running);
  const alive = num(row.runners_alive);
  const total = num(row.runners_total);
  const needs = num(row.needs_you);
  const disc = num(row.discrepancies_7d);
  switch (id) {
    case 'repository/tickets':
      return ready === null && running === null ? null : { text: `${ready ?? '—'} · ${running ?? '—'}`, label: `${ready ?? 'unknown'} ready, ${running ?? 'unknown'} running` };
    case 'repository/runners':
      return alive === null && total === null ? null : { text: `${alive ?? '—'}/${total ?? '—'}`, label: `${alive ?? 'unknown'} alive of ${total ?? 'unknown'}` };
    case 'repository/conditions':
      return needs === null ? null : { text: String(needs), label: `${needs} open`, warn: needs > 0 };
    case 'repository/sync':
      return disc === null ? null : { text: String(disc), label: `${disc} discrepancies in 7 days`, warn: disc > 0 };
    default:
      return null;
  }
}

function Brand() {
  return (
    <div className="brand">
      <svg aria-hidden="true" viewBox="0 0 512 512" width="28" height="28" fill="none">
        <rect width="512" height="512" rx="112" className="brand-bg" />
        <path d="M406.688 169 A174 174 0 1 0 406.688 343" className="brand-ink" strokeWidth="20" strokeLinecap="round" />
        <g transform="rotate(40 256 256)">
          <rect x="236" y="112" width="40" height="288" rx="20" className="brand-fill" />
        </g>
      </svg>
      <div className="brand-text">
        <Link to="/" className="brand-name">Baton</Link>
        <span className="brand-origin">{window.location.host}</span>
      </div>
    </div>
  );
}

function Group({ group, params, current, count }: { group: NavGroup; params: Record<string, string>; current: string | null; count?: (id: string) => ReactNode }) {
  const items = group.ids.map((id) => ({ id, to: pathOrNull(id, params) })).filter((i): i is { id: string; to: string } => i.to !== null);
  if (items.length === 0) return null;
  const list = (
    <ul className="nav-list">
      {items.map(({ id, to }) => (
        <li key={id}>
          <Link to={to} className="nav-item" current={current === id}>
            <span className="nav-label">{NAV_LABEL[id] ?? id}</span>
            {count?.(id)}
          </Link>
        </li>
      ))}
    </ul>
  );
  if (!group.label) return list;
  return (
    <div className="nav-group">
      <h3 className="nav-group-h">{group.label}</h3>
      {list}
    </div>
  );
}

/** The freshness line (B-221 item 2): measured from the last `200` or `304` by the browser's
 *  clock — "Live · updated 7 s ago", "Stale since 12:04 — forbidden: …". Any refusal that is not
 *  a screen of its own is drawn here as its code and message, as text. */
export function FreshnessLine() {
  const fresh = useFreshness();
  const now = useNow(1000);
  let head: ReactNode;
  let tone = 'ok';
  if (fresh.stopped) {
    head = 'Signed out';
    tone = 'mut';
  } else if (fresh.error) {
    tone = 'bad';
    head = (
      <>
        Stale since <span className="mono">{fresh.okAt === null ? '—' : utcClock(fresh.okAt)}</span> — <span className="mono">{fresh.error.code}</span>: {fresh.error.message}
      </>
    );
  } else if (fresh.okAt === null) {
    head = 'Loading…';
    tone = 'mut';
  } else if (fresh.paused) {
    head = 'Paused while this page is hidden';
    tone = 'mut';
  } else head = <>Live · updated <span className="mono">{span(Math.max(0, now - fresh.okAt))}</span> ago</>;
  return (
    <div className="fresh">
      <span className={`fresh-line tone-${tone}`}>
        <span className="fresh-dot" aria-hidden="true" />
        <span role={fresh.error ? 'alert' : undefined}>{head}</span>
      </span>
      <span className="fresh-every">Polls every {span(fresh.interval)}</span>
    </div>
  );
}

export function Sidebar({ id, open, route, repos, row, role, onLogout }: { id: string; open: boolean; route: Route | null; repos: RepoList | null; row: RepoRow | null; role: SessionRole | null; onLogout: () => void }) {
  const current = route ? navIdOf(route.screen.id) : null;
  const picked = route?.params.repository ?? '';
  const list = repos?.repositories ?? [];
  const pick = (repository: string) => {
    if (repository === '') {
      navigate('/');
      return;
    }
    // The same screen of the other repository where there is one, else its board.
    const same = current && current.startsWith('repository/') ? pathOrNull(current, { repository }) : null;
    navigate(same ?? pathOrNull('repository/board', { repository }) ?? '/');
  };
  return (
    <aside id={id} className={`side${open ? ' open' : ''}`}>
      <div className="side-in">
        <Brand />
        <nav aria-label="Screens" className="nav">
          <label className="picker">
            <span className="picker-label">Repository</span>
            <select className="input" value={list.some((r) => r.id === picked) ? picked : ''} onChange={(e) => pick(e.target.value)}>
              <option value="">{list.length ? 'All repositories' : 'No repository'}</option>
              {list.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            </select>
          </label>
          <ul className="nav-list">
            <li><Link to="/" className="nav-item" current={current === 'root'}><span className="nav-label">{NAV_LABEL.root}</span><span className="nav-count">{list.length}</span></Link></li>
          </ul>
          {row ? REPOSITORY_NAV.map((g, i) => (
            <Group
              key={i}
              group={g}
              params={{ repository: row.id }}
              current={current}
              count={(navId) => {
                const c = navCount(navId, row);
                return c ? <span className={`nav-count${c.warn ? ' tone-warn' : ''}`} title={c.label} aria-label={c.label}>{c.text}</span> : null;
              }}
            />
          )) : null}
          {role === 'administrator' ? <Group group={TENANT_NAV} params={{}} current={current} /> : null}
        </nav>
        <FreshnessLine />
        <div className="side-foot">
          <ThemeToggle />
          <button type="button" className="btn btn-quiet" onClick={onLogout}>Log out</button>
        </div>
      </div>
    </aside>
  );
}
