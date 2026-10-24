// webhook.ts — GitHub App deliveries trigger repository syncs (BATON_SPEC §7.1 R-BTN-73, §10.1;
// R3-1247). A delivery is only a trigger: the sync still computes everything from git.
//
// The front verifies `X-Hub-Signature-256` with BATON_GITHUB_WEBHOOK_SECRET before anything else
// is read, then `pickDelivery` — the only code that touches a payload — returns exactly the
// fields R-BTN-73 lists, and only those reach the core. The core drops a repeated delivery id
// and the feedback of Baton's own work, maps the delivery's repository to the registered
// repositories whose tickets name it, and dispatches their syncs at most once per repository
// per 30 seconds, plus one trailing dispatch when a window that suppressed a delivery closes.
import { BatonError } from './http';
import { equalBytes, readCapped } from './auth';
import { GIT_REPO } from './validate';
import type { Store } from './ports';

/** The events the App subscribes to (R-BTN-73; `check_suite` dropped after the sixth review). */
export const WEBHOOK_EVENTS = ['push', 'pull_request', 'pull_request_review', 'issue_comment', 'workflow_run'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** GitHub caps a delivery's payload at 25 MB; nothing larger is a delivery. */
export const MAX_DELIVERY = 25 << 20;
export const DISPATCH_WINDOW_MS = 30_000;
export const DELIVERY_TTL_MS = 24 * 3_600_000;
/** B-89: how stale a repository's last webhook-driven sync may be before the alarm sends
 *  another — the backstop on the path that reaches Baton, as R-BTN-62's is on the numbers. */
export const SYNC_STALE_MS = 10 * 60_000;
/** The mirror's commit identity (§12): its pushes are Baton's own work. */
export const MIRROR_EMAIL = 'baton-mirror@immediately.run';
export const ACTIONS_BOT = 'github-actions[bot]';

/** What the core may know of a delivery: R-BTN-73's fields, and nothing more. */
export interface Delivery {
  event: WebhookEvent;
  id: string;
  repository: string;
  /** `workflow_run.path`, for a workflow_run. */
  workflow_path?: string;
  /** `pull_request.merged`, for a pull_request (B-89: a merge moved the default branch). */
  merged?: boolean;
  /** `pusher.name` and `head_commit.author.email`, for a push (the email null when the push
   *  has no head commit, as a branch deletion has none). */
  pusher?: string;
  author_email?: string | null;
}

// Bounds on the fields forwarded in X-Baton-Webhook: generous for what GitHub sends, small
// enough that a hostile value cannot bloat the header or the stored row.
const DELIVERY_ID = /^[A-Za-z0-9-]{1,64}$/; // a GUID
const MAX_WORKFLOW_PATH = 300;
const MAX_PUSHER = 100; // a login, or `github-actions[bot]`
const MAX_EMAIL = 320; // RFC 5321's limit
const enc = new TextEncoder();

/** `X-Hub-Signature-256` of `body` under `secret`: `sha256=` and the HMAC's hex. */
export async function deliverySignature(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body as Uint8Array<ArrayBuffer>));
  return 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The delivery's body, once its signature is the App's — before a byte of it is parsed. An
 *  unconfigured secret refuses every delivery: nothing unsigned is ever accepted. */
export async function verifyDelivery(req: Request, secret: string | undefined): Promise<Uint8Array> {
  if (!secret) throw new BatonError('forbidden', 'the GitHub App webhook secret is not configured');
  const presented = req.headers.get('X-Hub-Signature-256') ?? '';
  if (!/^sha256=[0-9a-f]{64}$/.test(presented)) throw new BatonError('unauthenticated', 'X-Hub-Signature-256 is required');
  const body = await readCapped(req, MAX_DELIVERY);
  const want = await deliverySignature(secret, body);
  if (!equalBytes(enc.encode(presented), enc.encode(want))) throw new BatonError('unauthenticated', 'the delivery signature does not verify');
  return body;
}

/** A string at `v`, or undefined. */
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
/** `o[k]` when `o` is an object (never an array), else undefined — one read per call. */
const at = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>)[k] : undefined);

/**
 * The one parser: R-BTN-73's fields of a verified delivery, or null for one to drop — an event
 * outside the five, a missing or malformed field. It reads `repository.full_name`, and
 * `workflow_run.path` for a workflow_run, `pusher.name` and `head_commit.author.email` for a
 * push, or `pull_request.merged` for a pull_request (B-89), and touches nothing else in the
 * payload.
 */
