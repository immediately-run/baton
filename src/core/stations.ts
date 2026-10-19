// stations.ts — where each ticket is, as its repository's sync places it (BATON_SPEC §2e R-BTN-70,
// R-BTN-39, §7.1 `stations` and `closed`, R-BTN-10's closures). A cache each accepted snapshot
// overwrites: Baton never computes a station, and on any conflict git wins. Applying a snapshot
// also notices a path that is neither an extension of the previous one by edges of the course
// file nor shorter (`off-graph`), and hands the claims what changed, so they judge confirmation,
// staleness and regression from it (claims.ts).
import { logEvent } from './db';
import { extendsPath, graphOf, leaves, onGraph, resolveLeg, type Graph, type Step } from './graph';
import type { PostedStation } from './board';
import type { Store } from './ports';
import { meetsRequiredBar, requiredBarCovers, type RequiredBar } from './admin';
import { qualify } from './validate';
import type { History } from './history';
import { BATON_WAITS } from './blocks';

/** What one snapshot showed of one ticket, against the previous accepted one. */
export interface Seen {
  station: string;
  path: Step[];
  /** The previous accepted snapshot's path, or null when it placed the ticket nowhere. */
  prev: Step[] | null;
  bars: Record<string, string[]>;
}

/** A wait Baton stores itself (R-BTN-78's `BATON_WAITS`), not one a sync posts. */
function batonWait(on: string | null | undefined): boolean {
  return on != null && (BATON_WAITS as readonly string[]).includes(on);
}

export class Stations {
  private graphs = new Map<string, Graph | null>();

