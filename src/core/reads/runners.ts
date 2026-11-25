// reads/runners.ts — the runner reads (B-196; BATON_SPEC §8.1 R-BTN-3, §8.2 R-BTN-146, §14):
// `GET …/runners` (`repo.runners`), the fleet a repository's readers see — every runner row
// whose key holds a live grant on the repository, and every runner of a seed or bearer key
// (which no grant binds, R-BTN-58) that declares one of the repository's courses — and
// `GET …/runners/{runner}` (`runner.show`), one of them with its profile, the earlier attempts
// on its live ticket's leg and a window of its claims here with their activities.
//
// What a poll costs (B-196 item 3): a constant number of statements however many runner rows
// the repository ever had — one read of the rows, then one read per kind of detail over the
// rows that are neither reaped nor unseen for the longest window, by id list. Latest
// transcripts and reports are narrower: only the live subset gets them (S-BTN-243).
//
// Not served, because the core does not hold them yet (R-BTN-107's executor declaration,
// B-184): a runner's `executor`, a run's `executor_digest`, `environment` and `instance`. The
// answer says so in `not_built` instead of inventing them. A run's `log_dir` is the column as
// stored (`claim_legs.leg_log_dir`), which nothing writes yet (B-23).
import { isLive, leaseEndsAt } from '../runnerLiveness';
import { runnerLatest } from '../runnerLatest';
import { BatonError } from '../http';
import { transcriptUrl, type SessionLinkView } from '../links';
import { graphOf, type Graph } from '../graph';
import { grantedKeySql } from '../validate';
import { queryOf, type ReadCall, type ReadCtx, type ReadRoute } from './kit';
import { sinceOf, WINDOW_MAX_MS } from './window';

/** What the answers name as not built, each with the ticket that builds it. */
export const RUNNERS_NOT_BUILT = { executor: 'B-184' } as const;

/** How a claim ended, in the timeline's six words. */
export type ClaimEnd = 'running' | 'released' | 'silent' | 'reaped' | 'done' | 'suspended';

export function claimEnd(status: string, reason: string | null): ClaimEnd {
  if (status === 'active') return 'running';
  if (status === 'reaped') return reason === 'reaped:silent' ? 'silent' : 'reaped';
  if (status === 'released') return 'released';
  return reason != null && reason.startsWith('suspended:') ? 'suspended' : 'done';
}

export type RunnerClaim = {
  claim_id: number;
  ticket_id: string;
  station: string;
  leg: string | null;
  run_id: string | null;
  claimed_at: number;
  /** When the runner's lease on it lapses unless it heartbeats; null for a legacy runner. */
  lease_ends_at: number | null;
  deadline_at: number | null;
  /** The running leg's run number on the ticket, under any claim; null with no running leg. */
  attempt: number | null;
  /** The leg's `max_runs` in the course file in force; null where it sets none. */
  max_runs: number | null;
  next_backoff_until: number | null;
  session_url: string | null;
  session_link: boolean;
  log_dir: string | null;
  activity: { kind: string; label: string | null; started_at: number } | null;
};

export type RunnerRow = {
  runner_id: number;
  hostname: string;
  session_name: string;
  alive: boolean;
  last_seen_at: number;
  last_activity_at: number | null;
  reaped_at: number | null;
  harness: string;
  kind: string;
  isolation: string;
  tier_ceilings: Record<string, string>;
  /** The runner's own statement (R-BTN-174): each capability with the name it declared it by. */
  capabilities: { capability: string; declared: string }[];
  /** The grant's capabilities on this repository; null for a key no grant binds. */
  granted: string[] | null;
  tags: string[];
  courses: { course: string; version: number; min_runner_version: number | null }[];
  lease_timeout_s: number;
  credential: { kind: string; granted: boolean; role: string | null; domain: string | null };
  last_report: { payload: unknown; sent_at: number } | null;
  transcript_url: string | null;
  claim: RunnerClaim | null;
  /** Every claim it holds on this repository (R-BTN-4), oldest first; `claim` is the first. */
  claims: RunnerClaim[];
  busy_elsewhere: boolean;
  /** For a runner reaped within the longest window: the newest claim on this repository its
   *  reap ended, or null. Null for every other runner. */
  reaped_claim: { claim_id: number; ticket_id: string; ended_at: number | null; end_reason: string | null } | null;
};

