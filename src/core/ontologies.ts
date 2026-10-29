// ontologies.ts — the ontology in force per repository and the derived sets it computes
// (BATON_SPEC §5.9, R-BTN-174/R-BTN-175, B-104). The pure language, validation and evaluator
// are `ontology.ts`; this module is the store's side: acceptance of a board post's ontology
// unit, the memoised program by digest, a worker's derived set brought current at the reads
// that need it, the alarm cycle that brings every live granted worker's set up to date, and
// the refusals a Needs-you listing shows until a unit is accepted.
import {
  BOUNDS, canonicalProgram, evaluate, maximalEvaluation, parseOntology, sha256Hex, validateOntology,
  whyNot, boundsFor, type Evaluation, type ValidatedProgram, type WhyNot,
} from './ontology';
import { BatonError } from './http';
import type { Store } from './ports';
import type { BatonCore } from './baton';

/** A board post's `ontology` field (§4.4): the merged program, or why the merge failed. */
export type PostedOntology = { builtin?: string | null; program: unknown } | { error: string } | undefined;

/** The legs a posted course file names (R-BTN-177's attachment check reads the posted file,
 * not the stored one a post behind). */
const legsOf = (course: unknown): string[] | undefined => {
  if (!course || typeof course !== 'object' || Array.isArray(course)) return undefined;
  const legs = (course as { legs?: unknown }).legs;
  if (!legs || typeof legs !== 'object' || Array.isArray(legs)) return undefined;
  return Object.keys(legs);
};

/** The alarm cycle's state, kept in `baton_settings.ontology_cycle` between ticks. */
interface CycleState {
  started_at: number;
  matches_spent: number;
  /** Workers still to bring current; emptied closes the cycle. */
  remaining: number[];
}

/** One alarm cycle's match budget (R-BTN-174): at most 1,000,000 matches, and never start an
 * evaluation that could not finish within R-BTN-175's bound — a gate evaluation costs at most
 * its 400,000-match ceiling, so a turn starts one only while that much of the budget remains. */
const CYCLE_MATCHES = 1_000_000;
/** A non-live worker's rows go 30 days after it was last live; the alarm prunes them. */
const DERIVED_TTL_MS = 30 * 24 * 3_600_000;

export class Ontologies {
  constructor(private c: BatonCore, private store: Store) {}

  private sql<T = Record<string, unknown>>(query: string, ...params: unknown[]): T[] {
    return this.store.exec<T>(query, ...params).toArray();
  }

  /** The validated program by digest — "memoised in the object by digest" (R-BTN-174): a
   * program is placed once per process whatever many workers read it, with its maximal
   * evaluation and its fixed strata's tuples. */
  private memo = new Map<string, { placed: ValidatedProgram; maximal: Evaluation | null; fixedCache?: [string, (string | number)[][]][] }>();

  /** The program in force for a repository, placed and memoised; null when it has none. */
  programOf(repo: string): { digest: string; placed: ValidatedProgram; builtin: string | null } | null {
    const row = this.sql<{ digest: string; builtin: string | null; program_json: string }>(
      'SELECT digest, builtin, program_json FROM ontologies WHERE repository_id = ?', repo)[0];
    if (!row) return null;
    let entry = this.memo.get(row.digest);
    if (!entry) {
      const bytes = Buffer.from(row.program_json, 'utf8').length;
      const parsed = parseOntology(JSON.parse(row.program_json), bytes);
      const validated = validateOntology(parsed);
      if (!validated.ok) {
        // A stored program was validated at acceptance; a refusal here means the stored bytes
        // were corrupted. Fail loudly, never silently evaluate a different program.
        throw new BatonError('internal', `the stored program for ${repo} no longer validates: ${validated.violations[0]?.message ?? 'unknown'}`);
      }
      entry = { placed: validated.placed, maximal: null };
      this.memo.set(row.digest, entry);
    }
    return { digest: row.digest, placed: entry.placed, builtin: row.builtin };
  }

