// capacity.ts — the capacity envelope and the day's usage (BATON_SPEC §2.1 R-BTN-2, §2.3
// R-BTN-87; R3-1258). One Baton per team, not sharded: the envelope is a stated set of targets
// the dashboard draws each figure against, never a refusal — R-BTN-149's caps at twice it are
// the refusing kind. The alarm logs a `capacity` event when a figure crosses 80% upward and
// again when it falls back, and while one is over `baton.capacity` stands under Needs you
// (through today's needsYou path — B-57 converts it to a condition). The day's usage (R-BTN-2)
// is the tenant counting its own: each request its object handles, and the rows each
// transaction writes, against the plan's daily limits — two `baton_settings` counters reset at
// 00:00 UTC, so a deployment serving several tenants shows each tenant its own counters only.
import { logEvent } from './db';
import type { Store } from './ports';

/** R-BTN-87 (§2.3): the envelope — targets, not platform limits. */
export const ENVELOPE = {
  live_runners: 50,
  repositories: 20,
  live_tickets: 5_000,
  history_rows: 1_000_000,
  /** A 5-minute mean, requests a second. */
  requests_per_second: 20,
  /** Requests in any 5 seconds. */
  burst_in_5s: 100,
} as const;

export type EnvelopeFigure = keyof typeof ENVELOPE;

/** R-BTN-87: a figure crosses at 80% of its envelope value, each way. */
export const CROSSING_AT = 0.8;

/** R-BTN-2: Workers Free's daily limits, the default plan. On Workers Paid, the plan's included
 *  amounts — the one Worker var `BATON_PLAN_LIMITS` (§2.1) names them as
 *  `{"requests": <n>, "rows_written": <n>}`, defaulting to these. Nothing is refused at a limit. */
export const WORKERS_FREE_LIMITS = { requests: 100_000, rows_written: 100_000 } as const;

export interface PlanLimits {
  requests: number;
  rows_written: number;
}

/** §2.1 (R3-1258): the plan's limits as the host names them — `BATON_PLAN_LIMITS`'s pair of
 *  positive integers, else Workers Free's. A malformed var never stops a request: the default
 *  stands. */
export function planLimitsOf(raw: string | undefined): PlanLimits {
  if (raw == null || raw === '') return { ...WORKERS_FREE_LIMITS };
  try {
    const v = JSON.parse(raw) as { requests?: unknown; rows_written?: unknown };
    const ok = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;
    return ok(v.requests) && ok(v.rows_written) ? { requests: v.requests as number, rows_written: v.rows_written as number } : { ...WORKERS_FREE_LIMITS };
  } catch {
    return { ...WORKERS_FREE_LIMITS };
  }
}

/** The UTC day of an instant, `YYYY-MM-DD`: the day the usage counters belong to. */
export const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** One second's request count, for the 5-minute mean and the 5-second burst. */
const WINDOW_S = 300;

/** The figures the alarm judges and the dashboard draws: counts read from the store, rates
 *  carried in (they are the object's own live measurement — a restart resets them, as any
 *  instantaneous reading resets). */
export interface CapacityFigures {
  live_runners: number;
  repositories: number;
  live_tickets: number;
  history_rows: number;
  requests_per_second: number;
  burst_in_5s: number;
}

/** Each figure with its envelope share, over 80% or not. */
export function againstEnvelope(figures: CapacityFigures): { figure: EnvelopeFigure; value: number; envelope: number; ratio: number; over: boolean }[] {
  return (Object.keys(ENVELOPE) as EnvelopeFigure[]).map((figure) => {
    const value = figures[figure];
    const envelope = ENVELOPE[figure];
    const ratio = value / envelope;
    return { figure, value, envelope, ratio, over: ratio >= CROSSING_AT };
  });
}

/** The growing tables' counts (tickets, history rows) are MAINTAINED — a `baton_settings` row
 *  the write sites adjust — never COUNTed on the alarm's tick or the dashboard's read: a scan
 *  of a growing table is what B-236 exists to prevent, and at the envelope (5,000 tickets,
 *  1,000,000 history rows) a COUNT a minute is a scan a minute. The bounded figures (runners,
 *  repositories) count through their indexes on demand. */
const COUNTS_KEY = 'envelope_counts';

