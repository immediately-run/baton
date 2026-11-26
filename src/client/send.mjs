import { requestCredential, signHeaders } from './sign.mjs';
import { clientVersion } from './version.mjs';
import { compareVersions, parseClientVersions } from '../shared/versions.mjs';

/** A redirect, named for what it is (B-80): an intermediary in front of Baton — Cloudflare
 *  Access's login — answered, so the request never reached Baton. */
const redirectAnswered = (target, status, to) => new Error(
  `a redirect answered ${target}${status ? ` (HTTP ${status}${to ? ` to ${to}` : ''})` : ''} — not followed; the request never reached Baton (an Access login in front of it?)`,
);

/** Send a planned request, signed with `keyFile` — or, when it holds an API key (R-BTN-159),
 *  with that key as a bearer. Returns `{status, json, text}`: `json` is null when the body is
 *  not JSON, `text` the body as it arrived, for the caller to show. A redirect is refused,
 *  never followed (B-80): a 3xx is an error naming what answered — a login page in front of
 *  Baton is not Baton's answer. R-BTN-197 (B-254): every request says which client it is
 *  (`Baton-Client`, `clientVersion`'s one place), and the first answer that names a
 *  `recommended` above it draws the warning — once per command, on stderr, so a script's
 *  stdout stays its own. `client` names the version for a test (a CLI this code never shipped
 *  as); a command's own requests are always `clientVersion()`'s. */
let saidClientVersions = false;
/** @typedef {(url: string, init: RequestInit) => Promise<Response>} BatonFetch */
/** @param {string} url
 * @param {{path: string, method: string, body?: unknown, headers?: Record<string, string>}} p
 * @param {string} keyFile
 * @param {BatonFetch} [fetchImpl]
 * @returns {Promise<{status: number, json: unknown, text: string}>}
 */
export async function send(url, p, keyFile, fetchImpl = fetch, client = clientVersion()) {
  const token = p.headers?.Authorization;
  const target = new URL(p.path, url).toString();
  // A GET carries no body; its digest is of the empty one.
  const body = p.method === 'GET' ? undefined : JSON.stringify(p.body ?? {});
  const cred = token ? null : requestCredential(keyFile);
  const auth = cred == null ? {} : cred.bearer !== undefined ? { Authorization: `Bearer ${cred.bearer}` } : signHeaders({ method: p.method, url: target, body, key: cred.key });
  const headers = { 'Baton-Client': client, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...auth, ...p.headers };
  // A Baton that does not answer in 30 seconds is reported, never waited on for ever (round 3, 3-A-5).
  let res;
  try {
    // A 3xx is never followed (B-80): `redirect: 'error'` makes fetch refuse it outright.
    res = await fetchImpl(target, { method: p.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    // `redirect: 'error'` surfaces that refusal as a fetch failure whose cause names it: report
    // what happened, not the generic failure (B-80).
    if (/redirect/i.test(`${e?.message ?? ''} ${e?.cause?.message ?? ''}`)) throw redirectAnswered(target);
    throw e;
  }
  // A fetch stand-in may hand the 3xx back instead of throwing: the same refusal (B-80).
  if (res.status >= 300 && res.status < 400) throw redirectAnswered(target, res.status, res.headers.get('location'));
  warnClientVersions(res.headers.get('Baton-Client-Versions'), client);
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    json = null;
  }
  return { status: res.status, json, text: raw };
}

/** R-BTN-197: `baton: this CLI is <version>; Baton recommends <recommended> and refuses below
 *  <min>`, said at most once per command (one command is one process), only when the
 *  recommendation is above this CLI's version — compared by semver precedence, `+dev` taking no
 *  part. An answer that recommends nothing above it says nothing and spends nothing: a later
 *  answer of the same command that does (an administrator raised it mid-run) still gets its
 *  line. Nothing installs or switches anything: the header carries version numbers only, and
 *  updating stays the operator's act. */
function warnClientVersions(headerValue, client) {
  if (saidClientVersions || headerValue == null) return;
  const served = parseClientVersions(headerValue);
  if (!served) return;
  if (compareVersions(client.replace(/^baton\//, ''), served.recommended) >= 0) return;
  saidClientVersions = true;
  process.stderr.write(`baton: this CLI is ${client}; Baton recommends ${served.recommended} and refuses below ${served.min}\n`);
}
