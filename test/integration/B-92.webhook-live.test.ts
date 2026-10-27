// B-92 — a live delivery is recorded where a person can check it, and its dispatch goes out
// whatever the repository's mode (BATON_SPEC §7.1 R-BTN-73, round 1: the sync posts the board
// snapshot before the cutover too, and a snapshot under 15 minutes old is what the cutover
// needs when its day comes — the filter this ticket first added held shadow repositories back
// while the alarm's own backstop sent them 30 seconds later, so the code, the spec and the
// runbook disagreed until it went). The delivery's row stays the trace a person checks.
import { describe, it, expect, beforeEach } from 'vitest';
import { captureDispatches, cutover, HOST, rows, setClock, webhookCall } from '../helpers';

/** What the delivery wrote: one row per repository, its window's start and its trailing time. */
const dispatchRow = () => rows<{ last_dispatch_at: number; trailing_at: number | null }>(
  `SELECT last_dispatch_at, trailing_at FROM webhook_dispatch WHERE repository_id = 'docs'`);

const push = { repository: { full_name: 'immediately-run/docs' }, pusher: { name: 'alice' }, head_commit: { author: { email: 'alice@example.com' } } };

let T0 = 0;
beforeEach(async () => {
  // Ahead of the real clock, as S-BTN-42 arms its windows (one set in the past fires at once).
  T0 = Math.ceil(Date.now() / 1000) * 1000 + 600_000;
  await setClock(T0);
});

describe(`a live delivery, either side of the cutover (B-92, ${HOST})`, () => {
  it('is recorded where a person can check it, and dispatches the sync — the snapshot is what the cutover will need', async () => {
    // docs is the harness's registered repository, not cut over: the sync still posts the
    // board snapshot (§7.1), and the delivery's row is the trace either side of the cutover.
    const sent = await captureDispatches();
    const res = await webhookCall('push', push, { id: 'live-1' });
    expect([res.status, await res.text()]).toEqual([204, '']);
    expect(sent).toEqual(['docs:sync']);
    const row = await dispatchRow();
    expect(row).toHaveLength(1);
    expect(row[0]).toEqual({ last_dispatch_at: expect.any(Number), trailing_at: null });
    // The same delivery id again changes nothing: one row, and its window is not moved. The
    // core clock moves the minute (T0-relative), never the real one beneath it.
    await setClock(T0 + 60_000);
    expect((await webhookCall('push', push, { id: 'live-1' })).status).toBe(204);
    expect(sent).toEqual(['docs:sync']);
    expect(await dispatchRow()).toEqual(row);
  });

  it('a second delivery inside the window is the trailing one, whichever side of the cutover', async () => {
    const sent = await captureDispatches();
    await cutover(T0, 'docs');
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
