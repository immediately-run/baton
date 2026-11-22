// conditions.ts — the raised conditions Baton holds (BATON_SPEC §7.1 R-BTN-160, §7.1 R-BTN-195,
// §7.3 R-BTN-163's list; B-234): the report a runner sends for each raise, the Needs-you and
// list reads a delivery runner polls, and the closes this slice owns — an open `interact` of
// a run closing `superseded` when the same run raises again, `closed` when its run ends, and
// a retired repository's still-open conditions closing with it (R-BTN-47, B-173).
// Everything runs inside the caller's transaction, as questions.ts does.
//
// Not built here, by design (B-234 is R-BTN-195's slice): handler tickets and bindings
// (R-BTN-161) — no `handler` is filed for any type, and a binding of `interact` is ignored
// —, the in-claim suspend wait and its restart (R-BTN-162), and an owner's resolve
// (R-BTN-163). A `suspend` raise is recorded and listed; nothing waits on it yet.
import { BatonError } from './http';
import { logEvent } from './db';
import { checkConditionReport, repositoryOf, type ConditionReport } from './validate';
import { dispositionOf, isCoreOnly, type ConditionDeclaration } from './conditionTypes';
import type { Graph } from './graph';
import type { History } from './history';
import type { Store } from './ports';

/** R-BTN-160: a claim holds at most 20 open conditions. */
export const OPEN_CONDITIONS_MAX = 20;
/** R-BTN-160: a ticket raises at most 200 conditions a day. */
export const DAILY_CONDITIONS_MAX = 200;
/** R-BTN-163: the list route pages 100 at a time. */
export const CONDITIONS_PAGE_MAX = 100;
const MISSING_NEXT = 'baton.missing-next';
const HOUR = 3_600_000;

export interface Ctx {
  store: Store;
  now: () => number;
  /** The course file's graph, as the registry holds it (Stations.graph, cached per post). */
  graph: (repo: string, course: string) => Graph | null;
  history?: History;
  /** R-BTN-92's link bases for a ticket: a `suspend` raise's `url` is kept only under one of
   *  them, as a question's is. */
  linkBases?: (ticketId: string) => string[];
}

/** One condition row, as the table holds it. */
interface ConditionRow {
  id: number;
  repository_id: string;
  ticket_id: string;
  run_id: string | null;
  leg: string | null;
  type: string;
  disposition: 'interrupt' | 'suspend' | 'notify';
  severity: string;
  url: string | null;
  restarts_json: string;
  default_restart: string | null;
  raised_at: number;
  outcome: string;
  reraised: number;
}

/** An entry of the Needs-you list and the conditions route. */
export interface ConditionEntry {
  condition_id: number;
  ticket_id: string;
  leg: string | null;
  run_id: string | null;
  type: string;
  disposition: string;
  severity: string;
  raised_at: number;
  url: string | null;
  restarts: Record<string, string> | null;
  default: string | null;
  detail?: { reraised: number };
}

export class Conditions {
  constructor(private readonly c: Ctx) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  /** R-BTN-83/R-BTN-163: settle the repository's missing-next notices in the snapshot transaction. */
  missingNext(repo: string, missing: ReadonlySet<string>, at: number): void {
    const open = new Set<string>();
    for (const row of this.rows<{ id: number; ticket_id: string }>(
      `SELECT id, ticket_id FROM conditions WHERE repository_id = ? AND type = ? AND outcome = 'open'`, repo, MISSING_NEXT)) {
      if (missing.has(row.ticket_id)) open.add(row.ticket_id);
      else this.exec(`UPDATE conditions SET outcome = 'closed', closed_at = ?, closed_how = 'cause-ended' WHERE id = ?`, at, row.id);
    }
    for (const ticket of missing) {
      if (open.has(ticket)) continue;
      const recent = this.rows<{ id: number }>(
        `SELECT id FROM conditions WHERE ticket_id = ? AND type = ? AND outcome = 'closed' AND closed_at >= ?
         ORDER BY closed_at DESC, id DESC LIMIT 1`, ticket, MISSING_NEXT, at - HOUR)[0];
      if (recent) {
        this.exec(`UPDATE conditions SET outcome = 'open', raised_at = ?, closed_at = NULL, closed_how = NULL, reraised = reraised + 1 WHERE id = ?`, at, recent.id);
      } else {
        this.exec(`INSERT INTO conditions (repository_id, ticket_id, type, disposition, raised_at) VALUES (?, ?, ?, 'notify', ?)`, repo, ticket, MISSING_NEXT, at);
      }
      logEvent(this.c.store, at, 'condition', 'baton', { ticket, type: MISSING_NEXT, disposition: 'notify' }, ticket, null, repo);
      this.c.history?.record(ticket, { kind: 'condition', detail: { type: MISSING_NEXT, disposition: 'notify' } });
    }
  }