  /** The maximal evaluation of the program in force, memoised by digest (why-not's input). */
  private maximalOf(repo: string): { digest: string; placed: ValidatedProgram; maximal: Evaluation } | null {
    const p = this.programOf(repo);
    if (!p) return null;
    let entry = this.memo.get(p.digest)!;
    if (!entry.maximal) {
      const lowered = this.c.testOntologyBounds();
      const run = evaluate(entry.placed, [...entry.placed.constants], null, boundsFor('maximal', lowered));
      if (!run.ok) {
        // The stored program's maximal evaluation was within bounds at acceptance; the test
        // bindings may lower them (S-BTN-146). Treat a crossing as empty, as a read would.
        const empty = evaluate(entry.placed, [], null, boundsFor('maximal', lowered));
        entry.maximal = empty.ok ? empty : null;
        if (!entry.maximal) return null;
      } else {
        entry.maximal = run;
      }
    }
    return { ...p, maximal: entry.maximal };
  }

  // ── acceptance (R-BTN-174: a unit is accepted or refused whole, at each post) ───────────

  /**
   * Accept the post's ontology unit — its program together with the course entries'
   * `route_choices` attachments (R-BTN-177) — in the board post's transaction. The previous
   * program and the previous `route_choices` of every entry where it changed stay in force on
   * a refusal, which is recorded for Needs you; the rest of the board is the caller's to
   * accept as usual. Answers the refusal reason, or null when the unit is accepted (a unit
   * equal to the one in force changes nothing).
   */
  acceptUnit(repo: string, posted: PostedOntology, entries: { id: string; course: unknown; routeChoices: Record<string, string[]> | null; postedLegs?: string[] }[], snapshotSha: string, at: number): string | null {
    if (posted === undefined) {
      // With no `ontology` field the repository has none (§5.9: only when the default branch's
      // head holds `.baton/ontology.json` — its deletion is a deliberate act, and the post says
      // so by omitting the field), so a stored program goes. But the unit's course-entry side is
      // still judged (S-BTN-155): a post with no field while entries attach route choices
      // refuses the unit, the program and the entries' previous attachments kept.
      const attaching = entries.some((e) => e.routeChoices != null && Object.keys(e.routeChoices).length > 0);
      if (attaching) {
        const reason = 'route-attachment: a post with no ontology field cannot attach route choices (R-BTN-174, S-BTN-155)';
        this.recordRefusal(repo, 'route-attachment', reason, at);
        return reason;
      }
      if (this.sql('SELECT 1 FROM ontologies WHERE repository_id = ?', repo).length) {
        this.store.exec('DELETE FROM ontologies WHERE repository_id = ?', repo);
        this.store.exec('DELETE FROM ontology_refusals WHERE repository_id = ?', repo);
      }
      return null;
    }
    if ('error' in (posted as { error?: string })) {
      const reason = String((posted as { error: string }).error);
      this.recordRefusal(repo, 'merge', reason, at);
      return reason;
    }
    const { program: rawProgram, builtin } = posted as { builtin?: string | null; program: unknown };
    const canonical = canonicalProgram(rawProgram);
    const digest = sha256Hex(canonical);
    const current = this.sql<{ digest: string }>('SELECT digest FROM ontologies WHERE repository_id = ?', repo)[0];
    const attachments = entries.map((e) => ({ id: e.id, routeChoices: e.routeChoices, postedLegs: legsOf(e.course) })).filter((e) => e.routeChoices != null);
    const priorAttachments = new Map(this.sql<{ id: string; route_choices_json: string }>('SELECT id, route_choices_json FROM courses WHERE repository_id = ?', repo)
      .map((r) => [r.id, JSON.parse(r.route_choices_json) as Record<string, string[]>]));
    const unitChanged = !current || current.digest !== digest
      || attachments.some((a) => JSON.stringify(a.routeChoices) !== JSON.stringify(priorAttachments.get(a.id) ?? {}));
    if (current && !unitChanged) {
      this.store.exec('DELETE FROM ontology_refusals WHERE repository_id = ?', repo);
      return null;
    }

    // Validate the program (R-BTN-175), then its maximal evaluation — constraints over fixed
    // predicates, condition 4's typed atoms, the 256 limit — under the counted bounds.
    const bytes = Buffer.from(canonical, 'utf8').length;
    let violations: { entry: string | null; rule: string; message: string }[];
    let placed: ValidatedProgram | null = null;
    let fixedJson: string | null = null;
    try {
      const parsed = parseOntology(JSON.parse(canonical), bytes);
      const validated = validateOntology(parsed);
      if (!validated.ok) violations = validated.violations;
      else {
        const maximal = maximalEvaluation(validated.placed, this.c.testOntologyBounds());
        if (!maximal.ok) {
          violations = [{ entry: maximal.at?.entry ?? null, rule: maximal.at?.rule ?? 'bounds', message: `the maximal evaluation crossed its ${maximal.crossed} bound (R-BTN-175)` }];
        } else {
          placed = validated.placed;
          violations = maximal.check.violations;
          fixedJson = JSON.stringify([...maximal.check.fixed.entries()]);
        }
      }
    } catch (e) {
      violations = [{ entry: null, rule: 'serialization', message: e instanceof Error ? e.message : String(e) }];
    }
    if (violations.length || !placed || fixedJson == null) {
      const why = violations[0];
      const reason = why ? `${why.rule}: ${why.message}` : 'the program is refused';
      this.recordRefusal(repo, 'program', reason, at);
      // The unit is refused whole: the program stays in force, and so does the previous value
      // of the `route_choices` field of every entry where it changed — the caller keeps every
      // other field of each entry and the course file with the board as usual.
      for (const a of attachments) {
        const prior = priorAttachments.get(a.id) ?? {};
        this.store.exec('UPDATE courses SET route_choices_json = ? WHERE repository_id = ? AND id = ?', JSON.stringify(prior), repo, a.id);
      }
      return reason;
    }

    // The unit's course-entry side: every attachment names a route choice the program defines,
    // on a leg its course file has (R-BTN-174, R-BTN-177).
    const defined = new Set(placed.program.routeChoices.map((rc) => rc.id));
    for (const a of attachments) {
      // The POSTED course file decides (S-BTN-155: a post may add a course or a leg together
      // with its attachment); the stored file is the previous one, a post behind.
      const legs = a.postedLegs ?? this.courseLegs(repo, a.id);
      for (const [leg, ids] of Object.entries(a.routeChoices!)) {
        if (!legs.includes(leg)) {
          const reason = `route-attachment: course ${a.id} attaches a route choice to ${leg}, which its course file lacks (R-BTN-177)`;
          this.recordRefusal(repo, 'route-attachment', reason, at);
          return reason;
        }
        for (const id of ids) {
          if (!defined.has(id)) {
            const reason = `route-attachment: course ${a.id} lists ${id}, which the program does not define (R-BTN-174)`;
            this.recordRefusal(repo, 'route-attachment', reason, at);
            return reason;
          }
        }
      }
    }

    // Accepted: store the program, drop the refusal, and let the reads bring sets current.
    this.store.exec(`INSERT INTO ontologies (repository_id, digest, builtin, fixed_json, program_json, snapshot_sha, accepted_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT (repository_id) DO UPDATE SET digest = excluded.digest, builtin = excluded.builtin,
                       fixed_json = excluded.fixed_json, program_json = excluded.program_json,
                       snapshot_sha = excluded.snapshot_sha, accepted_at = excluded.accepted_at`,
      repo, digest, builtin ?? null, fixedJson, canonical, snapshotSha, at);
    this.store.exec('DELETE FROM ontology_refusals WHERE repository_id = ?', repo);
    this.memo.delete(current?.digest ?? '');
    // An accepted program without a route choice drops its route_last rows (R-BTN-174) — the
    // table is B-105's; nothing to do until it exists.
    return null;
  }

