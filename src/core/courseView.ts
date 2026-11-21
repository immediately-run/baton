import type { SessionLinkView } from './links';
// courseView.ts — one course of a repository as the Courses screens read it (B-197; BATON_SPEC
// §5.2 R-BTN-69, §5.3 R-BTN-83, §5.4 R-BTN-79, §6.2 R-BTN-126, §14 `course.show`): the file as
// last accepted and the newer one Baton refused, the runners declaring it, each leg's queue and
// the state of the tickets queued for it, each station's resting tickets, the tickets on the
// course a page at a time with their paths, the window's runs and the window's stats.
//
// Aggregates and ids only (R-BTN-33): titles, hand-off pointers and log directories are text
// Baton already holds; nothing of a ticket's body, no log bytes. Nothing is written, no course
// is validated (the refusal is what `courses.ts` recorded) and no stat is computed here beyond
// reading `stats.ts`'s own answer and counting rows.
//
// The counts are over every ticket of the course, never over the page: one read of the
// course's tickets (id, station, queued leg and what holds it) feeds them and the page's order;
// the page's own detail is then read for its 100 ids alone.
import type { BatonCore } from './baton';
import type { Row } from './ports';
import { localOf as localId } from './validate';
import { claimEnd } from './reads/runners';

/** What the view reaches the core through — a read's context, narrowed. */
export type ViewCtx = { core: BatonCore; sql<T = Row>(query: string, ...params: unknown[]): T[]; now(): number };

export const COURSE_PAGE = 100;
/** At most this many of the window's runs, newest first; `runs_truncated` says when more exist. */
export const COURSE_RUNS_MAX = 500;
const DAY = 86_400_000;

/** A page's position: the sort key of its last ticket. */
export type CoursePosition = [station: number, unranked: number, rank: number, id: string];

type CourseFile = {
  start?: unknown; end?: unknown;
  stations?: Record<string, unknown>;
  legs?: Record<string, { from?: unknown; to?: unknown; max_queue?: unknown } | null>;
} & Record<string, unknown>;

const names = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const parsed = <T>(text: string | null | undefined, otherwise: T): T => {
  if (text == null) return otherwise;
  try {
    return JSON.parse(text) as T;
  } catch {
    return otherwise;
  }
};
const compare = (a: CoursePosition, b: CoursePosition): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);

export function isCoursePosition(v: unknown): v is CoursePosition {
  return Array.isArray(v) && v.length === 4 && typeof v[0] === 'number' && typeof v[1] === 'number' && typeof v[2] === 'number' && typeof v[3] === 'string';
}

type Facts = {
  id: string; station: string; next_leg: string | null; next_state: string | null; retry_after: number | null; rank: number | null;
  claimed: number; running_leg: string | null; running_since: number | null;
};

/** The course, or null when the repository's registry holds neither an accepted file nor a
 *  refused one under `course`. `after` is the position a `?cursor=` carried; `summary` leaves
 *  the tickets and the runs out (the list screen's poll). */
