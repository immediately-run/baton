// screenFixtures.ts — the reads of the screens S-BTN-76 and S-BTN-307 draw, as one route table
// for the mocked `fetch` (./helpers.tsx), with one string planted in every field a person, a
// runner, a leg or an instrument wrote and one URL in every field a link is built from. The
// shapes are the reads' own (src/core/reads/*); the names in them are the fixture's.
import { repoList, repoRow, type Route } from './helpers';

const HOUR = 3_600_000;
const MIN = 60_000;

/** The pages the fixtures stand behind, by screen id. */
export const PAGES = {
  'repository/tickets': '/repositories/docs/tickets',
  'repository/tickets/{ticket}': '/repositories/docs/tickets/T-1',
  'repository/runners': '/repositories/docs/runners',
  'repository/runners/{runner}': '/repositories/docs/runners/3',
  'repository/conditions': '/repositories/docs/conditions',
  'repository/conditions/{condition}': '/repositories/docs/conditions/4',
  'repository/attestations': '/repositories/docs/attestations',
  'repository/sync': '/repositories/docs/sync',
  'tenant/instances': '/instances',
} as const;

export type PageId = keyof typeof PAGES;

/** Every read behind `PAGES`, with `text` and `url` planted. `actions` is what `GET
 *  /v1/actions` answers the session; `role` its role. */