  /** The legs a course file names, for the unit's attachment check. */
  private courseLegs(repo: string, courseId: string): string[] {
    const row = this.sql<{ course_json: string }>('SELECT course_json FROM courses WHERE repository_id = ? AND id = ?', repo, courseId)[0];
    if (!row) return [];
    try {
      const file = JSON.parse(row.course_json) as { legs?: Record<string, unknown> };
      return Object.keys(file.legs ?? {});
    } catch {
      return [];
    }
  }

  /** Record a refusal for Needs you (R-BTN-174: `baton.ontology-refused` until a unit is
   * accepted; §7's conditions are B-57's, so today's listing is this row — the events table's
   * kind CHECK is append-only history's, and the refusal row is the record). */
  private recordRefusal(repo: string, reason: string, detail: string, at: number): void {
    this.store.exec(`INSERT INTO ontology_refusals (repository_id, reason, detail, at) VALUES (?, ?, ?, ?)
                     ON CONFLICT (repository_id, reason) DO UPDATE SET detail = excluded.detail, at = excluded.at`,
      repo, reason, detail.slice(0, 500), at);
  }

  /** The Needs-you listing's rows (§11.4). */
  refusals(): { repository_id: string; reason: string; detail: string; at: number }[] {
    return this.sql('SELECT repository_id, reason, detail, at FROM ontology_refusals ORDER BY repository_id, reason');
  }