type Raw = {
  id: number; hostname: string; session_name: string; harness: string; kind: string; isolation: string; tier_ceilings: string; lease_timeout_ms: number;
  last_seen_at: number; last_activity_at: number | null; reaped_at: number | null; profile_json: string | null;
  credential_kind: string; created_by: string | null; granted: string | null; role: string | null; trust_domain: string | null;
};

const parsed = <T>(text: string | null | undefined, otherwise: T): T => {
  if (text == null) return otherwise;
  try {
    return JSON.parse(text) as T;
  } catch {
    return otherwise;
  }
};

function grouped<T extends { runner_id: number }>(rows: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const r of rows) out.set(r.runner_id, [...(out.get(r.runner_id) ?? []), r]);
  return out;
}

/** The runner rows a repository's readers see, in R-BTN-3's order (hostname, then session
 *  name); `only` narrows it to one runner. */
function rawRows(cx: ReadCtx, repo: string, only: number | null): Raw[] {
  return cx.sql<Raw>(
    `SELECT w.id, w.hostname, w.session_name, w.harness, w.kind, w.isolation, w.tier_ceilings, w.lease_timeout_ms,
            w.last_seen_at, w.last_activity_at, w.reaped_at, w.profile_json,
            k.kind AS credential_kind, k.created_by, g.capabilities AS granted, g.role, g.trust_domain
     FROM runners w JOIN credentials k ON k.id = w.credential_id
     LEFT JOIN runner_grants g ON g.credential_id = w.credential_id AND g.repository_id = ? AND g.revoked_at IS NULL
     WHERE k.revoked_at IS NULL AND (? IS NULL OR w.id = ?)
       AND (g.credential_id IS NOT NULL
         OR ((k.created_by IS NULL OR NOT ${grantedKeySql('k.created_by')})
           AND EXISTS (SELECT 1 FROM runner_courses f WHERE f.runner_id = w.id AND f.repository_id = ?)))
     ORDER BY w.hostname, w.session_name, w.id`, repo, only, only, repo);
}

