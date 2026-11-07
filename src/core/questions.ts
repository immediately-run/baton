// questions.ts — a person's leg and its question (BATON_SPEC §6.4 R-BTN-116; B-7). The one leg a
// runner may never take: the course file marks it `kind: "person"` with `asks`, rule `person`
// refuses every claim and advance, and the ticket waits in its queue until a person answers. The
// ticket source posts the leg's question with the ticket (§4.4); it is stored only while the
// ticket's queued leg is a person's, listed under Needs you with the leg's options. The answer is
// a `std:decision@1` — attested by the sync from the ticket's `answer:` where the policy's
// `inputs.answers` admits git, or written by an owner through `baton decision answer` — and is
// applied as the leg's arrival (R-BTN-39): the ticket moves to the outcome the option names, with
// `next_source: baton`. A person leg may carry `expires`, which the alarm applies itself at its
// instant (`question-expired`). Everything here runs inside the caller's transaction.
import { logEvent } from './db';
import { BatonError } from './http';
import { DECISION_TYPE_NAME, qualify } from './validate';
import { repositoryOf } from './registry';
import { resolveLeg, resolveStation, type Graph } from './graph';
import { HELD_CLAIMS_SQL } from './blocks';
import { validate, PATTERN_STEPS_MAX } from '../shared/schema.mjs';
import { stdSchema } from '../shared/std.mjs';
import type { PostedAttestation, PostedQuestion, PostedTicket } from './board';
import type { History } from './history';
import type { Store } from './ports';

/** The one attestation type this reads (R-BTN-116, R-BTN-191); the rest arrive with B-146/B-120
 *  and are recorded unapplied. */
export const DECISION_TYPE = DECISION_TYPE_NAME;

export interface Ctx {
  store: Store;
  now: () => number;
  /** The course file's graph, as the registry holds it (Stations.graph, cached per post). */
  graph: (repo: string, course: string) => Graph | null;
  history?: History;
  /** R-BTN-83, R-BTN-79: whatever moves a ticket calls this, so its leg-queue membership follows. */
  queued?: (ticketId: string) => void;
  /** R-BTN-75: a ticket whose queued leg changed has its blocks re-evaluated. */
  reevaluate?: (ticketId: string) => void;
  /** Rule 3's one definition of a held ticket (Blocks.isHeld); an arrival waits for the hold. */
  isHeld?: (ticketId: string) => boolean;
  /** R-BTN-92's link bases for a ticket (Blocks.ticketRepos): a question's `url` is kept only
   *  under one of them, as a decision's is. */
  linkBases?: (ticketId: string) => string[];
  /** §12.8 (R-BTN-187): whether an answer read from git counts — the policy's `inputs.answers`
   *  (R-BTN-116, R-BTN-191). Absent, `git` (the cooperative default). */
  answersFrom?: (repo: string) => 'git' | 'attestation';
  /** R-BTN-73: a move asks its repository for a sync, as an advance does. */
  dispatch?: (kind: 'sync', ticketId: string) => void;
}

/** A stored question row, as `ticket_questions` holds it. */
interface QuestionRow {
  question_id: string | null;
  leg: string;
  url: string | null;
  severity: string | null;
  options_json: string;
  posted_at: number;
  answered_at: number | null;
  answered_by: string | null;
  option: string | null;
  answered_ref: string | null;
  pending_leg: string | null;
  pending_option: string | null;
  pending_reached: string | null;
  pending_by: string | null;
  pending_ref: string | null;
  pending_at: number | null;
}

/** One option of a person leg's question: what the person chooses, and the outcome it names. */
export interface QuestionOption {
  id: string;
  reached: string;
}

/** B-133: the computed action of choosing the option that reaches `station`, from the course
 *  graph — where the ticket lands and what leaves there, each leg named as a person's or a
 *  runner's. The packet's words describe the choice; this is what Baton will do with it. */
function optionAction(g: Graph, station: string): string {
  const next = [...g.legs.entries()].filter(([, l]) => l.from.includes(station)).map(([name, l]) => `${name} (${l.person ? 'a person leg' : 'a runner leg'})`);
  const toEnd = g.toEnd.get(station) ?? 0;
  return `moves the ticket to ‘${station}’${next.length ? `, which queues ${next.join(', ')}` : toEnd ? ' — the course’s end' : ''}`;
}