  /**
   * `POST /v1/runner/claims/{id}/conditions` (R-BTN-160): the report a runner sends once its
   * channel check passed, holding filter fields only — never the subject or body, which stay
   * with the runner (R-BTN-33). The disposition is Baton's own, from the standard table and the
   * course's declarations, never the report's word; a `handler` is not read (none is filed,
   * R-BTN-161 being unbuilt). An `interact` (R-BTN-195) takes its `url` from the run's stored
   * session link and refuses the raise when none is stored; the open `interact` of the same run
   * closes `superseded` in this transaction, one open per run.
   */
  report(runnerId: number, claimId: number, body: unknown): { ok: true; condition_id: number; disposition: string } {
    const b: ConditionReport = checkConditionReport(body);
    const now = this.c.now();
    const c = this.rows<{ ticket_id: string; status: string; runner_id: number; course_id: string | null }>(
      'SELECT ticket_id, status, runner_id, course_id FROM claims WHERE id = ?', claimId)[0];
    if (!c || c.runner_id !== runnerId) throw new BatonError('claim-ended', 'no such claim of this runner');
    if (c.status !== 'active') throw new BatonError('claim-ended', `the claim already ended (${c.status})`);
    const repo = repositoryOf(c.ticket_id);
    // The raising run: the claim's running leg row, whose run id and session link the condition
    // hangs from. A raise with no run (before the first advance) has nothing to hang from.
    const run = this.rows<{ seq: number; run_id: string | null; leg: string; session_url: string | null }>(
      'SELECT seq, run_id, leg, session_url FROM claim_legs WHERE claim_id = ? AND finished_at IS NULL AND abandoned_at IS NULL ORDER BY seq DESC LIMIT 1', claimId)[0];
    if (!run?.run_id) throw new BatonError('invalid-params', 'the claim is running no leg: a condition is raised from a run');
    // R-BTN-160: Baton's own vocabulary decides the disposition — the standard table, else the
    // course's declaration at the registry's file; core reads no course meaning (R-BTN-50).
    if (isCoreOnly(b.type)) throw new BatonError('invalid-params', `${b.type} is core's alone: a leg raises no baton condition (R-BTN-160)`);
    const g = c.course_id ? this.c.graph(repo, c.course_id) : null;
    const declared: Map<string, ConditionDeclaration> = g?.conditionTypes ?? new Map();
    const disposition = dispositionOf(b.type, declared);
    if (disposition == null) throw new BatonError('invalid-params', `${b.type} is neither a standard type nor one the course declares (R-BTN-160)`);
    // R-BTN-160's two quotas, refused as one `quota`.
    const open = this.rows<{ n: number }>('SELECT COUNT(*) AS n FROM conditions WHERE claim_id = ? AND outcome = \'open\'', claimId)[0].n;
    if (open >= OPEN_CONDITIONS_MAX) throw new BatonError('quota', `the claim already holds ${open} open conditions (at most ${OPEN_CONDITIONS_MAX}, R-BTN-160)`);
    const today = this.rows<{ n: number }>('SELECT COUNT(*) AS n FROM conditions WHERE ticket_id = ? AND raised_at > ?', c.ticket_id, now - 86_400_000)[0].n;
    if (today >= DAILY_CONDITIONS_MAX) throw new BatonError('quota', `${c.ticket_id} raised ${today} conditions in the last day (at most ${DAILY_CONDITIONS_MAX}, R-BTN-160)`);
    // The url, by disposition: an `interact`'s is Baton's own — the session link the run
    // reported on a heartbeat and Baton kept (R-BTN-113, R-BTN-195), never the report's — and
    // the raise is refused without one; a `suspend`'s is where git holds the question, kept only
    // under R-BTN-92's link bases. Nothing else carries one.
    let url: string | null = null;
    if (b.type === 'interact' || b.type.startsWith('interact.')) {
      if (run.session_url == null) throw new BatonError('invalid-params', 'the run holds no session link: Baton cannot address an interaction request (R-BTN-113, R-BTN-195)');
      url = run.session_url;
      // One open `interact` per run: the raise that supersedes closes the open one here, in the
      // transaction that records the new one (R-BTN-195). The dots form the hierarchy
      // (R-BTN-160): an `interact.<subtype>` raise is an `interact`, so the predicate takes the
      // subtypes on both sides — a subtype raise supersedes the open one, and is superseded.
      this.exec(`UPDATE conditions SET outcome = 'superseded', closed_at = ?, closed_how = 'superseded'
                 WHERE run_id = ? AND (type = 'interact' OR type LIKE 'interact.%') AND outcome = 'open'`, now, run.run_id);
    } else if (disposition === 'suspend' && b.url != null) {
      url = (this.c.linkBases?.(c.ticket_id) ?? []).some((base) => b.url!.startsWith(base)) ? b.url : null;
    }
    const restarts = b.restarts ?? {};
    // R-BTN-160's closing table, this slice's rows: an unbound leg-raised `notify` (warning and
    // the like — no handler is filed, R-BTN-161 unbuilt) is only recorded, closing as it is
    // raised; so is an `interrupt` ("closes when it is raised") — its record is the history's,
    // and the retry policy routes what follows. An `interact` stays open — its run's end or a
    // new raise of the same run closes it — and a `suspend` waits for its handler (R-BTN-162
    // unbuilt: it records open, the debugger's floor, and nothing waits).
    const closesAtRaise = (disposition === 'notify' || disposition === 'interrupt') && b.type !== 'interact' && !b.type.startsWith('interact.');
    // The id before the insert: the caller wraps this in one transaction, so SQLite's
    // serialized writes make the read-then-insert atomic.
    const id = this.rows<{ n: number }>('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM conditions')[0].n;
    this.exec(`INSERT INTO conditions (id, repository_id, ticket_id, claim_id, run_id, leg, type, disposition, severity, url, restarts_json, default_restart, raised_at, outcome, closed_at, closed_how)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, repo, c.ticket_id, claimId, run.run_id, run.leg, b.type, disposition, b.severity, url, JSON.stringify(restarts), b.default ?? null, now,
      closesAtRaise ? 'recorded' : 'open', closesAtRaise ? now : null, closesAtRaise ? 'raised' : null);
    logEvent(this.c.store, now, 'condition', `runner:${runnerId}`,
      { ticket: c.ticket_id, leg: run.leg, run_id: run.run_id, type: b.type, disposition, ...(b.severity !== 'normal' ? { severity: b.severity } : {}), ...(url ? { url } : {}) },
      c.ticket_id, claimId, repo);
    this.c.history?.record(c.ticket_id, { kind: 'condition', claim_id: claimId, leg: run.leg, run_id: run.run_id, detail: { type: b.type, disposition, ...(b.severity !== 'normal' ? { severity: b.severity } : {}), ...(url ? { url } : {}) } });
    return { ok: true, condition_id: id, disposition };
  }

  /**
   * R-BTN-160's closing table, the one row of it this slice owns: an open `interact` closes
   * when its run ends — finished or given up, the claim's end included — called from the
   * transactions that end a run (the advance that finishes it, the claim's end). Nothing waits
   * on it, so nothing else must; the person's conversation in the session is the harness's own.
   */
  runEnded(claimId: number, runId: string): void {
    const now = this.c.now();
    const open = this.rows<{ id: number; ticket_id: string; repository_id: string }>(
      `SELECT id, ticket_id, repository_id FROM conditions WHERE claim_id = ? AND run_id = ? AND (type = 'interact' OR type LIKE 'interact.%') AND outcome = 'open'`, claimId, runId);
    if (!open.length) return;
    this.exec(`UPDATE conditions SET outcome = 'closed', closed_at = ?, closed_how = 'run-ended'
               WHERE claim_id = ? AND run_id = ? AND (type = 'interact' OR type LIKE 'interact.%') AND outcome = 'open'`, now, claimId, runId);
    for (const o of open) {
      logEvent(this.c.store, now, 'condition', 'baton', { ticket: o.ticket_id, condition: o.id, type: 'interact', closed: 'run-ended' }, o.ticket_id, claimId, o.repository_id);
    }
  }

  /** Every condition of one run that is still open — the hook's answer, for the caller's log. */
  openOfRun(runId: string): number {
    return this.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM conditions WHERE run_id = ? AND outcome = 'open'`, runId)[0].n;
  }

