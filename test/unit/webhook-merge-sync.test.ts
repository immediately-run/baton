// S-BTN-167 — a merge dispatches the sync, and the alarm backs the webhook path (B-89, BATON_SPEC
// §7.1 R-BTN-73). Three hours of a `*/15` schedule ran the sync workflow zero times, and 14 runs
// in 51 hours is no backstop: the App's deliveries reach Baton, so a merge of a repository's own
// sends its sync itself — at most once per R-BTN-73's 30 seconds, as every want does — and the
// alarm sends one when the path's last send there is 10 minutes stale, armed for that instant so
// the send does not wait for a tick. Must hold: a merge dispatches whatever the repository's mode
// (before its cutover too); a pull_request that is no merge dispatches nothing; every repository
// the path dispatches is stamped; the alarm sends exactly the stale repositories, once, never the
// tick after a late one.
import { describe, it, expect } from 'vitest';
import { Webhooks, SYNC_STALE_MS } from '../../src/core/webhook';
import { armedAt, captureDispatches, withCore } from '../helpers';

/** A delivery of `repository`'s, its id fresh each call so the 24-hour memory drops none. */
const d = (over: Record<string, unknown> = {}) => ({ event: 'pull_request', id: `d-${Math.random()}`, repository: 'immediately-run/baton', merged: true, ...over }) as never;

/** A delivery as the core receives one: the front's `X-Baton-Webhook` header on its route. */
const header = (delivery: unknown) => new Request('https://baton.test/v1/github/webhook', { method: 'POST', headers: { 'X-Baton-Webhook': JSON.stringify(delivery) } });

/** Every `webhook_syncs` row as `id@stamp`, sorted — the path's own clock, what the alarm reads. */
const stamps = (c: { store: { exec(q: string): { toArray(): unknown[] } } }) =>
  (c.store.exec(`SELECT repository_id, last_dispatch_at FROM webhook_syncs ORDER BY repository_id`).toArray() as { repository_id: string; last_dispatch_at: number }[])
    .map((r) => `${r.repository_id}@${r.last_dispatch_at}`);

