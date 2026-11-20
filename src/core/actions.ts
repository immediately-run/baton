// actions.ts — the minimal action registry (BATON_SPEC §11.3 R-BTN-129; B-192, B-204): one pure
// data table of every route a dashboard session may call — and of every read a session shares
// with the keys — in the entry shape the proposal page states for `src/shared/actions.mjs`
// (spec/proposals/people-and-dashboard.md §1), so B-25's full registry grows out of it. Three
// readers, no second list:
//   - the front (src/core/front.ts) admits the session cookie on a GET whose entry here lists a
//     `session` caller, and a key on a GET whose entry lists one;
//   - the core (src/core/reads/) authorizes each read against its entry's `callers` and answers
//     `GET /v1/actions` from the table;
//   - the dashboard draws its controls from `GET /v1/actions` — each entry's `ui.view` names the
//     screens (src/core/screens.ts) it is a control on — and type-imports the types below.
// Pure data and pure functions: no import, nothing a host owns, so the dashboard bundle and
// `scripts/check-actions.mjs` (`npm run check:actions`) read it as it is.
//
// What is NOT here yet (B-25): `output` schemas, the CLI's command table, the generated router,
// and the entries of routes no session calls (the runner's, the sync's, the administrator
// key's writes). `delegated` (R-BTN-186) is typed and left unset: no delegated key exists.

/** The role a dashboard session authorizes with — its minting key's (R-BTN-155). Only an
 *  administrator's session exists until B-76 builds the owner's sign-in. */
export type SessionRole = 'administrator' | 'owner';

/** R-BTN-129's principals. */
export type Principal =
  | 'administrator' | 'owner' | 'session' | 'runner' | 'check-runner' | 'probe' | 'sync' | 'mirror'
  | 'token' | 'webhook' | 'forge' | 'human' | 'public';

/** R-BTN-129's scopes: `instance` (this tenant), `repository` (one the key owns or is granted
 *  on — the entry's path names it as `{repository}`), `claim-holder`, `own`. */
export type Scope = 'instance' | 'repository' | 'claim-holder' | 'own';

/** R-BTN-129's effects (§12.2). A destructive action carries `confirm: true`. */
export type Effect = 'read' | 'write' | 'destructive';

/** One principal that may call an action, with its scope; `roles` only for `session`. */
export type Caller = { principal: Principal; scope: Scope; roles?: SessionRole[] };

/** A value a body field is matched against (`http.match`). */
export type MatchValue = string | number | boolean;

/** Where an action is served. `path` is a pattern whose `{param}` segments each take one path
 *  segment. `match` tells apart the actions of one route by body field: every named field must
 *  equal the value given, or one of the values of an array. */
export type ActionHttp = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  match?: Record<string, MatchValue | MatchValue[]>;
};

/** A property of an action's input: a small JSON-schema-like subset, enough to draw a form. */
export type InputProperty = {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: MatchValue[];
  /** The one value the field takes (a `confirm: true`, a `kind`). */
  const?: MatchValue;
  properties?: Record<string, InputProperty>;
  required?: string[];
  items?: InputProperty;
};

/** An action's input: the JSON body of a write, the query parameters of a read (each a string
 *  on the wire). Path parameters are `http.path`'s and are not repeated here. */
export type InputSchema = { type: 'object'; properties: Record<string, InputProperty>; required?: string[] };

/** R-BTN-129's `ui` (B-191): the §11.4 screens — ids of src/core/screens.ts — that draw the
 *  action as a control, and, where the dashboard calls it through a `/v1/ui/*` route of its own
 *  beside `http`, that route. `view` is set only on an entry a session may call. */
export type ActionUi = { view: string[]; route?: { method: ActionHttp['method']; path: string } };

/** One action (R-BTN-129): `{id, summary, callers, effect, input, http, ui?, delegated?}`. */
export type Action = {
  /** `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`, in R-BTN-127's nouns. */
  id: string;
  summary: string;
  effect: Effect;
  http: ActionHttp;
  callers: Caller[];
  input: InputSchema;
  ui?: ActionUi;
  /** R-BTN-186's mark for a delegated key — B-124's; unset here, never served to a session. */
  delegated?: boolean | 'own';
};