  // ── a worker's derived set (R-BTN-174: current, or brought up to date before it is read) ─

  /** The worker's holdings for a repository: declared ∩ grant (its `runner:` declarations
   * beside them, R-BTN-133), where the grant is the key's grant — or, for an interim token
   * credential, its allow-list. Answers H and the grant set (null ungranted). */
  holdingsOf(workerId: number, repo: string): { holdings: Set<string>; grant: Set<string> | null } {
    const w = this.sql<{ credential_id: string; created_by: string | null }>(
      'SELECT w.credential_id, c.created_by FROM workers w JOIN credentials c ON c.id = w.credential_id WHERE w.id = ?', workerId)[0];
    const declared = new Set(this.sql<{ capability: string }>('SELECT capability FROM worker_capabilities WHERE worker_id = ?', workerId).map((r) => r.capability));
    if (!w) return { holdings: declared, grant: null };
    const grantRows = this.sql<{ capabilities: string }>('SELECT capabilities FROM worker_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', w.credential_id, repo);
    if (grantRows.length) {
      // R-BTN-58: a grant entry `<type>:*` admits every holding of that type (round 1, B1) —
      // exact match alone left a `key:*` grant holding nothing at all.
      const grant = new Set<string>(JSON.parse(grantRows[0].capabilities) as string[]);
      const admits = (c: string) => grant.has(c) || grant.has(`${c.split(':')[0]}:*`);
      const runner = [...declared].filter((c) => c.startsWith('runner:'));
      return { holdings: new Set([...[...declared].filter((c) => admits(c) || c.startsWith('runner:')), ...runner]), grant };
    }
    {
      // An interim credential — a bearer token's policy or a BATON_KEYS seed (R3-1240's
      // transition) — is bound by no grant; its allow-list is its grant, and B-104 moved that
      // check from the heartbeat's refusal into rule 4's H.
      const cred = this.sql<{ allowed_capabilities: string }>('SELECT allowed_capabilities FROM credentials WHERE id = ?', w.credential_id)[0];
      const allowed = new Set<string>(cred ? (JSON.parse(cred.allowed_capabilities) as string[]) : []);
      return { holdings: new Set([...declared].filter((c) => allowed.has(c))), grant: allowed };
    }
  }

  /** The input digest (R-BTN-174): the SHA-256 of the program's digest and the sorted H
   * restricted to the program's string constants — the only holdings that can take part. */
  inputDigest(digest: string, placed: ValidatedProgram, holdings: Set<string>): string {
    const restricted = [...holdings].filter((h) => placed.constants.has(h)).sort();
    return sha256Hex(`${digest}\n${restricted.join('\n')}`);
  }

