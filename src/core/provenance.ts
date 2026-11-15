// provenance.ts — who last wrote each ticket (BATON_SPEC §4.4 R-BTN-194; B-126, security model
// reach 3, option 9): in the transaction that accepts a post moving a repository's head, Baton
// reads its own record of the App's push deliveries for the range (R-BTN-73: the immutable
// pusher `sender.id`, never the commit author, which anyone sets) and records on each ticket the
// pusher of the newest commit that changed its file — `last_written_by`, served with the ticket
// beside B-127's brief mark (`brief {signed, signer?, commit}`, which carries the signer) so a
// privileged session sees whose words steer it before it reads them. Information only: nothing
// is refused, held or noticed (the owner, 2026-11-13: B-126 keeps provenance only — no
// `control-changed` notice under `cooperative`; B-127's opt-in `unsigned-control` is the
// detection for those who want it). When no delivery accounts for a change — a delivery missing,
// past the recording bounds, or a forge that sends none (a plain git remote) — the pusher is
// `pusher-unknown`, never assumed.
import type { TicketRow } from './board';
import type { Repository } from './registry';
import type { Store } from './ports';

/** R-BTN-194: who last changed a ticket — `pusher` the pusher's login (or `pusher-unknown`),
 *  `pusher_id` its immutable forge user id when the delivery named one, `commit` the commit, `at`
 *  the delivery's arrival (or the post's, for `pusher-unknown`). The signer is the brief mark's
 *  (B-127), not repeated here. */
export interface LastWrittenBy {
  pusher: string;
  pusher_id?: number;
  commit: string;
  at: number;
}

/** The pusher Baton records when no delivery accounts for a change. */
export const PUSHER_UNKNOWN = 'pusher-unknown';

/** One recorded push delivery (R-BTN-73), as `push_deliveries` holds it. */
interface PushRow {
  before_sha: string;
  sender_id: number | null;
  sender_login: string | null;
  commits: { sha: string; paths: string[] }[];
  truncated: number;
  received_at: number;
}

/** A chain longer than this is a rewritten history wearing a push list; it stops the walk. */
const CHAIN_MAX = 100;

export class Provenance {
  constructor(private readonly c: { store: Store }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray() as T[];
  }

  /** The pushes that moved `repository`'s `ref` from `from` to `to`, oldest first: the recorded
   *  deliveries chained by their `before` and `after`, walked back from `to`. A gap, a pruned
   *  delivery or a force push stops the walk with whatever could be traced; the untraced
   *  commits are then the oldest of the range, so a traced commit is still the newest it shows. */
  private chain(repository: string, ref: string, from: string, to: string): PushRow[] {
    const traced: PushRow[] = [];
    let at = to;
    for (let steps = 0; steps < CHAIN_MAX && at !== from; steps++) {
      const d = this.rows<Omit<PushRow, 'commits'> & { commits_json: string }>(
        'SELECT before_sha, sender_id, sender_login, commits_json, truncated, received_at FROM push_deliveries WHERE repository = ? AND ref = ? AND after_sha = ? ORDER BY received_at DESC, delivery_id DESC LIMIT 1',
        repository, ref, at)[0];
      if (!d) break;
      let commits: PushRow['commits'] = [];
      if (!d.truncated) {
        try {
          commits = JSON.parse(d.commits_json) as PushRow['commits'];
        } catch {
          commits = [];
        }
      }
      traced.push({ before_sha: d.before_sha, sender_id: d.sender_id, sender_login: d.sender_login, commits, truncated: d.truncated, received_at: d.received_at });
      at = d.before_sha;
    }
    return traced.reverse();
  }

  /**
   * R-BTN-194, in the transaction that accepts a post moving `repository`'s head from `from` to
   * `to`: record each ticket's `last_written_by` from the push deliveries of that range (never
   * the post's own account of what changed). `rows` are the post's tickets, `changed` their
   * local ids whose row this post rewrote. A ticket whose file a traced commit changed takes
   * that commit's pusher; one whose row changed with no traced commit — or whose newest traced
   * change is followed by a push past the recording bounds, whose paths Baton cannot see — is
   * `pusher-unknown`. A first snapshot (`from` null) records nothing: there is no range.
   */
  advance(repository: Repository, from: string | null, to: string, at: number, rows: readonly TicketRow[], changed: ReadonlySet<string>): void {
    if (from == null || from === to) return;
    const pushes = this.chain(repository.github.toLowerCase(), `refs/heads/${repository.default_branch}`, from, to);
    // path → the newest traced commit that changed it, with its push's position in the chain.
    const newest = new Map<string, { sha: string; id: number | null; login: string | null; at: number; push: number }>();
    // The position of the newest push past the recording bounds: a change after it is visible,
    // a change before it may have been overwritten by it.
    let lastTruncated = -1;
    pushes.forEach((push, i) => {
      if (push.truncated) { lastTruncated = i; return; }
      for (const commit of push.commits) {
        for (const path of commit.paths) newest.set(path, { sha: commit.sha, id: push.sender_id, login: push.sender_login, at: push.received_at, push: i });
      }
    });
    for (const row of rows) {
      if (!row.path) continue;
      const last = newest.get(row.path);
      let lw: LastWrittenBy | null = null;
      if (last && last.push > lastTruncated) {
        lw = { pusher: last.login ?? (last.id != null ? String(last.id) : PUSHER_UNKNOWN), ...(last.id != null ? { pusher_id: last.id } : {}), commit: last.sha, at: last.at };
      } else if (last || changed.has(row.id)) {
        lw = { pusher: PUSHER_UNKNOWN, commit: to, at };
      }
      if (lw) this.c.store.exec('UPDATE tickets SET last_written_by = ? WHERE id = ?', JSON.stringify(lw), `${repository.id}:${row.id}`);
    }
  }
}

/** `last_written_by` as stored (JSON), or null — a malformed value reads as none. */
export function writtenBy(v: unknown): LastWrittenBy | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    return JSON.parse(v) as LastWrittenBy;
  } catch {
    return null;
  }
}

/** B-127's brief mark as stored (JSON), or null. */
export function briefMark(v: unknown): { signed: boolean; signer?: string; commit: string } | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    return JSON.parse(v) as { signed: boolean; signer?: string; commit: string };
  } catch {
    return null;
  }
}