/** A `std:decision@1` value as the library's schema shapes it (§5.5). */
export interface DecisionValue {
  id: string;
  leg: string;
  option: string;
  reached: string;
  ref?: string;
  answered_by?: string;
  commit?: string;
}

export class Questions {
  constructor(private readonly c: Ctx) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  // ── the question a snapshot posts (§4.4, R-BTN-116) ──────────────────────────────────────

  /**
   * Store the questions a snapshot posts with its tickets, and drop the ones it may not keep. A
   * question is stored only for a ticket the post places whose queued leg is a person's; any
   * other is dropped and logged `question-dropped`, once per distinct question id. A question
   * whose options name outcomes the leg does not offer is dropped the same way — the person
   * would be choosing stations the course cannot reach. A new question id is logged
   * `question-posted` (event and history row, R-BTN-81); the same id again is silent.
   */
  posted(repo: string, tickets: PostedTicket[], placed: Set<string>) {
    const now = this.c.now();
    for (const t of tickets) {
      if (t.question === undefined || t.question === null || !placed.has(t.id)) continue;
      const q = t.question;
      const id = qualify(repo, t.id);
      const where = this.where(id);
      const g = where ? this.c.graph(repo, where.course) : null;
      const leg = where?.station.next_leg != null && g ? resolveLeg(g, where.station.next_leg) : null;
      const def = leg != null ? g!.legs.get(leg) : undefined;
      if (!where || !g || !def?.person) {
        this.dropped(id, q.id, where?.station.next_leg ?? null);
        continue;
      }
      if ((q.options ?? []).some((o) => !def.to.includes(o.reached))) {
        this.dropped(id, q.id, leg, `an option names an outcome ${leg} does not offer`);
        continue;
      }
      const options = q.options ?? [];
      const url = q.url != null && (this.c.linkBases?.(id) ?? []).some((base) => q.url!.startsWith(base)) ? q.url : null;
      const have = this.rows<QuestionRow>('SELECT * FROM ticket_questions WHERE ticket_id = ?', id)[0] ?? null;
      // The upsert runs only while a person leg is queued, and a row it finds already answered
      // means the ask is a new one — a second person leg queued, or a bounded loop back to the
      // same leg (R-BTN-39): the replacement OPENS, carrying nothing of the previous answer
      // (an old answer's ref is still silent below, by its fact-arrival row). A pending answer
      // waits only for the question it was given: a new id's does.
      const fresh = have?.answered_at == null ? 1 : 0;
      const sameQuestion = have?.question_id === q.id ? 1 : 0;
      const keepAnswer = fresh, keepPending = fresh && sameQuestion;
      this.exec(
        `INSERT INTO ticket_questions (ticket_id, question_id, leg, url, severity, options_json, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ticket_id) DO UPDATE SET question_id = excluded.question_id, leg = excluded.leg, url = excluded.url,
           severity = excluded.severity, options_json = excluded.options_json, posted_at = excluded.posted_at,
           answered_at = CASE WHEN ? THEN ticket_questions.answered_at END,
           answered_by = CASE WHEN ? THEN ticket_questions.answered_by END,
           option = CASE WHEN ? THEN ticket_questions.option END,
           answered_ref = CASE WHEN ? THEN ticket_questions.answered_ref END,
           pending_leg = CASE WHEN ? THEN ticket_questions.pending_leg END,
           pending_option = CASE WHEN ? THEN ticket_questions.pending_option END,
           pending_reached = CASE WHEN ? THEN ticket_questions.pending_reached END,
           pending_by = CASE WHEN ? THEN ticket_questions.pending_by END,
           pending_ref = CASE WHEN ? THEN ticket_questions.pending_ref END,
           pending_at = CASE WHEN ? THEN ticket_questions.pending_at END`,
        id, q.id, leg, url, q.severity ?? null, JSON.stringify(options), now,
        keepAnswer, keepAnswer, keepAnswer, keepAnswer,
        keepPending, keepPending, keepPending, keepPending, keepPending, keepPending);
      // `question-posted` once per id: only a new one logs (§4.4).
      if (have?.question_id !== q.id) {
        logEvent(this.c.store, now, 'question-posted', 'sync', { ticket: id, question: q.id, leg, ...(options.length ? { options } : {}) }, id);
        this.c.history?.record(id, { kind: 'question-posted', leg, detail: { question: q.id, ...(url ? { url } : {}), ...(q.severity ? { severity: q.severity } : {}) } });
      }
    }
  }