/** The rows as the reads serve them. */
export function runnerRows(cx: ReadCtx, repo: string, sessionLink: SessionLinkView, only: number | null = null): { rows: RunnerRow[]; profiles: Map<number, unknown> } {
  const now = cx.now();
  const raw = rawRows(cx, repo, only);
  // The detail reads cover the runners a reader can still act on or learn from: not reaped,
  // and seen within the longest window.
  const ids = JSON.stringify(raw.filter((w) => w.reaped_at == null && now - w.last_seen_at <= WINDOW_MAX_MS).map((w) => w.id));
  const some = ids !== '[]';
  const of = <T>(query: string, ...params: unknown[]): T[] => (some ? cx.sql<T>(query, ...params) : []);
  const prefix = `${repo}:`;

  const capabilities = grouped(of<{ runner_id: number; capability: string; declared: string }>(
    'SELECT runner_id, capability, declared FROM runner_capabilities WHERE runner_id IN (SELECT value FROM json_each(?)) ORDER BY capability', ids));
  const tags = grouped(of<{ runner_id: number; tag: string }>(
    'SELECT runner_id, tag FROM runner_tags WHERE runner_id IN (SELECT value FROM json_each(?)) ORDER BY tag', ids));
  const courses = grouped(of<{ runner_id: number; course: string; version: number; min_runner_version: number | null }>(
    `SELECT f.runner_id, f.course_id AS course, f.version, c.min_runner_version
     FROM runner_courses f LEFT JOIN courses c ON c.repository_id = f.repository_id AND c.id = f.course_id
     WHERE f.repository_id = ? AND f.runner_id IN (SELECT value FROM json_each(?)) ORDER BY f.course_id`, repo, ids));
  // Every live claim of these runners, here or elsewhere, with its running leg, that leg's run
  // number on the ticket and the ticket's backoff — one statement.
  const claims = grouped(of<{ runner_id: number; id: number; ticket_id: string; station: string; course_id: string | null; claimed_at: number; deadline_at: number | null;
    leg: string | null; run_id: string | null; session_url: string | null; session_incarnation: number | null; leg_log_dir: string | null; attempt: number | null; retry_after: number | null }>(
    `SELECT c.runner_id, c.id, c.ticket_id, c.station, c.course_id, c.claimed_at, c.deadline_at,
            l.leg, l.run_id, l.session_url, l.session_incarnation, l.leg_log_dir,
            (SELECT COUNT(*) FROM claim_legs x JOIN claims y ON y.id = x.claim_id WHERE y.ticket_id = c.ticket_id AND x.leg = l.leg) AS attempt,
            o.retry_after
     FROM claims c
     LEFT JOIN claim_legs l ON l.claim_id = c.id
       AND l.seq = (SELECT MAX(m.seq) FROM claim_legs m WHERE m.claim_id = c.id AND m.finished_at IS NULL AND m.abandoned_at IS NULL)
     LEFT JOIN ticket_overrides o ON o.ticket_id = c.ticket_id
     WHERE c.status = 'active' AND c.runner_id IN (SELECT value FROM json_each(?)) ORDER BY c.claimed_at, c.id`, ids));
  // §9.9: the newest open activity of each claim — `received_at` breaks a tie.
  const activity = new Map<number, { kind: string; label: string | null; started_at: number; received_at: number }>();
  for (const a of of<{ claim_id: number | null; kind: string; label: string | null; started_at: number; received_at: number }>(
    'SELECT claim_id, kind, label, started_at, received_at FROM activities WHERE ended_at IS NULL AND runner_id IN (SELECT value FROM json_each(?))', ids)) {
    if (a.claim_id == null) continue;
    const best = activity.get(a.claim_id);
    if (!best || a.started_at > best.started_at || (a.started_at === best.started_at && a.received_at > best.received_at)) activity.set(a.claim_id, a);
  }
  const liveIds = JSON.stringify(raw.filter((w) => isLive(w, now)).map((w) => w.id));
  const { transcript, reports } = runnerLatest(cx.sql, liveIds);
  // A runner reaped within the longest window: the newest claim here its reap ended — one
  // statement over those few; an older reap is told from `reaped_at` alone.
  const reapedIds = JSON.stringify(raw.filter((w) => w.reaped_at != null && now - w.reaped_at <= WINDOW_MAX_MS).map((w) => w.id));
  const reaped = new Map<number, { claim_id: number; ticket_id: string; ended_at: number | null; end_reason: string | null }>();
  if (reapedIds !== '[]') {
    for (const c of cx.sql<{ runner_id: number; id: number; ticket_id: string; ended_at: number | null; end_reason: string | null }>(
      `SELECT runner_id, id, ticket_id, ended_at, end_reason FROM claims
       WHERE status = 'reaped' AND runner_id IN (SELECT value FROM json_each(?)) AND substr(ticket_id, 1, length(?)) = ? ORDER BY id`, reapedIds, prefix, prefix)) {
      reaped.set(c.runner_id, { claim_id: c.id, ticket_id: c.ticket_id, ended_at: c.ended_at, end_reason: c.end_reason });
    }
  }
  // The course files in force, for a running leg's `max_runs`: one statement for the repository.
  const graphs = new Map<string, Graph | null>();
  if (some) {
    for (const c of cx.sql<{ id: string; course_json: string }>('SELECT id, course_json FROM courses WHERE repository_id = ?', repo)) {
      let g: Graph | null = null;
      try {
        g = graphOf(JSON.parse(c.course_json));
      } catch {
        g = null;
      }
      graphs.set(c.id, g);
    }
  }

  const profiles = new Map<number, unknown>();
  const rows = raw.map((w): RunnerRow => {
    const mine = claims.get(w.id) ?? [];
    const leaseEnds = w.kind === 'legacy' ? null : leaseEndsAt(w);
    const here = mine.filter((c) => c.ticket_id.startsWith(prefix)).map((c): RunnerClaim => {
      const a = activity.get(c.id);
      return {
        claim_id: c.id, ticket_id: c.ticket_id, station: c.station, leg: c.leg, run_id: c.run_id, claimed_at: c.claimed_at,
        lease_ends_at: leaseEnds, deadline_at: c.deadline_at,
        attempt: c.leg == null ? null : c.attempt,
        max_runs: c.leg != null && c.course_id != null ? graphs.get(c.course_id)?.legs.get(c.leg)?.maxRuns ?? null : null,
        next_backoff_until: c.retry_after != null && c.retry_after > now ? c.retry_after : null,
        ...sessionLink(c.session_url, c.runner_id, c.session_incarnation), log_dir: c.leg_log_dir,
        activity: a ? { kind: a.kind, label: a.label, started_at: a.started_at } : null,
      };
    });
    const t = transcript.get(w.id);
    const report = reports.get(w.id);
    profiles.set(w.id, parsed<unknown>(w.profile_json, null));
    return {
      runner_id: w.id, hostname: w.hostname, session_name: w.session_name,
      alive: isLive(w, now),
      last_seen_at: w.last_seen_at, last_activity_at: w.last_activity_at, reaped_at: w.reaped_at,
      harness: w.harness, kind: w.kind, isolation: w.isolation,
      tier_ceilings: parsed<Record<string, string>>(w.tier_ceilings, {}),
      capabilities: (capabilities.get(w.id) ?? []).map(({ capability, declared }) => ({ capability, declared })),
      granted: w.granted == null ? null : parsed<string[]>(w.granted, []),
      tags: (tags.get(w.id) ?? []).map((x) => x.tag),
      courses: (courses.get(w.id) ?? []).map(({ course, version, min_runner_version }) => ({ course, version, min_runner_version })),
      lease_timeout_s: Math.round(w.lease_timeout_ms / 1000),
      credential: { kind: w.credential_kind, granted: w.granted != null, role: w.role, domain: w.trust_domain },
      last_report: report ? { payload: parsed<unknown>(report.payload_json, null), sent_at: report.sent_at } : null,
      // §6.8: built only from validated parts, never a reported URL.
      transcript_url: t ? transcriptUrl(t.repo, t.path) : null,
      claim: here[0] ?? null,
      claims: here,
      busy_elsewhere: mine.some((c) => !c.ticket_id.startsWith(prefix)),
      reaped_claim: reaped.get(w.id) ?? null,
    };
  });
  return { rows, profiles };
}

