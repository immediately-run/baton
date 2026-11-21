// api.ts — the runner's client of Baton's runner API (BATON_SPEC §11, §6.3 R-BTN-13 as amended):
// every call signed with the machine's SSH key (ssh-keygen -Y sign, the one verifier shape), or
// with its API key as a bearer (R-BTN-159), or — through R3-1239's transition — a bearer token, and after the first heartbeat the runner
// secret. A call Baton refuses comes back as a `BatonRefusal` (never thrown past the loop); a
// call that cannot reach Baton throws. R-BTN-197 (B-254): every call says which client it is
// (`Baton-Client`), and the served versions each answer names are warned on — once at start and
// again whenever they change.
import { readFileSync } from 'node:fs';
import { API_KEY, signHeaders, signingKey } from '../../cli/sign.mjs';
import { clientVersion } from '../../cli/version.mjs';
import { compareVersions, parseClientVersions } from '../shared/versions.mjs';

/** §6.3: every heartbeat request — and every call a fence depends on — has a 30-second timeout. */
export const CALL_TIMEOUT_MS = 30_000;

/** A refusal Baton answered: its `code`, `rule_code` when the §11 body carries one, and message.
 *  R-BTN-197: a `client-too-old` refusal carries the versions it names — this client's, the
 *  served `min` and `recommended` — for the runner to log before it exits. */
export class BatonRefusal extends Error {
  constructor(readonly code: string, readonly ruleCode: string | undefined, message: string, readonly status: number,
    readonly versions: { client: string; min: string; recommended: string } | undefined = undefined) {
    super(message);
  }
}

/** R-BTN-202 (B-248): a call that never reached Baton — the transport failed or timed out. A
 *  5xx answer is a `BatonRefusal` with its status; together they are what "unreachable" means. */
export class BatonUnreachable extends Error {}

/** R-BTN-202: Baton could not answer — the call did not reach it, or it answered 5xx. */
export const batonUnreachable = (e: unknown): boolean =>
  e instanceof BatonUnreachable || (e instanceof BatonRefusal && (e.status >= 500 || e.code === 'unavailable'));

export type Transport = (req: Request) => Promise<Response>;

/** The headers that authenticate one request: the SSHSIG signature, or the transition's bearer
 * token, and the runner secret once the first heartbeat returned it. */
export type Auth = (method: string, url: string, body: string, secret: string | null) => Record<string, string>;

export interface ApiOptions {
  url: string;
  transport: Transport;
  auth: Auth;
  /** R-BTN-197 (B-254): the `Baton-Client` value every call carries — `clientVersion()`'s by
   *  default (`baton/<version>`, `+dev` from a working tree). A test names another version to
   *  play a runner this code never shipped as. */
  client?: string;
  /** R-BTN-197: what this client is called in its own warning line — a runner, or the sync that
   *  shares this API (the rule lists each as its own kind of client). Defaults to `runner`. */
  kind?: string;
}

// The SSHSIG signing itself is cli/sign.mjs's (the one `baton admin` uses — the same verifier
// shape docs' batonSign.mjs implements); imported, never copied.

/** The auth a production runner uses: the machine's key (`BATON_KEY_FILE`, or `BATON_KEY`,
 * a cloud environment's secret this run's caller materialises through `keyWriter`), else the
 * transition's `BATON_TOKEN`. A runner with none cannot talk to Baton (§6.4).
 *
 * B-97: the `IR_BATON_*` spellings of the transition are gone — the release dropped them. A
 * runner handed one reads no credential and stops at the error below, naming the names it
 * reads; the variables are simply unknown, never silently honoured. */
export function envAuth(env: NodeJS.ProcessEnv, keyWriter?: (material: string) => string, keepForMask?: (material: string) => void): Auth {
  const keyFile = env.BATON_KEY_FILE;
  const key = env.BATON_KEY;
  // R-BTN-159: an API key, in BATON_KEY or the key file, goes as a bearer in place of a
  // signature; the runner secret joins it as it joins a signature.
  const material = keyFile ? readFileSync(keyFile, 'utf8').trim() : key?.trim();
  for (const value of [key, material, env.BATON_TOKEN]) if (value) keepForMask?.(value);
  if (material && API_KEY.test(material)) {
    return (_method, _url, _body, secret) => ({ Authorization: `Bearer ${material}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) });
  }
  const signing = keyFile ?? (key && keyWriter ? keyWriter(key) : null);
  if (signing) {
    return (method, url, body, secret) => {
      const signed = signHeaders({ method, url, body: body ?? '', key: signingKey(signing) });
      return { ...signed, ...(secret ? { 'X-Runner-Secret': secret } : {}) };
    };
  }
  const token = env.BATON_TOKEN;
  if (token) {
    return (_method, _url, _body, secret) => ({ Authorization: `Bearer ${token}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) });
  }
  throw new Error('no credential: BATON_KEY_FILE, BATON_KEY or BATON_TOKEN (§6.4, R-BTN-13)');
}

/** The runner's calls; one instance per runner. `secret` joins every call once the first
 * heartbeat returned it (R-BTN-14: the hash registers, the secret authenticates). R-BTN-197
 * (B-254): every call carries the runner's `Baton-Client` (`client`, `clientVersion()`'s by
 * default), and each answer's `Baton-Client-Versions` is warned on — at start and when it
 * changes. */
export class BatonApi {
  private secret: string | null = null;
  private saidVersions: string | null = null;
  constructor(private readonly o: ApiOptions, private readonly log: (line: string) => void = () => {}) {}

