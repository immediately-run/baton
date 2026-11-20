// needsYouLedger.ts — B-203's listing ledger: for each key of `stateView().needs_you` — what
// V1's Needs you drew — the V2 read that answers it, the field of that read's answer, and the
// screen that draws the field. Pure data, read by S-BTN-305 (both hosts: the keys equal the
// state's at run time, every read is a registered action, and each field equals the state's
// list narrowed to its repository) and by test/ui/S-BTN-305.ledger.test.tsx (each screen is a
// registered screen whose component draws the field).
//
// B-57 is not built, so no listing is a `baton.<sub>` condition yet: the repository's listings
// are served as they are under `repo.needs-you`'s `listings` and drawn on Conditions under
// "Also waiting"; the instance's are `admin.tenant`'s `needs_you`, drawn on State.

/** One home of a listing. `field` is a dotted path into the read's answer. */
export type Home = {
  /** The registry id of the read (src/core/actions.ts). */
  action: string;
  field: string;
  /** The id of the screen that draws it (src/core/screens.ts). */
  screen: string;
  /** What the home holds of the key's rows: all of them narrowed to the repository
   *  (`repository`), every row (`instance`), or a named part where the key is split in two. */
  holds: 'repository' | 'instance' | 'declaring-a-course' | 'declaring-no-course';
};

const listing = (key: string): Home => ({ action: 'repo.needs-you', field: `listings.${key}`, screen: 'repository/conditions', holds: 'repository' });
const tenant = (key: string): Home => ({ action: 'admin.tenant', field: `needs_you.${key}`, screen: 'tenant/state', holds: 'instance' });

export const LEDGER: Record<string, Home[]> = {
  // The claims' (src/core/claims.ts `needsYou`).
  unconfirmed: [listing('unconfirmed')],
  unacknowledged_releases: [listing('unacknowledged_releases')],
  fence_pending: [listing('fence_pending')],
  regressed: [listing('regressed')],
  policy: [listing('policy')],
  bars_mismatch: [listing('bars_mismatch')],
  held_items: [listing('held_items')],
  // A runner below one course's version is that course's repository's; one declaring no
  // course at all belongs to no repository, and is the instance's.
  stale_skills: [
    { ...listing('stale_skills'), holds: 'declaring-a-course' },
    { action: 'admin.tenant', field: 'needs_you.stale_skills_no_course', screen: 'tenant/state', holds: 'declaring-no-course' },
  ],
  // The blocks' (src/core/blocks.ts).
  blocked_capability: [listing('blocked_capability')],
  instances_unknown: [tenant('instances_unknown')],
  // The notices' (src/core/notices.ts).
  pool_unclaimed: [listing('pool_unclaimed')],
  no_owner_channel: [listing('no_owner_channel')],
  // The stations' (src/core/stations.ts).
  course_changed: [listing('course_changed')],
  // An adoption is an administrator's to confirm, on Sync, where its control is (R-BTN-28);
  // Conditions lists it too and points there.
  adoptions: [{ action: 'repo.sync', field: 'adoptions', screen: 'repository/sync', holds: 'repository' }, listing('adoptions')],
  courses_refused: [listing('courses_refused')],
  keys: [tenant('keys')],
  capacity: [tenant('capacity')],
  stale_clients: [tenant('stale_clients')],
  // A scope finding is listed on Conditions and, with its control, on its ticket's page.
  scope: [listing('scope')],
  questions: [{ action: 'repo.needs-you', field: 'questions', screen: 'repository/conditions', holds: 'repository' }],
  conditions: [{ action: 'repo.needs-you', field: 'conditions', screen: 'repository/conditions', holds: 'repository' }],
  unsigned_control: [listing('unsigned_control')],
};