/** An action as `GET /v1/actions` answers it to a session: the entry, `callers` narrowed to the
 *  one that matched the caller, `delegated` left out. */
export type ListedAction = Omit<Action, 'delegated'>;

export const ACTION_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

// ── the callers the entries share ────────────────────────────────────────────────────────

/** A session of either role, on one repository: an administrator's on every live one, an
 *  owner's on those its key still owns (R-BTN-155). */
const SESSION_REPO: Caller = { principal: 'session', roles: ['administrator', 'owner'], scope: 'repository' };
/** A session of either role, on the instance: what it answers is narrowed to the caller's own. */
const SESSION_ANY: Caller = { principal: 'session', roles: ['administrator', 'owner'], scope: 'instance' };
/** An administrator's session alone. */
const SESSION_ADMIN: Caller = { principal: 'session', roles: ['administrator'], scope: 'instance' };
const RUNNER: Caller = { principal: 'runner', scope: 'repository' };
const OWNER: Caller = { principal: 'owner', scope: 'repository' };
const ADMIN: Caller = { principal: 'administrator', scope: 'instance' };
/** The repository reads' principals (§14): a key granted on the repository, an owner of it, an
 *  administrator — and a session (B-192). Later reads of the same reach reuse this. */
export const REPOSITORY_READERS: Caller[] = [RUNNER, OWNER, ADMIN, SESSION_REPO];
/** An owner's or an administrator's read (never a runner's), and a session. */
export const OWNER_READERS: Caller[] = [OWNER, ADMIN, SESSION_REPO];

const NONE: InputSchema = { type: 'object', properties: {} };
const CONFIRM: InputProperty = { type: 'boolean', const: true, description: 'Must be true: the action names its own confirmation.' };
const RUNNER_ID: InputProperty = { type: 'integer', description: 'The runner the message goes to.' };

// ── the table ────────────────────────────────────────────────────────────────────────────

