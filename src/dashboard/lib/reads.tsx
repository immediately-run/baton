// reads.tsx — the dashboard's one polling layer (B-221, §11.4's Polling): every read a screen or
// the shell draws is held here, fetched together every 10 seconds with `If-None-Match` (B-205);
// while every answer is unchanged (`304`) the interval doubles, to at most 60 seconds, and a
// changed answer or the page shown again brings it back to 10 (B-242). The last good answer is
// kept on an error; polling pauses while the page is hidden and fetches at once on return; an
// `unauthenticated` answer stops it and tells the shell, which draws the sign-in in place.
// Freshness is measured from the last `200` or `304` by the browser's clock. The one exception
// to the 10-second rule is the confirmation-code dialog's 5 seconds for its two minutes
// (R-BTN-155, `fast`). No screen fetches a read any other way.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ApiError, apiGet, asApiError, type GetResult } from './api';

export const POLL_MS = 10_000;
export const POLL_MAX_MS = 60_000;
export const FAST_MS = 5_000;

/** One read as a screen sees it. `data` is the last good answer — kept through a later error —
 *  and `error` the latest refusal, if the latest answer was one. */
export interface Read<T = unknown> {
  path: string | null;
  data: T | undefined;
  error: ApiError | null;
  /** No answer yet, good or bad. */
  loading: boolean;
  /** When the last `200` or `304` arrived, by the browser's clock; null before the first. */
  okAt: number | null;
}

/** What the sidebar's freshness line draws. */
export interface Freshness {
  okAt: number | null;
  error: ApiError | null;
  interval: number;
  paused: boolean;
  stopped: boolean;
}

interface Entry {
  path: string;
  etag: string | null;
  every: number | null;
  fetchedAt: number;
  listeners: Set<() => void>;
  snap: Read;
  inflight: Promise<'changed' | 'same' | 'error'> | null;
}

export interface ReadStoreOptions {
  get?: (path: string, etag?: string | null) => Promise<GetResult>;
  now?: () => number;
  /** Is the page hidden? Default: `document.visibilityState`. */
  hidden?: () => boolean;
}

const EMPTY: Read = Object.freeze({ path: null, data: undefined, error: null, loading: true, okAt: null });

export class ReadStore {
  private readonly get: NonNullable<ReadStoreOptions['get']>;
  private readonly now: () => number;
  private readonly hidden: () => boolean;
  private readonly entries = new Map<string, Entry>();
  private readonly watchers = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval = POLL_MS;
  private fastUntil = 0;
  private stopped = false;
  private paused = false;
  private attached = false;
  private fresh: Freshness = { okAt: null, error: null, interval: POLL_MS, paused: false, stopped: false };
  /** Bumped on every change to any read or to the freshness: `useSyncExternalStore`'s snapshot. */
  rev = 0;
  /** Bumped on every `200` — an answer that changed. The code dialog closes on it (B-207). */
  changes = 0;
  /** Called once when a read answers `unauthenticated`; the shell draws the sign-in in place. */
  onUnauthenticated: (() => void) | null = null;

  constructor(opts: ReadStoreOptions = {}) {
    this.get = opts.get ?? apiGet;
    this.now = opts.now ?? (() => Date.now());
    this.hidden = opts.hidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  }

  // ── subscriptions ────────────────────────────────────────────────────────────────────────

  /** Hold `path` while the listener lives: fetched at once when new, then with every poll —
   *  or, with `every`, no more often than that (`GET /v1/actions`' 60 seconds). */
  subscribe(path: string, listener: () => void, every?: number): () => void {
    let e = this.entries.get(path);
    if (!e) {
      e = { path, etag: null, every: every ?? null, fetchedAt: 0, listeners: new Set(), snap: { ...EMPTY, path }, inflight: null };
      this.entries.set(path, e);
      if (!this.stopped) void this.fetchOne(e);
    } else if (every !== undefined && (e.every === null || every < e.every)) e.every = every;
    e.listeners.add(listener);
    this.attach();
    this.schedule();
    return () => {
      const cur = this.entries.get(path);
      if (!cur) return;
      cur.listeners.delete(listener);
      if (cur.listeners.size === 0) this.entries.delete(path);
      if (this.entries.size === 0) this.clear();
    };
  }

