// board.ts — what a board snapshot becomes in the `tickets` cache (BATON_SPEC §4, §7.1,
// R-BTN-33/35). Pure: the core does the SQL, on either host. Only filter fields survive — an item's
// body, Status notes, exit criteria and PR list never reach Baton; the dashboard links each
// item to its file on GitHub instead.
import { capabilitiesOf } from '../shared/vocabulary.mjs';
import { parseTranscriptRepo } from './links';
import { BatonError } from './http';
import { checkRegistry, COURSE_ID, type RegistryEntry } from './courses';
import { ASKS, COURSE_ID as LEG_ID, DECISION_GRANT_MAX, DECISION_ID, DECISION_OPTION, DECISION_OPTIONS_MAX, DECISION_QUESTION, DECISIONS_MAX, isHttpsPointer, LOCAL_ID, NEEDS_MAX, SESSION_NAME, TAG, HOLDING_TYPE, HOLDING_VALUE } from './validate';
import type { Step } from './graph';

/** One factory-state item, as the sync posts it (`docs/scripts/factory-state.mjs`). Only the
 *  keys named here are read; anything else in the item is ignored. */
export interface StateItem {
  id: string;
  title: string;
  status: string;
  project?: string | null;
  order?: number | null;
  tags?: string[];
  requires?: string[] | null;
  tier?: string | null;
  queue: string;
  node: string;
  dependsOn?: string[];
  blockedBy?: string[];
  /** Not in factory-state's items today: the sync adds it from each item's `repos:`
   *  frontmatter (R3-1207). Absent, the row stores `[]`. */
  repos?: string[];
  /** factory-state's date the item entered its status (`YYYY-MM-DD`): for an in-progress item,
   *  its claim note's date, which the legacy import's `reap_after` counts from (§13). */
  since?: string;
  /** The claim note's holder session (`holderOf`), when the sync posts it: the legacy worker's
   *  session name, which adoption matches (§13 step 3). */
  holder?: string;
  /** The ticket's course (R-BTN-48): absent, `roadmap-pr`, so no existing docs item changes. */
  course?: string;
}

/** A ticket's course when its item names none (R-BTN-48). */
export const DEFAULT_COURSE = 'roadmap-pr';

/** A ticket of §7.1's normative post. Only the generic fields are read; `course` (opaque, for the
 *  course's hook, R3-1236), `parent` (R3-1258) and `not_before` (R3-1259) are accepted unread. */
export interface PostedTicket {
  id: string;
  course_id: string;
  /** The ticket's file, when it has one: a `custom` source with `versions: "current"` may post a
   *  ticket with no path at all (§4.4, B-183) — its `key` then names it. */
  path?: string;
  /** B-183 (R-BTN-74): the ticket source's opaque version for this ticket — the markdown
   *  source's is the ticket file's blob id at the posted commit. Absent (`''` stored): no
   *  version held, compared with nothing. Baton compares versions for equality only (values 4). */
  version?: string;
  /** B-183 (R-BTN-147): the source's stable name for the ticket, by which a dropped and
   *  re-added ticket is detected as `renumbered`. Absent: the ticket's `path`. */
  key?: string;
  title: string;
  tier?: string | null;
  requires: string[];
  operator_only: boolean;
  expedite: boolean;
  depends_on: string[];
  blocked_by: string[];
  repos: string[];
  rank?: number | null;
  /** Shown, never read (§2b). */
  display?: { status?: string; group?: string; project?: string };
  /** R-BTN-116: the queued person leg's question (§4.4) — stored only while the ticket's queued
   *  leg is a person's; any other is dropped and logged `question-dropped`. */
  question?: PostedQuestion | null;
  /** B-127 item 7: the brief's mark — `{signed, signer?, commit}`. Marked whether or not the
   *  repository requires signed control; `signer` is the signing key's fingerprint. */
  brief?: { signed: boolean; signer?: string; commit: string };
}

/** R-BTN-116: the question a ticket source posts for its queued person leg — an id for the
 *  question, where git holds its text, its severity (R-BTN-125) and its options, each naming the
 *  outcome in the leg's `to` it chooses. With no options posted, the leg's own outcomes are its
 *  options, each under its own name (§6.4). */
export interface PostedQuestion {
  id: string;
  url?: string | null;
  severity?: string | null;
  options?: { id: string; reached: string }[] | null;
}

/** Where the sync places a ticket (R-BTN-70, §7.1 `stations`). */
export interface PostedStation {
  station: string;
  path: Step[];
  next_leg: string | null;
  next_source: 'course' | 'marker' | 'inferred' | 'holder';
  handoff_url: string | null;
  next: { leg: string; state: 'ready' | 'waiting'; waiting_on: string | null; needs?: string[] }[];
  /** R-BTN-78: the ticket's open decisions as its sync posts them; checked for shape here, each
   *  one's `leg` and `url` judged against the ticket when stored (`Blocks.posted`). */
  decisions?: PostedDecision[];
  /** Tags barred from each leg of the course the sync knows them for (`ticket_bars`). */
  bars: Record<string, string[]>;
}

/** R-BTN-78: an open decision a sync posts with a ticket's station. */
export interface PostedDecision {
  id: string;
  leg?: string | null;
  asks: string;
  url?: string | null;
  /** B-110: the question, one line of display text (rendered as text, §10.4). */
  question?: string | null;
  /** B-110: what the owner may answer (`baton owner resolve`), and the runs each answer grants
   *  a leg of the ticket beyond its `max_runs` (§6.8) — the answer carries the grant. */
  options?: { id: string; grants?: { leg: string; runs: number } }[];
}

