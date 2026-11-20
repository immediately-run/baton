// api.ts — the client's only HTTP (B-206, B-221): same-origin calls carrying the session cookie
// and nothing else. The shell holds no key and reads no secret (R-BTN-155). A state-changing
// call is JSON from this origin, exactly what R-BTN-16's check asks (`checkStateChanging`:
// `Content-Type: application/json` and the page's own `Origin`, which the browser sets).

/** A refusal as §14 answers it: the HTTP status, Baton's error code and its message — text. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** A `GET`'s outcome: a new answer with its ETag, or `304` — the answer the caller holds stands. */
export type GetResult = { changed: true; data: unknown; etag: string | null } | { changed: false };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const CODE_BY_STATUS: Record<number, string> = { 400: 'invalid-params', 401: 'unauthenticated', 403: 'forbidden', 404: 'not-found', 409: 'conflict', 429: 'rate-limited', 503: 'unavailable' };

async function refusal(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const code = isObj(body) && typeof body.code === 'string' ? body.code : CODE_BY_STATUS[res.status] ?? `http-${res.status}`;
  const message = isObj(body) && typeof body.message === 'string' ? body.message : res.statusText || `HTTP ${res.status}`;
  return new ApiError(res.status, code, message);
}

/** Any failure as an `ApiError`: a refusal as itself, a network fault as `unreachable`. */
export function asApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(0, 'unreachable', e instanceof Error && e.message ? e.message : 'the request did not reach Baton');
}

/** `GET path`, with `If-None-Match` when the caller holds an answer (B-205). */
export async function apiGet(path: string, etag?: string | null): Promise<GetResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch(path, { method: 'GET', headers, credentials: 'same-origin', cache: 'no-store' });
  if (res.status === 304) return { changed: false };
  if (!res.ok) throw await refusal(res);
  return { changed: true, data: await res.json(), etag: res.headers.get('ETag') };
}

/** A state-changing call's outcome: done (`200`), or waiting on the minting key's confirmation
 *  (`202 {confirm_code}`, R-BTN-155). */
export type SendResult = { status: 'done'; data: unknown } | { status: 'confirm'; code: string; data: unknown };

/** `method path` with a JSON body, same-origin (R-BTN-16). */
export async function apiSend(method: string, path: string, body: unknown = {}): Promise<SendResult> {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  if (!res.ok) throw await refusal(res);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 202 && isObj(data) && typeof data.confirm_code === 'string') return { status: 'confirm', code: data.confirm_code, data };
  return { status: 'done', data };
}