/** `{runner}` as the integer `runner_id` it is; anything else names no runner. */
function runnerId(call: ReadCall): number {
  const raw = call.params.runner ?? '';
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) throw new BatonError('not-found', 'no such runner');
  return Number(raw);
}

function showRunner(cx: ReadCtx, call: ReadCall) {
  const repo = call.repository!;
  const q = queryOf(call);
  const now = cx.now();
  const since = sinceOf(q.since, now);
  const id = runnerId(call);
  const { rows, profiles } = runnerRows(cx, repo, call.sessionLink, id);
  const row = rows[0];
  // A runner with no grant on the repository is `not-found`, the same as none (B-196).
  if (!row) throw new BatonError('not-found', 'no such runner');
  const prefix = `${repo}:`;

  // The earlier runs of the live ticket's running leg, under any claim, oldest first.
  const live = row.claim;
  const attempts = live?.leg == null ? [] : cx.sql<{ claim_id: number; runner_id: number; run_id: string | null; started_at: number; finished_at: number | null; abandoned_at: number | null;
    status: string; end_reason: string | null; end_detail: string | null }>(
    `SELECT l.claim_id, c.runner_id, l.run_id, l.started_at, l.finished_at, l.abandoned_at, c.status, c.end_reason, c.end_detail
     FROM claim_legs l JOIN claims c ON c.id = l.claim_id
     WHERE c.ticket_id = ? AND l.leg = ? ORDER BY l.claim_id, l.seq`, live.ticket_id, live.leg)
    .map((r, i) => ({ run: i + 1, claim_id: r.claim_id, runner_id: r.runner_id, run_id: r.run_id, started_at: r.started_at,
      ended_at: r.finished_at ?? r.abandoned_at ?? null, end: r.status === 'active' ? null : r.end_reason, detail: r.end_detail,
      running: r.status === 'active' && r.finished_at == null && r.abandoned_at == null }))
    .filter((r) => !r.running)
    .map(({ running: _running, ...r }) => r);

  // The window: this runner's claims on the repository that were live at any instant since
  // `since` — three statements whatever their number (the claims, their runs, their activities).
  const claims = cx.sql<{ id: number; ticket_id: string; claimed_at: number; ended_at: number | null; status: string; end_reason: string | null; end_detail: string | null }>(
    `SELECT id, ticket_id, claimed_at, ended_at, status, end_reason, end_detail FROM claims
     WHERE runner_id = ? AND substr(ticket_id, 1, length(?)) = ? AND (ended_at IS NULL OR ended_at >= ?)
     ORDER BY claimed_at, id`, id, prefix, prefix, since);
  const claimIds = JSON.stringify(claims.map((c) => c.id));
  const runs = new Map<number, { leg: string; run_id: string | null; started_at: number; ended_at: number | null; reached: string | null; session_url: string | null; session_link: boolean; log_dir: string | null }[]>();
  const activities = new Map<number, Record<string, unknown>[]>();
  if (claims.length) {
    for (const r of cx.sql<{ claim_id: number; leg: string; run_id: string | null; started_at: number; finished_at: number | null; abandoned_at: number | null; to_station: string | null; session_url: string | null; session_incarnation: number | null; leg_log_dir: string | null }>(
      `SELECT claim_id, leg, run_id, started_at, finished_at, abandoned_at, to_station, session_url, session_incarnation, leg_log_dir FROM claim_legs
       WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY claim_id, seq`, claimIds)) {
      runs.set(r.claim_id, [...(runs.get(r.claim_id) ?? []), { leg: r.leg, run_id: r.run_id, started_at: r.started_at, ended_at: r.finished_at ?? r.abandoned_at ?? null,
        reached: r.to_station, ...call.sessionLink(r.session_url, id, r.session_incarnation), log_dir: r.leg_log_dir }]);
    }
    for (const a of cx.sql<{ claim_id: number; id: string; parent_id: string | null; kind: string; label: string | null; source: string; started_at: number; ended_at: number | null; outcome: string | null; detail_json: string | null }>(
      `SELECT claim_id, id, parent_id, kind, label, source, started_at, ended_at, outcome, detail_json FROM activities
       WHERE claim_id IN (SELECT value FROM json_each(?)) ORDER BY claim_id, started_at, rowid`, claimIds)) {
      activities.set(a.claim_id, [...(activities.get(a.claim_id) ?? []), { id: a.id, parent_id: a.parent_id, kind: a.kind, label: a.label, source: a.source,
        started_at: a.started_at, ended_at: a.ended_at, outcome: a.outcome, detail: parsed<unknown>(a.detail_json, null) }]);
    }
  }
  return {
    runner: { ...row, profile: profiles.get(id) ?? null },
    attempts,
    window: {
      since, until: now,
      claims: claims.map((c) => {
        const legs = runs.get(c.id) ?? [];
        const last = legs[legs.length - 1] ?? null;
        return {
          claim_id: c.id, ticket_id: c.ticket_id, leg: last?.leg ?? null, started_at: c.claimed_at, ended_at: c.ended_at,
          end: claimEnd(c.status, c.end_reason), end_reason: c.end_reason, detail: c.end_detail,
          session_url: last?.session_url ?? null, session_link: last?.session_link ?? false, log_dir: last?.log_dir ?? null,
          runs: legs,
          activities: activities.get(c.id) ?? [],
        };
      }),
    },
    not_built: RUNNERS_NOT_BUILT,
    server_time: now,
  };
}

export const RUNNER_READS: ReadRoute[] = [
  {
    // `alive`, the lease's end and a backoff's are the clock's.
    action: 'repo.runners',
    clock: true,
    run(cx, call) {
      queryOf(call);
      return { runners: runnerRows(cx, call.repository!, call.sessionLink).rows, not_built: RUNNERS_NOT_BUILT, server_time: cx.now() };
    },
  },
  { action: 'runner.show', clock: true, run: showRunner },
];