export interface BoardPayload {
  sha: string;
  parent_sha: string | null;
  /** The number `POST /v1/sync/observation` handed out before the sync read anything (R-BTN-62). */
  observation: number;
  force?: boolean;
  /** B-183 (§4.3): the commit the post's tickets were read at, when that is not `sha` itself —
   *  a confirm-only re-post of the head from a checkout behind it (§7.1) carries the head's
   *  `sha` with a body read at the checkout. A refresh materializes tickets only when this is
   *  the head (`read_sha === sha`); absent, a refresh changes no ticket row (an older CLI's
   *  post). The new-head path never reads it: its body is read at its `sha` by construction. */
  read_sha?: string;
  /** B-183 (R-BTN-74, §4.4): the ticket source's declaration — `kind` (`markdown`, the CLI's
   *  default, or `custom`, the repository's own `.baton/tickets.mjs`), how it reads a ticket
   *  (`versions`: `pinned` at a version, `current` as it is now) and the CLI that posted. Absent:
   *  an older CLI's post, read as none of it. */
  source?: { kind: 'markdown' | 'custom'; versions?: 'pinned' | 'current'; cli?: string } | null;
  /** The interim post (docs until R3-1233): factory-state's items and the `rankReady` order. */
  state?: { items: StateItem[] };
  /** The ready items in `rankReady` order (lib/factoryState.mjs), computed by the sync. */
  ready?: string[];
  /** §7.1's normative post: the tickets, those closed since the parent, and where each is. */
  tickets?: PostedTicket[];
  closed?: { id: string; as: 'done' | 'withdrawn' }[];
  stations?: Record<string, PostedStation>;
  confirmations?: unknown[];
  /** B-142: `prices` and `providers` are gone with the model tables the route choice stratum
   *  never read (§6.3's readings are an unavailable provider's replacement, R-BTN-76). A sync
   *  that still posts either is not refused for it — accepted with the field ignored, as
   *  `min_skills_version` above — until no registered repository posts it. */
  reviewers?: Record<string, { reviews_on: string; bills: string[]; models?: Record<string, string> }>;
  matrix?: { families: Record<string, string[]>; agents: Record<string, { reviews_on: string; bills: string[]; models?: Record<string, string> }> };
  /** The course registry (R-BTN-48, §7.1); absent, the courses in force stay. */
  registry?: RegistryEntry[];
  /** §6.8: the transcript repositories from `baton.json`; absent, the defaults stand. */
  transcript_repos?: string[];
  /** §4.4 (R-BTN-191): the sync's attestations, this run's observation. Only `std:decision@1` —
   *  a person leg's answer read from the ticket's `answer:` — is acted on (R-BTN-116); an
   *  arrival Baton does not apply is recorded `arrival-unapplied` (R-BTN-39). */
  attestations?: PostedAttestation[];
  /** B-127 (R-BTN-66 as amended): what the sync found about owner-signed control inputs at this
   *  commit — the groups a runner loads `agent_command`, overrides and `rank.mjs` from, and the
   *  control inputs whose last change no owner key signed (the `unsigned-control` notice's list,
   *  raised where the repository requires signed control). The sync computes this where the git
   *  objects are; every runner verifies the named commits again before loading them, and B-137
   *  moves the check server-side over the raw commits. */
  control?: PostedControl;
}

/** One runner-loaded control group as the post names it (B-127 item 4): `read` the commit to
 *  load from — the newest commit that changed the group and an owner key signed, so every later
 *  change is unsigned and left behind — or null when no signed version exists (nothing counts;
 *  the runners stand down), `key` the signing key's fingerprint (null when `read` is only the
 *  pre-adoption baseline beyond the walk's memory), `unsigned` the commits that changed the
 *  group without counting. */
export interface PostedGroup {
  read: string | null;
  key: string | null;
  unsigned: string[];
}

/** The post's signed-control record (B-127). */
export interface PostedControl {
  /** The owner keys' fingerprints the sync verified with — what named `key` below means. */
  keys: string[];
  /** The runner-loaded groups (B-127 item 4): `agent_command` (`.baton/baton.json`), the
   *  overrides (`legs/<leg>.run.mjs`), `rank.mjs`, and the courses' leg scripts
   *  (`legs/*.mjs` — the code a runner executes; the graph stays with the snapshot, B-33
   *  pinning a sourced course's file). A sync from before the course group posts three; while
   *  the repository requires signed control, the claim is refused until a post names all four
   *  (fail closed on a missing group). */
  groups: { agent_command: PostedGroup; overrides: PostedGroup; rank: PostedGroup; course?: PostedGroup };
  /** Every control input whose last change (first parents) is unsigned: one entry per path,
   *  with its commits; a ticket file's entry names the watched fields (`EXPEDITE`) in `fields`. */
  unsigned: { path: string; commits: string[]; fields?: string[] }[];
}

/** R-BTN-191's envelope as the sync posts it (§4.4): a typed fact about one ticket, its `value`
 *  judged by its `type`'s schema when the type is read. */
export interface PostedAttestation {
  type: string;
  /** A local ticket id, as the post's tickets name them. */
  ticket: string;
  ref?: string | null;
  value: unknown;
}

/** A `tickets` row (§4) plus its expanded requirements (`ticket_requires`). */
export interface TicketRow {
  id: string;
  path: string;
  /** B-183: the ticket's opaque version ('' when the source posts none) and stable key (its
   *  `path` when the source posts none) — inputs of `row_hash`, so a changed version rewrites
   *  the row (§4.3, R-BTN-11). */
  version: string;
  key: string | null;
  title: string;
  project: string | null;
  status: string;
  node: string;
  queue: string;
  tags: string;
  tier: string | null;
  requires_clause: 'absent' | 'none' | 'listed';
  operator_only: 0 | 1;
  depends_on: string;
  blocked_by: string;
  repos: string;
  ord: string | null;
  rank: number | null;
  course_id: string;
  /** The tier's position in the repository's ladder (R-BTN-66), set by the core, which knows it. */
  tier_position?: number | null;
  requires: string[];
  since: string | null;
  holder: string | null;
  /** As posted (§7.1), or the interim item's expedite queue (R-BTN-12). */
  expedite: 0 | 1;
  /** Shown, never read (§2b): JSON, or null. */
  display: string | null;
  /** B-127 item 7: the brief's mark — `{signed, signer?, commit}` as the sync computed it, JSON,
   *  or null when unmarked (no owner signing keys, or the brief's last change is beyond the
   *  walk's memory). Read, not just shown: a privileged reader's first sight of whose words a
   *  brief is. */
  brief?: string | null;
}

const SHA = /^[0-9a-f]{40}$/;
/** A public key's fingerprint, as `ssh-keygen -l` prints it (B-127's signing keys). */
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const ID = LOCAL_ID; // a local id (R-BTN-47)
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// B-183 (§12.3): a ticket's opaque version, the source's own string — a git blob id, a store's
// stamp, a digest — compared for equality only, never ordered or read as a time (values 4).
const VERSION = /^[A-Za-z0-9._:+/=-]{1,128}$/;
// A title comes from git, not from a worker, and the dashboard renders it with textContent
// (§10.4), so it is only bounded and free of control characters.
const TEXT = /^[^\u0000-\u001f\u007f]{1,500}$/;

function list(v: unknown, re: RegExp, what: string): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && re.test(x))) throw new BatonError('invalid-params', `${what} must be a list of names`);
  return v as string[];
}