  /** `question-dropped`, once per distinct question (the sync re-posts every quarter hour). */
  private dropped(id: string, question: string, queued: string | null, why?: string) {
    const last = this.rows<{ q: string | null }>(
      `SELECT json_extract(detail_json, '$.question') AS q FROM events WHERE ticket_id = ? AND kind = 'question-dropped' ORDER BY seq DESC LIMIT 1`, id)[0];
    if (last?.q === question) return;
    logEvent(this.c.store, this.c.now(), 'question-dropped', 'sync', { ticket: id, question, ...(queued != null ? { queued } : {}), ...(why ? { why } : {}) }, id);
  }

  // ── the answer (R-BTN-116, R-BTN-39) ─────────────────────────────────────────────────────

  /**
   * The attestations a sync posts (§4.4, R-BTN-191). Only `std:decision@1` is read: one whose
   * shape fails its schema, or whose option, `reached` or id disagrees with the question, is
   * dropped and logged `answer-invalid`; one Baton cannot apply — the leg not a person's or not
   * leaving Baton's station, the question already answered or expired, the policy refusing an
   * answer read from git — is an arrival recorded `arrival-unapplied` (R-BTN-39), raising
   * nothing; one that fails only because a claim holds the ticket defers (R-BTN-39), kept with
   * its ref for the hold's end. Any other type is recorded unapplied too: its reader arrives
   * with B-146 and B-120. An attestation whose `ref` repeats an applied answer's is silent
   * (R-BTN-39's idempotence — the same commit attested by two runs moves the ticket once).
   */
  attestations(repo: string, list: PostedAttestation[]) {
    for (const a of list) {
      const id = qualify(repo, a.ticket);
      if (a.type !== DECISION_TYPE) {
        this.unapplied(id, null, { type: a.type, why: 'a type Baton does not read yet (R-BTN-191)' });
        continue;
      }
      if (typeof a.ref !== 'string' || a.ref.length === 0) {
        this.invalid(id, { why: 'a sync attestation carries the commit the answer rode (ref, R-BTN-39)' });
        continue;
      }
      const schema = stdSchema(DECISION_TYPE)!;
      const faults = validate(a.value, DECISION_TYPE, () => schema, { steps: PATTERN_STEPS_MAX });
      if (faults.length) {
        this.invalid(id, { why: `the answer fails ${DECISION_TYPE}: ${faults.slice(0, 3).map((f) => `${f.path || '/'} ${f.message}`).join('; ')}` });
        continue;
      }
      this.apply(repo, id, a.value as DecisionValue, { by: 'sync', ref: a.ref });
    }
  }

  /**
   * `POST /v1/repositories/{repo}/attestations` with a `std:decision@1` — an owner's
   * `baton decision answer` (R-BTN-116, R-BTN-127): the option the person chose for the ticket's
   * queued person leg, with the id, leg, `reached` and `ref` the full attestation carries, each
   * optional and derived from the stored question and the ticket's position when absent. The same
   * checks the sync's attestation passes, refused `invalid-params` naming the first fault; applied
   * in the route's own transaction. A ticket a claim holds defers the answer (R-BTN-39), which
   * the alarm applies when the hold ends.
   */
  answer(repo: string, ticket: string, given: { id?: string; leg?: string; option: string; reached?: string; ref?: string }, actor: string): { ok: true; reached: string; option: string; deferred?: boolean } {
    if (typeof given.option !== 'string' || given.option.length === 0 || given.option.length > 64) throw new BatonError('invalid-params', 'value.option: the option the person chose');
    const where = this.where(ticket);
    if (!where) throw new BatonError('not-found', `${ticket} is not on the board`);
    const applied = this.apply(repo, ticket,
      { id: given.id ?? '', leg: given.leg ?? where.station.next_leg ?? '', option: given.option, reached: given.reached ?? '' },
      { by: actor, ref: given.ref, refuse: true });
    return { ok: true, reached: applied.reached, option: given.option, ...(applied.deferred ? { deferred: true as const } : {}) };
  }