export interface MaintainedCounts {
  tickets: number;
  history: number;
}

function readCounters(store: Store): MaintainedCounts {
  const raw = store.exec<{ value: string }>('SELECT value FROM baton_settings WHERE key = ?', COUNTS_KEY).toArray()[0]?.value;
  try {
    const held = JSON.parse(raw ?? 'null') as Partial<MaintainedCounts> | null;
    if (held != null && Number.isSafeInteger(held.tickets) && Number.isSafeInteger(held.history)) {
      return { tickets: held.tickets as number, history: held.history as number };
    }
  } catch {
    // an unreadable counter row is written afresh below
  }
  // No honest row (a fresh Baton, an import): count once, through the smallest indexes, and
  // keep the result — a rare, bounded cost at the write sites that follow.
  const one = (table: string) => store.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0]?.n ?? 0;
  const fresh = { tickets: one('tickets'), history: one('ticket_history') };
  writeCounters(store, fresh);
  return fresh;
}

function writeCounters(store: Store, counts: MaintainedCounts): void {
  store.exec('INSERT INTO baton_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', COUNTS_KEY, JSON.stringify(counts));
}

/** Adjust the maintained counts, in the caller's transaction (the write sites' own). */
export function adjustCounts(store: Store, delta: Partial<MaintainedCounts>): void {
  const now = readCounters(store);
  writeCounters(store, {
    tickets: Math.max(0, now.tickets + (delta.tickets ?? 0)),
    history: Math.max(0, now.history + (delta.history ?? 0)),
  });
}

/** The maintained counts as they stand. */
export function maintainedCounts(store: Store): MaintainedCounts {
  return readCounters(store);
}

/** The per-second request counts of the last five minutes — the object's own ring, one bucket a
 *  second. Pure bookkeeping: the core counts its requests in, the alarm and the dashboard read
 *  the mean and the burst out. */
export class RequestRing {
  private readonly buckets = new Map<number, number>();
  private lastTake = -1;

  /** Count one request at `at`. */
  count(at: number) {
    const second = Math.floor(at / 1000);
    this.buckets.set(second, (this.buckets.get(second) ?? 0) + 1);
    this.lastTake = Math.max(this.lastTake, second);
  }

  /** Forget buckets older than the window. */
  private prune(now: number) {
    const floor = Math.floor(now / 1000) - WINDOW_S;
    for (const second of this.buckets.keys()) if (second < floor) this.buckets.delete(second);
  }

  /** The 5-minute mean, requests a second, and the greatest burst in any 5 seconds. */
  rates(now: number): { requests_per_second: number; burst_in_5s: number } {
    this.prune(now);
    const second = Math.floor(now / 1000);
    let total = 0;
    let burst = 0;
    for (let s = second - WINDOW_S + 1; s <= second; s++) {
      const n = this.buckets.get(s) ?? 0;
      total += n;
    }
    for (let s = second - WINDOW_S + 1; s <= second; s++) {
      let five = 0;
      for (let k = 0; k < 5; k++) five += this.buckets.get(s + k) ?? 0;
      if (five > burst) burst = five;
    }
    return { requests_per_second: Math.round((total / WINDOW_S) * 100) / 100, burst_in_5s: burst };
  }
}

export class Capacity {
  private readonly settings: (key: string, value: string | null) => void;
  private readonly setting: (key: string) => string | null;