/** Validate the snapshot's shape before anything is written; refuses rather than guesses. A post
 *  is the normative shape (`tickets`, `closed`, `stations`, §7.1) or the interim one docs posts
 *  until R3-1233 (`state.items`, `ready`), never both. */
export function checkPayload(body: unknown): BoardPayload {
  const p = body as BoardPayload;
  if (!p || typeof p !== 'object') throw new BatonError('invalid-params', 'a JSON object is required');
  if (typeof p.sha !== 'string' || !SHA.test(p.sha)) throw new BatonError('invalid-params', 'sha must be a 40-hex commit');
  if (p.parent_sha !== null && (typeof p.parent_sha !== 'string' || !SHA.test(p.parent_sha))) throw new BatonError('invalid-params', 'parent_sha must be a 40-hex commit or null');
  if (p.read_sha !== undefined && p.read_sha !== null && (typeof p.read_sha !== 'string' || !SHA.test(p.read_sha))) throw new BatonError('invalid-params', 'read_sha must be a 40-hex commit or null (the commit the tickets were read at, B-183)');
  if (!Number.isSafeInteger(p.observation) || p.observation < 1) throw new BatonError('invalid-params', 'observation must be the number POST /v1/sync/observation handed out (R-BTN-62)');
  // B-183 (§4.4): the ticket source's declaration. Its shape here; the `tickets-approved` floor
  // reads it where the repository's policy is known, when the post is judged.
  if (p.source !== undefined && p.source !== null) {
    const s = p.source;
    if (!isObj(s) || (s.kind !== 'markdown' && s.kind !== 'custom')) throw new BatonError('invalid-params', "source must be {kind: 'markdown' | 'custom', versions?, cli?}");
    if (s.versions !== undefined && s.versions !== null && s.versions !== 'pinned' && s.versions !== 'current') {
      throw new BatonError('invalid-params', "source.versions must be 'pinned' or 'current' (R-BTN-74)");
    }
    if (s.cli !== undefined && s.cli !== null && (typeof s.cli !== 'string' || s.cli.length > 200)) throw new BatonError('invalid-params', 'source.cli must be a short string naming the posting CLI');
    for (const k of Object.keys(s)) if (!['kind', 'versions', 'cli'].includes(k)) throw new BatonError('invalid-params', `source.${k} is not a source field`);
  }
  if (p.tickets !== undefined) {
    if (p.state !== undefined || p.ready !== undefined) throw new BatonError('invalid-params', 'a post is either the normative tickets or the interim state.items, not both');
    checkNormative(p);
  } else {
    checkInterim(p);
  }
  if (p.force !== undefined && typeof p.force !== 'boolean') throw new BatonError('invalid-params', 'force must be a boolean');
  // `min_skills_version` is gone (R-BTN-22: each course's version is the skills version); a
  // sync that still sends it is not refused for it, and Baton reads it nowhere.
  checkReference(p);
  // §5.9 (B-167): the capability ontology is gone from core. A post that still carries a field
  // the restructure retired is taken with the field ignored — the sync's own logging is the
  // record, and the history's Migrations entry "part 4's retired fields" says until when.
  // (`route_choices` on a registry entry is ignored the same way, in `checkRegistry`.)
  const retired = p as BoardPayload & { ontology?: unknown };
  if (retired.ontology !== undefined) delete retired.ontology;
  // R-BTN-191's envelope (§4.4): a typed fact about one ticket of the post. The shape here; each
  // type's own validation — and whether Baton applies the fact — is where the type is read
  // (R-BTN-116 reads `std:decision@1`; the other types arrive with B-146 and B-120).
  if (p.attestations !== undefined) {
    if (!Array.isArray(p.attestations) || p.attestations.length > 100) throw new BatonError('invalid-params', `attestations must be a list of at most 100`);
    for (const [i, a] of p.attestations.entries()) {
      const at = `attestations[${i}]`;
      if (!isObj(a) || typeof (a as PostedAttestation).type !== 'string' || !/^[a-z][a-z0-9.-]*(:[a-z][a-z0-9.-]*)?@\d+$/.test((a as PostedAttestation).type)) {
        throw new BatonError('invalid-params', `${at}.type must be a schema id <id>@<version>`);
      }
      if (typeof (a as PostedAttestation).ticket !== 'string' || !LOCAL_ID.test((a as PostedAttestation).ticket)) throw new BatonError('invalid-params', `${at}.ticket must be a local ticket id`);
      const ref = (a as PostedAttestation).ref;
      if (ref !== undefined && ref !== null && (typeof ref !== 'string' || ref.length > 200)) {
        throw new BatonError('invalid-params', `${at}.ref must be a short string or null`);
      }
      if (!isObj((a as PostedAttestation).value)) throw new BatonError('invalid-params', `${at}.value must be an object`);
    }
  }
  // B-127 (R-BTN-66 as amended): the post's signed-control record. The shape and bounds here;
  //  whose keys may sign is Baton's own fact (the repository's human-only owner keys), which the
  //  sync reads from Baton and every runner re-checks against the commit objects themselves.
  if (p.control !== undefined) {
    const c = p.control;
    if (!isObj(c)) throw new BatonError('invalid-params', 'control must be {keys, groups, unsigned}');
    const badControl = (field: string, why: string): never => {
      throw new BatonError('invalid-params', `control.${field}: ${why}`);
    };
    for (const [k, v] of Object.entries(c)) if (!['keys', 'groups', 'unsigned'].includes(k)) badControl(k, 'is not a control field');
    if (!Array.isArray(c.keys) || !c.keys.every((x) => typeof x === 'string' && FINGERPRINT.test(x))) badControl('keys', 'must be the signing keys’ fingerprints');
    if (new Set(c.keys).size !== c.keys.length) badControl('keys', 'names a key twice');
    if (!isObj(c.groups) || !(['agent_command', 'overrides', 'rank'] as const).every((g) => isObj(c.groups![g]))) {
      badControl('groups', 'must hold agent_command, overrides and rank');
    }
    for (const k of Object.keys(c.groups)) if (!(['agent_command', 'overrides', 'rank', 'course'] as readonly string[]).includes(k)) badControl(`groups.${k}`, 'is not a group');
    for (const g of ['agent_command', 'overrides', 'rank', 'course'] as const) {
      const grp = c.groups[g];
      if (grp === undefined) continue; // course: a sync from before the group; while the setting is on, a claim fails closed on it
      const at = `groups.${g}`;
      for (const [k, v] of Object.entries(grp)) if (!['read', 'key', 'unsigned'].includes(k)) badControl(`${at}.${k}`, 'is not a group field');
      if (grp.read !== null && (typeof grp.read !== 'string' || !SHA.test(grp.read))) badControl(`${at}.read`, 'must be a 40-hex commit or null (no signed version)');
      if (grp.key !== null && (typeof grp.key !== 'string' || !FINGERPRINT.test(grp.key))) badControl(`${at}.key`, 'must be a key fingerprint or null');
      if (grp.key != null && !c.keys.includes(grp.key)) badControl(`${at}.key`, 'names a key control.keys does not');
      if (!Array.isArray(grp.unsigned) || grp.unsigned.length > 40 || !grp.unsigned.every((x) => typeof x === 'string' && SHA.test(x))) badControl(`${at}.unsigned`, 'must be at most 40 commits');
    }
    if (!Array.isArray(c.unsigned) || c.unsigned.length > 200) badControl('unsigned', 'must be a list of at most 200 changes');
    for (const [i, u] of c.unsigned.entries()) {
      const at = `unsigned[${i}]`;
      if (!isObj(u) || typeof u.path !== 'string' || !u.path.length || u.path.length > 300 || u.path.startsWith('/')) badControl(`${at}.path`, 'must be a relative path');
      if (!Array.isArray(u.commits) || !u.commits.length || u.commits.length > 40 || !u.commits.every((x) => typeof x === 'string' && SHA.test(x))) badControl(`${at}.commits`, 'must be 1 to 40 commits');
      if (u.fields !== undefined && (!Array.isArray(u.fields) || !u.fields.every((x) => x === 'EXPEDITE'))) badControl(`${at}.fields`, 'may name only EXPEDITE');
    }
  }
  return p.registry === undefined ? p : { ...p, registry: checkRegistry(p.registry) };
}

