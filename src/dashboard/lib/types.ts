// types.ts — the shapes the shell reads (BATON-UI-V2: B-204's `repo.list` and `actions.list`,
// the registry entry of `src/core/actions.ts`). The registry's own types are imported as types
// only — erased at build, so nothing of the core reaches the bundle — and every field of a read
// is still untrusted data: drawn through `Text` or `View`, never trusted for its shape beyond
// what `asRepoList` checks.
import type { Action, InputProperty, InputSchema, SessionRole } from '../../core/actions';

export type { Action, InputProperty, InputSchema, SessionRole };

/** One repository as `GET /v1/repositories` lists it (B-204). Counts and ids only (R-BTN-33). */
export interface RepoRow {
  id: string;
  github?: string | null;
  forge?: string | null;
  web_base?: string | null;
  default_branch?: string | null;
  weight?: number;
  courses?: { id: string; version?: unknown }[];
  head?: { sha: string; received_at?: number | string | null; observation?: unknown } | null;
  mode?: string;
  running?: number;
  ready?: number;
  needs_you?: number;
  runners_alive?: number;
  runners_total?: number;
  discrepancies_7d?: number;
  exclusive_goal?: { id: string; title: string } | null;
}

/** `GET /v1/repositories`'s answer: the caller's repositories, its session's role once, and the
 *  instance's link allow-lists for the client's link rule (§12.3). */
export interface RepoList {
  repositories: RepoRow[];
  session: { role: SessionRole } | null;
  link_hosts: string[];
  session_hosts: string[];
  seed_owners?: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** A read's answer as a `RepoList`, tolerant of what an older or newer server leaves out: rows
 *  without a string `id` are dropped, a missing list is empty. */
export function asRepoList(v: unknown): RepoList {
  const o = isObj(v) ? v : {};
  const rows = Array.isArray(o.repositories) ? o.repositories.filter((r): r is RepoRow => isObj(r) && typeof r.id === 'string') : [];
  const role = isObj(o.session) && (o.session.role === 'administrator' || o.session.role === 'owner') ? o.session.role : null;
  return {
    repositories: rows,
    session: role ? { role } : null,
    link_hosts: strings(o.link_hosts),
    session_hosts: strings(o.session_hosts),
    ...(Array.isArray(o.seed_owners) ? { seed_owners: strings(o.seed_owners) } : {}),
  };
}

/** `GET /v1/actions`'s answer as its entries; anything that is not an entry is dropped. */
export function asActions(v: unknown): Action[] {
  const list = isObj(v) && Array.isArray(v.actions) ? v.actions : Array.isArray(v) ? v : [];
  return list.filter((a): a is Action => isObj(a) && typeof a.id === 'string' && isObj(a.http) && typeof (a.http as Record<string, unknown>).path === 'string');
}
