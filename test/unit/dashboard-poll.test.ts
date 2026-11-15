// B-242 (the UI half; BATON_SPEC §11.4's polling) — the dashboard polls `GET /v1/ui/state` only
// while its page is visible, and backs off while the answers are unchanged: 10 s after a change,
// doubling to at most 60 s, back to 10 s on a change or when the page is shown again. Each poll
// of a production-sized state read thousands of rows (Cloudflare's free tier allows 5,000,000 a
// day; production passed it on 2026-11-14), so a forgotten tab cost the quota in about an hour.
// src/ui/app.js runs here in a Node `vm` context over a stand-in document, fetch and timer —
// the dashboard has no build step and no DOM under test (Node only: workerd refuses code
// generation from strings).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const SCRIPT = readFileSync(resolve(import.meta.dirname, '../../src/ui/app.js'), 'utf8');

/** An element that takes any call, property or child and is always itself. */
function anything(): unknown {
  const target = function () {};
  const p: unknown = new Proxy(target, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === Symbol.iterator ? function* () {} : p),
    set: () => true,
    apply: () => p,
    construct: () => p as object,
  });
  return p;
}

/** A ui/state answer the dashboard draws whole: every section present, empty. */
const STATE = (server_time: number, extra: Record<string, unknown> = {}) => ({
  server_time, repositories: [], ready: [], ready_by_tier: {}, held: [], workers: [], running: [],
  timeline: { from: server_time - 86_400_000, to: server_time, lanes: [] },
  limits: { owners: [], grants: [], probes: [], bars: [], settings: [] }, needs_you: Object.fromEntries(['questions', 'unconfirmed', 'unacknowledged_releases', 'fence_pending', 'stale_skills', 'regressed', 'policy', 'bars_mismatch',
    'held_items', 'course_changed', 'adoptions', 'courses_refused', 'unsigned_control', 'conditions', 'scope'].map((k) => [k, []])), blocked: [],
  discrepancies: { rows: [], by_kind: {} }, resources: {}, ...extra,
});

interface Page {
  fetches: number;
  /** The pending poll's delay, or null when none is pending. */
  pending(): number | null;
  /** Run the pending poll and let its answer land. */
  fire(): Promise<void>;
  show(visible: boolean): Promise<void>;
  answer: (n: number) => Record<string, unknown>;
  status: { textContent: string };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

async function open(visible = true): Promise<Page> {
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  const status = { textContent: '' };
  const listeners: Record<string, () => void> = {};
  const document = {
    visibilityState: visible ? 'visible' : 'hidden',
    getElementById: (id: string) => (id === 'status' ? status : anything()),
    createElement: () => anything(),
    addEventListener: (k: string, fn: () => void) => { listeners[k] = fn; },
  };
  const page: Page = {
    fetches: 0,
    pending: () => ([...timers.values()][0]?.ms ?? null),
    fire: async () => {
      const [[id, t]] = [...timers.entries()];
      timers.delete(id);
      t.fn();
      await settle();
    },
    show: async (v) => {
      document.visibilityState = v ? 'visible' : 'hidden';
      listeners.visibilitychange?.();
      await settle();
    },
    answer: (n) => STATE(n),
    status,
  };
  const context = {
    document, location: { pathname: '/', hash: '' }, history: { replaceState() {} }, console, AbortSignal, JSON, Math, Object, Array, Set, Map, Date, String, Number,
    fetch: async () => {
      page.fetches++;
      const body = page.answer(page.fetches);
      return { status: 200, ok: true, json: async () => body };
    },
    setTimeout: (fn: () => void, ms: number) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  };
  vm.runInNewContext(SCRIPT, context);
  await settle();
  return page;
}

let page: Page;

describe('B-242 the dashboard polls only while visible, backing off while unchanged', () => {
  beforeEach(async () => {
    page = await open();
  });

  it('draws the first answer at once and polls again in 10 s', () => {
    expect(page.fetches).toBe(1);
    expect(page.status.textContent).toMatch(/^Updated /);
    expect(page.pending()).toBe(10_000);
  });

  it('doubles the interval to 60 s while the answers are the same — server_time and the timeline window aside', async () => {
    const delays: (number | null)[] = [];
    for (let i = 0; i < 5; i++) {
      await page.fire();
      delays.push(page.pending());
    }
    expect(page.fetches).toBe(6);
    expect(delays).toEqual([20_000, 40_000, 60_000, 60_000, 60_000]);
  });

  it('goes back to 10 s when an answer changes — a clock-dependent field included', async () => {
    await page.fire();
    await page.fire();
    expect(page.pending()).toBe(40_000);
    page.answer = (n) => STATE(n, { running: [{ id: 1, ticket_id: 'docs:T-1', hostname: 'vm-a', worker_id: 1, alive: false, stalled: false, events: [], activities: [] }] });
    await page.fire();
    expect(page.status.textContent).toMatch(/^Updated /);
    expect(page.pending()).toBe(10_000);
    await page.fire();
    expect(page.pending()).toBe(20_000);
  });

  it('a hidden page has no poll pending and fetches nothing; shown again, it polls at once and at 10 s', async () => {
    await page.fire();
    await page.fire();
    expect(page.pending()).toBe(40_000);
    await page.show(false);
    expect(page.pending()).toBeNull();
    const before = page.fetches;
    await page.show(false);
    expect(page.fetches).toBe(before);
    await page.show(true);
    expect(page.fetches).toBe(before + 1);
    expect(page.pending()).toBe(20_000); // the answer did not change: one step from the fastest
  });

  it('a page opened hidden polls first when shown', async () => {
    const hidden = await open(false);
    expect(hidden.fetches).toBe(0);
    expect(hidden.pending()).toBeNull();
    await hidden.show(true);
    expect(hidden.fetches).toBe(1);
    expect(hidden.pending()).toBe(10_000);
  });
});
