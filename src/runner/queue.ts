// queue.ts — a runner's local work queue (BATON_SPEC §8.3 R-BTN-202, B-248): one JSON file per
// home checkout under the runner's cache directory, mode 0600, shared by every runner session on
// that home and by `baton queue`, the host user's command. It holds:
//   - `orders`: what the host's user asked for (`baton queue add`), oldest first — tried before
//     any recommendation while Baton answers (an ordinary claim, every gate), and started without
//     a claim only while Baton is unreachable;
//   - `recommendations`: the last list Baton recommended, kept as a queue rather than dropped
//     after one claim attempt, so an idle runner holding entries does not ask every beat;
//   - `control_required`: whether the last claim answer said the repository requires
//     owner-signed control (B-127) — an offline order runs only where it said not;
//   - `worked`: legs run under an order while Baton was unreachable, whose results wait to be
//     reported through an ordinary claim when Baton answers again.
// A leg never reaches this file: it lives on the runner's host, outside every leg session.
// Every change is read-modify-write through a temporary file and a rename, so a `baton queue
// add` racing a runner's write loses nothing but, at worst, one of two simultaneous changes.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { batonNow } from '../shared/baton.mjs';

/** An order the host's user gave: a ticket, and the leg to run when Baton cannot be asked. */
export interface LocalOrder {
  ticket_id: string;
  leg: string | null;
  /** `user@host` — the provenance the report carries (R-BTN-202). */
  by: string;
  added_at: string;
}

/** One recommendation as Baton served it (§11): the station the ticket rests at and its legs. */
export interface QueuedRecommendation {
  ticket_id: string;
  station: string;
  legs: string[];
}

/** A leg run under an order while Baton was unreachable, its result kept for the report. */
export interface WorkedLeg {
  ticket_id: string;
  leg: string;
  /** The station the leg left. */
  at: string;
  /** The leg script's validated-later result, as `run` returned it. */
  result: unknown;
  /** What its `close` returned: the evidence commit, null for none. */
  closed: string | null;
  by: string;
  ran_at: string;
}

export interface QueueData {
  orders: LocalOrder[];
  recommendations: QueuedRecommendation[];
  recommended_at: number | null;
  /** The last list in full, never shifted — where an offline order finds its ticket's station
   *  and leg when it names none (R-BTN-202). */
  seen: QueuedRecommendation[];
  control_required: boolean | null;
  worked: WorkedLeg[];
}

const empty = (): QueueData => ({ orders: [], recommendations: [], recommended_at: null, seen: [], control_required: null, worked: [] });

/** `<repository>:<id>` — the qualified ticket id Baton's claims name. */
export const QUALIFIED_ID = /^[a-z0-9][a-z0-9-]{0,63}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LEG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The queue file of one home checkout, under the runner's cache directory. */
export function queuePath(cacheDir: string, home: string): string {
  return join(cacheDir, 'queue', `${createHash('sha1').update(resolve(home)).digest('hex').slice(0, 12)}.json`);
}

/** Who gives an order: the host's OS user at the host, the shape R-BTN-202's provenance takes. */
export function orderGiver(): string {
  const user = (() => { try { return userInfo().username; } catch { return process.env.USER ?? 'unknown'; } })();
  return `${user}@${hostname()}`.replace(/[^A-Za-z0-9._@+-]/g, '-').slice(0, 128);
}

export class LocalQueue {
  constructor(readonly path: string) {}

