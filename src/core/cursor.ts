// cursor.ts — the opaque cursor of the new list reads (B-205; BATON_SPEC §14's Requests,
// R-BTN-130): `?cursor=` in, `next_cursor` out, absent on the last page. A cursor carries the
// position its read resumes from, and a tag binding it — under the instance's `CursorKey`
// (R-BTN-55) — to the caller (its credential or session), the action id and every other query
// parameter of the request. A cursor from another caller, another action or another filter, a
// tampered one and a malformed one are all `invalid-params`, so a cursor never widens a read
// beyond what its first page authorized. Pure: no store, no clock.
import { BatonError } from './http';
import { sha256HexSync } from './policy';

/** What a cursor is bound to. `query` is the request's other parameters (`cursor` itself is
 *  left out by `bindingOf`); their order never matters. */
export type CursorBinding = { caller: string; action: string; query: Record<string, string> };

/** The instance's `CursorKey` as this module takes it: 64 lowercase hex characters. */
export const CURSOR_KEY = /^[0-9a-f]{64}$/;

/** 100 items a page unless a read's row says otherwise (§14). */
export const PAGE_DEFAULT = 100;

const bound = (b: CursorBinding): string =>
  JSON.stringify([b.caller, b.action, Object.keys(b.query).filter((k) => k !== 'cursor').sort().map((k) => [k, b.query[k]])]);

/** HMAC's construction over SHA-256 (RFC 2104's two keyed passes), computed with the core's
 *  synchronous SHA-256 so no await opens inside a read: the key is 64 hex characters — one
 *  block — so both pads are ASCII, and the inner digest goes into the outer pass as its hex. */
function mac(key: string, text: string): string {
  if (!CURSOR_KEY.test(key)) throw new BatonError('internal', 'the cursor key is not 64 hex characters');
  let ipad = '';
  let opad = '';
  for (let i = 0; i < key.length; i++) {
    ipad += String.fromCharCode(key.charCodeAt(i) ^ 0x36);
    opad += String.fromCharCode(key.charCodeAt(i) ^ 0x5c);
  }
  return sha256HexSync(opad + sha256HexSync(ipad + text));
}

const b64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** A cursor for `position` (any JSON value: the last row's id, a `[rank, id]` pair), bound to
 *  `binding` under `key`. Opaque to its reader: `<position>.<tag>`, both URL-safe. */
export function mintCursor(key: string, binding: CursorBinding, position: unknown): string {
  const body = b64(JSON.stringify(position));
  return `${body}.${mac(key, `${bound(binding)}\n${body}`)}`;
}

/** The position `cursor` carries, when it was minted under `key` for exactly `binding`;
 *  `invalid-params` otherwise — forged, foreign, re-filtered or malformed alike. */
export function checkCursor<T = unknown>(key: string, binding: CursorBinding, cursor: string): T {
  const refuse = (): never => { throw new BatonError('invalid-params', 'cursor: must be the next_cursor a page of this same read gave this caller'); };
  if (cursor.length > 1024) refuse();
  const dot = cursor.lastIndexOf('.');
  if (dot <= 0) refuse();
  const body = cursor.slice(0, dot);
  if (!equal(cursor.slice(dot + 1), mac(key, `${bound(binding)}\n${body}`))) refuse();
  const text = unb64(body);
  if (text == null) refuse();
  try {
    return JSON.parse(text as string) as T;
  } catch {
    return refuse();
  }
}

/** One page of a list read, in §14's response convention — `{<items>: [...], next_cursor?,
 *  counts?}`: hand it up to `limit + 1` rows; it keeps `limit` and, when a further row came,
 *  mints `next_cursor` from the last kept one. */
export function page<T>(rows: T[], limit: number, mintNext: (last: T) => string): { items: T[]; next_cursor?: string } {
  if (rows.length <= limit) return { items: rows };
  const items = rows.slice(0, limit);
  return { items, next_cursor: mintNext(items[items.length - 1]) };
}
