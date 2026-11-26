// reads/sync.ts — `repo.sync`, the mirror's view of one repository (BATON_SPEC §4.3 R-BTN-11,
// R-BTN-62; §4.7 R-BTN-85; §16.1 R-BTN-28; B-201): the head with its source declaration, the
// observation counter and an outstanding number's age, the sync's last recorded post, the
// dispatches Baton sent for it, the held posts, the mode, the pending adoptions (an
// administrator's alone) and the discrepancies of a window. Every section is rows Baton holds;
// a read writes nothing.
//
// What is not stored, and so not served: a want as R-BTN-94 words it (the wants of a
// transaction live in memory until its dispatch is sent — the stamps of what was sent are
// served under `dispatch`), and a post refused before it was judged (`head-moved`,
// `stale-observation`, an invalid body) — only an accepted post and a held one leave an event.
// `not_built` names both.
import { BatonError } from '../http';
import { OBSERVATION_TTL_MS } from '../observations';
import { DISCREPANCY_WINDOW_MS } from '../history';
import { isAdministrator } from './conditions';
import { queryOf, type ReadCall, type ReadCtx, type ReadRoute } from './kit';
import type { Row } from '../ports';
import { unpinnedSourceWarning } from '../board';

/** `?since=` reaches back at most this far (B-201). */
export const SYNC_SINCE_MAX_MS = 30 * 86_400_000;
/** The discrepancies a page of the read carries, newest first. */
const DISCREPANCY_ROWS_MAX = 200;

function sinceOf(raw: string | undefined, now: number): number {
  if (raw === undefined) return now - DISCREPANCY_WINDOW_MS;
  const at = /^\d{4}-\d{2}-\d{2}T/.test(raw) ? Date.parse(raw) : NaN;
  if (!Number.isFinite(at) || at > now) throw new BatonError('invalid-params', 'since: must be an ISO time not in the future');
  if (at < now - SYNC_SINCE_MAX_MS) throw new BatonError('invalid-params', 'since: at most 30 days back');
  return at;
}