export function screenRoutes(text: string, url: string, actions: unknown[] = [], role: 'administrator' | 'owner' = 'administrator'): Record<string, Route> {
  const now = Date.now();
  const ticket = '/v1/repositories/docs/tickets/T-1';
  const claim = {
    claim_id: 7, ticket_id: 'docs:T-1', station: 'station-b', leg: 'leg-b', run_id: 'r_01RUN', claimed_at: now - HOUR, lease_ends_at: now + HOUR, deadline_at: null,
    attempt: 2, max_runs: 3, next_backoff_until: null, session_url: url, log_dir: text, activity: { kind: 'kind-a', label: text, started_at: now - 4 * MIN },
  };
  const runner = {
    runner_id: 3, hostname: 'host-a', session_name: 'sess-three', alive: true, last_seen_at: now - MIN, last_activity_at: now - 5 * MIN, reaped_at: null,
    harness: 'harness-a', kind: 'vm', isolation: 'process', capabilities: [{ capability: 'cap-a', declared: text }], granted: ['cap-a'], tags: [text],
    courses: [{ course: 'course-a', version: 3, min_runner_version: 3 }], lease_timeout_s: 900, credential: { kind: 'runner', granted: true, role: null, domain: null },
    last_report: { payload: { text }, sent_at: now - 2 * MIN }, transcript_url: url, claim, claims: [claim], busy_elsewhere: false, reaped_claim: null,
  };
  return {
    '/v1/repositories': repoList([repoRow('docs')], role),
    '/v1/actions': { actions },

    // The Tickets table: held, running, and a dropped ticket with an unconfirmed claim.
    '/v1/repositories/docs/tickets': {
      tickets: [
        { ticket_id: 'docs:HELD', title: text, course: 'course-a', requires: [], requires_unmet: [], tags: [text], order: null, parent: null, expedite: false,
          position: { station: 'station-a', path_len: 0, next_leg: 'leg-a' }, state: 'held', reasons: [], detail: { set_by: 'owner:abc', reason: text, since: now - 2 * HOUR } },
        { ticket_id: 'docs:T-1', title: text, course: 'course-a', requires: [], requires_unmet: [], tags: [], order: null, parent: null, expedite: false,
          position: { station: 'station-b', path_len: 1, next_leg: 'leg-b' }, state: 'running', reasons: [],
          detail: { claim_id: 7, runner_id: 3, hostname: 'host-a', session_name: text, leg: 'leg-b', since: now - HOUR, lease_ends_at: now + HOUR, last_activity_at: now - MIN, alive: true, stalled: false, condition_wait: null } },
        { ticket_id: 'docs:GONE', title: null, course: null, requires: [], requires_unmet: [], tags: [], order: null, parent: null, expedite: false,
          position: null, state: 'unconfirmed', reasons: [], detail: { claim_id: 47 } },
      ],
      counts: { held: 1, running: 1, unconfirmed: 1, total: 3 }, matched: 3, server_time: now,
    },

    // The ticket's page and the reads it gathers.
    [ticket]: {
      ticket_id: 'docs:T-1', repository: 'docs', course_id: 'course-a', course: 'course-a', title: text, path: 'tickets/T-1.mdx', requires: ['cap-a'], requires_unmet: [], tags: [text], order: null, parent: null, expedite: false, children: [],
      station: { station: 'station-b', path: [{ leg: 'leg-a', reached: 'station-b' }], next_leg: 'leg-b', to_end: 2 },
      position: { station: 'station-b', path_len: 1, next_leg: 'leg-b', next_source: 'course' },
      last_written_by: { pusher: text, commit: 'abcdef0123456789', at: now - HOUR, human: false },
      state: 'running', reasons: ['held'],
      detail: { claim_id: 7, runner_id: 3, hostname: 'host-a', session_name: 'sess-three', leg: 'leg-b', since: now - HOUR, lease_ends_at: now + HOUR, stalled: false, alive: true, condition_wait: null },
      claim: { claim_id: 7, runner_id: 3, hostname: 'host-a', session_name: 'sess-three', leg: 'leg-b', run_id: 'r_01RUN', claimed_at: now - HOUR, lease_ends_at: now + HOUR,
        deadline_at: null, attempt: 2, max_runs: 3, next_backoff_until: null, session_url: url, log_dir: text, alive: true, stalled: false },
      attempts: [{ run: 1, claim_id: 5, runner_id: 2, hostname: 'host-b', started_at: now - 5 * HOUR, ended_at: now - 4 * HOUR, end_reason: 'released:cannot-finish:transient', detail: text }],
      overrides: { expedite: false, hold: { set_by: 'owner:abc', reason: text, since: now - HOUR } },
      conditions: [{ condition_id: 31, type: text, severity: 'high', leg: 'leg-b', restarts: [text] }],
      scope: [{ id: 12, kind: 'scope-exceeded', target: text, ref: text, at: now - HOUR }],
      fence: null,
      resume: { end_reason: 'released:cannot-finish:transient', ended_at: now - 4 * HOUR, branches: [text], prs: [url] },
      web_url: url, allowed: ['ticket.unhold'], server_time: now,
    },
    [`${ticket}/blocks`]: { blocked: true, blocks: [{ kind: 'ticket', ref: text, since: now - HOUR }], other: [{ kind: 'claimed', detail: { note: text } }] },
    [`${ticket}/children`]: { children: [] },
    [`${ticket}/history`]: { rows: [
      { id: 9, at: now - HOUR, kind: 'leg-finished', leg: 'leg-a', run: 1, reached: 'station-b', next_leg: 'leg-b',
        detail: { note: text, inputs: [{ name: text, uri: url, digest: 'sha256:1111' }], outputs: [{ name: 'result', uri: url }] } },
    ] },
    [`${ticket}/legs/leg-a/runs`]: { runs: [{ run: 1, claim: 5, runner: 2, leg: 'leg-a', run_id: 'r_01OLD', started_at: now - 5 * HOUR, ended_at: now - 4 * HOUR, end: text, session_url: url, log_dir: text }] },
    [`${ticket}/legs/leg-b/runs`]: { runs: [{ run: 1, claim: 7, runner: 3, leg: 'leg-b', run_id: 'r_01RUN', started_at: now - HOUR, ended_at: null, end: null, session_url: url }] },

    // The runners: the list, and one runner's page with its window.
    '/v1/repositories/docs/runners': { runners: [runner], not_built: { executor: 'B-184' }, server_time: now },
    '/v1/repositories/docs/runners/3': {
      runner: { ...runner, profile: { note: text } },
      attempts: [{ run: 1, claim_id: 5, runner_id: 3, run_id: 'r_00', started_at: now - 12 * HOUR, ended_at: now - 6 * HOUR, end: 'released:requested', detail: text }],
      window: { since: now - 24 * HOUR, until: now, claims: [
        { claim_id: 5, ticket_id: 'docs:T-9', leg: 'leg-a', started_at: now - 12 * HOUR, ended_at: now - 6 * HOUR, end: 'released', end_reason: 'released:requested', detail: text,
          session_url: url, log_dir: text, runs: [],
          activities: [{ id: 'a-1', parent_id: null, kind: 'kind-a', label: text, source: 'skill', started_at: now - 11 * HOUR, ended_at: now - 8 * HOUR, outcome: 'succeeded', detail: { note: text } }] },
      ] },
      not_built: { executor: 'B-184' }, server_time: now,
    },

    // The Conditions list and the Resolve page. A condition's own `detail` is not stored yet
    // (B-55): one is planted all the same — drawn or not, it is never markup.
    '/v1/repositories/docs/needs-you': {
      repository: 'docs',
      conditions: [{ condition_id: 4, ticket_id: 'docs:T-1', leg: text, run_id: 'r_1', type: text, disposition: 'suspend', severity: 'high', raised_at: now - MIN, url, detail: text,
        restarts: { [text]: text }, default: null, outcome: 'open', closed_at: null, closed_how: null, resolve_url: '/repositories/docs/conditions/4', allowed: [] }],
      questions: [], listings: { held_items: [{ ticket_id: 'docs:HELD', hold_reason: text, set_at: now - HOUR, attempts: [] }] },
      held_posts: 0, elsewhere: [], not_built: { resolve: 'B-56' }, server_time: now,
    },
    '/v1/repositories/docs/conditions/4': {
      condition_id: 4, ticket_id: 'docs:T-1', leg: text, run_id: 'r_1', type: 'interact', disposition: 'notify', severity: 'high', raised_at: now - MIN, url, detail: text,
      restarts: { [text]: text }, default: null, outcome: 'open', closed_at: null, closed_how: null, resolve_url: '/repositories/docs/conditions/4', allowed: [],
      repository: 'docs', claim_id: 7, ticket: { ticket_id: 'docs:T-1', title: text, course_id: 'course-a', station: text, next_leg: 'leg-b' }, unblocks: [], not_built: { resolve: 'B-56' },
    },

    // The attestations, the Sync screen, and the tenant's instances with their readings.
    '/v1/repositories/docs/attestations': {
      attestations: [{ id: 1, type: text, subject: { ticket: 'docs:T-1', note: text }, value: { leg: 'leg-a', option: text, link: url }, writer: { credential: text, class: 'owner' },
        domain: text, at: now - MIN, lapses_at: null, revoked_at: null }],
      writable_types: [], writable_why: text, types: ['std:decision@1'], not_built: { store: 'B-146', session_write: 'B-76' },
    },
    '/v1/repositories/docs/sync': {
      repository: 'docs',
      head: { sha: 'cabec94c0123456789abcdef0123456789abcdef', parent_sha: null, received_at: now - 2 * MIN, ticket_count: 2, observation: 7, source: { kind: text, versions: null } },
      observation: { last: 7, last_handed_out: 7, outstanding: null }, last_post: { at: now - 2 * MIN, sha: 'cabec94c0123456789abcdef0123456789abcdef', accepted: true },
      dispatch: { sync_workflow: '.github/workflows/sync.yml', mirror_workflow: null, last_sync_dispatch_at: null, window: null, last_resync_request_at: null, last_refusal: { at: now - MIN, workflow: text, reason: text } },
      held: [{ sha: 'feedbeef0123456789abcdef0123456789abcdef', parent_sha: null, head_sha: null, ticket_count: 2, received_at: now - MIN, auto_accept_at: now + 23 * HOUR, accepted_at: null }],
      mode: { mode: 'shadow', cutover_at: null },
      adoptions: [{ ticket_id: 'docs:T-1', session_name: text, requested_at: now - MIN }],
      discrepancies: { since: now - 7 * 24 * HOUR, by_kind: { [text]: 1 }, rows: [{ id: 1, ticket_id: 'docs:T-1', claim_id: 7, at: now - MIN, sub: text, baton: { station: text }, git: { station: 'station-a' }, observation: 7 }], truncated: false },
      allowed: ['repo.resync', 'repo.accept-post', 'repo.cutover', 'adoption.confirm'], not_built: { wants: 'R-BTN-94', force_resync: 'R-BTN-11' }, server_time: now,
    },
    '/v1/admin/instances': { instances: [
      { name: text, repositories: ['docs'], serves: [text], state: 'unavailable', until: now + 30 * MIN, readings: [
        { source: text, writer: 'instrument', kind: 'state', available: false, until: now + 30 * MIN, observed_at: now, lapses_at: now + 30 * MIN, detail: { used: 9, note: text, link: url }, stale: false }] },
    ], server_time: now },
  };
}