describe('S-BTN-167 a merge dispatches the sync', () => {
  it('a merge of the repository’s own dispatches its sync, whatever its mode; one that is no merge dispatches nothing', async () => {
    await withCore(async (c) => {
      const w = new Webhooks({ store: c.store, now: () => 0 });
      expect(w.receive(d())).toEqual({ outcome: 'dispatched', now: ['baton'], trailing: [] });
      expect(w.receive(d({ merged: false }))).toEqual({ outcome: 'not-a-merge' });
      // A delivery with no `merged` at all is no merge either.
      expect(w.receive(d({ merged: undefined }))).toEqual({ outcome: 'not-a-merge' });
      // Another repository's merge is that repository's want.
      expect(w.receive(d({ repository: 'immediately-run/docs' }))).toEqual({ outcome: 'dispatched', now: ['docs'], trailing: [] });
      // An unregistered repository dispatches nothing.
      expect(w.receive(d({ repository: 'immediately-run/other' }))).toEqual({ outcome: 'dispatched', now: [], trailing: [] });
      // The other and the unregistered one left no row: the path sent them no sync.
      expect(stamps(c).map((s) => s.replace(/@.*/, ''))).toEqual(['baton', 'docs']);
    });
  });

  it('the merge’s dispatch is the core’s own: a merge sends the sync, one that did not merge sends none', async () => {
    await withCore(async (c) => {
      const sent = await captureDispatches();
      const deliver = (x: unknown) => (c as unknown as { delivery(r: Request): Promise<unknown> }).delivery(x as Request);
      await deliver(header(d({ id: 'm-1' })));
      expect(sent).toEqual(['baton:sync']);
      // A pull request closed without merging moves nothing.
      await deliver(header(d({ id: 'm-2', merged: false })));
      expect(sent).toEqual(['baton:sync']);
      // The row is the path's own clock, what the alarm reads.
      expect(c.store.exec(`SELECT repository_id FROM webhook_syncs`).toArray()).toEqual([{ repository_id: 'baton' }]);
    });
  });

  it('every repository the path dispatches is stamped by the delivery that sent it (round 4, blocking 2)', async () => {
    const B = 1_800_000_000_000;
    await withCore(async (c) => {
      // A fresh instance registers baton and docs; docs' own stamp is 20 minutes old.
      c.store.exec(`INSERT INTO webhook_syncs (repository_id, last_dispatch_at) VALUES ('docs', ?)`, B - 20 * 60_000);
      c.now = () => B;
      // A push to this repository dispatches this repository's sync — the delivery is not a
      // merge, and before B-89 it left `webhook_syncs` empty, so nothing backed it up.
      const w = new Webhooks({ store: c.store, now: () => B });
      expect(w.receive(d({ event: 'push', repository: 'immediately-run/baton', merged: undefined, pusher: 'p', author_email: 'p@x' })))
        .toEqual({ outcome: 'dispatched', now: ['baton'], trailing: [] });
      expect(stamps(c)).toEqual([`baton@${B}`, `docs@${B - 20 * 60_000}`]);
      // A `docs` delivery dispatches `docs`' sync and stamps docs' own row.
      expect(w.receive(d({ event: 'issue_comment', repository: 'immediately-run/docs', merged: undefined })))
        .toEqual({ outcome: 'dispatched', now: ['docs'], trailing: [] });
      expect(stamps(c)).toEqual([`baton@${B}`, `docs@${B}`]);
      // Through the core's own route the same holds, and the stamp is the send's clock.
      const deliver = (x: unknown) => (c as unknown as { delivery(r: Request): Promise<unknown> }).delivery(x as Request);
      c.now = () => B + 60_000;
      const sent = await captureDispatches();
      await deliver(header(d({ id: 'push-2', event: 'push', repository: 'immediately-run/baton', merged: undefined, pusher: 'p', author_email: 'p@x' })));
      expect(sent).toEqual(['baton:sync']);
      expect(stamps(c)).toEqual([`baton@${B + 60_000}`, `docs@${B}`]);
      // Each row is the backstop's clock: neither is stale at ten minutes after its own stamp,
      // and docs' is one millisecond past at the alarm's armed instant. (Read as the row's own
      // stamp, which both hosts compare — round 4's host note at the top of this file.)
      const docs = (c.store.exec(`SELECT last_dispatch_at AS at FROM webhook_syncs WHERE repository_id = 'docs'`).toArray() as { at: number }[])[0].at;
      expect(new Webhooks({ store: c.store, now: () => docs + SYNC_STALE_MS }).dueSync()).toEqual([]);
      expect(new Webhooks({ store: c.store, now: () => docs + SYNC_STALE_MS + 1 }).dueSync()).toEqual(['docs']);
    });
  });

  it('a second merge inside R-BTN-73’s 30 seconds is the window’s trailing dispatch', async () => {
    await withCore(async (c) => {
      const at = (now: number) => new Webhooks({ store: c.store, now: () => now });
      expect(at(0).receive(d())).toEqual({ outcome: 'dispatched', now: ['baton'], trailing: [] });
      expect(at(10_000).receive(d())).toEqual({ outcome: 'dispatched', now: [], trailing: ['baton'] });
      expect(at(30_000).dueTrailing()).toEqual(['baton']);
      // The trailing dispatch just opened a window: the path's backstop is not due.
      expect(at(9 * 60_000).dueSync()).toEqual([]);
    });
  });

  it('the alarm sends a sync for a repository whose last webhook dispatch is over 10 minutes old, once', async () => {
    const B = Math.ceil(Date.now() / 1000) * 1000 + 600_000;
    await withCore(async (c) => {
      // A fresh instance registers baton and docs; ops and gone join them by a registration of
      // the run's own, and gone is retired before the alarm.
      for (const [id, github] of [['ops', 'immediately-run/ops'], ['gone', 'immediately-run/gone']] as const) {
        c.registry.register({ id, github, default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml' });
      }
      c.store.exec(`INSERT INTO webhook_syncs (repository_id, last_dispatch_at) VALUES ('docs', ?), ('ops', ?), ('gone', ?), ('baton', ?)`,
        B - 11 * 60_000, B - 9 * 60_000, B - 11 * 60_000, B - 11 * 60_000);
      c.store.exec(`UPDATE repositories SET retired_at = 1 WHERE id = 'gone'`);
      c.now = () => B;
      const sent = await captureDispatches();
      await c.alarm();
      // The alarm's own syncs, beside R-BTN-73's trailing ones: exactly the stale and not retired.
      expect(sent.sort()).toEqual(['baton:sync', 'docs:sync']);
      // Sent once: the next tick finds both fresh, and the 9-minute-old one is inside ten.
      sent.length = 0;
      c.now = () => B + 30_000;
      await c.alarm();
      expect(sent).toEqual([]);
      // A minute later the 9-minute-old one is stale too, and the tick sends it — alone.
      c.now = () => B + 2 * 60_000;
      await c.alarm();
      expect(sent).toEqual(['ops:sync']);
      expect(await armedAt()).toBeGreaterThan(B);
    });
  });

  it('the boundary is closed: a stamp exactly 10 minutes old is not stale, and one millisecond older is (round 4, blocking 1)', async () => {
    const B = Math.ceil(Date.now() / 1000) * 1000 + 600_000;
    await withCore(async (c) => {
      c.store.exec(`INSERT INTO webhook_syncs (repository_id, last_dispatch_at) VALUES ('baton', ${B - SYNC_STALE_MS})`);
      const at = (now: number) => new Webhooks({ store: c.store, now: () => now });
      // A row exactly ten minutes old does not send: `now - SYNC_STALE_MS` is its own stamp.
      expect(at(B - 1).dueSync()).toEqual([]);
      expect(at(B).dueSync()).toEqual([]);
      // One millisecond past: the first `now` the strict comparison holds, and the instant the
      // alarm is armed for.
      expect(at(B + 1).nextDue()).toBe(B + 1);
      expect(at(B + 1).dueSync()).toEqual(['baton']);
      // Stamped `now - 1`, a millisecond past the boundary: the same tick's and the next tick's
      // comparison do not send again.
      expect(at(B + 1).dueSync()).toEqual([]);
      expect(at(B + 60_001).dueSync()).toEqual([]);
    });
    await withCore(async (c) => {
      // A fresh instance: its own baton row, ten minutes old at B.
      c.store.exec(`UPDATE webhook_syncs SET last_dispatch_at = ${B - SYNC_STALE_MS} WHERE repository_id = 'baton'`);
      const sent = await captureDispatches();
      // Armed for the stale instant, not for a minute later: the tick at ten minutes exactly
      // sends nothing, and the alarm waits one millisecond — the first `now` the `<` holds.
      // (The alarm re-arms itself for a minute first, as §3's tick does.)
      c.now = () => B;
      await c.alarm();
      expect(sent).toEqual([]);
      expect(await armedAt()).toBe(B + 1);
      // The alarm at that instant sends it, and its stamp is one millisecond old at the next
      // tick — a late tick does not make every following tick a send. The tick's own minute is
      // the re-arm while `now + ALARM_EVERY_MS` is yet before the stale instant.
      c.now = () => B + 1;
      await c.alarm();
      expect(sent).toEqual(['baton:sync']);
      expect(await armedAt()).toBe(B + 60_001);
      sent.length = 0;
      c.now = () => B + 60_001;
      await c.alarm();
      expect(sent).toEqual([]);
      expect(await armedAt()).toBe(B + 120_001);
      sent.length = 0;
      c.now = () => B + 120_001;
      await c.alarm();
      expect(sent).toEqual([]);
      // The row is stale at 10 minutes + 1 ms, where the second alarm sent it; its own `now + 60 s`
      // re-arm then stands until this tick, one minute short of ten from the send's stamp.
      expect(await armedAt()).toBe(B + 180_001);
      // At ten from the send's stamp minus a minute, the re-arm still stands; the tick at ten
      // exactly stands a minute too — the row was stamped at ten + 1 ms — and the next tick, past
      // it, is armed for the exact instant.
      c.now = () => B + 540_001;
      await c.alarm();
      expect(sent).toEqual([]);
      expect(await armedAt()).toBe(B + 540_001 + 60_000);
      c.now = () => B + 600_001;
      await c.alarm();
      expect(sent).toEqual([]);
      expect(await armedAt()).toBe(B + 600_002);
    });
  });

  it('a late tick that writes a stamp does not re-send it on the next (round 4, blocking 1)', async () => {
    const B = Math.ceil(Date.now() / 1000) * 1000 + 600_000;
    await withCore(async (c) => {
      const sent = await captureDispatches();
      const alarmAt = async (now: number) => {
        c.now = () => now;
        await c.alarm();
        const out = [...sent];
        sent.length = 0;
        return out;
      };
      c.store.exec(`INSERT INTO webhook_syncs (repository_id, last_dispatch_at) VALUES ('baton', ${B - 5 * 60_000})`);
      // The first tick lands after the stamp's own minute re-arm, five and a half minutes on:
      // the row is not yet stale, and the alarm is armed for the instant it is.
      await alarmAt(B + 30_000);
      // A tick appointed past that instant — a slow, mostly stochastic alarm — sends once; the
      // stamp it writes is a few seconds old at the next tick, which `<=` made a second send.
      expect(await alarmAt(B + 331_000)).toEqual(['baton:sync']);
      expect(await alarmAt(B + 391_000)).toEqual([]);
      expect(await alarmAt(B + 451_000)).toEqual([]);
    });
  });
});