  constructor(private readonly c: {
    store: Store;
    now: () => number;
    /** §2.1's one Worker var, `BATON_PLAN_LIMITS` (R3-1258): read at each use, so a host that
     *  changes its configuration serves the change. */
    config?: { BATON_PLAN_LIMITS?: string };
  }) {
    const get = (key: string) => this.c.store.exec<{ value: string }>('SELECT value FROM baton_settings WHERE key = ?', key).toArray()[0]?.value ?? null;
    const put = (key: string, value: string | null) => {
      if (value == null) this.c.store.exec('DELETE FROM baton_settings WHERE key = ?', key);
      else this.c.store.exec('INSERT INTO baton_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
    };
    this.setting = get;
    this.settings = put;
  }

  /** The envelope's counts: the growing two (tickets, history rows) from the maintained
   *  counters — never a scan of a growing table (B-236) — beside the bounded two, counted
   *  through their indexes, and the rates the caller measured. */
  counts(): Pick<CapacityFigures, 'live_runners' | 'repositories' | 'live_tickets' | 'history_rows'> {
    const one = (q: string) => this.c.store.exec<{ n: number }>(q).toArray()[0]?.n ?? 0;
    const kept = maintainedCounts(this.c.store);
    return {
      live_runners: one(`SELECT COUNT(*) AS n FROM runners WHERE reaped_at IS NULL AND kind != 'legacy'`),
      repositories: one('SELECT COUNT(*) AS n FROM repositories WHERE retired_at IS NULL'),
      live_tickets: kept.tickets,
      history_rows: kept.history,
    };
  }

  /** The day's usage (R-BTN-2) as one `baton_settings` row — `{"day","requests","rows_written"}`,
   *  read and written once a request (B-241's statement budget): the two counters reset at
   *  00:00 UTC, so a deployment serving several tenants shows each tenant its own only. */
  private readonly USAGE_KEY = 'usage';

  usage(): { day: string; requests: number; rows_written: number; limits: PlanLimits } {
    let day = '';
    let requests = 0;
    let rows = 0;
    try {
      const held = JSON.parse(this.setting(this.USAGE_KEY) ?? '{}') as { day?: unknown; requests?: unknown; rows_written?: unknown };
      day = typeof held.day === 'string' ? held.day : '';
      requests = Number.isSafeInteger(held.requests) ? held.requests as number : 0;
      rows = Number.isSafeInteger(held.rows_written) ? held.rows_written as number : 0;
    } catch {
      // an unreadable counter is an empty one
    }
    const today = utcDay(this.c.now());
    if (day !== today) {
      day = today;
      requests = 0;
      rows = 0;
    }
    return { day, requests, rows_written: rows, limits: planLimitsOf(this.c.config?.BATON_PLAN_LIMITS) };
  }

  private writeUsage(day: string, requests: number, rows: number): void {
    this.settings(this.USAGE_KEY, JSON.stringify({ day, requests, rows_written: rows }));
  }

  /** Count one request the object handled and the rows its transactions wrote (R-BTN-2), in the
   *  caller's quiet write — one read and one write a request, so the counter's own rows never
   *  count as usage and the statement budgets (B-241) hold. */
  count(requests: number, rows: number) {
    const now = this.usage();
    this.writeUsage(now.day, now.requests + requests, now.rows_written + rows);
  }

  /** The alarm's judgement (R-BTN-87): a figure crossing 80% upward logs `capacity`, and so does
   *  its falling back; the set over now is kept in `baton_settings.capacity_over`, so a restart
   *  does not re-log a standing crossing. Returns the figures it now holds over, for Needs you. */
  alarm(figures: CapacityFigures): { figure: EnvelopeFigure; value: number; envelope: number }[] {
    const rows = againstEnvelope(figures);
    const before = new Set<string>(JSON.parse(this.setting('capacity_over') ?? '[]') as string[]);
    const now = new Set(rows.filter((r) => r.over).map((r) => r.figure));
    const at = this.c.now();
    for (const r of rows) {
      if (r.over === before.has(r.figure)) continue;
      logEvent(this.c.store, at, 'capacity', 'alarm', {
        figure: r.figure, value: r.value, envelope: r.envelope,
        crossing: r.over ? 'upward' : 'back',
      }, null, null, null);
    }
    if (now.size !== before.size || [...now].some((f) => !before.has(f))) this.settings('capacity_over', JSON.stringify([...now].sort()));
    return rows.filter((r) => r.over).map(({ figure, value, envelope }) => ({ figure, value, envelope }));
  }

  /** Needs you (§4.8's `baton.capacity`, through today's path): the figures over 80% now. */
  needsYou(figures: CapacityFigures) {
    const over = againstEnvelope(figures).filter((r) => r.over).map(({ figure, value, envelope }) => ({ figure, value, envelope }));
    return { capacity: over };
  }

  /** The dashboard's Capacity figures (§11.4): every figure against the envelope, and the day's
   *  usage against the plan's limits (R-BTN-2). */
  view(figures: CapacityFigures) {
    return {
      envelope: ENVELOPE,
      figures: againstEnvelope(figures),
      day: this.usage(),
    };
  }
}