/** A forge path as `repos` carries it (R-BTN-92): `owner/name`, a GitLab `group/…/name`; docs'
 *  interim post still sends short names. */
const REPO = /^[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._-]{1,100}){0,3}$/;

function checkInterim(p: BoardPayload) {
  if (!p.state || !Array.isArray(p.state.items)) throw new BatonError('invalid-params', 'state.items is required');
  if (!Array.isArray(p.ready) || !p.ready.every((id) => typeof id === 'string' && ID.test(id))) throw new BatonError('invalid-params', 'ready must be the rankReady id list');
  if (p.closed !== undefined || p.stations !== undefined) throw new BatonError('invalid-params', 'closed and stations come with the normative tickets');
  const seen = new Set<string>();
  for (const it of p.state.items) {
    if (!it || typeof it.id !== 'string' || !ID.test(it.id)) throw new BatonError('invalid-params', 'an item id is malformed');
    if (seen.has(it.id)) throw new BatonError('invalid-params', `${it.id} appears twice`);
    seen.add(it.id);
    if (typeof it.title !== 'string' || !TEXT.test(it.title)) throw new BatonError('invalid-params', `${it.id}: title must be short plain text`);
    for (const [k, v] of [['status', it.status], ['queue', it.queue], ['node', it.node]] as const) {
      if (typeof v !== 'string' || !NAME.test(v)) throw new BatonError('invalid-params', `${it.id}: ${k} is malformed`);
    }
    if (it.tier != null && !NAME.test(it.tier)) throw new BatonError('invalid-params', `${it.id}: tier is malformed`);
    if (it.project != null && !NAME.test(it.project)) throw new BatonError('invalid-params', `${it.id}: project is malformed`);
    if (it.order != null && !Number.isFinite(it.order)) throw new BatonError('invalid-params', `${it.id}: order must be a number`);
    list(it.tags, /^[A-Za-z0-9-]{1,64}$/, `${it.id}: tags`);
    // B-104 (R-BTN-121/174): a clause may name a typed capability — `<type>:<value>`.
    list(it.requires, new RegExp(`^(?:${NAME.source}|${HOLDING_TYPE}:${HOLDING_VALUE})$`), `${it.id}: requires`);
    list(it.dependsOn, ID, `${it.id}: dependsOn`);
    list(it.blockedBy, ID, `${it.id}: blockedBy`);
    list(it.repos, REPO, `${it.id}: repos`);
    if (it.course !== undefined && (typeof it.course !== 'string' || !COURSE_ID.test(it.course))) throw new BatonError('invalid-params', `${it.id}: course must be a course id`);
  }
  for (const id of p.ready) if (!seen.has(id)) throw new BatonError('invalid-params', `ready names ${id}, which is not in state.items`);
  // B-111: the interim shape carries `dependsOn` too, and a loop is a loop whichever shape posts
  // it — no ticket source can hold its tickets out of the default order unseen (§4.4, round 1).
  const loop = dependsCycle(p.state.items.map((it) => ({ id: it.id, depends_on: it.dependsOn ?? [] })));
  if (loop) throw new BatonError('invalid-params', `state.items: a dependency cycle: ${loop.join(' → ')}`);
}

/** Posted lists' bounds (spec-silent, recorded on R3-1232): a board of 10 000 tickets, a path of
 *  500 legs, 64 next legs, 64 barred legs of 64 tags each. */
const TICKETS_MAX = 10_000;
const PATH_MAX = 500;
const NEXT_MAX = 64;
const BARS_MAX = 64;
const DEP_MAX = 500;
/** A ticket's file in its repository: segments of names, none `.` or `..`. */
const isTicketPath = (v: unknown) =>
  typeof v === 'string' && v.length <= 256 && v.split('/').every((seg) => /^[A-Za-z0-9._-]+$/.test(seg) && seg !== '.' && seg !== '..');
/** A `waiting_on` label: free, short, compared as a string (R-BTN-69). */
const WAITING_ON = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
/** R-BTN-116: a question option's id — a station id's shape, so a decision packet's letters (`a`,
 * `b`) and the leg's own outcome names (`approve`) both fit, each naming the outcome it chooses. */
const OPTION_ID = LEG_ID;
const isObjArr = (v: unknown, max: number) => Array.isArray(v) && v.length <= max;