function detailOf(text: string | null): Record<string, unknown> {
  try {
    const v = JSON.parse(text ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The registry ids of the Sync screen's controls this caller may use on the repository as it
 *  stands — a drawing hint (B-191's `allowed` rule), decided again on each call. Only a
 *  dashboard session calls them, and only an administrator's exists (B-76 adds the owner's:
 *  `repo.resync` and `repo.accept-post` on its own repositories). */
function allowedOf(call: ReadCall, state: { syncWorkflow: boolean; shadow: boolean; held: number; adoptions: number }): string[] {
  const p = call.principal;
  if (p.kind !== 'session' || p.role !== 'administrator') return [];
  return [
    ...(state.syncWorkflow ? ['repo.resync'] : []),
    ...(state.held > 0 ? ['repo.accept-post'] : []),
    ...(state.shadow ? ['repo.cutover'] : []),
    ...(state.adoptions > 0 ? ['adoption.confirm'] : []),
  ];
}

export const SYNC_READS: ReadRoute[] = [
  {
    // An outstanding number's age, a held post's auto-accept and the window are the clock's.
    action: 'repo.sync',
    clock: true,
    run(cx: ReadCtx, call: ReadCall) {
      const q = queryOf(call);
      const repository = call.repository!;
      const now = cx.now();
      const since = sinceOf(q.since, now);
      const repo = cx.core.registry.live(repository)!;
      const administrator = isAdministrator(call.principal);

      const h = cx.sql<{ sha: string | null; observation: number; last_handed_out: number; handed_out_at: number | null; source_kind: string | null; source_versions: string | null;
        parent_sha: string | null; received_at: number | null; ticket_count: number | null; course_sources_json: string | null }>(
        `SELECT h.sha, h.observation, h.last_handed_out, h.handed_out_at, h.source_kind, h.source_versions, s.parent_sha, s.received_at, s.ticket_count, s.course_sources_json
         FROM board_head h LEFT JOIN board_snapshots s ON s.repository_id = h.repository_id AND s.sha = h.sha WHERE h.repository_id = ?`, repository)[0] ?? null;
      const head = h?.sha
        ? { sha: h.sha, parent_sha: h.parent_sha, received_at: h.received_at, ticket_count: h.ticket_count, observation: h.observation,
            source: h.source_kind ? { kind: h.source_kind, versions: h.source_versions } : null,
            // B-315 (R-BTN-134): each branch source, the commit read, and the owner's warning.
            ...(h.course_sources_json ? { course_sources: Object.fromEntries(Object.entries(JSON.parse(h.course_sources_json) as Record<string, { branch: string; sha: string }>)
              .map(([course, s]) => [course, { ...s, warning: unpinnedSourceWarning(course, s) }])) } : {}) }
        : null;
      // R-BTN-62: the number handed out and not yet posted, with its age; past ten minutes it
      // is void, and the next sync is handed the next one.
      const outstanding = h?.handed_out_at != null
        ? { number: h.last_handed_out, handed_out_at: h.handed_out_at, age_s: Math.max(0, Math.floor((now - h.handed_out_at) / 1000)), void: now - h.handed_out_at >= OBSERVATION_TTL_MS }
        : null;

      // The sync's last post Baton recorded: accepted, or held (`snapshot-rejected`).
      const post = cx.sql<{ at: number; kind: string; detail_json: string | null }>(
        `SELECT at, kind, detail_json FROM events WHERE kind IN ('snapshot-accepted', 'snapshot-rejected') AND repository_id = ? AND actor = 'sync'
         ORDER BY at DESC, seq DESC LIMIT 1`, repository)[0];
      const postDetail = post ? detailOf(post.detail_json) : {};
      const last_post = post
        ? { at: post.at, sha: typeof postDetail.sha === 'string' ? postDetail.sha : null, accepted: post.kind === 'snapshot-accepted',
            ...(post.kind === 'snapshot-rejected' ? { code: 'snapshot-rejected' } : {}) }
        : null;

      // R-BTN-73, R-BTN-94: what Baton sent — the webhook path's last sync dispatch and its
      // 30-second window, and the forge's last refusal of a dispatch inside the window read.
      const stamp = cx.sql<{ last_dispatch_at: number }>('SELECT last_dispatch_at FROM webhook_syncs WHERE repository_id = ?', repository)[0] ?? null;
      const window = cx.sql<{ last_dispatch_at: number; trailing_at: number | null }>('SELECT last_dispatch_at, trailing_at FROM webhook_dispatch WHERE repository_id = ?', repository)[0] ?? null;
      // A session's resync is an `admin` event (`act: resync`, B-201); the last one inside the window read.
      const asked = cx.sql<{ at: number }>(
        `SELECT at FROM events WHERE kind = 'admin' AND at > ? AND repository_id = ? AND json_extract(detail_json, '$.act') = 'resync' ORDER BY at DESC, seq DESC LIMIT 1`,
        since, repository)[0] ?? null;

      const held = cx.sql<Row>(
        `SELECT sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at, accepted_at FROM held_snapshots
         WHERE repository_id = ? ORDER BY received_at`, repository);
      const waiting = held.filter((x) => x.accepted_at == null).length;

      const mode = cx.core.runners.mode(repository);
      const adoptions = administrator ? (cx.core.cutover.adoptions() as Row[]).filter((a) => typeof a.ticket_id === 'string' && a.ticket_id.startsWith(`${repository}:`)) : null;

      // R-BTN-85: the disagreements with git inside the window, newest first, each with the
      // stored `{sub, baton, git, observation}`; a refused dispatch is logged beside them with
      // its own fields (`kind`, `workflow`, `reason`).
      const events = cx.sql<{ seq: number; ticket_id: string | null; claim_id: number | null; at: number; detail_json: string | null }>(
        `SELECT seq, ticket_id, claim_id, at, detail_json FROM events WHERE kind = 'discrepancy' AND at > ? AND repository_id = ?
         ORDER BY at DESC, seq DESC LIMIT ?`, since, repository, DISCREPANCY_ROWS_MAX + 1);
      const rows = events.slice(0, DISCREPANCY_ROWS_MAX).map((e) => ({ id: e.seq, ticket_id: e.ticket_id, claim_id: e.claim_id, at: e.at, ...detailOf(e.detail_json) }));
      const by_kind = Object.fromEntries(cx.sql<{ sub: string | null; n: number }>(
        `SELECT COALESCE(json_extract(detail_json, '$.sub'), json_extract(detail_json, '$.kind')) AS sub, COUNT(*) AS n FROM events
         WHERE kind = 'discrepancy' AND at > ? AND repository_id = ? GROUP BY sub ORDER BY sub`, since, repository)
        .map((r) => [r.sub ?? 'unknown', r.n]));
      const refused = rows.find((r) => (r as Record<string, unknown>).kind === 'dispatch-refused') as (Record<string, unknown> & { at: number }) | undefined;

      return {
        repository,
        head,
        observation: { last: h?.observation ?? 0, last_handed_out: h?.last_handed_out ?? 0, outstanding },
        last_post,
        dispatch: {
          sync_workflow: repo.sync_workflow || null,
          mirror_workflow: repo.mirror_workflow ?? null,
          last_sync_dispatch_at: stamp?.last_dispatch_at ?? null,
          window: window ? { last_dispatch_at: window.last_dispatch_at, trailing_at: window.trailing_at } : null,
          last_resync_request_at: asked?.at ?? null,
          last_refusal: refused ? { at: refused.at, workflow: refused.workflow ?? null, reason: refused.reason ?? null } : null,
        },
        held,
        mode: { mode: mode.mode, cutover_at: 'cutover_at' in mode ? mode.cutover_at : null },
        ...(adoptions ? { adoptions } : {}),
        discrepancies: { since, by_kind, rows, truncated: events.length > DISCREPANCY_ROWS_MAX },
        allowed: allowedOf(call, { syncWorkflow: !!repo.sync_workflow, shadow: mode.mode === 'shadow', held: waiting, adoptions: adoptions?.length ?? 0 }),
        not_built: { wants: 'R-BTN-94', refused_posts: 'B-201', force_resync: 'R-BTN-11', owner_session: 'B-76' },
        server_time: now,
      };
    },
  },
];
