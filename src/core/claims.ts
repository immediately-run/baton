// claims.ts — the fenced lease (BATON_SPEC §6.1–6.7, §7.2 rules 1–10, §11 claim, end, holder and
// reap rows; R3-1212), with attempts, retries, holds and resume records (§6.10–6.11; R3-1217): claiming by the matching rules, ending in §6.5's vocabulary, the alarm's
// reaps, the fence before re-issue (R-BTN-19), confirmation by ancestry, and git winning over a
// stale claim (R-BTN-35). The lock is the two partial unique indexes: a claim inserts and lets
// SQLite refuse a second holder, never check-then-insert without them (R-BTN-4).
import { expiredLeaseSql, isClaimLeaseLive, leaseEndsAt, liveDeclaringRunnerSql, liveRunnerSql, type Lease } from './runnerLiveness';
import { BatonError } from './http';
import { sessionLinkWhy, transcriptUrl, type SessionLinkView } from './links';
import { groupBy, isUniqueViolation, logEvent, mintRunId, randomHex, type Random } from './db';
import type { Deprecated } from './deprecated';
import { fitsTier, capabilitiesOf, TIERS } from '../shared/vocabulary.mjs';
import { afterFailure, countsAsFailed, nonRetryableClass, resumeRecord, type ResumeActivity } from './attempts';
import { checkAccept, checkAdvance, checkClaim, checkConfirm, checkDecisionAnswer, checkEnd, checkOverride, checkResolve, isGrantedKey, type ClaimPreference, type End, type Output } from './validate';
import { ceilingIn, repositoryOf, transcriptReposOf } from './registry';
import { GATE_CODES, gatesFor, type GateContext, type GateLeg, type GateTicket, type GateVerdict, type Phase } from './gates';
import { GIT_EVIDENCE_TYPE, type PostedAttestation } from './board';
import { extendsPath, leaves, resolveLeg, resolveStation, runsOf, type Graph, type Step } from './graph';
import { baseChain, PATTERN_STEPS_MAX, unboundedAt, validate, type Schema } from '../shared/schema.mjs';
import type { Seen, Stations } from './stations';
import { meetsRequiredBar, requiredBarCovers, type Admin } from './admin';
import { legStateOf } from './policy';
import { briefMark, writtenBy, type LastWrittenBy } from './provenance';
import type { Row, SqlValue, Store } from './ports';
import { schedulingVersion } from './stateVersion';
import { fleetSummary, instanceView, opaque, REPORT_AGE_FROM, REPORTS_FROM, requireFleetScope, type ViewScope } from './runnerViews';
import type { Resources } from './resources';
import { REPORT_HORIZON_MS } from './validate';
import type { Blocks } from './blocks';
import type { Conditions } from './conditions';
import type { History } from './history';
const EXPEDITE_BOUND = 2; // §7.2 rule 2, advice
/** §2e: a claim regressed this long is listed under Needs you. */
export const REGRESSED_FLAG_MS = 30 * 60_000;
/** §14 Needs you: how long a bars-mismatch stays listed (spec-silent, recorded on R3-1232). */
const BARS_MISMATCH_LISTED_MS = 24 * 3_600_000;
const RELEASE_ACK_MS = 2 * 3_600_000; // §9: a delivered release unacknowledged for 2 h reaps the claim
const LEG_TIMEOUT_ACK_MS = 15 * 60_000; // R-BTN-90, S-BTN-52
export const UNCONFIRMED_FLAG_MS = 6 * 3_600_000; // §6.7
export const STALLED_MS = 2 * 3_600_000; // §14 Running: alive but no activity for 2 h
/** §7.5 R-BTN-90: what a `leg_finished` heartbeat re-arms a still-armed deadline to — now plus
 *  40 minutes, once per leg run, so finishing is never the end. */
const LEG_FINISH_REARM_MS = 40 * 60_000;
/** R-BTN-35: the git states that end an active claim `released:stale-board`. */
const GIT_ENDS = new Set(['done', 'superseded', 'deferred', 'deprioritized']);

export interface Ctx {
  store: Store;
  now: () => number;
  /** B-185: the core's random source, for a run id's random half. */
  random: Random;
  /** Where each ticket is, and its course's graph (R-BTN-70). */
  stations: Stations;
  /** The owners' bars and settings (R-BTN-66, R-BTN-67). */
  admin: Admin;
  /** §12: ask for the ticket's repository's sync or mirror to be dispatched once this
   *  request's transaction has committed. */
  dispatch: (kind: 'mirror' | 'sync', ticketId: string) => void;
  /** R-BTN-75: whether a claim holds a ticket moves its blocked state; each change says so. */
  blocks: Pick<Blocks, 'held' | 'forRunner' | 'raise' | 'answer' | 'answerPosted' | 'hasDecision' | 'postedDecision'>;
  /** R-BTN-81, R-BTN-85: the ticket's history and Baton's disagreements with git. */
  history: Pick<History, 'record' | 'discrepancy'>;
  /** R-BTN-79: a course's intake, `closed` while any of its legs is over its `max_queue`. */
  intake: (repo: string, course: string) => 'open' | 'closed';
  /** R-BTN-108: a schema by id for a repository — the `std:` library's or the repository's. */
  schema: (repo: string, id: string) => Schema | null;
  /** §12.8 (B-145): the repository policies, including the `floor` rule (R-BTN-189). */
  policies: Pick<import('./policy').Policies, 'current' | 'isProtectionChecker' | 'brokenUnderFloors'>;
  /** A repository's forge, for the knobs that a `git` repository refuses (R-BTN-188). */
  forgeOf: (repository: string) => import('./links').Forge;
  /** B-134: the leg scope audit — the claim answer's scope, and the reports an advance or an
   *  end carries. */
  scope: Pick<import('./scope').Scope, 'scopeOf' | 'exceeded'>;
  /** B-234 (R-BTN-160, R-BTN-195): the raised conditions — an open `interact` of a run closes
   *  in the transactions that end the run (the advance that finishes it, the claim's end). */
  conditions: Pick<Conditions, 'runEnded'>;
  /** B-4 (R-BTN-113): the instance's session-host allowlist, `instance_settings` first, else the
   *  deploy's BATON_SESSION_HOSTS. */
  sessionHosts: () => string[];
  /** The retired-fields window's one writer (B-168): a claim's `bills`. */
  deprecated: Pick<Deprecated, 'note'>;
}

interface RunnerFacts {
  id: number;
  kind: string;
  incarnation: number;
  tier_ceiling: string;
  /** Per repository (R-BTN-66); `ceilingIn` resolves the one rule 5 compares. */
  tier_ceilings: Record<string, string>;
  lease_timeout_ms: number;
  last_seen_at: number;
  last_activity_at: number | null;
  declared: string[];
  /** The courses its checkouts run (R-BTN-48): rule 9. */
  courses: { repository: string; course: string; version: number }[];
  /** R-BTN-60: what rule 8 matches. */
  tags: string[];
  credential_id: string;
  /** R-BTN-107: the isolation its last heartbeat declared. */
  isolation: 'attached' | 'process' | 'session';
  /** R-BTN-58: its key's grants by repository, or null for a key no owner granted (gates.ts). */
  grants: Record<string, { capabilities: string[]; max_tier: number | null; max_claims: number }> | null;
  /** R-BTN-4 (B-188): what its last heartbeat declared it can run at once, and the active claims
   *  it holds now. */
  concurrency: number;
  held: number;
}

interface ItemFacts {
  id: string;
  repository: string;
  course: string;
  path: string;
  tier: string | null;
  requires: string[] | null;
  operator_only: boolean;
  expedite: boolean;
  rank: number | null;
  courseFields: string | null;
  /** B-126 (R-BTN-194): who last pushed the ticket's body, when Baton has a record of it. */
  last_written_by?: LastWrittenBy;
  /** B-127 item 7: the brief's mark — whether an owner key signed it, and which. */
  brief?: { signed: boolean; signer?: string; commit: string };
  /** Where the head snapshot places it, or null when it places it nowhere. */
  station: { station: string; path: Step[]; next_leg: string | null; to_end: number; handoff_url: string | null } | null;
}

/** A row of the candidate query (§7.2). */
interface Candidate {
  id: string;
  repository_id: string;
  course_id: string;
  weight: number;
  expedite: number;
  to_end: number;
  ready_since: number | null;
  n: number;
  /** Rule 9 for the row's (repository, course) group — per group, so filtering on it after the
   *  numbering drops whole groups and leaves every other row's `n` as it was (B-237). */
  r9: number;
}

/** B-237: what one recommendation or claim decision reads many times and no write changes
 *  between — the per-request reads, held only while `cached` runs. */
interface RequestCache {
  ladder: Map<string, string[]>;
  bars: Map<string, ReturnType<Admin['bars']>>;
  capacity: { capability: string; capacity: number }[] | null;
  head: Map<string, number>;
  minVersion: Map<string, number>;
  unsigned: Set<string> | null;
  intake: Map<string, 'open' | 'closed'>;
  item: Map<string, ItemFacts | null>;
  candidatePages: Map<string, { cursor: [number, number, number, number, number, string]; count: number }>;
  override: Map<string, { expedite: number; hold: number; retry_after: number | null } | null>;
}

/** B-237 (R-BTN-196): an idle runner's last answer — nothing eligible — kept while the state
 *  version stands and no clock deadline has passed. `refusal` is the claim's, once one ran. */
interface IdleMemo {
  version: number;
  until: number;
  refusal: BatonError | null;
}

/** B-237: the longest an idle answer is reused, whatever the deadlines say. */
export const IDLE_MEMO_MS = 10 * 60_000;

/** An entry of `GET /v1/runner/recommendations` (§11). */
export interface Recommendation {
  ticket_id: string;
  station: string;
  legs: string[];
  course: { id: string; data: unknown };
  reasons: string[];
  flags: string[];
  handoff_url: string | null;
  /** B-126 (R-BTN-194): who last pushed the ticket's body, when Baton has a record of it. */
  last_written_by?: LastWrittenBy;
  /** B-127 item 7: the brief's mark, served beside it (the signer half of provenance). */
  brief?: { signed: boolean; signer?: string; commit: string };
}

interface HeldClaim {
  id: number;
  runner_id: number;
  ticket_id: string;
  status: string;
  end_reason: string | null;
  station: string;
  leg: string | null;
  course_id: string | null;
  start_path: string;
  offered_leg: string | null;
  claim_observation: number;
  regressed_since: number | null;
}

/** A course with no registry row maps branches the default way (R-BTN-51). */
const DEFAULT_BRANCH_PATTERN = 'claude/{ticket}-*';
/** Whether `branch` is `pattern` with `{ticket}` = `local` and `{repository}` = `repository`,
 *  `*` matching any run of characters, compared case-insensitively as GitHub branch names are
 *  typed. A wildcard match, not a regex: it returns to the last star only, so it takes at most
 *  |branch| × |pattern| steps, never the exponential backtracking a pattern's stars can force on
 *  a RegExp. */
export function branchMatches(pattern: string, branch: string, local: string, repository: string): boolean {
  const p = pattern.replace(/\{ticket\}|\{repository\}/g, (m) => (m === '{ticket}' ? local : repository)).toLowerCase();
  // `*` in a local id or repository id cannot occur (LOCAL_ID, REPOSITORY_ID), so every star is the pattern's.
  const b = branch.toLowerCase();
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (i < b.length) {
    if (j < p.length && p[j] !== '*' && p[j] === b[i]) {
      i++;
      j++;
    } else if (j < p.length && p[j] === '*') {
      star = j++;
      mark = i;
    } else if (star >= 0) {
      j = star + 1;
      i = ++mark;
    } else {
      return false;
    }
  }
  while (j < p.length && p[j] === '*') j++;
  return j === p.length;
}

/** B-110: the most rows of each kind `syncRecord` hands the sync. */
/** R-BTN-10: a post's evidence attestations by claim id (`Claims.evidenceOf`). */
export type PostedEvidence = Map<number, { ticket: string; evidence: string; found: boolean }>;

const SYNC_RECORD_MAX = 2000;
/** R-BTN-10: the most unconfirmed ends the observation lists — one post's attestations (§4.4). */
const EVIDENCE_LIST_MAX = 100;

export class Claims {
  constructor(private readonly c: Ctx) {}

  /** B-240: `q`'s rows for the ids (bound as the JSON array `ids` names), or none without a
   *  query when there are no ids. */
  private forIds<T = Row>(ids: string, q: string, ...p: unknown[]): T[] {
    return ids === '[]' ? [] : this.rows<T>(q, ...p);
  }

  /** B-237: the per-request reads while a recommendation or a claim decision runs. */
  private cache: RequestCache | null = null;
  /** B-237 (R-BTN-196): each idle runner's memoised "nothing eligible", in memory only — an
   *  evicted object recomputes once. */
  private readonly idle = new Map<number, IdleMemo>();
  /** B-237's test seam: true reads as before it — every candidate gated, nothing cached, no
   *  memo, the refusal's second candidate query — so a test can compare the answers. */
  reference = false;

  private cached<T>(fn: () => T): T {
    if (this.cache || this.reference) return fn();
    this.cache = { ladder: new Map(), bars: new Map(), capacity: null, head: new Map(), minVersion: new Map(), unsigned: null, intake: new Map(), item: new Map(), override: new Map(), candidatePages: new Map() };
    try {
      return fn();
    } finally {
      this.cache = null;
    }
  }
  private memo<K, V>(m: Map<K, V> | undefined, k: K, read: () => V): V {
    if (!m) return read();
    if (m.has(k)) return m.get(k)!;
    const v = read();
    m.set(k, v);
    return v;
  }