function checkNormative(p: BoardPayload) {
  const fail = (field: string, why: string): never => {
    throw new BatonError('invalid-params', `${field}: ${why}`);
  };
  if (!isObjArr(p.tickets, TICKETS_MAX)) fail('tickets', `must be a list of at most ${TICKETS_MAX}`);
  const seen = new Set<string>();
  const seenKeys = new Set<string>();
  for (const [i, t] of p.tickets!.entries()) {
    const at = `tickets[${i}]`;
    if (!isObj(t) || typeof t.id !== 'string' || !ID.test(t.id)) fail(`${at}.id`, 'must be a local id');
    if (seen.has(t.id)) fail(`${at}.id`, `${t.id} appears twice`);
    seen.add(t.id);
    if (typeof t.course_id !== 'string' || !COURSE_ID.test(t.course_id)) fail(`${t.id}.course_id`, 'must be a course id');
    // B-183 (§4.4): `path` is the ticket's file — required of every source but a `custom` one
    // that reads only as it is now (`versions: "current"`), whose ticket may live in no tree at
    // all. A ticket with neither path nor `key` names nothing stable, so it is refused.
    const pathOptional = p.source?.kind === 'custom' && p.source?.versions === 'current';
    if (t.path !== undefined && t.path !== null) {
      if (!isTicketPath(t.path)) fail(`${t.id}.path`, 'must be a relative path, no segment empty, . or ..');
    } else if (!pathOptional || t.key == null) {
      fail(`${t.id}.path`, pathOptional ? 'a ticket with no path must carry key' : 'must be a relative path, no segment empty, . or ..');
    }
    // B-183 (§12.3): the version is the source's opaque string, the key its stable name; both
    // untrusted text, validated on write, compared for equality only.
    if (t.version !== undefined && t.version !== null && (typeof t.version !== 'string' || !VERSION.test(t.version))) {
      fail(`${t.id}.version`, `must be 1–128 characters of ${VERSION.source} (R-BTN-74)`);
    }
    if (t.key !== undefined && t.key !== null && (typeof t.key !== 'string' || t.key.length < 1 || t.key.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:+/=-]*$/.test(t.key))) {
      fail(`${t.id}.key`, 'must be a short stable name of the source\'s own');
    }
    // B-183 (R-BTN-147, round 1): two live tickets of one post never share a stable key (`key`,
    // or the `path` that stands for it) — materialization's renumbering read would keep whichever
    // row built last, and a later drop at that key would move hold and backoff to an arbitrary
    // survivor of the collision.
    const stableKey = t.key ?? t.path;
    if (stableKey != null) {
      if (seenKeys.has(stableKey)) fail(`${t.id}.key`, `${stableKey} is already the key of another ticket in this post`);
      seenKeys.add(stableKey);
    }
    if (typeof t.title !== 'string' || !TEXT.test(t.title)) fail(`${t.id}.title`, 'must be short plain text');
    if (t.tier != null && !NAME.test(t.tier)) fail(`${t.id}.tier`, 'must be a tier name');
    if (!Array.isArray(t.requires)) fail(`${t.id}.requires`, 'must be a list (`none` and no clause are [])');
    // B-106 (R-BTN-178, §4.4): `requires` arrives expanded to capabilities — the normative post
    // admits the typed names the interim one does (B-104), or a ticket whose clause names a
    // capability could never be posted in the shape every repository but docs uses.
    list(t.requires, new RegExp(`^(?:${NAME.source}|${HOLDING_TYPE}:${HOLDING_VALUE})$`), `${t.id}: requires`);
    if (typeof t.operator_only !== 'boolean' || typeof t.expedite !== 'boolean') fail(`${t.id}`, 'operator_only and expedite are booleans');
    for (const k of ['depends_on', 'blocked_by'] as const) {
      if (!isObjArr(t[k], DEP_MAX)) fail(`${t.id}.${k}`, `must be a list of at most ${DEP_MAX}`);
      list(t[k], ID, `${t.id}: ${k}`);
    }
    if (!isObjArr(t.repos, 64)) fail(`${t.id}.repos`, 'must be a list of at most 64');
    list(t.repos, REPO, `${t.id}: repos`);
    if (t.rank != null && !(Number.isSafeInteger(t.rank) && t.rank >= 0)) fail(`${t.id}.rank`, 'must be a non-negative integer');
    // R-BTN-116 (§4.4): the queued person leg's question. Its shape here; whether the ticket's
    // queued leg is a person's — and each option's `reached` one of the leg's own outcomes — is
    // judged where the course in force is known, when the question is stored.
    if (t.question !== undefined && t.question !== null) {
      const q = t.question;
      const at = `${t.id}.question`;
      if (!isObj(q)) fail(at, 'must be {id, url?, severity?, options?}');
      else {
        for (const k of Object.keys(q)) if (!['id', 'url', 'severity', 'options'].includes(k)) fail(`${at}.${k}`, 'is not a question field');
        if (typeof q.id !== 'string' || !DECISION_ID.test(q.id)) fail(`${at}.id`, `must match ${DECISION_ID}`);
        if (q.id.startsWith('baton.')) fail(`${at}.id`, 'a question id never begins "baton." — that is Baton\'s own (R-BTN-78)');
        if (q.url != null && (typeof q.url !== 'string' || q.url.length > 1000)) fail(`${at}.url`, 'must be a URL string of at most 1000 characters');
        if (q.severity != null && !['critical', 'high', 'normal'].includes(q.severity as string)) fail(`${at}.severity`, 'must be critical, high or normal (R-BTN-125)');
        if (q.options !== undefined && q.options !== null) {
          if (!isObjArr(q.options, DECISIONS_MAX)) fail(`${at}.options`, `must be a list of at most ${DECISIONS_MAX} options`);
          else {
            const ids = new Set<string>();
            for (const [j, o] of (q.options as { id?: unknown; reached?: unknown }[]).entries()) {
              if (!isObj(o) || typeof (o as { id?: unknown }).id !== 'string' || !OPTION_ID.test((o as { id: string }).id)) fail(`${at}.options[${j}].id`, `must match ${OPTION_ID}`);
              if (typeof (o as { reached?: unknown }).reached !== 'string' || !LEG_ID.test((o as { reached: string }).reached)) fail(`${at}.options[${j}].reached`, 'must be a station id');
              const oid = (o as { id: string }).id;
              if (ids.has(oid)) fail(`${at}.options[${j}].id`, `${oid} appears twice`);
              ids.add(oid);
            }
          }
        }
      }
    }
    if (t.display !== undefined) {
      if (!isObj(t.display)) fail(`${t.id}.display`, 'must be an object');
      for (const [k, v] of Object.entries(t.display)) {
        if (!['status', 'group', 'project'].includes(k) || (v != null && (typeof v !== 'string' || !TEXT.test(v) || v.length > 64))) fail(`${t.id}.display.${k}`, 'must be status, group or project, short plain text');
      }
    }
    // B-127 item 7: the brief's mark. The shape here; whose keys may sign is the sync's fact,
    // re-verified by every runner that loads what the post names (item 4).
    if (t.brief !== undefined && t.brief !== null) {
      const b = t.brief;
      const at = `${t.id}.brief`;
      if (!isObj(b) || typeof b.commit !== 'string' || !SHA.test(b.commit)) fail(at, 'must be {signed, signer?, commit}');
      else {
        if (typeof b.signed !== 'boolean') fail(`${at}.signed`, 'must be a boolean');
        if (b.signer !== undefined && b.signer !== null && (typeof b.signer !== 'string' || !FINGERPRINT.test(b.signer))) fail(`${at}.signer`, 'must be a key fingerprint');
        if (typeof b.signed === 'boolean' && b.signed && (b.signer === undefined || b.signer === null)) fail(at, 'a signed brief names its signing key');
        if (b.signed === false && b.signer != null) fail(at, 'an unsigned brief names no signing key');
      }
    }
  }
  if (p.closed !== undefined) {
    if (!isObjArr(p.closed, TICKETS_MAX)) fail('closed', `must be a list of at most ${TICKETS_MAX}`);
    for (const [i, c] of p.closed.entries()) {
      if (!isObj(c) || typeof c.id !== 'string' || !ID.test(c.id) || (c.as !== 'done' && c.as !== 'withdrawn')) fail(`closed[${i}]`, "must be {id, as: 'done' | 'withdrawn'}");
      if (seen.has(c.id)) fail(`closed[${i}]`, `${c.id} is also live`);
    }
  }
  // B-111: a post whose live tickets' `depends_on` form a cycle is refused, naming it — no
  // ticket source posts a loop that would hold every ticket on it out of the default order
  // unseen. After `closed` is seen, so the graph is the live one exactly.
  const live = new Set(p.tickets!.map((t) => t.id));
  for (const c of p.closed ?? []) live.delete(c.id);
  const loop = dependsCycle(p.tickets!.filter((t) => live.has(t.id)).map((t) => ({ id: t.id, depends_on: t.depends_on })));
  if (loop) fail('tickets.depends_on', `a dependency cycle: ${loop.join(' → ')}`);
  if (p.stations !== undefined) {
    if (!isObj(p.stations) || Object.keys(p.stations).length > TICKETS_MAX) fail('stations', 'must be an object of local ids');
    for (const [id, st] of Object.entries(p.stations)) {
      const at = `stations.${id}`;
      if (!seen.has(id)) fail(at, `${id} is not in tickets`);
      if (!isObj(st) || typeof st.station !== 'string' || !LEG_ID.test(st.station)) fail(`${at}.station`, 'must be a station id');
      if (!isObjArr(st.path, PATH_MAX)) fail(`${at}.path`, `must be a list of at most ${PATH_MAX} steps`);
      for (const [j, step] of st.path.entries()) {
        if (!isObj(step) || typeof step.leg !== 'string' || !LEG_ID.test(step.leg) || typeof step.reached !== 'string' || !LEG_ID.test(step.reached)) fail(`${at}.path[${j}]`, 'must be {leg, reached}');
      }
      if (st.next_leg !== null && (typeof st.next_leg !== 'string' || !LEG_ID.test(st.next_leg))) fail(`${at}.next_leg`, 'must be a leg id or null');
      if (!['course', 'marker', 'inferred', 'holder'].includes(st.next_source)) fail(`${at}.next_source`, 'must be course, marker, inferred or holder');
      if (st.handoff_url != null && !isHttpsPointer(st.handoff_url)) fail(`${at}.handoff_url`, 'must be an https URL of at most 1000 characters');
      if (!isObjArr(st.next, NEXT_MAX)) fail(`${at}.next`, `must be a list of at most ${NEXT_MAX}`);
      const legs = new Set<string>();
      for (const [j, n] of st.next.entries()) {
        if (!isObj(n) || typeof n.leg !== 'string' || !LEG_ID.test(n.leg) || (n.state !== 'ready' && n.state !== 'waiting')) fail(`${at}.next[${j}]`, "must be {leg, state: 'ready' | 'waiting'}");
        if (n.waiting_on != null && (typeof n.waiting_on !== 'string' || !WAITING_ON.test(n.waiting_on))) fail(`${at}.next[${j}].waiting_on`, 'must be a short label');
        if (legs.has(n.leg)) fail(`${at}.next[${j}]`, `${n.leg} appears twice`);
        legs.add(n.leg);
        // R-BTN-76: a name that fails the resource rule is kept out when stored, blocking nothing;
        // only the list's shape refuses.
        if (n.needs !== undefined && !(isObjArr(n.needs, NEEDS_MAX) && n.needs.every((x) => typeof x === 'string' && /^[^\u0000-\u001f\u007f]{1,100}$/.test(x)))) fail(`${at}.next[${j}].needs`, `must be a list of at most ${NEEDS_MAX} resource names`);
      }
      if (st.decisions !== undefined) {
        if (!isObjArr(st.decisions, DECISIONS_MAX)) fail(`${at}.decisions`, `must be a list of at most ${DECISIONS_MAX}`);
        const ids = new Set<string>();
        for (const [j, d] of st.decisions.entries()) {
          if (!isObj(d) || typeof d.id !== 'string' || !DECISION_ID.test(d.id)) fail(`${at}.decisions[${j}].id`, `must match ${DECISION_ID}`);
          if (typeof d.asks !== 'string' || !ASKS.test(d.asks)) fail(`${at}.decisions[${j}].asks`, `must match ${ASKS}`);
          if (d.leg != null && (typeof d.leg !== 'string' || !LEG_ID.test(d.leg))) fail(`${at}.decisions[${j}].leg`, 'must be a leg id');
          if (d.url != null && typeof d.url !== 'string') fail(`${at}.decisions[${j}].url`, 'must be a string');
          if (d.question != null && (typeof d.question !== 'string' || !DECISION_QUESTION.test(d.question))) fail(`${at}.decisions[${j}].question`, 'must be one line of at most 200 characters');
          if (d.options !== undefined) {
            if (!isObjArr(d.options, DECISION_OPTIONS_MAX)) fail(`${at}.decisions[${j}].options`, `must be a list of at most ${DECISION_OPTIONS_MAX}`);
            const seen = new Set<string>();
            for (const [k, o] of (d.options as unknown[]).entries()) {
              const oat = `${at}.decisions[${j}].options[${k}]`;
              if (!isObj(o) || typeof o.id !== 'string' || !DECISION_OPTION.test(o.id)) fail(`${oat}.id`, `must match ${DECISION_OPTION}`);
              const oid = (o as Record<string, unknown>).id as string;
              if (seen.has(oid)) fail(`${oat}.id`, `${oid} appears twice`);
              seen.add(oid);
              const g = (o as Record<string, unknown>).grants;
              if (g !== undefined && (!isObj(g) || typeof g.leg !== 'string' || !LEG_ID.test(g.leg) || !Number.isInteger(g.runs) || (g.runs as number) < 1 || (g.runs as number) > DECISION_GRANT_MAX)) {
                fail(`${oat}.grants`, `must be {leg, runs: 1–${DECISION_GRANT_MAX}}`);
              }
            }
          }
          if (ids.has(d.id)) fail(`${at}.decisions[${j}].id`, `${d.id} appears twice`);
          ids.add(d.id);
        }
      }
      if (!isObj(st.bars) || Object.keys(st.bars).length > BARS_MAX) fail(`${at}.bars`, `must map at most ${BARS_MAX} legs to tags`);
      for (const [leg, tags] of Object.entries(st.bars)) {
        if (!LEG_ID.test(leg) || !isObjArr(tags, BARS_MAX) || !(tags as unknown[]).every((t) => typeof t === 'string' && TAG.test(t))) fail(`${at}.bars.${leg}`, `must be a list of at most ${BARS_MAX} tags`);
      }
    }
  }
}

