// S-BTN-167 — a merge dispatches the sync, and the alarm backs the webhook path (B-89, BATON_SPEC
// §7.1 R-BTN-73). Three hours of a `*/15` schedule ran the sync workflow zero times, and 14 runs
// in 51 hours is no backstop: the App's deliveries reach Baton, so a merge of a repository's own
// sends its sync itself — at most once per R-BTN-73's 30 seconds, as every want does — and the
// alarm sends one when the path's last send there is 10 minutes stale. Must hold: a merge
// dispatches whatever the repository's mode (before its cutover too); a pull_request that is no
// merge dispatches nothing; the alarm sends exactly the stale repositories, once.
import { describe, it, expect } from 'vitest';
import { Webhooks } from '../../src/core/webhook';
import { armedAt, captureDispatches, withCore } from '../helpers';

/** A delivery of `repository`'s, its id fresh each call so the 24-hour memory drops none. */
const d = (over: Record<string, unknown> = {}) => ({ event: 'pull_request', id: `d-${Math.random()}`, repository: 'immediately-run/baton', merged: true, ...over }) as never;

/** A delivery as the core receives one: the front's `X-Baton-Webhook` header on its route. */
const header = (delivery: unknown) => new Request('https://baton.test/v1/github/webhook', { method: 'POST', headers: { 'X-Baton-Webhook': JSON.stringify(delivery) } });

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
});
