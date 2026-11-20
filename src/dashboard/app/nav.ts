// nav.ts — how the sidebar words and groups the screens of `src/core/screens.ts` (B-206 item 1):
// the entity tree of the project page, not the mockup's navigation. This is no second list of
// screens — the router reads `screens.ts` alone; a test holds every entry here to a screen
// there and every list-level screen there to an entry here. Labels are Baton's own words.

/** A sidebar entry's label, by screen id. A screen with a `{param}` of its own (one ticket, one
 *  runner) is reached from its list and has no entry. */
export const NAV_LABEL: Record<string, string> = {
  root: 'Repositories',
  'repository/board': 'Board',
  'repository/tickets': 'Tickets',
  'repository/goals': 'Goals',
  'repository/courses': 'Courses',
  'repository/conditions': 'Conditions',
  'repository/runners': 'Runners',
  'repository/grants': 'Grants',
  'repository/owners': 'Owners',
  'repository/tokens': 'Tokens',
  'repository/mcp-keys': 'MCP keys',
  'repository/sync-keys': 'Sync keys',
  'repository/check-runners': 'Check-runners',
  'repository/policy': 'Policy',
  'repository/settings': 'Settings',
  'repository/bars': 'Bars',
  'repository/consents': 'Consents',
  'repository/attestations': 'Attestations',
  'repository/sync': 'Sync',
  'tenant/repositories': 'Registry',
  'tenant/instances': 'Instances',
  'tenant/resources': 'Resources',
  'tenant/capacities': 'Capacities',
  'tenant/settings': 'Instance settings',
  'tenant/state': 'State',
  'tenant/sessions': 'Sessions',
};

export interface NavGroup {
  /** The group's heading; none for the entries that stand alone. */
  label?: string;
  ids: string[];
}

/** One repository's screens, in the tree's order. */
export const REPOSITORY_NAV: NavGroup[] = [
  { ids: ['repository/board', 'repository/tickets', 'repository/goals', 'repository/courses', 'repository/conditions', 'repository/runners'] },
  { label: 'Credentials', ids: ['repository/grants', 'repository/owners', 'repository/tokens', 'repository/mcp-keys', 'repository/sync-keys', 'repository/check-runners'] },
  { label: 'Governance', ids: ['repository/policy', 'repository/settings', 'repository/bars', 'repository/consents', 'repository/attestations'] },
  { ids: ['repository/sync'] },
];

/** The tenant screens — an administrator's session only (§11.4). */
export const TENANT_NAV: NavGroup = {
  label: 'Tenant',
  ids: ['tenant/repositories', 'tenant/instances', 'tenant/resources', 'tenant/capacities', 'tenant/settings', 'tenant/state', 'tenant/sessions'],
};

/** The sidebar entry a screen belongs under: itself, or — for one ticket, one runner — its list. */
export function navIdOf(screenId: string): string {
  return screenId.replace(/\/\{[^}]+\}$/, '');
}

/** A screen's words for the page's title and the top bar. */
export function titleOf(screenId: string): string {
  return NAV_LABEL[navIdOf(screenId)] ?? screenId;
}