export function pickDelivery(event: string | null, id: string | null, payload: unknown): Delivery | null {
  if (!event || !(WEBHOOK_EVENTS as readonly string[]).includes(event)) return null;
  if (!id || !DELIVERY_ID.test(id)) return null;
  const repository = str(at(at(payload, 'repository'), 'full_name'));
  if (!repository || !GIT_REPO.test(repository)) return null;
  const d: Delivery = { event: event as WebhookEvent, id, repository };
  if (event === 'workflow_run') {
    const path = str(at(at(payload, 'workflow_run'), 'path'));
    if (!path || path.length > MAX_WORKFLOW_PATH) return null;
    d.workflow_path = path;
  }
  if (event === 'push') {
    const pusher = str(at(at(payload, 'pusher'), 'name'));
    if (!pusher || pusher.length > MAX_PUSHER) return null;
    d.pusher = pusher;
    const head = at(payload, 'head_commit');
    const email = head === null ? null : str(at(at(head, 'author'), 'email'));
    if (email === undefined || (email !== null && email.length > MAX_EMAIL)) return null;
    d.author_email = email;
  }
  if (event === 'pull_request') {
    // B-89: a merge moves the default branch, and a push delivery for that merge is not
    // guaranteed on time — the merge itself is the event the board follows.
    const merged = at(at(payload, 'pull_request'), 'merged');
    if (merged !== undefined) {
      if (typeof merged !== 'boolean') return null;
      d.merged = merged;
    }
  }
  return d;
}

interface Registered { id: string; github: string; sync_workflow: string; mirror_workflow: string | null }

/** What the core does with a delivery. */
export type DeliveryOutcome =
  | { outcome: 'duplicate' }
  | { outcome: 'own-work' }
  | { outcome: 'not-a-merge' }
  | { outcome: 'dispatched'; now: string[]; trailing: string[] };

export class Webhooks {
  constructor(private readonly c: { store: Store; now: () => number }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec(q, ...p).toArray() as T[];
  }

  /** R-BTN-73, in one transaction: drop a repeat and Baton's own feedback, then for each
   *  repository whose tickets name the delivery's, dispatch now or mark the window's trailing
   *  dispatch. Returns which repositories' syncs to dispatch now and which wait for a trailing
   *  one; the caller sends the first after the response. A `pull_request` that was not a merge
   *  (B-89) marks itself and dispatches nothing. */
  receive(d: Delivery): DeliveryOutcome {
    const now = this.c.now();
    this.c.store.exec('DELETE FROM webhook_deliveries WHERE received_at < ?', now - DELIVERY_TTL_MS);
    if (this.rows('SELECT 1 FROM webhook_deliveries WHERE delivery_id = ?', d.id).length) return { outcome: 'duplicate' };
    this.c.store.exec('INSERT INTO webhook_deliveries (delivery_id, received_at) VALUES (?, ?)', d.id, now);
    const full = d.repository.toLowerCase();
    // The App serves github.com repositories alone (R-BTN-92, round 1 of R3-1262).
    const registered = this.rows<Registered>(`SELECT id, github, sync_workflow, mirror_workflow FROM repositories
       WHERE retired_at IS NULL AND forge = 'github' AND lower(web_base) = 'https://github.com/' || lower(github)`);
    if (this.ownWork(d, full, registered)) return { outcome: 'own-work' };
    // B-89: a merge is the trigger; a pull_request the App sends for an opened, synchronised or
    // closed-without-merging PR moves the default branch nowhere, so the board owes nothing.
    if (d.event === 'pull_request' && d.merged !== true) return { outcome: 'not-a-merge' };
    const targets = this.targets(full, registered);
    // A merge's own sync is timed here (B-89), whether or not the merged ticket's want already
    // wrote its window: the row is the webhook path's last send there, what the alarm reads.
    const own = d.event === 'pull_request' ? registered.find((r) => r.github.toLowerCase() === full)?.id : undefined;
    if (own) {
      this.c.store.exec(`INSERT INTO webhook_syncs (repository_id, last_dispatch_at) VALUES (?, ?)
                         ON CONFLICT (repository_id) DO UPDATE SET last_dispatch_at = excluded.last_dispatch_at`, own, now);
    }
    // B-89: a merge of the repository's own sends its own sync — the trigger that fires
    // when GitHub's schedule does not. R-BTN-73 held it back before the cutover only because
    // `claim.sh` sent the syncs then; a sync that reads git from GitHub needs no mirror, so a
    // merge sends one the moment it arrives, and the schedule is the backstop. Its own want
    // leads the merged tickets' — as a ticket's `repos:` naming the repository once did — and
    // is one entry however many of them named it.
    const nowDue: string[] = [];
    const trailing: string[] = [];
    let seenOwn = false;
    const write = (repository: string): void => {
      if (nowDue.includes(repository) || trailing.includes(repository)) {
        if (own === repository) seenOwn = true;
        return;
      }
      const row = this.rows<{ last_dispatch_at: number }>('SELECT last_dispatch_at FROM webhook_dispatch WHERE repository_id = ?', repository)[0];
      if (!row || now - row.last_dispatch_at >= DISPATCH_WINDOW_MS) {
        this.c.store.exec(`INSERT INTO webhook_dispatch (repository_id, last_dispatch_at, trailing_at) VALUES (?, ?, NULL)
                           ON CONFLICT (repository_id) DO UPDATE SET last_dispatch_at = excluded.last_dispatch_at, trailing_at = NULL`, repository, now);
        nowDue.push(repository);
      } else {
        // One write per window, not one per suppressed delivery (§3's write budget).
        this.c.store.exec('UPDATE webhook_dispatch SET trailing_at = ? WHERE repository_id = ? AND trailing_at IS NULL', row.last_dispatch_at + DISPATCH_WINDOW_MS, repository);
        trailing.push(repository);
      }
      if (own === repository) seenOwn = true;
    };
    // The merge's own want first, then the tickets' — as a ticket's `repos:` naming the
    // repository once led.
    if (own) write(own);
    for (const id of targets) write(id);
    if (own && !seenOwn) nowDue.push(own);
    return { outcome: 'dispatched', now: nowDue, trailing };
  }