  /**
   * R-BTN-47 (B-173): a retired repository's still-open conditions close with it — the last
   * thing that could close them. The retirement's reaps have ended its claims first, so their
   * open `interact`s are closed already (`runEnded`); what is still open is a `suspend` above
   * all, which no run's end closes and nothing waits on yet (R-BTN-162 unbuilt) and would
   * otherwise sit on the Needs-you list forever. Called from the retiring transaction, after
   * the reaps.
   */
  retired(repository: string): void {
    const now = this.c.now();
    const open = this.rows<{ id: number; ticket_id: string; claim_id: number | null; type: string }>(
      `SELECT id, ticket_id, claim_id, type FROM conditions WHERE repository_id = ? AND outcome = 'open'`, repository);
    if (!open.length) return;
    this.exec(`UPDATE conditions SET outcome = 'closed', closed_at = ?, closed_how = 'retired'
               WHERE repository_id = ? AND outcome = 'open'`, now, repository);
    for (const o of open) {
      logEvent(this.c.store, now, 'condition', 'baton', { ticket: o.ticket_id, condition: o.id, type: o.type, closed: 'retired' }, o.ticket_id, o.claim_id, repository);
    }
  }

  // ── the reads (R-BTN-163: Needs you, and the list a delivery runner polls) ───────────────