/** A ticket's `**Depends on:**` line: the ticket ids it names, or null when the body has no
 *  such line. The FIRST such line outside a fenced code block, which runs to the next blank line
 *  or the next `**Label:**` line (B-111); ids are matched by `idPattern`. A reverse mention
 *  belongs on a `**Used by:**` line, which this never reads. Fieldhouse's
 *  `scripts/check-wiki.mjs` gave the algorithm, kept as theirs (round 1). */
const LABEL = '**Depends on:**';
export function bodyDependencies(body: string, idPattern: RegExp): string[] | null {
  const lines = body.split('\n');
  let start = -1;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    // A fence toggles: a marker inside a code block is an example, never the ticket's own line.
    if (/^\s*(\x60\x60\x60|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
    if (!fenced && lines[i].startsWith(LABEL)) { start = i; break; }
  }
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== '' && !/^\*\*[^*]+:\*\*/.test(lines[end])) end++;
  const text = lines.slice(start, end).join(' ').slice(LABEL.length);
  const word = new RegExp(idPattern.source.replace(/^\^|\$$/g, ''), 'g');
  return [...new Set(text.match(word) ?? [])];
}

/** Every dependency cycle among `tickets` — each `{id, depends_on}` — each once, as its path,
 *  `B-1 → B-2 → B-1`; `[]` when there is none (B-111). An edge is taken to an id in `tickets`
 *  and to no other: an id that is neither live nor closed cannot be a cycle, and naming it is
 *  the ticket check's business (`baton tickets check`), not the board's. Depth-first from the
 *  ids in sorted order, so the cycles named are the same on every run; a self-dependency is
 *  `A → A`. Cycles are grouped by the tickets they hold, so two loops over the same members
 *  are one finding (round 2, 2-r0-2) and a loop that is not the first found over a shared
 *  member may go unnamed — the board names the first, and the check's job is to fail the
 *  build, not to enumerate every walk. The stack is the walk's own: a legal board of
 *  TICKETS_MAX tickets may be one 10 000-long chain, which recursion cannot walk (1-A-3).
 *  Fieldhouse's algorithm, made iterative. Pure, so `src/defaults/tickets-check.ts` runs it
 *  too (defaults may import core, never the reverse). */
