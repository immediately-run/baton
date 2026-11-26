// sync.ts — accepting a repository's board post and reading its sync record.
import type { BatonCore } from './baton';
import type { Dispatch, DispatchTarget, Workflow } from './ports';
import { DEFAULT_COURSE, resolveParents, rowFor, rowForTicket, rowHash, stationOf, type BoardPayload, type PostedStation, type TicketRow } from './board';
import { BatonError } from './http';
import { nonScheduling, schedulingVersion } from './stateVersion';
import { checkConfirmations } from './validate';
import { checkCrossBoardCycle, checkCrossRepository } from './dependencies';
import { qualify, tierPosition, type Repository } from './registry';
import { sha256HexSync } from './policy';
import { logEvent } from './db';
import { DispatchRefused } from './mirror';
import { adjustCounts } from './capacity';
import type { ClosingPosition, Seen } from './stations';

const HELD_AUTO_ACCEPT_MS = 24 * 3_600_000; // R-BTN-11: measured from the first post of the held history.

type BoardPostCore = Pick<BatonCore, 'store' | 'sql' | 'now' | 'observations' | 'claims' | 'ownerState' | 'stations' | 'blocks' | 'courses' | 'policies' | 'questions' | 'history' | 'provenance' | 'queues' | 'admin' | 'registry' | 'conditions'>;

/** A repository's head snapshot (R-BTN-11, per repository), or null before its first. */
export function headOf(core: Pick<BatonCore, 'sql'>, repo: string): string | null {
  return core.sql<{ sha: string | null }>('SELECT sha FROM board_head WHERE repository_id = ?', repo)[0]?.sha ?? null;
}

/** `GET /v1/sync/head`: the repository's head snapshot and its completions waiting for
 *  confirmation. */
export function head(core: Pick<BatonCore, 'sql'>, repo: string) {
  const unconfirmed = core.sql(
    `SELECT c.id AS claim_id, c.ticket_id, c.end_reason, c.ended_at_sha FROM claims c
     WHERE c.status = 'completed' AND c.confirmed_at IS NULL AND substr(c.ticket_id, 1, length(?) + 1) = ? || ':' ORDER BY c.id`, repo, repo);
  return { sha: headOf(core, repo), unconfirmed };
}

/**
 * `POST /v1/sync/board` (R-BTN-11): accepted only when `parent_sha` is the current head (or
 * null while there is none); a lost race is `head-moved`. `force` — a rewritten `main` — is
 * held for the owner as a `snapshot-rejected` event and moves nothing else; accepting it
 * is the alarm's and the dashboard's job (R3-1212). A repeat of the head is a no-op.
 *
 * `held_snapshots` holds one row per hold, against the current head (R3-1223): rows held
 * against a head are deleted when the head moves, so a later force post of the same sha —
 * a rewind to a once-accepted history included — is a fresh hold with a fresh row. The 0001
 * schema's "written once" and "the first force post" describe that one hold.
 */
export async function board(core: BoardPostCore, repo: Repository, p: BoardPayload, hashRows: typeof rowsFor, issuer: string | null = null) {
  // Course graphs are read per post: a registry applied, or a post refused after applying one,
  // must not leave another request reading a graph that is not in force.
  core.stations.reset();
  try {
    return await boardPost(core, repo, p, hashRows, issuer);
  } finally {
    core.stations.reset();
  }
}