  /**
   * Apply one answer to a person leg leaving the ticket's station, from either writer — the
   * sync's attestation (`who.ref` naming the commit it rode) or an owner's own (`who.refuse`:
   * the faults the sync drops are thrown `invalid-params` instead, the CLI's answer, S-BTN-67).
   * What Baton cannot apply is an `arrival-unapplied` record either way, never a refusal —
   * except one fault: a claim holding the ticket, which defers the answer (R-BTN-39) rather
   * than recording it.
   */
  private apply(repo: string, id: string, value: { id: string; leg: string; option: string; reached: string }, who: { by: string; ref?: string; refuse?: boolean }): { reached: string; deferred?: boolean } {
    const where = this.where(id);
    if (!where) {
      if (who.refuse) throw new BatonError('not-found', `${id} is not on the board`);
      this.unapplied(id, null, { why: 'the ticket is not on the board' });
      return { reached: '' };
    }
    const g = this.c.graph(repo, where.course);
    const leg = g ? resolveLeg(g, value.leg) : null;
    const def = leg != null ? g!.legs.get(leg) : undefined;
    const station = g ? (resolveStation(g, where.station.station) ?? where.station.station) : where.station.station;
    const bad = (why: string): { reached: '' } => {
      if (who.refuse) throw new BatonError('invalid-params', why);
      this.invalid(id, { why });
      return { reached: '' };
    };
    // What Baton cannot apply is an `arrival-unapplied` record for the sync (R-BTN-39: kept as
    // evidence, raising nothing — the sync attests again on its next run) and an `invalid-params`
    // refusal for a person's own answer, which wants to know (S-BTN-67).
    const aside = (why: string): { reached: string } => {
      if (who.refuse) throw new BatonError('invalid-params', `${id}: ${why}`);
      this.unapplied(id, leg, { why });
      return { reached: station };
    };
    // R-BTN-39's idempotence, before every other check: an answer whose ref Baton has applied
    // for this ticket is accepted silently and moves nothing, whatever station the ticket now
    // stands at — the answer itself moved it past the leg's `from`, and the sync attests the
    // same `answer:` on every run. The row keeps only the latest ref; a question replaced after
    // it (a ticket that loops back) is not reopened by the old one, whose fact-arrival row
    // settles it.
    if (who.ref != null && this.appliedRef(id, who.ref)) return { reached: station };
    if (!g || leg == null || !def?.person) {
      return bad(value.leg ? `the answer names ${value.leg}, which is not a person leg of ${where.course}` : `${id} has no queued leg to answer`);
    }
    const stored = this.rows<QuestionRow>('SELECT * FROM ticket_questions WHERE ticket_id = ?', id)[0] ?? null;
    // The row holds one ask at a time; its answer closes the ask it names. A row closed over a
    // previous leg does not close this one — the ticket queued this leg after that answer.
    if (stored?.answered_at != null && stored.leg === leg) {
      if (who.refuse) throw new BatonError('invalid-params', `${id}: its question is already answered (${stored.option})`);
      this.unapplied(id, leg, { why: 'the question is answered' });
      return { reached: station };
    }
    // R-BTN-39: the leg leaves Baton's station — a person's leg need not be the queued one, so
    // a person's answer counts while a runner's leg waits (§6.4).
    if (!def.from.includes(station)) return aside(`${leg} does not leave ${id}'s station ${station}`);
    const options = this.optionsOf(g, leg, stored);
    const option = options.find((o) => o.id === value.option);
    if (!option) return bad(`the answer names ${value.option}, which is not one of ${leg}'s options (${options.map((o) => o.id).join(', ')})`);
    if (value.reached !== '' && value.reached !== option.reached) return bad(`the answer reaches ${value.reached}; ${value.option} chooses ${option.reached}`);
    // §6.4: the answer's id is the question's when one is posted — a person's own answer, which
    // names the option alone, takes it from the stored question rather than repeating it. A
    // question posted for another leg names nothing here.
    const given = value.id || (stored?.leg === leg ? stored.question_id : null) || '';
    if (stored?.question_id != null && stored.leg === leg && given !== stored.question_id) {
      return bad(`the answer's id ${value.id || '(none)'} is not the posted question's ${stored.question_id}`);
    }
    // §6.4: where the policy admits it — `inputs.answers: git` — an answer read from git binds;
    // under `attestation` it does not count (R-BTN-191).
    if (who.by === 'sync' && this.c.answersFrom?.(repo) === 'attestation') {
      this.unapplied(id, leg, { why: 'the policy\'s inputs.answers is attestation: an answer in git does not count (R-BTN-191)' });
      return { reached: station };
    }
    // R-BTN-109: the station reached takes the answer as its entry, if it asks for anything.
    for (const r of g.entry.get(option.reached) ?? []) {
      if (r.output !== 'answer' || r.schema !== DECISION_TYPE) {
        return bad(`${option.reached}'s entry asks for ${r.output} (${r.schema}); a person leg arrives with answer (${DECISION_TYPE}) alone`);
      }
    }
    // R-BTN-39: deferred, not refused, while held — an answer that has passed every other check
    // and fails only because a claim holds the ticket waits, kept with its ref, and is applied
    // when the hold ends if it still meets every other condition then (`applyPending`, the
    // alarm's tick after the hold ends); it raises nothing meanwhile.
    if (this.c.isHeld?.(id)) {
      // The deferred answer waits with the question it was given — never another leg's.
      const mine = stored?.leg === leg ? stored : null;
      this.exec(
        `INSERT INTO ticket_questions (ticket_id, question_id, leg, url, severity, options_json, posted_at,
            pending_leg, pending_option, pending_reached, pending_by, pending_ref, pending_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (ticket_id) DO UPDATE SET leg = excluded.leg, pending_leg = excluded.pending_leg, pending_option = excluded.pending_option,
           pending_reached = excluded.pending_reached, pending_by = excluded.pending_by,
           pending_ref = excluded.pending_ref, pending_at = excluded.pending_at,
           question_id = coalesce(excluded.question_id, ticket_questions.question_id)`,
        id, mine?.question_id ?? null, leg, mine?.url ?? null, mine?.severity ?? null, mine?.options_json ?? '[]',
        stored?.posted_at ?? this.c.now(), leg, option.id, option.reached, who.by, who.ref ?? null, this.c.now());
      return { reached: option.reached, deferred: true };
    }
    this.settle(repo, id, g, leg, { id: option.id, reached: option.reached }, { by: who.by, ref: who.ref ?? null, expired: false });
    return { reached: option.reached };
  }

