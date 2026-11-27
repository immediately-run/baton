// cursor (B-205; BATON_SPEC §14's Requests, R-BTN-130): the pure half of the list reads'
// cursor — minted and checked under a key, bound to the caller, the action and the other query
// parameters. S-BTN-253 drives it through the read kit on both hosts.
import { describe, expect, it } from 'vitest';
import { checkCursor, mintCursor, page, PAGE_DEFAULT, type CursorBinding } from '../../src/core/cursor';
import { BatonError } from '../../src/core/http';

const KEY = 'a'.repeat(64);
const bind = (over: Partial<CursorBinding> = {}): CursorBinding => ({ caller: 'session:administrator:SHA256:x', action: 'ticket.list', query: { state: 'ready', limit: '50' }, ...over });
const refused = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof BatonError ? e.code : 'threw';
  }
};

describe('cursor', () => {
  it('round-trips a position of any JSON shape, opaque and URL-safe', () => {
    for (const position of [7, 'docs:T-1', [3, 'docs:T-9'], { rank: null, id: 'ü→' }, null]) {
      const cursor = mintCursor(KEY, bind(), position);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
      expect(checkCursor(KEY, bind(), cursor)).toEqual(position);
    }
    // Deterministic: the same page mints the same cursor (an ETag'd answer stays one answer).
    expect(mintCursor(KEY, bind(), 7)).toBe(mintCursor(KEY, bind(), 7));
  });

  it('is bound to the caller, the action and every other query parameter — in any order, the cursor itself aside', () => {
    const cursor = mintCursor(KEY, bind(), 7);
    expect(checkCursor(KEY, bind({ query: { limit: '50', state: 'ready', cursor } }), cursor)).toBe(7);
    expect(refused(() => checkCursor(KEY, bind({ caller: 'session:administrator:SHA256:y' }), cursor))).toBe('invalid-params');
    expect(refused(() => checkCursor(KEY, bind({ caller: 'key:owner:SHA256:x' }), cursor))).toBe('invalid-params');
    expect(refused(() => checkCursor(KEY, bind({ action: 'runner.list' }), cursor))).toBe('invalid-params');
    expect(refused(() => checkCursor(KEY, bind({ query: { state: 'blocked', limit: '50' } }), cursor))).toBe('invalid-params');
    expect(refused(() => checkCursor(KEY, bind({ query: { state: 'ready' } }), cursor))).toBe('invalid-params');
    expect(refused(() => checkCursor(KEY, bind({ query: { state: 'ready', limit: '50', q: 'other' } }), cursor))).toBe('invalid-params');
    expect(refused(() => checkCursor('b'.repeat(64), bind(), cursor))).toBe('invalid-params');
  });

  it('a tampered, truncated or malformed cursor is invalid-params', () => {
    const cursor = mintCursor(KEY, bind(), 7);
    const [body, tag] = cursor.split('.');
    const other = mintCursor(KEY, bind(), 8).split('.')[0];
    for (const bad of [`${other}.${tag}`, `${body}.${tag.slice(0, -1)}0`, `${body}.${tag.slice(1)}`, body, `.${tag}`, '', 'nope', `${body}.`, `${cursor}.x`, 'x'.repeat(2000)]) {
      if (bad === cursor) continue;
      expect([bad.slice(0, 20), refused(() => checkCursor(KEY, bind(), bad))]).toEqual([bad.slice(0, 20), 'invalid-params']);
    }
    // A key that is no key is the server's fault, never a cursor accepted.
    expect(refused(() => mintCursor('short', bind(), 7))).toBe('internal');
  });

  it('page: limit rows and a next_cursor only when a further row came', () => {
    const mint = (last: { id: number }) => `after-${last.id}`;
    expect(page([{ id: 1 }, { id: 2 }, { id: 3 }], 2, mint)).toEqual({ items: [{ id: 1 }, { id: 2 }], next_cursor: 'after-2' });
    expect(page([{ id: 1 }, { id: 2 }], 2, mint)).toEqual({ items: [{ id: 1 }, { id: 2 }] });
    expect(page([], 2, mint)).toEqual({ items: [] });
    expect(PAGE_DEFAULT).toBe(100);
  });
});
