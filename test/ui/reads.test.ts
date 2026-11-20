// reads.test.ts — the one polling layer (B-221 item 2, §11.4's Polling): reads fetched together
// every 10 seconds with `If-None-Match`; the interval doubling to 60 seconds while every answer
// is `304` and back to 10 on a change or on the page shown again; the last good answer kept on
// an error; paused while hidden, fetched at once on return; stopped on `unauthenticated`;
// `GET /v1/actions` no more often than its 60 seconds; the code dialog's 5 seconds; freshness
// from the last `200` or `304`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type GetResult } from '../../src/dashboard/lib/api';
import { FAST_MS, POLL_MAX_MS, POLL_MS, ReadStore } from '../../src/dashboard/lib/reads';

type Step = GetResult | ApiError;
let hidden = false;
let seen: { path: string; etag: string | null | undefined; at: number }[] = [];
let answers: Record<string, (etag: string | null | undefined) => Step>;
let store: ReadStore;

const ok = (data: unknown, etag: string): GetResult => ({ changed: true, data, etag });
const same: GetResult = { changed: false };
/** The server's side of a read: `200` with the tag, or `304` when the caller holds it. */
const tagged = (data: unknown, tag: string) => (etag: string | null | undefined): Step => (etag === tag ? same : ok(data, tag));

function setHidden(h: boolean) {
  hidden = h;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  hidden = false;
  seen = [];
  answers = {};
  store = new ReadStore({
    hidden: () => hidden,
    get: async (path, etag) => {
      seen.push({ path, etag, at: Date.now() });
      const step = answers[path]?.(etag) ?? new ApiError(404, 'not-found', 'no such route');
      if (step instanceof ApiError) throw step;
      return step;
    },
  });
});

afterEach(() => {
  store.dispose();
  vi.useRealTimers();
});

const flush = () => vi.advanceTimersByTimeAsync(0);
const paths = () => seen.map((s) => s.path);