  /** R-BTN-39's idempotence: whether `ref` names an arrival Baton has applied for this ticket —
   *  the question row's own answer, or any earlier one whose row a later question replaced. */
  private appliedRef(id: string, ref: string): boolean {
    const row = this.rows<{ answered_ref: string | null }>('SELECT answered_ref FROM ticket_questions WHERE ticket_id = ?', id)[0];
    if (row?.answered_ref === ref) return true;
    return this.rows(`SELECT 1 FROM ticket_history WHERE ticket_id = ? AND kind = 'fact-arrival' AND json_extract(detail_json, '$.ref') = ? LIMIT 1`, id, ref).length > 0;
  }

  /** R-BTN-39's deferred arrival: every answer that waited out a hold, applied now for each
   *  ticket no claim holds — the alarm's tick after the hold ends is that moment. One that no
   *  longer meets every other condition then is recorded (unapplied or invalid) by `apply`
   *  itself; the pending goes either way. */
  applyPending(): void {
    const due = this.rows<{ ticket_id: string; leg: string; option: string; reached: string; by: string; ref: string | null }>(
      `SELECT ticket_id, pending_leg AS leg, pending_option AS option, pending_reached AS reached, pending_by AS by, pending_ref AS ref
        FROM ticket_questions WHERE pending_option IS NOT NULL ORDER BY pending_at, ticket_id`);
    for (const p of due) {
      if (this.c.isHeld?.(p.ticket_id)) continue;
      this.exec(
        `UPDATE ticket_questions SET pending_leg = NULL, pending_option = NULL, pending_reached = NULL,
           pending_by = NULL, pending_ref = NULL, pending_at = NULL WHERE ticket_id = ?`, p.ticket_id);
      if (this.rows('SELECT 1 FROM closed_tickets WHERE ticket_id = ?', p.ticket_id).length) continue;
      this.apply(repositoryOf(p.ticket_id), p.ticket_id,
        { id: '', leg: p.leg, option: p.option, reached: p.reached },
        { by: p.by, ref: p.ref ?? undefined });
    }
  }