  setSecret(s: string | null) {
    this.secret = s;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, any>> {
    const url = new URL(path, this.o.url).toString();
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers = new Headers(this.o.auth(method, url, text, this.secret));
    headers.set('Content-Type', 'application/json');
    headers.set('Baton-Client', this.o.client ?? clientVersion());
    let res: Response;
    try {
      res = await this.o.transport(new Request(url, { method, headers, body: text === '' && method === 'GET' ? undefined : text, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }));
    } catch (e) {
      this.log(`baton: ${method} ${path} did not reach Baton (${e instanceof Error ? e.message : String(e)})`);
      throw new BatonUnreachable(e instanceof Error ? e.message : String(e), { cause: e });
    }
    this.warnVersions(res.headers.get('Baton-Client-Versions'));
    let json: Record<string, any> | null = null;
    try {
      json = (await res.json()) as Record<string, any>;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const code = typeof json?.code === 'string' ? json.code : 'unavailable';
      // R-BTN-197: the one refusal a client below min gets names the versions it compares.
      const versions = [json?.client, json?.min, json?.recommended].every((v) => typeof v === 'string')
        ? { client: json!.client as string, min: json!.min as string, recommended: json!.recommended as string }
        : undefined;
      throw new BatonRefusal(code, typeof json?.rule_code === 'string' ? json.rule_code : undefined,
        typeof json?.message === 'string' ? json.message : `${method} ${path}: ${res.status}`, res.status, versions);
    }
    return json ?? {};
  }

  /** R-BTN-197: `baton: this <kind> is <version>; Baton recommends <recommended> and refuses
   *  below <min>` — at start (the first answer that names the versions) and again whenever the
   *  values change, only while this client's version is below the recommendation (semver
   *  precedence, `+dev` no part; the version printed as the header writes it, `baton/<version>`
   *  — one form in every line, the warning's and a refusal's alike). Nothing installs or
   *  switches anything: the header carries version numbers only, and the operator updates the
   *  client at their own pace. */
  private warnVersions(headerValue: string | null): void {
    if (headerValue == null || headerValue === this.saidVersions) return;
    this.saidVersions = headerValue;
    const served = parseClientVersions(headerValue);
    const own = this.o.client ?? clientVersion();
    if (served && compareVersions(own.replace(/^baton\//, ''), served.recommended) < 0) {
      this.log(`baton: this ${this.o.kind ?? 'runner'} is ${own}; Baton recommends ${served.recommended} and refuses below ${served.min}`);
    }
  }

  heartbeat(body: Record<string, unknown>): Promise<Record<string, any>> {
    return this.call('POST', '/v1/runner/heartbeat', body);
  }
  /** §11: the sorted legs this runner may take — what an idle runner asks for (R-BTN-45). */
  recommendations(limit = 10): Promise<Record<string, any>> {
    return this.call('GET', `/v1/runner/recommendations?limit=${limit}`);
  }
  /** §6.9: activity rows from the spool, upserted under their own call. */
  activities(activities: unknown[]): Promise<Record<string, any>> {
    return this.call('POST', '/v1/runner/activities', { activities });
  }
  /** §7.1: the sync's three calls — the observation first (R-BTN-62), then the head, then the
   * board post carrying it. */
  observation(): Promise<Record<string, any>> {
    return this.call('POST', '/v1/sync/observation', {});
  }
  /** R-BTN-62: give back a number this run will not post under. */
  releaseObservation(n: number): Promise<Record<string, any>> {
    return this.call('POST', '/v1/sync/observation', { release: n });
  }
  head(): Promise<Record<string, any>> {
    return this.call('GET', '/v1/sync/head');
  }
  /** B-113 (§4.3): the sync's dependencies read — the qualified `depends_on` entries of other
   *  repositories the posting repository's tickets name, resolved against their boards (their
   *  doneness is what a station function gates a leg on, R-BTN-120). */
  dependencies(ids: string[]): Promise<Record<string, any>> {
    return this.call('POST', '/v1/sync/dependencies', { ids });
  }
  board(body: Record<string, unknown>): Promise<Record<string, any>> {
    return this.call('POST', '/v1/sync/board', body);
  }
  claim(body: { request_id: string; ticket_id?: string }): Promise<Record<string, any>> {
    return this.call('POST', '/v1/runner/claim', body);
  }
  advance(claimId: number, body: { reached?: string; leg: string; bars?: string[]; evidence?: string; outputs?: unknown[]; taken?: { choice: string; alternative: string; dead: string[] }[]; run_inputs?: { ticket?: { version: string; read_digest: string }; inputs: unknown[] }; head_sha?: string | null; session_url?: string; local_order?: { by: string; ran_at: string } }): Promise<Record<string, any>> {
    return this.call('POST', `/v1/runner/claims/${claimId}/advance`, body);
  }
  end(claimId: number, body: Record<string, unknown>): Promise<Record<string, any>> {
    return this.call('POST', `/v1/runner/claims/${claimId}/end`, body);
  }
  /** §7.1 (R-BTN-160, R-BTN-195; B-234): the report for one raise — filter fields only, never
   *  the subject or body, which stay in the runner's log (R-BTN-33). */
  conditions(claimId: number, body: Record<string, unknown>): Promise<Record<string, any>> {
    return this.call('POST', `/v1/runner/claims/${claimId}/conditions`, body);
  }
  ack(messageId: number): Promise<Record<string, any>> {
    return this.call('POST', `/v1/runner/messages/${messageId}/ack`, {});
  }
}