  private rows<T = Row>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec(q, ...p).toArray() as T[];
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }
  /** A query with `:name` parameters, bound in the order they occur. */
  private named<T>(q: string, params: Record<string, unknown>): T[] {
    const values: unknown[] = [];
    const sql = q.replace(/:([a-z_][a-z0-9_]*)/g, (m, name: string) => {
      if (!(name in params)) return m;
      values.push(params[name]);
      return '?';
    });
    return this.rows<T>(sql, ...values);
  }
  private get stations() {
    return this.c.stations;
  }
  private event(kind: string, actor: string, detail: unknown, ticketId: string | null = null, claimId: number | null = null, repo?: string) {
    logEvent(this.c.store, this.c.now(), kind, actor, detail, ticketId, claimId, repo ?? (ticketId ? repositoryOf(ticketId) : null));
  }
  /** Whether the ticket's repository has cut over (R-BTN-28, per repository). */
  private cutOver(ticketId: string) {
    return this.rows('SELECT 1 FROM repositories WHERE id = ? AND cutover_at IS NOT NULL', repositoryOf(ticketId)).length > 0;
  }
  private anyCutOver() {
    return this.rows('SELECT 1 FROM repositories WHERE cutover_at IS NOT NULL AND retired_at IS NULL').length > 0;
  }
  private headOf(repo: string) {
    return this.rows<{ sha: string | null }>('SELECT sha FROM board_head WHERE repository_id = ?', repo)[0]?.sha ?? null;
  }

  // ── the repository policy's stops (§12.8, B-145) ────────────────────────────────────────

  /** R-BTN-189: every repository a ticket reaches — its home and each `repos:` entry that
   *  resolves to a registered repository (R-BTN-140's code-repository entries among them). */
  private reachedRepositories(ticketId: string): string[] {
    const home = repositoryOf(ticketId);
    const row = this.rows<{ repos: string }>('SELECT repos FROM tickets WHERE id = ?', ticketId)[0];
    const paths: string[] = row ? JSON.parse(row.repos) as string[] : [];
    if (!paths.length) return [home];
    const reached = new Set<string>([home]);
    for (const p of paths) {
      const r = this.rows<{ id: string }>('SELECT id FROM repositories WHERE github = ? COLLATE NOCASE AND retired_at IS NULL', p)[0];
      if (r) reached.add(r.id);
    }
    return [...reached];
  }

  /** R-BTN-189's rule `floor`, at a claim and an advance: Baton itself
   *  refuses to offer or accept work on a ticket that reaches a repository whose floored
   *  guarantee is broken, except for the protection checker, which keeps checking. */
  private refuseStopped(ticketId: string, runner?: { credential_id: string }): void {
    const policies = this.c.policies;
    const home = repositoryOf(ticketId);
    if (!runner || !policies.isProtectionChecker(runner.credential_id, home)) {
      const broken = [home, ...this.reachedRepositories(ticketId).filter((r) => r !== home)]
        .flatMap((r) => policies.brokenUnderFloors(r).map((b) => ({ ...b, repository: r })))[0];
      if (broken) {
        throw new BatonError('not-eligible', `${ticketId}: the floor ${broken.floor} is broken on ${broken.repository} (${broken.guarantee}) (R-BTN-189)`, { rule: 'floor', rule_code: 'floor-broken', repository: broken.repository });
      }
    }
  }

  /** R-BTN-189: a floored guarantee broke on `repository` — every running claim on a ticket
   *  that reaches it is sent a `release` with reason `floor` and ends `released:floor`, the
   *  protection checker's excepted. Called by the policy store, from the report and alarm
   *  paths, inside their transactions. */
  releaseForFloor(repository: string): void {
    const holders = this.rows<{ id: number; ticket_id: string; runner_id: number; credential_id: string }>(
      `SELECT c.id, c.ticket_id, c.runner_id, w.credential_id FROM claims c JOIN runners w ON w.id = c.runner_id
       WHERE c.status = 'active' AND (c.ticket_id LIKE ? || ':%' OR c.ticket_id IN (SELECT t.ticket_id FROM ticket_repositories t WHERE t.repository_key = lower(?)))`,
      repository, this.forgePathOf(repository)).filter((h) => {
        // R-BTN-180: the protection checker keeps checking.
        if (this.c.policies.isProtectionChecker(h.credential_id, repository)) return false;
        return this.reachedRepositories(h.ticket_id).includes(repository);
      });
    for (const h of holders) {
      this.exec(`INSERT INTO messages (kind, payload_json, from_principal, to_runner_id, sent_at, status) VALUES ('release', ?, 'server', ?, ?, 'pending')`,
        JSON.stringify({ ticket_id: h.ticket_id, reason: 'floor' }), h.runner_id, this.c.now());
      this.finish(h.id, h.ticket_id, 'released', 'released:floor', 'server', { detail: `floor on ${repository}` });
    }
  }

  /** A repository's forge path, for matching a ticket's `repos:` entries. */
  private forgePathOf(repository: string): string {
    return this.rows<{ github: string }>('SELECT github FROM repositories WHERE id = ?', repository)[0]?.github ?? '';
  }

  // ── what matching reads ─────────────────────────────────────────────────────────────────

  private runner(id: number): RunnerFacts {
    const w = this.rows<Omit<RunnerFacts, 'declared' | 'courses' | 'tier_ceilings' | 'tags' | 'grants'> & { tier_ceilings: string; created_by: string | null }>(
      `SELECT w.id, w.kind, w.incarnation, w.tier_ceiling, w.tier_ceilings, w.lease_timeout_ms, w.last_seen_at, w.last_activity_at, w.credential_id, w.isolation, w.concurrency,
              (SELECT COUNT(*) FROM claims k WHERE k.runner_id = w.id AND k.status = 'active') AS held, c.created_by
       FROM runners w JOIN credentials c ON c.id = w.credential_id WHERE w.id = ?`, id)[0];
    if (!w) throw new BatonError('unauthenticated', 'no such runner');
    const declared = this.rows<{ declared: string }>('SELECT DISTINCT declared FROM runner_capabilities WHERE runner_id = ? ORDER BY declared', id).map((r) => r.declared);
    const courses = this.rows<{ repository: string; course: string; version: number }>(
      'SELECT repository_id AS repository, course_id AS course, version FROM runner_courses WHERE runner_id = ? ORDER BY repository_id, course_id', id);
    const tags = this.rows<{ tag: string }>('SELECT tag FROM runner_tags WHERE runner_id = ? ORDER BY tag', id).map((r) => r.tag);
    const { created_by, ...facts } = w;
    return { ...facts, tier_ceilings: JSON.parse(w.tier_ceilings) as Record<string, string>, declared, courses, tags, grants: this.grantsOf(w.credential_id, created_by) };
  }

  /** R-BTN-58: a granted key's grants in force by repository. A key an owner or administrator
   *  registered works only where it is granted. A BATON_KEYS seed key's allow-list is its grant
   *  for every repository it may reach (B-104 deletes §11.1's refusal of a heartbeat declaring
   *  an ungranted capability, so the intersection moved into rule 4, where the grant bounds H);
   * the seed retires with R3-1240's grants. A bearer token keeps null's interim reach. */
  private grantsOf(credential: string, createdBy: string | null): RunnerFacts['grants'] {
    // B-104 (round 1, A1): an interim credential — a bearer token's policy or a BATON_KEYS seed
    // (any key no owner or administrator granted) — is bound by its allow-list exactly as a
    // granted key is by its grant, since §11.1's refusal of a heartbeat declaring an ungranted
    // capability was deleted: rule 4's H = declared ∩ allow-list, on every repository it may
    // reach. Never null — null meant unbounded, and nothing is unbounded any more.
    if (!isGrantedKey(createdBy)) {
      // 3-r3-1: ONE expansion, here at the source — an allow-list entry naming `<type>:*`
      // admits the runner's declared holdings of that type, so every reader of the grant
      // (gatesFor, the candidate query, the fleet) sees the same set instead of gatesFor alone
      // widening it.
      const allowed = this.rows<{ allowed_capabilities: string }>('SELECT allowed_capabilities FROM credentials WHERE id = ?', credential)[0];
      const listed = allowed ? (JSON.parse(allowed.allowed_capabilities) as string[]) : [];
      const set = new Set(listed);
      if (listed.some((c) => c.endsWith(':*'))) {
        const declared = this.rows<{ capability: string }>('SELECT capability FROM runner_capabilities WHERE runner_id IN (SELECT id FROM runners WHERE credential_id = ?)', credential).map((r) => r.capability);
        for (const c of declared) if (listed.includes(`${c.split(':')[0]}:*`)) set.add(c);
      }
      const capabilities = [...set];
      return Object.fromEntries(this.rows<{ id: string }>('SELECT id FROM repositories WHERE retired_at IS NULL')
        .map((r) => [r.id, { capabilities, max_tier: null, max_claims: 1 }]));
    }
    const patterns = groupBy(this.rows<{ repository_id: string; capability_pattern: string }>(
      `SELECT c.repository_id, c.capability_pattern FROM grant_capabilities c JOIN runner_grants g
       ON g.credential_id = c.credential_id AND g.repository_id = c.repository_id
       WHERE c.credential_id = ? AND g.revoked_at IS NULL`, credential), 'repository_id');
    return Object.fromEntries(this.rows<{ repository_id: string; max_tier: number | null; max_claims: number }>(
      'SELECT repository_id, max_tier, max_claims FROM runner_grants WHERE credential_id = ? AND revoked_at IS NULL', credential)
      .map((g) => [g.repository_id, { capabilities: (patterns.get(g.repository_id) ?? []).map((c) => c.capability_pattern as string), max_tier: g.max_tier, max_claims: g.max_claims }]));
  }

  /** R-BTN-4 (B-188): the most claims the runner may hold while claiming in `repository` — the
   *  lower of its declared `concurrency` and that repository's grant's `max_claims` (1 for a key
   *  no grant binds). */
  private claimBound(w: RunnerFacts, repository: string): number {
    return Math.min(w.concurrency, w.grants?.[repository]?.max_claims ?? 1);
  }

  /** R-BTN-4: refuse a claim past the runner's bound, naming both numbers. */
  private refuseFull(w: RunnerFacts, repository: string | null): void {
    const bound = repository == null ? w.concurrency : this.claimBound(w, repository);
    if (w.held < bound) return;
    const grant = repository == null ? null : w.grants?.[repository]?.max_claims ?? 1;
    throw new BatonError('not-eligible',
      `this runner holds ${w.held} claim(s), its bound${repository ? ` on ${repository}` : ''}: concurrency ${w.concurrency}${grant != null ? `, the grant's max_claims ${grant}` : ''} (R-BTN-4)`,
      { rule: 'max-claims', rule_code: 'max-claims', held: w.held, concurrency: w.concurrency, ...(grant != null ? { max_claims: grant } : {}) });
  }

  /** A ticket's filter fields and where the head snapshot places it (R-BTN-33, R-BTN-70). */
  private item(id: string): ItemFacts | null {
    return this.memo(this.cache?.item, id, () => this.readItem(id));
  }
  private readItem(id: string): ItemFacts | null {
    const r = this.rows<{ id: string; repository_id: string; course_id: string; path: string; tier: string | null; requires_clause: string; operator_only: number; rank: number | null; course_fields_json: string | null; expedite: number; last_written_by: string | null; brief: string | null }>(
      'SELECT id, repository_id, course_id, path, tier, requires_clause, operator_only, rank, course_fields_json, expedite, last_written_by, brief FROM tickets WHERE id = ?', id)[0];
    if (!r) return null;
    const requires = r.requires_clause === 'listed'
      ? this.rows<{ name: string }>('SELECT name FROM ticket_requires WHERE ticket_id = ? ORDER BY name', id).map((x) => x.name)
      : null;
    const s = this.rows<{ station: string; path: string; next_leg: string | null; to_end: number; handoff_url: string | null }>(
      'SELECT station, path, next_leg, to_end, handoff_url FROM ticket_stations WHERE ticket_id = ?', id)[0] ?? null;
    return {
      id: r.id, repository: r.repository_id, course: r.course_id, path: r.path, tier: r.tier, requires, operator_only: !!r.operator_only, rank: r.rank, courseFields: r.course_fields_json,
      expedite: !!r.expedite || !!this.override(id)?.expedite,
      ...((w) => (w ? { last_written_by: w } : {}))(writtenBy(r.last_written_by)),
      ...((b) => (b ? { brief: b } : {}))(briefMark(r.brief)),
      station: s ? { station: s.station, path: JSON.parse(s.path) as Step[], next_leg: s.next_leg, to_end: s.to_end, handoff_url: s.handoff_url } : null,
    };
  }

  /** `GET /v1/repositories/{repository}/tickets/{ticket}` (§11, R-BTN-194): the ticket as Baton
   *  holds it — its filter fields, where the head snapshot places it, who last pushed its body
   *  and its brief mark (B-127) — for the principals that may read its blocks. Null when the ticket is not on the board. */
  ticketView(id: string): Record<string, unknown> | null {
    const item = this.item(id);
    if (!item) return null;
    const r = this.rows<{ title: string; project: string | null; expedite: number; snapshot_sha: string; course_id: string; parent: string | null }>(
      'SELECT title, project, expedite, snapshot_sha, course_id, parent FROM tickets WHERE id = ?', id)[0];
    // R-BTN-86 (§4.6, R3-1258): the ticket's tree — its parent, and its children open and
    // closed — the data the Courses ticket view draws its tree from.
    const children = this.rows<{ id: string; station: string | null }>(
      `SELECT t.id, s.station FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.parent = ? ORDER BY t.id`, id);
    const closed = this.rows<{ ticket_id: string; closed_as: string }>(
      'SELECT ticket_id, closed_as FROM closed_tickets WHERE parent = ? ORDER BY ticket_id', id);
    return {
      ticket_id: item.id, repository: item.repository, course_id: r?.course_id ?? item.course, title: r?.title ?? null,
      path: item.path, tier: item.tier, requires: item.requires ?? [], operator_only: item.operator_only, expedite: item.expedite,
      rank: item.rank, snapshot_sha: r?.snapshot_sha ?? null,
      parent: r?.parent ?? null,
      children: [
        ...children.map((c) => ({ ticket_id: c.id, station: c.station })),
        ...closed.map((c) => ({ ticket_id: c.ticket_id, closed: c.closed_as })),
      ],
      station: item.station ? { station: item.station.station, path: item.station.path, next_leg: item.station.next_leg, to_end: item.station.to_end,
        ...(item.station.handoff_url ? { handoff_url: item.station.handoff_url } : {}) } : null,
      ...(item.last_written_by ? { last_written_by: item.last_written_by } : {}),
      ...(item.brief ? { brief: item.brief } : {}),
    };
  }

  private override(id: string) {
    return this.memo(this.cache?.override, id, () =>
      this.rows<{ expedite: number; hold: number; retry_after: number | null }>('SELECT expedite, hold, retry_after FROM ticket_overrides WHERE ticket_id = ?', id)[0] ?? null);
  }

  /** A repository's tier ladder, lowest first (R-BTN-66). */
  private ladder(repo: string): string[] {
    return this.memo(this.cache?.ladder, repo, () => {
      const t = this.rows<{ tiers: string }>('SELECT tiers FROM repositories WHERE id = ?', repo)[0]?.tiers;
      return t ? (JSON.parse(t) as string[]) : [...TIERS];
    });
  }

  /** The runner's ceiling in `repo`'s ladder, by name (rule 5). */
  private ceiling(w: RunnerFacts, repo: string): string {
    const ladder = this.ladder(repo);
    const declared = ceilingIn(repo, ladder, w.tier_ceilings, w.tier_ceiling);
    // R-BTN-58: a grant's max_tier caps what the key may take there.
    const cap = w.grants?.[repo]?.max_tier;
    return cap != null && cap < ladder.indexOf(declared) ? ladder[Math.max(0, Math.min(cap, ladder.length - 1))] : declared;
  }

  /** The counter's last number handed out for `repo` (R-BTN-62): recorded with a claim, an
   *  advance and an end, so only a reading numbered above it can judge them. */
  handedOut(repo: string): number {
    return this.rows<{ n: number }>('SELECT last_handed_out AS n FROM board_head WHERE repository_id = ?', repo)[0]?.n ?? 0;
  }

  /** R-BTN-88 (§4.8): the freeze in force, or null — a frozen Baton refuses new claims (the
   *  gate in `claim`), never lease upkeep. */
  frozenAt(): number | null {
    const raw = this.rows<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'frozen_at'`)[0]?.value;
    const n = raw == null ? NaN : Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  /** The leg as the head snapshot posted it for the ticket, its barred tags (R-BTN-70), and what
   *  the course file asks of whoever takes it (R-BTN-106, R-BTN-107). */
  private postedLeg(item: ItemFacts, leg: string, phase: Phase, withRunner = true): GateLeg {
    const n = this.rows<{ state: 'ready' | 'waiting' }>('SELECT state FROM ticket_next_legs WHERE ticket_id = ? AND leg = ?', item.id, leg)[0];
    const posted = this.rows<{ tag: string }>('SELECT tag FROM ticket_bars WHERE ticket_id = ? AND leg = ? ORDER BY tag', item.id, leg).map((r) => r.tag);
    const g = this.stations.graph(item.repository, item.course);
    const def = g?.legs.get(leg);
    // R-BTN-106 (B-168): the course file's `no_chain_from` alone — the owners have no second
    // statement of it. Each name is followed through `renamed_from`, as the leg itself is.
    const noChainFrom = [...new Set((def?.noChainFrom ?? []).map((l) => (g ? resolveLeg(g, l) ?? l : l)))];
    // R-BTN-120: the file's own `requires.capabilities`, which rule 4 reads beside the clause.
    // R-BTN-116: whether the leg is a person's, which rule `person` refuses at a claim or an advance.
    return { name: leg, state: n?.state ?? null, bars: [...new Set([...posted, ...(withRunner ? this.ownerBarTags(item, leg, phase) : [])])], noChainFrom, isolation: def?.isolation ?? null, requires: def?.requires ?? [], person: def?.person ?? false };
  }

  /** R-BTN-106: the legs `credential` has run on the ticket, in this claim or an earlier one —
   *  `claim_legs` through each claim's runner to its credential — as current names. */
  private ranByKey(item: ItemFacts, credential: string): string[] {
    const g = this.stations.graph(item.repository, item.course);
    return this.rows<{ leg: string }>(
      `SELECT DISTINCT l.leg FROM claim_legs l JOIN claims k ON k.id = l.claim_id JOIN runners w ON w.id = k.runner_id
       WHERE k.ticket_id = ? AND w.credential_id = ?`, item.id, credential).map((r) => (g ? resolveLeg(g, r.leg) ?? r.leg : r.leg));
  }

  /** R-BTN-67: the tags the owner bars in force bar from `leg` of the ticket — its course's bars and
   *  those for `*`, on every leg or on the legs they name (followed through `renamed_from`); at an
   *  advance only those that apply at advances. */
  private ownerBarTags(item: ItemFacts, leg: string, phase: Phase): string[] {
    const g = this.stations.graph(item.repository, item.course);
    return this.memo(this.cache?.bars, item.repository, () => this.c.admin.bars([item.repository], this.c.now()))
      .filter((b) => (b.course === '*' || b.course === item.course) && (phase === 'claim' || b.applies === 'claim+advance')
        && (!b.legs.length || b.legs.some((l) => (g ? resolveLeg(g, l) ?? l : l) === leg)))
      .map((b) => b.tag);
  }

  /** `gatesFor`'s inputs for one ticket (§7.2), from Baton's own tables (R-BTN-33). */
  private gate(w: RunnerFacts | null, item: ItemFacts, leg: string, phase: Phase, opts: { except?: number; holderBars?: string[] } = {}): GateVerdict {
    const ticket: GateTicket = { repository: item.repository, course: item.course, tier: item.tier, requires: item.requires, operator_only: item.operator_only, tiers: this.ladder(item.repository) };
    const facts: GateContext = {
      now: this.c.now(),
      claims: this.rows(`SELECT status, confirmed_at, fence_pending FROM claims WHERE ticket_id = ? AND id IS NOT ? AND (status = 'active' OR (status = 'completed' AND confirmed_at IS NULL) OR (status = 'reaped' AND fence_pending = 1))`, item.id, opts.except ?? null),
      override: this.override(item.id),
      // Rule 9 (R-BTN-65): a ticket whose course is not registered fits no runner.
      minRunnerVersion: this.memo(this.cache?.minVersion, `${item.repository}\u0000${item.course}`, () =>
        this.rows<{ v: number }>('SELECT min_runner_version AS v FROM courses WHERE repository_id = ? AND id = ?', item.repository, item.course)[0]?.v ?? Number.POSITIVE_INFINITY),
      headObservation: this.memo(this.cache?.head, item.repository, () =>
        this.rows<{ n: number }>('SELECT observation AS n FROM board_head WHERE repository_id = ?', item.repository)[0]?.n ?? 0),
      lastEndObservation: this.rows<{ n: number | null }>('SELECT MAX(end_observation) AS n FROM claims WHERE ticket_id = ?', item.id)[0]?.n ?? -1,
      holderBars: opts.holderBars,
      ranByKey: w ? this.ranByKey(item, w.credential_id) : [],
      // R-BTN-78: Baton's own decisions refuse nothing advice would not — `baton:retries` sits on a
      // ticket its hold keeps (rule 3), `baton:stalled` on a queued leg posted waiting (rule 1) — so
      // they are left to those rules, whose refusals name the cause; they stay blocks for asking.
      blocks: this.rows<{ kind: string; leg: string }>(
        `SELECT b.kind, b.leg FROM ticket_blocks b WHERE b.ticket_id = ? AND b.kind IN ('ticket', 'decision')
           AND NOT (b.kind = 'decision' AND EXISTS (SELECT 1 FROM ticket_decisions d WHERE d.ticket_id = b.ticket_id AND d.decision_id = b.ref AND d.source = 'baton'))`, item.id),
      // R-BTN-178: rule 11's fact — the seats claims other than the asking one hold (a claim's
      // own seat never counts against it, so an advance excludes the advancing claim here).
      seats: this.seatFacts(item, leg, opts.except ?? null),
    };
    return gatesFor(w && { declared: w.declared, tier_ceiling: this.ceiling(w, item.repository), tags: w.tags, courses: w.courses, grants: w.grants, isolation: w.isolation }, ticket, this.postedLeg(item, leg, phase, !!w), phase, facts);
  }

  /** R-BTN-178: the capabilities rule 4 matched for this leg — the ticket's requires clause and
   *  the leg's own (§6.6), expanded as `graphOf` expanded the file. Seats are written from this
   *  set as it stands when the leg starts; a later snapshot never changes a held seat. */
  private rule4Set(item: ItemFacts, leg: string): Set<string> {
    const def = this.stations.graph(item.repository, item.course)?.legs.get(leg);
    return new Set([...capabilitiesOf(item.requires), ...(def?.requires ?? [])]);
  }

  /** Rule 11's fact (R-BTN-178, §6.11): each capability with a capacity in rule 4's set for this
   *  leg, with the seats claims other than `except` hold on it — active claims and fence-pending
   *  reaped ones (R-BTN-19), counted across every repository of the tenant (R-BTN-137). Empty,
   *  and one query, when no capability has a capacity. */
  private seatFacts(item: ItemFacts, leg: string, except: number | null): Record<string, { capacity: number; held: number }> {
    const out: Record<string, { capacity: number; held: number }> = {};
    const read = () => this.rows<{ capability: string; capacity: number }>('SELECT capability, capacity FROM capability_capacity');
    const caps = this.cache ? (this.cache.capacity ??= read()) : read();
    if (!caps.length) return out;
    const needs = this.rule4Set(item, leg);
    for (const c of caps) {
      if (!needs.has(c.capability)) continue;
      const held = this.rows<{ n: number }>(
        `SELECT count(*) AS n FROM claim_seats s JOIN claims k ON k.id = s.claim_id
          WHERE s.capability = ? AND k.id IS NOT ?
            AND (k.status = 'active' OR (k.status = 'reaped' AND k.fence_pending = 1))`, c.capability, except)[0].n;
      out[c.capability] = { capacity: c.capacity, held };
    }
    return out;
  }

  /** R-BTN-178: the claim's seats, written in the claim's or the advance's own transaction — one
   *  row per capability with a capacity in rule 4's set for the leg it starts, the set as it
   *  stands then (a later snapshot changes no held seat). An advance rewrites the set, so one
   *  into a leg not requiring a capability releases that seat; the claim's end deletes the rest. */
  private writeSeats(claimId: number, item: ItemFacts, leg: string | null): void {
    this.exec('DELETE FROM claim_seats WHERE claim_id = ?', claimId);
    if (leg == null) return;
    const capped = this.rows<{ capability: string }>('SELECT capability FROM capability_capacity').map((r) => r.capability);
    if (!capped.length) return;
    const needs = this.rule4Set(item, leg);
    for (const capability of capped) {
      if (needs.has(capability)) this.exec('INSERT OR IGNORE INTO claim_seats (claim_id, capability) VALUES (?, ?)', claimId, capability);
    }
  }

  /** R-BTN-178: the claims holding a capability's seats, for a rule-11 refusal's message — the
   *  holders' hostnames and tickets, named only where the caller's key is granted on the holder's
   *  repository (R-BTN-99); an interim key, granted everywhere (B-104, A1), sees them all. */
  private seatHolders(capability: string, except: number | null, w?: RunnerFacts): string[] {
    return this.rows<{ id: number; ticket_id: string; hostname: string }>(
      `SELECT k.id, k.ticket_id, w.hostname FROM claim_seats s JOIN claims k ON k.id = s.claim_id JOIN runners w ON w.id = k.runner_id
        WHERE s.capability = ? AND k.id IS NOT ?
          AND (k.status = 'active' OR (k.status = 'reaped' AND k.fence_pending = 1))
        ORDER BY k.id`, capability, except)
      .filter((h) => w == null || w.grants == null || w.grants[repositoryOf(h.ticket_id)] != null)
      .map((h) => `claim ${h.id} on ${h.ticket_id} by ${h.hostname}`);
  }

  /** Rule 2's count (advice): active Baton claims on expedited tickets, not git in-progress. */
  private expediteActive(): number {
    return this.rows<{ n: number }>(
      `SELECT count(*) AS n FROM claims c LEFT JOIN tickets w ON w.id = c.ticket_id
       LEFT JOIN ticket_overrides o ON o.ticket_id = c.ticket_id
       WHERE c.status = 'active' AND (w.expedite = 1 OR o.expedite = 1)`)[0].n;
  }

  /**
   * §7.2's candidate query, the mirror of `gatesFor` at a claim: per (repository, course) group,
   * the tickets whose queued leg is ready with none of its posted barred tags on the runner, a
   * sync since their last end, rules 3, 4, 5 (as a position in the repository's ladder), 6, 9 and
   * 10, in the default order — expedite, `to_end`, rank, `ready_since`, id — numbered within the
   * group, and the `page`th 50 of each group. Only cut-over repositories are claimed through Baton.
   * Rule 9 is per group, so it is read after the query (`r9`): `rule9` drops the groups it
   * refuses, and one reading serves the recommendation and a refusal's `stale-skills` check
   * alike (B-237).
   */
  private referenceCandidates(w: RunnerFacts, page = 0, rule9 = true): Candidate[] {
    const rows = this.named<Candidate>(
      `SELECT id, repository_id, course_id, weight, expedite, to_end, ready_since, n FROM (
         SELECT w.id, w.repository_id, w.course_id, p.weight, s.to_end, a.ready_since,
                MAX(w.expedite, COALESCE((SELECT o.expedite FROM ticket_overrides o WHERE o.ticket_id = w.id), 0)) AS expedite,
                ROW_NUMBER() OVER (PARTITION BY w.repository_id, w.course_id
                                   ORDER BY MAX(w.expedite, COALESCE((SELECT o.expedite FROM ticket_overrides o WHERE o.ticket_id = w.id), 0)) DESC,
                                            s.to_end, w.rank IS NULL, w.rank, a.ready_since, w.id) AS n
         FROM tickets w
         JOIN repositories p ON p.id = w.repository_id
         JOIN ticket_stations s ON s.ticket_id = w.id
         JOIN ticket_next_legs a ON a.ticket_id = w.id AND a.leg = s.next_leg AND a.state = 'ready'          -- rule 1
         WHERE p.cutover_at IS NOT NULL AND p.retired_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM ticket_bars b JOIN runner_tags t ON t.tag = b.tag
                           WHERE b.ticket_id = w.id AND b.leg = a.leg AND t.runner_id = :runner)                -- rule 8's posted bars
           AND json_extract(:heads, '$."' || w.repository_id || '"')                                         -- (each head's observation, read once: B-237)
               > COALESCE((SELECT MAX(c.end_observation) FROM claims c WHERE c.ticket_id = w.id), -1)          -- §6.7: a sync since the last end
           AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.ticket_id = w.id
                           AND (c.status = 'active'
                                OR (c.status = 'completed' AND c.confirmed_at IS NULL)
                                OR (c.status = 'reaped' AND c.fence_pending = 1)))                             -- rule 3
           AND NOT EXISTS (SELECT 1 FROM ticket_overrides o WHERE o.ticket_id = w.id
                           AND (o.hold = 1 OR o.retry_after > :now))                                          -- rules 3, 10
           AND NOT EXISTS (SELECT 1 FROM ticket_blocks k WHERE k.ticket_id = w.id
                           AND (k.kind = 'ticket' OR (k.kind = 'decision' AND k.leg IN ('', a.leg))))         -- rule 1's blocks
           AND (EXISTS (SELECT 1 FROM runner_grants g WHERE g.credential_id = :credential
                        AND g.repository_id = w.repository_id AND g.revoked_at IS NULL)                       -- rule 7
                OR NOT EXISTS (SELECT 1 FROM runner_grants g2 WHERE g2.credential_id = :credential))          -- an interim credential reaches every repository (B-104, A1)
           AND NOT EXISTS (SELECT 1 FROM ticket_requires r WHERE r.ticket_id = w.id
                           AND r.name NOT IN (SELECT h.capability FROM (
                                SELECT c.capability FROM runner_capabilities c                                 -- rule 4 (R-BTN-174): the runner's declared holdings,
                                 WHERE c.runner_id = :runner                                                    -- matched by name — its grant there admits them
                                   AND (c.capability LIKE 'runner:%'                                        -- 'runner:' capabilities beside them (R-BTN-133)
                                        OR c.capability IN (SELECT j.value FROM runner_grants g, json_each(g.capabilities) j
                                                            WHERE g.credential_id = :credential AND g.repository_id = w.repository_id
                                                              AND g.revoked_at IS NULL)
                                        OR EXISTS (SELECT 1 FROM runner_grants g2, json_each(g2.capabilities) j2                -- and <type>:* admits the type's holdings (R-BTN-58)
                                                    WHERE g2.credential_id = :credential AND g2.repository_id = w.repository_id
                                                      AND g2.revoked_at IS NULL AND j2.value LIKE '%:*'
                                                      AND c.capability LIKE substr(j2.value, 1, length(j2.value) - 1) || '%')
                                        OR (NOT EXISTS (SELECT 1 FROM runner_grants g3 WHERE g3.credential_id = :credential)    -- an interim credential: the allow-list is its
                                            AND c.capability IN (SELECT j4.value FROM json_each((SELECT allowed_capabilities      -- grant (B-104, A1: nothing is unbounded)
                                                                     FROM credentials WHERE id = :credential)) j4)))) h))
           AND a.leg NOT IN (SELECT p.value FROM json_each(COALESCE(json_extract(:person,                          -- rule person (R-BTN-116): a person's leg is
                               '$."' || w.repository_id || '/' || w.course_id || '"'), '[]')) p)                -- never offered, whatever else it holds (each course's, read once)
           AND NOT EXISTS (SELECT 1 FROM courses k, json_each(k.leg_capabilities_json) l                           -- rule 4's leg input (R-BTN-120, B-86), read the same
                           WHERE k.repository_id = w.repository_id AND k.id = w.course_id AND l.key = a.leg      -- way as the ticket's clause; the one literal
                             AND EXISTS (SELECT 1 FROM json_each(l.value) q                                     -- human-operator included — rule 6 is retired (R-BTN-121
                                         WHERE q.value NOT IN (SELECT h.capability FROM (                        -- as amended): declared by that name, granted by that name.
                                              SELECT c.capability FROM runner_capabilities c
                                               WHERE c.runner_id = :runner
                                                 AND (c.capability LIKE 'runner:%'
                                                      OR c.capability IN (SELECT j.value FROM runner_grants g, json_each(g.capabilities) j
                                                                          WHERE g.credential_id = :credential AND g.repository_id = w.repository_id
                                                                            AND g.revoked_at IS NULL)
                                                              OR EXISTS (SELECT 1 FROM runner_grants g2, json_each(g2.capabilities) j2
                                                                          WHERE g2.credential_id = :credential AND g2.repository_id = w.repository_id
                                                                            AND g2.revoked_at IS NULL AND j2.value LIKE '%:*'
                                                                            AND c.capability LIKE substr(j2.value, 1, length(j2.value) - 1) || '%')
                                                      OR (NOT EXISTS (SELECT 1 FROM runner_grants g3 WHERE g3.credential_id = :credential)
                                                          AND c.capability IN (SELECT j4.value FROM json_each((SELECT allowed_capabilities
                                                                                                   FROM credentials WHERE id = :credential)) j4)))) h)))
           AND COALESCE(w.tier_position, json_array_length(p.tiers) - 1)
               <= json_extract(:ceiling, '$."' || w.repository_id || '"'))                                     -- rule 5, per repository
       WHERE n > :page * 50 AND n <= (:page + 1) * 50
       ORDER BY repository_id, course_id, n`,
      { runner: w.id, now: this.c.now(), ceiling: JSON.stringify(this.ceilingPositions(w)), page,
        heads: JSON.stringify(Object.fromEntries(this.rows<{ r: string; n: number }>('SELECT repository_id AS r, observation AS n FROM board_head').map((h) => [h.r, h.n]))),
        person: JSON.stringify(Object.fromEntries(this.rows<{ r: string; c: string; legs: string }>('SELECT repository_id AS r, id AS c, person_legs_json AS legs FROM courses WHERE person_legs_json IS NOT NULL')
          .map((k) => [`${k.r}/${k.c}`, JSON.parse(k.legs) as unknown]))),
        // A leg's `requires` is compared as `graphOf` expanded it: the registry writes that view to
        // `leg_capabilities_json` from `legNeedsOf` when it accepts a file (§12.5), so the query reads
        // capabilities only. Rule 4 matches them by name against the declared holdings the grant
        // admits (R-BTN-174); rule 6 is retired, so `human-operator` is the one literal both sides
        // compare. A grant stores capabilities only, so no role is bound.
        granted: w.grants ? 1 : 0, credential: w.credential_id });
    // Rule 9, per group: a course the runner declares at its registered min_runner_version or
    // above (an unregistered course fits no runner) — read once, not once a ticket.
    const min = new Map(this.rows<{ repository_id: string; id: string; v: number }>('SELECT repository_id, id, min_runner_version AS v FROM courses')
      .map((k) => [`${k.repository_id}\u0000${k.id}`, k.v]));
    for (const r of rows) {
      const v = min.get(`${r.repository_id}\u0000${r.course_id}`);
      r.r9 = v != null && w.courses.some((k) => k.repository === r.repository_id && k.course === r.course_id && k.version >= v) ? 1 : 0;
    }
    return rule9 ? rows.filter((r) => r.r9) : rows;
  }

  /** B-287 / S-BTN-243: one ordered index walk per group, no board-wide window sort.
   * The projection contains runner-independent facts; all runner gates remain authoritative.
   * JSON parameters below are small request-local sets, expanded once, never stored documents
   * expanded for every candidate. Page cursors live only for this synchronous decision. */
  candidates(w: RunnerFacts, page = 0, rule9 = true, wanted: string[] | null = null, skipExpedited?: ReadonlySet<string>): Candidate[] {
    if (this.reference) return this.referenceCandidates(w, page, rule9);
    const groups = this.rows<{ repository_id: string; course_id: string; weight: number; min_runner_version: number; observation: number; tiers: string }>(
      `SELECT k.repository_id, k.id AS course_id, p.weight, k.min_runner_version, h.observation, p.tiers
       FROM courses k JOIN repositories p ON p.id = k.repository_id JOIN board_head h ON h.repository_id = p.id
       WHERE p.cutover_at IS NOT NULL AND p.retired_at IS NULL ORDER BY k.repository_id, k.id`);
    const out: Candidate[] = [];
    const holdings = capabilitiesOf(w.declared);
    for (const g of groups) {
      const key = `${g.repository_id}\u0000${g.course_id}`;
      if (wanted && !wanted.includes(key)) continue;
      const grant = w.grants?.[g.repository_id];
      if (w.grants && !grant) continue;
      const admitted = new Set(grant?.capabilities ?? []);
      const caps = JSON.stringify([...holdings].filter((c) => !grant || c.startsWith('runner:') || admitted.has(c) || admitted.has(`${c.split(':')[0]}:*`)));
      const tiers = JSON.parse(g.tiers) as string[];
      const ceiling = tiers.indexOf(this.ceiling(w, g.repository_id));
      const r9 = w.courses.some((k) => k.repository === g.repository_id && k.course === g.course_id && k.version >= g.min_runner_version) ? 1 : 0;
      if (rule9 && !r9) continue;
      const legs = this.rows<{ leg: string }>(`SELECT l.leg FROM course_legs l
        WHERE l.repository_id = ? AND l.course_id = ? AND l.person = 0
        AND NOT EXISTS (SELECT 1 FROM course_leg_capabilities c
          WHERE c.repository_id = l.repository_id AND c.course_id = l.course_id AND c.leg = l.leg
          AND c.capability NOT IN (SELECT value FROM json_each(?)))`, g.repository_id, g.course_id, caps).map((l) => l.leg);
      if (!legs.length) continue;
      const prior = page > 0 ? this.cache?.candidatePages.get(key) : undefined;
      if (prior && prior.count < page * 50) continue;
      const after = prior ? `AND (-q.expedite, q.to_end, q.rank IS NULL, COALESCE(q.rank, 0), COALESCE(q.ready_since, -1), q.ticket_id) > (?, ?, ?, ?, ?, ?)` : '';
      const found = this.rows<Omit<Candidate, 'n' | 'r9' | 'weight'> & { rank: number | null }>(
        `SELECT q.ticket_id AS id, q.repository_id, q.course_id, q.expedite, q.to_end, q.rank, q.ready_since
         FROM ready_tickets q INDEXED BY ready_tickets_order
         WHERE q.repository_id = ? AND q.course_id = ?
           AND q.last_end_observation < ? AND (q.retry_after IS NULL OR q.retry_after <= ?)
           AND COALESCE(q.tier_position, ?) <= ?
           AND q.leg IN (SELECT value FROM json_each(?))
           AND NOT EXISTS (SELECT 1 FROM ticket_bars b JOIN runner_tags t ON t.tag = b.tag
             WHERE b.ticket_id = q.ticket_id AND b.leg = q.leg AND t.runner_id = ?)
           AND NOT EXISTS (SELECT 1 FROM ticket_requires r WHERE r.ticket_id = q.ticket_id
             AND r.name NOT IN (SELECT value FROM json_each(?)))
           ${skipExpedited?.has(key) ? 'AND -q.expedite = 0' : ''} ${after}
         ORDER BY -q.expedite, q.to_end, q.rank IS NULL, COALESCE(q.rank, 0), COALESCE(q.ready_since, -1), q.ticket_id
         LIMIT 50${page > 0 && !prior ? ' OFFSET ?' : ''}`,
        g.repository_id, g.course_id, g.observation, this.c.now(), tiers.length - 1, ceiling,
        JSON.stringify(legs), w.id, caps, ...(prior?.cursor ?? []), ...(page > 0 && !prior ? [page * 50] : []));
      const last = found.at(-1);
      if (last) this.cache?.candidatePages.set(key, {
        cursor: [-last.expedite, last.to_end, Number(last.rank == null), last.rank ?? 0, last.ready_since ?? -1, last.id],
        count: page * 50 + found.length,
      });
      out.push(...found.map((r, i) => ({ ...r, weight: g.weight, r9, n: page * 50 + i + 1 })));
    }
    return out;
  }

  /** The runner's ceiling's position in every repository's ladder: the query's rule 5. */
  private ceilingPositions(w: RunnerFacts): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.rows<{ id: string; tiers: string }>('SELECT id, tiers FROM repositories WHERE retired_at IS NULL')) {
      const ladder = JSON.parse(r.tiers) as string[];
      out[r.id] = ladder.indexOf(this.ceiling(w, r.id));
    }
    return out;
  }

  /**
   * R-BTN-45 and R-BTN-61: the legs this runner may take, sorted. Each (repository, course) group
   * is read 50 at a time in the default order, each candidate re-checked by
   * `gatesFor`; a group left short of `limit` reads its next page, at most 4. The groups merge by
   * expedite, the repository's weight, the place in the group, `to_end`, `ready_since` and id.
   * Rule 2 is advice: past the expedite lane's bound an expedited ticket loses its lane and says
   * so (`expedite-bound`). Every entry passes every gate.
   *
   * B-237: gated lazily, in the order the merge reads — a group stops gating once `limit` have
   * passed (under a full lane, once `limit` of its expedited and `limit` of its others have, the
   * two runs the lane's re-sort merges), since no later row of the group can reach the first
   * `limit`; the answer is the one gating every candidate gives. `page0` is the first reading,
   * every group's, rule 9's included, for a refusal's `stale-skills` check.
   */
  private recommend(w: RunnerFacts, limit: number, out?: { page0?: Candidate[] }, all = false): Recommendation[] {
    const groups = new Map<string, { rows: (Candidate & { item: ItemFacts })[]; done: boolean; passed: [number, number]; cut: boolean }>();
    // B-127 (fail closed, unpenalised): no ticket of a repository whose required control has no
    // signed version is recommended — see unsignedControlBlocked.
    const unsignedBlocked = this.unsignedControlBlocked();
    const full = this.expediteActive() >= EXPEDITE_BOUND;
    const lazy = !this.reference;
    for (let page = 0; all || page < 4; page++) {
      const wanted = page === 0 ? null : [...groups].filter(([, g]) => !g.done && (all
        ? !lazy || g.passed[0] < limit
        : !g.cut && g.rows.length < limit)).map(([k]) => k);
      if (wanted && !wanted.length) break;
      let read: Candidate[];
      if (page === 0 && lazy) {
        const all = this.candidates(w, 0, false);
        if (out) out.page0 = all;
        read = all.filter((r) => r.r9);
      } else {
        // With the lane full, expedited rows are the first sorted run. Once it cannot
        // contribute more to the merged prefix, page only the unexpedited run.
        const skipExpedited = all && full && lazy ? new Set(wanted?.filter((k) => groups.get(k)!.passed[1] >= limit)) : undefined;
        read = this.candidates(w, page, false, wanted, skipExpedited);
      }
      const counts = new Map<string, number>();
      for (const c of read) {
        const key = `${c.repository_id}\u0000${c.course_id}`;
        if (wanted && !wanted.includes(key)) continue;
        if (unsignedBlocked.has(c.repository_id)) continue;
        // R-BTN-4 (B-188): a repository where the runner already holds its bound offers nothing more.
        if (w.held >= this.claimBound(w, c.repository_id)) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const g = groups.get(key) ?? { rows: [], done: false, passed: [0, 0], cut: false };
        groups.set(key, g);
        const run = full && c.expedite ? 1 : 0;
        if (lazy && g.passed[run] >= limit) {
          g.cut = true;
          continue;
        }
        const item = this.item(c.id);
        // R-BTN-76: a leg blocked on a resource — for the fleet, or for this runner by its own
        // instances — is left out after the gate query: advice, never a refusal.
        // R-BTN-79: so is a new ticket of a course whose intake is closed, so its queues drain.
        if (c.r9 && item?.station?.next_leg && this.gate(w, item, item.station.next_leg, 'claim').ok && !this.resourceAdvice(w.id, item.id, item.station.next_leg).length
          && (out || this.canOffer(item.id, w))
          && !this.intakeClosed(item)) {
          g.rows.push({ ...c, item });
          g.passed[run]++;
        }
      }
      for (const [key, g] of groups) if ((counts.get(key) ?? 0) < 50) g.done = true;
    }
    // Rule 2 (advice): past the lane's bound an expedited ticket loses its lane — it sorts as an
    // unexpedited one in the default order — before its group's places are numbered, so R-BTN-61's
    // "firsts before any seconds" reads the order it is actually offered in (round 1, 1-A-2, 1-B-1).
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const merged = [...groups.values()].flatMap((g) => {
      const rows = g.rows.map((r) => ({ ...r, waits: !!r.expedite && full, lane: !!r.expedite && !full }));
      if (full) {
        rows.sort((a, b) => Number(b.lane) - Number(a.lane) || a.to_end - b.to_end
          || (a.item.rank ?? Number.MAX_SAFE_INTEGER) - (b.item.rank ?? Number.MAX_SAFE_INTEGER) || (a.ready_since ?? 0) - (b.ready_since ?? 0) || byId(a, b));
      }
      return rows.map((r, place) => ({ ...r, place }));
    });
    merged.sort((a, b) => Number(b.lane) - Number(a.lane) || b.weight - a.weight || a.place - b.place
      || a.to_end - b.to_end || (a.ready_since ?? 0) - (b.ready_since ?? 0) || byId(a, b));
    return merged.slice(0, limit).map((r) => ({
      ticket_id: r.id,
      station: r.item.station!.station,
      legs: [r.item.station!.next_leg!],
      course: { id: r.item.course, data: opaque(r.item.courseFields) },
      reasons: [...(r.lane ? ['expedite lane'] : []), `${r.to_end} leg${r.to_end === 1 ? '' : 's'} to an end`, `rank ${r.item.rank ?? '—'} in ${r.repository_id}`],
      flags: r.waits ? ['expedite-bound'] : [],
      handoff_url: r.item.station!.handoff_url,
      ...(r.item.last_written_by ? { last_written_by: r.item.last_written_by } : {}),
      ...(r.item.brief ? { brief: r.item.brief } : {}),
    }));
  }

  /** B-127 (fail closed, unpenalised — review round 1): the repositories that require signed
   *  control while the standing record names no owner-signed version for one of the groups (or
   *  carries none, or names a group this Baton does not know). No claim on their tickets is
   *  handed out until an owner signs the current state once: the pre-ceremony window is the
   *  owner's to close, not a `cannot-finish:spec` the ticket pays an attempt and a non-retryable
   *  hold for. The `unsigned-control` notice under Needs you names what to sign; the runner-side
   *  verification remains as the last line (a record that lies about a signature still ends its
   *  claim closed). */
  private unsignedControlBlocked(): Set<string> {
    if (this.cache) return (this.cache.unsigned ??= this.readUnsignedControlBlocked());
    return this.readUnsignedControlBlocked();
  }
  private readUnsignedControlBlocked(): Set<string> {
    const out = new Set<string>();
    for (const r of this.rows<{ id: string; control_json: string | null }>(
      `SELECT r.id AS id, sc.control_json AS control_json FROM repositories r
       LEFT JOIN signed_control sc ON sc.repository_id = r.id
       WHERE r.require_signed_control = 1 AND r.retired_at IS NULL`)) {
      let groups: Record<string, { read?: unknown }> | null = null;
      try {
        groups = r.control_json ? (JSON.parse(r.control_json) as { groups: Record<string, { read?: unknown }> }).groups : null;
      } catch {
        groups = null;
      }
      if (!groups || ['agent_command', 'overrides', 'rank', 'course'].some((g) => {
        const read = groups![g]?.read;
        return typeof read !== 'string' || read === '';
      })) out.add(r.id);
    }
    return out;
  }

  /** R-BTN-79: whether `item` is a new ticket — at its course's start with an empty path — of a
   *  course whose intake is closed, and not expedited (R-BTN-12: the owner's say still counts). */
  private intakeClosed(item: ItemFacts): boolean {
    if (item.expedite || !item.station || item.station.path.length) return false;
    if (this.c.stations.graph(item.repository, item.course)?.start !== item.station.station) return false;
    return this.memo(this.cache?.intake, `${item.repository}\u0000${item.course}`, () => this.c.intake(item.repository, item.course)) === 'closed';
  }

  /** The refusal a failed gate becomes (§11): `barred-tag`, `stale-skills`, `backing-off` and
   *  `capacity-full` have codes of their own; every other gate is `not-eligible` naming the rule
   *  — `chain` and `isolation` by name (R-BTN-106, R-BTN-107). A rule-11 refusal names the
   *  capability and the holders the caller's key may see (R-BTN-178, R-BTN-99). */
  private refusal(ticketId: string, v: Exclude<GateVerdict, { ok: true }>, phase: Phase, w?: RunnerFacts, except: number | null = null): BatonError {
    const code = v.code === 'blocked' ? 'blocked' : v.rule === 8 ? 'barred-tag' : v.rule === 9 ? 'stale-skills' : v.rule === 10 ? 'backing-off' : v.rule === 11 ? 'capacity-full' : 'not-eligible';
    if (v.rule === 11 && v.capability) {
      const holders = this.seatHolders(v.capability, except, w);
      return new BatonError(code, `${ticketId}: ${v.capability}'s seats are full at ${phase === 'claim' ? 'a claim' : 'an advance'}${holders.length ? ` (held by ${holders.join(', ')})` : ''}`,
        { rule: v.rule, rule_code: v.code, capability: v.capability });
    }
    return new BatonError(code, `${ticketId}: ${v.code} at ${phase === 'claim' ? 'a claim' : 'an advance'}`, { rule: v.rule, rule_code: v.code });
  }

  /** R-BTN-47 (B-173): a ticket of a repository not registered — retired, or never there — is
   *  `not-found`, outside every rule that reads registered repositories, before any other
   *  refusal a claim could meet (a ticket of it never reaches the cutover gate). */
  private refuseUnregisteredTicket(ticketId: string): void {
    if (!this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NULL', repositoryOf(ticketId)).length) {
      throw new BatonError('not-found', `${repositoryOf(ticketId)} is not registered`);
    }
  }

  private decideNamed(w: RunnerFacts, wanted: string, requested?: string): { item: ItemFacts; advice: Record<string, unknown> | null } {
    if (w.grants && !w.grants[repositoryOf(wanted)]) {
      throw new BatonError('not-eligible', `${wanted}: no grant`, { rule: 7, rule_code: GATE_CODES[7] });
    }
    this.refuseUnregisteredTicket(wanted);
    if (!this.cutOver(wanted)) throw new BatonError('not-cut-over', `${repositoryOf(wanted)}'s claims go through git until its cutover (R-BTN-28)`);
    this.refuseFull(w, repositoryOf(wanted));
    // §12.8 (B-145, R-BTN-189): a ticket that reaches a repository whose floored guarantee is
    // broken is not claimable — rule `floor`, `floor-broken`.
    this.refuseStopped(wanted, w);
    // B-127 (fail closed, unpenalised): the pre-ceremony window — the repository requires
    // signed control and a group has no owner-signed version — hands out no claim; the notice
    // under Needs you names what an owner signs once.
    if (this.unsignedControlBlocked().has(repositoryOf(wanted))) {
      throw new BatonError('not-eligible', `${wanted}: ${repositoryOf(wanted)} requires owner-signed control and a control input has no owner-signed version yet — an owner signs the current state once (B-127)`, { rule: 'unsigned-control' });
    }
    const item = this.item(wanted);
    if (!item || !item.station?.next_leg) throw new BatonError('not-eligible', `${wanted} has no leg to claim`, { rule: 1, rule_code: GATE_CODES[1] });
    const leg = requested ?? item.station.next_leg;
    if (leg !== item.station.next_leg) throw new BatonError('not-eligible', `${wanted}: ${leg} is not queued`, { rule: 'not-queued' });
    const v = this.gate(w, item, leg, 'claim');
    if (!v.ok) throw this.refusal(wanted, v, 'claim', w);
    // R-BTN-45: advice never refuses; a claim against it is accepted and recorded.
    const resources = this.resourceAdvice(w.id, item.id, item.station.next_leg);
    const overridden = [
      ...(item.expedite && this.expediteActive() >= EXPEDITE_BOUND ? [{ advice: 'expedite-bound', bound: EXPEDITE_BOUND }] : []),
      ...(resources.length ? [{ advice: 'resource', leg: item.station.next_leg, resources }] : []),
      ...(this.intakeClosed(item) ? [{ advice: 'intake', course: item.course }] : []),
    ];
    return { item, advice: overridden.length ? { overridden } : null };
  }

  private canOffer(ticket: string, runner?: RunnerFacts): boolean {
    try { this.refuseStopped(ticket, runner); return true; }
    catch (error) { if (!(error instanceof BatonError)) throw error; return false; }
  }

  /** A named or preferred ticket goes through the same gate as the default offer. */
  private decide(w: RunnerFacts, wanted: string | null, prefer: ClaimPreference[] | null = null): { item: ItemFacts; advice: Record<string, unknown> | null } {
    if (prefer) {
      for (const { ticket_id } of prefer) {
        if ((!w.grants || w.grants[repositoryOf(ticket_id)]) && !this.item(ticket_id)) {
          throw new BatonError('invalid-params', `prefer: ${ticket_id} is not a known ticket`);
        }
      }
      const refusals = [];
      for (const { ticket_id, leg } of prefer) {
        try { return this.decideNamed(w, ticket_id, leg); }
        catch (error) {
          if (!(error instanceof BatonError)) throw error;
          const { rule } = error.extra;
          refusals.push({ ticket_id, code: error.code, ...(rule == null ? {} : { rule }) });
        }
      }
      throw new BatonError('no-eligible-ticket', 'none of the preferred tickets can be claimed', { refusals });
    }
    if (wanted) return this.decideNamed(w, wanted);
    const read: { page0?: Candidate[] } = {};
    const recs = this.recommend(w, 50, read);
    // §12.8 (B-145): a recommended ticket is offered only where the floor rule lets it be — the
    // first one that is not on a stopped repository.
    const first = recs.find((r) => this.canOffer(r.ticket_id, w))
      ?? recs[0];
    if (first) {
      this.refuseStopped(first.ticket_id, w);
      return { item: this.item(first.ticket_id)!, advice: { recommendation: first } };
    }
    // Rule 9 is per course: say `stale-skills` when it alone stood between this runner and a
    // ticket, so the runner knows to restart from a pulled checkout (R-BTN-22). Only tickets of
    // courses the runner declares count; a runner declaring no course is stale on every course.
    // B-237: the recommendation's own first reading, not a second query — only its rule-9
    // groups can refuse by rule 9 (the gate's rule 9 reads what the query's does).
    const page0 = this.reference ? this.candidates(w, 0, false) : (read.page0 ?? []).filter((c) => !c.r9);
    if (page0.some((c) => {
      const item = this.item(c.id);
      return !!item?.station?.next_leg && (!w.courses.length || w.courses.some((k) => k.repository === item.repository && k.course === item.course))
        && (this.gate(w, item, item.station.next_leg, 'claim') as { code?: string }).code === GATE_CODES[9];
    })) {
      throw new BatonError('stale-skills', 'this runner does not declare the ready tickets’ courses at their min_runner_version — it declares an older version or none (R-BTN-22, R-BTN-65)', { rule: 9 });
    }
    // R-BTN-4 (B-188): when every repository the runner serves is at its bound, say so — the
    // runner has no room, which is not the same as nothing to do.
    const served = [...new Set(w.courses.map((k) => k.repository))];
    const full = served.filter((r) => w.held >= this.claimBound(w, r));
    if (w.held > 0 && served.length && full.length === served.length) this.refuseFull(w, full[0]);
    throw new BatonError('no-eligible-ticket', 'no ready ticket fits this runner');
  }

  /** R-BTN-76: the resources that make `leg` of the ticket advice against, for this runner: the
   *  fleet's stored `resource` rows on it, and those its own usable instances are all down for. */
  private resourceAdvice(runnerId: number, ticketId: string, leg: string): string[] {
    if (!this.rows('SELECT 1 FROM leg_needs WHERE ticket_id = ? AND leg = ? LIMIT 1', ticketId, leg).length) return [];
    const fleet = this.rows<{ ref: string }>(`SELECT ref FROM ticket_blocks WHERE ticket_id = ? AND kind = 'resource' AND leg = ?`, ticketId, leg).map((r) => r.ref);
    const mine = this.c.blocks.forRunner(runnerId, ticketId).blocks.filter((b) => b.kind === 'resource' && b.leg === leg).map((b) => b.ref);
    return [...new Set([...fleet, ...mine])].sort();
  }

  /** R-BTN-77: whether `runnerId` would pass the claim gates for the ticket's queued leg now — who
   *  an `unblocked` message goes to. */
  fits(runnerId: number, ticketId: string): boolean {
    const item = this.item(ticketId);
    if (!item?.station?.next_leg) return false;
    return this.gate(this.runner(runnerId), item, item.station.next_leg, 'claim').ok;
  }

  /** B-194 (§6.6, §11.4): for each ticket, which of `runnerIds` would pass the claim gates for
   *  its queued leg now — `fits`, over a page of tickets and the live runners at once, the
   *  per-request reads shared — and, where none would, the code of the rule that refused the
   *  runner that came closest (the gates' own order; `no-runner` with no runner to ask). A
   *  read: it decides nothing and writes nothing. */
  eligibility(ticketIds: readonly string[], runnerIds: readonly number[]): Map<string, { eligible: number[]; failed_rule: string | null }> {
    const order = ['not-ready', 'claimed', 'not-granted', 'missing-capability', 'above-tier-ceiling', 'barred-tag', 'chain', 'isolation', 'stale-skills', 'backing-off', 'capacity-full'];
    return this.cached(() => {
      const runners = runnerIds.map((id) => this.runner(id));
      const out = new Map<string, { eligible: number[]; failed_rule: string | null }>();
      for (const id of ticketIds) {
        const item = this.item(id);
        const leg = item?.station?.next_leg ?? null;
        const eligible: number[] = [];
        let failed: string | null = runners.length && item && leg ? null : item && leg ? 'no-runner' : 'not-ready';
        let reach = -1;
        if (item && leg) for (const w of runners) {
          const v = this.gate(w, item, leg, 'claim');
          if (v.ok) eligible.push(w.id);
          else if (order.indexOf(v.code) >= reach) {
            reach = order.indexOf(v.code);
            failed = v.code;
          }
        }
        out.set(id, { eligible, failed_rule: eligible.length ? null : failed });
      }
      return out;
    });
  }

  // ── the runner calls (§11) ──────────────────────────────────────────────────────────────

  viewScope(key: string): ViewScope {
    const credential = this.rows<{ created_by: string | null }>('SELECT created_by FROM credentials WHERE id = ?', key)[0];
    const grants = this.grantsOf(key, credential?.created_by ?? null);
    const repositories = this.rows<{ id: string }>('SELECT id FROM repositories WHERE retired_at IS NULL ORDER BY id')
      .map((r) => r.id).filter((id) => grants == null || Object.hasOwn(grants, id));
    return { key, repositories, grants: repositories.map((id) => [id, grants?.[id]]) };
  }

  fleetView(repo: string, scope: ViewScope, queues: Parameters<typeof fleetSummary>[2] = []) {
    requireFleetScope(repo, scope);
    const now = this.c.now();
    const reports = this.rows<{ runner_id: number; claim_id: number; key: string; received_at: number; payload: string }>(`
      SELECT rr.runner_id, rr.claim_id, rr.key, rr.received_at, rr.payload FROM ${REPORTS_FROM}
      WHERE rr.repository_id = ? AND ((${REPORT_AGE_FROM}) IS NULL OR (${REPORT_AGE_FROM}) > ?)
      ORDER BY rr.runner_id, rr.claim_id, rr.key`,
      repo, now - REPORT_HORIZON_MS).map((r) => ({ ...r, payload: opaque(r.payload) }));
    const byClaim = groupBy(reports, 'claim_id');
    const claims = this.rows<{ claim_id: number; ticket_id: string; station: string; leg: string | null; claimed_at: number; course_id: string; course_fields_json: string | null; course_advance_json: string | null; runner_id: number; hostname: string; profile_json: string | null }>(`
      SELECT c.id AS claim_id, c.ticket_id, c.station, coalesce(c.leg, c.offered_leg) AS leg, c.claimed_at, c.course_id,
        t.course_fields_json, c.course_advance_json, c.runner_id, w.hostname, w.profile_json
      FROM claims c JOIN runners w ON w.id = c.runner_id LEFT JOIN tickets t ON t.id = c.ticket_id
      WHERE c.status = 'active' AND c.ticket_id >= ? || ':' AND c.ticket_id < ? || ';' ORDER BY c.id`, repo, repo)
      .map(({ runner_id, hostname, profile_json, course_fields_json, course_advance_json, ...claim }) => {
        const runner = this.runner(runner_id);
        const grant = runner.grants?.[repo];
        const allowed = new Set(grant?.capabilities);
        const capabilities = [...capabilitiesOf(runner.declared)].filter((c) => runner.grants == null || (grant &&
          (c.startsWith('runner:') || allowed.has(c) || allowed.has(`${c.split(':')[0]}:*`)))).sort();
        return { ...claim, course: opaque(course_fields_json), advance_course: opaque(course_advance_json),
          runner: { hostname, tags: runner.tags, profile: opaque(profile_json), capabilities }, reports: byClaim.get(claim.claim_id) ?? [] };
      });
    const active = new Set(claims.map((c) => c.claim_id));
    const board = fleetSummary(this.c.store, repo, queues);
    const courses = this.rows<{ id: string }>('SELECT id FROM courses WHERE repository_id = ? ORDER BY id', repo);
    return {
      repository: repo, claims, reports: reports.filter((r) => !active.has(r.claim_id)),
      board: { ...board, intake: Object.fromEntries(courses.map(({ id }) => [id, this.c.intake(repo, id)])) },
      bars: this.c.admin.bars([repo], now, true).map((b) => ({ ...b, active: b.starts_at <= now })),
      course_data: opaque(this.rows<{ course_data: string }>('SELECT course_data FROM board_head WHERE repository_id = ?', repo)[0]?.course_data) ?? {},
    };
  }

  instanceView(scope: ViewScope, resources: Pick<Resources, 'view' | 'readings'>) {
    return instanceView(this.c.store, resources, this.c.now(), scope);
  }

  launchCandidates(scope: ViewScope) {
    if (this.frozenAt() != null) return { repositories: scope.repositories.map((repository) => ({ repository, candidates: [] })) };
    return this.cached(() => {
      const unsigned = this.unsignedControlBlocked();
      const full = this.expediteActive() >= EXPEDITE_BOUND;
      const rows = this.rows<{ ticket_id: string; repository_id: string; leg: string }>(`
        SELECT q.ticket_id, q.repository_id, q.leg FROM ready_tickets q JOIN repositories r ON r.id = q.repository_id
        JOIN board_head h ON h.repository_id = q.repository_id
        WHERE q.repository_id IN (SELECT value FROM json_each(?)) AND r.cutover_at IS NOT NULL AND r.retired_at IS NULL
          AND q.last_end_observation < h.observation AND (q.retry_after IS NULL OR q.retry_after <= ?)
        ORDER BY q.repository_id, CASE WHEN ? THEN 0 ELSE q.expedite END DESC, q.to_end,
          q.rank IS NULL, q.rank, q.ready_since, q.ticket_id`, JSON.stringify(scope.repositories), this.c.now(), full ? 1 : 0);
      const byRepo = groupBy(rows, 'repository_id');
      return { repositories: scope.repositories.map((repository) => ({ repository, candidates: unsigned.has(repository) ? []
        : (byRepo.get(repository) ?? []).flatMap(({ ticket_id, leg }) => {
          const item = this.item(ticket_id);
          if (!item?.station || !this.canOffer(ticket_id) || !this.gate(null, item, leg, 'claim').ok) return [];
          return [{ ticket_id, station: item.station.station, legs: [leg], course: { id: item.course, data: opaque(item.courseFields) },
            flags: item.expedite && full ? ['expedite-bound'] : [], handoff_url: item.station.handoff_url }];
        }) })) };
    });
  }

  /** `GET /v1/runner/recommendations` (R-BTN-45): the sorted legs this runner may take, without
   *  claiming; `?limit=` applies after the merge (R-BTN-61). */
  recommendations(runnerId: number, limit = 10, all = false) {
    if (all) {
      const entries = this.cached(() => this.recommend(this.runner(runnerId), 501, undefined, true));
      return { recommendations: entries.slice(0, 500), truncated: entries.length > 500 };
    }
    if (limit >= 1 && this.idleHit(runnerId)) return { recommendations: [] };
    const version = schedulingVersion(this.c.store);
    const recommendations = this.cached(() => this.recommend(this.runner(runnerId), limit));
    if (limit >= 1 && !recommendations.length) this.idleNote(runnerId, version, null);
    return { recommendations };
  }

  // ── the idle memo (B-237, R-BTN-196) ───────────────────────────────────────────────────

  /** The runner's memoised "nothing eligible", while it still holds: the scheduling version is the
   *  one it was read at — no scheduling input changed, the runner's own heartbeat settings included — and no
   *  clock deadline it noted has come. */
  private idleHit(runnerId: number): IdleMemo | null {
    if (this.reference) return null;
    const m = this.idle.get(runnerId);
    if (!m) return null;
    if (m.until > this.c.now() && m.version === schedulingVersion(this.c.store)) return m;
    this.idle.delete(runnerId);
    return null;
  }

  /** Note that nothing was eligible for the runner at `version`, until the earliest instant the
   *  clock alone could change that (`nextEligibleChange`), at most IDLE_MEMO_MS away. */
  private idleNote(runnerId: number, version: number, refusal: BatonError | null): void {
    if (this.reference || version === 0) return;
    const now = this.c.now();
    const prior = this.idle.get(runnerId);
    if (this.idle.size >= 4096) this.idle.clear();
    this.idle.set(runnerId, {
      version, until: Math.min(now + IDLE_MEMO_MS, this.nextEligibleChange(now) ?? Number.POSITIVE_INFINITY),
      refusal: refusal ?? (prior && prior.version === version ? prior.refusal : null),
    });
  }

  /** The clock-dependent inputs of the candidate query and `gatesFor` (B-237): the earliest
   *  future instant one of them flips — a backoff's `retry_after` lapsing (rule 10), an owner bar
   *  starting or ending (R-BTN-67), an instance's `until` (R-BTN-76). Everything else they read
   *  is stored state, and a stored scheduling change moves its version: a lease lapsing, a claim's
   *  deadline, a reap, a stalled wait and a lapsed protection report all change a row by the
   *  alarm first (the gates read a claim's status, never its runner's liveness). */
  private nextEligibleChange(now: number): number | null {
    return this.rows<{ t: number | null }>(
      `SELECT MIN(t) AS t FROM (
         SELECT MIN(retry_after) AS t FROM ticket_overrides WHERE retry_after > ?
         UNION ALL SELECT MIN(starts_at) FROM owner_bars WHERE lifted_at IS NULL AND starts_at > ?
         UNION ALL SELECT MIN(ends_at) FROM owner_bars WHERE lifted_at IS NULL AND ends_at > ?
         UNION ALL SELECT MIN(until) FROM instance_states WHERE until > ?)`, now, now, now, now)[0]?.t ?? null;
  }

  /** `decide` with the per-request reads cached, and a claim with no ticket named that finds
   *  nothing noted as idle (B-237). */
  private decideNoting(w: RunnerFacts, wanted: string | null, version: number, prefer: ClaimPreference[] | null = null): { item: ItemFacts; advice: Record<string, unknown> | null } {
    try {
      return this.cached(() => this.decide(w, wanted, prefer));
    } catch (e) {
      if (!wanted && !prefer && e instanceof BatonError && (e.code === 'no-eligible-ticket' || e.code === 'stale-skills')) this.idleNote(w.id, version, e);
      throw e;
    }
  }

  /** `GET /v1/runner/next`: the first recommendation, or `no-eligible-ticket`. */
  next(runnerId: number) {
    const idle = this.idleHit(runnerId);
    if (idle?.refusal) throw idle.refusal;
    const version = schedulingVersion(this.c.store);
    const { item, advice } = this.decideNoting(this.runner(runnerId), null, version);
    const r = (advice?.recommendation ?? null) as Recommendation | null;
    return { ...(r ?? { ticket_id: item.id }), rank_reason: r?.reasons.join(' · ') ?? '' };
  }

  /** `POST /v1/runner/claim` (§6.2): idempotent by `request_id`; the lock is the index. The claim
   *  is at the ticket's posted station, running nothing, its path recorded (R-BTN-63). */
  // @model claim sha256:f16b703785eb
  claim(runnerId: number, body: unknown) {
    const b = checkClaim(body);
    // R-BTN-47 (B-173): a wanted ticket of a repository not registered — retired, or never
    // there — is not-found before the cutover gate, which reads the live repositories alone.
    if (b.ticket_id) this.refuseUnregisteredTicket(b.ticket_id);
    for (const field of b.retired) this.c.deprecated.note(this.c.now(), `runner:${runnerId}`, `claim.${field}`, 'claim');
    // R-BTN-88 (§4.8): a frozen Baton refuses new claims — lease upkeep (heartbeats, advances,
    // ends) runs on, so held work drains before the seal.
    if (this.frozenAt() != null) throw new BatonError('frozen', 'this Baton is frozen for a move: new claims are refused until it is unfrozen or sealed (R-BTN-88)');
    if (!this.anyCutOver()) throw new BatonError('not-cut-over', 'claims go through git until cutover (R-BTN-28)');
    const prior = this.rows<{ id: number; runner_id: number }>('SELECT id, runner_id FROM claims WHERE request_id = ?', b.request_id)[0];
    if (prior) {
      // A lost response retried: the same claim, never a second ticket (G-BTN-2).
      if (prior.runner_id !== runnerId) throw new BatonError('invalid-params', 'request_id: already used by another runner');
      return this.claimResponse(prior.id);
    }
    const now = this.c.now();
    // R-BTN-4 (B-188): up to the runner's bound — its `concurrency` here, each repository's grant
    // in `decide` — never one claim per runner.
    this.refuseFull(this.runner(runnerId), null);
    // B-237 (R-BTN-196): an idle runner asking again with nothing changed gets the same refusal.
    const idle = b.ticket_id || b.prefer ? null : this.idleHit(runnerId);
    if (idle?.refusal) throw idle.refusal;
    const version = schedulingVersion(this.c.store);
    const w = this.runner(runnerId);
    const { item, advice } = this.decideNoting(w, b.ticket_id, version, b.prefer);
    const rationale = b.rationale === null ? undefined : JSON.parse(b.rationale) as unknown;
    const savedAdvice = rationale === undefined ? advice : { ...advice, rationale };
    const st = item.station!;
    try {
      // R-BTN-62: the counter's last handed-out number now; only a reading numbered above it can
      // make this claim stale.
      // §2d's course record: how long the offered leg had been ready (R3-1248, 2-r2-2).
      const readySince = st.next_leg == null ? null
        : this.rows<{ ready_since: number | null }>(`SELECT ready_since FROM ticket_next_legs WHERE ticket_id = ? AND leg = ? AND state = 'ready'`, item.id, st.next_leg)[0]?.ready_since ?? null;
      this.exec(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, claim_observation,
                   station, course_id, start_path, offered_leg, advice_json, offered_ready_since)
                 VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
        item.id, runnerId, b.request_id, randomHex(3), this.headOf(item.repository) ?? '', now, this.handedOut(item.repository),
        st.station, item.course, JSON.stringify(st.path), st.next_leg, savedAdvice ? JSON.stringify(savedAdvice) : null, readySince);
    } catch (e) {
      // R-BTN-4: the partial unique indexes refuse a second holder of the ticket or the runner.
      if (isUniqueViolation(e)) throw new BatonError('not-eligible', `${item.id} is already held`, { rule: 3, rule_code: GATE_CODES[3] });
      throw e;
    }
    const id = this.rows<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id;
    this.event('claimed', `runner:${runnerId}`, { request_id: b.request_id, station: st.station, leg: st.next_leg }, item.id, id);
    if (b.rationale !== null) this.c.history.record(item.id, { kind: 'claimed', claim_id: id, runner_id: runnerId, leg: st.next_leg, rationale_json: b.rationale });
    // R-BTN-178: the claim's seats, for the leg it is for — the set as rule 4 matched it here,
    // rewritten at each advance that starts a leg.
    this.writeSeats(id, item, st.next_leg);
    this.c.blocks.held(item.id, true); // a claimed ticket is not waiting (R-BTN-77: silently)
    if (advice?.overridden) this.event('advice-overridden', `runner:${runnerId}`, { overridden: advice.overridden }, item.id, id);
    this.c.dispatch('mirror', item.id);
    this.c.dispatch('sync', item.id); // R-BTN-73: after every claim
    // §6.8: transcripts reported while the runner held nothing are linked to this claim — those
    // in its repository's transcript repositories (R-BTN-66); the rest are dropped.
    const allowed = transcriptReposOf(this.c.store, item.repository);
    this.exec(`INSERT INTO transcripts (runner_id, claim_id, repo, path, role, activity_id, first_seen_at, last_pushed_at)
               SELECT runner_id, ?, repo, path, role, activity_id, first_seen_at, last_pushed_at FROM pending_transcripts
               WHERE runner_id = ? AND repo IN (SELECT value FROM json_each(?))
               ON CONFLICT (runner_id, repo, path, claim_id) DO NOTHING`, id, runnerId, JSON.stringify(allowed));
    this.exec('DELETE FROM pending_transcripts WHERE runner_id = ?', runnerId);
    return this.claimResponse(id);
  }

  /** The latest snapshot's legs leaving a station, as the holder sees them (R-BTN-70): only when
   *  the snapshot has the ticket there — git may be behind or ahead of the holder. */
  private nextLegs(ticketId: string, station: string) {
    const s = this.rows<{ station: string }>('SELECT station FROM ticket_stations WHERE ticket_id = ?', ticketId)[0];
    if (!s || s.station !== station) return [];
    return this.rows<{ leg: string; state: string; waiting_on: string | null }>(
      'SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', ticketId).map((n) => (n.waiting_on ? n : { leg: n.leg, state: n.state }));
  }

  /** The claim response (§11, R-BTN-34): where the ticket starts or resumes, its course and that
   *  course's version as the registry holds it (B-103, §11's claim answer — the runner serves every course its
   *  home declares and needs this to load the claim's one), its queued leg, the latest snapshot's
   *  next legs, its hand-off document, its path and the snapshot the claim was decided on — never
   *  its content — and the earlier attempts, newest first, each with its resume record and the legs
   *  it ran (§6.11, R-BTN-24). B-127 adds two readings beside them: the ticket's brief mark, and —
   *  while the repository requires signed control — the record of what counts, with the owner
   *  keys a runner verifies the named commits against itself. */
  private claimResponse(id: number) {
    const c = this.rows<{ id: number; ticket_id: string; nonce: string; snapshot_sha: string; station: string; offered_leg: string | null; course_id: string | null }>(
      'SELECT id, ticket_id, nonce, snapshot_sha, station, offered_leg, course_id FROM claims WHERE id = ?', id)[0];
    // R-BTN-81's reading of the same two facts (`legFacts`): the course in force for the claim's
    // repository, at the version the registry holds for it.
    const courseVersion = c.course_id
      ? this.rows<{ version: number }>('SELECT version FROM courses WHERE repository_id = ? AND id = ?', repositoryOf(c.ticket_id), c.course_id)[0]?.version ?? null
      : null;
    const ticketRow = this.rows<{ path: string; version: string; key: string | null; last_written_by: string | null }>('SELECT path, version, key, last_written_by FROM tickets WHERE id = ?', c.ticket_id)[0] ?? null;
    const path = ticketRow?.path ?? null;
    // B-183 (§4.5): the ticket's opaque `version` as the board holds it, and how its source
    // reads — pinned (at a version) or current (as it is now) — so the runner re-verifies the
    // claim by the source's own way of reading before any leg runs (R-BTN-5, R-BTN-34). A board
    // that declared no source, or a ticket with no version, is re-verified as before.
    const source = this.rows<{ source_kind: string | null; source_versions: string | null }>(
      'SELECT source_kind, source_versions FROM board_head WHERE repository_id = ?', repositoryOf(c.ticket_id))[0];
    // R-BTN-34's default branch (§11's claim answer lists it): the branch a marker leg's line is
    // committed on, whatever branch the runner's checkout was left on (B-96's review round 3).
    const defaultBranch = this.rows<{ default_branch: string }>('SELECT default_branch FROM repositories WHERE id = ?', repositoryOf(c.ticket_id))[0]?.default_branch ?? null;
    const handoff = this.rows<{ handoff_url: string | null }>('SELECT handoff_url FROM ticket_stations WHERE ticket_id = ?', c.ticket_id)[0]?.handoff_url ?? null;
    const previous = this.rows<{ id: number; status: string; end_reason: string | null; end_detail: string | null; ended_at: number | null; resume_json: string | null }>(
      `SELECT id, status, end_reason, end_detail, ended_at, resume_json FROM claims WHERE ticket_id = ? AND id < ? AND status != 'active' ORDER BY id DESC`, c.ticket_id, id);
    // §12.8 (B-145): where state one leg hands the next lives (R-BTN-188's `leg_state` —
    // B-148 reads it). B-182 (R-BTN-190): a
    // `git` home's claimed ticket on a course that reads PR facts keeps its rounds in its PR's
    // conversation, on whichever forge holds the PR — the course's `facts` (R-BTN-134), as the
    // registry posted it, says whether it reads any.
    const repo = repositoryOf(c.ticket_id);
    const cur = this.c.policies.current(repo);
    const readsPrs = c.course_id != null && (this.rows<{ facts: string }>('SELECT facts FROM courses WHERE repository_id = ? AND id = ?', repo, c.course_id)[0]?.facts ?? '[]').includes('"prs"');
    const legState = cur ? legStateOf(cur.policy, this.c.forgeOf(repo), readsPrs) : null;
    // B-127: the brief's mark (item 7 — marked whether or not signed control is required), and,
    // while the repository requires it, the signed-control record the runners load from and
    // verify. `control.required` is Baton's own setting — never the post's word — and its keys
    // are the repository's owner signing keys, so a runner that trusts the record still checks
    // the signatures against keys the post did not choose.
    const briefRow = this.rows<{ brief: string | null }>('SELECT brief FROM tickets WHERE id = ?', c.ticket_id)[0];
    const brief = briefRow?.brief ? JSON.parse(briefRow.brief) as { signed: boolean; signer?: string; commit: string } : null;
    return {
      claim_id: c.id, ticket_id: c.ticket_id, course_id: c.course_id, course_version: courseVersion,
      ...(legState ? { leg_state: legState } : {}),
      ...(brief ? { brief } : {}),
      station: c.station, legs: c.offered_leg ? [c.offered_leg] : [], next: this.nextLegs(c.ticket_id, c.station),
      // B-134: the ticket's scope — its home and its `repos:` — as lowercased forge paths. The
      // runner audits each leg's pushes against this and reports what falls outside.
      scope: this.c.scope.scopeOf(c.ticket_id),
      ...(handoff ? { handoff_url: handoff } : {}), path, nonce: c.nonce, snapshot_sha: c.snapshot_sha,
      // B-183 (§4.5): the ticket's version and the source's reading of it — `version` is `''`
      // when the source posts none, and `ticket_source` is null when the board declared none.
      version: ticketRow?.version ?? '', ...(source?.source_kind ? { ticket_source: { kind: source.source_kind, versions: source.source_versions } } : {}),
      // B-126 (R-BTN-194): who last changed the ticket's body — beside the brief's mark (B-127),
      // the first thing a privileged session should know of it, before it reads the body.
      ...((w) => (w ? { last_written_by: w } : {}))(writtenBy(ticketRow?.last_written_by)),
      ...(defaultBranch ? { default_branch: defaultBranch } : {}),
      previous_attempts: previous.map((p) => ({
        claim_id: p.id, status: p.status, end_reason: p.end_reason, detail: p.end_detail, ended_at: p.ended_at,
        resume: p.resume_json ? JSON.parse(p.resume_json) : null, legs: this.legsOf(p.id),
      })),
    };
  }

  /** The legs a claim ran, in order (R-BTN-24, R-BTN-63). */
  private legsOf(claimId: number) {
    return this.rows<{ seq: number; leg: string; run_id: string | null; from_station: string; to_station: string | null; finished_at: number | null; abandoned_at: number | null }>(
      'SELECT seq, leg, run_id, from_station, to_station, finished_at, abandoned_at FROM claim_legs WHERE claim_id = ? ORDER BY seq', claimId)
      .map((l) => ({ leg: l.leg, ...(l.run_id ? { run_id: l.run_id } : {}), from: l.from_station, reached: l.to_station, outcome: l.finished_at != null ? 'finished' : l.abandoned_at != null ? 'abandoned' : 'running' }));
  }

  /** B-190 (R-BTN-84, §14's `GET …/legs/{leg}/runs`): one leg's runs of a ticket, oldest first —
   *  each with what replay needs: the claim's snapshot and course version, the head the holder
   *  reported, and the run's recorded inputs (the ticket's version and its read's digest among
   *  them, `leg_run_inputs`). `end` is the claim's end reason once the claim ended. */
  runsOf(ticketId: string, leg: string, sessionLink: SessionLinkView) {
    const runs = this.rows<{ claim_id: number; seq: number; run_id: string | null; head_sha: string | null; from_station: string; started_at: number; finished_at: number | null; abandoned_at: number | null; session_url: string | null; session_incarnation: number | null; snapshot_sha: string; course_id: string | null; status: string; end_reason: string | null; ended_at: number | null; runner_id: number }>(
      `SELECT l.claim_id, l.seq, l.run_id, l.head_sha, l.from_station, l.started_at, l.finished_at, l.abandoned_at, l.session_url, l.session_incarnation,
              c.snapshot_sha, c.course_id, c.status, c.end_reason, c.ended_at, c.runner_id
       FROM claim_legs l JOIN claims c ON c.id = l.claim_id
       WHERE c.ticket_id = ? AND l.leg = ? ORDER BY l.claim_id, l.seq`, ticketId, leg);
    const inputs = this.rows<{ claim_id: number; seq: number; name: string; from_leg: string | null; from_run: number | null; uri: string | null; digest: string | null; value_json: string | null; leg_version: number | null; ticket_version: string | null; read_digest: string | null }>(
      'SELECT claim_id, seq, name, from_leg, from_run, uri, digest, value_json, leg_version, ticket_version, read_digest FROM leg_run_inputs WHERE ticket_id = ? ORDER BY claim_id, seq, name', ticketId);
    const defaultBranch = this.rows<{ default_branch: string }>('SELECT default_branch FROM repositories WHERE id = ?', repositoryOf(ticketId))[0]?.default_branch ?? null;
    const courseVersion = (run: typeof runs[number]): number | null => run.course_id
      ? this.rows<{ version: number }>('SELECT version FROM courses WHERE repository_id = ? AND id = ?', repositoryOf(ticketId), run.course_id)[0]?.version ?? null
      : null;
    return {
      ...(defaultBranch ? { default_branch: defaultBranch } : {}),
      runs: runs.map((r, ordinal) => {
        const mine = inputs.filter((i) => i.claim_id === r.claim_id && i.seq === r.seq);
        const ticket = mine.find((i) => i.name === '');
        return {
          run: ordinal + 1,
          claim: r.claim_id, runner: r.runner_id, seq: r.seq, leg,
          run_id: r.run_id, from: r.from_station, started_at: r.started_at,
          ended_at: r.finished_at ?? r.abandoned_at ?? null,
          end: r.status === 'active' ? null : r.end_reason,
          snapshot_sha: r.snapshot_sha, head_sha: r.head_sha,
          // R-BTN-113 (B-4): the run's session link, as the run list draws it (§11.4).
          ...sessionLink(r.session_url, r.runner_id, r.session_incarnation),
          course: r.course_id, course_version: courseVersion(r),
          ...(ticket?.ticket_version != null || ticket?.read_digest != null
            ? { ticket: { ...(ticket.ticket_version != null ? { version: ticket.ticket_version } : {}), ...(ticket.read_digest != null ? { read_digest: ticket.read_digest } : {}) } }
            : {}),
          inputs: mine.filter((i) => i.name !== '').map((i) => ({
            name: i.name, ...(i.from_leg != null ? { from_leg: i.from_leg } : {}), ...(i.from_run != null ? { from_run: i.from_run } : {}),
            ...(i.uri != null ? { uri: i.uri } : {}), ...(i.digest != null ? { digest: i.digest } : {}),
            ...(i.value_json != null ? { value: JSON.parse(i.value_json) as unknown } : {}), ...(i.leg_version != null ? { leg_version: i.leg_version } : {}),
          })),
        };
      }),
    };
  }

  /** The claim's running leg, if any: its last started leg not yet finished or given up. */
  private runningLeg(claimId: number) {
    return this.rows<{ seq: number; leg: string; from_station: string; run_id: string | null }>(
      'SELECT seq, leg, from_station, run_id FROM claim_legs WHERE claim_id = ? AND finished_at IS NULL AND abandoned_at IS NULL ORDER BY seq DESC LIMIT 1', claimId)[0] ?? null;
  }

  /** B-4 (R-BTN-113): the instance's session-host allowlist, as the runner calls' shared rule
   *  reads it — `instance_settings` where an administrator set one, else the deploy's config,
   *  else the default (claude.ai). */
  private sessionHosts(): string[] {
    return this.c.sessionHosts();
  }

  /** R-BTN-63: the legs a claim's ticket has run as Baton counts them for `max_runs` — the path
   *  it held at the claim (`start_path`) and the runs this claim started (B-335: the advance
   *  reply's `run` reads the same list, so the holder's number and the bound agree). */
  private legsRan(startPath: string, claimId: number): string[] {
    return [...(JSON.parse(startPath) as Step[]).map((s) => s.leg), ...this.rows<{ leg: string }>('SELECT leg FROM claim_legs WHERE claim_id = ?', claimId).map((r) => r.leg)];
  }

  /** R-BTN-81: what a leg row of the history carries — the leg's run number on the ticket (its
   *  runs under any claim, this one included), the claim's snapshot and the course's version. */
  private legFacts(claimId: number, leg: string, runId: string | null = null) {
    const c = this.rows<{ ticket_id: string; runner_id: number; snapshot_sha: string; course_id: string | null }>(
      'SELECT ticket_id, runner_id, snapshot_sha, course_id FROM claims WHERE id = ?', claimId)[0];
    const run = this.rows<{ n: number }>('SELECT COUNT(*) AS n FROM claim_legs l JOIN claims k ON k.id = l.claim_id WHERE k.ticket_id = ? AND l.leg = ?', c.ticket_id, leg)[0].n;
    const version = c.course_id ? this.rows<{ version: number }>('SELECT version FROM courses WHERE repository_id = ? AND id = ?', repositoryOf(c.ticket_id), c.course_id)[0]?.version ?? null : null;
    return { ticket: c.ticket_id, row: { claim_id: claimId, runner_id: c.runner_id, leg, run, run_id: runId, snapshot_sha: c.snapshot_sha, course_version: version } };
  }

  /** An active claim of this runner, for `advance` and `end`. */
  private held(runnerId: number, claimId: number) {
    const c = this.rows<HeldClaim>(
      `SELECT id, runner_id, ticket_id, status, end_reason, station, leg, course_id, start_path, offered_leg, claim_observation, regressed_since
       FROM claims WHERE id = ?`, claimId)[0];
    if (!c && !this.anyCutOver()) throw new BatonError('not-cut-over', 'claims go through git until cutover (R-BTN-28)');
    if (c && !this.cutOver(c.ticket_id)) throw new BatonError('not-cut-over', `${repositoryOf(c.ticket_id)}'s claims go through git until its cutover (R-BTN-28)`);
    if (!c || c.runner_id !== runnerId) throw new BatonError('not-holder', 'this runner does not hold that claim');
    return c;
  }

  /** R-BTN-90: delivery can race with close. Only a pending release can be withdrawn. */
  private refuseDeliveredTimeout(runnerId: number, ticketId: string): void {
    if (this.rows(`SELECT 1 FROM messages WHERE to_runner_id = ? AND kind = 'release' AND status = 'delivered'
                  AND json_extract(payload_json, '$.ticket_id') = ? AND json_extract(payload_json, '$.reason') = 'leg-timeout' LIMIT 1`, runnerId, ticketId).length) {
      throw new BatonError('not-eligible', 'the current run has a delivered leg-timeout release', { rule_code: 'leg-timeout' });
    }
  }

  /**
   * `POST /v1/runner/claims/{id}/advance` (R-BTN-63, §11): the running leg, if any, is finished —
   * the claim is at `reached`, one of its outcomes — and `leg` starts, on the holder's word: Baton
   * checks the edge (the leg leaves that station), the run limit (its runs in `start_path` and this
   * claim's legs, under current names, R-BTN-64) and the gates that bind a holder, never the leg's
   * state. The first advance starts the leg the claim was offered (R-BTN-83). A refusal changes
   * nothing. The answer carries the latest snapshot's next legs and the run's id and number (B-335).
   */
  // @model advance sha256:21709d9401bc
  // @model advanceRun sha256:aad92c654eea
  advance(runnerId: number, claimId: number, body: unknown) {
    const b = checkAdvance(body);
    const c = this.held(runnerId, claimId);
    if (c.status !== 'active') throw new BatonError('claim-ended', `the claim already ended (${c.status}: ${c.end_reason})`);
    this.refuseDeliveredTimeout(runnerId, c.ticket_id);
    // §12.8 (B-145, R-BTN-189): rule `floor` and the pins bind an advance as they bind a claim.
    this.refuseStopped(c.ticket_id, this.runner(runnerId));
    const repo = repositoryOf(c.ticket_id);
    const g = c.course_id ? this.stations.graph(repo, c.course_id) : null;
    const item = this.item(c.ticket_id);
    if (!g || !item) throw new BatonError('not-eligible', `${c.ticket_id} is no longer on the board, or its course is not in force`, { rule: 1, rule_code: 'gone' });
    const offGraph = (why: string) => new BatonError('not-eligible', `off-graph: ${why}`, { rule: 1, rule_code: 'off-graph' });
    const station = resolveStation(g, c.station);
    if (!station) throw offGraph(`the claim's station ${c.station} is no longer in the course file`);
    const leg = resolveLeg(g, b.leg);
    if (!leg) throw offGraph(`${b.leg} is not a leg of the course file`);
    const run = this.runningLeg(claimId);
    let at = station;
    if (run) {
      const running = resolveLeg(g, run.leg);
      const outcomes = running ? g.legs.get(running)!.to : [];
      if (!running) throw offGraph(`the running leg ${run.leg} is no longer in the course file`);
      // §11: `reached` is required while a leg runs — the holder says which outcome it reached.
      if (!b.reached) throw new BatonError('invalid-params', `reached: required while ${running} runs — one of ${outcomes.join(', ')}`);
      const reached = resolveStation(g, b.reached);
      if (!reached || !outcomes.includes(reached)) throw offGraph(`${running} cannot reach ${b.reached}`);
      at = reached;
    } else {
      if (b.reached && resolveStation(g, b.reached) !== station) throw offGraph(`the claim is at ${station}, running nothing`);
      // R-BTN-83: the first leg is the one the claim was offered.
      const started = this.rows('SELECT 1 FROM claim_legs WHERE claim_id = ?', claimId).length > 0;
      if (!started && c.offered_leg && (resolveLeg(g, c.offered_leg) ?? c.offered_leg) !== leg) {
        throw new BatonError('not-eligible', `not-queued: the claim was offered ${c.offered_leg}`, { rule: 1, rule_code: 'not-queued' });
      }
    }
    if (!leaves(g, leg, at)) throw offGraph(`${leg} does not leave ${at}`);
    // R-BTN-153 (B-175): an arrival at a station the owners' conclusions map holds is the check
    // command's verdict or the agent's word — only the command's may be a success. The arrival
    // alone is judged: a finished leg's `reached`, never the station a leg merely leaves (a
    // departure reaches nothing — a claim resting at a success-mapped station must be able to
    // start the leg out of it, round 1, finding 1).
    if (run) this.checkVerdict(repo, c.course_id, at, b.exit_status, false);
    const max = g.legs.get(leg)!.maxRuns;
    if (max != null) {
      const ran = this.legsRan(c.start_path, claimId);
      // B-110 (§6.8): an owner's granted runs of this leg sit beside its `max_runs` for this
      // ticket alone — the override that carried a `round` adjudication answer. The count itself
      // is the traversal record's (R-BTN-63): a grant buys one round, never a reset.
      if (runsOf(g, leg, ran) >= max + this.grantedRuns(c.ticket_id, leg)) throw new BatonError('not-eligible', `max-runs: ${leg} has run ${max} times`, { rule: 1, rule_code: 'max-runs' });
    }
    // R-BTN-67: a leg a required bar covers needs a tag with its prefix among its posted bars and
    // the holder's own; else the advance is refused `policy` and the claim is unchanged.
    const posted = this.rows<{ tag: string }>('SELECT tag FROM ticket_bars WHERE ticket_id = ? AND leg = ?', c.ticket_id, leg).map((r) => r.tag);
    const unmet = this.c.admin.requiredBars(repo).find((r) => requiredBarCovers(r, item.course, leg, g) && !meetsRequiredBar(r, [...posted, ...b.bars]));
    if (unmet) throw new BatonError('not-eligible', `policy: ${leg} must bar a ${unmet.tag_prefix} tag (an owner's required bar)`, { rule: 8, rule_code: 'policy' });
    const advancing = this.runner(runnerId);
    const v = this.gate(advancing, item, leg, 'advance', { except: claimId, holderBars: b.bars });
    if (!v.ok) throw this.refusal(c.ticket_id, v, 'advance', advancing, claimId);
    // R-BTN-109: the finished leg arrives at `at` with what its entry asks; inline values in full.
    if (run) this.checkEntry(repo, g, at, b.outputs);
    else this.checkOutputValues(repo, b.outputs);
    // R-BTN-76: an advance into a leg blocked on a resource is accepted — the holder may know better.
    const resources = this.resourceAdvice(runnerId, c.ticket_id, leg);
    if (resources.length) this.event('advice-overridden', `runner:${runnerId}`, { overridden: [{ advice: 'resource', leg, resources }] }, c.ticket_id, claimId);

    const now = this.c.now();
    const n = this.handedOut(repo);
    // R-BTN-113 (B-4): the advance may carry the session link of the leg it finishes — stored on
    // the finished run's row as a heartbeat's is. One that fails the rule, or one carried by the
    // first advance (which finishes no leg), is dropped and logged, never a refused advance.
    let sessionUrlDropped: string | null = null;
    if (b.session_url != null) {
      const why = run ? sessionLinkWhy(b.session_url, this.sessionHosts()) : 'the advance finishes no leg';
      if (why != null) {
        sessionUrlDropped = why;
        this.event('discrepancy', `runner:${runnerId}`, { sub: 'session-url', why }, c.ticket_id, claimId);
      } else {
        this.exec('UPDATE claim_legs SET session_url = ?, session_incarnation = ? WHERE claim_id = ? AND seq = ?', b.session_url, advancing.incarnation, claimId, run!.seq);
      }
    }
    if (run) {
      this.exec('UPDATE claim_legs SET to_station = ?, finished_at = ?, evidence = ? WHERE claim_id = ? AND seq = ?', at, now, b.evidence, claimId, run.seq);
      // B-234 (R-BTN-195): the finished run's open `interact` closes with it — the ask was for
      // that session, and the run is done.
      if (run.run_id != null) this.c.conditions.runEnded(claimId, run.run_id);
      const f = this.legFacts(claimId, run.leg, run.run_id);
      this.c.history.record(f.ticket, { kind: 'leg-finished', ...f.row, reached: at, next_leg: leg,
        ...(b.evidence ? { detail: { evidence: b.evidence } } : {}) });
      // B-134: the finished leg's scope audit, reported on the advance that finishes it — the
      // actions outside the claim's ticket scope raise their findings (and their hold) here,
      // and the report's dropped count (entries that failed their shape, actions beyond its
      // sixteen) is logged as `scope-invalid`, never a refusal.
      this.c.scope.exceeded(claimId, b.scope_exceeded);
      if (b.scope_exceeded?.dropped) this.event('scope-invalid', `runner:${runnerId}`, { dropped: b.scope_exceeded.dropped, claim: claimId }, c.ticket_id, claimId);
    }
    const seq = (this.rows<{ s: number | null }>('SELECT MAX(seq) AS s FROM claim_legs WHERE claim_id = ?', claimId)[0].s ?? 0) + 1;
    // R-BTN-63 (B-185): the run's id, minted here; a collision with an existing id is refused by
    // the column's unique index and a new one minted.
    let runId = '';
    for (let tries = 0; ; tries++) {
      runId = mintRunId(now, this.c.random);
      try {
        this.exec(`INSERT INTO claim_legs (claim_id, seq, run_id, leg, from_station, bars, started_at, started_observation, head_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          claimId, seq, runId, leg, at, JSON.stringify(b.bars), now, n, b.head_sha);
        break;
      } catch (e) {
        if (!isUniqueViolation(e) || !/run_id/.test(String(e)) || tries >= 8) throw e;
      }
    }
    // B-190 (R-BTN-82, R-BTN-84, §13.5): the run's inputs as the runner reported them at its
    // start — pointers and digests only (R-BTN-33), the ticket's version and its read's digest
    // on the row whose name is empty. Replay reads these rows; a retried advance that reached
    // this far never runs twice (its claim-legs insert above is the transaction's own).
    for (const i of b.run_inputs.inputs) {
      this.exec(`INSERT INTO leg_run_inputs (claim_id, seq, name, ticket_id, from_leg, from_run, uri, digest, value_json, leg_version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        claimId, seq, i.name, c.ticket_id, i.from_leg, i.from_run, i.hasValue ? null : i.uri, i.digest, i.hasValue ? JSON.stringify(i.value) : null, i.leg_version);
    }
    if (b.run_inputs.ticket) {
      this.exec(`INSERT INTO leg_run_inputs (claim_id, seq, name, ticket_id, ticket_version, read_digest) VALUES (?, ?, '', ?, ?, ?)`,
        claimId, seq, c.ticket_id, b.run_inputs.ticket.version, b.run_inputs.ticket.read_digest);
    }
    const started = this.legFacts(claimId, leg, runId);
    this.c.history.record(started.ticket, { kind: 'leg-started', ...started.row, detail: { from: at, ...(b.bars.length ? { bars: b.bars } : {}) } });
    // R-BTN-62: only a reading numbered above the counter now can judge the claim stale.
    // R-BTN-90 (B-234): the advance that starts a run arms the claim's deadline when the leg
    // carries one (`deadline_s`, the file's `max_duration`) and clears it when it does not —
    // the next advance re-arms for its own run, and the claim's end clears it below.
    const deadline = g.legs.get(leg)?.maxDuration ?? null;
    // A pending release for the previous run must not stop the run about to start.
    this.settleDeadlineRelease(runnerId, c.ticket_id, 'advance', now);
    this.exec('UPDATE claims SET station = ?, leg = ?, claim_observation = ?, deadline_at = ?, course_advance_json = ? WHERE id = ?', at, leg, n, deadline != null ? now + deadline * 1000 : null, b.course, claimId);
    // R-BTN-178: the seats of the leg this advance starts, rewritten in its transaction — an
    // advance into a leg not requiring a capability releases that seat.
    this.writeSeats(claimId, item, leg);
    // R-BTN-202 (B-248): an advance finishing a leg that ran under a local order while Baton was
    // unreachable records the order's provenance on its event — the gates above judged it as any
    // other advance; the provenance decides nothing.
    this.event('advanced', `runner:${runnerId}`, { from: station, reached: at, leg, ...(b.bars.length ? { bars: b.bars } : {}), ...(b.evidence ? { evidence: b.evidence } : {}), ...(b.local_order && run ? { local_order: { leg: run.leg, ...b.local_order } } : {}) }, c.ticket_id, claimId);
    this.c.dispatch('sync', c.ticket_id); // R-BTN-73: after every advance
    // R-BTN-90: the answer also names the run's `claim_legs.seq` — the runner's `leg_finished`
    // heartbeat (§7.5's finishing half) carries it when the run's script returns. R-BTN-113: a
    // dropped link says so, as a beat's answer does.
    // B-335 (R-BTN-63): and the run's number — the ticket's runs of the leg, this one included,
    // counted as the max-runs check above counts them, so the holder never recounts.
    return { ok: true, station: at, next: this.nextLegs(c.ticket_id, at), run_id: runId, seq, run: runsOf(g, leg, this.legsRan(c.start_path, claimId)), ...(sessionUrlDropped != null ? { session_url_dropped: sessionUrlDropped } : {}) };
  }

  /** `POST /v1/runner/claims/{id}/end` (§6.5, R-BTN-8, R-BTN-71). A retried identical end is a no-op. */
  // @model endClaim sha256:5fa2311361bd
  end(runnerId: number, claimId: number, body: unknown) {
    const e = checkEnd(body);
    const c = this.held(runnerId, claimId);
    // R-BTN-67: `released:<reason>` of an owner bar's reason — an open set, the repository's bars'.
    if (e.owner_bar && !this.rows('SELECT 1 FROM owner_bars WHERE repository_id = ? AND reason = ?', repositoryOf(c.ticket_id), e.end_reason.slice(9)).length) {
      throw new BatonError('invalid-params', `end_reason: ${e.end_reason} names no owner bar's reason on ${repositoryOf(c.ticket_id)}`);
    }
    // R-BTN-86 (§4.6, R3-1258): a reported child is never the parent's own — validated before
    // any write, with the ticket the claim holds. The rest of the report's shape is checkEnd's.
    if (e.spawned && e.spawned.includes(c.ticket_id.slice(c.ticket_id.indexOf(':') + 1))) {
      throw new BatonError('invalid-params', `spawned: a child is never the parent's own ticket (R-BTN-86)`);
    }
    if (c.status !== 'active') {
      if (c.end_reason === e.end_reason) return { ok: true };
      // R-BTN-8 pushes git first, so a sync can see the ticket closed and release the claim
      // stale-board (R-BTN-35) before the runner's own end arrives: that completion is the
      // truth, recorded as such, and the release it no longer needs is withdrawn.
      if (c.status === 'released' && c.end_reason === 'released:stale-board' && e.status === 'completed' && this.gitEnded(c.ticket_id, c.id)) {
        // R-BTN-153 (B-175, round 1, finding 2): this branch re-completes the holder's end just
        // as the direct path below records it, so a `done` arrival meets the same verdict here —
        // an agent's `done` toward a success-mapped station (or one the map does not name) is
        // refused on this path too, never recorded completed and later confirmed as a green
        // verdict. The station judged is the end's own (the release has already given the running
        // leg up, so the claim's graph state is not the arrival's word); a suspension concludes
        // nothing and is recovered as before.
        if (e.end_reason === 'done') this.checkVerdict(repositoryOf(c.ticket_id), c.course_id, e.reached ?? c.station, e.exit_status, true);
        this.exec(`UPDATE claims SET status = 'completed', end_reason = ?, end_detail = ?, ended_at_sha = ?, end_observation = ? WHERE id = ?`,
          e.end_reason, e.detail, e.ended_at_sha ?? '', this.handedOut(repositoryOf(c.ticket_id)), c.id);
        this.exec(`UPDATE messages SET status = 'expired' WHERE to_runner_id = ? AND kind = 'release' AND status IN ('pending','delivered')
                   AND json_extract(payload_json, '$.ticket_id') = ? AND json_extract(payload_json, '$.reason') = 'stale-board'`, runnerId, c.ticket_id);
        this.event('completed', `runner:${runnerId}`, { end_reason: e.end_reason, ended_at_sha: e.ended_at_sha, after: 'released:stale-board' }, c.ticket_id, c.id);
        this.c.blocks.held(c.ticket_id, true);
        this.confirmByClosure(c.id);
        this.c.dispatch('sync', c.ticket_id);
        return { ok: true };
      }
      throw new BatonError('claim-ended', `the claim already ended (${c.status}: ${c.end_reason})`);
    }
    if (e.end_reason !== 'released:leg-timeout') this.refuseDeliveredTimeout(runnerId, c.ticket_id);
    const { reached, finished } = this.restingAt(c, e);
    // R-BTN-113 (B-4): the end may carry the session link of the leg it finishes — stored on the
    // running run's row as a heartbeat's is; one that fails the rule, or one carried by an end
    // that runs no leg, is dropped and logged, never a refused end.
    let sessionUrlDropped: string | null = null;
    if (e.session_url != null) {
      const running = this.runningLeg(c.id);
      const why = running ? sessionLinkWhy(e.session_url, this.sessionHosts()) : 'the claim runs no leg';
      if (why != null) {
        sessionUrlDropped = why;
        this.event('discrepancy', `runner:${runnerId}`, { sub: 'session-url', why }, c.ticket_id, c.id);
      } else {
        this.exec('UPDATE claim_legs SET session_url = ?, session_incarnation = ? WHERE claim_id = ? AND seq = ?', e.session_url, this.runner(runnerId).incarnation, c.id, running!.seq);
      }
    }
    // R-BTN-109: a completed end that finishes its leg arrives at `reached` and meets its entry. A
    // release is not checked: it is how the runner gives up a leg whose outputs fail (R-BTN-82).
    const g = c.course_id ? this.stations.graph(repositoryOf(c.ticket_id), c.course_id) : null;
    if (e.status === 'completed' && finished && g) this.checkEntry(repositoryOf(c.ticket_id), g, reached, e.outputs);
    else if (e.status === 'completed') this.checkOutputValues(repositoryOf(c.ticket_id), e.outputs);
    // R-BTN-153 (B-175): a `done` end's `reached` is what the owners' conclusions map reads
    // (R-BTN-115), so a success-mapped one is the check command's alone. A suspension rests
    // where the claim already stands and concludes nothing, as a release does (§10) — neither
    // reaches a station, so neither is held to the command's verdict (round 1, finding 1).
    if (e.end_reason === 'done') this.checkVerdict(repositoryOf(c.ticket_id), c.course_id, reached, e.exit_status, true);
    // B-134: the ending claim's leg-end scope audit, likewise — the actions outside the claim's
    // ticket scope raise their findings (and their hold) in this transaction, and the report's
    // dropped count is logged `scope-invalid`, never a refusal.
    this.c.scope.exceeded(c.id, e.scope_exceeded);
    if (e.scope_exceeded?.dropped) this.event('scope-invalid', `runner:${runnerId}`, { dropped: e.scope_exceeded.dropped, claim: c.id }, c.ticket_id, c.id);
    // R-BTN-202 (B-248): an end that finishes a leg worked under a local order records who gave it.
    // R-BTN-126's capability branch: the holding the runner says it lost leaves its declared
    // set, and the fleet's counts follow (R-BTN-75) — rule 4 refuses this runner at once. A
    // valid blocked end is not a failed attempt, not a run for max_runs, and starts no backoff
    // (the blocked-end work's rules). The transaction is the end's own; the delete is its shape.
    if (e.prerequisite?.kind === 'capability') this.exec('DELETE FROM runner_capabilities WHERE runner_id = ? AND capability = ?', runnerId, e.prerequisite.ref);
    // R-BTN-86 (§4.6, R3-1258): the children the ending leg reported — recorded as the run's
    // (the range a call settles over is B-62's to read) until the first accepted snapshot
    // observed after this end, which posts them or drops each unposted one with discrepancy
    // `spawned-unposted` (R-BTN-85). The end's observation is the counter's now, as finish
    // writes it below; the snapshot that judges it carries a strictly greater number.
    if (e.spawned?.length) {
      const repo = repositoryOf(c.ticket_id);
      this.exec(`INSERT INTO spawned_children (repository_id, ticket_id, claim_id, children_json, observation, ended_at) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (repository_id, ticket_id, claim_id) DO UPDATE SET children_json = excluded.children_json, observation = excluded.observation, ended_at = excluded.ended_at`,
        repo, c.ticket_id, c.id, JSON.stringify(e.spawned), this.handedOut(repo), this.c.now());
    }
    // R-BTN-202 (B-248): an end finishing a leg run under a local order records its provenance
    // on the end's event, as an advance does.
    const localOrder = e.local_order && finished ? { leg: this.runningLeg(c.id)?.leg ?? null, ...e.local_order } : null;
    this.finish(c.id, c.ticket_id, e.status, e.end_reason, `runner:${runnerId}`, { ended_at_sha: e.ended_at_sha, detail: e.detail, reached, finished, evidence: e.ended_at_sha, next: e.next, localOrder });
    return { ok: true, ...(sessionUrlDropped != null ? { session_url_dropped: sessionUrlDropped } : {}) };
  }

  /** R-BTN-126 (round 1, B9): the invalid blocked end, recorded in its own committed
   * transaction by the route — the claim ends a failed attempt `released:cannot-finish:transient`,
   * named for what the runner claimed to lose and does not hold. */
  invalidPrerequisiteEnd(runnerId: number, claimId: number, ref: string): void {
    // 2-r2-0: only the runner's ACTIVE claim is ended — a completed or already-ended one
    // answers claim-ended as end() does, never re-finished, so rule 3's unconfirmed hold
    // stands (R-BTN-168).
    const c = this.rows<{ id: number; ticket_id: string }>(`SELECT id, ticket_id FROM claims WHERE id = ? AND runner_id = ? AND status = 'active'`, claimId, runnerId)[0];
    if (!c) throw new BatonError('claim-ended', 'the claim already ended');
    this.refuseDeliveredTimeout(runnerId, c.ticket_id);
    const item = this.item(c.ticket_id);
    this.finish(claimId, c.ticket_id, 'released', 'released:cannot-finish:transient', `runner:${runnerId}`,
      { detail: `invalid-prerequisite: ${ref.slice(0, 100)} is not declared`, reached: item?.station?.station ?? null, finished: false, evidence: null, next: null });
  }

  /**
   * R-BTN-153 (B-175): in a course the owners' `checks` map names, the station an arrival reaches
   * is the check command's verdict or the agent's word — and only the command's may be a success.
   * An advance or completed end arriving at a station the map holds `success` carries the check
   * command's `exit_status: 0` (an agent's `baton-leg-result` or channel `done` carries none, so
   * it reaches only `failure` or `timed_out` stations, and no conclusion passes a required check
   * but a command's green exit). A `0` belongs to the success station alone, and a timeout or an
   * `exec` error — which has no exit status — to `timed_out`, or to `failure` where none is
   * mapped. A `done` end (`done` ends alone queue a conclusion, R-BTN-115) may not rest at a
   * station the map does not name — an agent's done reaches only `failure` or `timed_out`
   * stations, and a station the map does not name is neither (round 1, finding 3). An advance's
   * arrival at an unmapped station is a course's ordinary travel — the map names end stations,
   * not every one a leg passes through — and is not constrained here.
   */
  private checkVerdict(repo: string, courseId: string | null, station: string, exitStatus: number | null, done: boolean): void {
    const conclusions = (courseId ? this.c.admin.checkMap(repo)[courseId] : undefined)?.conclusions;
    if (!conclusions) return;
    const conclusion = conclusions[station];
    if (conclusion === undefined) {
      if (done) throw new BatonError('invalid-params', `exit_status: ${station} is not a station the owners' checks map names, and a done end of a mapped course rests only at one it does — only a failure or timed_out station is the agent's to reach (R-BTN-153)`);
      return;
    }
    if (conclusion === 'success') {
      if (exitStatus !== 0) {
        throw new BatonError('invalid-params', `exit_status: ${station} is mapped success, and only the check command's exit status reaches it — carry exit_status: 0 (R-BTN-153)`);
      }
    } else if (exitStatus === 0) {
      throw new BatonError('invalid-params', `exit_status: 0 reaches the station mapped success, not ${station} (mapped ${conclusion}) (R-BTN-153)`);
    } else if (conclusion === 'timed_out' && exitStatus != null) {
      throw new BatonError('invalid-params', `exit_status: ${exitStatus} is a command's exit, but ${station} is mapped timed_out — a timeout or exec error, which carries no exit status, reaches it (R-BTN-153)`);
    }
  }

  /**
   * R-BTN-109: an arrival at `station` must carry each output its `entry` names — by that name,
   * with the required schema or one refining it (by the repository's posted base chains). Every
   * inline value is validated in full with the shared validator, against its schema and each
   * base (R-BTN-108). An unmet requirement or an invalid value is refused `not-eligible`, rule
   * `entry` — which the runner treats as an output contract failure.
   */
  private checkEntry(repo: string, g: Graph, station: string, outputs: Output[]) {
    const resolve = this.resolver(repo);
    this.checkOutputValues(repo, outputs, resolve);
    for (const r of g.entry.get(station) ?? []) {
      const o = outputs.find((x) => x.name === r.output);
      if (!o) throw new BatonError('not-eligible', `entry: ${station} requires the output ${r.output} (${r.schema})`, { rule: 'entry', rule_code: 'entry' });
      if (!resolve(o.schema) || !baseChain(o.schema, resolve).includes(r.schema)) {
        throw new BatonError('not-eligible', `entry: ${r.output} is ${o.schema}, which is not ${r.schema} or a refinement of it`, { rule: 'entry', rule_code: 'entry' });
      }
    }
  }

  /** One request's schema resolver (3-r3-1): each id read and parsed once, so the validator's
   *  done-once work — enum sets and `const` keys, keyed by the schema object — is done once, and
   *  the reads are bounded by the schemas a chain names, not by the value's size. */
  private resolver(repo: string): (id: string) => Schema | null {
    const seen = new Map<string, Schema | null>();
    return (id) => {
      if (!seen.has(id)) seen.set(id, this.c.schema(repo, id));
      return seen.get(id) ?? null;
    };
  }

  /** R-BTN-108: each inline value, against its schema and every base; a value whose schema chain
   *  does not bound it is given by pointer instead. */
  private checkOutputValues(repo: string, outputs: Output[], resolve = this.resolver(repo)) {
    // One budget for the request: up to 16 outputs share it (baton#69 round 2, 2-r2-0).
    const meter = { steps: PATTERN_STEPS_MAX };
    for (const o of outputs) {
      if (!Object.prototype.hasOwnProperty.call(o, 'value')) continue;
      if (!resolve(o.schema)) throw new BatonError('not-eligible', `entry: ${o.name}'s schema ${o.schema} is not posted or in the std: library`, { rule: 'entry', rule_code: 'output-invalid' });
      const unbounded = unboundedAt(o.schema, resolve);
      if (unbounded) throw new BatonError('invalid-params', `outputs: ${o.name} is given inline, but its schema does not bound it (${unbounded}); give it by pointer`);
      const faults = validate(o.value, o.schema, resolve, meter);
      if (faults.length) {
        throw new BatonError('not-eligible', `entry: ${o.name} fails ${o.schema}: ${faults.slice(0, 3).map((f) => `${f.path || '/'} ${f.message}`).join('; ')}`, { rule: 'entry', rule_code: 'output-invalid' });
      }
    }
  }

  /**
   * R-BTN-71: the station an end rests at — the running leg's outcome it reached, or the leg's
   * `from` if it gave the leg up (the claim's current station); with no leg running, the claim's
   * station. Any other station is refused. With `reached` absent: a suspension names it; a `done`
   * that ran a leg of one outcome reached it; anything else rests where the claim is.
   */
  private restingAt(c: HeldClaim, e: End): { reached: string; finished: boolean } {
    const g = c.course_id ? this.stations.graph(repositoryOf(c.ticket_id), c.course_id) : null;
    const run = this.runningLeg(c.id);
    // A course no longer in force: nothing to check against; a named outcome finishes the leg.
    if (!g) {
      if (e.finished_self_loop) throw new BatonError('invalid-params', 'finished_self_loop: no course in force');
      return { reached: e.reached ?? c.station, finished: !!run && !!e.reached && e.reached !== c.station };
    }
    const station = resolveStation(g, c.station) ?? c.station;
    const outcomes = run ? g.legs.get(resolveLeg(g, run.leg) ?? '')?.to ?? [] : [];
    const allowed = new Set([station, ...outcomes]);
    let reached = station;
    if (e.reached) {
      // A station the course file dropped is still where the claim is: a release — the runner's
      // `course-changed` (R-BTN-64) — may name it (round 2, 2-A-1). A suspension or `done` may not:
      // no path under the new file could ever confirm it (round 3, 3-A-0).
      const r = resolveStation(g, e.reached) ?? (e.status === 'released' ? e.reached : null);
      if (!r || !allowed.has(r)) {
        throw new BatonError('not-eligible', `off-graph: the claim rests at ${[...allowed].join(' or ')}, not ${e.reached}`, { rule: 1, rule_code: 'off-graph' });
      }
      reached = r;
    } else if (e.end_reason === 'done' && outcomes.length === 1) {
      reached = outcomes[0];
    }
    // S-BTN-63: resting at `from` normally gives up the run. A runner suspending after a
    // completed self-loop explicitly reports it with evidence; the graph must allow that loop.
    if (e.finished_self_loop && (reached !== station || !outcomes.includes(reached))) {
      throw new BatonError('invalid-params', 'finished_self_loop: the running leg must have its current station as an outcome');
    }
    return { reached, finished: outcomes.includes(reached) && (reached !== station || e.finished_self_loop) };
  }

  /** Ends an active claim (§6.5): the running leg finishes at its outcome or is given up at its
   *  `from` (R-BTN-71), open activities close `abandoned` (§6.9), the resume record is written
   *  for every end (R-BTN-24), and the end is logged. */
  private finish(claimId: number, ticketId: string, status: 'completed' | 'released' | 'reaped', reason: string, actor: string,
    opts: { ended_at_sha?: string | null; fence?: { incarnation: number; deadline?: number } | null; detail?: string | null; reached?: string | null; finished?: boolean; evidence?: string | null; next?: string | null; localOrder?: { leg: string | null; by: string; ran_at: string } | null } = {}) {
    const now = this.c.now();
    const c = this.rows<{ station: string; runner_id: number; regressed_since: number | null }>('SELECT station, runner_id, regressed_since FROM claims WHERE id = ?', claimId)[0];
    const run = this.runningLeg(claimId);
    const reached = opts.reached ?? c.station;
    if (run && opts.finished) {
      this.exec('UPDATE claim_legs SET to_station = ?, finished_at = ?, evidence = ? WHERE claim_id = ? AND seq = ?', reached, now, opts.evidence ?? null, claimId, run.seq);
    } else if (run) {
      // A reap, a stale-board release or an end at the leg's `from`: the leg was given up.
      this.exec('UPDATE claim_legs SET abandoned_at = ? WHERE claim_id = ? AND seq = ?', now, claimId, run.seq);
    }
    if (run) {
      // B-234 (R-BTN-195): the run ended, finished or given up — its open `interact` closes.
      if (run.run_id != null) this.c.conditions.runEnded(claimId, run.run_id);
      // R-BTN-81: the run's end, with the position the holder reported (B-38 makes it provisional).
      const f = this.legFacts(claimId, run.leg, run.run_id);
      // B-257: a finished run's end detail and evidence ride its row, so the ticket's history
      // shows what a person confirms (a `delivered` answer's commit and its tests) beside it.
      const shown = opts.finished && opts.detail ? { end_detail: opts.detail, ...(opts.evidence ? { evidence: opts.evidence } : {}) } : {};
      this.c.history.record(f.ticket, { kind: opts.finished ? 'leg-finished' : 'leg-abandoned', ...f.row, reached, next_leg: opts.next ?? null, detail: { end_reason: reason, ...shown } });
    }
    // R-BTN-62: only a reading numbered above the counter's value now can confirm this end. §2e:
    // regressed_since clears with the end; a suspension made while regressed is confirmed by any
    // later snapshot, which `ended_regressed` remembers. R-BTN-90: the claim's deadline dies
    // with it.
    this.exec(`UPDATE claims SET status = ?, ended_at = ?, end_reason = ?, end_detail = ?, ended_at_sha = ?, fence_pending = ?, fence_incarnation = ?, fence_deadline = ?, end_observation = ?,
                 station = ?, leg = NULL, ended_regressed = ?, regressed_since = NULL, deadline_at = NULL WHERE id = ?`,
      status, now, reason, opts.detail ?? null, status === 'completed' ? opts.ended_at_sha ?? '' : null, opts.fence ? 1 : 0, opts.fence?.incarnation ?? null, opts.fence?.deadline ?? null,
      this.handedOut(repositoryOf(ticketId)), reached, c.regressed_since != null ? 1 : 0, claimId);
    this.settleDeadlineRelease(c.runner_id, ticketId, reason === 'released:leg-timeout' ? 'acknowledge' : 'end', now);
    this.exec(`UPDATE activities SET ended_at = ?, outcome = 'abandoned' WHERE claim_id = ? AND ended_at IS NULL`, now, claimId);
    // R-BTN-178: the claim's seats release at its end — except a fence-pending reap's, which a
    // reaped incarnation may still be driving (R-BTN-19): those go at `fence-cleared` or the
    // fence deadline (the alarm's lapse, or `fenced`).
    if (!opts.fence) this.exec('DELETE FROM claim_seats WHERE claim_id = ?', claimId);
    this.event(status, actor, { end_reason: reason, reached, ...(opts.detail ? { detail: opts.detail } : {}), ...(opts.ended_at_sha ? { ended_at_sha: opts.ended_at_sha } : {}), ...(opts.fence ? { fence_pending: true } : {}), ...(opts.localOrder ? { local_order: opts.localOrder } : {}) }, ticketId, claimId);
    // §12: the mirror writes the end; R-BTN-73: every end dispatches a sync, which confirms a
    // completion (R-BTN-10) without waiting for an unrelated push and makes the ticket claimable.
    this.c.dispatch('mirror', ticketId);
    this.c.dispatch('sync', ticketId);
    // §13 step 3: a legacy claim that ends takes its adoption request with it.
    this.exec('DELETE FROM adoptions WHERE claim_id = ?', claimId);
    this.writeResume(claimId, reason, now, opts.next ?? null);
    // R-BTN-75 as amended by R3-1254 (B-26): an end is never an unblocking — the claim held the
    // ticket, so nothing clears here — but one that leaves the ticket blocked (a backoff
    // started, a decision posted while held) logs `blocked`, which wakes no one.
    this.c.blocks.held(ticketId, false);
    if (status === 'completed') this.confirmByClosure(claimId);
    else this.applyRetryPolicy(claimId, ticketId, reason);
  }

  // ── attempts, retries and holds (§6.10, §8; R3-1217) ────────────────────────────────────

  /** The event-log position of the newest hold-lift on the item: the count of failed attempts
   *  starts after it (§6.10). Ordered by the log, never by time — a lift and an end can share a
   *  millisecond. */
  private lastLift(item: string): number {
    return this.rows<{ seq: number | null }>(
      `SELECT max(seq) AS seq FROM events WHERE kind = 'override' AND ticket_id = ? AND json_extract(detail_json, '$.hold') = 0`, item)[0]?.seq ?? 0;
  }

  /** The claims of an item whose end was logged after event `since`, newest end first. */
  private endedSince(item: string, since: number) {
    return this.rows<{ id: number; runner_id: number; end_reason: string; failed_attempt: number }>(
      `SELECT id, runner_id, end_reason, failed_attempt FROM (
         SELECT c.id, c.runner_id, c.end_reason, c.failed_attempt,
                (SELECT max(e.seq) FROM events e WHERE e.claim_id = c.id AND e.kind IN ('completed', 'released', 'reaped')) AS end_seq
         FROM claims c WHERE c.ticket_id = ? AND c.status != 'active')
       WHERE end_seq > ? ORDER BY end_seq DESC`, item, since);
  }

  /** Counting is a query, not a counter: failed claims ended after the newest hold-lift. */
  failedAttempts(item: string): number[] {
    return this.endedSince(item, this.lastLift(item)).filter((c) => c.failed_attempt === 1).map((c) => c.id).sort((a, b) => a - b);
  }

  /** R-BTN-24: the record the next claimant reads, from this claim's activities. */
  private writeResume(claimId: number, reason: string, now: number, next: string | null = null) {
    const acts = this.rows<ResumeActivity>('SELECT kind, seq, label, started_at, ended_at, outcome, detail_json FROM activities WHERE claim_id = ? ORDER BY started_at', claimId);
    const transcripts = this.rows<{ repo: string; path: string; role: string }>('SELECT repo, path, role FROM transcripts WHERE claim_id = ? ORDER BY id', claimId);
    const c = this.rows<{ end_detail: string | null; station: string }>('SELECT end_detail, station FROM claims WHERE id = ?', claimId)[0];
    // R-BTN-24: every end, a suspension included; with the legs the claim ran, where it rests and
    // the queued leg the holder named (`next`, R-BTN-83; round 1, 1-B-4).
    const record = { ...resumeRecord(reason, now, acts, transcripts), detail: c?.end_detail ?? null, reached: c?.station ?? null, next, legs: this.legsOf(claimId) };
    this.exec('UPDATE claims SET resume_json = ? WHERE id = ?', JSON.stringify(record), claimId);
  }

  /** §6.10, after a claim ends other than completed: mark the failed attempt, then back off, or
   *  hold — non-retryable at once, attempts-exhausted at the third. (`awaiting-review-capacity`
   *  is retired: a review with no capacity is simply not ready, §6.5.) */
  private applyRetryPolicy(claimId: number, item: string, reason: string) {
    const ended = this.endedSince(item, this.lastLift(item));
    const c = this.rows<{ runner_id: number }>('SELECT runner_id FROM claims WHERE id = ?', claimId)[0];
    const leaseLostBefore = reason === 'released:lease-lost' &&
      ended.some((e) => e.id !== claimId && e.runner_id === c.runner_id && e.failed_attempt === 1 && e.end_reason === 'released:lease-lost');
    if (countsAsFailed(reason, leaseLostBefore)) {
      this.exec('UPDATE claims SET failed_attempt = 1 WHERE id = ?', claimId);
      const failed = this.failedAttempts(item);
      const cls = nonRetryableClass(reason);
      if (cls) {
        this.hold(item, `non-retryable:${cls}`, 'baton', { claim_id: claimId, attempts: failed });
        // R-BTN-78: the hold is put to the owner as Baton's own decision (a `contract-input`
        // class, from B-39, raises `baton:contract` instead).
        this.c.blocks.raise(item, 'baton:retries');
        return;
      }
      const next = afterFailure(failed.length, this.c.admin.retry(repositoryOf(item)));
      if (next && 'hold' in next) {
        this.event('attempts-exhausted', 'baton', { claim_id: claimId, attempts: failed }, item, claimId);
        this.hold(item, next.hold, 'baton', { claim_id: claimId, attempts: failed });
        this.c.blocks.raise(item, 'baton:retries');
        return;
      }
      if (next) {
        const until = this.c.now() + next.retryAfterMs;
        this.upsertOverride(item, 'baton', { retry_after: until });
        this.event('override', 'baton', { retry_after: until, claim_id: claimId, attempts: failed }, item, claimId);
      }
      return;
    }
  }

  private upsertOverride(item: string, by: string, set: { hold?: 0 | 1; hold_reason?: string | null; retry_after?: number | null; expedite?: 0 | 1 }) {
    const now = this.c.now();
    this.exec(`INSERT INTO ticket_overrides (ticket_id, expedite, hold, hold_reason, retry_after, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (ticket_id) DO UPDATE SET set_by = excluded.set_by, set_at = excluded.set_at`,
      item, set.expedite ?? 0, set.hold ?? 0, set.hold_reason ?? null, set.retry_after ?? null, by, now);
    for (const [k, v] of Object.entries(set)) this.exec(`UPDATE ticket_overrides SET ${k} = ? WHERE ticket_id = ?`, v, item);
  }

  /** §8: every hold, whoever sets it, is an `override` event and a `held` event with its reason. */
  private hold(item: string, reason: string, actor: string, detail: Record<string, unknown> = {}) {
    this.c.dispatch('mirror', item); // §6.10: the mirror writes the hold's note
    this.upsertOverride(item, actor, { hold: 1, hold_reason: reason });
    this.event('override', actor, { hold: 1, hold_reason: reason }, item, (detail.claim_id as number) ?? null);
    this.event('held', actor, { hold_reason: reason, ...detail }, item, (detail.claim_id as number) ?? null);
  }

  /** B-134: with the owners' `scope_policy: hold`, a scope-exceeded finding parks its ticket
   *  until an owner lifts the hold the way any hold is lifted (§8). The reason is the finding's
   *  kind, so the dashboard names what held it; the actor is Baton, as every automatic hold's. */
  holdForScope(item: string, claimId: number) {
    this.hold(item, 'scope-exceeded', 'baton', { claim_id: claimId });
  }

  /** `POST /v1/ui/overrides/{item}` (§8, §11): `{expedite?, hold?}`. Lifting a hold clears its
   *  reason and any backoff, and resets the attempt count (§6.10). */
  // @model setHold sha256:2569b5668121
  setOverride(owner: string, item: string, body: unknown) {
    const o = checkOverride(body);
    const actor = `owner:${owner}`;
    if (o.expedite !== undefined) {
      if (o.expedite) this.c.dispatch('mirror', item); // §8: the mirror writes the EXPEDITE tag
      this.upsertOverride(item, actor, { expedite: o.expedite ? 1 : 0 });
      this.event('override', actor, { expedite: o.expedite ? 1 : 0 }, item);
    }
    if (o.hold === true) this.hold(item, 'owner', actor);
    if (o.hold === false) this.liftHold(item, actor);
    return { ok: true };
  }

  /** B-110: what the sync reads of Baton's own record with its observation number, for the
   *  repository's live tickets (local ids): the owner's answers to the sync's posted decisions,
   *  and the legs claims finished with an evidence pointer, each with its claim's nonce — what a
   *  station function checks a marker in git against (a marker counts only as the evidence a
   *  claim's own advance recorded). Newest first, bounded. */
  syncRecord(repo: string): { answers: { ticket: string; decision: string; answer: string; answered_at: number }[]; legs: { ticket: string; leg: string; claim_nonce: string; evidence: string; reached: string }[]; unconfirmed: { ticket: string; claim: number; evidence: string }[] } {
    const local = (id: string) => id.slice(id.indexOf(':') + 1);
    const live = `t.repository_id = ? AND NOT EXISTS (SELECT 1 FROM closed_tickets x WHERE x.ticket_id = t.id)`;
    const answers = this.rows<{ ticket_id: string; decision_id: string; answer: string; answered_at: number }>(
      `SELECT a.ticket_id, a.decision_id, a.answer, a.answered_at FROM decision_answers a CROSS JOIN tickets t ON t.id = a.ticket_id
       WHERE ${live} ORDER BY a.answered_at DESC LIMIT ${SYNC_RECORD_MAX}`, repo);
    // B-257: each with the station it reached, so a station function tells an implement run that
    // opened a PR from one that answered `delivered` by Baton's record, not by git.
    const legs = this.rows<{ ticket_id: string; leg: string; nonce: string; evidence: string; reached: string }>(
      `SELECT c.ticket_id, l.leg, c.nonce, l.evidence, l.to_station AS reached FROM claim_legs l JOIN claims c ON c.id = l.claim_id JOIN tickets t ON t.id = c.ticket_id
       WHERE ${live} AND l.evidence IS NOT NULL AND l.finished_at IS NOT NULL ORDER BY l.finished_at DESC, l.claim_id DESC, l.seq DESC LIMIT ${SYNC_RECORD_MAX}`, repo);
    // R-BTN-10 (§4.3): every unconfirmed end that named evidence, with what it named — what the
    // sync attests `std:git.evidence@1` for. A `done` is confirmed by closure whatever it named, so
    // it is not listed. Oldest first, as many as one post's attestations may carry.
    // Read through the holding index (its predicate restated), never a scan of the tickets: an
    // observation is on every sync's path (S-BTN-243).
    const unconfirmed = this.rows<{ ticket_id: string; id: number; ended_at_sha: string }>(
      `SELECT c.ticket_id, c.id, c.ended_at_sha FROM claims c INDEXED BY claims_holding
       WHERE (c.status = 'active' OR (c.status = 'completed' AND c.confirmed_at IS NULL) OR (c.status = 'reaped' AND c.fence_pending = 1))
         AND c.ticket_id >= ? || ':' AND c.ticket_id < ? || ';'
         AND c.status = 'completed' AND c.confirmed_at IS NULL AND c.end_reason != 'done' AND COALESCE(c.ended_at_sha, '') != ''
         AND EXISTS (SELECT 1 FROM tickets t WHERE t.id = c.ticket_id)
         AND NOT EXISTS (SELECT 1 FROM closed_tickets x WHERE x.ticket_id = c.ticket_id)
       ORDER BY c.ended_at, c.id LIMIT ${EVIDENCE_LIST_MAX}`, repo, repo);
    return {
      answers: answers.map((a) => ({ ticket: local(a.ticket_id), decision: a.decision_id, answer: a.answer, answered_at: a.answered_at })),
      legs: legs.map((l) => ({ ticket: local(l.ticket_id), leg: l.leg, claim_nonce: l.nonce, evidence: l.evidence, reached: l.reached })),
      unconfirmed: unconfirmed.map((u) => ({ ticket: local(u.ticket_id), claim: u.id, evidence: u.ended_at_sha })),
    };
  }

  /** B-110: the runs an owner's answers have granted each leg of this ticket beyond its
   *  `max_runs` (§6.8), one key per leg. */
  private grants(item: string): Record<string, number> {
    const row = this.rows<{ runs_json: string | null }>('SELECT runs_json FROM ticket_overrides WHERE ticket_id = ?', item)[0];
    if (row?.runs_json == null) return {};
    try {
      const v = JSON.parse(row.runs_json) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isInteger(e[1]) && e[1] > 0));
    } catch {
      return {};
    }
  }

  /** B-110: the runs an owner has granted a leg of this ticket beyond its `max_runs` (§6.8). */
  private grantedRuns(item: string, leg: string): number {
    return this.grants(item)[leg] ?? 0;
  }

  /** B-110 (§6.8): an answer's grant — `runs` more of `leg` for this ticket, beside every other
   *  leg's grant (each leg its own key: granting one never resets another). */
  private grantRuns(item: string, actor: string, leg: string, runs: number): void {
    const all = { ...this.grants(item), [leg]: this.grantedRuns(item, leg) + runs };
    this.upsertOverride(item, actor, {});
    this.exec('UPDATE ticket_overrides SET runs_json = ? WHERE ticket_id = ?', JSON.stringify(all), item);
    this.event('override', actor, { runs: { [leg]: all[leg] } }, item);
  }

  /** §8, §6.10: a hold lifted, its reason and backoff cleared and the attempt count reset; any
   *  owner act that clears the hold under `baton:retries` closes it, so no decision outlives its
   *  hold (R-BTN-78). */
  private liftHold(item: string, actor: string) {
    this.upsertOverride(item, actor, { hold: 0, hold_reason: null, retry_after: null });
    this.event('override', actor, { hold: 0 }, item);
    this.c.blocks.answer(item, 'baton:retries');
  }

  /**
   * `POST /v1/owner/{repository}/tickets/{ticket}/resolve` (R-BTN-78, §11): an owner answers one of
   * Baton's own decisions. `baton:retries`: `retry` lifts the hold and its backoff; `park` closes
   * the decision and keeps the hold. `baton:stalled`: `retry` closes it and restarts its 72 hours;
   * `park` holds the ticket (`parked`) and closes it. `route` is B-38's (the owner's re-route).
   */
  resolveDecision(owner: string, ticket: string, body: unknown) {
    const a = checkDecisionAnswer(body);
    const actor = `owner:${owner}`;
    if ('posted' in a) {
      // B-110: the owner's answer to a decision the ticket's sync posted — create-pr's third
      // failed review round — through this authenticated route alone, never a commit any pusher
      // could write (the owner, 2026-11-03, "Through Baton, not git"). The answer is one of the
      // decision's options; an option's grant is applied here, in the answer's own transaction
      // (the owner, 2026-11-03, "The answer carries the grant"): no separate grant step.
      const d = this.c.blocks.postedDecision(ticket, a.decision);
      if (!d) throw new BatonError('not-found', `${ticket} has no open ${a.decision} decision`);
      const option = d.options.find((o) => o.id === a.answer);
      if (!option) throw new BatonError('invalid-params', `${a.decision} offers ${d.options.length ? d.options.map((o) => o.id).join(', ') : 'no options'}, not ${a.answer}`);
      this.c.blocks.answerPosted(ticket, a.decision, a.answer, owner, this.c.now());
      if (option.grants) this.grantRuns(ticket, actor, option.grants.leg, option.grants.runs);
      this.event('admin', actor, { act: 'resolve', decision: a.decision, answer: a.answer, ...(option.grants ? { grants: option.grants } : {}) }, ticket);
      return { ok: true };
    }
    if (!this.c.blocks.hasDecision(ticket, a.decision)) throw new BatonError('not-found', `${ticket} has no open ${a.decision} decision`);
    if (a.decision === 'baton:retries') {
      if (a.answer === 'retry') this.liftHold(ticket, actor);
      else this.c.blocks.answer(ticket, a.decision);
    } else {
      if (a.answer === 'retry') {
        this.exec(`UPDATE ticket_next_legs SET waiting_since = ? WHERE ticket_id = ? AND leg = (SELECT next_leg FROM ticket_stations WHERE ticket_id = ?)`,
          this.c.now(), ticket, ticket);
      } else this.hold(ticket, 'parked', actor);
      this.c.blocks.answer(ticket, a.decision);
    }
    this.event('admin', actor, { act: 'resolve', decision: a.decision, answer: a.answer }, ticket);
    return { ok: true };
  }

  /** Whether a stale-board release still reads as the runner's own git-first completion: git
   *  shows the item ended (done, superseded, deferred, deprioritized, archived or gone — not a
   *  re-tier) and nobody has claimed it since. */
  private gitEnded(item: string, claimId: number) {
    if (this.rows('SELECT 1 FROM claims WHERE ticket_id = ? AND id > ?', item, claimId).length) return false;
    const it = this.rows<{ status: string }>('SELECT status FROM tickets WHERE id = ?', item)[0];
    const closed = this.rows<{ closed_as: string }>('SELECT closed_as FROM closed_tickets WHERE ticket_id = ?', item)[0]?.closed_as;
    // A normative post says how it closed: only a `done` closure is the holder's own completion.
    return closed ? closed === 'done' : !it || GIT_ENDS.has(it.status);
  }

  /** `GET /v1/runner/tickets/{ticket}/holder` (R-BTN-7): whether another live, non-legacy runner
   *  holds the item, and whether a reaped claim on it is still fence-pending. `callerId` is
   *  null for a token-only caller (the witness), for whom every holder is another. */
  holder(callerId: number | null, item: string) {
    const held = this.rows(`SELECT 1 FROM claims c JOIN runners w ON w.id = c.runner_id
                            WHERE c.ticket_id = ? AND c.status = 'active' AND w.kind != 'legacy' AND (? IS NULL OR c.runner_id != ?)`, item, callerId, callerId).length > 0;
    const fence = this.rows(`SELECT 1 FROM claims WHERE ticket_id = ? AND status = 'reaped' AND fence_pending = 1`, item).length > 0;
    return { held_by_other: held, fence_pending: fence };
  }

  /** The board read's `holders` (B-129, a field on an existing read — R-BTN-179's one-answer
   *  rule): every live claim on one of the repository's tickets, each with its holder and when
   *  its lease ends, so a session claiming through git (`baton tickets claim`) reads the lock
   *  with the same request that answers the station. A legacy runner's claim has no lease the
   *  alarm would end, so its `lease_ends_at` is null. Claims on tickets git has dropped stay
   *  (R-BTN-35) — matched by the repository's qualified-id prefix. */
  holdersOf(repo: string, sessionLink: SessionLinkView) {
    return this.rows<{ ticket_id: string; runner_id: number; hostname: string; session_name: string; kind: string; last_seen_at: number; lease_timeout_ms: number; session_url: string | null; session_incarnation: number | null }>(
      `SELECT c.ticket_id, c.runner_id, w.hostname, w.session_name, w.kind, w.last_seen_at, w.lease_timeout_ms,
              l.session_url, l.session_incarnation
       FROM claims c JOIN runners w ON w.id = c.runner_id
       LEFT JOIN claim_legs l ON l.claim_id = c.id AND l.seq = (SELECT MAX(seq) FROM claim_legs
         WHERE claim_id = c.id AND finished_at IS NULL AND abandoned_at IS NULL)
       WHERE c.status = 'active' AND (c.ticket_id IN (SELECT id FROM tickets WHERE repository_id = ?) OR c.ticket_id LIKE ?)
       ORDER BY c.claimed_at, c.id`,
      repo, `${repo}:%`).map((c) => ({
      ticket_id: c.ticket_id,
      runner_id: c.runner_id,
      hostname: c.hostname,
      session_name: c.session_name,
      ...sessionLink(c.session_url, c.runner_id, c.session_incarnation),
      lease_ends_at: c.kind === 'legacy' ? null : leaseEndsAt(c),
    }));
  }

  /** The ticket's ended claims' resume records (R-BTN-24), pruned to what a claimant picking
   *  the ticket up through git needs (B-129): the branches and PRs every ended claim's
   *  activities recorded, newest claim first and each named once, with how the newest ended —
   *  the history read's `resume` field, so `baton tickets claim` learns from Baton the PR a
   *  broken frontmatter lost even when the newest claim (a review that pushed nothing) named
   *  none. Null when no claim ever ended. */
  resumeOf(ticket: string) {
    const ended = this.rows<{ end_reason: string; ended_at: number; resume_json: string | null }>(
      `SELECT end_reason, ended_at, resume_json FROM claims WHERE ticket_id = ? AND status != 'active' ORDER BY id DESC`, ticket);
    if (!ended.length) return null;
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const branches = new Set<string>();
    const prs = new Set<string>();
    for (const r of ended) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = r.resume_json ? (JSON.parse(r.resume_json) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }
      for (const b of list(parsed.branches)) branches.add(b);
      for (const p of list(parsed.prs)) prs.add(p);
    }
    return { end_reason: ended[0].end_reason, ended_at: ended[0].ended_at, branches: [...branches], prs: [...prs] };
  }

  /** `GET /v1/runner/branch-holder?repo=&branch=` (§6.3, R-BTN-51): every live ticket the branch
   *  maps to through its course's current or previous `branch_pattern` — `{ticket}` its local id,
   *  `{repository}` its repository's id, `*` anything — among the tickets whose home is that git
   *  repository or whose `repos` name it; and whether another live runner holds one of them or a
   *  reaped claim on one is fence-pending. Two repositories' tickets sharing a local id both map,
   *  and the push is refused if either is held: a collision fails safe. R-BTN-47 (B-173) with
   *  R-BTN-138: a retired repository's former path still reaches the fence — its tickets map
   *  while no live repository holds the path and a fence is pending on one of them, and never
   *  for anything else. */
  branchHolder(callerId: number | null, gitRepo: string, branch: string) {
    const name = gitRepo.slice(gitRepo.indexOf('/') + 1).toLowerCase();
    const full = gitRepo.toLowerCase();
    const rows = this.rows<{ id: string; local_id: string; repository_id: string; repos: string; github: string; former_paths: string | null; retired_at: number | null; branch_pattern: string | null; previous_branch_pattern: string | null }>(
      `SELECT t.id, t.local_id, t.repository_id, t.repos, p.github, p.former_paths, p.retired_at, k.branch_pattern, k.previous_branch_pattern
       FROM tickets t JOIN repositories p ON p.id = t.repository_id
       LEFT JOIN courses k ON k.repository_id = t.repository_id AND k.id = t.course_id`);
    const taken = this.rows('SELECT 1 FROM repositories WHERE retired_at IS NULL AND lower(github) = ?', full).length > 0;
    const fencePending = (repository: string) => this.rows(
      `SELECT 1 FROM claims c JOIN tickets t ON t.id = c.ticket_id
       WHERE t.repository_id = ? AND c.status = 'reaped' AND c.fence_pending = 1`, repository).length > 0;
    const tickets = rows.filter((t) => {
      // `repos` holds owner/name once the sync resolves them (§7.1); docs' interim post sends
      // short names, matched against the repository's own name.
      const repos = (JSON.parse(t.repos) as string[]).map((r) => r.toLowerCase());
      const named = t.retired_at == null
        ? t.github.toLowerCase() === full || repos.includes(full) || repos.includes(name)
        // A retired repository's former path, and only the fence (R-BTN-47, R-BTN-138).
        : !taken && (JSON.parse(t.former_paths ?? '[]') as string[]).some((p) => p.toLowerCase() === full) && fencePending(t.repository_id);
      if (!named) return false;
      return [t.branch_pattern ?? DEFAULT_BRANCH_PATTERN, t.previous_branch_pattern].some((pat) => pat != null && branchMatches(pat, branch, t.local_id, t.repository_id));
    }).map((t) => t.id).sort();
    // The same answer per ticket as the ticket holder query (R-BTN-7), any of them counting.
    const each = tickets.map((id) => this.holder(callerId, id));
    return { tickets, held_by_other: each.some((h) => h.held_by_other), fence_pending: each.some((h) => h.fence_pending) };
  }

  /** The heartbeat's view of an active claim (§11): its station and running leg, and `git` —
   *  where the head snapshot places the ticket, with `regressed` (§2e); `{closed}` once a snapshot
   *  recorded it closed; `unknown` when the course file no longer has the claim's station or leg
   *  (R-BTN-64); null when no snapshot places it. */
  holderView(claimId: number) {
    const c = this.rows<{ ticket_id: string; station: string; leg: string | null; course_id: string | null; regressed_since: number | null; deadline_at: number | null }>(
      'SELECT ticket_id, station, leg, course_id, regressed_since, deadline_at FROM claims WHERE id = ?', claimId)[0];
    if (!c) return {};
    const g = c.course_id ? this.stations.graph(repositoryOf(c.ticket_id), c.course_id) : null;
    const live = this.rows('SELECT 1 FROM tickets WHERE id = ?', c.ticket_id).length > 0;
    const closed = this.rows<{ closed_as: string }>('SELECT closed_as FROM closed_tickets WHERE ticket_id = ?', c.ticket_id)[0];
    const st = this.rows<{ station: string; path: string; path_len: number }>('SELECT station, path, path_len FROM ticket_stations WHERE ticket_id = ?', c.ticket_id)[0];
    let git: unknown = null;
    if (!live && closed) git = { closed: closed.closed_as };
    else if (g && c.station !== '' && (!resolveStation(g, c.station) || (c.leg != null && !resolveLeg(g, c.leg)))) git = 'unknown';
    else if (st) {
      git = { station: st.station, path: JSON.parse(st.path), path_len: st.path_len, regressed: c.regressed_since != null,
        next: this.rows<{ leg: string; state: string; waiting_on: string | null }>('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', c.ticket_id)
          .map((n) => (n.waiting_on ? n : { leg: n.leg, state: n.state })) };
    }
    return { station: c.station, ...(c.leg ? { leg: c.leg } : {}), ...(c.deadline_at != null ? { deadline_at: c.deadline_at } : {}), git };
  }

  /** The heartbeat's `fenced` report (R-BTN-19): clears the fence of a claim reaped while this
   *  runner was alive — only in the incarnation it was reaped in, since a re-key never clears one. */
  // @model fenceCleared sha256:551d1bb768f5
  // @model heartbeat sha256:9c0136704c87
  fenced(runnerId: number, incarnation: number, claimId: number) {
    const c = this.rows<{ ticket_id: string }>(
      `SELECT ticket_id FROM claims WHERE id = ? AND runner_id = ? AND status = 'reaped' AND fence_pending = 1 AND fence_incarnation = ?`,
      claimId, runnerId, incarnation)[0];
    if (!c) return false;
    this.exec('UPDATE claims SET fence_pending = 0 WHERE id = ?', claimId);
    // R-BTN-178: the fence clearing releases the reaped claim's seats.
    this.exec('DELETE FROM claim_seats WHERE claim_id = ?', claimId);
    this.event('fence-cleared', `runner:${runnerId}`, { by: 'sidecar' }, c.ticket_id, claimId);
    this.c.blocks.held(c.ticket_id, false);
    return true;
  }

  // ── the owner's actions (§14) ───────────────────────────────────────────────────────────

  /** `POST /v1/ui/claims/{id}/reap`: any active claim. A live runner's claim is fence-pending
   *  (R-BTN-19) and the runner is not reaped, so its sidecar can still report the fence; a
   *  silent runner's is reaped as the alarm would. */
  // @model forceReap sha256:dea6a296cd3c
  forceReap(owner: string, claimId: number, body: unknown) {
    checkConfirm(body);
    const c = this.rows<{ id: number; ticket_id: string; runner_id: number; status: string }>('SELECT id, ticket_id, runner_id, status FROM claims WHERE id = ?', claimId)[0];
    if (!c) throw new BatonError('not-found', 'no such claim');
    if (c.status !== 'active') throw new BatonError('claim-ended', 'the claim already ended');
    const w = this.runner(c.runner_id);
    const now = this.c.now();
    const alive = isClaimLeaseLive(w, now);
    this.finish(c.id, c.ticket_id, 'reaped', 'reaped:owner', `owner:${owner}`, { fence: alive ? { incarnation: w.incarnation } : null });
    if (!alive) this.exec('UPDATE runners SET reaped_at = ? WHERE id = ? AND reaped_at IS NULL', now, w.id);
    return { ok: true, fence_pending: alive };
  }

  /** `POST /v1/ui/claims/{id}/fence-clear` (§9.5, §12.2): an administrator clears a pending
   *  fence at once — the manual counterpart of the sidecar's `fenced` report, destructive and
   *  confirmed like force-reap (R-BTN-155) and never delegated. One transaction: the fence goes,
   *  the claim's seats free (R-BTN-178, as at the fence's deadline), `fence-cleared {admin}` is
   *  logged and the ticket stops being held — claimable again under §6.7's reading-since-the-end,
   *  the next claimant's re-read of git (R-BTN-25) its only protection. A claim whose fence is
   *  not pending is `conflict`; a freeze never refuses it (R-BTN-88), so a seal waiting on the
   *  claim proceeds after it. The runner is not reaped: it may still be alive, its own lease
   *  check (R-BTN-26) the bound on what it can push. */
  // @model adminFenceClear sha256:e910358c8682
  fenceClear(admin: string, claimId: number, body: unknown) {
    checkConfirm(body);
    const c = this.rows<{ ticket_id: string }>('SELECT ticket_id FROM claims WHERE id = ?', claimId)[0];
    if (!c) throw new BatonError('not-found', 'no such claim');
    if (!this.rows(`SELECT 1 FROM claims WHERE id = ? AND status = 'reaped' AND fence_pending = 1`, claimId).length) {
      throw new BatonError('conflict', 'the claim\'s fence is not pending');
    }
    this.exec('UPDATE claims SET fence_pending = 0 WHERE id = ?', claimId);
    // R-BTN-178: the clear releases the reaped claim's seats, as its fence's deadline does.
    this.exec('DELETE FROM claim_seats WHERE claim_id = ?', claimId);
    this.event('fence-cleared', `admin:${admin}`, { by: 'admin', admin }, c.ticket_id, claimId);
    this.c.blocks.held(c.ticket_id, false);
    return { ok: true };
  }

  /** R-BTN-47 (B-173): retirement's reaps, inside the retiring transaction — each active claim
   *  on the repository's tickets as an administrator's force-reap reaps one (§9.5), actor
   *  `admin:<fingerprint>`, fence-pending where its runner is alive so the old holder can still
   *  heartbeat and report the fence (R-BTN-19, R-BTN-3). The repository is already retired when
   *  this runs, so the ends record no want (R-BTN-94). */
  retireReaps(repository: string, actor: string) {
    const now = this.c.now();
    for (const c of this.rows<{ id: number; ticket_id: string; runner_id: number; kind: string; incarnation: number; last_seen_at: number; lease_timeout_ms: number }>(
      `SELECT c.id, c.ticket_id, c.runner_id, w.kind, w.incarnation, w.last_seen_at, w.lease_timeout_ms FROM claims c
       JOIN runners w ON w.id = c.runner_id
       WHERE c.status = 'active' AND substr(c.ticket_id, 1, length(?) + 1) = ? || ':' ORDER BY c.id`, repository, repository)) {
      const alive = isClaimLeaseLive(c, now);
      this.finish(c.id, c.ticket_id, 'reaped', 'reaped:owner', actor, { fence: alive ? { incarnation: c.incarnation } : null });
      if (!alive) this.exec('UPDATE runners SET reaped_at = ? WHERE id = ? AND reaped_at IS NULL', now, c.runner_id);
    }
  }

  /** `POST /v1/ui/claims/{id}/confirm` and `…/release` (§6.7; B-222's two routes, each handing
   *  its own `action`): an unconfirmed completion is never confirmed automatically; the owner
   *  confirms it (git does carry it) or releases it (it never landed), which makes the item
   *  claimable again. The commit it named stays in the event. */
  // @model ownerResolve sha256:45e2eeaff781
  resolve(owner: string, claimId: number, body: unknown) {
    const { action } = checkResolve(body);
    const c = this.rows<{ ticket_id: string; end_reason: string; ended_at_sha: string }>(
      `SELECT ticket_id, end_reason, ended_at_sha FROM claims WHERE id = ? AND status = 'completed' AND confirmed_at IS NULL`, claimId)[0];
    if (!c) throw new BatonError('not-found', 'no unconfirmed completion with that id');
    if (action === 'confirm') {
      this.exec('UPDATE claims SET confirmed_at = ? WHERE id = ?', this.c.now(), claimId);
      this.event('confirmed', `owner:${owner}`, { by: 'owner', sha: c.ended_at_sha }, c.ticket_id, claimId);
    } else {
      this.exec(`UPDATE claims SET status = 'released', end_reason = 'released:requested', ended_at_sha = NULL WHERE id = ?`, claimId);
      this.c.dispatch('mirror', c.ticket_id);
      this.event('released', `owner:${owner}`, { by: 'owner', unconfirmed: { end_reason: c.end_reason, ended_at_sha: c.ended_at_sha } }, c.ticket_id, claimId);
    }
    // Both resolutions end the hold the unconfirmed completion kept — a confirm and a release
    // alike can only set or leave `blocked_since` (the ticket was held, so nothing clears),
    // never an unblocking, and one that leaves the ticket blocked logs `blocked` (R-BTN-75 as
    // amended by R3-1254, B-26).
    this.c.blocks.held(c.ticket_id, false);
    return { ok: true };
  }

  /** `POST /v1/ui/board/accept`: the owner accepts a held history; the sync's next force post
   *  of it then becomes the head (§7.1). */
  acceptHeld(owner: string, body: unknown) {
    const { repository, sha } = checkAccept(body);
    const held = this.rows<{ accepted_at: number | null }>('SELECT accepted_at FROM held_snapshots WHERE repository_id = ? AND sha = ?', repository, sha)[0];
    if (!held) throw new BatonError('not-found', 'no such held history');
    if (held.accepted_at == null) {
      this.exec('UPDATE held_snapshots SET accepted_at = ? WHERE repository_id = ? AND sha = ?', this.c.now(), repository, sha);
      this.event('snapshot-accepted', `owner:${owner}`, { sha, held: true, by: 'owner' }, null, null, repository);
    }
    return { ok: true };
  }

  // ── the sync's share (§6.7, R-BTN-35) ───────────────────────────────────────────────────

  // ── the deadline in a claim (§7.5 R-BTN-90; B-234) ───────────────────────────────────────

  /**
   * R-BTN-90: the claims whose armed `deadline_at` has passed — each holder is queued a
   * `release` with reason `leg-timeout` and the tick logs `leg-timeout`. The runner stops the
   * leg at its next safe point, writes its hand-off and ends the claim `released:leg-timeout`,
   * a failed attempt (§6.10); this only takes the claim back, it ends nothing itself. The
   * caller's transaction (the alarm's).
   */
  // @model queueTimeout sha256:f95f3da4be95
  deadlineDue(now: number): number {
    const due = this.rows<{ id: number; ticket_id: string; runner_id: number; deadline_at: number }>(
      `SELECT id, ticket_id, runner_id, deadline_at FROM claims WHERE status = 'active' AND deadline_at IS NOT NULL AND deadline_at <= ? ORDER BY deadline_at`, now);
    for (const c of due) {
      this.exec(`INSERT INTO messages (kind, payload_json, from_principal, to_runner_id, sent_at, status) VALUES ('release', ?, 'server', ?, ?, 'pending')`,
        JSON.stringify({ ticket_id: c.ticket_id, reason: 'leg-timeout', deadline_at: c.deadline_at }), c.runner_id, now);
      // The claim's deadline is spent: one release, never one a tick (the claim's end clears
      // the column too, and a new run's advance arms its own).
      this.exec('UPDATE claims SET deadline_at = NULL WHERE id = ?', c.id);
      this.event('leg-timeout', 'alarm', { deadline_at: c.deadline_at }, c.ticket_id, c.id);
    }
    return due.length;
  }

  /** The earliest armed deadline the alarm can consume, for the alarm (§3). */
  nextDeadline(): number | null {
    return this.rows<{ d: number | null }>(`SELECT MIN(d) AS d FROM (
      SELECT MIN(deadline_at) AS d FROM claims WHERE status = 'active' AND deadline_at IS NOT NULL
      UNION ALL SELECT MIN(fence_deadline) FROM claims WHERE status = 'reaped' AND fence_pending = 1 AND fence_deadline IS NOT NULL
    )`)[0]?.d ?? null;
  }

  /** A timeout message must not carry over to another run or claim. A timeout end itself
   *  acknowledges delivery, so the sidecar's subsequent ack remains idempotent. */
  private settleDeadlineRelease(runnerId: number, ticketId: string, how: 'advance' | 'end' | 'acknowledge', now: number) {
    this.exec(`UPDATE messages SET status = CASE WHEN status = 'delivered' AND ? THEN 'acknowledged' ELSE 'expired' END,
                 acknowledged_at = CASE WHEN status = 'delivered' AND ? THEN ? ELSE acknowledged_at END
               WHERE to_runner_id = ? AND kind = 'release' AND (status = 'pending' OR (status = 'delivered' AND ?))
                 AND json_extract(payload_json, '$.ticket_id') = ? AND json_extract(payload_json, '$.reason') = 'leg-timeout'`,
      how === 'acknowledge' ? 1 : 0, how === 'acknowledge' ? 1 : 0, now, runnerId, how !== 'advance' ? 1 : 0, ticketId);
  }

  /**
   * §7.5 R-BTN-90's finishing half (B-234): the heartbeat that carries `leg_finished` for the
   * claim's running run — sent by the runner out of its cadence the moment the script's `run`
   * returns, before validation, `close` or any wait — processed before that beat delivers its
   * messages. A `leg-timeout` release still pending for the claim is withdrawn (the message set
   * `expired` with `withdrawn: 'leg-finished'`, a `leg-timeout` event logged `{withdrawn:
   * true}`), so the finishing run is never failed at an instant it beat, nor the next leg
   * stopped by a release its run had coming; one already delivered stands. A still-armed
   * `deadline_at` re-arms to now plus 40 minutes, once per leg run — the run's row marks the
   * re-arm — so a slow push or review of the result is never cut off. The caller's transaction
   * (the heartbeat's). A seq that names no running run of this runner's active claim — a beat
   * retried past the advance that finished the run — changes nothing.
   */
  // @model legFinished sha256:27268e3cdbb4
  legFinished(runnerId: number, claimId: number, seq: number): void {
    const now = this.c.now();
    const c = this.rows<{ ticket_id: string; status: string; runner_id: number; deadline_at: number | null }>(
      'SELECT ticket_id, status, runner_id, deadline_at FROM claims WHERE id = ?', claimId)[0];
    if (!c || c.runner_id !== runnerId || c.status !== 'active') return;
    const run = this.rows<{ seq: number }>(
      'SELECT seq FROM claim_legs WHERE claim_id = ? AND finished_at IS NULL AND abandoned_at IS NULL ORDER BY seq DESC LIMIT 1', claimId)[0];
    if (!run || run.seq !== seq) return;
    // The withdrawal, before the beat's deliver: only a still-pending release (one delivered
    // has already reached the runner, and stands).
    const pending = this.rows<{ id: number }>(`SELECT id FROM messages WHERE to_runner_id = ? AND kind = 'release' AND status = 'pending'
                   AND json_extract(payload_json, '$.ticket_id') = ? AND json_extract(payload_json, '$.reason') = 'leg-timeout'`, runnerId, c.ticket_id);
    for (const m of pending) {
      this.exec(`UPDATE messages SET status = 'expired', withdrawn = 'leg-finished' WHERE id = ?`, m.id);
      this.event('leg-timeout', 'alarm', { withdrawn: true, message: m.id }, c.ticket_id, claimId);
    }
    // The re-arm, once per leg run: a claim whose deadline the alarm already spent (its release
    // pending or delivered above) holds none to re-arm; the next advance arms its own.
    if (c.deadline_at != null) {
      const rearm = this.rows<{ n: number }>(
        'SELECT COUNT(*) AS n FROM claim_legs WHERE claim_id = ? AND seq = ? AND deadline_rearmed_at IS NOT NULL', claimId, seq)[0].n;
      if (!rearm) {
        this.exec('UPDATE claims SET deadline_at = ? WHERE id = ?', now + LEG_FINISH_REARM_MS, claimId);
        this.exec('UPDATE claim_legs SET deadline_rearmed_at = ? WHERE claim_id = ? AND seq = ?', now, claimId, seq);
      }
    }
  }

  /** §7.1: whether a force post is the accepted rewritten history. Accepting a held history
   *  accepts the line, not one sha: main keeps moving while it is held, and the sync always
   *  posts the newest main (§7.1 step 2), so a force post against the head an accepted row
   *  was held against is accepted too. */
  acceptedLine(repo: string, head: string | null) {
    // Only against the head it was held against: an accepted sha re-posted later, once the head
    // has moved past it, is a rewind and is held like any other force post (R-BTN-11).
    return this.rows('SELECT 1 FROM held_snapshots WHERE repository_id = ? AND accepted_at IS NOT NULL AND head_sha IS ?', repo, head).length > 0;
  }

  /** A sync's confirmations, only those of claims on its own repository's tickets (R-BTN-47):
   *  one repository's sync never confirms another's completion. */
  ownConfirmations(repo: string, confirmations: { claim_id: number; sha: string }[]) {
    return confirmations.filter((k) => this.rows<{ ticket_id: string }>('SELECT ticket_id FROM claims WHERE id = ?', k.claim_id)
      .some((c) => repositoryOf(c.ticket_id) === repo));
  }

  /** §6.7: the sync confirms a completion once git carries it (it checked the ancestry and the
   *  status); anything but an unconfirmed completion is ignored. */
  confirm(confirmations: { claim_id: number; sha: string }[], observation: number) {
    const now = this.c.now();
    let n = 0;
    for (const k of confirmations) {
      // R-BTN-62: a reading confirms an end only if it was numbered after the end happened.
      const c = this.rows<{ ticket_id: string }>(`SELECT ticket_id FROM claims WHERE id = ? AND status = 'completed' AND confirmed_at IS NULL
                                                  AND COALESCE(end_observation, 0) < ?`, k.claim_id, observation)[0];
      if (!c) continue;
      this.exec('UPDATE claims SET confirmed_at = ? WHERE id = ?', now, k.claim_id);
      this.event('confirmed', 'sync', { sha: k.sha }, c.ticket_id, k.claim_id);
      this.c.blocks.held(c.ticket_id, false);
      n++;
    }
    return n;
  }

  /** R-BTN-71: the path an end or a claim is expected at — its `start_path` followed by the legs
   *  it finished, each with the station it reached. A run of a self-loop (it ends where it began)
   *  is left out: from the holder's word Baton cannot tell a loop it pushed from one it gave up,
   *  and without the step both readings of git confirm — a path that shows the run extends the
   *  expected one by an edge, and one that does not equals it (round 3, 3-A-1, adjudication). */
  private expectedPath(claimId: number, startPath: string): Step[] {
    return [...(JSON.parse(startPath) as Step[]),
      ...this.rows<{ leg: string; to_station: string }>(
        'SELECT leg, to_station FROM claim_legs WHERE claim_id = ? AND finished_at IS NOT NULL AND to_station != from_station ORDER BY seq', claimId)
        .map((l) => ({ leg: l.leg, reached: l.to_station }))];
  }

  /** R-BTN-10: a `done` end is confirmed by the closure a snapshot reported, or the end station it
   *  placed the ticket at, when that snapshot's observation is greater than the claim's own (its
   *  claim or latest advance) — usually before the end call, since the holder pushes first (R-BTN-8). */
  private confirmByClosure(claimId: number) {
    const c = this.rows<{ ticket_id: string; course_id: string | null; claim_observation: number }>(
      `SELECT ticket_id, course_id, claim_observation FROM claims
       WHERE id = ? AND status = 'completed' AND confirmed_at IS NULL AND end_reason = 'done'`, claimId)[0];
    if (!c) return false;
    const closed = this.rows(`SELECT 1 FROM closed_tickets WHERE ticket_id = ? AND closed_as = 'done' AND observation > ?`, c.ticket_id, c.claim_observation).length > 0;
    // …or the ticket at an end station in such a reading, when the ticket is still posted: the
    // holder pushed the merge, the sync read it, and only then the end arrived (G-BTN-44; found
    // by R3-1244's model-based tests — the judge already credits the same reading posted later)
    const placed = closed ? undefined : this.stations.placed(c.ticket_id);
    const st = placed && placed.observation > c.claim_observation ? placed : null;
    const g = st && c.course_id ? this.stations.graph(repositoryOf(c.ticket_id), c.course_id) : null;
    const atEnd = !!st && !!g && g.ends.has(st.station) && this.rows('SELECT 1 FROM tickets WHERE id = ?', c.ticket_id).length > 0;
    if (!closed && !atEnd) return false;
    this.exec('UPDATE claims SET confirmed_at = ? WHERE id = ?', this.c.now(), claimId);
    this.event('confirmed', 'sync', { by: closed ? 'closure' : 'end-station' }, c.ticket_id, claimId);
    this.c.blocks.held(c.ticket_id, false);
    return true;
  }

  /**
   * What an accepted snapshot (`observation`, its stations `seen`) settles for the repository's
   * claims, every course alike:
   * - R-BTN-10: a completed end observed after it is confirmed — a `done` when git shows it (an
   *   end station, a recorded closure or the ticket's absence); a suspension that named no
   *   `ended_at_sha` by the snapshot's being accepted at all, since Baton alone holds the position
   *   (R-BTN-39) and git has nothing of it to show; one that named evidence (a commit or a URL)
   *   when this post carries the sync's `std:git.evidence@1` for that claim and that evidence with
   *   `found: true` (`evidence`) — confirmation checks the evidence, never where git puts the
   *   ticket;
   * - R-BTN-35: an active claim from before the reading whose ticket git took away — withdrawn,
   *   gone without a `done` closure, re-tiered above the holder's ceiling, or (the interim post)
   *   at a status that ends the item — ends `released:stale-board`; a station that lags never does;
   * - §2e: a path shorter than git's last or the claim's `start_path` sets `regressed_since`, and
   *   a later path that extends the expected one clears it;
   * - R-BTN-63: a holder's declared bars the snapshot posts that leg's bars without log
   *   `bars-mismatch`.
   */
  // @model syncPost sha256:9d500d65a2bf
  judge(repo: string, observation: number, seen: Map<string, Seen>, evidence: PostedEvidence = new Map()) {
    let confirmed = 0;
    // A `done` is also confirmed by a reading numbered after the claim's latest advance that shows
    // the ticket at an end station — read before the end, posted after it (G-BTN-44: a closure
    // "with an observation greater than the claim's"; found by R3-1244's model-based tests).
    for (const c of this.rows<{ id: number; ticket_id: string; end_reason: string; ended_at_sha: string | null; start_path: string; ended_regressed: number; course_id: string | null; end_observation: number | null }>(
      `SELECT id, ticket_id, end_reason, ended_at_sha, start_path, ended_regressed, course_id, end_observation FROM claims
       WHERE status = 'completed' AND confirmed_at IS NULL
         AND (COALESCE(end_observation, 0) < ? OR (end_reason = 'done' AND claim_observation < ?))
         AND substr(ticket_id, 1, length(?) + 1) = ? || ':'`, observation, observation, repo, repo)) {
      if (this.endShown(c, observation, evidence)) {
        this.exec('UPDATE claims SET confirmed_at = ? WHERE id = ?', this.c.now(), c.id);
        this.event('confirmed', 'sync', { observation }, c.ticket_id, c.id);
        this.c.blocks.held(c.ticket_id, false);
        confirmed++;
      } else if (c.end_reason === 'done' && this.confirmByClosure(c.id)) {
        confirmed++;
      }
    }
    const stale = this.staleBoard(repo, observation);
    const now = this.c.now();
    // R-BTN-62: like staleness, a regression is judged only by a reading numbered after the
    // claim's latest claim or advance — an older one never saw that progress (found by R3-1244's
    // model-based tests: the model gates the whole judgement on the number).
    for (const c of this.rows<{ id: number; ticket_id: string; start_path: string; regressed_since: number | null; course_id: string | null }>(
      `SELECT id, ticket_id, start_path, regressed_since, course_id FROM claims
       WHERE status = 'active' AND claim_observation < ? AND substr(ticket_id, 1, length(?) + 1) = ? || ':'`, observation, repo, repo)) {
      const s = seen.get(c.ticket_id);
      const g = c.course_id ? this.stations.graph(repo, c.course_id) : null;
      if (!s || !g) continue;
      const start = JSON.parse(c.start_path) as Step[];
      const backwards = (s.prev != null && s.path.length < s.prev.length) || s.path.length < start.length;
      if (backwards && c.regressed_since == null) {
        this.exec('UPDATE claims SET regressed_since = ? WHERE id = ?', now, c.id);
        this.event('regressed', 'sync', { observation, path: s.path }, c.ticket_id, c.id);
        // R-BTN-81, R-BTN-85: git's shorter path wins; the claim's reckoning is logged beside it.
        this.c.history.record(c.ticket_id, { kind: 'regressed', claim_id: c.id, detail: { observation, path: s.path } });
        this.c.history.discrepancy(c.ticket_id, 'regressed', { path: this.expectedPath(c.id, c.start_path), source: 'claim' }, { path: s.path }, observation, c.id);
      } else if (!backwards && c.regressed_since != null && extendsPath(g, this.expectedPath(c.id, c.start_path), s.path, g.start)) {
        this.exec('UPDATE claims SET regressed_since = NULL WHERE id = ?', c.id);
      }
    }
    // R-BTN-63: the sync's reading of a leg's bars binds; a tag a holder declared that a later
    // snapshot's bars for that leg lack is logged once per leg run — whether the claim is still
    // active or has ended, typically at the snapshot that confirms its suspension (round 1, 1-A-1).
    // Each leg run is judged once, against the first later snapshot that posts that leg's bars:
    // a later, legitimate change of the bars (a seat substituted) says nothing about the run
    // (round 2, 2-A-2). The posted bars are under current names; a run started under an old one
    // reads them through `renamed_from` (2-A-3).
    // B-241: the unjudged leg runs of every ticket the post placed, in one query through
    // `claim_legs_unjudged` (0055; the CROSS JOIN reads it first), not one query per ticket.
    const unjudged = new Map<string, { claim_id: number; seq: number; leg: string; bars: string; course_id: string | null }[]>();
    for (const { ticket_id, ...l } of this.rows<{ ticket_id: string; claim_id: number; seq: number; leg: string; bars: string; course_id: string | null }>(
      `SELECT c.ticket_id, l.claim_id, l.seq, l.leg, l.bars, c.course_id FROM claim_legs l CROSS JOIN claims c ON c.id = l.claim_id
       WHERE l.bars != '[]' AND l.bars_judged = 0 AND l.started_observation < ? AND c.ticket_id IN (SELECT value FROM json_each(?))
       ORDER BY c.ticket_id, c.claimed_at, c.id, l.seq`, observation, JSON.stringify([...seen.keys()]))) {
      const list = unjudged.get(ticket_id);
      if (list) list.push(l);
      else unjudged.set(ticket_id, [l]);
    }
    for (const [ticketId, s] of seen) {
      for (const l of unjudged.get(ticketId) ?? []) {
        const g = l.course_id ? this.stations.graph(repo, l.course_id) : null;
        const name = (g && resolveLeg(g, l.leg)) ?? l.leg;
        // Own keys only: a leg named like an Object.prototype member is just a name (3-A-3).
        if (!Object.hasOwn(s.bars, name)) continue;
        const posted = s.bars[name];
        this.exec('UPDATE claim_legs SET bars_judged = 1 WHERE claim_id = ? AND seq = ?', l.claim_id, l.seq);
        const missing = (JSON.parse(l.bars) as string[]).filter((t) => !posted.includes(t));
        // R-BTN-67: a snapshot that lacks a required bar's prefix for a leg a claim ran on the
        // holder's bars is listed too.
        const policy = l.course_id ? this.c.admin.requiredBars(repo).filter((r) => requiredBarCovers(r, l.course_id!, name, g) && !meetsRequiredBar(r, posted)).map((r) => r.tag_prefix) : [];
        if (missing.length || policy.length) {
          this.event('bars-mismatch', 'sync', { seq: l.seq, leg: l.leg, declared_only: missing, ...(policy.length ? { policy } : {}), observation }, ticketId, l.claim_id);
          this.c.history.discrepancy(ticketId, 'bars-mismatch', { bars: JSON.parse(l.bars), leg: l.leg, source: 'holder' }, { bars: posted }, observation, l.claim_id);
        }
      }
    }
    return { confirmed, stale_released: stale };
  }

  /** R-BTN-10's test of one completed end against the head snapshot. */
  private endShown(c: { id: number; ticket_id: string; end_reason: string; ended_at_sha: string | null; start_path: string; ended_regressed: number; course_id: string | null; end_observation: number | null }, observation: number, evidence: PostedEvidence): boolean {
    const st = this.stations.placed(c.ticket_id);
    const live = this.rows('SELECT 1 FROM tickets WHERE id = ?', c.ticket_id).length > 0;
    const g = c.course_id ? this.stations.graph(repositoryOf(c.ticket_id), c.course_id) : null;
    if (c.end_reason === 'done') {
      // absent from a snapshot observed after the end
      if (!live) return (c.end_observation ?? 0) < observation;
      return !!st && st.observation >= observation && !!g && g.ends.has(st.station);
    }
    if (!c.end_reason.startsWith('suspended:') || (c.end_observation ?? 0) >= observation) return false;
    // R-BTN-10: an end that named no commit is confirmed by any accepted snapshot observed after
    // it. Its position is Baton's alone (R-BTN-39): git carries none, so no path could show it.
    if (!c.ended_at_sha) return true;
    // One that named evidence: the post attests that very evidence found (R-BTN-10).
    const e = evidence.get(c.id);
    return !!e && e.found && e.evidence === c.ended_at_sha && e.ticket === c.ticket_id;
  }

  /** R-BTN-10: a post's `std:git.evidence@1` attestations by claim — each with its ticket made
   *  repository-qualified, so one naming a claim of another ticket or repository confirms nothing
   *  (R-BTN-47). The shape was checked with the post. */
  evidenceOf(repo: string, attestations: readonly PostedAttestation[] | undefined): PostedEvidence {
    const out: PostedEvidence = new Map();
    for (const a of attestations ?? []) {
      if (a.type !== GIT_EVIDENCE_TYPE) continue;
      const v = a.value as { claim: number; evidence: string; found: boolean };
      out.set(v.claim, { ticket: `${repo}:${a.ticket}`, evidence: v.evidence, found: v.found });
    }
    return out;
  }

  /** R-BTN-64: a course file accepted with renames rewrites its active claims' station and leg. */
  renameActive(repo: string, course: string) {
    const g = this.stations.graph(repo, course);
    if (!g || (!g.legRenames.size && !g.stationRenames.size)) return;
    for (const c of this.rows<{ id: number; station: string; leg: string | null }>(
      `SELECT id, station, leg FROM claims WHERE status = 'active' AND course_id = ? AND substr(ticket_id, 1, length(?) + 1) = ? || ':'`, course, repo, repo)) {
      const station = g.stationRenames.get(c.station) ?? c.station;
      const leg = c.leg == null ? null : g.legRenames.get(c.leg) ?? c.leg;
      if (station !== c.station || leg !== c.leg) this.exec('UPDATE claims SET station = ?, leg = ? WHERE id = ?', station, leg, c.id);
    }
  }

  /** R-BTN-35 (git wins), on each accepted snapshot after cutover: an active claim whose ticket
   *  git took away — withdrawn, gone with no `done` closure, re-tiered above the holder's ceiling,
   *  or at an interim status that ends the item — ends `released:stale-board`, and the holder is
   *  told. A station that lags the holder's advances is never staleness (§2e). Before cutover git
   *  decides alone and the shadow reports end claims. */
  // @model syncPost sha256:9d500d65a2bf
  private staleBoard(repo: string, observation: number) {
    if (!this.rows('SELECT 1 FROM repositories WHERE id = ? AND cutover_at IS NOT NULL', repo).length) return 0;
    const active = this.rows<{ id: number; ticket_id: string; runner_id: number; tier_ceiling: string; tier_ceilings: string; kind: string }>(
      `SELECT c.id, c.ticket_id, c.runner_id, w.tier_ceiling, w.tier_ceilings, w.kind FROM claims c JOIN runners w ON w.id = c.runner_id
       WHERE c.status = 'active' AND substr(c.ticket_id, 1, length(?) + 1) = ? || ':'
         AND c.claim_observation < ?`, repo, repo, observation); // R-BTN-62: a reading from before the claim cannot judge it
    let n = 0;
    const ladder = this.ladder(repo);
    for (const c of active) {
      const it = this.rows<{ status: string; tier: string | null }>('SELECT status, tier FROM tickets WHERE id = ?', c.ticket_id)[0];
      const closed = this.rows<{ closed_as: string }>('SELECT closed_as FROM closed_tickets WHERE ticket_id = ?', c.ticket_id)[0]?.closed_as;
      // A legacy holder declared no ceiling: its claim is never re-tiered away.
      const ceiling = c.kind === 'legacy' ? ladder[ladder.length - 1] : ceilingIn(repo, ladder, JSON.parse(c.tier_ceilings), c.tier_ceiling);
      // Closed `done` is the holder's own archive, pushed before its end (R-BTN-8): the heartbeat
      // tells it `closed: 'done'` and it ends done, so that is not staleness.
      const why = !it ? (closed === 'done' ? null : closed === 'withdrawn' ? 'withdrawn' : 'gone or archived') : GIT_ENDS.has(it.status) ? it.status
        : !fitsTier(it.tier ?? null, ceiling, ladder) ? `re-tiered ${it.tier ?? 'untiered'}` : null;
      if (!why) continue;
      // R-BTN-85: a ticket closed, gone or at a status git ends it with, while a claim is active on
      // it — not the holder's own `done` (no disagreement), nor a re-tier (no closure) — is logged
      // before git wins.
      if (!it || GIT_ENDS.has(it.status)) {
        this.c.history.discrepancy(c.ticket_id, 'closed-under-claim', { claim_id: c.id, status: 'active', source: 'claim' },
          it ? { status: it.status } : { closed: closed ?? 'gone' }, observation, c.id);
      }
      this.finish(c.id, c.ticket_id, 'released', 'released:stale-board', 'sync', {});
      if (c.kind !== 'legacy') {
        this.exec(`INSERT INTO messages (kind, payload_json, from_principal, to_runner_id, sent_at, status) VALUES ('release', ?, 'sync', ?, ?, 'pending')`,
          JSON.stringify({ ticket_id: c.ticket_id, reason: 'stale-board', why }), c.runner_id, this.c.now());
      }
      n++;
    }
    return n;
  }

  // ── the alarm's share (§6.6, §7.1, §9) ──────────────────────────────────────────────────

  // @model alarmReap sha256:b00b4e304089
  // @model fenceTimeout sha256:28b54860fbba
  alarm(): string[] {
    const now = this.c.now();
    // B-229 (R-BTN-9): each reap is its own savepoint, and one that throws is named and passed
    // over, never the tick's end — a single claim whose end cannot be written would otherwise
    // roll back every reap of every tick after it (found live: twelve claims whose leases ended
    // between 2026-10-30 and 2026-11-06 were still held on 2026-11-10). The caller commits the
    // reaps that went through and then reports the ones that did not.
    const failed: string[] = [];
    const each = (claimId: number, ticketId: string, fn: () => void) => {
      try {
        this.c.store.transaction(fn);
      } catch (e) {
        failed.push(`claim ${claimId} on ${ticketId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    this.releaseBarHolders(now);
    // R-BTN-90 (B-234): a claim whose armed deadline passed is told to stop — a `release` with
    // reason `leg-timeout`, logged — and the runner's end of it (`released:leg-timeout`) is the
    // failed attempt §6.10 counts. A claim whose deadline moved on (a newer advance re-armed it)
    // is not due here; the alarm arms at the earliest standing instant.
    this.deadlineDue(now);
    // Silent runners: reaped at exactly their clamped timeout (R-BTN-9), never by Date.now().
    const silent = this.rows<{ id: number; ticket_id: string; runner_id: number; kind: string }>(
      `SELECT c.id, c.ticket_id, c.runner_id, w.kind FROM claims c JOIN runners w ON w.id = c.runner_id
       WHERE c.status = 'active' AND ((w.kind != 'legacy' AND ${expiredLeaseSql})
                                      OR (w.kind = 'legacy' AND c.reap_after IS NOT NULL AND c.reap_after <= ?))`, now, now);
    for (const c of silent) {
      each(c.id, c.ticket_id, () => {
        this.finish(c.id, c.ticket_id, 'reaped', c.kind === 'legacy' ? 'reaped:legacy' : 'reaped:silent', 'alarm', {});
        this.exec('UPDATE runners SET reaped_at = ? WHERE id = ? AND reaped_at IS NULL', now, c.runner_id);
      });
    }
    this.reapUnacknowledged(now, each);
    // A deadline fence cannot be shortened by silence or extended by another heartbeat.
    // Other reaps keep their existing clearance path until B-79.
    const lapsed = this.rows<{ id: number; ticket_id: string; runner_id: number; fence_deadline: number | null }>(
      `SELECT c.id, c.ticket_id, c.runner_id, c.fence_deadline FROM claims c JOIN runners w ON w.id = c.runner_id
       WHERE c.status = 'reaped' AND c.fence_pending = 1
         AND (c.fence_deadline <= ? OR (c.fence_deadline IS NULL AND ${expiredLeaseSql}))`, now, now);
    for (const c of lapsed) {
      this.exec('UPDATE claims SET fence_pending = 0 WHERE id = ?', c.id);
      this.exec('DELETE FROM claim_seats WHERE claim_id = ?', c.id);
      if (c.fence_deadline == null) this.exec('UPDATE runners SET reaped_at = ? WHERE id = ? AND reaped_at IS NULL', now, c.runner_id);
      this.event('fence-cleared', 'alarm', c.fence_deadline == null ? { by: 'timeout' } : { deadline: true }, c.ticket_id, c.id);
      this.c.blocks.held(c.ticket_id, false);
    }
    // §7.1: a held history is accepted automatically 24 h after its first post.
    for (const h of this.rows<{ repository_id: string; sha: string }>('SELECT repository_id, sha FROM held_snapshots WHERE accepted_at IS NULL AND auto_accept_at <= ?', now)) {
      this.exec('UPDATE held_snapshots SET accepted_at = ? WHERE repository_id = ? AND sha = ?', now, h.repository_id, h.sha);
      this.event('snapshot-accepted', 'alarm', { sha: h.sha, held: true, by: 'auto-accept' }, null, null, h.repository_id);
    }
    return failed;
  }

  /** §9.5: give an unacknowledged leg-timeout priority over a general release for the same claim. */
  // @model timeoutReap sha256:0d7f933299bf
  private reapUnacknowledged(now: number, each: (claimId: number, ticketId: string, fn: () => void) => void) {
    const stale = this.rows<{ id: number; ticket_id: string; runner_id: number; incarnation: number; lease_timeout_ms: number; timeout: number }>(
      `SELECT c.id, c.ticket_id, c.runner_id, w.incarnation, w.lease_timeout_ms,
              COALESCE(json_extract(m.payload_json, '$.reason') = 'leg-timeout', 0) AS timeout FROM messages m
       JOIN claims c ON c.runner_id = m.to_runner_id AND c.status = 'active' AND c.ticket_id = json_extract(m.payload_json, '$.ticket_id')
       JOIN runners w ON w.id = c.runner_id
       WHERE m.kind = 'release' AND m.status = 'delivered' AND m.delivered_at <= ?
         AND (timeout = 1 OR m.delivered_at <= ?) ORDER BY timeout DESC, m.id`, now - LEG_TIMEOUT_ACK_MS, now - RELEASE_ACK_MS);
    const seen = new Set<number>();
    for (const c of stale) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      each(c.id, c.ticket_id, () => {
        this.finish(c.id, c.ticket_id, 'reaped', c.timeout ? 'reaped:leg-timeout' : 'reaped:release-unacknowledged',
          c.timeout ? 'alarm:leg-timeout' : 'alarm', { fence: { incarnation: c.incarnation, ...(c.timeout ? { deadline: now + c.lease_timeout_ms } : {}) } });
        // None of this claim's releases may be delivered to a replacement claim on this runner.
        this.exec(`UPDATE messages SET status = 'expired' WHERE to_runner_id = ? AND kind = 'release'
                   AND status IN ('pending', 'delivered') AND json_extract(payload_json, '$.ticket_id') = ?`, c.runner_id, c.ticket_id);
      });
    }
  }

  /** R-BTN-67: when a bar with `release_holders` starts, every holder whose runner carries its tag
   *  and whose claim runs — or is about to run — a matching leg gets a `release` naming the bar's
   *  reason, once. */
  private releaseBarHolders(now: number) {
    for (const b of this.c.admin.bars(null, now).filter((x) => x.release_holders)) {
      if (this.rows('SELECT 1 FROM owner_bars WHERE id = ? AND holders_released_at IS NULL', b.id).length === 0) continue;
      const held = this.rows<{ id: number; ticket_id: string; runner_id: number; leg: string | null; course_id: string | null; next_leg: string | null }>(
        `SELECT c.id, c.ticket_id, c.runner_id, c.leg, c.course_id, s.next_leg FROM claims c
         JOIN runner_tags t ON t.runner_id = c.runner_id AND t.tag = ?
         LEFT JOIN ticket_stations s ON s.ticket_id = c.ticket_id
         WHERE c.status = 'active' AND substr(c.ticket_id, 1, length(?) + 1) = ? || ':'`, b.tag, b.repository_id, b.repository_id);
      for (const c of held) {
        if (b.course !== '*' && b.course !== c.course_id) continue;
        const g = c.course_id ? this.stations.graph(b.repository_id, c.course_id) : null;
        const leg = c.leg ?? c.next_leg;
        if (b.legs.length && !(leg && b.legs.some((l) => (g ? resolveLeg(g, l) ?? l : l) === leg))) continue;
        this.exec(`INSERT INTO messages (kind, payload_json, from_principal, to_runner_id, sent_at, status) VALUES ('release', ?, ?, ?, ?, 'pending')`,
          JSON.stringify({ ticket_id: c.ticket_id, reason: b.reason, bar: b.id }), `bar:${b.id}`, c.runner_id, now);
      }
      this.exec('UPDATE owner_bars SET holders_released_at = ? WHERE id = ?', now, b.id);
    }
  }

  // ── the dashboard (§14: Running, Timeline, Needs you) ───────────────────────────────────

  running(now: number) {
    const active = this.rows<Row & Lease & { kind: string }>(
      `SELECT c.id, c.ticket_id, c.runner_id, c.claimed_at, c.nonce, w.hostname, w.session_name, w.last_seen_at, w.last_activity_at,
              w.lease_timeout_ms, w.kind, wi.title,
              (SELECT l.leg FROM claim_legs l WHERE l.claim_id = c.id AND l.finished_at IS NULL AND l.abandoned_at IS NULL
                ORDER BY l.seq DESC LIMIT 1) AS leg,
              NULL AS session_url,
              EXISTS (SELECT 1 FROM claim_legs l WHERE l.claim_id = c.id AND l.finished_at IS NULL AND l.abandoned_at IS NULL AND l.session_url IS NOT NULL) AS has_session_link
       FROM claims c JOIN runners w ON w.id = c.runner_id LEFT JOIN tickets wi ON wi.id = c.ticket_id
       WHERE c.status = 'active' ORDER BY c.claimed_at`);
    // B-240: every active claim's events and activities in one query each, not two per claim —
    // each list in the order the per-claim read served it (events by `seq`; activities by
    // `started_at`, ties in `activities_by_claim`'s order, which is the rowid's).
    const ids = JSON.stringify(active.map((c) => c.id));
    const events = groupBy(this.forIds(ids,
      `SELECT claim_id, at, kind, actor, detail_json FROM events WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY claim_id, seq`, ids));
    const activities = groupBy(this.forIds(ids,
      `SELECT claim_id, id, kind, label, started_at, ended_at, outcome, parent_id FROM activities
       WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY claim_id, started_at, rowid`, ids));
    return active.map(({ has_session_link, ...c }) => {
      const alive = isClaimLeaseLive(c, now);
      return {
        ...c,
        session_link: !!has_session_link,
        alive,
        reap_at: c.kind === 'legacy' ? null : leaseEndsAt(c),
        stalled: alive && (c.last_activity_at == null ? now - (c.claimed_at as number) : now - (c.last_activity_at as number)) > STALLED_MS,
        events: events.get(c.id as number) ?? [],
        activities: activities.get(c.id as number) ?? [],
      };
    });
  }

  /** One lane per alive runner over the last 24 h: its claims as bars, their leg runs and their
   *  activities. B-240: five queries whatever the lanes, claims and activities — the lanes, their
   *  claims in the window, those claims' leg runs, activities and transcripts — not one per lane,
   *  per claim and per activity; every list keeps the order the per-row reads served. */
  timeline(now: number) {
    const from = now - 24 * 3_600_000;
    // The live set through `runners_live` (0052), the few rows sorted by name — never the
    // name-ordered `runners_by_hostname` (0063), whose walk the planner would otherwise take
    // to escape the sort and read every runner ever registered (B-250 kept that bound).
    const lanes = this.rows<{ id: number; hostname: string; session_name: string }>(
      `SELECT id, hostname, session_name FROM runners INDEXED BY runners_live WHERE ${liveRunnerSql()} ORDER BY hostname, id`, now);
    // The window's claims (`claims_by_ended`, B-240: the active ones and those ended since
    // `from`), by `claimed_at`, ties by id.
    const laneIds = JSON.stringify(lanes.map((l) => l.id));
    const claims = groupBy(this.forIds(laneIds,
      `SELECT runner_id, id, ticket_id, claimed_at, ended_at, status, end_reason FROM claims
       WHERE (ended_at IS NULL OR ended_at >= ?) AND runner_id IN (SELECT value FROM json_each(?))
       ORDER BY runner_id, claimed_at, id`, from, laneIds), 'runner_id');
    const ids = JSON.stringify([...claims.values()].flat().map((c) => c.id));
    const runs = groupBy(this.forIds(ids,
      `SELECT claim_id, leg, started_at, finished_at, abandoned_at, session_url IS NOT NULL AS has_session_link FROM claim_legs
       WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY claim_id, seq`, ids));
    const activities = groupBy(this.forIds(ids,
      `SELECT claim_id, id, kind, seq, label, started_at, ended_at, outcome, parent_id, detail_json FROM activities
       WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY claim_id, started_at, rowid`, ids));
    // §6.8: a link built only from validated parts — the activity's own transcript, else the
    // session's; of several, the first stored (lowest id).
    const own = new Map<string, { repo: string; path: string }>();
    const session = new Map<number, { repo: string; path: string }>();
    for (const t of this.forIds<{ claim_id: number; activity_id: string | null; repo: string; path: string }>(ids,
      `SELECT claim_id, activity_id, repo, path FROM transcripts WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY id`, ids)) {
      if (t.activity_id == null) {
        if (!session.has(t.claim_id)) session.set(t.claim_id, t);
      } else {
        const k = `${t.claim_id}\u0000${t.activity_id}`;
        if (!own.has(k)) own.set(k, t);
      }
    }
    return {
      from,
      to: now,
      lanes: lanes.map((l) => ({
        ...l,
        claims: (claims.get(l.id) ?? []).map((c) => ({
          ...c,
          runs: (runs.get(c.id) ?? []).map((r) => ({ leg: r.leg, started_at: r.started_at, ended_at: r.finished_at ?? r.abandoned_at ?? null, session_url: null, session_link: !!r.has_session_link })),
          activities: (activities.get(c.id) ?? []).map((a) => {
            const t = own.get(`${c.id}\u0000${a.id}`) ?? session.get(c.id as number);
            return { ...a, transcript_url: t ? transcriptUrl(t.repo, t.path) : null };
          }),
        })),
      })),
    };
  }

  needsYou(now: number) {
    return {
      // §6.7: never auto-confirmed; the owner resolves it.
      unconfirmed: this.rows(`SELECT id, ticket_id, runner_id, ended_at, end_reason, ended_at_sha FROM claims
                              WHERE status = 'completed' AND confirmed_at IS NULL AND ended_at <= ? ORDER BY ended_at`, now - UNCONFIRMED_FLAG_MS),
      unacknowledged_releases: this.rows(`SELECT id, to_runner_id, payload_json, sent_at, delivered_at FROM messages
                                          WHERE kind = 'release' AND status IN ('pending','delivered') ORDER BY sent_at`),
      fence_pending: this.rows(`SELECT c.id, c.ticket_id, c.runner_id, c.ended_at, w.hostname, w.session_name, w.last_seen_at,
                                       w.lease_timeout_ms, w.isolation
                                FROM claims c JOIN runners w ON w.id = c.runner_id
                                WHERE c.status = 'reaped' AND c.fence_pending = 1 ORDER BY c.ended_at`),
      // R-BTN-22: live runners declaring a course below its min_runner_version, one row per
      // course, and those declaring none (course_id null) — each needs a restart from a pulled
      // checkout.
      stale_skills: this.rows(`SELECT w.id, w.hostname, w.session_name, f.repository_id, f.course_id, f.version, k.min_runner_version
                               FROM runners w JOIN runner_courses f ON f.runner_id = w.id
                               JOIN courses k ON k.repository_id = f.repository_id AND k.id = f.course_id
                               WHERE ${liveDeclaringRunnerSql} AND f.version < k.min_runner_version
                               UNION ALL
                               SELECT w.id, w.hostname, w.session_name, NULL, NULL, NULL, NULL FROM runners w
                               WHERE ${liveDeclaringRunnerSql}
                                 AND NOT EXISTS (SELECT 1 FROM runner_courses f WHERE f.runner_id = w.id) AND EXISTS (SELECT 1 FROM courses)
                               ORDER BY 1, 4, 5`, now, now),
      // §2e: a claim git has shown going backwards for 30 minutes.
      regressed: this.rows(`SELECT c.id, c.ticket_id, c.runner_id, c.regressed_since, s.path FROM claims c LEFT JOIN ticket_stations s ON s.ticket_id = c.ticket_id
                            WHERE c.status = 'active' AND c.regressed_since IS NOT NULL AND c.regressed_since <= ? ORDER BY c.regressed_since`, now - REGRESSED_FLAG_MS),
      // R-BTN-67: a leg an owner's required bar covers that the sync posts without the prefix.
      policy: this.rows(`SELECT n.ticket_id, n.leg, n.waiting_since FROM ticket_next_legs n WHERE n.state = 'waiting' AND n.waiting_on = 'policy' ORDER BY n.ticket_id, n.leg`),
      // R-BTN-63: the holder and the sync read a leg's bars differently; the sync's reading binds.
      // By `at`, then `seq`: `events_by_kind_at`'s order (B-235), so the window reads only its rows.
      bars_mismatch: this.rows(`SELECT e.claim_id, e.ticket_id, e.at, e.detail_json FROM events e WHERE e.kind = 'bars-mismatch' AND e.at > ? ORDER BY e.at, e.seq`, now - BARS_MISMATCH_LISTED_MS),
      held_items: this.rows<{ ticket_id: string; hold_reason: string | null; set_at: number }>(
        `SELECT ticket_id, hold_reason, set_at FROM ticket_overrides WHERE hold = 1 ORDER BY ticket_id`).map((h) => ({
        ...h,
        attempts: this.rows(`SELECT id, end_reason, ended_at, resume_json FROM claims WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`,
          JSON.stringify(this.failedAttempts(h.ticket_id))),
      })),
    };
  }
}