  /** The leg's options: the question's when it has them, else each outcome under its own name. */
  private optionsOf(g: Graph, leg: string, stored: QuestionRow | null): QuestionOption[] {
    const posted = stored != null && stored.leg === leg ? (JSON.parse(stored.options_json) as QuestionOption[]) : [];
    if (posted.length) return posted;
    return (g.legs.get(leg)?.to ?? []).map((reached) => ({ id: reached, reached }));
  }

  // ── expiry (R-BTN-116, applied by the alarm) ─────────────────────────────────────────────

  /**
   * The person expiries due at `now`: each ticket whose person leg is still queued, unanswered
   * and unheld arrives at its `expires.reached` (`next_source: baton`, R-BTN-83), logged
   * `question-expired`. One held is left due — the hold defers it (§6.4) — and the next tick
   * takes it; a queued leg that is no longer a person leg with `expires` clears its instant.
   */
  expireDue(now: number): number {
    const due = this.rows<{ ticket_id: string; next_leg: string }>(
      `SELECT s.ticket_id, s.next_leg FROM ticket_stations s
        LEFT JOIN ticket_questions q ON q.ticket_id = s.ticket_id
       WHERE s.person_expires_at IS NOT NULL AND s.person_expires_at <= ?
         AND (q.answered_at IS NULL OR q.leg != s.next_leg)
         AND NOT EXISTS (SELECT 1 FROM closed_tickets c WHERE c.ticket_id = s.ticket_id)
       ORDER BY s.ticket_id`, now);
    let fired = 0;
    for (const d of due) {
      if (this.c.isHeld?.(d.ticket_id)) continue;
      const where = this.where(d.ticket_id);
      if (!where) continue;
      if (where.station.next_leg == null) {
        // Nothing is queued: the instant is stale, not deferred — clear it (a due row left here
        // is one nextDue would keep arming the alarm at, §3).
        this.exec('UPDATE ticket_stations SET person_expires_at = NULL WHERE ticket_id = ?', d.ticket_id);
        continue;
      }
      const repo = repositoryOf(d.ticket_id);
      const g = this.c.graph(repo, where.course);
      const leg = g ? resolveLeg(g, d.next_leg) : null;
      const def = leg != null ? g!.legs.get(leg) : undefined;
      if (!g || leg == null || !def?.person || def.expires == null || where.station.next_leg !== leg) {
        this.exec('UPDATE ticket_stations SET person_expires_at = NULL WHERE ticket_id = ?', d.ticket_id);
        continue;
      }
      this.settle(repo, d.ticket_id, g, leg, { id: null, reached: def.expires.reached }, { by: 'baton', ref: null, expired: true });
      fired++;
    }
    return fired;
  }

  /** The earliest person expiry the alarm can consume, for the alarm (§3): one that is
   *  unanswered, unheld and live. `expireDue` deliberately leaves a held ticket's due behind
   *  (the hold defers it, and the tick's next pass takes it), so arming at its past instant
   *  would fire the alarm back to back for as long as the hold lasts; its release needs no wake
   *  of its own, only the tick. */
  nextDue(): number | null {
    return this.rows<{ d: number | null }>(
      `SELECT MIN(s.person_expires_at) AS d FROM ticket_stations s
        LEFT JOIN ticket_questions q ON q.ticket_id = s.ticket_id
       WHERE s.person_expires_at IS NOT NULL AND s.next_leg IS NOT NULL
         AND (q.answered_at IS NULL OR q.leg != s.next_leg)
         AND NOT EXISTS (SELECT 1 FROM closed_tickets c WHERE c.ticket_id = s.ticket_id)
         AND NOT EXISTS (SELECT 1 FROM claims cl WHERE cl.ticket_id = s.ticket_id AND (${HELD_CLAIMS_SQL}))`)[0]?.d ?? null;
  }