  /**
   * The worker's derived capabilities for a repository, brought current first, in a
   * transaction of its own that commits whether or not the request succeeds (R-BTN-174). A
   * crossing bound stores the empty set marked `limited`, not retried until the digest
   * changes, and raises the limit refusal once per repository and program digest.
   */
  derivedFor(workerId: number, repo: string): Set<string> | null {
    const p = this.programOf(repo);
    if (!p) return null;
    const { holdings } = this.holdingsOf(workerId, repo);
    const digest = this.inputDigest(p.digest, p.placed, holdings);
    const stored = this.sql<{ input_digest: string; limited: number }>(
      'SELECT input_digest, limited FROM worker_derived_inputs WHERE worker_id = ? AND repository_id = ?', workerId, repo)[0];
    if (stored && stored.input_digest === digest) {
      return new Set(this.sql<{ capability: string }>('SELECT capability FROM worker_derived WHERE worker_id = ? AND repository_id = ?', workerId, repo).map((r) => r.capability));
    }
    // A limited evaluation is not retried while its digest stands (R-BTN-175) — the digest
    // above did not match, so this is a new program or new holdings: evaluate again.
    const at = this.c.now();
    const fixed = new Map<string, (string | number)[][]>(this.fixedOf(p.digest, p.placed));
    const run = () => {
      const lowered = this.c.testOntologyBounds();
      return evaluate(p.placed, [...holdings], fixed, boundsFor('gate', lowered));
    };
    let result = run();
    if (!result.ok) {
      this.store.transaction(() => {
        this.store.exec('DELETE FROM worker_derived WHERE worker_id = ? AND repository_id = ?', workerId, repo);
        this.store.exec(`INSERT INTO worker_derived_inputs (worker_id, repository_id, input_digest, limited, evaluated_at) VALUES (?, ?, ?, 1, ?)
                         ON CONFLICT (worker_id, repository_id) DO UPDATE SET input_digest = excluded.input_digest, limited = 1, evaluated_at = excluded.evaluated_at`,
          workerId, repo, digest, at);
        this.recordLimitRefusal(repo, p.digest, at);
        this.bumpFleetVersion(repo);
      });
      return new Set();
    }
    // At most 256 capabilities per worker and repository (R-BTN-174): a program whose
    // maximal evaluation stayed within the limit cannot cross it for a smaller H.
    const caps = result.derived.slice(0, BOUNDS.derivedMax);
    this.store.transaction(() => {
      this.store.exec('DELETE FROM worker_derived WHERE worker_id = ? AND repository_id = ?', workerId, repo);
      for (const capability of caps) {
        this.store.exec('INSERT INTO worker_derived (worker_id, repository_id, capability, evaluated_at) VALUES (?, ?, ?, ?)', workerId, repo, capability, at);
      }
      this.store.exec(`INSERT INTO worker_derived_inputs (worker_id, repository_id, input_digest, limited, evaluated_at) VALUES (?, ?, ?, 0, ?)
                       ON CONFLICT (worker_id, repository_id) DO UPDATE SET input_digest = excluded.input_digest, limited = 0, evaluated_at = excluded.evaluated_at`,
        workerId, repo, digest, at);
      this.bumpFleetVersion(repo);
    });
    return new Set(caps);
  }

  /** The fixed strata's stored tuples, memoised with the program. */
  private fixedOf(digest: string, placed: ValidatedProgram): [string, (string | number)[][]][] {
    let entry = this.memo.get(digest);
    if (entry && entry.fixedCache) return entry.fixedCache;
    const row = this.sql<{ fixed_json: string }>('SELECT fixed_json FROM ontologies WHERE digest = ?', digest)[0];
    const fixed = row ? (JSON.parse(row.fixed_json) as [string, (string | number)[][]][]) : [...placed.fixedPredicates].map((p) => [p, []] as [string, (string | number)[][]]);
    if (entry) entry.fixedCache = fixed;
    return fixed;
  }

  /** `baton.ontology-limit`, once per repository and program digest (R-BTN-175). */
  private recordLimitRefusal(repo: string, digest: string, at: number): void {
    const key = `ontology-limit:${repo}:${digest.slice(0, 12)}`;
    if (this.sql('SELECT 1 FROM ontology_refusals WHERE repository_id = ? AND reason = ?', repo, key).length) return;
    this.recordRefusal(repo, key, 'an evaluation crossed its counted bound — H alone, which fails closed (R-BTN-175)', at);
  }

