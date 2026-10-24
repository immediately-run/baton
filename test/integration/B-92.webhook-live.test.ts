// B-92 — a live delivery's dispatch respects the cutover (BATON_SPEC §10.3 R-BTN-73; §16). A
// delivery that passes the signature, its fields, the repeat drop and the self-filter and whose
// window is open dispatched the App whatever the repository's cutover, so one to a repository
// Baton serves before it holds its claims — B-92's own production probe, on a repository with no
// claims — sent a sync whose post could contain nothing, invisible in Baton. Every other trigger
// is held by the cutover; this one now is too, and its row is the trace a person checks.
import { describe, it, expect, beforeEach } from 'vitest';
import { captureDispatches, cutover, HOST, rows, setClock, webhookCall } from '../helpers';

/** What the delivery wrote: one row per repository, its window's start and its trailing time. */
const dispatchRow = () => rows<{ last_dispatch_at: number; trailing_at: number | null }>(
  `SELECT last_dispatch_at, trailing_at FROM webhook_dispatch WHERE repository_id = 'docs'`);

const push = { repository: { full_name: 'immediately-run/docs' }, pusher: { name: 'alice' }, head_commit: { author: { email: 'alice@example.com' } } };

beforeEach(async () => {
  // Ahead of the real clock, as S-BTN-42 arms its windows (one set in the past fires at once).
  await setClock(Math.ceil(Date.now() / 1000) * 1000 + 600_000);
});

describe(`a live delivery before the cutover (B-92, ${HOST})`, () => {
  it('is recorded where a person can check it, and dispatches nothing — the same as every trigger before the cutover', async () => {
    // docs is the harness's registered repository, not cut over: no claim exists, so a sync run
    // now would post nothing and the App dispatch would show no sign of the delivery.
    const sent = await captureDispatches();
    const res = await webhookCall('push', push, { id: 'live-1' });
    expect([res.status, await res.text()]).toEqual([204, '']);
    expect(sent).toEqual([]);
    const row = await dispatchRow();
    expect(row).toHaveLength(1);
    expect(row[0]).toEqual({ last_dispatch_at: expect.any(Number), trailing_at: null });
    // The same delivery id again changes nothing: one row, and its window is not moved.
    await setClock(Date.now() + 60_000);
    expect((await webhookCall('push', push, { id: 'live-1' })).status).toBe(204);
    expect(await dispatchRow()).toEqual(row);
  });

  it('after the cutover the same delivery dispatches docs’ sync; a second inside the window is the trailing one', async () => {
    const sent = await captureDispatches();
    await cutover(Date.now(), 'docs');
    expect((await webhookCall('push', push, { id: 'live-2' })).status).toBe(204);
    expect(sent).toEqual(['docs:sync']);
    const first = await dispatchRow();
    expect(first).toHaveLength(1);
    expect(first[0].trailing_at).toBeNull();
    // A second delivery inside the 30 seconds is suppressed into the window's one trailing time,
    // which the alarm sends when the window closes: one dispatch now, one trailing.
    expect((await webhookCall('push', push, { id: 'live-3' })).status).toBe(204);
    expect(sent).toEqual(['docs:sync']);
    const row = await dispatchRow();
    expect(row).toHaveLength(1);
    expect(row[0].last_dispatch_at).toBe(first[0].last_dispatch_at);
    expect(row[0].trailing_at).toBe(first[0].last_dispatch_at + 30_000);
  });
});