// @model syncPost sha256:7c0efc930fe7
async function boardPost(core: BoardPostCore, repo: Repository, p: BoardPayload, hashRows: typeof rowsFor, issuer: string | null) {
  const r = repo.id;
  // R-BTN-62: the post's number is used first, whatever becomes of the post; an older reading
  // than the last accepted one, or a void or used number, is refused whole here.
  const n = p.observation;
  core.observations.use(r, n, issuer);
  // B-183 (§4.4, R-BTN-184): the `tickets-approved` guarantee is defined over a ticket file's
  // approval — a source that reads only as it is now has no file to approve, so its post to a
  // repository whose policy's floors include the guarantee is refused, naming it. What approval
  // means for a tracker source is a later ticket's.
  refuseCurrentUnderApprovalFloor(core, repo, p);
  const head = headOf(core, r);
  const at = core.now();
  const normative = p.tickets !== undefined;
  const ticketCount = normative ? p.tickets!.length : p.state!.items.length;
  // B-113 (§4.4): the post's live tickets' cross-repository `depends_on`, as the checks below
  // take them — the normative post's live ones (closed by the post is not live), the interim
  // post's items, all live. Judged inside each path's transaction, before anything is written.
  const liveDeps = normative
    ? (() => { const live = new Set(p.tickets!.map((t) => t.id)); for (const c of p.closed ?? []) live.delete(c.id); return p.tickets!.filter((t) => live.has(t.id)).map((t) => ({ id: t.id, depends_on: t.depends_on })); })()
    : p.state!.items.map((it) => ({ id: it.id, depends_on: it.dependsOn ?? [] }));
  // The interim post's confirmations (docs until R3-1233; R-BTN-10 derives them from stations
  // and closures for the normative post), only for its own repository's completions (R-BTN-47).
  const confirmations = normative ? [] : core.claims.ownConfirmations(r, checkConfirmations(p.confirmations));
  // A held history the owner (or the 24-hour clock) accepted becomes the head on its next post.
  const accepted = !!p.force && core.claims.acceptedLine(r, head);
  if (p.force && !accepted) {
    // R-BTN-62: a held post's stations, paths, next legs and closures — which no commit orders —
    // are a refresh against the current head, its number being newer, so confirmations and
    // staleness do not stall for the hold's 24 hours. Its interim confirmations likewise.
    core.store.transaction(() => {
      core.observations.accept(r, n);
      const seen = normative ? refreshStations(core, r, p, n, at, null, true) : new Map<string, Seen>();
      core.claims.confirm(confirmations, n);
      core.claims.judge(r, n, seen, core.claims.evidenceOf(r, p.attestations));
      core.store.exec('UPDATE held_snapshots SET observation = ? WHERE repository_id = ? AND sha = ?', n, r, p.sha);
    });
    // Held once per sha: a repeat (the sync re-posts every 15 minutes) changes nothing, so
    // the first deadline stands and the dashboard lists it once. Every row is a hold against
    // the current head (rows held against a head are deleted when it moves, below), so a row
    // for this sha is this hold; with none, this is a new one — including a rewind to a sha
    // the owner once accepted, whose old row went when its line became the head (R3-1223).
    const known = core.sql<{ auto_accept_at: number }>('SELECT auto_accept_at FROM held_snapshots WHERE repository_id = ? AND sha = ?', r, p.sha)[0];
    const deadline = known?.auto_accept_at ?? at + HELD_AUTO_ACCEPT_MS;
    if (!known) {
      core.store.transaction(() => {
        core.store.exec('INSERT INTO held_snapshots (repository_id, sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at, observation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          r, p.sha, p.parent_sha, head, ticketCount, at, deadline, n);
        event(core, r, 'snapshot-rejected', { sha: p.sha, parent_sha: p.parent_sha, head, ticket_count: ticketCount, auto_accept_at: deadline }, at);
      });
    }
    throw new BatonError('snapshot-rejected', `a rewritten history is held for the owner until ${new Date(deadline).toISOString()}; claims continue on the current head`);
  }
  // B-287: hash the validated reading, not its observation number. A tracker can change at
  // the same Git head. The scheduling version also invalidates this shortcut after any
  // server-side matching/position change. No incoming digest is trusted.
  const { observation: _observation, ...snapshotInputs } = p;
  const fingerprint = sha256HexSync(JSON.stringify(snapshotInputs));
  const remember = () => core.store.exec(`INSERT INTO sync_fingerprints (repository_id, digest, scheduling_v)
    VALUES (?, ?, ?) ON CONFLICT(repository_id) DO UPDATE SET digest = excluded.digest, scheduling_v = excluded.scheduling_v
    WHERE sync_fingerprints.digest IS NOT excluded.digest OR sync_fingerprints.scheduling_v IS NOT excluded.scheduling_v`,
    r, fingerprint, schedulingVersion(core.store));
  if (p.sha === head && normative && !p.force) {
    const prior = core.sql<{ digest: string; scheduling_v: number }>('SELECT digest, scheduling_v FROM sync_fingerprints WHERE repository_id = ?', r)[0];
    if (prior?.digest === fingerprint && prior.scheduling_v === schedulingVersion(core.store)) {
      return core.store.transaction(() => {
        core.observations.accept(r, n);
        // The snapshot is identical but a later observation may now confirm a completion
        // or judge a run whose observation equalled the previous snapshot's. Read only those
        // claims' placements, preserving a Baton-owned position instead of replaying git.
        const relevant = core.sql<{ ticket_id: string }>(`SELECT ticket_id FROM claims INDEXED BY claims_holding
          WHERE (status = 'active' OR (status = 'completed' AND confirmed_at IS NULL) OR (status = 'reaped' AND fence_pending = 1))
            AND ticket_id >= ? || ':' AND ticket_id < ? || ';'
          UNION SELECT c.ticket_id FROM claim_legs l INDEXED BY claim_legs_unjudged CROSS JOIN claims c ON c.id = l.claim_id
            WHERE l.bars != '[]' AND l.bars_judged = 0 AND c.ticket_id >= ? || ':' AND c.ticket_id < ? || ';'`, r, r, r, r);
        const ids = JSON.stringify(relevant.map((x) => x.ticket_id));
        const seen = new Map<string, Seen>();
        if (relevant.length) for (const st of core.sql<{ ticket_id: string; station: string; path: string }>(
          'SELECT ticket_id, station, path FROM ticket_stations WHERE ticket_id IN (SELECT value FROM json_each(?))', ids)) {
          const posted = p.stations?.[st.ticket_id.slice(r.length + 1)];
          if (posted) seen.set(st.ticket_id, { station: st.station, path: JSON.parse(st.path), prev: JSON.parse(st.path), bars: posted.bars });
        }
        nonScheduling(core.store, () => core.store.exec('UPDATE board_head SET stations_observation = ? WHERE repository_id = ?', n, r));
        settleSpawned(core, r, p, n, at);
        const confirmed = core.claims.confirm(confirmations, n);
        const judged = core.claims.judge(r, n, seen, core.claims.evidenceOf(r, p.attestations));
        remember();
        return { ok: true, unchanged: true, ...(p.read_sha === p.sha ? { tickets_upserted: 0, tickets_deleted: 0 } : {}),
          confirmed: confirmed + judged.confirmed, stale_released: judged.stale_released };
      });
    }
  }
  if (p.sha === head) {
    // §4.3 step 4 (R-BTN-11): a refresh — the head's own reading again under a newer number,
    // its stations, paths, next legs and closures replaced; its registry is not applied: the
    // sync builds that body at the commit it fetched, which may be an ancestor of the head, and
    // an older registry would roll a course back. A refresh is a reading like any other: it
    // confirms ends and judges claims made before its number (R-BTN-62, R-BTN-35), not only the
    // post that moved the head.
    // B-183: a source may change a ticket with no commit, so a refresh may now add, close or
    // change any ticket whose `version` differs from the row Baton holds — materialization
    // upserts by `row_hash`, `version` among its inputs. But only a body read at the head it
    // refreshes (`read_sha`, §4.4): a confirm-only re-post from a checkout behind the head
    // (§7.1) is labelled with the head's sha while its tickets were read at the ancestor, and
    // writing them would roll the cache back — so a refresh naming another commit's read, or
    // none (an older CLI's), changes no ticket row, exactly as before B-183. The markdown
    // source's versions are blob ids, so no version changes without a new commit and its
    // refreshes still write no ticket row.
    const readAtHead = normative && p.read_sha === p.sha;
    const refreshed = readAtHead ? await hashRows(repo, p) : null;
    return core.store.transaction(() => {
      // The row hashes were awaited after the number was used, so another run may have posted
      // meanwhile (round 1, finding 2): this reading must still be the newest, over the head it
      // was judged against — the same two re-checks the new-head path performs after its
      // identical await. `accept` would no-op on a newer accepted number, but `rememberSource`
      // would regress the stored declaration and `materialize` would overwrite the newer post's
      // rows with this older reading's and drop every ticket it added.
      if (!core.observations.newest(r, n)) throw new BatonError('stale-observation', `a newer reading than ${n} was accepted while this post was judged; take a new number and retry (R-BTN-62)`);
      if (headOf(core, r) !== head) throw new BatonError('head-moved', `the head moved to ${headOf(core, r) ?? 'unset'} while this post was judged; re-read it and retry`);
      core.observations.accept(r, n);
      if (readAtHead) rememberSource(core, r, p);
      // B-127: the record rides a refresh too (the latest post's word stands); the head has not
      // moved, so no `unsigned-control` event is raised for it again.
      applyControl(core, r, p, at, head);
      let wrote: { upserted: string[]; deleted: number; renumbered: { from: string; to: string; key: string }[]; closingPositions: Map<string, ClosingPosition> } | null = null;
      if (refreshed) {
        // B-113: a refresh that writes rows may change `depends_on` too (a source whose store
        // moves with no commit, B-183), so its cross-repository edges are judged as a new
        // head's are — resolved, consented, no cycle across boards — before anything is written.
        checkQualifiedDependencies(core, r, liveDeps);
        // Every ticket a refresh writes must name a course in force (R-BTN-48, R-BTN-69, round
        // 1 finding 3) — the same per-ticket check the new-head path runs, without applying the
        // registry the body carries (an older one would roll a course back, above).
        requireCoursesInForce(core, r, refreshed.map(({ row }) => row.course_id));
        checkPrerequisiteLegs(core, r, p);
        wrote = materialize(core, r, refreshed, p.sha, at, new Set((p.closed ?? []).map((c) => c.id)));
        // A live ticket is not closed (stations.ts, R-BTN-12): a refresh that re-adds a
        // withdrawn ticket clears its closure row, as a new head does (round 1, finding 4) —
        // withdraw-and-reopen with no commit is the tracker flow this ticket builds for.
        core.stations.reopened(r, refreshed.map(({ row }) => row.id));
      }
      const seen = normative ? refreshStations(core, r, p, n, at, wrote) : new Map<string, Seen>();
      const confirmed = core.claims.confirm(confirmations, n);
      const judged = core.claims.judge(r, n, seen, core.claims.evidenceOf(r, p.attestations));
      remember();
      return {
        ok: true, unchanged: true,
        ...(wrote ? { tickets_upserted: wrote.upserted.length, tickets_deleted: wrote.deleted, ...(wrote.renumbered.length ? { renumbered: wrote.renumbered } : {}) } : {}),
        confirmed: confirmed + judged.confirmed, stale_released: judged.stale_released,
      };
    });
  }
  if (!accepted && p.parent_sha !== head) throw new BatonError('head-moved', `the head is ${head ?? 'unset'}; re-read it and retry`);

  // Hash every row before the transaction: the digest is async, the transaction is not.
  const rows = await hashRows(repo, p);
  const changed: { upserted: number; deleted: number; renumbered?: { from: string; to: string; key: string }[]; confirmed?: number; stale_released?: number; courses_refused?: string[]; dropped?: string[] } = { upserted: 0, deleted: 0 };
  core.store.transaction(() => {
    // The row hashes were awaited after the number was used, so another run may have posted
    // meanwhile: this reading must still be the newest, over the head it was judged against.
    if (!core.observations.newest(r, n)) throw new BatonError('stale-observation', `a newer reading than ${n} was accepted while this post was judged; take a new number and retry (R-BTN-62)`);
    if (headOf(core, r) !== head) throw new BatonError('head-moved', `the head moved to ${headOf(core, r) ?? 'unset'} while this post was judged; re-read it and retry`);
    // B-113 (§4.4): every cross-repository `depends_on` resolves — a live-registered target,
    // a ticket live or closed there, a target at least as visible as this repository or its
    // owners' consent — and no cycle runs through two boards. Before anything is written, so
    // a refused post leaves the head and every row as they were.
    checkQualifiedDependencies(core, r, liveDeps);
    // The course registry first (R-BTN-48, R-BTN-69): every ticket must name a course in
    // force, and a refused file with none to keep refuses the whole post.
    const refused = applyRegistry(core, r, p, rows.map(({ row }) => row.course_id), at);
    checkPrerequisiteLegs(core, r, p);
    if (refused.length) changed.courses_refused = refused;
    const legsBefore = queuedLegs(core, r);
    // The repository's own tickets, keyed by their local ids (R-BTN-47) — upserts by
    // `row_hash`, drops by what the post no longer names, renumberings by `key` (B-183).
    const wrote = materialize(core, r, rows, p.sha, at, new Set((p.closed ?? []).map((c) => c.id)));
    changed.upserted = wrote.upserted.length;
    changed.deleted = wrote.deleted;
    if (wrote.renumbered.length) changed.renumbered = wrote.renumbered;
    const upserted = wrote.upserted;
    // Where each ticket is (R-BTN-70): the normative post's stations, or the interim post's
    // placement at each course's start; and the closures it reports (R-BTN-10).
    const stations = normative
      ? new Map(Object.entries(p.stations ?? {}).map(([id, st]) => [id, stationOf(st)] as [string, PostedStation]))
      : core.stations.interim(r, p.state!.items.map((it) => ({ id: it.id, course: it.course ?? DEFAULT_COURSE, node: it.node })));
    // A live ticket the post does not place is placed nowhere: it is not offered on old data.
    for (const { row } of rows) if (!stations.has(row.id)) core.stations.clear(qualify(r, row.id));
    core.stations.reopened(r, rows.map(({ row }) => row.id));
    // R-BTN-86 (§4.6): the children a `spawned` end reported, judged by this reading — each
    // one it does not post is dropped with discrepancy `spawned-unposted` (R-BTN-85); and the
    // import's pending ticket-scoped rows, applied to the tickets this post creates.
    settleSpawned(core, r, p, n, at);
    core.ownerState.applyPending(r, new Set(rows.map(({ row }) => row.id)), stations, at, true);
    core.claims.confirmOutputs(r, p.attestations ?? []);
    const seen = core.stations.apply(r, p.sha, n, stations, p.closed ?? [], at, wrote.closingPositions);
    // R-BTN-116: the questions the post carries for its queued person legs (§4.4), then the
    // sync's attestations (R-BTN-191) — a person leg's answer, read from the ticket's
    // `answer:` — applied as the leg's arrival (R-BTN-39), which may move the ticket before
    // the blocks are re-evaluated below.
    core.questions.posted(r, p.tickets ?? [], new Set(stations.keys()));
    core.questions.attestations(r, p.attestations ?? []);
  core.conditions.missingNext(r, core.stations.missingNext(r), at);
  core.conditions.contractWaits(r, at);
    // B-129 (R-BTN-85, both values): a post whose ticket frontmatter says `available` while
    // the ticket is past its course's start — the snapshot implying a position Baton has
    // moved past, the false `available`/`prs: []` of the 2026-10-27 release — is a
    // discrepancy. Under B-120 it moves nothing; until then it is at least named.
    notePositionDisagreements(core, r, p, seen, n);
    // R-BTN-75–78: the snapshot's causes — `blocked_by`, `requires`, `needs`, `decisions` and
    // where each ticket is queued — rewrite the changed tickets' blocks in this transaction.
    const dropped = applyBlocks(core, r, stations, upserted, legsBefore, changed.deleted > 0, !!p.registry);
    if (dropped.length) changed.dropped = dropped.slice(0, 100);
    core.store.exec('INSERT INTO board_snapshots (repository_id, sha, parent_sha, received_at, ticket_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repository_id, sha) DO NOTHING', r, p.sha, p.parent_sha, at, ticketCount);
    core.store.exec('INSERT INTO board_head (repository_id, sha) VALUES (?, ?) ON CONFLICT (repository_id) DO UPDATE SET sha = excluded.sha', r, p.sha);
    // B-127: the post's signed-control record stands for the repository (the latest post's
    // word on what counts), and a post that moved the head onto unsigned control inputs —
    // while the repository requires them signed — raises one `unsigned-control` event under
    // Needs you, naming the paths and the commits. A refresh carries the record again and
    // raises nothing new: the head it would name has not moved.
    applyControl(core, r, p, at, head);
    rememberSource(core, r, p);
    // A hold is against one head (R3-1223): when the head moves — an accepted rewrite or a
    // plain fast-forward — every row held against the head it leaves is retired, answered or
    // not. Left in place, an accepted row would accept a NEW rewrite silently whenever the
    // head came back to that sha; an unanswered one is moot (main moved on), and a re-post of
    // its sha is held afresh. So every row left is a hold against the current head. Their
    // history stays in the events.
    core.store.exec('DELETE FROM held_snapshots WHERE repository_id = ? AND head_sha IS ?', r, head);
    event(core, r, 'snapshot-accepted', { sha: p.sha, parent_sha: p.parent_sha, ticket_count: ticketCount, ...changed, ...(accepted ? { held: true } : {}) }, at);
    // R-BTN-194 and R-BTN-187: ticket provenance and control notices share the server's
    // push chain. Neither gates the post or relies on what the sync says changed.
    const control = core.policies.current(r)?.policy.paths.control;
    core.provenance.advance(repo, head, p.sha, at, rows.map(({ row }) => row), new Set(upserted.map((id) => id.slice(r.length + 1))), control != null && control !== 'any');
    core.observations.accept(r, n);
    const confirmed = core.claims.confirm(confirmations, n);
    // R-BTN-10, R-BTN-35, §2e: git confirms ends, takes tickets away and goes backwards.
    const judged = core.claims.judge(r, n, seen, core.claims.evidenceOf(r, p.attestations));
    changed.confirmed = confirmed + judged.confirmed;
    changed.stale_released = judged.stale_released;
    remember();
  });
  return { ok: true, ...changed };
}

/** B-127 (R-BTN-66 as amended, §7.1): the post's signed-control record — what the sync found
 *  about owner-signed control inputs at this commit — stands for the repository, and a post
 *  that moved the head (`from` is the head it left) onto unsigned control inputs raises one
 *  `unsigned-control` event under Needs you while the repository requires them signed, naming
 *  the paths and the commits. Round 1 (re-firing): only entries the owner has not already
 *  been told raise it — a newly listed path, or the same path under a new unsigned commit —
 *  so one standing unsigned change does not re-notice on every later head move, and opting
 *  the setting on still notices what stands. Round 2: the witness is every notice the
 *  window holds, not the last one — the last event names only what was fresh at its own
 *  head, and once two notices have named different sets (event k naming A, event k+1 naming
 *  B) a last-only dedupe alternated A, B, A, B on every later head move, forever; the union
 *  also carries entries a single event's 50-line display slice left out, so they do not
 *  rotate back in as news. The record is the sync's computation: the paths and signatures
 *  are B-137's to move server-side over the raw commits; the groups a runner loads from are
 *  verified by each runner before it loads them, never only by the sync that posts
 *  them. */
function applyControl(core: Pick<BatonCore, 'store' | 'sql'>, r: string, p: BoardPayload, at: number, from: string | null): void {
  if (p.control !== undefined) {
    core.store.exec(`INSERT INTO signed_control (repository_id, sha, control_json, updated_at) VALUES (?, ?, ?, ?)
                     ON CONFLICT (repository_id) DO UPDATE SET sha = excluded.sha, control_json = excluded.control_json, updated_at = excluded.updated_at`,
      r, p.sha, JSON.stringify(p.control), at);
  }
  if (from == null || from === p.sha || p.control === undefined) return;
  if (!p.control.unsigned.length) return;
  const required = !!core.sql<{ flag: number }>('SELECT require_signed_control AS flag FROM repositories WHERE id = ?', r)[0]?.flag;
  if (!required) return;
  // Round 2: every prior notice in the view's window (7 days, the same 100 the Needs-you
  // view reads) is the witness — see the comment above. The previous control record is NOT
  // the witness: while the setting was off nothing was raised, and opting in must still
  // notice what stands; an unreadable event says nothing — the event fires.
  const seen = new Set<string>();
  for (const prior of core.sql<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'unsigned-control' AND repository_id = ? AND at > ? ORDER BY at DESC, seq DESC LIMIT 100`, r, at - 7 * 86_400_000)) {
    try {
      for (const u of (JSON.parse(prior.detail_json) as { changes?: { path: string; commits: string[] }[] }).changes ?? []) seen.add(`${u.path}\u0000${u.commits.join(',')}`);
    } catch {
      // Unreadable: nothing from this event is known to have been noticed.
    }
  }
  const fresh = p.control.unsigned.filter((u) => !seen.has(`${u.path}\u0000${u.commits.join(',')}`));
  const changes = fresh.slice(0, 50);
  if (!changes.length) return;
  logEvent(core.store, at, 'unsigned-control', 'sync', { sha: p.sha, parent_sha: from, keys: p.control.keys, changes, ...(fresh.length > changes.length ? { omitted: fresh.length - changes.length } : {}) }, null, null, r);
}

/** B-129 (R-BTN-85, "every disagreement with git is logged", both values): the accepted post's
 *  tickets whose frontmatter says `available` while the post itself places them past their
 *  course's start — the false `status: available` a hurried release wrote over an open PR
 *  (B-91, 2026-10-27). Core reads no course field (R-BTN-50) and stores no PR list (R-BTN-33),
 *  so it cannot tell that release from one that kept its PRs: both fire. Logged once per
 *  station (the sync posts every 15 minutes), judged against the ticket's last
 *  `position-disagrees` row, moving nothing (B-120's rule; until it lands, named). The path's
 *  length is the witness: a ticket past its start has one. */
function notePositionDisagreements(core: Pick<BatonCore, 'sql' | 'history'>, r: string, p: BoardPayload, seen: Map<string, Seen>, n: number): void {
  if (!p.tickets) return;
  const statusOf = new Map(p.tickets.map((t) => [qualify(r, t.id), t.display?.status ?? null]));
  for (const [id, s] of seen) {
    if (s.path.length === 0 || statusOf.get(id) !== 'available') continue;
    const last = core.sql<{ detail_json: string }>(
      `SELECT detail_json FROM events WHERE ticket_id = ? AND kind = 'discrepancy' AND json_extract(detail_json, '$.sub') = 'position-disagrees' ORDER BY seq DESC LIMIT 1`, id)[0];
    let before: { baton?: { station?: unknown } } = {};
    try {
      before = last ? JSON.parse(last.detail_json) : {};
    } catch {
      before = {};
    }
    if (before.baton?.station === s.station) continue;
    core.history.discrepancy(id, 'position-disagrees', { station: s.station, path: s.path }, { status: 'available' }, n);
  }
}

/** A post's tickets as hashed rows (§4, R-BTN-33): hashed before any transaction, the digest
 *  being async. `version` and `key` are inputs of the hash, so a ticket whose version changed
 *  rewrites its row (B-183). The interim post's items (docs until R3-1233) become rows the
 *  same way; only a refresh skips materialization for them (§4.3: the interim post carries no
 *  versions, and its refreshes change no ticket). */
export async function rowsFor(repo: Repository, p: BoardPayload): Promise<{ row: TicketRow; hash: string }[]> {
  const rankOf = new Map((p.ready ?? []).map((id, i) => [id, i]));
  const posted = p.tickets !== undefined
    ? p.tickets.map(rowForTicket)
    : p.state!.items.map((it) => rowFor(it, rankOf));
  return await Promise.all(posted.map(async (base) => {
    // R-BTN-66: tiers arrive by name and are matched as positions in this repository's ladder.
    const row = { ...base, tier_position: tierPosition(repo.tiers, base.tier ?? null) };
    return { row, hash: await rowHash(row) };
  }));
}

/** Write a post's ticket rows (§4.3, R-BTN-11, R-BTN-35): the repository's own tickets, keyed
 *  by their local ids (R-BTN-47) — rows whose `row_hash` changed are upserted, tickets the post
 *  no longer names leave the cache (their claims and events stay), and — B-183 (R-BTN-147) — a
 *  dropped ticket replaced by a **new** id at the same `key` is `renumbered`: the new id takes
 *  the old one's hold and backoff, and an event says the move. Returns what it wrote, beside
 *  the parents of the tickets it dropped that the post reports closing (`stations.apply` keeps
 *  the relation past the close, R-BTN-86). */
function materialize(core: Pick<BatonCore, 'store' | 'sql' | 'claims' | 'history' | 'stations' | 'blocks' | 'queues'>, r: string, rows: { row: TicketRow; hash: string }[], sha: string, at: number, closing: ReadonlySet<string> = new Set()): { upserted: string[]; deleted: number; renumbered: { from: string; to: string; key: string }[]; closingPositions: Map<string, ClosingPosition> } {
  const upserted: string[] = [];
  const renumbered: { from: string; to: string; key: string }[] = [];
  const closingPositions = new Map<string, ClosingPosition>();
  const have = new Map(core.sql<{ local_id: string; row_hash: string; key: string | null; path: string; parent: string | null }>(
    'SELECT local_id, row_hash, key, path, parent FROM tickets WHERE repository_id = ?', r).map((x) => [x.local_id, x]));
  // R-BTN-86 (§4.6): each posted parent becomes a stored qualified id — or none, logged
  // `parent-invalid` — judged here, inside the transaction, against the board it holds: this
  // post's parents beside the stored ones (the closed tickets count as known, leaves of the
  // walk). Never a refused post.
  const existingParents = new Map([...have].map(([id, x]) => [id, x.parent]));
  // R-BTN-86: the closed parents count as known leaves of the walk — read only when a posted
  // ticket names a parent at all, so a board of parentless tickets (the ordinary kind) pays
  // nothing for the relation (B-241's statement budget).
  const anyParent = rows.some(({ row }) => row.parent != null) || [...existingParents.values()].some((p) => p != null);
  const closedKnown = anyParent
    ? new Set(core.sql<{ local_id: string }>('SELECT substr(ticket_id, length(?) + 2) AS local_id FROM closed_tickets WHERE ticket_id >= ? || \':\' AND ticket_id < ? || \';\'', r, r, r).map((x) => x.local_id))
    : new Set<string>();
  const parents = resolveParents(r, rows.map(({ row }) => ({ id: row.id, parent: row.parent ?? null })), existingParents, closedKnown);
  for (const bad of parents.invalid.slice(0, 100)) {
    logEvent(core.store, at, 'parent-invalid', 'sync', { ticket: qualify(r, bad.ticket), parent: bad.parent, reason: bad.reason }, qualify(r, bad.ticket), null, r);
  }
  if (parents.invalid.length > 100) {
    logEvent(core.store, at, 'parent-invalid', 'sync', { omitted: parents.invalid.length - 100 }, null, null, r);
  }
  // A new ticket's key → its id, for the renumbering read of the dropped rows. Only ids the
  // board did not already hold (review round 1): the post ADDS a ticket at the key of one it
  // drops (R-BTN-147) — an existing ticket that moves onto a dropped key keeps its own hold
  // and backoff, it is not "renumbered onto".
  const held = new Set(have.keys());
  const byKey = new Map(rows.filter(({ row }) => !held.has(row.id)).map(({ row }) => [row.key ?? row.path ?? row.id, row.id]));
  const wasHeld = new Set(have.keys());
  let newTickets = 0;
  for (const { row, hash } of rows) {
    const before = have.get(row.id);
    have.delete(row.id);
    const parent = parents.parentOf.get(row.id)?.qualified ?? null;
    if (before?.row_hash === hash) {
      // The row is unchanged as posted; its stored parent may still move — the same raw value
      // resolves differently against a board that changed around it (an orphan's parent
      // posted, a cycle closed by other tickets).
      if (before?.parent !== parent) core.store.exec('UPDATE tickets SET parent = ? WHERE id = ?', parent, qualify(r, row.id));
      continue;
    }
    const id = qualify(r, row.id);
    core.store.exec(
      `INSERT INTO tickets (id, repository_id, local_id, path, title, project, status, node, queue, tags, tier, requires_clause, operator_only,
         depends_on, blocked_by, repos, ord, rank, snapshot_sha, row_hash, since, holder, course_id, tier_position, expedite, display, version, key, brief, parent, course_fields_json, depends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET path = excluded.path, title = excluded.title, project = excluded.project,
         status = excluded.status, node = excluded.node, queue = excluded.queue, tags = excluded.tags,
         tier = excluded.tier, requires_clause = excluded.requires_clause, operator_only = excluded.operator_only,
         depends_on = excluded.depends_on, blocked_by = excluded.blocked_by, repos = excluded.repos,
         ord = excluded.ord, rank = excluded.rank, snapshot_sha = excluded.snapshot_sha, row_hash = excluded.row_hash,
         since = excluded.since, holder = excluded.holder, course_id = excluded.course_id, tier_position = excluded.tier_position,
         expedite = excluded.expedite, display = excluded.display, version = excluded.version, key = excluded.key, brief = excluded.brief,
         parent = excluded.parent, course_fields_json = excluded.course_fields_json, depends_at = excluded.depends_at`,
      id, r, row.id, row.path, row.title, row.project, row.status, row.node, row.queue, row.tags, row.tier,
      row.requires_clause, row.operator_only, row.depends_on, row.blocked_by, row.repos, row.ord, row.rank, sha, hash, row.since, row.holder, row.course_id,
      row.tier_position, row.expedite, row.display, row.version, row.key, row.brief ?? null, parent, row.course_fields ?? null, row.depends_at ?? '[]');
    core.store.exec('DELETE FROM ticket_requires WHERE ticket_id = ?', id);
    for (const name of row.requires) core.store.exec('INSERT INTO ticket_requires (ticket_id, name) VALUES (?, ?)', id, name);
    upserted.push(id);
    if (!wasHeld.has(row.id)) newTickets++;
    // R-BTN-86: a child first appearing on the board — its `spawned` history row on the parent
    // it names, when the board knows that parent (an orphan's is held for the parent that may
    // still land; a history row for an unknown ticket is nobody's record).
    const resolved = parents.parentOf.get(row.id);
    if (!wasHeld.has(row.id) && resolved?.qualified != null && resolved.known) {
      core.history.record(resolved.qualified, { kind: 'spawned', detail: { child: id } });
    }
  }
  let deleted = 0;
  // Tickets no longer live leave the cache (R-BTN-35); their claims and events stay.
  for (const [gone, had] of have) {
    const id = qualify(r, gone);
    if (closing.has(gone)) {
      const position = core.sql<ClosingPosition>(`SELECT t.parent, t.course_id, s.station, s.path FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.id = ?`, id)[0];
      if (position) closingPositions.set(gone, position);
    }
    core.stations.clear(id);
    core.blocks.forget(id);
    core.store.exec('DELETE FROM ticket_requires WHERE ticket_id = ?', id);
    core.store.exec('DELETE FROM tickets WHERE id = ?', id);
    core.queues.touch(id);
    deleted++;
    // B-183 (R-BTN-147): the post drops one id and adds another at the same `key` — the source
    // renumbered its ticket. The new id takes the old one's hold and backoff (`ticket_overrides`),
    // and the move is logged as an event `renumbered`.
    const key = had.key ?? had.path;
    const to = key != null ? byKey.get(key) : undefined;
    if (key != null && to != null && to !== gone) {
      core.store.exec(
        `INSERT INTO ticket_overrides (ticket_id, expedite, hold, hold_reason, retry_after, set_by, set_at, runs_json)
         SELECT ?, expedite, hold, hold_reason, retry_after, set_by, set_at, runs_json FROM ticket_overrides WHERE ticket_id = ?
         ON CONFLICT (ticket_id) DO UPDATE SET hold = excluded.hold, hold_reason = excluded.hold_reason,
           retry_after = excluded.retry_after, runs_json = excluded.runs_json`,
        qualify(r, to), id);
      core.store.exec('DELETE FROM ticket_overrides WHERE ticket_id = ?', id);
      event(core, r, 'renumbered', { from: gone, to, key }, at);
      renumbered.push({ from: gone, to, key });
    }
  }
  // R3-1258: the maintained tickets count (R-BTN-87's figure) moves with what this post wrote
  // and dropped — never COUNTed, a growing table being what B-236 refuses to scan.
  if (newTickets || deleted) adjustCounts(core.store, { tickets: newTickets - deleted });
  return { upserted, deleted, renumbered, closingPositions };
}

/** B-183 (§4.4, R-BTN-184): a `custom` source that reads only as it is now has no ticket file
 *  to approve, so its post to a repository whose policy's floors include the `tickets-approved`
 *  guarantee is refused, naming the guarantee. */
function refuseCurrentUnderApprovalFloor(core: Pick<BatonCore, 'policies'>, repo: Repository, p: BoardPayload): void {
  if (p.source?.kind !== 'custom' || p.source.versions !== 'current') return;
  const floored = core.policies.floors(repo.id).filter((f) => f.guarantees.includes('tickets-approved'));
  if (!floored.length) return;
  throw new BatonError('invalid-params',
    `this repository's policy floors include the tickets-approved guarantee, which is defined over a ticket file's approval (R-BTN-184) — a custom ticket source with versions: "current" cannot post it (B-183)`);
}

/** B-183: the last accepted post's ticket-source declaration, kept on the head for the claim
 *  answer (§4.5: the runner re-verifies by the source's own way of reading). A post that
 *  declares none keeps what stood — an older CLI's post undeclares nothing. */
function rememberSource(core: Pick<BatonCore, 'store'>, r: string, p: BoardPayload): void {
  if (p.course_data !== undefined) core.store.exec('UPDATE board_head SET course_data = ? WHERE repository_id = ?', JSON.stringify(p.course_data), r);
  if (!p.source) return;
  core.store.exec('UPDATE board_head SET source_kind = ?, source_versions = ? WHERE repository_id = ?', p.source.kind, p.source.versions ?? null, r);
}

/** B-183 (§4.3): each live ticket's last accepted version, keyed by local id, for the
 *  observation's answer — Baton's own record, returned to the posting credential only, as
 *  `positions` is. A ticket posted with no version holds `''`. */
export function ticketVersions(core: Pick<BatonCore, 'sql'>, r: string): Record<string, string> {
  return Object.fromEntries(core.sql<{ local_id: string; version: string }>('SELECT local_id, version FROM tickets WHERE repository_id = ?', r).map((t) => [t.local_id, t.version]));
}

/** R-BTN-86 / R-BTN-85 (R3-1258): judge the children a `spawned` end reported, in the
 *  transaction that accepts the reading — the first snapshot observed after the end (its
 *  number strictly greater, R-BTN-62's rule). Each reported child the post does not name,
 *  live or closed, is dropped with discrepancy `spawned-unposted` on the parent; the posted
 *  ones stay recorded as the run's (a call's completion range, R-BTN-165 — B-62 reads it).
 *  A refresh judges as a new head does: it is a reading too. */
function settleSpawned(core: Pick<BatonCore, 'sql' | 'history' | 'store'>, r: string, p: BoardPayload, n: number, at: number): void {
  const due = core.sql<{ ticket_id: string; claim_id: number; children_json: string }>(
    'SELECT ticket_id, claim_id, children_json FROM spawned_children WHERE repository_id = ? AND observation < ?', r, n);
  if (!due.length) return;
  const posted = new Set<string>([
    ...((p.tickets ?? []).map((t) => t.id)),
    ...((p.state?.items ?? []).map((t) => t.id)),
    ...(p.closed ?? []).map((c) => c.id),
  ]);
  for (const row of due) {
    const reported = JSON.parse(row.children_json) as string[];
    const kept = reported.filter((id) => posted.has(id));
    if (kept.length < reported.length) {
      core.history.discrepancy(row.ticket_id, 'spawned-unposted', { children: reported, source: 'the spawned end' }, { posted: kept }, n, row.claim_id);
    }
    if (kept.length) {
      core.store.exec('UPDATE spawned_children SET children_json = ? WHERE repository_id = ? AND ticket_id = ? AND claim_id = ?',
        JSON.stringify(kept), r, row.ticket_id, row.claim_id);
    } else {
      core.store.exec('DELETE FROM spawned_children WHERE repository_id = ? AND ticket_id = ? AND claim_id = ?', r, row.ticket_id, row.claim_id);
    }
  }
  void at;
}

/** A refresh's stations (§4.3, R-BTN-62): the head's tickets as the refresh materialized them,
 *  where each is replaced. `wrote` is the refresh's own materialization (B-183) — null on a
 *  held history's refresh, which changes no ticket. */
function refreshStations(core: BoardPostCore, r: string, p: BoardPayload, n: number, at: number, wrote: { upserted: string[]; deleted: number; closingPositions: Map<string, ClosingPosition> } | null, held = false): Map<string, Seen> {
  const live = new Set(core.sql<{ local_id: string }>('SELECT local_id FROM tickets WHERE repository_id = ?', r).map((t) => t.local_id));
  const stations = new Map(Object.entries(p.stations ?? {}).filter(([id]) => live.has(id)).map(([id, st]) => [id, stationOf(st)] as [string, PostedStation]));
  // As on a new head: a live ticket the refresh does not place is placed nowhere, never offered
  // on an old station (round 1, 1-A-0, 1-B-0).
  const legsBefore = queuedLegs(core, r);
  for (const id of live) if (!stations.has(id)) core.stations.clear(qualify(r, id));
  // R-BTN-88: a refresh can supply the first placement, but only a materializing read
  // decides which tickets are absent. A held history cannot consume a pending position.
  if (!held) core.ownerState.applyPending(r, live, stations, at, wrote != null);
  // A held history's closures stand even for tickets the current head still has: the holder's
  // archive may be in the rewritten history alone, and its done end must not wait the hold's
  // 24 hours (R-BTN-62; round 2, 2-A-0). A plain refresh's own closures are applied as they
  // arrive (B-183): validation already refuses a post closing a ticket it also posts, and its
  // materialization dropped what it no longer names.
  core.claims.confirmOutputs(r, p.attestations ?? []);
  const seen = core.stations.apply(r, p.sha, n, stations, (p.closed ?? []).filter((c) => held || !live.has(c.id)), at, wrote?.closingPositions);
  // R-BTN-86: a refresh judges a `spawned` end's children as a new head does — it is a
  // reading too, numbered above the end's.
  settleSpawned(core, r, p, n, at);
  // R-BTN-116: a refresh carries the tickets' questions and the run's attestations like a new
  // head (§4.4) — each is idempotent, so a re-post of the same question or answer moves nothing.
  core.questions.posted(r, (p.tickets ?? []).filter((t) => live.has(t.id)), new Set(stations.keys()));
  core.questions.attestations(r, p.attestations ?? []);
  core.conditions.missingNext(r, core.stations.missingNext(r), at);
  core.conditions.contractWaits(r, at);
  // A refresh's stations carry `needs` and `decisions` too (R-BTN-76); a refresh that
  // materialized (B-183) recounts for what its rows moved, as a new head does.
  applyBlocks(core, r, stations, wrote?.upserted ?? [], legsBefore, !!wrote && wrote.deleted > 0);
  return seen;
}

/** Each of the repository's tickets' queued leg (R-BTN-83), by qualified id. */
function queuedLegs(core: Pick<BatonCore, 'sql'>, r: string): Map<string, string | null> {
  return new Map(core.sql<{ id: string; next_leg: string | null }>(
    'SELECT t.id, s.next_leg FROM tickets t LEFT JOIN ticket_stations s ON s.ticket_id = t.id WHERE t.repository_id = ?', r).map((x) => [x.id, x.next_leg]));
}

/** A snapshot's share of the blocks (R-BTN-75): its `needs` and `decisions` stored, the fleet
 *  counts brought to what is needed now, and the rows of every ticket whose causes changed —
 *  its row, its needs or decisions, or its queued leg — rewritten. Returns what it reports: a
 *  need failing the resource rule or naming an unregistered resource, a decision with a reserved
 *  id or a url outside the ticket's repositories (R-BTN-76). */
function applyBlocks(core: Pick<BatonCore, 'sql' | 'blocks'>, r: string, stations: Map<string, PostedStation>, upserted: string[], legsBefore: Map<string, string | null>, removed = false, registryPosted = false): string[] {
  const live = core.sql<{ local_id: string }>('SELECT local_id FROM tickets WHERE repository_id = ?', r).map((x) => x.local_id);
  const { changed, dropped } = core.blocks.posted(r, stations, live);
  // A closed `baton:stalled`, the recount and the post's own rows are evaluated once, after all
  // three (R-BTN-75; B-49).
  core.blocks.batch(() => {
    // A `baton:stalled` whose queued leg the snapshot posts other than waiting closes.
    core.blocks.settleStalled(r);
    // The counts follow what is needed: a post that changed a ticket — its row (where `requires`
    // lives), its needs or its decisions — or dropped one recounts; a post that changed nothing
    // does not (R-BTN-75, R-BTN-76). Coarser than "what is needed changed", by design: a row's
    // hash does not say which field moved, and a recount that finds no crossing writes no row.
    if (upserted.length || changed.length || removed) core.blocks.recount();
    if (registryPosted) core.blocks.courseCapabilitiesChanged(r);
    const moved = [...queuedLegs(core, r)].filter(([id, leg]) => legsBefore.get(id) !== leg).map(([id]) => id);
    core.blocks.postPrerequisites(r);
    core.blocks.write([...upserted, ...changed, ...moved]);
  });
  return dropped;
}

/** Every course a post's tickets name must be in force (R-BTN-48, R-BTN-69) — checked wherever
 *  rows are materialized: on a new head (inside `applyRegistry`, after the registry applies)
 *  and on a refresh that writes rows (round 1, finding 3), so no course-less ticket can sit in
 *  the cache that no course resolves. */
function requireCoursesInForce(core: Pick<BatonCore, 'courses'>, r: string, ticketCourses: string[]): void {
  for (const c of new Set(ticketCourses)) {
    if (!core.courses.get(r, c)) throw new BatonError('invalid-params', `a ticket's course ${c} is not in ${r}'s registry`);
  }
}

function checkPrerequisiteLegs(core: Pick<BatonCore, 'sql'>, repo: string, p: BoardPayload): void {
  const legs = new Map<string, Set<string>>();
  for (const t of p.tickets ?? []) {
    if (!t.depends_at?.some((d) => d.leg)) continue;
    if (!legs.has(t.course_id)) legs.set(t.course_id, new Set(core.sql<{ leg: string }>(
      'SELECT leg FROM course_legs WHERE repository_id = ? AND course_id = ?', repo, t.course_id).map((r) => r.leg)));
    for (const d of t.depends_at) if (d.leg && !legs.get(t.course_id)!.has(d.leg)) {
      throw new BatonError('invalid-params', `${t.id}.depends_at: ${d.leg} is not a leg of ${t.course_id}`);
    }
  }
}

/** B-113 (§4.4): a post's cross-repository `depends_on`, judged inside its transaction — every
 *  qualified id resolves against its target's board (a live-registered repository, a ticket
 *  live or closed there), the target is at least as visible as the posting repository or its
 *  owners consented, and no dependency cycle runs through two boards (dependencies.ts holds
 *  both checks, pure over the store this transaction holds). */
function checkQualifiedDependencies(core: Pick<BatonCore, 'sql'>, r: string, live: readonly { id: string; depends_on: readonly string[] }[]): void {
  const sql = <T>(q: string, ...a: unknown[]): T[] => core.sql<T>(q, ...a);
  checkCrossRepository(sql, r, live);
  checkCrossBoardCycle(sql, r, live);
}

/** The registry of a post (R-BTN-48, R-BTN-69), inside its transaction: applied whole, then
 *  every course the post's tickets name must be in force — a refused file with none to keep,
 *  or a course the registry dropped while a ticket still names it, refuses the post. */
function applyRegistry(core: Pick<BatonCore, 'courses' | 'stations' | 'claims' | 'queues'>, r: string, p: BoardPayload, ticketCourses: string[], at: number): string[] {
  const previous = new Map((p.registry ?? []).map((e) => [e.id, core.stations.graph(r, e.id)]));
  const refused = p.registry ? core.courses.apply(r, p.registry, p.sha, at) : [];
  core.stations.reset();
  requireCoursesInForce(core, r, ticketCourses);
  // R-BTN-64: a course file accepted with renames carries its active claims over.
  for (const e of p.registry ?? []) {
    if (refused.includes(e.id)) continue;
    core.claims.renameActive(r, e.id);
    // R-BTN-83: a ticket queued for a leg the accepted file no longer has there waits on course-changed.
    core.stations.recheckCourse(r, e.id, previous.get(e.id) ?? null);
  }
  // R-BTN-79: every course in force — accepted now or kept over a refused file — has its renamed
  // legs' tickets moved and each leg's bound judged against the row's, so a bound never waits on
  // a file being fixed (round 2, 2-r2-0); a course the registry dropped takes its queues and
  // their notices with it (round 1, 1-A-3).
  const inForce = core.courses.all().filter((c) => c.repository_id === r).map((c) => c.id);
  for (const c of inForce) core.queues.coursed(r, c);
  core.queues.retain(r, inForce);
  return refused;
}

function event(core: Pick<BatonCore, 'store'>, repo: string, kind: string, detail: unknown, at: number) {
  core.store.exec('INSERT INTO events (at, kind, actor, detail_json, repository_id) VALUES (?, ?, ?, ?, ?)', at, kind, 'sync', JSON.stringify(detail), repo);
}

/** §10.3: a repository's sync or mirror workflow, on its default branch. A repository with no
 *  mirror has nothing to dispatch for it; a retired one has nothing at all (R-BTN-47, B-173). A
 *  dispatch the forge refuses is logged with its reason (R-BTN-94); the sync backstop still applies. */
export async function sendDispatch(core: Pick<BatonCore, 'registry' | 'sql' | 'store' | 'now'>, dispatch: Dispatch, wf: Workflow): Promise<unknown> {
  const repo = core.registry.live(wf.repository);
  if (!repo) return false;
  let target: DispatchTarget | null = null;
  if (wf.kind === 'unblocked') {
    // R-BTN-77: one input, `tickets`, JSON — every id and ref in it passed its rule (§10.4). Only
    // the GitHub App's dispatch is built here; GitLab's and Gitea's adapters are R3-1263's.
    const trigger = core.sql<{ t: string | null }>('SELECT unblocked_trigger AS t FROM repositories WHERE id = ?', wf.repository)[0]?.t;
    const t = trigger ? (JSON.parse(trigger) as { kind: string; workflow?: string }) : null;
    if (t?.kind !== 'github-app' || !t.workflow) return false;
    // R-BTN-94 (B-168): Baton reads no workflow file — one declaring no manual dispatch, or no
    // `tickets` input, is the forge's to refuse at dispatch, and the refusal is logged below.
    target = { github: repo.github, workflow: t.workflow.slice(t.workflow.lastIndexOf('/') + 1), ref: repo.default_branch, inputs: { tickets: JSON.stringify(wf.tickets ?? []) } };
  } else {
    const path = wf.kind === 'sync' ? repo.sync_workflow : repo.mirror_workflow;
    if (!path) return false;
    target = { github: repo.github, workflow: path.slice(path.lastIndexOf('/') + 1), ref: repo.default_branch };
  }
  try {
    return await dispatch.send(target);
  } catch (e) {
    if (!(e instanceof DispatchRefused)) return false;
    // R-BTN-94: identifiers and the adapter's short text reason, never the response payload.
    core.store.transaction(() => logEvent(core.store, core.now(), 'discrepancy', 'baton',
      { kind: 'dispatch-refused', repository: wf.repository, workflow: wf.kind, reason: e.message },
      null, null, wf.repository));
    return false;
  }
}
