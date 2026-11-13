// screens.ts — the dashboard's one table of screens (BATON_SPEC §11.4): every path the front
// serves the shell at (B-193), the id the registry's `ui.view` names a screen by (R-BTN-129,
// §11.3) and B-204's check:actions reads, and the session role that may open it — the same table
// B-221's client router reads, so no second list exists anywhere. Baton's own, so it is not under
// the vendored `src/shared/`. Pure data and two pure predicates: no import, nothing a host or a
// course owns. `/login` is not a screen — R-BTN-155's sign-in page, served by the front beside
// the tree — and neither is `/conditions/{id}`, B-195's redirect address.

/** Who may open a screen: any dashboard session — an owner's on the repositories its key still
 *  owns (R-BTN-155) — or an administrator's only, the tenant screens. */
export type ScreenRole = 'any' | 'administrator';

/** One screen of §11.4. `id` follows §11.3's grammar — `root`, `tenant/<segment>` or
 *  `repository/<segment>[/{param}]` — and `path` is its URL pattern, each `{param}` one
 *  id-shaped segment. */
export type Screen = { id: string; path: string; role: ScreenRole };

export const SCREENS: Screen[] = [
  { id: 'root', path: '/', role: 'any' },
  // The repository screens, under `/repositories/{repository}` — an owner's session reaches its
  // own repositories, an administrator's every one (R-BTN-155).
  { id: 'repository/board', path: '/repositories/{repository}/board', role: 'any' },
  { id: 'repository/tickets', path: '/repositories/{repository}/tickets', role: 'any' },
  { id: 'repository/tickets/{ticket}', path: '/repositories/{repository}/tickets/{ticket}', role: 'any' },
  { id: 'repository/goals', path: '/repositories/{repository}/goals', role: 'any' },
  { id: 'repository/courses', path: '/repositories/{repository}/courses', role: 'any' },
  { id: 'repository/courses/{course}', path: '/repositories/{repository}/courses/{course}', role: 'any' },
  { id: 'repository/conditions', path: '/repositories/{repository}/conditions', role: 'any' },
  { id: 'repository/conditions/{condition}', path: '/repositories/{repository}/conditions/{condition}', role: 'any' },
  { id: 'repository/runners', path: '/repositories/{repository}/runners', role: 'any' },
  { id: 'repository/runners/{runner}', path: '/repositories/{repository}/runners/{runner}', role: 'any' },
  { id: 'repository/grants', path: '/repositories/{repository}/grants', role: 'any' },
  { id: 'repository/owners', path: '/repositories/{repository}/owners', role: 'any' },
  { id: 'repository/tokens', path: '/repositories/{repository}/tokens', role: 'any' },
  { id: 'repository/mcp-keys', path: '/repositories/{repository}/mcp-keys', role: 'any' },
  { id: 'repository/sync-keys', path: '/repositories/{repository}/sync-keys', role: 'any' },
  { id: 'repository/check-runners', path: '/repositories/{repository}/check-runners', role: 'any' },
  { id: 'repository/policy', path: '/repositories/{repository}/policy', role: 'any' },
  { id: 'repository/settings', path: '/repositories/{repository}/settings', role: 'any' },
  { id: 'repository/bars', path: '/repositories/{repository}/bars', role: 'any' },
  { id: 'repository/consents', path: '/repositories/{repository}/consents', role: 'any' },
  { id: 'repository/attestations', path: '/repositories/{repository}/attestations', role: 'any' },
  { id: 'repository/sync', path: '/repositories/{repository}/sync', role: 'any' },
  // The tenant screens — an administrator's session only (§11.4).
  { id: 'tenant/repositories', path: '/repositories', role: 'administrator' },
  { id: 'tenant/instances', path: '/instances', role: 'administrator' },
  { id: 'tenant/resources', path: '/resources', role: 'administrator' },
  { id: 'tenant/capacities', path: '/capacities', role: 'administrator' },
  { id: 'tenant/settings', path: '/settings', role: 'administrator' },
  { id: 'tenant/state', path: '/state', role: 'administrator' },
  { id: 'tenant/sessions', path: '/sessions', role: 'administrator' },
];

/** One id-shaped segment, §12.3's identifier rule relaxed to cover every screen's parameters
 *  alike — a repository, a ticket's local id, a course, a condition, a runner. The front serves
 *  the shell for any id-shaped segment and looks nothing up; the screen's own reads decide
 *  whether the id exists (§11.4's "No such ticket"). */
export const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** A screen's `path` as a served pattern: each `{param}` takes one id-shaped segment, every
 *  literal segment is itself. */
const patternOf = (screen: Screen) =>
  new RegExp(`^${screen.path.split('/').map((seg) => (seg.startsWith('{') ? ID_SEGMENT.source.slice(1, -1) : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);

const SCREEN_PATTERNS = SCREENS.map(patternOf);

/** Does `pathname` name one of §11.4's screens, its parameters id-shaped segments? */
export function isScreenPath(pathname: string): boolean {
  return SCREEN_PATTERNS.some((p) => p.test(pathname));
}