  // ── the arrival itself ───────────────────────────────────────────────────────────────────

  /** Move the ticket along its person leg and close its question. The caller's transaction. */
  private settle(repo: string, id: string, g: Graph, leg: string, option: { id: string | null; reached: string }, meta: { by: string; ref: string | null; expired: boolean }) {
    const now = this.c.now();
    const path = [...(JSON.parse(this.rows<{ path: string }>('SELECT path FROM ticket_stations WHERE ticket_id = ?', id)[0]?.path ?? '[]') as { leg: string; reached: string }[]),
      { leg, reached: option.reached }];
    // The legs leaving the outcome it reached, in the file's order: the ticket waits at the
    // station, `next_source: baton` (R-BTN-83), and the next snapshot places it properly.
    const next = [...g.legs.entries()].filter(([, l]) => l.from.includes(option.reached)).map(([name]) => name);
    // §6.4: the expiry instant is set when the person leg becomes the queued leg — a Baton move
    // is one of the ways it becomes queued ("at a route that queues it", R-BTN-83), so a settle
    // that queues another person leg with `expires` arms its clock itself, counting from this
    // moment; any other queued leg has none.
    const nextDef = next[0] != null ? g.legs.get(next[0]) : undefined;
    const expiresAt = nextDef?.person && nextDef.expires != null ? now + nextDef.expires.afterS * 1000 : null;
    this.exec(`UPDATE ticket_stations SET station = ?, path = ?, path_len = ?, to_end = ?, next_leg = ?, next_source = 'baton', person_expires_at = ?
               WHERE ticket_id = ?`, option.reached, JSON.stringify(path), path.length, g.toEnd.get(option.reached) ?? 0, next[0] ?? null, expiresAt, id);
    this.exec('DELETE FROM ticket_next_legs WHERE ticket_id = ?', id);
    for (const name of next) {
      this.exec(`INSERT INTO ticket_next_legs (ticket_id, leg, state, ready_since) VALUES (?, ?, 'ready', ?)
                 ON CONFLICT (ticket_id, leg) DO UPDATE SET state = 'ready', waiting_on = NULL, waiting_since = NULL, ready_since = excluded.ready_since`, id, name, now);
    }
    // The question closes — answered or expired — and the expiry and any deferred answer with
    // it. The row names the leg the answer actually ran: a person's leg need not be the queued
    // one (R-BTN-39), and the queued one's question is moot once the ticket has moved. A leg
    // the source never posted a question for gets its row here, closed as it opens.
    this.exec(`INSERT INTO ticket_questions (ticket_id, question_id, leg, url, severity, options_json, posted_at, answered_at, answered_by, option, answered_ref)
               VALUES (?, NULL, ?, NULL, NULL, '[]', ?, ?, ?, ?, ?)
               ON CONFLICT (ticket_id) DO UPDATE SET leg = excluded.leg, answered_at = excluded.answered_at, answered_by = excluded.answered_by,
                 option = excluded.option, answered_ref = excluded.answered_ref,
                 pending_leg = NULL, pending_option = NULL, pending_reached = NULL, pending_by = NULL, pending_ref = NULL, pending_at = NULL`,
      id, leg, now, now, meta.by, option.id, meta.ref);
    if (meta.expired) {
      logEvent(this.c.store, now, 'question-expired', 'baton', { ticket: id, leg, reached: option.reached }, id);
      this.c.history?.record(id, { kind: 'question-expired', leg, reached: option.reached, next_leg: next[0] ?? null });
    } else {
      logEvent(this.c.store, now, 'question-answered', meta.by, { ticket: id, leg, option: option.id, answered_by: meta.by }, id);
      this.c.history?.record(id, { kind: 'fact-arrival', leg, reached: option.reached, next_leg: next[0] ?? null, detail: { option: option.id, answered_by: meta.by, ...(meta.ref ? { ref: meta.ref } : {}) } });
      this.c.history?.record(id, { kind: 'question-answered', leg, detail: { option: option.id, answered_by: meta.by } });
    }
    this.c.queued?.(id);
    this.c.reevaluate?.(id);
    this.c.dispatch?.('sync', id);
  }