export const ACTIONS: Action[] = [
  // ── the shell's own reads (B-204) ──
  {
    id: 'repo.list', summary: 'The caller’s repositories, each with its head, mode and the counts the sidebar and the strip draw.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories' },
    callers: [ADMIN, { principal: 'owner', scope: 'instance' }, SESSION_ANY], input: NONE,
  },
  {
    id: 'actions.list', summary: 'The actions the calling session may take, with their inputs and the screens that draw them.',
    effect: 'read', http: { method: 'GET', path: '/v1/actions' },
    callers: [SESSION_ANY], input: NONE,
  },

  // ── the repository reads a session shares with the keys (B-192, B-217) ──
  {
    id: 'repo.board', summary: 'One repository as the dashboard lists it: its ready tickets, the per-tier order and the live claims’ holders.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/board' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'repo.blocked', summary: 'The repository’s blocked tickets with their blocks, or the tickets blocked on one thing.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/blocked' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: {
      on: { type: 'string', description: 'What the tickets are blocked on: <kind>:<ref>.' },
      transitive: { type: 'string', enum: ['0', '1'], description: 'With `on`: follow the blocks transitively.' },
      cursor: { type: 'string', description: 'Without `on`: the next_cursor a page gave.' },
    } },
  },
  {
    id: 'repo.stats', summary: 'A course’s record on the repository: aggregates and ids over a time window.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/stats' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: { since: { type: 'string', description: 'An ISO time not in the future; the default window otherwise.' } } },
  },
  {
    id: 'repo.policy', summary: 'The repository’s policy, its guarantees and floors, signed with the tenant’s key.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/policy' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'repo.conditions', summary: 'The repository’s raised conditions, open ones first.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/conditions' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: {
      open: { type: 'string', enum: ['1', 'true'], description: 'Only the open ones.' },
      type: { type: 'string', description: 'One condition type.' },
      ticket: { type: 'string', description: 'One ticket’s.' },
      cursor: { type: 'string', description: 'The next_cursor a page gave.' },
    } },
  },
  {
    id: 'repo.courses', summary: 'The repository’s courses as last accepted: id, version, file, capability types, roles, and a refused newer version.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/courses' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'repo.schemas', summary: 'Schemas of the repository’s registry by id — the standard library’s and the courses’ — each with its view.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/schemas' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: { ids: { type: 'string', description: 'Schema ids, comma-separated, at most 50.' } }, required: ['ids'] },
  },
  {
    id: 'ticket.show', summary: 'One ticket as Baton holds it: its filter fields, where it is, and who last pushed it.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/tickets/{ticket}' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'ticket.blocks', summary: 'What blocks one ticket, each block with its cause.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/tickets/{ticket}/blocks' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: { runner: { type: 'string', const: 'me', description: 'A runner session’s own answer; needs its secret.' } } },
  },
  {
    id: 'ticket.history', summary: 'One ticket’s history, newest first, with the ended claims’ branches and pull requests.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/tickets/{ticket}/history' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: {
      before: { type: 'string', description: 'The next_before a page gave.' },
      limit: { type: 'string', description: 'Rows a page, 50 unless given.' },
    } },
  },
  {
    id: 'ticket.children', summary: 'The tickets whose parent is the ticket, open and closed, each with its station and whether a block holds it.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/tickets/{ticket}/children' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'leg.runs', summary: 'One leg’s runs of a ticket, with the inputs a replay reads.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/tickets/{ticket}/legs/{leg}/runs' },
    callers: OWNER_READERS, input: NONE,
  },
  {
    id: 'owner.grant.list', summary: 'The repository’s owner keys, the grants on it, its settings and the bars in force.',
    effect: 'read', http: { method: 'GET', path: '/v1/owner/{repository}/grants' },
    callers: [OWNER, SESSION_REPO], input: NONE,
  },
  {
    id: 'owner.policy.log', summary: 'The versions of the repository’s policy, oldest first.',
    effect: 'read', http: { method: 'GET', path: '/v1/owner/{repository}/policy/log' },
    callers: [OWNER, SESSION_REPO],
    input: { type: 'object', properties: { after: { type: 'string', description: 'A version number: the versions after it.' } } },
  },

  // ── the session's own read under /v1/ui/* (B-203 retired V1's whole-state read, and V1's two
  //    paged lists went with it: a session reads the entity reads) ──
  {
    id: 'ui.session', summary: 'Whether the caller’s dashboard session stands.',
    effect: 'read', http: { method: 'GET', path: '/v1/ui/session' }, callers: [SESSION_ANY], input: NONE,
  },

  // ── a session's writes (the `/v1/ui/*` POSTs; R-BTN-155's table says what each takes) ──
  {
    id: 'leg.stop', summary: 'Stop: ask the runner to release the ticket it holds.',
    effect: 'destructive', http: { method: 'POST', path: '/v1/ui/messages', match: { kind: 'release' } },
    callers: [SESSION_ANY],
    input: { type: 'object', required: ['to_runner_id', 'kind', 'payload'], properties: {
      to_runner_id: RUNNER_ID,
      kind: { type: 'string', const: 'release' },
      payload: { type: 'object', required: ['ticket_id', 'reason'], properties: {
        ticket_id: { type: 'string', description: 'The qualified ticket the runner holds.' },
        reason: { type: 'string', enum: ['requested', 'owner-cancel', 'provider-suspended'] },
      } },
    } },
    ui: { view: ['repository/tickets/{ticket}', 'repository/runners/{runner}'] },
  },
  {
    id: 'runner.status-request', summary: 'Status: ask the runner what it is doing; its reply is a status report.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/messages', match: { kind: 'status_request' } },
    callers: [SESSION_ANY],
    input: { type: 'object', required: ['to_runner_id', 'kind'], properties: { to_runner_id: RUNNER_ID, kind: { type: 'string', const: 'status_request' } } },
    ui: { view: ['repository/runners/{runner}'] },
  },
  {
    id: 'runner.wind-down', summary: 'Wind down: the runner completes its leg, then exits without claiming again.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/messages', match: { kind: 'wind-down' } },
    callers: [SESSION_ANY],
    input: { type: 'object', required: ['to_runner_id', 'kind'], properties: { to_runner_id: RUNNER_ID, kind: { type: 'string', const: 'wind-down' } } },
    ui: { view: ['repository/runners/{runner}'] },
  },
  {
    id: 'ticket.hold', summary: 'Hold a ticket: nothing claims it until the hold is lifted.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/overrides/{ticket}', match: { hold: true } },
    callers: [SESSION_ANY],
    input: { type: 'object', required: ['hold'], properties: { hold: { type: 'boolean', const: true } } },
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    id: 'ticket.unhold', summary: 'Lift a ticket’s hold.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/overrides/{ticket}', match: { hold: false } },
    callers: [SESSION_ANY],
    input: { type: 'object', required: ['hold'], properties: { hold: { type: 'boolean', const: false } } },
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    id: 'ticket.expedite', summary: 'Set or clear a ticket’s expedite: the expedite lane is offered first.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/overrides/{ticket}', match: { expedite: [true, false] } },
    callers: [SESSION_ANY],
    input: { type: 'object', required: ['expedite'], properties: { expedite: { type: 'boolean', description: 'true sets it, false clears it.' } } },
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    id: 'claim.force-reap', summary: 'Force-reap a live claim: its lease ends now.',
    effect: 'destructive', http: { method: 'POST', path: '/v1/ui/claims/{claim}/reap' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['confirm'], properties: { confirm: CONFIRM } },
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    // B-222 places it on the ticket's page, drawn where the read names a pending fence.
    id: 'claim.fence-clear', summary: 'Clear a fenced claim, releasing its seats.',
    effect: 'destructive', http: { method: 'POST', path: '/v1/ui/claims/{claim}/fence-clear' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['confirm'], properties: { confirm: CONFIRM } },
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    // B-222: a route of its own over `claims.resolve`; V1's one route taking `{action,
    // confirm}` is retired (B-203).
    id: 'claim.confirm', summary: 'Confirm an unconfirmed completion.',
    effect: 'destructive', http: { method: 'POST', path: '/v1/ui/claims/{claim}/confirm' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['confirm'], properties: { confirm: CONFIRM } },
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    id: 'claim.release', summary: 'Release an unconfirmed completion: the ticket is offered again.',
    effect: 'destructive', http: { method: 'POST', path: '/v1/ui/claims/{claim}/release' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['confirm'], properties: { confirm: CONFIRM } },
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    id: 'scope.resolve', summary: 'Resolve a scope finding: the acknowledgement that it was looked at.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/scope/{finding}/resolve' },
    callers: [SESSION_ANY], input: NONE,
    ui: { view: ['repository/tickets/{ticket}'] },
  },
  {
    id: 'repo.cutover', summary: 'Cut a repository over: Baton allocates its work from now on.',
    effect: 'destructive', http: { method: 'POST', path: '/v1/ui/cutover' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['repository', 'confirm'], properties: { repository: { type: 'string', description: 'The repository’s id.' }, confirm: CONFIRM } },
    ui: { view: ['repository/sync'] },
  },
  {
    id: 'adoption.confirm', summary: 'Confirm an adoption: a legacy claim passes to the session that asked for it.',
    effect: 'destructive', http: { method: 'POST', path: '/v1/ui/adoptions/{ticket}/confirm' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['confirm'], properties: { confirm: CONFIRM } },
    ui: { view: ['repository/sync'] },
  },
  {
    // B-201 (Decision 5a): the held post's Accept is the Sync screen's, one click (R-BTN-11).
    id: 'repo.accept-post', summary: 'Accept a held board post.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/board/accept' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['repository', 'sha'], properties: { repository: { type: 'string' }, sha: { type: 'string', description: 'The held post’s commit.' } } },
    ui: { view: ['repository/sync'] },
  },

  // ── entries the later tickets append, one block per domain (Edit tool, below its line) ──
  // tickets: the tickets list and the ticket page's reads
  {
    // B-194. `ticket.show` (B-218) is the entry above, its read extended in reads/tickets.ts.
    id: 'repo.tickets', summary: 'The repository’s tickets, each under its one state word with the state’s detail, in Baton’s order, with counts per state.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/tickets' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: {
      state: { type: 'string', enum: ['unconfirmed', 'running', 'waiting-person', 'held', 'blocked', 'backing-off', 'suspended', 'ready', 'closed', 'closed-today'], description: 'One state word, or a tab: blocked groups held, blocked, waiting-person, backing-off and suspended; closed-today is closed.' },
      q: { type: 'string', description: 'A case-insensitive substring of the id or the title.' },
      tier: { type: 'string', description: 'A tier ceiling of the repository’s ladder.' },
      cursor: { type: 'string', description: 'The next_cursor a page gave.' },
    } },
  },
  // conditions: the conditions list and one condition
  {
    id: 'condition.show', summary: 'One condition: its type, restarts and outcome, the ticket’s position, and the tickets blocked on its ticket.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/conditions/{condition}' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'repo.needs-you', summary: 'What waits on a person in the repository: its open conditions by severity then age, its queued person legs with whether the caller may answer, and the listings that are not conditions yet.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/needs-you' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'condition.locate', summary: 'The repository a condition id belongs to, among the session’s own.',
    effect: 'read', http: { method: 'GET', path: '/v1/conditions/{condition}' },
    callers: [SESSION_ANY], input: NONE,
  },
  // runners: the repository's runners and one runner
  {
    id: 'repo.runners', summary: 'The runners granted on the repository: alive or not, what each declares and is granted, the claim it holds here and its current activity.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/runners' },
    callers: REPOSITORY_READERS, input: NONE,
  },
  {
    id: 'runner.show', summary: 'One runner granted on the repository: its row and profile, the earlier attempts on its live ticket’s leg, and a window of its claims here with their activities.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/runners/{runner}' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: { since: { type: 'string', description: 'The window’s start: an ISO time not in the future, or a span such as 24h or 7d; 24 hours unless given, 7 days at most.' } } },
  },
  // courses: one course and its tickets
  {
    id: 'course.show', summary: 'One course of the repository: its file, each leg’s queue and state, each station’s resting tickets, its tickets a page at a time, and the window’s runs and stats.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/courses/{course}' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: {
      since: { type: 'string', description: 'The window’s start: an ISO time not in the future, or a span such as 24h or 7d; 24 hours unless given, 7 days at most.' },
      summary: { type: 'string', const: '1', description: 'The course, its legs, stations and stats only: no tickets, no runs.' },
      cursor: { type: 'string', description: 'The next_cursor a page of tickets gave.' },
    } },
  },
  // sync: the discrepancies, repo.resync
  {
    id: 'repo.sync', summary: 'The mirror’s view of the repository: its head and source, the observation counter, the last post, dispatches, held posts, mode, pending adoptions and the discrepancies of a window.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/sync' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: { since: { type: 'string', description: 'An ISO time at most 30 days back: the discrepancies after it. The last 7 days otherwise.' } } },
  },
  {
    // B-201 (R-BTN-73): a sync dispatch, as a webhook delivery sends one — not a confirmed
    // action. An administrator's session until B-76 builds the owner's, which reaches its own
    // repositories. A forced resync onto a rewritten head (R-BTN-11) is not built and no entry.
    id: 'repo.resync', summary: 'Resync: ask the repository’s sync workflow to run now.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/resync' },
    callers: [SESSION_ADMIN],
    input: { type: 'object', required: ['repository'], properties: { repository: { type: 'string', description: 'The repository’s id.' } } },
    ui: { view: ['repository/sync'] },
  },
  // tenant: the tenant screens' reads
  {
    id: 'admin.repo.list', summary: 'The registry: every registered repository’s row, its tiers, sync keys and CI identity, and the retired ones on request.',
    effect: 'read', http: { method: 'GET', path: '/v1/admin/repositories' }, callers: [ADMIN, SESSION_ADMIN],
    input: { type: 'object', properties: { retired: { type: 'string', const: '1', description: 'List the retired repositories too.' } } },
  },
  {
    id: 'admin.capacity.list', summary: 'Each capability with a capacity: its seats, those held and the claims holding them.',
    effect: 'read', http: { method: 'GET', path: '/v1/admin/capacities' }, callers: [ADMIN, SESSION_ADMIN],
    input: { type: 'object', properties: { capability: { type: 'string', description: 'One capability: the courses whose legs require it, too.' } } },
  },
  {
    id: 'admin.instance.list', summary: 'The resource instances, each with its state and every reading in force, by instrument.',
    effect: 'read', http: { method: 'GET', path: '/v1/admin/instances' }, callers: [ADMIN, SESSION_ADMIN], input: NONE,
  },
  {
    id: 'admin.resource.list', summary: 'The registered resources with their detail schemas and instances, and the probe keys.',
    effect: 'read', http: { method: 'GET', path: '/v1/admin/resources' }, callers: [ADMIN, SESSION_ADMIN], input: NONE,
  },
  {
    id: 'admin.settings.show', summary: 'The instance settings: link hosts, session hosts, the check app’s id and the recommended client.',
    effect: 'read', http: { method: 'GET', path: '/v1/admin/settings' }, callers: [ADMIN, SESSION_ADMIN], input: NONE,
  },
  {
    id: 'admin.tenant', summary: 'The tenant’s live counts and request rates against the capacity envelope, the day’s usage, and what needs an administrator.',
    effect: 'read', http: { method: 'GET', path: '/v1/admin/tenant' }, callers: [ADMIN, SESSION_ADMIN], input: NONE,
  },
  {
    id: 'admin.session.list', summary: 'The live dashboard sessions, by their key’s fingerprint, with the caller’s own marked.',
    effect: 'read', http: { method: 'GET', path: '/v1/admin/sessions' }, callers: [ADMIN, SESSION_ADMIN], input: NONE,
  },
  // credentials and governance: owners, tokens, keys, bars, consents, attestations
  {
    // B-213. The write (`attestation.add`, `POST …/attestations`) is a signed key's alone and
    // has no entry here: no session calls it (R-BTN-57; the owner's session is B-76's).
    id: 'attestation.list', summary: 'The repository’s attestations — today a person leg’s answers — newest first, with their writers, and the types the caller may write.',
    effect: 'read', http: { method: 'GET', path: '/v1/repositories/{repository}/attestations' },
    callers: REPOSITORY_READERS,
    input: { type: 'object', properties: {
      subject: { type: 'string', description: 'One ticket’s.' },
      type: { type: 'string', description: 'One attestation type.' },
      live: { type: 'string', enum: ['1'], description: 'Only those neither lapsed nor revoked.' },
      cursor: { type: 'string', description: 'The next_cursor a page gave.' },
    } },
  },
  // session: ui.logout
  {
    // B-206. No `ui.view`: the shell's frame draws it in the sidebar's footer on every screen —
    // it is the session's own end, no screen's control.
    id: 'ui.logout', summary: 'Log out: end the calling session.',
    effect: 'write', http: { method: 'POST', path: '/v1/ui/logout' },
    callers: [SESSION_ANY], input: NONE,
  },
];