  read(): QueueData {
    if (!existsSync(this.path)) return empty();
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<QueueData>;
      return {
        orders: Array.isArray(raw.orders) ? raw.orders : [],
        recommendations: Array.isArray(raw.recommendations) ? raw.recommendations : [],
        recommended_at: typeof raw.recommended_at === 'number' ? raw.recommended_at : null,
        seen: Array.isArray(raw.seen) ? raw.seen : [],
        control_required: typeof raw.control_required === 'boolean' ? raw.control_required : null,
        worked: Array.isArray(raw.worked) ? raw.worked : [],
      };
    } catch {
      return empty();
    }
  }

  /** Read, change and write back — the one way the file changes. */
  update<T>(f: (q: QueueData) => T): T {
    const q = this.read();
    const out = f(q);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(q, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
    return out;
  }

  /** `baton queue add`: an order at the back, or the existing order for the ticket replaced. */
  add(ticketId: string, leg: string | null, by: string, now: number): LocalOrder {
    if (!QUALIFIED_ID.test(ticketId)) throw new Error(`${ticketId}: a ticket is <repository>:<id>, e.g. baton:B-248`);
    if (leg != null && !LEG.test(leg)) throw new Error(`${leg}: not a leg name`);
    const order: LocalOrder = { ticket_id: ticketId, leg, by, added_at: new Date(now).toISOString() };
    this.update((q) => {
      q.orders = [...q.orders.filter((o) => o.ticket_id !== ticketId), order];
    });
    return order;
  }

  /** `baton queue remove`: the ticket's order and any unreported offline result. */
  remove(ticketId: string): boolean {
    return this.update((q) => {
      const before = q.orders.length + q.worked.length;
      q.orders = q.orders.filter((o) => o.ticket_id !== ticketId);
      q.worked = q.worked.filter((w) => w.ticket_id !== ticketId);
      return q.orders.length + q.worked.length !== before;
    });
  }

  dropOrder(ticketId: string): void {
    this.update((q) => { q.orders = q.orders.filter((o) => o.ticket_id !== ticketId); });
  }

  /** The recommendations Baton served, kept in its order (R-BTN-202). */
  setRecommendations(recs: QueuedRecommendation[], now: number): void {
    this.update((q) => { q.recommendations = [...recs]; q.seen = [...recs]; q.recommended_at = now; });
  }

  /** The head recommendation, taken off the queue: a claim attempt spends it either way. */
  shiftRecommendation(): QueuedRecommendation | null {
    return this.update((q) => q.recommendations.shift() ?? null);
  }

  setControlRequired(required: boolean): void {
    if (this.read().control_required === required) return;
    this.update((q) => { q.control_required = required; });
  }

  /** An order run offline: the order goes, its result waits for Baton. */
  recordWorked(w: WorkedLeg): void {
    this.update((q) => {
      q.orders = q.orders.filter((o) => o.ticket_id !== w.ticket_id);
      q.worked = [...q.worked.filter((x) => x.ticket_id !== w.ticket_id), w];
    });
  }

  takeWorked(ticketId: string): WorkedLeg | null {
    return this.update((q) => {
      const w = q.worked.find((x) => x.ticket_id === ticketId) ?? null;
      q.worked = q.worked.filter((x) => x.ticket_id !== ticketId);
      return w;
    });
  }
}

export const QUEUE_USAGE = `baton queue add <repository>:<id>[@leg] [--home DIR]
baton queue list [--home DIR]
baton queue remove <repository>:<id> [--home DIR]
  — this host's local work queue for the runners on one home checkout (R-BTN-202, B-248). An
  order goes first while Baton answers, through the ordinary claim and every gate; while Baton is
  unreachable the runner starts its leg (@leg, else the leg Baton last recommended for it)
  without a claim and reports the result when Baton answers again. --home defaults to
  BATON_HOME, else the current directory.`;

/** \`baton queue …\` — the host user's command; it never reaches Baton. */
export function queueMain(argv: string[], cacheDir: string, resolveHome: (h: string) => string, out: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): number {
  let home = process.env.BATON_HOME ?? process.cwd();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--home') home = argv[++i] ?? '';
    else if (argv[i] === '--help' || argv[i] === '-h') { out(QUEUE_USAGE); return 0; }
    else rest.push(argv[i]);
  }
  const q = new LocalQueue(queuePath(cacheDir, resolveHome(home)));
  const [cmd, target] = rest;
  try {
    if (cmd === 'add' && target && rest.length === 2) {
      const at = target.lastIndexOf('@');
      const [ticket, leg] = at > 0 ? [target.slice(0, at), target.slice(at + 1)] : [target, null];
      const o = q.add(ticket, leg, orderGiver(), batonNow());
      out(`queued ${o.ticket_id}${o.leg ? `@${o.leg}` : ''} for the runners on ${resolve(resolveHome(home))} (by ${o.by})`);
      return 0;
    }
    if (cmd === 'remove' && target && rest.length === 2) {
      out(q.remove(target) ? `removed ${target}` : `${target} is not queued`);
      return 0;
    }
    if (cmd === 'list' && rest.length === 1) {
      const d = q.read();
      if (!d.orders.length && !d.worked.length && !d.recommendations.length) out('the queue is empty');
      for (const o of d.orders) out(`order        ${o.ticket_id}${o.leg ? `@${o.leg}` : ''}  by ${o.by} at ${o.added_at}`);
      for (const w of d.worked) out(`unreported   ${w.ticket_id}@${w.leg} from ${w.at}  ran ${w.ran_at} (order by ${w.by})`);
      for (const r of d.recommendations) out(`recommended  ${r.ticket_id} at ${r.station}, ${r.legs.join(', ') || 'no leg'}`);
      return 0;
    }
  } catch (e) {
    process.stderr.write(`baton: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  process.stderr.write(`${QUEUE_USAGE}\n`);
  return 2;
}