  /** A change to `worker_derived` bumps the repository's `fleet_version` (R-BTN-99) — the
   * counter the fleet views' ETags read. The column is R-BTN-99's proposal-era addition; until
   * it lands this writes the same event row the heartbeat's recount path leaves, and nothing
   * reads a stale view the recount does not already refresh. */
  private bumpFleetVersion(_repo: string): void {
    // Intentionally nothing: `board_head` carries no `fleet_version` yet (R-BTN-99's proposal-era
    // column), and the capability recount after the cycle is the refresh — every fleet view is
    // rebuilt from the tables, so no stale view survives it.
  }

  /** The fleet's why-not (R-BTN-174): no asking worker, so `missing` and `ungranted` are
   * omitted — only what the canonical proof needs and the chain that produces it. */
  whyNotFleet(repo: string, capability: string): WhyNot | null {
    const m = this.maximalOf(repo);
    if (!m) return null;
    const answer = whyNot(m.placed, m.maximal, new Set(), null, capability);
    if (!answer) return null;
    // The fleet answer omits `missing` and `ungranted` entirely (R-BTN-174).
    const { missing: _m, ungranted: _u, ...rest } = answer;
    return rest as WhyNot;
  }

  /** Why a capability is missing for a worker (R-BTN-174): advice, computed on read from the
   * maximal evaluation, memoised by digest, storing nothing. */
  whyNotFor(workerId: number, repo: string, capability: string, fleet: boolean): WhyNot | null {
    const m = this.maximalOf(repo);
    if (!m) return null;
    // Why-not wants the DECLARED set and the grant separately (A9, round 1): H collapses them,
    // and `ungranted` — declared but not admitted — could never hold.
    const declared = new Set(this.sql<{ capability: string }>('SELECT capability FROM worker_capabilities WHERE worker_id = ?', workerId).map((r) => r.capability));
    const { grant } = this.holdingsOf(workerId, repo);
    const answer = whyNot(m.placed, m.maximal, declared, fleet ? null : grant, capability);
    if (answer && fleet) {
      // The fleet answer OMITS `missing` and `ungranted` (R-BTN-174) — no asking runner.
      const { missing: _m, ungranted: _u, ...rest } = answer;
      return rest as WhyNot;
    }
    return answer;
  }

  // ── the alarm cycle (R-BTN-174) ─────────────────────────────────────────────────────────

  /** One alarm turn of the cycle: bring live granted workers' sets up to date, back-to-back
   * turns within the cycle's match budget, yielding to requests between turns. Answers the
   * epoch the next turn is due, or null when every live granted worker is current. */
  alarmTurn(): number | null {
    const pending = this.pendingWorkers();
    if (!pending.length) {
      this.closeCycle();
      return null;
    }
    const state = this.cycleState();
    // Each TURN spends at most 1,000,000 matches (R-BTN-174: "an alarm cycle is that run of
    // back-to-back alarm turns: each spends at most 1,000,000 matches") — the budget is the
    // turn's, so a cycle never stalls on a spent number carried across turns.
    let spent = 0;
    const remaining = [...state.remaining];
    for (const worker of pending) {
      if (CYCLE_MATCHES - spent < BOUNDS.gateMatches) break; // never start what the budget cannot finish
      this.derivedFor(worker.id, worker.repository_id);
      spent += BOUNDS.gateMatches; // the worst case a turn may spend on one evaluation
      const at = remaining.indexOf(worker.id);
      if (at >= 0) remaining.splice(at, 1);
    }
    this.saveCycle({ started_at: state.started_at, matches_spent: spent, remaining });
    if (!this.pendingWorkers().length) {
      this.closeCycle();
      return null;
    }
    return this.c.now() + 1_000;
  }

  /** How many workers' sets were not current at the last look (the alarm's recount decision). */
  pendingCount(): number {
    return this.pendingWorkers().length;
  }