  constructor(private readonly c: { store: Store; now: () => number; requiredBars?: (repo: string) => RequiredBar[]; history?: History }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  /** The graph of a repository's course in force, or null when it has none. Cached until the next
   *  board post, which resets it before and after it runs and again once its registry is applied:
   *  the course table changes only there. */
  graph(repo: string, course: string): Graph | null {
    const key = `${repo}\u0000${course}`;
    if (!this.graphs.has(key)) {
      const row = this.rows<{ course_json: string }>('SELECT course_json FROM courses WHERE repository_id = ? AND id = ?', repo, course)[0];
      this.graphs.set(key, row ? graphOf(JSON.parse(row.course_json)) : null);
    }
    return this.graphs.get(key)!;
  }

  /** Forget the cached graphs: a registry was applied. */
  reset() {
    this.graphs.clear();
  }

  /** The interim post's stations (docs until R3-1233), which place nothing: each ticket rests at
   *  its course's start with the start leg queued, ready exactly when factory-state calls the
   *  item ready. Interim tickets therefore claim as before, and run their legs by `advance`. */
  interim(repo: string, items: { id: string; course: string; node: string }[]): Map<string, PostedStation> {
    const out = new Map<string, PostedStation>();
    for (const it of items) {
      const g = this.graph(repo, it.course);
      if (!g) continue;
      const ready = it.node.startsWith('ready-');
      out.set(it.id, {
        station: g.start, path: [], next_leg: g.startLeg, next_source: 'course', handoff_url: null,
        next: [{ leg: g.startLeg, state: ready ? 'ready' : 'waiting', waiting_on: ready ? null : it.node.slice(0, 64) }], bars: {},
      });
    }
    return out;
  }

  /**
   * Write a snapshot's stations for the repository's live tickets (by local id) and its closures.
   * A station naming a station or leg the course file does not have — the file or the sync is
   * wrong — places the ticket nowhere and logs `off-graph`, so it is never offered on a guess. A
   * path that neither extends the previous one by edges nor is shorter is stored (git wins) and
   * logs `off-graph`. Returns what each placed ticket showed, by qualified id.
   */
  apply(repo: string, sha: string, observation: number, stations: Map<string, PostedStation>, closed: { id: string; as: 'done' | 'withdrawn' }[], at: number): Map<string, Seen> {
    const seen = new Map<string, Seen>();
    for (const [local, st] of stations) {
      const id = qualify(repo, local);
      const t = this.rows<{ course_id: string }>('SELECT course_id FROM tickets WHERE id = ?', id)[0];
      if (!t) continue;
      const g = this.graph(repo, t.course_id);
      const unknown = !g ? 'no course in force' : this.unknownNames(g, st);
      const prevRow = this.rows<{ path: string; station: string; observation: number }>('SELECT path, station, observation FROM ticket_stations WHERE ticket_id = ?', id)[0];
      const prev = prevRow ? (JSON.parse(prevRow.path) as Step[]) : null;
      if (unknown) {
        this.clear(id);
        // Once per distinct fault, not on every snapshot that repeats it (the sync posts every
        // 15 minutes).
        const last = this.rows<{ why: string | null }>(
          `SELECT json_extract(detail_json, '$.why') AS why FROM events WHERE ticket_id = ? AND kind = 'off-graph' ORDER BY seq DESC LIMIT 1`, id)[0];
        if (last?.why !== unknown) this.offGraph(repo, id, { observation, why: unknown });
        continue;
      }
      // §2e: between two snapshots the path extends by edges, or goes backwards (a regression,
      // judged by the claims); anything else is off-graph. The first placement must follow the
      // file from its start.
      const fine = prev ? extendsPath(g!, prev, st.path, g!.start) || st.path.length < prev.length : onGraph(g!, st.path);
      if (!fine) this.offGraph(repo, id, { observation, why: prev ? 'the path does not extend the previous one by edges' : 'the path does not follow the course file from its start', path: st.path, previous: prev });
      this.write(id, g!, st, sha, observation, at, this.c.requiredBars?.(repo) ?? [], t.course_id);
      // R-BTN-81: git moved the ticket and no claim said so — someone else's work.
      if (prevRow && (prevRow.station !== st.station || prevRow.path !== JSON.stringify(st.path)) && !this.claimMoved(id, st.station, prevRow.observation)) {
        this.c.history?.record(id, { kind: 'git-moved', reached: st.station, next_leg: st.next_leg, detail: { from: prevRow.station, to: st.station, path: st.path, observation, next_source: st.next_source } });
      }
      seen.set(id, { station: st.station, path: st.path, prev, bars: st.bars });
    }
    for (const c of closed) {
      // The first snapshot to report a closure stands (R-BTN-10 compares its observation).
      this.exec('INSERT INTO closed_tickets (ticket_id, closed_as, observation, closed_at) VALUES (?, ?, ?, ?) ON CONFLICT (ticket_id) DO NOTHING',
        qualify(repo, c.id), c.as, observation, at);
    }
    return seen;
  }

  /** A live ticket is not closed: a closure row of a ticket that returned is deleted. */
  reopened(repo: string, liveLocals: string[]) {
    this.exec(`DELETE FROM closed_tickets WHERE ticket_id IN (SELECT ? || ':' || value FROM json_each(?))`, repo, JSON.stringify(liveLocals));
  }

  /** A ticket that left the board leaves the cache. */
  clear(id: string) {
    this.exec('DELETE FROM ticket_stations WHERE ticket_id = ?', id);
    this.exec('DELETE FROM ticket_next_legs WHERE ticket_id = ?', id);
    this.exec('DELETE FROM ticket_bars WHERE ticket_id = ?', id);
  }

  /** Whether a claim reported the ticket at `station`: an active one is there or ran a leg from or
   *  to it — a snapshot lagging the holder shows a station it passed — or one ended there since
   *  the previous snapshot was read. Anything else is R-BTN-81's `git-moved`: someone else's work,
   *  a person's push during a claim included. */
  private claimMoved(id: string, station: string, prevObservation: number): boolean {
    return this.rows(
      `SELECT 1 FROM claims c WHERE c.ticket_id = ? AND (
         (c.status = 'active' AND (c.station = ? OR EXISTS (SELECT 1 FROM claim_legs l WHERE l.claim_id = c.id AND (l.from_station = ? OR l.to_station = ?))))
         OR (c.station = ? AND COALESCE(c.end_observation, 0) >= ?)) LIMIT 1`,
      id, station, station, station, station, prevObservation).length > 0;
  }

  /** The station and path a posted station names must be in the course file (§7.1). A queued or
   *  next leg the file no longer has leaving the station is not refused: it waits on
   *  `course-changed` (R-BTN-83, below). */
  private unknownNames(g: Graph, st: PostedStation): string | null {
    if (!g.stations.has(st.station)) return `unknown station ${st.station}`;
    for (const s of st.path) {
      if (!g.legs.has(s.leg)) return `unknown leg ${s.leg} in the path`;
      if (!g.stations.has(s.reached)) return `unknown station ${s.reached} in the path`;
    }
    for (const leg of Object.keys(st.bars)) if (!g.legs.has(leg)) return `bars for unknown leg ${leg}`;
    return null;
  }

  /**
   * R-BTN-83, course changes: a queued leg the course file in force no longer has leaving the
   * ticket's station waits on `course-changed`, overriding its posted state, and is listed under
   * Needs you; a renamed one is read through `renamed_from`. Run when a course file is accepted —
   * a snapshot's stations are judged as they are written.
   */
  recheckCourse(repo: string, course: string) {
    const g = this.graph(repo, course);
    if (!g) return;
    for (const t of this.rows<{ id: string; station: string; next_leg: string | null }>(
      `SELECT t.id, s.station, s.next_leg FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
       WHERE t.repository_id = ? AND t.course_id = ? AND s.next_leg IS NOT NULL`, repo, course)) {
      const leg = resolveLeg(g, t.next_leg!) ?? t.next_leg!;
      if (leg !== t.next_leg) {
        this.exec('UPDATE ticket_stations SET next_leg = ? WHERE ticket_id = ?', leg, t.id);
        this.exec('UPDATE ticket_next_legs SET leg = ? WHERE ticket_id = ? AND leg = ?', leg, t.id, t.next_leg);
      }
      if (!leaves(g, leg, t.station)) this.courseChanged(t.id, leg, this.c.now());
    }
  }

  /** §14 Needs you (R-BTN-83): tickets whose queued leg waits on `course-changed`. */
  needsYou() {
    return {
      course_changed: this.rows(`SELECT n.ticket_id, n.leg, n.waiting_since FROM ticket_stations s JOIN ticket_next_legs n ON n.ticket_id = s.ticket_id AND n.leg = s.next_leg
                                 WHERE n.state = 'waiting' AND n.waiting_on = 'course-changed' ORDER BY n.waiting_since, n.ticket_id`),
    };
  }

  /** Leg `leg` of ticket `id` waits on `course-changed` since `since`; a wait on it already stored
   *  keeps its own start. */
  private courseChanged(id: string, leg: string, since: number) {
    this.exec(`INSERT INTO ticket_next_legs (ticket_id, leg, state, waiting_on, ready_since, waiting_since) VALUES (?, ?, 'waiting', 'course-changed', NULL, ?)
               ON CONFLICT (ticket_id, leg) DO UPDATE SET state = 'waiting', waiting_on = 'course-changed', ready_since = NULL,
                 waiting_since = CASE WHEN ticket_next_legs.state = 'waiting' AND ticket_next_legs.waiting_on = 'course-changed'
                                      THEN ticket_next_legs.waiting_since ELSE excluded.waiting_since END`, id, leg, since);
  }

  private write(id: string, g: Graph, given: PostedStation, sha: string, observation: number, at: number, required: RequiredBar[], course: string) {
    // R-BTN-64: legs the snapshot names by an old name are stored under the current one.
    const name = (leg: string) => resolveLeg(g, leg) ?? leg;
    const st = { ...given, next_leg: given.next_leg == null ? null : name(given.next_leg), next: given.next.map((n) => ({ ...n, leg: name(n.leg) })) };
    const before = new Map(this.rows<{ leg: string; state: string; waiting_on: string | null; ready_since: number | null; waiting_since: number | null }>(
      'SELECT leg, state, waiting_on, ready_since, waiting_since FROM ticket_next_legs WHERE ticket_id = ?', id).map((r) => [r.leg, r]));
    this.exec(`INSERT INTO ticket_stations (ticket_id, station, path, path_len, to_end, next_leg, next_source, handoff_url, snapshot_sha, observation)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (ticket_id) DO UPDATE SET station = excluded.station, path = excluded.path, path_len = excluded.path_len,
                 to_end = excluded.to_end, next_leg = excluded.next_leg, next_source = excluded.next_source, handoff_url = excluded.handoff_url,
                 snapshot_sha = excluded.snapshot_sha, observation = excluded.observation`,
      id, st.station, JSON.stringify(st.path), st.path.length, g.toEnd.get(st.station) ?? 0, st.next_leg, st.next_source, st.handoff_url, sha, observation);
    this.exec('DELETE FROM ticket_next_legs WHERE ticket_id = ?', id);
    for (const posted of st.next) {
      // R-BTN-67: a leg a required bar covers whose posted bars hold no tag with its prefix is
      // stored waiting on `policy` — the board still moves — and listed under Needs you.
      const unmet = required.some((r) => requiredBarCovers(r, course, posted.leg, g) && !meetsRequiredBar(r, Object.hasOwn(st.bars, posted.leg) ? st.bars[posted.leg] : []));
      const n = unmet ? { leg: posted.leg, state: 'waiting' as const, waiting_on: 'policy' } : posted;
      const b = before.get(n.leg);
      // Age (the default order's fourth key) runs from the first snapshot that showed the leg
      // ready, and an unbroken wait from the first that showed it waiting. A wait git posts never
      // inherits the start of one Baton stored itself, nor the reverse: `baton:stalled` counts
      // posted waits only (R-BTN-78).
      const readySince = n.state === 'ready' ? (b?.state === 'ready' ? b.ready_since : at) : null;
      const unbroken = b?.state === 'waiting' && batonWait(b.waiting_on) === batonWait(n.waiting_on ?? null);
      const waitingSince = n.state === 'waiting' ? (unbroken ? b.waiting_since : at) : null;
      this.exec('INSERT INTO ticket_next_legs (ticket_id, leg, state, waiting_on, ready_since, waiting_since) VALUES (?, ?, ?, ?, ?, ?)',
        id, n.leg, n.state, n.waiting_on, readySince, waitingSince);
    }
    // R-BTN-83: a queued leg — or any next leg posted with it — that does not leave the station in
    // the course file in force waits on `course-changed` whatever the snapshot posted for it; the
    // snapshot is not refused.
    for (const leg of new Set([...(st.next_leg != null ? [st.next_leg] : []), ...st.next.map((n) => n.leg)])) {
      if (leaves(g, leg, st.station)) continue;
      // The wait runs from when Baton first stored it, whatever this snapshot posted (Needs you's age).
      const b = before.get(leg);
      this.courseChanged(id, leg, b?.state === 'waiting' && b.waiting_on === 'course-changed' && b.waiting_since != null ? b.waiting_since : at);
    }
    this.exec('DELETE FROM ticket_bars WHERE ticket_id = ?', id);
    for (const [leg, tags] of Object.entries(st.bars)) for (const tag of tags) this.exec('INSERT OR IGNORE INTO ticket_bars (ticket_id, leg, tag) VALUES (?, ?, ?)', id, leg, tag);
  }

  private offGraph(repo: string, id: string, detail: { observation: number; why: string; path?: Step[]; previous?: Step[] | null }) {
    logEvent(this.c.store, this.c.now(), 'off-graph', 'sync', detail, id, null, repo);
    // R-BTN-85: git's path wins; what Baton held beside it is logged.
    this.c.history?.discrepancy(id, 'off-graph', { path: detail.previous ?? null, source: 'snapshot' }, { why: detail.why, ...(detail.path ? { path: detail.path } : {}) }, detail.observation);
  }
}