export function courseView(c: ViewCtx, repo: string, course: string, opts: { since: number; summary: boolean; after: CoursePosition | null; sessionLink: SessionLinkView }) {
  const now = c.now();
  const row = c.sql<{ id: string; version: number; min_runner_version: number; skill: string; course_json: string }>(
    'SELECT id, version, min_runner_version, skill, course_json FROM courses WHERE repository_id = ? AND id = ?', repo, course)[0];
  const refusal = c.sql<{ version: number; snapshot_sha: string; refused_at: number; violations: string }>(
    'SELECT version, snapshot_sha, refused_at, violations FROM course_refusals WHERE repository_id = ? AND course_id = ?', repo, course)[0];
  if (!row && !refusal) return null;
  const violations = parsed<{ message?: string }[]>(refusal?.violations, []);
  const refused = refusal ? { version: refusal.version, reason: violations[0]?.message ?? 'refused', violations, snapshot_sha: refusal.snapshot_sha, refused_at: refusal.refused_at } : null;
  const file = row ? parsed<CourseFile | null>(row.course_json, null) : null;
  const stationNames = isObj(file?.stations) ? Object.keys(file.stations) : [];
  const legFile = isObj(file?.legs) ? file.legs : {};
  const legNames = Object.keys(legFile);

  // R-BTN-48: the runners whose heartbeat names this course for the repository, reaped ones
  // left out, and how many of them hold a standing lease.
  const fleet = c.sql<{ declaring: number; alive: number | null }>(
    `SELECT COUNT(*) AS declaring, SUM(? - w.last_seen_at < w.lease_timeout_ms) AS alive
     FROM runner_courses f JOIN runners w ON w.id = f.runner_id
     WHERE f.repository_id = ? AND f.course_id = ? AND w.reaped_at IS NULL`, now, repo, course)[0];

  // Every ticket of the course: where it rests, its queued leg and what holds it.
  const facts = c.sql<Facts>(
    `SELECT t.id, s.station, s.next_leg, n.state AS next_state, o.retry_after, t.rank,
            EXISTS (SELECT 1 FROM claims k WHERE k.ticket_id = t.id AND k.status = 'active') AS claimed,
            (SELECT l.leg FROM claims k JOIN claim_legs l ON l.claim_id = k.id
              WHERE k.ticket_id = t.id AND k.status = 'active' AND l.finished_at IS NULL AND l.abandoned_at IS NULL ORDER BY l.seq DESC LIMIT 1) AS running_leg,
            (SELECT l.started_at FROM claims k JOIN claim_legs l ON l.claim_id = k.id
              WHERE k.ticket_id = t.id AND k.status = 'active' AND l.finished_at IS NULL AND l.abandoned_at IS NULL ORDER BY l.seq DESC LIMIT 1) AS running_since
     FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
     LEFT JOIN ticket_next_legs n ON n.ticket_id = t.id AND n.leg = s.next_leg
     LEFT JOIN ticket_overrides o ON o.ticket_id = t.id
     WHERE t.repository_id = ? AND t.course_id = ?`, repo, course);
  const byId = new Map(facts.map((f) => [f.id, f]));
  // R-BTN-75: the blocks in force on the course's tickets, as stored.
  const blocks = c.sql<{ ticket_id: string; leg: string; kind: string; ref: string; since: number; until: number | null }>(
    `SELECT b.ticket_id, b.leg, b.kind, b.ref, b.since, b.until FROM ticket_blocks b JOIN tickets t ON t.id = b.ticket_id
     WHERE b.repository_id = ? AND t.course_id = ? AND (b.until IS NULL OR b.until > ?) ORDER BY b.ticket_id, b.kind, b.ref, b.leg`, repo, course, now);
  const blockedTickets = new Set(blocks.map((b) => b.ticket_id));

  // Each leg's state counts. A ticket counts once, under its running leg while a claim runs one,
  // else under its queued leg: blocked before backing off before ready. R-BTN-126: a block found
  // while the leg it names is running is `during`; any other is `before`.
  type LegState = { ready: number; running: number; waiting: number; backing_off: number; blocked: Map<string, Set<string>> };
  const states = new Map<string, LegState>();
  const stateOf = (leg: string): LegState => {
    let s = states.get(leg);
    if (!s) states.set(leg, (s = { ready: 0, running: 0, waiting: 0, backing_off: 0, blocked: new Map() }));
    return s;
  };
  for (const f of facts) {
    if (f.running_leg != null) stateOf(f.running_leg).running++;
    else if (f.next_leg != null && !f.claimed) {
      if (blockedTickets.has(f.id)) continue;
      if (f.retry_after != null && f.retry_after > now) stateOf(f.next_leg).backing_off++;
      else if (f.next_state === 'ready') stateOf(f.next_leg).ready++;
      else stateOf(f.next_leg).waiting++;
    }
  }
  for (const b of blocks) {
    const f = byId.get(b.ticket_id);
    if (!f) continue;
    const leg = b.leg !== '' ? b.leg : f.running_leg ?? f.next_leg;
    if (leg == null) continue;
    const during = f.running_leg != null && f.running_leg === leg && f.running_since != null && b.since >= f.running_since;
    const key = `${b.kind}\u0000${during ? 'during' : 'before'}`;
    const s = stateOf(leg).blocked;
    s.set(key, (s.get(key) ?? new Set()).add(b.ticket_id));
  }

  const queues = new Map(c.core.queues.legs(repo, course).map((q) => [q.leg, q]));
  const intake = row ? c.core.queues.intake(repo, course) : null;
  const stats = c.core.stats.of(repo, opts.since, now);
  const courseStats = stats.courses[course] ?? null;

  // The window's runs of every leg, newest first, with the runner that ran each and the claim's
  // transcripts as repository paths — two statements whatever their number.
  type Run = Record<string, unknown> & { leg: string; claim: number };
  const runsByLeg = new Map<string, Run[]>();
  let runsTruncated = false;
  if (!opts.summary && row) {
    const prefix = `${repo}:`;
    const runs = c.sql<{ claim_id: number; seq: number; leg: string; run_id: string | null; ticket_id: string; runner_id: number; hostname: string | null; session_name: string | null;
      from_station: string; to_station: string | null; started_at: number; finished_at: number | null; abandoned_at: number | null; head_sha: string | null; snapshot_sha: string;
      session_url: string | null; leg_log_dir: string | null; status: string; end_reason: string | null; end_detail: string | null; run: number }>(
      `SELECT l.claim_id, l.seq, l.leg, l.run_id, k.ticket_id, k.runner_id, w.hostname, w.session_name, l.from_station, l.to_station,
              l.started_at, l.finished_at, l.abandoned_at, l.head_sha, k.snapshot_sha, l.session_url, l.leg_log_dir, k.status, k.end_reason, k.end_detail,
              (SELECT COUNT(*) FROM claim_legs x JOIN claims y ON y.id = x.claim_id
                WHERE y.ticket_id = k.ticket_id AND x.leg = l.leg AND (x.claim_id < l.claim_id OR (x.claim_id = l.claim_id AND x.seq <= l.seq))) AS run
       FROM claim_legs l JOIN claims k ON k.id = l.claim_id LEFT JOIN runners w ON w.id = k.runner_id
       WHERE k.course_id = ? AND substr(k.ticket_id, 1, length(?)) = ?
         AND (l.started_at >= ? OR (l.finished_at IS NULL AND l.abandoned_at IS NULL AND k.status = 'active'))
       ORDER BY l.started_at DESC, l.claim_id DESC, l.seq DESC LIMIT ?`, course, prefix, prefix, opts.since, COURSE_RUNS_MAX + 1);
    runsTruncated = runs.length > COURSE_RUNS_MAX;
    const kept = runs.slice(0, COURSE_RUNS_MAX);
    const claimIds = JSON.stringify([...new Set(kept.map((r) => r.claim_id))]);
    const transcripts = new Map<number, { repo: string; path: string; role: string }[]>();
    if (kept.length) {
      for (const t of c.sql<{ claim_id: number; repo: string; path: string; role: string }>(
        'SELECT claim_id, repo, path, role FROM transcripts WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY id', claimIds)) {
        transcripts.set(t.claim_id, [...(transcripts.get(t.claim_id) ?? []), { repo: t.repo, path: t.path, role: t.role }]);
      }
    }
    for (const r of kept) {
      const running = r.status === 'active' && r.finished_at == null && r.abandoned_at == null;
      const run: Run = {
        run: r.run, claim: r.claim_id, seq: r.seq, leg: r.leg, run_id: r.run_id, ticket_id: r.ticket_id,
        runner: r.runner_id, hostname: r.hostname, session_name: r.session_name,
        from: r.from_station, reached: r.to_station, started_at: r.started_at, ended_at: r.finished_at ?? r.abandoned_at ?? null,
        outcome: r.finished_at != null ? 'finished' : r.abandoned_at != null ? 'abandoned' : running ? 'running' : 'ended',
        // The claim's end, as `legs/{leg}/runs` gives it: null while the claim is live.
        end: r.status === 'active' ? null : r.end_reason, claim_end: claimEnd(r.status, r.end_reason), detail: r.end_detail,
        snapshot_sha: r.snapshot_sha, head_sha: r.head_sha,
        // R-BTN-113: stored only where it passed; R-BTN-128: the directory, as text.
        ...opts.sessionLink(r.session_url, r.runner_id), log_dir: r.leg_log_dir,
        transcripts: transcripts.get(r.claim_id) ?? [],
      };
      runsByLeg.set(r.leg, [...(runsByLeg.get(r.leg) ?? []), run]);
    }
  }

  const legs = legNames.map((leg) => {
    const def = isObj(legFile[leg]) ? legFile[leg] : {};
    const q = queues.get(leg);
    const maxQueue = q?.max_queue ?? (typeof def.max_queue === 'number' ? def.max_queue : null);
    const depth = q?.depth ?? 0;
    const s = states.get(leg);
    const st = courseStats?.legs[leg] ?? null;
    return {
      leg, from: names(def.from), to: names(def.to),
      // R-BTN-79: the depth is advice; `over` is this leg past its bound, `intake` the course's.
      queue: { depth, max_queue: maxQueue, over: maxQueue != null && depth > maxQueue, intake },
      state: {
        ready: s?.ready ?? 0, running: s?.running ?? 0, waiting: s?.waiting ?? 0, backing_off: s?.backing_off ?? 0,
        blocked: [...(s?.blocked ?? new Map<string, Set<string>>())].map(([key, tickets]) => {
          const [kind, found] = key.split('\u0000');
          return { kind, found: found as 'before' | 'during', count: tickets.size, ...(opts.summary ? {} : { tickets: [...tickets].sort().slice(0, 50) }) };
        }).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.found < b.found ? -1 : a.found > b.found ? 1 : 0)),
      },
      // The window's figures for the leg, read from `stats` (nothing recomputed): the median
      // wait and run, and the share of the runs started that were given up.
      window: st ? {
        started: st.started, finished: st.finished, abandoned: st.abandoned,
        wait_p50_s: st.waited.median_s, run_p50_s: st.ran.median_s,
        fail_rate: st.started > 0 ? Math.round((st.abandoned / st.started) * 1000) / 1000 : null,
      } : null,
      ...(opts.summary ? {} : { runs: runsByLeg.get(leg) ?? [] }),
    };
  });

  // Each station: the tickets resting there (no live claim), those a claim holds there, and
  // the tickets a finished leg brought there in the last 24 hours.
  const arrived = new Map(c.sql<{ station: string; n: number }>(
    `SELECT l.to_station AS station, COUNT(DISTINCT k.ticket_id) AS n FROM claim_legs l JOIN claims k ON k.id = l.claim_id
     WHERE k.course_id = ? AND substr(k.ticket_id, 1, length(?)) = ? AND l.finished_at >= ? AND l.to_station IS NOT NULL GROUP BY l.to_station`,
    course, `${repo}:`, `${repo}:`, now - DAY).map((r) => [r.station, r.n]));
  const ends = new Set(names(file?.end));
  const stationIndex = new Map(stationNames.map((s, i) => [s, i]));
  const stations = stationNames.map((station) => {
    const here = facts.filter((f) => f.station === station);
    return {
      station, start: file?.start === station, end: ends.has(station),
      resting: here.filter((f) => !f.claimed).length, claimed: here.filter((f) => f.claimed).length,
      arrived_today: arrived.get(station) ?? 0,
    };
  });

  const head = {
    course: { id: course, version: row?.version ?? null, file, skill: row?.skill ?? null, min_runner_version: row?.min_runner_version ?? null },
    refused,
    runners: { declaring: fleet?.declaring ?? 0, alive: fleet?.alive ?? 0 },
    intake,
    legs,
    stations,
    counts: { tickets: facts.length },
    window: { since: opts.since, until: now },
    stats: {
      course: courseStats ? { legs: courseStats.legs, stations: courseStats.stations, intake: courseStats.intake } : null,
      ends: stats.ends, suspensions: stats.suspensions, advice_overridden: stats.advice_overridden,
    },
    off_graph: stats.off_graph,
    server_time: now,
  };
  if (opts.summary) return { ...head, summary: true as const };

  // The page: station in the file's order (a station the file no longer names last), then
  // Baton's order — the rank the board gave, unranked tickets after — then the id.
  const position = (f: Facts): CoursePosition => [stationIndex.get(f.station) ?? stationNames.length, f.rank == null ? 1 : 0, f.rank ?? 0, f.id];
  const ordered = facts.map((f) => ({ f, at: position(f) })).sort((a, b) => compare(a.at, b.at));
  const rest = opts.after ? ordered.filter((x) => compare(x.at, opts.after!) > 0) : ordered;
  const pageRows = rest.slice(0, COURSE_PAGE + 1);
  const page = pageRows.slice(0, COURSE_PAGE);
  const ids = JSON.stringify(page.map((x) => x.f.id));
  const detail = new Map((page.length ? c.sql<{ id: string; title: string; parent: string | null; path: string; next_source: string; handoff_url: string | null }>(
    `SELECT t.id, t.title, t.parent, s.path, s.next_source, s.handoff_url FROM tickets t JOIN ticket_stations s ON s.ticket_id = t.id
     WHERE t.id IN (SELECT value FROM json_each(?))`, ids) : []).map((d) => [d.id, d]));
  const waits = new Map((page.length ? c.sql<{ ticket_id: string; leg: string; waiting_on: string | null; waiting_since: number | null }>(
    `SELECT ticket_id, leg, waiting_on, waiting_since FROM ticket_next_legs WHERE state = 'waiting' AND ticket_id IN (SELECT value FROM json_each(?))`, ids) : [])
    .map((w) => [`${w.ticket_id}\u0000${w.leg}`, w]));
  const claimLegs = new Map<string, Record<string, unknown>[]>();
  if (page.some((x) => x.f.claimed)) {
    for (const l of c.sql<{ ticket_id: string; claim_id: number; leg: string; run_id: string | null; from_station: string; to_station: string | null; started_at: number; finished_at: number | null; abandoned_at: number | null }>(
      `SELECT k.ticket_id, l.claim_id, l.leg, l.run_id, l.from_station, l.to_station, l.started_at, l.finished_at, l.abandoned_at
       FROM claims k JOIN claim_legs l ON l.claim_id = k.id
       WHERE k.status = 'active' AND k.ticket_id IN (SELECT value FROM json_each(?)) ORDER BY k.ticket_id, l.claim_id, l.seq`, ids)) {
      claimLegs.set(l.ticket_id, [...(claimLegs.get(l.ticket_id) ?? []), { claim_id: l.claim_id, leg: l.leg, run_id: l.run_id, from: l.from_station, reached: l.to_station,
        started_at: l.started_at, outcome: l.finished_at != null ? 'finished' : l.abandoned_at != null ? 'abandoned' : 'running' }]);
    }
  }
  // R-BTN-86: a ticket's children, by the local id `tickets.parent` holds.
  const children = new Map<string, string[]>();
  if (page.length) {
    const locals = JSON.stringify(page.map((x) => localId(x.f.id)));
    for (const k of c.sql<{ id: string; parent: string }>(
      `SELECT id, parent FROM tickets WHERE repository_id = ? AND parent IN (SELECT value FROM json_each(?)) ORDER BY id`, repo, locals)) {
      children.set(k.parent, [...(children.get(k.parent) ?? []), k.id]);
    }
  }
  const blocksOf = new Map<string, { leg: string; kind: string; ref: string; since: number; until: number | null }[]>();
  for (const b of blocks) blocksOf.set(b.ticket_id, [...(blocksOf.get(b.ticket_id) ?? []), { leg: b.leg, kind: b.kind, ref: b.ref, since: b.since, until: b.until }]);

  const tickets = page.map(({ f }) => {
    const d = detail.get(f.id);
    const wait = f.next_leg != null ? waits.get(`${f.id}\u0000${f.next_leg}`) : undefined;
    return {
      ticket_id: f.id, title: d?.title ?? null, station: f.station,
      // R-BTN-39: the path is Baton's record — the legs run and the stations they reached.
      path: parsed<{ leg: string; reached: string }[]>(d?.path, []),
      claim_legs: claimLegs.get(f.id) ?? [],
      waits_for: wait ? { leg: wait.leg, on: wait.waiting_on, since: wait.waiting_since } : null,
      // R-BTN-24: the newest hand-off pointer, as text.
      handoff: d?.handoff_url ?? null,
      blocks: blocksOf.get(f.id) ?? [],
      backing_off_until: f.retry_after != null && f.retry_after > now ? f.retry_after : null,
      // R-BTN-83: the queued leg and where the choice came from, as stored.
      next_leg: f.next_leg, source: d?.next_source ?? null,
      parent: d?.parent ?? null, children: children.get(localId(f.id)) ?? [],
    };
  });
  const last = page[page.length - 1];
  return {
    ...head,
    ...(runsTruncated ? { runs_truncated: true as const } : {}),
    tickets,
    next: pageRows.length > COURSE_PAGE && last ? last.at : null,
  };
}
