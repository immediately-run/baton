import { env } from 'cloudflare:test';
import { expect, it, vi } from 'vitest';
import { rows, setClock, tick, withCore } from '../helpers';
import type { Ports } from '../../src/core/ports';

it('S-BTN-244 archives through the real R2 binding, appends to the daily key, and keeps the batch on a rejected write', async () => {
  const t0 = Date.parse('2026-08-01T12:00:00Z');
  const day = 86_400_000;
  const firstKey = 'events/docs/2026-08-01.ndjson';
  const secondKey = 'events/docs/2026-08-02.ndjson';
  await withCore(async (core) => {
    const ports = (core as unknown as { ports: Ports }).ports;
    await ports.scheduler.set(Date.now() + 3_600_000);
    ports.scheduler = { get: async () => Date.now() + 3_600_000, set: async () => {} };
  });
  await setClock(t0 + 92 * day);
  const add = async (at: number) => (await rows<{ seq: number }>(`INSERT INTO events
    (at, kind, actor, detail_json, repository_id) VALUES (?, 'admin', 'test', '{}', 'docs') RETURNING seq`, at))[0];
  const present = () => rows<{ seq: number }>(`SELECT seq FROM events WHERE actor = 'test' AND at < ? ORDER BY seq`, t0 + 2 * day);
  const ack = () => rows(`UPDATE repositories SET mirror_acked_seq = (SELECT MAX(seq) FROM events)`);
  const first = await add(t0);
  await add(t0 + 92 * day);
  await ack();
  await tick();
  expect(await present()).toEqual([]);
  const bucket = env.BATON_EVENT_ARCHIVE!;
  const initial = await bucket.get(firstKey);
  expect(initial?.httpMetadata?.contentType).toBe('application/x-ndjson');
  const firstPage = (await initial!.text()).split('\n')[0];
  expect(JSON.parse(firstPage)).toMatchObject({ repository: 'docs', next: first.seq, events: [first] });

  const sameDay = await add(t0);
  const nextDay = await add(t0 + day);
  await add(t0 + 92 * day);
  await ack();
  await bucket.put(secondKey, '');
  await withCore(async (core) => {
    // Delegate both writes to real R2, but give the second write a stale generation so R2
    // returns null. The first write must already have committed when the batch fails.
    const binding = (core as unknown as { ports: Ports }).ports.config as Env;
    const r2 = binding.BATON_EVENT_ARCHIVE!;
    const original = r2.put.bind(r2);
    const put = vi.spyOn(r2, 'put').mockImplementation((key, value, opts) => original(key, value,
      key === secondKey ? { ...opts, onlyIf: { etagMatches: 'stale' } } : opts));
    try {
      await expect(core.alarm()).rejects.toThrow(`R2 did not acknowledge ${secondKey}`);
      expect(put.mock.calls.map(([key]) => key)).toEqual([firstKey, secondKey]);
    } finally {
      put.mockRestore();
    }
  });
  const pages = async (key: string) => (await (await bucket.get(key))!.text()).trimEnd().split('\n');
  const afterFailure = await pages(firstKey);
  expect(afterFailure).toHaveLength(2);
  expect(afterFailure[0]).toBe(firstPage);
  expect(JSON.parse(afterFailure[1]).events).toMatchObject([sameDay]);
  expect(await (await bucket.get(secondKey))!.text()).toBe('');
  expect(await present()).toEqual([sameDay, nextDay]);

  await tick();
  expect(await present()).toEqual([]);
  expect((await pages(firstKey)).slice(0, 2)).toEqual(afterFailure);
  expect(JSON.parse((await pages(secondKey))[0]).events).toMatchObject([nextDay]);
  expect((await bucket.list({ prefix: 'events/docs/' })).objects.map(({ key }) => key)).toEqual([firstKey, secondKey]);
});