describe('the polling layer (B-221)', () => {
  it('fetches at once, then every 10 s with If-None-Match, and backs off to 60 s while unchanged', async () => {
    answers['/a'] = tagged({ n: 1 }, '"v1"');
    store.subscribe('/a', () => {});
    await flush();
    expect(seen).toEqual([{ path: '/a', etag: null, at: Date.now() }]);
    expect(store.snapshot('/a')).toMatchObject({ data: { n: 1 }, error: null, loading: false, okAt: Date.now() });

    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen[1]).toEqual({ path: '/a', etag: '"v1"', at: t0 + 10_000 }); // the validator rides along
    // 304 after 304: 20 s, 40 s, 60 s, 60 s.
    await vi.advanceTimersByTimeAsync(20_000 + 40_000 + 60_000 + 60_000);
    expect(seen.slice(1).map((s) => s.at - t0)).toEqual([10_000, 30_000, 70_000, 130_000, 190_000]);
    expect(store.freshness().interval).toBe(POLL_MAX_MS);
    expect(store.snapshot('/a').data).toEqual({ n: 1 });
    expect(store.freshness().okAt).toBe(t0 + 190_000); // a 304 is fresh

    // A changed answer brings the interval back to 10 s.
    answers['/a'] = tagged({ n: 2 }, '"v2"');
    await vi.advanceTimersByTimeAsync(POLL_MAX_MS);
    expect(store.snapshot('/a').data).toEqual({ n: 2 });
    expect(store.freshness().interval).toBe(POLL_MS);
    const before = seen.length;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen.length).toBe(before + 1);
  });

  it('fetches a screen’s reads together', async () => {
    answers['/a'] = tagged(1, '"a"');
    answers['/b'] = tagged(2, '"b"');
    store.subscribe('/a', () => {});
    store.subscribe('/b', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen.slice(2).map((s) => [s.path, s.at])).toEqual([['/a', seen[2].at], ['/b', seen[2].at]]);
  });

  it('keeps the last good answer on an error and names the refusal in the freshness', async () => {
    answers['/a'] = tagged({ n: 1 }, '"v1"');
    store.subscribe('/a', () => {});
    await flush();
    const okAt = Date.now();
    answers['/a'] = () => new ApiError(503, 'unavailable', 'try again');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(store.snapshot('/a')).toMatchObject({ data: { n: 1 }, okAt });
    expect(store.snapshot('/a').error?.code).toBe('unavailable');
    expect(store.freshness()).toMatchObject({ okAt, stopped: false });
    expect(store.freshness().error?.code).toBe('unavailable');
    // It keeps polling, and recovers.
    answers['/a'] = tagged({ n: 1 }, '"v1"');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(store.snapshot('/a').error).toBeNull();
    expect(store.freshness().error).toBeNull();
  });

  it('pauses while the page is hidden and fetches at once on return, back at 10 s', async () => {
    answers['/a'] = tagged(1, '"a"');
    store.subscribe('/a', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(POLL_MS + 20_000); // two 304s: the interval is 40 s
    const before = seen.length;
    setHidden(true);
    expect(store.freshness().paused).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(seen.length).toBe(before); // nothing while hidden
    setHidden(false);
    await flush();
    expect(seen.length).toBe(before + 1); // at once
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen.length).toBe(before + 2); // and 10 s after
  });

  it('stops on unauthenticated and tells the shell once; refresh resumes it', async () => {
    const signedOut = vi.fn();
    store.onUnauthenticated = signedOut;
    answers['/a'] = () => new ApiError(401, 'unauthenticated', 'the dashboard session ended or is unknown');
    answers['/b'] = () => new ApiError(401, 'unauthenticated', 'the dashboard session ended or is unknown');
    store.subscribe('/a', () => {});
    store.subscribe('/b', () => {});
    await flush();
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(store.freshness().stopped).toBe(true);
    const before = seen.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(seen.length).toBe(before); // no poll while signed out
    answers['/a'] = tagged(1, '"a"');
    answers['/b'] = tagged(2, '"b"');
    await store.refresh();
    expect(store.freshness().stopped).toBe(false);
    expect([store.snapshot('/a').data, store.snapshot('/b').data]).toEqual([1, 2]);
  });

  it('re-reads GET /v1/actions no more often than every 60 s, and at once on refresh', async () => {
    answers['/v1/actions'] = () => ok({ actions: [] }, null as unknown as string);
    answers['/a'] = () => ok({ t: Date.now() }, null as unknown as string); // always changed: the poll stays at 10 s
    store.subscribe('/v1/actions', () => {}, 60_000);
    store.subscribe('/a', () => {});
    await flush();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(paths().filter((p) => p === '/v1/actions')).toHaveLength(1);
    expect(paths().filter((p) => p === '/a')).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(paths().filter((p) => p === '/v1/actions')).toHaveLength(2);
    await store.refresh();
    expect(paths().filter((p) => p === '/v1/actions')).toHaveLength(3);
  });

  it('polls every 5 s while a confirmation code is live (the one exception)', async () => {
    answers['/a'] = tagged(1, '"a"');
    store.subscribe('/a', () => {});
    await flush();
    store.fast(120_000);
    const before = seen.length;
    await vi.advanceTimersByTimeAsync(4 * FAST_MS);
    expect(seen.length).toBe(before + 4);
    store.fast(0);
    const after = seen.length;
    await vi.advanceTimersByTimeAsync(FAST_MS);
    expect(seen.length).toBe(after);
  });

  it('counts a changed answer, which the code dialog closes on', async () => {
    answers['/a'] = tagged(1, '"a"');
    store.subscribe('/a', () => {});
    await flush();
    const changes = store.changes;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(store.changes).toBe(changes); // a 304 is no change
    answers['/a'] = tagged(2, '"b"');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(store.changes).toBe(changes + 1);
  });

  it('forgets every answer on reset (logout)', async () => {
    answers['/a'] = tagged(1, '"a"');
    store.subscribe('/a', () => {});
    await flush();
    store.reset();
    expect(store.snapshot('/a')).toMatchObject({ data: undefined, loading: true });
    expect(store.freshness()).toMatchObject({ okAt: null, stopped: true });
  });
});
