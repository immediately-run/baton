// R-BTN-39, R-BTN-203 (S-BTN-309): verify placement against the course, not against the forge.
import { COURSE_ID } from './course';
import { runsOf, type Graph, type Leg, type Step } from './graph';
import { qualify } from './validate';
import type { PostedAttestation } from './board';
import type { Store } from './ports';
import type { History } from './history';

export const ARRIVAL_TYPE = 'std:arrival@1';
export const EVIDENCE_TYPE = 'std:evidence@1';
export const isOutsideWork = (a: PostedAttestation) => a.type === ARRIVAL_TYPE || a.type === EVIDENCE_TYPE;

type EvidenceKind = 'mention' | 'merged-early' | 'fact';
type Arrival = { ref: string; leg: string; reached: string; next_leg: string | null };
type Position = { ticket_id: string; repository_id: string; course_id: string; station: string; path: string; next_leg: string | null; next_source: string; handoff_url: string | null };

function reference(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 200 && (/^[a-f0-9]{40}$/i.test(v) || /^https?:\/\/[^\s<>"{}]+$/.test(v));
}

export class OutsideWork {
  constructor(private readonly c: {
    store: Store;
    now: () => number;
    graph: (repo: string, course: string) => Graph | null;
    record: History['record'];
    held: (ticket: string) => boolean;
    changed: (ticket: string) => void;
    admits: (repo: string, type: string) => boolean;
  }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }

  private position(ticket: string): Position | undefined {
    return this.rows<Position>(`SELECT t.repository_id, t.course_id, s.* FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
      WHERE t.id = ? AND NOT EXISTS (SELECT 1 FROM closed_tickets x WHERE x.ticket_id = t.id)`, ticket)[0];
  }

  private held(ticket: string): boolean {
    return this.c.held(ticket) || this.rows('SELECT 1 FROM ticket_overrides WHERE ticket_id = ? AND hold = 1', ticket).length > 0;
  }

  private keep(ticket: string, ref: string, kind: EvidenceKind, leg: string | null = null) {
    this.c.store.exec(`INSERT INTO ticket_evidence (ticket_id, ref, kind, leg, found_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      ticket, ref, kind, leg, this.c.now());
  }

  posted(repo: string, list: PostedAttestation[]) {
    const seen = new Set<string>();
    for (const a of list) {
      const id = qualify(repo, a.ticket);
      const pos = this.position(id);
      if (!pos) continue;
      const v = a.value as Record<string, unknown>;
      const ref = a.ref ?? v.ref;
      if (!reference(ref) || (v.ref !== undefined && v.ref !== ref)) continue;
      if (a.type === EVIDENCE_TYPE && this.c.admits(repo, a.type) && (v.kind === 'mention' || v.kind === 'merged-early')) {
        this.keep(id, ref, v.kind);
        seen.add(id);
      } else if (a.type === ARRIVAL_TYPE && typeof v.leg === 'string' && COURSE_ID.test(v.leg)
        && typeof v.reached === 'string' && COURSE_ID.test(v.reached)
        && (v.next === undefined || v.next === null || (typeof v.next === 'string' && COURSE_ID.test(v.next)))) {
        this.arrive(pos, { ref, leg: v.leg, reached: v.reached, next_leg: v.next ?? null });
        seen.add(id);
      }
    }
    for (const id of seen) this.queue(id);
  }

  private arrive(pos: Position, a: Arrival) {
    const id = pos.ticket_id;
    const sql = this.c.store;
    if (this.rows(`SELECT 1 FROM ticket_history WHERE ticket_id = ? AND kind = 'fact-arrival' AND json_extract(detail_json, '$.ref') = ?`, id, a.ref).length) return;
    const aside = (why: string) => {
      if (!this.rows(`SELECT 1 FROM ticket_history WHERE ticket_id = ? AND kind = 'arrival-unapplied' AND json_extract(detail_json, '$.ref') = ?`, id, a.ref).length) {
        this.c.record(id, { kind: 'arrival-unapplied', leg: a.leg, detail: { ref: a.ref, station: pos.station, why } });
      }
    };
    const g = this.c.graph(pos.repository_id, pos.course_id);
    const def = g?.legs.get(a.leg);
    if (!g || !def?.arrives || !def.from.includes(pos.station) || !def.to.includes(a.reached) || g.entry.has(a.reached)) {
      aside('the fact does not leave the current station for that outcome');
      return;
    }
    const path = JSON.parse(pos.path) as Step[];
    const allows = (leg: string, d: Leg) =>
      !d.arrives && !d.reconciles && d.from.includes(a.reached) && (d.maxRuns == null || runsOf(g, leg, path.map((s) => s.leg)) < d.maxRuns);
    const configured = def.arrives.next;
    if ((typeof configured === 'string' && a.next_leg !== configured)
      || (typeof configured === 'object' && !(def.arrives.verdict ? [configured[def.arrives.verdict]] : Object.values(configured)).some((n) => (n ?? null) === a.next_leg))
      || (a.next_leg != null && (!g.legs.has(a.next_leg) || !allows(a.next_leg, g.legs.get(a.next_leg)!)))) {
      aside('the fact does not queue a permitted continuation');
      return;
    }
    if (this.rows("SELECT 1 FROM claims WHERE ticket_id = ? AND status = 'active'", id).length) {
      aside('a claim is active');
      return;
    }
    if (!this.c.admits(pos.repository_id, ARRIVAL_TYPE)) {
      const merged = def.arrives.fact === 'pr-merged';
      this.keep(id, a.ref, merged ? 'merged-early' : 'fact', merged ? null : a.leg);
      return;
    }
    const count = runsOf(g, a.leg, path.map((s) => s.leg));
    if (def.maxRuns != null && count >= def.maxRuns) {
      this.keep(id, a.ref, 'fact', a.leg);
      return;
    }
    if (this.held(id)) {
      sql.exec(`INSERT INTO pending_fact_arrivals VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, id, a.ref, a.leg, a.reached, a.next_leg, this.c.now());
      return;
    }
    const next = a.next_leg ?? [...g.legs].find(([leg, d]) => allows(leg, d))?.[0] ?? null;
    this.move(pos, g, { leg: a.leg, reached: a.reached }, next);
    this.c.record(id, { kind: 'fact-arrival', leg: a.leg, run: count + 1, reached: a.reached, next_leg: next, detail: { ref: a.ref, outside: true } });
  }

  private setNext(id: string, next: string | null) {
    const sql = this.c.store;
    sql.exec('DELETE FROM ticket_next_legs WHERE ticket_id = ?', id);
    if (next != null) sql.exec("INSERT INTO ticket_next_legs (ticket_id, leg, state, ready_since) VALUES (?, ?, 'ready', ?)", id, next, this.c.now());
    this.c.changed(id);
  }

  private move(pos: Position, g: Graph, step: Step, next: string | null) {
    const id = pos.ticket_id;
    const path = [...JSON.parse(pos.path) as Step[], step];
    const person = next == null ? undefined : g.legs.get(next)?.expires;
    this.c.store.exec('DELETE FROM reconcile_displaced WHERE ticket_id = ?', id);
    this.c.store.exec(`UPDATE ticket_stations SET station = ?, path = ?, path_len = ?, to_end = ?, next_leg = ?, next_source = 'baton',
      handoff_url = NULL, person_expires_at = ?, changed_at = ? WHERE ticket_id = ?`, step.reached, JSON.stringify(path), path.length, g.toEnd.get(step.reached) ?? 0, next,
      person ? this.c.now() + person.afterS * 1000 : null, this.c.now(), id);
    this.setNext(id, next);
  }

  queue(id: string) {
    const pos = this.position(id);
    if (!pos || this.c.held(id)) return;
    const g = this.c.graph(pos.repository_id, pos.course_id);
    if (!g) return;
    const sql = this.c.store;
    const displaced = this.displaced(id);
    const candidate = [...g.legs].find(([, l]) => l.reconciles && l.from.includes(pos.station));
    const leg = candidate?.[0];
    const max = candidate?.[1].maxRuns ?? 0;
    const alreadyQueued = leg != null && pos.next_leg === leg && displaced?.station === pos.station;
    if (displaced && !alreadyQueued) sql.exec('DELETE FROM reconcile_displaced WHERE ticket_id = ?', id);
    if (!leg) return;
    const ran = this.rows<{ leg: string }>(`SELECT leg FROM ticket_history WHERE ticket_id = ? AND kind = 'leg-started' AND leg = ?`, id, leg).length;
    if (alreadyQueued && ran >= max) {
      sql.exec('DELETE FROM reconcile_displaced WHERE ticket_id = ?', id);
      sql.exec("UPDATE ticket_stations SET next_leg = ?, next_source = 'baton' WHERE ticket_id = ?", displaced.leg, id);
      this.setNext(id, displaced.leg);
    }
    const displacedDef = pos.next_leg == null ? undefined : g.legs.get(pos.next_leg);
    if (alreadyQueued || ran >= max || !pos.next_leg || !displacedDef || this.held(id) || pos.handoff_url
      || displacedDef.person || displacedDef.arrives || displacedDef.reconciles
      || this.rows("SELECT 1 FROM claims WHERE ticket_id = ? AND status = 'completed' AND end_reason LIKE 'suspended:%' AND ended_at >= (SELECT changed_at FROM ticket_stations WHERE ticket_id = ?)", id, id).length
      || this.rows("SELECT 1 FROM ticket_next_legs WHERE ticket_id = ? AND leg = ? AND waiting_on IN ('course-changed', 'exhausted', 'expired', 'routed')", id, pos.next_leg).length
      || !this.rows('SELECT 1 FROM ticket_evidence WHERE ticket_id = ? AND weighed_at IS NULL LIMIT 1', id).length) return;
    sql.exec('INSERT INTO reconcile_displaced VALUES (?, ?, ?, ?)', id, pos.next_leg, pos.station, this.c.now());
    sql.exec("UPDATE ticket_stations SET next_leg = ?, next_source = 'baton' WHERE ticket_id = ?", leg, id);
    this.setNext(id, leg);
    this.c.record(id, { kind: 'reconcile-queued', leg, next_leg: leg, detail: { displaced: pos.next_leg, station: pos.station } });
  }

  displaced(id: string) {
    return this.rows<{ station: string; leg: string }>('SELECT station, leg FROM reconcile_displaced WHERE ticket_id = ?', id)[0];
  }

  capture(id: string, claim: number) {
    this.c.store.exec('UPDATE ticket_evidence SET claim_id = ? WHERE ticket_id = ? AND weighed_at IS NULL', claim, id);
  }

  evidence(id: string, claim?: number) {
    return claim === undefined
      ? this.rows<{ ref: string; kind: EvidenceKind }>('SELECT ref, kind FROM ticket_evidence WHERE ticket_id = ? AND weighed_at IS NULL ORDER BY found_at, ref', id)
      : this.rows<{ ref: string; kind: EvidenceKind }>('SELECT ref, kind FROM ticket_evidence WHERE ticket_id = ? AND claim_id = ? ORDER BY found_at, ref', id, claim);
  }

  finish(id: string, claim: number, g: Graph, step: Step, next: string | null) {
    const pos = this.position(id);
    if (!pos) return;
    this.move(pos, g, step, next);
    if (g.legs.get(step.leg)?.reconciles) {
      this.c.store.exec('UPDATE ticket_evidence SET weighed_at = ? WHERE ticket_id = ? AND claim_id = ?', this.c.now(), id, claim);
    }
  }

  pending(repo?: string, ticket?: string) {
    const only = ticket ? ' AND t.id = ?' : repo ? ' AND t.repository_id = ?' : '';
    const args = ticket ? [ticket] : repo ? [repo] : [];
    for (const a of this.rows<Arrival & { ticket_id: string }>(`SELECT p.* FROM pending_fact_arrivals p CROSS JOIN tickets t ON t.id = p.ticket_id WHERE 1${only} ORDER BY found_at, ref`, ...args)) {
      if (this.held(a.ticket_id)) continue;
      this.c.store.exec('DELETE FROM pending_fact_arrivals WHERE ticket_id = ? AND ref = ?', a.ticket_id, a.ref);
      const pos = this.position(a.ticket_id);
      if (pos) this.arrive(pos, a);
    }
    for (const { ticket_id } of this.rows<{ ticket_id: string }>(`SELECT DISTINCT e.ticket_id FROM ticket_evidence e CROSS JOIN tickets t ON t.id = e.ticket_id WHERE weighed_at IS NULL${only}`, ...args)) this.queue(ticket_id);
  }
}