export function dependsCycles(tickets: readonly { id: string; depends_on: readonly string[] }[]): string[][] {
  const deps = new Map(tickets.map((t) => [t.id, t.depends_on ?? []]));
  const state = new Map<string, 'open' | 'closed'>(); // 'open' while on the current path
  const found: string[][] = [];
  const seen = new Set<string>(); // a cycle's canonical key, so one loop is named once
  for (const root of [...deps.keys()].sort()) {
    if (state.has(root)) continue;
    // An explicit stack: each frame is an id, the position it reached in its dependency list,
    // and its own place on the walk's path (the cycle starts where a dependency is open).
    const stack: { id: string; at: number }[] = [{ id: root, at: 0 }];
    const path: string[] = [root];
    const onPath = new Map<string, number>([[root, 0]]);
    state.set(root, 'open');
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const list = deps.get(frame.id) ?? [];
      if (frame.at >= list.length) {
        stack.pop();
        path.pop();
        onPath.delete(frame.id);
        state.set(frame.id, 'closed');
        continue;
      }
      const dep = list[frame.at++];
      if (!deps.has(dep)) continue;
      if (state.get(dep) === 'open') {
        const loop = [...path.slice(onPath.get(dep)!), dep];
        // The same loop reached from another entry point has the same members: one finding.
        const key = [...new Set(loop)].sort().join('\u0000');
        if (!seen.has(key)) { seen.add(key); found.push(loop); }
        continue;
      }
      if (state.has(dep)) continue;
      state.set(dep, 'open');
      onPath.set(dep, path.length);
      path.push(dep);
      stack.push({ id: dep, at: 0 });
    }
  }
  return found;
}

/** The first dependency cycle, `dependsCycles`' first — the board's refusal names one (§4.4). */
export function dependsCycle(tickets: readonly { id: string; depends_on: readonly string[] }[]): string[] | null {
  return dependsCycles(tickets)[0] ?? null;
}

/** A posted station as stored: optional fields filled. */
export function stationOf(st: PostedStation): PostedStation {
  return {
    station: st.station,
    path: st.path.map((s) => ({ leg: s.leg, reached: s.reached })),
    next_leg: st.next_leg,
    next_source: st.next_source,
    handoff_url: st.handoff_url ?? null,
    next: st.next.map((n) => ({ leg: n.leg, state: n.state, waiting_on: n.waiting_on ?? null, needs: [...new Set(n.needs ?? [])] })),
    decisions: (st.decisions ?? []).map((d) => ({
      id: d.id, leg: d.leg ?? null, asks: d.asks, url: d.url ?? null,
      // B-110: the question and the options, when posted — the owner's answer is one of these.
      ...(d.question != null ? { question: d.question } : {}),
      ...(d.options?.length ? { options: d.options.map((o) => ({ id: o.id, ...(o.grants ? { grants: { leg: o.grants.leg, runs: o.grants.runs } } : {}) })) } : {}),
    })),
    bars: Object.fromEntries(Object.entries(st.bars).map(([leg, tags]) => [leg, [...new Set(tags)].sort()])),
  };
}

