// S-BTN-253 the list reads' cursor (B-205; BATON_SPEC §14's Requests, R-BTN-130): `?cursor=`
// in, `next_cursor` out, opaque and bound under the instance's cursor key to the caller, the
// action, the path and the other query parameters. Must hold: a cursor minted for one session,
// action and filter is `invalid-params` for another session, another action, another
// repository, or the same action with a different `?state=`; a tampered or malformed cursor is
// `invalid-params`; the same call takes it back and reads its position; the key is made once
// and moves no state version. No list read of this landing pages by it (the first are the
// tickets', conditions' and runners' lists), so the scenario drives the read kit itself, on
// both hosts' cores. The pure half is test/unit/cursor.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS } from '../../src/core/actions';
import { cursorKey, cursorOf, pageOf, queryOf, type ReadCall, type ReadCtx, type ReadPrincipal } from '../../src/core/reads/kit';
import { setClock, withCore } from '../helpers';
import type { BatonCore } from '../../src/core/baton';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const ORIGIN = 'https://baton.test';

const ctxOf = (c: BatonCore): ReadCtx => ({
  core: c, store: c.store, sql: (q, ...p) => c.store.exec(q, ...p).toArray() as never[], now: () => c.now(),
  config: (c as unknown as { ports: { config: ReadCtx['config'] } }).ports.config,
});
const alice: ReadPrincipal = { kind: 'session', role: 'administrator', id: 'SHA256:alice', repositories: null };
const bob: ReadPrincipal = { kind: 'session', role: 'administrator', id: 'SHA256:bob', repositories: null };
const key: ReadPrincipal = { kind: 'key', role: 'owner', cred: 'SHA256:alice' };
const callOf = (principal: ReadPrincipal, action: string, path: string): ReadCall => {
  const a = ACTIONS.find((x) => x.id === action)!;
  const url = new URL(ORIGIN + path);
  return { action: a, principal, caller: a.callers[0], repository: 'docs', params: {}, url, req: new Request(url) };
};
const code = (f: () => unknown): string => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? 'threw';
  }
};

beforeEach(async () => {
  await setClock(T0);
});

describe('S-BTN-253 the list reads’ cursor (B-205)', () => {
  it('a cursor is its caller’s, its action’s and its filter’s; a tampered one is invalid-params', async () => {
    const out = await withCore((c) => {
      const ctx = ctxOf(c);
      const first = callOf(alice, 'repo.conditions', '/v1/repositories/docs/conditions?state=open');
      const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const page = pageOf(ctx, first, rows, (last) => last.id, 2);
      const cursor = page.next_cursor!;
      const next = (principal: ReadPrincipal, action: string, path: string) =>
        code(() => cursorOf(ctx, callOf(principal, action, `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`)));
      const flipped = cursor.slice(0, -1) + (cursor.endsWith('0') ? '1' : '0');
      const [body, tag] = cursor.split('.');
      return {
        items: page.items, last: pageOf(ctx, first, rows.slice(0, 2), (l) => l.id, 2).next_cursor,
        opaque: /^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(cursor),
        position: cursorOf<number>(ctx, callOf(alice, 'repo.conditions', `/v1/repositories/docs/conditions?state=open&cursor=${encodeURIComponent(cursor)}`)),
        // The parameters' order never matters.
        reordered: cursorOf<number>(ctx, callOf(alice, 'repo.conditions', `/v1/repositories/docs/conditions?cursor=${encodeURIComponent(cursor)}&state=open`)),
        firstPage: cursorOf(ctx, first),
        otherSession: next(bob, 'repo.conditions', '/v1/repositories/docs/conditions?state=open'),
        otherPrincipal: next(key, 'repo.conditions', '/v1/repositories/docs/conditions?state=open'),
        otherAction: next(alice, 'repo.blocked', '/v1/repositories/docs/conditions?state=open'),
        otherRepository: next(alice, 'repo.conditions', '/v1/repositories/ops/conditions?state=open'),
        otherFilter: next(alice, 'repo.conditions', '/v1/repositories/docs/conditions?state=closed'),
        noFilter: next(alice, 'repo.conditions', '/v1/repositories/docs/conditions'),
        addedFilter: next(alice, 'repo.conditions', '/v1/repositories/docs/conditions?state=open&ticket=T-1'),
        tampered: code(() => cursorOf(ctx, callOf(alice, 'repo.conditions', `/v1/repositories/docs/conditions?state=open&cursor=${encodeURIComponent(flipped)}`))),
        moved: code(() => cursorOf(ctx, callOf(alice, 'repo.conditions', `/v1/repositories/docs/conditions?state=open&cursor=${encodeURIComponent(`${btoa('99')}.${tag}`)}`))),
        bodyOnly: code(() => cursorOf(ctx, callOf(alice, 'repo.conditions', `/v1/repositories/docs/conditions?state=open&cursor=${encodeURIComponent(body)}`))),
        junk: code(() => cursorOf(ctx, callOf(alice, 'repo.conditions', '/v1/repositories/docs/conditions?state=open&cursor=nope'))),
      };
    });
    expect(out.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(out.last).toBeUndefined(); // the last page carries no next_cursor
    expect(out.opaque).toBe(true);
    expect(out.position).toBe(2);
    expect(out.reordered).toBe(2);
    expect(out.firstPage).toBeNull();
    for (const k of ['otherSession', 'otherPrincipal', 'otherAction', 'otherRepository', 'otherFilter', 'noFilter', 'addedFilter', 'tampered', 'moved', 'bodyOnly', 'junk'] as const) {
      expect([k, out[k]]).toEqual([k, 'invalid-params']);
    }
  });

  it('the cursor key is made once, kept, and is no state a reader keys on', async () => {
    const out = await withCore((c) => {
      const ctx = ctxOf(c);
      const before = c.stateVersion();
      const a = cursorKey(ctx);
      const b = cursorKey(ctx);
      return { a, b, moved: c.stateVersion() - before, held: ctx.sql<{ value: string }>(`SELECT value FROM baton_settings WHERE key = 'cursor_key'`)[0]?.value };
    });
    expect(out.a).toMatch(/^[0-9a-f]{64}$/);
    expect(out.b).toBe(out.a);
    expect(out.held).toBe(out.a);
    expect(out.moved).toBe(0);
  });

  it('a read takes only the parameters its entry names', async () => {
    const out = await withCore(() => ({
      known: queryOf(callOf(alice, 'ticket.history', '/v1/repositories/docs/tickets/T-1/history?limit=5&cursor=x')),
      unknown: code(() => queryOf(callOf(alice, 'ticket.history', '/v1/repositories/docs/tickets/T-1/history?nope=1'))),
      twice: code(() => queryOf(callOf(alice, 'ticket.history', '/v1/repositories/docs/tickets/T-1/history?limit=5&limit=6'))),
    }));
    expect(out.known).toEqual({ limit: '5', cursor: 'x' });
    expect(out.unknown).toBe('invalid-params');
    expect(out.twice).toBe('invalid-params');
  });
});
