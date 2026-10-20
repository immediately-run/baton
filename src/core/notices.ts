// notices.ts — requests for people (BATON_SPEC §2g R-BTN-80, §2l R-BTN-103; R3-1256). The one
// writer of `notices` and `worker_couriers`. Baton sends nothing: for each open decision it queues
// one notice per personal courier registered for the decision's `asks`, and one pool copy while a
// worker courier has said within a day that it delivers them; couriers claim notices, deliver them
// however they do, and mark them `sent` or `failed`. A notice holds references only — the title,
// question and link are read from the ticket and its decision when a courier claims it, so nothing
// of a packet is stored here (R-BTN-33). A notice closes only when its decision closes or its
// courier is revoked; the answer itself stays in git.
import { BatonError } from './http';
import { randomHex } from './db';
import { checkMark, qualify } from './validate';
import type { Store } from './ports';
import type { QueueOver } from './queues';

/** R-BTN-103: the reserved credential pool copies are queued to (migration 0017). */
export const POOL = 'pool';
/** R-BTN-80: a claim's notices are each leased 10 minutes. */
export const LEASE_MS = 10 * 60_000;
/** R-BTN-80: a failed mark re-queues after 1, 5, 30 minutes, then hourly. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 3_600_000] as const;
/** R-BTN-80: a closed notice is deleted 7 days after it closed. */
export const CLOSED_KEPT_MS = 7 * 86_400_000;
/** R-BTN-80: `remind_after`, an owner setting in seconds — default a day, from an hour to 7 days. */
export const REMIND_AFTER_S = { min: 3600, max: 604_800, default: 86_400 } as const;
/** R-BTN-103: a worker courier seen within a day gets its `(repository, asks)` a pool copy; a pool
 *  copy unclaimed for an hour is listed under Needs you. */
export const POOL_WINDOW_MS = 24 * 3_600_000;
export const POOL_UNCLAIMED_MS = 3_600_000;
/** §3's write budget (spec-silent, recorded on R3-1256): a heartbeat refreshes a worker courier's
 *  `seen_at` only once it is an hour old, so the 24-hour window is kept to within an hour. */
export const SEEN_REFRESH_MS = 3_600_000;
/** A notice id: 16 random bytes, hex. */
const NOTICE_ID = /^[0-9a-f]{32}$/;

/** Who is asking on `/v1/courier/*`: a personal channel — a courier key its owners registered —
 *  or a worker courier, a machine key acting for one repository with the `asks` its sessions'
 *  heartbeats declared there within the day. */
export type Courier =
  | { kind: 'personal'; fingerprint: string }
  | { kind: 'worker'; fingerprint: string; repository: string; asks: string[] };

/** A notice as a courier receives it (R-BTN-80): a decision, or a leg over its bound (R-BTN-79). */
export type NoticeView =
  | {
    notice_id: string;
    kind: 'decision';
    repository: string;
    ticket: string;
    title: string;
    decision: { id: string; asks: string; url?: string };
    unblocks: string[];
    created_at: number;
  }
  | ({ notice_id: string; kind: 'queue-over'; repository: string; created_at: number } & QueueOver);

interface NoticeRow {
  id: string;
  credential_id: string;
  repository_id: string;
  ticket_id: string | null;
  kind: string;
  ref: string;
  payload_json: string | null;
  state: 'queued' | 'claimed' | 'sent' | 'closed';
  attempts: number;
  claimed_by: string | null;
  created_at: number;
}

/** The backoff after the `n`th failed mark in a row (n ≥ 1). */
export const backoffMs = (n: number) => BACKOFF_MS[Math.min(n, BACKOFF_MS.length) - 1];