  private entry(r: ConditionRow): ConditionEntry {
    let restarts: Record<string, string> | null = null;
    try {
      const parsed = JSON.parse(r.restarts_json) as Record<string, string>;
      if (Object.keys(parsed).length) restarts = parsed;
    } catch { /* an unreadable list is no list */ }
    return {
      condition_id: r.id, ticket_id: r.ticket_id, leg: r.leg, run_id: r.run_id, type: r.type,
      disposition: r.disposition, severity: r.severity, raised_at: r.raised_at, url: r.url,
      restarts, default: r.default_restart,
      ...(r.reraised ? { detail: { reraised: r.reraised } } : {}),
    };
  }

  /**
   * §14 Needs you (R-BTN-163): every open condition with no handler ticket — here, every open
   * condition, none being bound (R-BTN-161 unbuilt) — ordered by severity, then by age. An
   * `interact` entry carries the session link Baton set (R-BTN-195), a person asked into the
   * leg's session: `url` is where they join, and nothing the leg wrote is in the entry.
   */
  needsYou(): ConditionEntry[] {
    return this.rows<ConditionRow>(
      `SELECT id, repository_id, ticket_id, run_id, leg, type, disposition, severity, url, restarts_json, default_restart, raised_at, reraised
       FROM conditions WHERE outcome = 'open'
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, raised_at, id`,
    ).map((r) => this.entry(r));
  }

  /**
   * `GET /v1/repositories/{repository}/conditions` (R-BTN-163): every condition of the
   * repository, filtered by `open` (an open condition is one whose outcome is `open`), by
   * `type` prefix and by `ticket`, 100 per page with a cursor — the read a delivery runner
   * polls with `type=interact` (R-BTN-195), serving each entry once by its own record.
   */
  list(repo: string, q: { open?: boolean; type?: string; ticket?: string; cursor?: string }): { conditions: ConditionEntry[]; cursor: string | null } {
    const where: string[] = ['repository_id = ?'];
    const params: unknown[] = [repo];
    if (q.open) where.push(`outcome = 'open'`);
    if (q.type != null) {
      if (!/^[a-z][a-z0-9.-]*$/.test(q.type)) throw new BatonError('invalid-params', 'type: a condition type prefix');
      where.push('(type = ? OR type LIKE ?)');
      params.push(q.type, `${q.type}.%`);
    }
    if (q.ticket != null) {
      where.push('ticket_id = ?');
      params.push(repositoryOf(q.ticket) === repo ? q.ticket : `${repo}:${q.ticket}`);
    }
    let after = 0;
    if (q.cursor != null) {
      const n = Number(q.cursor);
      if (!Number.isInteger(n) || n < 0) throw new BatonError('invalid-params', 'cursor: the previous page\'s');
      after = n;
    }
    where.push('id > ?');
    params.push(after);
    const rows = this.rows<ConditionRow & { id: number }>(
      `SELECT id, repository_id, ticket_id, run_id, leg, type, disposition, severity, url, restarts_json, default_restart, raised_at, reraised
       FROM conditions WHERE ${where.join(' AND ')} ORDER BY id LIMIT ${CONDITIONS_PAGE_MAX + 1}`, ...params);
    const page = rows.slice(0, CONDITIONS_PAGE_MAX).map((r) => this.entry(r));
    return { conditions: page, cursor: rows.length > CONDITIONS_PAGE_MAX ? String(page[page.length - 1].condition_id) : null };
  }
}