// ── pure helpers ─────────────────────────────────────────────────────────────────────────

const patterns = new WeakMap<Action, { re: RegExp; names: string[] }>();
function patternOf(a: Action): { re: RegExp; names: string[] } {
  let p = patterns.get(a);
  if (!p) {
    const names: string[] = [];
    const source = a.http.path.split('/').map((seg) => {
      if (seg.startsWith('{') && seg.endsWith('}')) {
        names.push(seg.slice(1, -1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');
    p = { re: new RegExp(`^${source}$`), names };
    patterns.set(a, p);
  }
  return p;
}

/** An entry a request's method and path match, with the path's parameters as sent (not
 *  decoded). Several entries may share one route, told apart by `http.match`. */
export type Matched = { action: Action; params: Record<string, string> };

/** Every entry `method` and `pathname` match, in table order. `HEAD` matches as `GET`. */
export function matchActions(method: string, pathname: string, table: readonly Action[] = ACTIONS): Matched[] {
  const m = method === 'HEAD' ? 'GET' : method;
  const out: Matched[] = [];
  for (const action of table) {
    if (action.http.method !== m) continue;
    const { re, names } = patternOf(action);
    const hit = re.exec(pathname);
    if (hit) out.push({ action, params: Object.fromEntries(names.map((n, i) => [n, hit[i + 1]])) });
  }
  return out;
}

/** Does `body` carry what `match` names? */
export function bodyMatches(match: ActionHttp['match'], body: unknown): boolean {
  if (!match) return true;
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return Object.entries(match).every(([k, want]) => (Array.isArray(want) ? want.includes(b[k] as MatchValue) : b[k] === want));
}

/** The one entry a request is: its method and path, and — where several entries share the
 *  route — its body. Null when none or several match (R-BTN-129: `invalid-params` then). */
export function matchAction(method: string, pathname: string, body?: unknown, table: readonly Action[] = ACTIONS): Matched | null {
  const hits = matchActions(method, pathname, table);
  if (hits.length <= 1 && !hits[0]?.action.http.match) return hits[0] ?? null;
  const told = hits.filter((h) => bodyMatches(h.action.http.match, body));
  return told.length === 1 ? told[0] : null;
}

/** The entry's caller a session of `role` matches, or null: no entry lists it. */
export function sessionCaller(action: Action, role: SessionRole): Caller | null {
  return action.callers.find((c) => c.principal === 'session' && (c.roles ?? []).includes(role)) ?? null;
}

/** Does the entry admit a session of `role`? */
export const admitsSession = (action: Action, role: SessionRole): boolean => sessionCaller(action, role) != null;

/** Does the entry list a session of any role? `ui.view` stands only on such an entry. */
export const listsSession = (action: Action): boolean => action.callers.some((c) => c.principal === 'session');

/** The entry's caller a key of `principal` matches, or null. */
export function keyCaller(action: Action, principal: Principal): Caller | null {
  return action.callers.find((c) => c.principal === principal) ?? null;
}

/** Is `GET pathname` a read a session may call (B-192)? What the front asks before it turns a
 *  cookie into a principal. */
export function sessionReadable(pathname: string, table: readonly Action[] = ACTIONS): boolean {
  return matchActions('GET', pathname, table).some((h) => listsSession(h.action));
}

/** Is `GET pathname` a read a key — a runner's, an owner's or an administrator's — may call? */
export function keyReadable(pathname: string, table: readonly Action[] = ACTIONS): boolean {
  return matchActions('GET', pathname, table).some((h) => h.action.callers.some((c) => c.principal === 'runner' || c.principal === 'owner' || c.principal === 'administrator'));
}

/** `GET /v1/actions` for a session (B-204): the entries listing a session of `role`, each with
 *  `callers` narrowed to the matching one and `delegated` left out. An owner's session sees a
 *  repository-scoped entry only while its key still owns a repository (`ownsRepository`); an
 *  administrator's sees every entry listing its role. Never per target (B-204): a
 *  target-dependent control is gated by its read's `allowed` word. */
export function actionsFor(role: SessionRole, opts: { ownsRepository?: boolean } = {}, table: readonly Action[] = ACTIONS): ListedAction[] {
  const out: ListedAction[] = [];
  for (const a of table) {
    const caller = sessionCaller(a, role);
    if (!caller) continue;
    if (role === 'owner' && caller.scope === 'repository' && !opts.ownsRepository) continue;
    const { delegated: _delegated, ...entry } = a;
    out.push({ ...entry, callers: [caller] });
  }
  return out;
}

/** What `check:actions` enforces of `ui.view` (B-204): each view names a screen, a view stands
 *  only on an entry a session may call, ids are well-formed and unique; and, never failing, the
 *  screens no control names. */
export function checkActions(table: readonly Action[], screenIds: readonly string[]): { errors: string[]; uncontrolled: string[] } {
  const errors: string[] = [];
  const known = new Set(screenIds);
  const seen = new Set<string>();
  const named = new Set<string>();
  for (const a of table) {
    if (!ACTION_ID.test(a.id)) errors.push(`${a.id}: the id breaks the grammar ${ACTION_ID}`);
    if (seen.has(a.id)) errors.push(`${a.id}: the id is listed twice`);
    seen.add(a.id);
    if (!a.callers.length) errors.push(`${a.id}: no caller`);
    if (!a.ui) continue;
    if (!listsSession(a)) errors.push(`${a.id}: ui.view is set on an entry whose callers list no session`);
    for (const v of a.ui.view) {
      if (!known.has(v)) errors.push(`${a.id}: ui.view names no screen: ${v}`);
      named.add(v);
    }
  }
  return { errors, uncontrolled: screenIds.filter((s) => !named.has(s)) };
}