export class Notices {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }

  // ── queueing and closing (R-BTN-80) ───────────────────────────────────────────────────────

  /** Decisions `ids` of `ticket` were first stored, in the caller's transaction: one notice per
   *  personal courier of the ticket's repository registered for each one's `asks`, and one pool
   *  copy while a worker courier of that `(repository, asks)` was seen within the day. */
  opened(ticket: string, ids: string[]) {
    const now = this.c.now();
    for (const d of this.decisionsOf(ticket, ids)) {
      for (const k of this.rows<{ credential_id: string }>(
        `SELECT c.credential_id FROM couriers c JOIN credentials k ON k.id = c.credential_id
         WHERE c.repository_id = ? AND c.asks = ? AND k.revoked_at IS NULL ORDER BY c.credential_id`, d.repository_id, d.asks)) {
        this.queue(k.credential_id, d.repository_id, ticket, d.decision_id, now);
      }
      if (this.poolServed(d.repository_id, d.asks, now)) this.queue(POOL, d.repository_id, ticket, d.decision_id, now);
    }
  }

  /** Decisions `ids` of `ticket` closed, in the transaction that closed them: every notice of
   *  theirs closes, whatever its state, and is deleted 7 days later. */
  closed(ticket: string, ids: string[]) {
    if (!ids.length) return;
    const now = this.c.now();
    this.exec(`UPDATE notices SET state = 'closed', not_before = ?, updated_at = ?
               WHERE ticket_id = ? AND kind = 'decision' AND ref IN (SELECT value FROM json_each(?)) AND state != 'closed'`,
      now + CLOSED_KEPT_MS, now, ticket, JSON.stringify(ids));
  }

  /** A personal courier was registered on `repository`, or its `asks` there changed: it is queued
   *  a notice for each decision open there that it now delivers and holds none for, and its open
   *  notices for decisions it no longer delivers there close — the asks it lost are revoked. */
  registered(credential: string, repository: string) {
    const now = this.c.now();
    const asks = this.rows<{ asks: string }>('SELECT asks FROM couriers WHERE credential_id = ? AND repository_id = ?', credential, repository).map((r) => r.asks);
    this.exec(`UPDATE notices SET state = 'closed', not_before = ?, updated_at = ?
               WHERE credential_id = ? AND repository_id = ? AND kind = 'decision' AND state != 'closed'
                 AND NOT EXISTS (SELECT 1 FROM ticket_decisions d WHERE d.ticket_id = notices.ticket_id AND d.decision_id = notices.ref
                                 AND d.asks IN (SELECT value FROM json_each(?)))`,
      now + CLOSED_KEPT_MS, now, credential, repository, JSON.stringify(asks));
    for (const d of this.rows<{ ticket_id: string; decision_id: string }>(
      `SELECT d.ticket_id, d.decision_id FROM ticket_decisions d JOIN tickets t ON t.id = d.ticket_id
       WHERE t.repository_id = ? AND d.asks IN (SELECT value FROM json_each(?))
         AND NOT EXISTS (SELECT 1 FROM notices n WHERE n.credential_id = ? AND n.ticket_id = d.ticket_id AND n.ref = d.decision_id AND n.state != 'closed')
       ORDER BY d.ticket_id, d.decision_id`, repository, JSON.stringify(asks), credential)) {
      this.queue(credential, repository, d.ticket_id, d.decision_id, now);
    }
  }

  /** A courier key's registration ended — on one repository by its owners, or everywhere by an
   *  administrator: its notices there close. */
  revoked(credential: string, repository: string | null) {
    const now = this.c.now();
    this.exec(`UPDATE notices SET state = 'closed', not_before = ?, updated_at = ?
               WHERE credential_id = ? AND (? IS NULL OR repository_id = ?) AND state != 'closed'`,
      now + CLOSED_KEPT_MS, now, credential, repository, repository);
  }

  /** Leg `ref` (`course:leg`) of `repository` is over its `max_queue`, or still is and its depth or
   *  its course's intake changed (R-BTN-79): one `queue-over` notice per `owner` courier of the
   *  repository, queued once and then updated in place — a courier that already delivered it is
   *  not asked to deliver it again for each ticket more. */
  over(repository: string, ref: string, payload: QueueOver) {
    const now = this.c.now();
    const json = JSON.stringify(payload);
    for (const k of this.rows<{ credential_id: string }>(
      `SELECT c.credential_id FROM couriers c JOIN credentials k ON k.id = c.credential_id
       WHERE c.repository_id = ? AND c.asks = 'owner' AND k.revoked_at IS NULL ORDER BY c.credential_id`, repository)) {
      const open = this.rows<{ id: string }>(`SELECT id FROM notices WHERE credential_id = ? AND repository_id = ? AND kind = 'queue-over' AND ref = ? AND state != 'closed'`,
        k.credential_id, repository, ref)[0];
      if (open) this.exec('UPDATE notices SET payload_json = ?, updated_at = ? WHERE id = ?', json, now, open.id);
      else {
        this.exec(`INSERT INTO notices (id, credential_id, repository_id, ticket_id, kind, ref, state, attempts, not_before, payload_json, updated_at, created_at)
                   VALUES (?, ?, ?, NULL, 'queue-over', ?, 'queued', 0, ?, ?, ?, ?)`, randomHex(16), k.credential_id, repository, ref, now, json, now, now);
      }
    }
  }

  /** Leg `ref` of `repository` is back within its bound: its `queue-over` notices close (R-BTN-79). */
  within(repository: string, ref: string) {
    const now = this.c.now();
    this.exec(`UPDATE notices SET state = 'closed', not_before = ?, updated_at = ?
               WHERE repository_id = ? AND kind = 'queue-over' AND ref = ? AND state != 'closed'`, now + CLOSED_KEPT_MS, now, repository, ref);
  }

  private queue(credential: string, repository: string, ticket: string, decision: string, now: number) {
    // One open notice per courier and decision: a decision posted again is not queued twice.
    if (this.rows('SELECT 1 FROM notices WHERE credential_id = ? AND ticket_id = ? AND ref = ? AND state != \'closed\'', credential, ticket, decision).length) return;
    this.exec(`INSERT INTO notices (id, credential_id, repository_id, ticket_id, kind, ref, state, attempts, not_before, updated_at, created_at)
               VALUES (?, ?, ?, ?, 'decision', ?, 'queued', 0, ?, ?, ?)`, randomHex(16), credential, repository, ticket, decision, now, now, now);
  }

  /** Whether a worker courier still granted on `repository` declared `asks` there within the day. */
  private poolServed(repository: string, asks: string, now: number): boolean {
    return this.rows(
      `SELECT 1 FROM worker_couriers wc JOIN workers w ON w.id = wc.worker_id JOIN credentials k ON k.id = w.credential_id
       WHERE wc.repository_id = ? AND wc.asks = ? AND wc.seen_at > ? AND k.revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM worker_grants g WHERE g.credential_id = k.id AND g.repository_id = wc.repository_id AND g.revoked_at IS NULL)
       LIMIT 1`, repository, asks, now - POOL_WINDOW_MS).length > 0;
  }

  private decisionsOf(ticket: string, ids: string[]) {
    return this.rows<{ decision_id: string; asks: string; repository_id: string }>(
      `SELECT d.decision_id, d.asks, t.repository_id FROM ticket_decisions d JOIN tickets t ON t.id = d.ticket_id
       WHERE d.ticket_id = ? AND d.decision_id IN (SELECT value FROM json_each(?)) ORDER BY d.decision_id`, ticket, JSON.stringify(ids));
  }

  // ── couriers' calls (`/v1/courier/*`) ─────────────────────────────────────────────────────

  /** `POST /v1/courier/notices/claim`: up to `limit` of the courier's queued notices — a personal
   *  channel's own copies, or a worker courier's repository's pool copies for its `asks` — each
   *  leased 10 minutes. */
  claim(who: Courier, limit: number): { notices: NoticeView[] } {
    const now = this.c.now();
    const due = who.kind === 'personal'
      ? this.rows<NoticeRow>(`SELECT * FROM notices WHERE credential_id = ? AND state = 'queued' AND not_before <= ? ORDER BY created_at, id LIMIT ?`, who.fingerprint, now, limit)
      : this.rows<NoticeRow>(
        `SELECT n.* FROM notices n JOIN ticket_decisions d ON d.ticket_id = n.ticket_id AND d.decision_id = n.ref
         WHERE n.credential_id = ? AND n.repository_id = ? AND n.state = 'queued' AND n.not_before <= ? AND d.asks IN (SELECT value FROM json_each(?))
         ORDER BY n.created_at, n.id LIMIT ?`, POOL, who.repository, now, JSON.stringify(who.asks), limit);
    const out: NoticeView[] = [];
    for (const n of due) {
      this.exec(`UPDATE notices SET state = 'claimed', not_before = ?, claimed_by = ?, updated_at = ? WHERE id = ?`, now + LEASE_MS, who.fingerprint, now, n.id);
      const v = this.view(n);
      if (v) out.push(v);
    }
    return { notices: out };
  }

  /** `POST /v1/courier/notices/{id}`: `sent` waits `remind_after` for the decision to close;
   *  `failed` re-queues after the backoff. A closed notice is answered `closed`; a mark after the
   *  lease lapsed is accepted, since it was delivered; another courier's notice — for a pool copy,
   *  one another key claimed last — is `forbidden`. */
  mark(who: Courier, id: string, body: unknown): { ok: true } {
    if (!NOTICE_ID.test(id)) throw new BatonError('invalid-params', 'id: must be a notice id');
    const m = checkMark(body);
    const n = this.rows<NoticeRow>('SELECT * FROM notices WHERE id = ?', id)[0];
    if (!n) throw new BatonError('not-found', 'no such notice');
    const mine = who.kind === 'personal'
      ? n.credential_id === who.fingerprint
      : n.credential_id === POOL && n.repository_id === who.repository && n.claimed_by === who.fingerprint;
    if (!mine) throw new BatonError('forbidden', 'this notice is another courier’s');
    if (n.state === 'closed') throw new BatonError('closed', 'this notice’s decision was answered meanwhile');
    const now = this.c.now();
    if (m.state === 'sent') {
      const remind = this.rows<{ s: number }>('SELECT remind_after_s AS s FROM repositories WHERE id = ?', n.repository_id)[0]?.s ?? REMIND_AFTER_S.default;
      this.exec(`UPDATE notices SET state = 'sent', sent_at = ?, channel = ?, attempts = 0, not_before = ?, updated_at = ? WHERE id = ?`,
        now, m.channel, now + remind * 1000, now, id);
    } else {
      this.exec(`UPDATE notices SET state = 'queued', attempts = attempts + 1, not_before = ?, updated_at = ? WHERE id = ?`,
        now + backoffMs(n.attempts + 1), now, id);
    }
    return { ok: true };
  }

  /** `GET /v1/courier/decisions`: every open decision the courier delivers, whatever its notices'
   *  state — the courier's own read of `blocked?on=decision:*` over its repositories and `asks`. */
  decisions(who: Courier) {
    const rows = who.kind === 'personal'
      ? this.rows<{ ticket_id: string; decision_id: string }>(
        `SELECT DISTINCT d.ticket_id, d.decision_id FROM ticket_decisions d JOIN tickets t ON t.id = d.ticket_id
         JOIN couriers c ON c.repository_id = t.repository_id AND c.asks = d.asks
         WHERE c.credential_id = ? ORDER BY d.ticket_id, d.decision_id`, who.fingerprint)
      : this.rows<{ ticket_id: string; decision_id: string }>(
        `SELECT d.ticket_id, d.decision_id FROM ticket_decisions d JOIN tickets t ON t.id = d.ticket_id
         WHERE t.repository_id = ? AND d.asks IN (SELECT value FROM json_each(?)) ORDER BY d.ticket_id, d.decision_id`, who.repository, JSON.stringify(who.asks));
    const copy = who.kind === 'personal' ? who.fingerprint : POOL;
    return {
      decisions: rows.flatMap((r) => {
        const v = this.decisionView(r.ticket_id, r.decision_id);
        if (!v) return [];
        const state = this.rows<{ state: string }>(`SELECT state FROM notices WHERE credential_id = ? AND ticket_id = ? AND ref = ? AND state != 'closed'`, copy, r.ticket_id, r.decision_id)[0]?.state ?? null;
        return [{ repository: v.repository, ticket: v.ticket, title: v.title, decision: v.decision, unblocks: v.unblocks, notice_state: state }];
      }),
    };
  }

  private view(n: NoticeRow): NoticeView | null {
    if (n.kind === 'queue-over') {
      return n.payload_json ? { notice_id: n.id, kind: 'queue-over', repository: n.repository_id, ...(JSON.parse(n.payload_json) as QueueOver), created_at: n.created_at } : null;
    }
    const v = n.ticket_id ? this.decisionView(n.ticket_id, n.ref) : null;
    return v ? { notice_id: n.id, kind: 'decision', ...v, created_at: n.created_at } : null;
  }

  /** A decision as a courier sees it: the ticket's title and the decision's id, `asks` and link —
   *  each already checked under §10.4 when the snapshot was accepted. Its answer unblocks its
   *  ticket. */
  private decisionView(ticket: string, decision: string) {
    const d = this.rows<{ asks: string; url: string | null; title: string; repository_id: string; local_id: string }>(
      `SELECT d.asks, d.url, t.title, t.repository_id, t.local_id FROM ticket_decisions d JOIN tickets t ON t.id = d.ticket_id
       WHERE d.ticket_id = ? AND d.decision_id = ?`, ticket, decision)[0];
    if (!d) return null;
    return {
      repository: d.repository_id, ticket: qualify(d.repository_id, d.local_id), title: d.title,
      decision: { id: decision, asks: d.asks, ...(d.url ? { url: d.url } : {}) }, unblocks: [qualify(d.repository_id, d.local_id)],
    };
  }

  // ── worker couriers (R-BTN-103) ───────────────────────────────────────────────────────────

  /**
   * A heartbeat's `couriers`, inside its transaction: the worker's rows rewritten to what it
   * declares on repositories its key is granted on (`granted`; null for a key that is no machine
   * key granted anywhere, which delivers nothing). Returns the entries refused.
   */
  declare(workerId: number, granted: string[] | null, entries: { repository: string; asks: string[] }[]): { repository: string; code: string }[] {
    const now = this.c.now();
    const refused = entries.filter((e) => !granted?.includes(e.repository)).map((e) => ({ repository: e.repository, code: 'forbidden' }));
    const want = new Set(entries.filter((e) => granted?.includes(e.repository)).flatMap((e) => e.asks.map((a) => `${e.repository}\u0000${a}`)));
    const have = this.rows<{ repository_id: string; asks: string; seen_at: number }>('SELECT repository_id, asks, seen_at FROM worker_couriers WHERE worker_id = ?', workerId);
    for (const h of have) {
      const key = `${h.repository_id}\u0000${h.asks}`;
      if (!want.has(key)) this.exec('DELETE FROM worker_couriers WHERE worker_id = ? AND repository_id = ? AND asks = ?', workerId, h.repository_id, h.asks);
      else if (now - h.seen_at >= SEEN_REFRESH_MS) this.exec('UPDATE worker_couriers SET seen_at = ? WHERE worker_id = ? AND repository_id = ? AND asks = ?', now, workerId, h.repository_id, h.asks);
      want.delete(key);
    }
    for (const key of want) {
      const [repository, asks] = key.split('\u0000');
      this.exec('INSERT INTO worker_couriers (worker_id, repository_id, asks, seen_at) VALUES (?, ?, ?, ?)', workerId, repository, asks, now);
    }
    return refused;
  }

  /** The `asks` a machine key's sessions declared on `repository` within the day. */
  workerAsks(credential: string, repository: string): string[] {
    return this.rows<{ asks: string }>(
      `SELECT DISTINCT wc.asks FROM worker_couriers wc JOIN workers w ON w.id = wc.worker_id
       WHERE w.credential_id = ? AND wc.repository_id = ? AND wc.seen_at > ? ORDER BY wc.asks`, credential, repository, this.c.now() - POOL_WINDOW_MS).map((r) => r.asks);
  }

  // ── time and the dashboard ────────────────────────────────────────────────────────────────

  /** The alarm (R-BTN-80): a lapsed lease is queued again; a sent notice still open after
   *  `remind_after` is queued again for its courier; a notice closed 7 days ago is deleted. */
  alarm() {
    const now = this.c.now();
    this.exec(`UPDATE notices SET state = 'queued', not_before = ?, updated_at = ? WHERE state = 'claimed' AND not_before <= ?`, now, now, now);
    this.exec(`UPDATE notices SET state = 'queued', not_before = ?, updated_at = ? WHERE state = 'sent' AND not_before <= ?`, now, now, now);
    this.exec(`DELETE FROM notices WHERE state = 'closed' AND not_before <= ?`, now);
  }

  /** §14 Needs you (R-BTN-103): a pool copy unclaimed for an hour, and a repository with `owner`
   *  decisions open and no personal channel for `owner`. */
  needsYou(now: number) {
    return {
      pool_unclaimed: this.rows(`SELECT n.repository_id, n.ticket_id, n.ref AS decision, n.updated_at AS since FROM notices n
                                 WHERE n.credential_id = ? AND n.state = 'queued' AND n.updated_at <= ? ORDER BY n.updated_at, n.id`, POOL, now - POOL_UNCLAIMED_MS),
      no_owner_channel: this.rows(`SELECT t.repository_id, COUNT(*) AS decisions FROM ticket_decisions d JOIN tickets t ON t.id = d.ticket_id
                                   WHERE d.asks = 'owner' AND NOT EXISTS (
                                     SELECT 1 FROM couriers c JOIN credentials k ON k.id = c.credential_id
                                     WHERE c.repository_id = t.repository_id AND c.asks = 'owner' AND k.revoked_at IS NULL)
                                   GROUP BY t.repository_id ORDER BY t.repository_id`),
    };
  }

  /** The dashboard's read-only list of personal channels (R-BTN-66: the CLI changes them). */
  couriers() {
    return this.rows<{ credential_id: string; repository_id: string; asks: string }>(
      `SELECT c.credential_id, c.repository_id, c.asks FROM couriers c JOIN credentials k ON k.id = c.credential_id
       WHERE k.revoked_at IS NULL ORDER BY c.repository_id, c.credential_id, c.asks`);
  }
}