const MODEL = /^[A-Za-z0-9._/:-]{1,200}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};
function regex(field: string, pattern: unknown) {
  if (typeof pattern !== 'string') bad(field, 'must be a pattern string');
  try {
    new RegExp(pattern as string, 'i');
  } catch {
    bad(field, 'is not a valid pattern');
  }
}
function catalog(field: string, agents: unknown) {
  if (!isObj(agents)) bad(field, 'must be an object of agents');
  for (const [name, a] of Object.entries(agents as Record<string, unknown>)) {
    if (!NAME.test(name) || !isObj(a)) bad(`${field}.${name}`, 'is malformed');
    const agent = a as Record<string, unknown>;
    if (typeof agent.reviews_on !== 'string' || !MODEL.test(agent.reviews_on)) bad(`${field}.${name}.reviews_on`, 'must be a model id');
    if (!Array.isArray(agent.bills) || !agent.bills.every((b) => typeof b === 'string' && NAME.test(b))) bad(`${field}.${name}.bills`, 'must be a list of prefixes');
    if (agent.models !== undefined && !(isObj(agent.models) && Object.entries(agent.models).every(([k, v]) => NAME.test(k) && typeof v === 'string' && MODEL.test(v)))) {
      bad(`${field}.${name}.models`, 'must map prefixes to model ids');
    }
  }
}

/** The reference blocks (§7.3, §7.4) are docs data files: a malformed one is refused, named,
 *  before anything is written, never left to fail a constraint mid-transaction. The model
 *  tables' blocks (B-142) validate nowhere: `providers` and `prices` are accepted unread. */
function checkReference(p: BoardPayload) {
  if (p.matrix !== undefined) {
    if (!isObj(p.matrix) || !isObj(p.matrix.families)) bad('matrix.families', 'must be an object');
    for (const [fam, pats] of Object.entries(p.matrix.families)) {
      if (!NAME.test(fam) || !Array.isArray(pats)) bad(`matrix.families.${fam}`, 'must be a list of patterns');
      pats.forEach((pat, i) => regex(`matrix.families.${fam}[${i}]`, pat));
    }
    catalog('matrix.agents', p.matrix.agents);
  }
  if (p.reviewers !== undefined) catalog('reviewers', p.reviewers);
  if (p.transcript_repos !== undefined && !(Array.isArray(p.transcript_repos) && p.transcript_repos.length <= 20 && p.transcript_repos.every((r) => typeof r === 'string' && parseTranscriptRepo(r) !== null))) {
    bad('transcript_repos', 'must be a list of repositories, each a GitHub owner/name or <forge>:<web_base>');
  }
}

/** The row an item becomes (R-BTN-33). `rank` is its index in the sync's `ready` list. A
 *  clause is stored expanded (§7.2 rule 4): a role becomes its capabilities, a legacy name
 *  stays itself, `none` stores nothing; `operator_only` carries rule 6. */
export function rowFor(it: StateItem, rankOf: Map<string, number>): TicketRow {
  const tags = it.tags ?? [];
  const names = it.requires ?? null;
  const clause = names == null ? 'absent' : names.every((n) => n === 'none') ? 'none' : 'listed';
  const path = `content/roadmap/${it.id}.mdx`;
  return {
    id: it.id,
    path,
    // The interim post carries no versions (B-183): no version held, the path the key.
    version: '',
    key: path,
    title: it.title,
    project: it.project ?? null,
    status: it.status,
    node: it.node,
    queue: it.queue,
    tags: JSON.stringify(tags),
    tier: it.tier ?? null,
    requires_clause: clause,
    operator_only: tags.includes('OP') || (names ?? []).includes('human-operator') ? 1 : 0,
    depends_on: JSON.stringify(it.dependsOn ?? []),
    blocked_by: JSON.stringify(it.blockedBy ?? []),
    repos: JSON.stringify(it.repos ?? []),
    ord: it.order == null ? null : String(it.order),
    rank: rankOf.get(it.id) ?? null,
    course_id: it.course ?? DEFAULT_COURSE,
    requires: [...capabilitiesOf(names)].sort(),
    since: calendarDate(it.since),
    holder: typeof it.holder === 'string' && SESSION_NAME.test(it.holder) ? it.holder : null,
    expedite: it.queue === 'expedite' ? 1 : 0,
    display: null,
  };
}

/** The row a normative ticket becomes (§7.1, R-BTN-33). Its factory-state fields — status, node,
 *  queue, tags — are docs' interim vocabulary and stay empty: `display` carries what is shown, and
 *  nothing reads it. `requires` arrives expanded; `[]` is no requirement. */
export function rowForTicket(t: PostedTicket): TicketRow {
  const names = [...new Set(t.requires)];
  return {
    id: t.id,
    path: t.path ?? '',
    // B-183: the source's opaque version and stable key; `version` is an input of `row_hash`, so
    // a ticket whose version changed rewrites its row on a refresh too (§4.3, R-BTN-11).
    version: t.version ?? '',
    key: t.key ?? t.path ?? null,
    title: t.title,
    project: t.display?.project ?? null,
    status: '',
    node: '',
    queue: '',
    tags: '[]',
    tier: t.tier ?? null,
    requires_clause: names.length ? 'listed' : 'none',
    operator_only: t.operator_only ? 1 : 0,
    depends_on: JSON.stringify(t.depends_on),
    blocked_by: JSON.stringify(t.blocked_by),
    repos: JSON.stringify(t.repos),
    ord: null,
    rank: t.rank ?? null,
    course_id: t.course_id,
    requires: [...capabilitiesOf(names)].sort(),
    since: null,
    holder: null,
    expedite: t.expedite ? 1 : 0,
    display: t.display ? JSON.stringify(t.display) : null,
    brief: t.brief === undefined || t.brief === null ? null : JSON.stringify(t.brief),
  };
}

/** `since` comes from a Status note's date, which git does not check: a value that is not a
 *  real calendar day (`2026-13-01`, `2026-02-31`) is unknown for that item, and never refuses the
 *  whole board. The legacy import then counts from the cutover itself. */
export function calendarDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

/** The row's hash: what decides whether an accepted snapshot rewrites it (§7.1). */
export async function rowHash(row: TicketRow): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(row));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