  /** B-89, at the alarm: a repository whose last webhook-driven sync is over ten minutes stale
   *  is due one — the App's deliveries reached Baton, and this path did not send one. Each due
   *  repository's send is stamped and its 30-second window opened (the one R-BTN-73's dispatches
   *  share), so the next tick finds it fresh and a delivery meanwhile waits for its trailing
   *  dispatch rather than racing it. A repository with no row has never been sent one and takes
   *  no part: the path only serves repositories its deliveries led it to. */
  dueSync(): string[] {
    const now = this.c.now();
    const due = this.rows<{ repository_id: string }>(`SELECT s.repository_id FROM webhook_syncs s
       JOIN repositories r ON r.id = s.repository_id AND r.retired_at IS NULL
       WHERE s.last_dispatch_at <= ? ORDER BY s.repository_id`, now - SYNC_STALE_MS).map((r) => r.repository_id);
    for (const id of due) {
      this.c.store.exec(`INSERT INTO webhook_dispatch (repository_id, last_dispatch_at, trailing_at) VALUES (?, ?, NULL)
                         ON CONFLICT (repository_id) DO UPDATE SET last_dispatch_at = excluded.last_dispatch_at, trailing_at = NULL`, id, now);
      this.c.store.exec('UPDATE webhook_syncs SET last_dispatch_at = ? WHERE repository_id = ?', now, id);
    }
    return due;
  }

  /** A workflow_run of a registered repository's own sync or mirror workflow, or a push by the
   *  Actions bot whose head commit is the mirror's: Baton's own work, so a sync never
   *  triggers the next. */
  private ownWork(d: Delivery, full: string, registered: Registered[]): boolean {
    if (d.event === 'workflow_run') {
      return registered.some((r) => r.github.toLowerCase() === full && (d.workflow_path === r.sync_workflow || d.workflow_path === r.mirror_workflow));
    }
    if (d.event === 'push') return d.pusher === ACTIONS_BOT && d.author_email === MIRROR_EMAIL;
    return false;
  }

  /** The registered repositories whose tickets name `full` — their home, or their `repos:`:
   *  owner/name once the sync resolves them, and meanwhile docs' interim short names, read as
   *  that name under the home repository's own owner — so another owner's repository of the
   *  same name names nothing (round 1, 1-B-1). */
  private targets(full: string, registered: Registered[]): string[] {
    const slash = full.indexOf('/');
    const owner = full.slice(0, slash);
    const name = full.slice(slash + 1);
    const out = new Set(registered.filter((r) => r.github.toLowerCase() === full).map((r) => r.id));
    for (const r of this.rows<{ repository_id: string }>(
      `SELECT DISTINCT t.repository_id FROM tickets t JOIN repositories p ON p.id = t.repository_id, json_each(t.repos) j
       WHERE lower(j.value) = ?
          OR (lower(j.value) = ? AND instr(j.value, '/') = 0 AND lower(substr(p.github, 1, instr(p.github, '/') - 1)) = ?)`, full, name, owner)) {
      if (registered.some((g) => g.id === r.repository_id)) out.add(r.repository_id);
    }
    return [...out].sort();
  }

  /** The alarm: the repositories whose trailing dispatch is due, each starting a new window. */
  dueTrailing(): string[] {
    const now = this.c.now();
    // A repository retired inside its window owes nothing (round 1, 1-B-5).
    this.c.store.exec(`UPDATE webhook_dispatch SET trailing_at = NULL WHERE trailing_at IS NOT NULL
                       AND repository_id IN (SELECT id FROM repositories WHERE retired_at IS NOT NULL)`);
    const due = this.rows<{ repository_id: string }>('SELECT repository_id FROM webhook_dispatch WHERE trailing_at IS NOT NULL AND trailing_at <= ? ORDER BY repository_id', now).map((r) => r.repository_id);
    for (const id of due) this.c.store.exec('UPDATE webhook_dispatch SET last_dispatch_at = ?, trailing_at = NULL WHERE repository_id = ?', now, id);
    return due;
  }

  /** The earliest trailing dispatch still to come, for the alarm to fire at. */
  nextTrailing(): number | null {
    return this.rows<{ at: number | null }>('SELECT min(trailing_at) AS at FROM webhook_dispatch WHERE trailing_at IS NOT NULL')[0]?.at ?? null;
  }
}