  /** Any change at all — the freshness line's subscription. */
  watch(listener: () => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  snapshot(path: string | null): Read {
    return (path !== null && this.entries.get(path)?.snap) || EMPTY;
  }

  freshness(): Freshness {
    return this.fresh;
  }

  // ── the loop ─────────────────────────────────────────────────────────────────────────────

  private attach() {
    if (this.attached || typeof document === 'undefined') return;
    this.attached = true;
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Stop listening to the page; a test's teardown. */
  dispose() {
    this.clear();
    if (this.attached) document.removeEventListener('visibilitychange', this.onVisibility);
    this.attached = false;
    this.entries.clear();
    this.watchers.clear();
  }

  private onVisibility = () => {
    if (this.hidden()) {
      this.paused = true;
      this.clear();
      this.setFresh({});
    } else if (this.paused) {
      this.paused = false;
      this.interval = POLL_MS;
      void this.poll(true);
    }
  };

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private delay(): number {
    return this.now() < this.fastUntil ? FAST_MS : this.interval;
  }

  private schedule() {
    if (this.timer !== null || this.stopped || this.entries.size === 0) return;
    if (this.hidden()) {
      this.paused = true;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll(false);
    }, this.delay());
  }

  /** One round: every read due is fetched together; then the interval is decided. */
  private async poll(all: boolean): Promise<void> {
    if (this.stopped) return;
    this.clear();
    const now = this.now();
    const due = [...this.entries.values()].filter((e) => all || e.every === null || now - e.fetchedAt >= e.every);
    const results = await Promise.all(due.map((e) => this.fetchOne(e)));
    if (this.stopped) return;
    const steady = due.filter((e) => e.every === null);
    // A round the page asked for — shown again, a control's refetch, sign-in — is followed 10
    // seconds later whatever it answered; only the timer's own unchanged rounds back off.
    if (all || results.includes('changed')) this.interval = POLL_MS;
    else if (steady.length > 0 && results.every((r) => r === 'same')) this.interval = Math.min(this.interval * 2, POLL_MAX_MS);
    this.setFresh({});
    this.schedule();
  }

  private fetchOne(e: Entry): Promise<'changed' | 'same' | 'error'> {
    if (e.inflight) return e.inflight;
    e.fetchedAt = this.now();
    const run = (async (): Promise<'changed' | 'same' | 'error'> => {
      try {
        // An answer is only "the same" beside the answer it matches: no data, no validator.
        const res = await this.get(e.path, e.snap.data === undefined ? null : e.etag);
        if (this.entries.get(e.path) !== e) return 'same';
        if (res.changed) {
          e.etag = res.etag;
          e.snap = { path: e.path, data: res.data, error: null, loading: false, okAt: this.now() };
          this.changes++;
        } else e.snap = { ...e.snap, error: null, loading: false, okAt: this.now() };
        this.emit(e);
        this.setFresh({ okAt: this.now(), error: this.worst() });
        return res.changed ? 'changed' : 'same';
      } catch (err) {
        const error = asApiError(err);
        if (this.entries.get(e.path) !== e) return 'error';
        e.snap = { ...e.snap, error, loading: false };
        this.emit(e);
        if (error.code === 'unauthenticated') this.signedOut();
        else this.setFresh({ error });
        return 'error';
      } finally {
        e.inflight = null;
      }
    })();
    e.inflight = run;
    return run;
  }

  /** The refusal the freshness line names: any read's standing one. */
  private worst(): ApiError | null {
    for (const e of this.entries.values()) if (e.snap.error) return e.snap.error;
    return null;
  }

  private emit(e: Entry) {
    this.rev++;
    for (const l of [...e.listeners]) l();
  }

  private setFresh(part: Partial<Freshness>) {
    this.fresh = { ...this.fresh, ...part, interval: this.delay(), paused: this.paused, stopped: this.stopped };
    this.rev++;
    for (const w of [...this.watchers]) w();
  }

  private signedOut() {
    if (this.stopped) return;
    this.stopped = true;
    this.clear();
    this.setFresh({});
    this.onUnauthenticated?.();
  }

  // ── what the shell and the controls ask ──────────────────────────────────────────────────

  /** Fetch every read now and return to the 10-second interval: after a control's `200`
   *  (B-207), and after sign-in. */
  async refresh(): Promise<void> {
    this.stopped = false;
    this.paused = false;
    this.interval = POLL_MS;
    await this.poll(true);
  }

  /** Stop polling and forget every answer: logout, or the session's end. */
  reset() {
    this.stopped = true;
    this.clear();
    for (const e of this.entries.values()) {
      e.etag = null;
      e.snap = { ...EMPTY, path: e.path };
      this.emit(e);
    }
    this.fresh = { okAt: null, error: null, interval: POLL_MS, paused: false, stopped: true };
    this.setFresh({});
  }

  /** The confirmation-code dialog's exception (R-BTN-155): poll every 5 seconds for `ms`. */
  fast(ms: number) {
    this.fastUntil = ms > 0 ? this.now() + ms : 0;
    this.clear();
    this.setFresh({});
    this.schedule();
  }
}

// ── React ──────────────────────────────────────────────────────────────────────────────────

const StoreContext = createContext<ReadStore | null>(null);

/** Gives every screen below it the one store. */
export function ReadsProvider({ store, children }: { store: ReadStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useReadStore(): ReadStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useRead needs a ReadsProvider above it (the shell, or renderWithShell in a test)');
  return store;
}

export interface ReadOptions {
  /** Fetch no more often than this many milliseconds, whatever the poll's interval. */
  every?: number;
}

/** A screen's reads, fetched together and polled by the one rule above. A `null` path is a read
 *  the screen does not need yet (an id it has not learned): it stays `loading` and costs nothing. */
export function useReads(paths: readonly (string | null)[], opts: ReadOptions = {}): Read[] {
  const store = useReadStore();
  const key = paths.map((p) => p ?? '').join('\n');
  const every = opts.every;
  const subscribe = useCallback((listener: () => void) => {
    const offs = key.split('\n').filter((p) => p !== '').map((p) => store.subscribe(p, listener, every));
    return () => offs.forEach((off) => off());
    // `key` stands for `paths`: a new array with the same paths is the same subscription.
  }, [store, key, every]);
  useSyncExternalStore(subscribe, () => store.rev, () => store.rev);
  return paths.map((p) => store.snapshot(p));
}

/** One read. `useRead<T>` names the shape the screen expects; the value is still untrusted. */
export function useRead<T = unknown>(path: string | null, opts: ReadOptions = {}): Read<T> {
  return useReads([path], opts)[0] as Read<T>;
}

/** The store's freshness, for the sidebar's line. */
export function useFreshness(): Freshness {
  const store = useReadStore();
  const subscribe = useCallback((l: () => void) => store.watch(l), [store]);
  useSyncExternalStore(subscribe, () => store.rev, () => store.rev);
  return store.freshness();
}

/** Refetch every read at once — what a control does after its `200`. */
export function useRefresh(): () => Promise<void> {
  const store = useReadStore();
  return useMemo(() => () => store.refresh(), [store]);
}

/** The browser's clock, ticking every `ms` while the page is visible — for "7 s ago". Display
 *  only. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') setNow(Date.now());
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