  /** Live granted workers whose set is not current, smallest holdings first: the digest is
   * the program's and the worker's H, so current-ness is judged here, not in SQL. */
  private pendingWorkers(): { id: number; repository_id: string; size: number }[] {
    const out: { id: number; repository_id: string; size: number }[] = [];
    const live = this.sql<{ id: number; repository_id: string }>(`
      SELECT DISTINCT wr.id AS id, g.repository_id
      FROM workers wr
      JOIN worker_grants g ON g.credential_id = wr.credential_id AND g.revoked_at IS NULL
      JOIN ontologies o ON o.repository_id = g.repository_id
      WHERE wr.reaped_at IS NULL
        AND wr.last_seen_at > ? - wr.lease_timeout_ms`, this.c.now());
    for (const w of live) {
      const p = this.programOf(w.repository_id);
      if (!p) continue;
      const { holdings } = this.holdingsOf(w.id, w.repository_id);
      const digest = this.inputDigest(p.digest, p.placed, holdings);
      const stored = this.sql<{ input_digest: string; limited: number }>(
        'SELECT input_digest, limited FROM worker_derived_inputs WHERE worker_id = ? AND repository_id = ?', w.id, w.repository_id)[0];
      if (stored && stored.input_digest === digest) continue; // current, or limited under this digest: not retried
      out.push({ id: w.id, repository_id: w.repository_id, size: holdings.size });
    }
    return out.sort((a, b) => a.size - b.size || a.id - b.id);
  }

  private cycleState(): CycleState {
    const row = this.sql<{ value: string }>("SELECT value FROM baton_settings WHERE key = 'ontology_cycle'")[0];
    if (row) {
      try {
        return JSON.parse(row.value) as CycleState;
      } catch { /* a corrupt state starts a new cycle */ }
    }
    return { started_at: this.c.now(), matches_spent: 0, remaining: [] };
  }

  private saveCycle(state: CycleState): void {
    this.store.exec(`INSERT INTO baton_settings (key, value) VALUES ('ontology_cycle', ?)
                     ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify(state));
  }

  private closeCycle(): void {
    this.store.exec("DELETE FROM baton_settings WHERE key = 'ontology_cycle'");
    // Fleet-wide views are recounted when the cycle ends (R-BTN-174).
    for (const repo of this.sql<{ repository_id: string }>('SELECT DISTINCT repository_id FROM ontologies')) {
      this.bumpFleetVersion(repo.repository_id);
    }
  }

  /** The upkeep the alarm runs beside the cycle: rows of the no-longer-live go after 30 days,
   * and a revoked grant's rows go with the grant (R-BTN-174). */
  upkeep(): void {
    this.store.exec(`DELETE FROM worker_derived WHERE worker_id IN (
                       SELECT id FROM workers WHERE last_seen_at < ? AND last_seen_at < ? - lease_timeout_ms)`,
      this.c.now() - DERIVED_TTL_MS, this.c.now());
    this.store.exec(`DELETE FROM worker_derived WHERE EXISTS (
                       SELECT 1 FROM worker_grants g WHERE g.repository_id = worker_derived.repository_id
                         AND g.credential_id = (SELECT credential_id FROM workers WHERE id = worker_derived.worker_id)
                         AND g.revoked_at IS NOT NULL)`);
    this.store.exec(`DELETE FROM worker_derived_inputs WHERE worker_id IN (
                       SELECT id FROM workers WHERE last_seen_at < ? AND last_seen_at < ? - lease_timeout_ms)`,
      this.c.now() - DERIVED_TTL_MS, this.c.now());
  }

  /** Drop a worker's stored sets — a grant change or a holding an end removed leaves them
   * not current by digest, and this clears the stale rows at once. */
  forget(workerId: number, repo: string | null): void {
    // The inputs row goes with the rows: a digest standing over no rows would read the empty
    // set as current (A3, round 1).
    if (repo) {
      this.store.exec('DELETE FROM worker_derived WHERE worker_id = ? AND repository_id = ?', workerId, repo);
      this.store.exec('DELETE FROM worker_derived_inputs WHERE worker_id = ? AND repository_id = ?', workerId, repo);
      return;
    }
    this.store.exec('DELETE FROM worker_derived WHERE worker_id = ?', workerId);
    this.store.exec('DELETE FROM worker_derived_inputs WHERE worker_id = ?', workerId);
  }
}