  // ── records that raise nothing (R-BTN-39) ───────────────────────────────────────────────

  /** An arrival Baton does not apply: an event and a history row, never a refusal (G-BTN-75). */
  private unapplied(id: string, leg: string | null, detail: Record<string, unknown>) {
    logEvent(this.c.store, this.c.now(), 'arrival-unapplied', 'sync', { ticket: id, ...(leg ? { leg } : {}), ...detail }, id);
    this.c.history?.record(id, { kind: 'arrival-unapplied', leg, detail });
  }

  /** The sync's invalid answer: dropped and logged `answer-invalid` (§6.4). */
  private invalid(id: string, detail: Record<string, unknown>) {
    logEvent(this.c.store, this.c.now(), 'answer-invalid', 'sync', { ticket: id, ...detail }, id);
  }

  // ── reads ────────────────────────────────────────────────────────────────────────────────

  /** Where the ticket is and what its course is, as the question's checks read it. */
  private where(id: string): { course: string; station: { station: string; next_leg: string | null } } | null {
    const r = this.rows<{ course_id: string; station: string; next_leg: string | null }>(
      `SELECT t.course_id, s.station, s.next_leg FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.id = ?`, id)[0];
    return r ? { course: r.course_id, station: { station: r.station, next_leg: r.next_leg } } : null;
  }

  /** §14 Needs you (R-BTN-116): every ticket waiting on a person's leg — from the moment it is
   *  queued, posted question or not — with who answers, its question, its options and its expiry.
   *  The row's question is the leg's own: one a previous leg's answer closed names nothing here.
   *  B-133: each option carries its COMPUTED action — the station it reaches and the legs that
   *  leave it, person or runner, from the course graph — beside the packet's words. */
  needsYou() {
    const waiting = this.rows<{ ticket_id: string; leg: string; person_expires_at: number | null; course_id: string; repository_id: string; title: string;
      question_id: string | null; url: string | null; severity: string | null; options_json: string | null }>(
      `SELECT s.ticket_id, s.next_leg AS leg, s.person_expires_at, t.course_id, t.repository_id, t.title,
              CASE WHEN q.leg = s.next_leg THEN q.question_id END AS question_id,
              CASE WHEN q.leg = s.next_leg THEN q.url END AS url,
              CASE WHEN q.leg = s.next_leg THEN q.severity END AS severity,
              CASE WHEN q.leg = s.next_leg THEN q.options_json END AS options_json
       FROM ticket_stations s JOIN tickets t ON t.id = s.ticket_id LEFT JOIN ticket_questions q ON q.ticket_id = s.ticket_id
       WHERE s.next_leg IS NOT NULL AND (q.ticket_id IS NULL OR q.answered_at IS NULL OR q.leg != s.next_leg)
       ORDER BY t.repository_id, s.ticket_id`);
    const out: { ticket_id: string; leg: string; asks: string | null; title: string; question_id: string | null; url: string | null; severity: string | null; options: (QuestionOption & { action: string })[]; expires_at?: number }[] = [];
    for (const w of waiting) {
      const g = this.c.graph(w.repository_id, w.course_id);
      const def = g?.legs.get(w.leg);
      if (!def?.person) continue;
      const posted = w.options_json != null ? (JSON.parse(w.options_json) as QuestionOption[]).filter((o) => def.to.includes(o.reached)) : [];
      const options = (posted.length ? posted : def.to.map((reached) => ({ id: reached, reached })))
        .map((o) => ({ ...o, action: optionAction(g!, o.reached) }));
      out.push({
        ticket_id: w.ticket_id, leg: w.leg, asks: def.asks, title: w.title, question_id: w.question_id, url: w.url, severity: w.severity,
        options,
        ...(w.person_expires_at != null ? { expires_at: w.person_expires_at } : {}),
      });
    }
    return out;
  }
}
