// helpers.ts — tokens signed by the per-run test key (vitest.config.ts), requests to Baton, and
// the fake clock (R-BTN-32). Host-neutral (S-BTN-31): `#host` is the Cloudflare host (workerd)
// or the local one (Node), per vitest project.
import { importJWK, SignJWT } from 'jose';
import roadmapPr from './fixtures/courses/roadmap-pr/course.json';
import { ACTIVITY_KINDS } from '../src/core/validate';
import type { Store } from '../src/core/ports';
import { call as hostCall, config as env, raw as hostRaw, tick as hostTick, withCore } from '#host';
import { signedRequest, type SignOptions, type TestKey } from './lib/sshKeys';
import { deliverySignature } from '../src/core/webhook';

export { HOST, withCore } from '#host';

export const ORIGIN = env.BATON_ORIGIN;
const SYNC_CLAIMS = {
  repository: 'immediately-run/docs',
  ref: 'refs/heads/main',
  job_workflow_ref: 'immediately-run/docs/.github/workflows/baton-sync.yml@refs/heads/main',
};

async function sign(claims: Record<string, unknown>, { issuer, audience }: { issuer: string; audience: string }) {
  const key = await importJWK(JSON.parse(env.TEST_SIGNING_JWK!), 'ES256');
  return new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'baton-test' })
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(key);
}

/** A GitHub Actions OIDC token; `over` replaces any claim (another repo, ref, workflow…). */
export function syncToken(over: Record<string, unknown> = {}, opts: { issuer?: string; audience?: string } = {}) {
  return sign({ ...SYNC_CLAIMS, ...over }, { issuer: opts.issuer ?? env.OIDC_ISSUER, audience: opts.audience ?? env.BATON_ORIGIN });
}

/** A GitLab CI `id_tokens` JWT from `issuer` (R-BTN-93), its audience `<origin>#<role>` unless given. */
export function gitlabToken(over: Record<string, unknown> = {}, opts: { issuer?: string; audience?: string; role?: 'sync' | 'mirror' } = {}) {
  return sign({ project_path: 'group/lab', ref: 'main', ref_type: 'branch', ...over },
    { issuer: opts.issuer ?? 'https://gitlab.test', audience: opts.audience ?? `${env.BATON_ORIGIN}#${opts.role ?? 'sync'}` });
}

/** A Cloudflare Access token for `email`. */
export function accessToken(email = 'owner@example.com', opts: { audience?: string } = {}) {
  // The Access settings are optional on Config since R3-1208's provision set none; the test
  // bindings configure them (as TEST_SIGNING_JWK above), so the signer asserts them.
  return sign({ email }, { issuer: `https://${env.ACCESS_TEAM_DOMAIN!}`, audience: opts.audience ?? env.ACCESS_AUD! });
}

export function call(path: string, init: RequestInit = {}) {
  return hostCall(new Request(ORIGIN + path, init));
}

/** A request to Baton exactly as built — no harness header added. S-BTN-227 (R-BTN-197, B-254):
 *  a request from an old client, or from none, reaches Baton as it is. */
export function rawCall(req: Request) {
  return hostRaw(req);
}

export async function syncCall(path: string, body?: unknown, token?: string) {
  const auth = token ?? (await syncToken());
  const send = (p: string, b?: unknown) => call(p, {
    method: b === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  // R-BTN-62: a board post carries a number from POST /v1/sync/observation, taken first as the
  // sync does; a test that names its own (or none, as `null`) posts it as it is.
  if (path === '/v1/sync/board' && body && typeof body === 'object' && !('observation' in body)) {
    const o = await send('/v1/sync/observation', {});
    if (o.ok) body = { ...(body as object), observation: ((await o.json()) as { observation: number }).observation };
  }
  return send(path, body);
}

/** The ticket ids a runner is recommended, in order (R-BTN-45, R-BTN-61): what a claim without
 *  an id would take first. */
export function recommended(runnerId: number, limit = 100): Promise<string[]> {
  return withCore((o) => (o.claims as unknown as { recommendations: (id: number, limit: number) => { recommendations: { ticket_id: string }[] } })
    .recommendations(runnerId, limit).recommendations.map((r) => r.ticket_id));
}

/** A refresh (§7.1 step 4): docs' head re-posted with a fresh observation, so a reading follows
 *  every end — a ticket is claimable again only after one (§6.7). Returns the post's JSON. */
export async function refresh(extra: Record<string, unknown> = {}) {
  const { sha } = (await (await syncCall('/v1/sync/head')).json()) as { sha: string };
  const res = await syncCall('/v1/sync/board', { sha, parent_sha: sha, state: { items: [] }, ready: [], ...extra });
  return (await res.json()) as Record<string, any>;
}

/** `POST /v1/sync/observation` as a repository's sync (R-BTN-62): its JSON and status. */
export async function observe(token?: string) {
  const res = await call('/v1/sync/observation', { method: 'POST', headers: { Authorization: `Bearer ${token ?? (await syncToken())}`, 'Content-Type': 'application/json' }, body: '{}' });
  return { status: res.status, json: (await res.json()) as { sha: string | null; observation: number; bars: unknown[]; versions?: Record<string, string>; code_repos?: unknown[]; pushers?: unknown[]; signing_keys?: { public_key: string; fingerprint: string }[]; require_signed_control?: boolean; code?: string } };
}

export async function ownerCall(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cf-Access-Jwt-Assertion', await accessToken());
  return call(path, { ...init, headers });
}

/** The whole state as `GET /v1/admin/state` answers it — the core's `stateView()` (B-216),
 *  through the JSON it is served as. The tests' oracle where no administrator's key is
 *  configured (an Access-fronted instance, where the route's own caller does not exist) since
 *  B-203 retired the session's read of it; a test with an administrator's key reads the route
 *  itself (`keyCall(admin, '/v1/admin/state')`). */
export function stateView(): Promise<Record<string, any>> {
  return withCore((c) => JSON.parse(JSON.stringify(c.stateView())) as Record<string, any>);
}

/** Set the core's clock to a fixed time (R-BTN-32). */
export function setClock(ms: number) {
  return withCore((c) => {
    c.now = () => ms;
  });
}

/** Run SQL in the core's store and return the rows. */
export function rows<T = Record<string, unknown>>(query: string, ...params: unknown[]): Promise<T[]> {
  return withCore((c) => c.store.exec<T>(query, ...params).toArray());
}

/** A board payload as the sync posts it (§7.1, §11): either a fixture snapshot (the real
 *  sync's `buildPayload` output — `state`, `ready` and the reference data) or a hand-built
 *  `{items, ready}`, at `sha` over `parent`. */
export function payload(
  sha: string,
  parent: string | null,
  snap: { items?: unknown[]; state?: { items: unknown[] }; ready: string[]; [k: string]: unknown },
  extra: Record<string, unknown> = {},
) {
  const { items, state, ready, sha: _s, parent_sha: _p, ...reference } = snap;
  return { registry: [course()], ...reference, sha, parent_sha: parent, state: { items: state?.items ?? items ?? [] }, ready, confirmations: [], ...extra };
}

/** A registry entry (R-BTN-48) as the sync posts it: docs' `roadmap-pr`, its course file the
 *  vendored fixture, at `version` with runners needed at `min` (rule 9). */
export function course(version = 3, min = version, over: Record<string, unknown> = {}) {
  return { id: 'roadmap-pr', version, min_runner_version: min, skill: 'next-roadmap-item', course: roadmapPr,
    step_kinds: [...ACTIVITY_KINDS], branch_pattern: 'claude/{ticket}-*', ...over };
}

// ── runners (R3-1211) ─────────────────────────────────────────────────────────────────────

export const TOKENS = { 'vm-a': 'tok-vm-a', 'vm-b': 'tok-vm-b', mac: 'tok-mac', test: 'tok-test' } as const;
const HOSTS = { 'vm-a': 'vm-a', 'vm-b': 'vm-b', mac: 'owner-mac', test: 'harness' } as const;

export async function sha256(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A runner call with a credential's token and, after the first heartbeat, the secret. `client`
 *  is the `Baton-Client` the call names — absent, the harness's own (the host's `call`). */
export function runnerCall(path: string, { cred = 'vm-a', secret, body, method, client }: { cred?: keyof typeof TOKENS; secret?: string; body?: unknown; method?: string; client?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKENS[cred]}`, 'Content-Type': 'application/json' };
  if (secret) headers['X-Runner-Secret'] = secret;
  if (client) headers['Baton-Client'] = client;
  return call(path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** The run's test SSH keys (vitest.config.ts), by the name each registers: `vm-ed`,
 *  `vm-p256`, `vm-sk-ed`, `vm-sk-p256` (R-BTN-13 as amended, R3-1239). */
export const SSH_KEYS: Record<string, TestKey> = Object.fromEntries((JSON.parse(env.TEST_SSH_KEYS ?? '[]') as TestKey[]).map((k) => [k.name, k]));

/** A runner call signed with test key `name` (R-BTN-13): `created` is the core's clock unless
 *  given; a body is JSON. `headers` ride beside the signature (B-254: a `Baton-Client` of the
 *  test's choosing). Returns the request too, to replay it. */
export async function signedCall(name: string, path: string, o: Omit<SignOptions, 'body'> & { body?: unknown; secret?: string; url?: string; headers?: Record<string, string> } = {}) {
  const created = o.created ?? Math.floor((await withCore((c) => c.now())) / 1000);
  const headers: Record<string, string> = { ...(o.headers ?? {}), ...(o.secret ? { 'X-Runner-Secret': o.secret } : {}) };
  const req = await signedRequest(SSH_KEYS[name], o.url ?? ORIGIN + path, { ...o, created, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const replay = req.clone();
  const res = await hostCall(req);
  return { res, replay };
}

/** A heartbeat body with sensible defaults for `cred`'s host. B-142: the model tables' fields
 *  (`model_provider_id`, `billing`) are gone from the shape; the window test posts them. */
export function hbBody(cred: keyof typeof TOKENS, over: Record<string, unknown> = {}) {
  return {
    hostname: HOSTS[cred], session_name: `s-${cred}`, harness: 'opencode', kind: 'vm', model_id: 'zai-coding-plan/glm-5.3',
    capabilities: ['agent-venue'],
    tier_ceiling: 'critical', lease_timeout_s: 900, courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }], ...over,
  };
}

/** Register a runner with a fresh secret; returns its id and secret. */
export async function register(cred: keyof typeof TOKENS = 'vm-a', over: Record<string, unknown> = {}) {
  const secret = `secret-${cred}-${Math.random().toString(16).slice(2)}`;
  const res = await runnerCall('/v1/runner/heartbeat', { cred, body: hbBody(cred, { secret_hash: await sha256(secret), ...over }) });
  const json = (await res.json()) as Record<string, unknown>;
  if (res.status !== 200) throw new Error(`register ${cred}: ${res.status} ${JSON.stringify(json)}`);
  return { id: json.runner_id as number, secret, first: json };
}

/** A later heartbeat, authenticated by the secret. */
export async function beat(cred: keyof typeof TOKENS, secret: string, over: Record<string, unknown> = {}) {
  const res = await runnerCall('/v1/runner/heartbeat', { cred, secret, body: hbBody(cred, over) });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

// ── claims (R3-1212) ──────────────────────────────────────────────────────────────────────

/** The one-way cutover of a repository (docs by default), set directly as the harness does
 *  (R-BTN-28; R3-1217 adds the call). */
export function cutover(at = 1, repository = 'docs') {
  return rows('UPDATE repositories SET cutover_at = ? WHERE id = ?', at, repository);
}

let requests = 0;
/** A fresh client-generated `request_id`. */
export const requestId = () => `req-${++requests}-${Math.random().toString(16).slice(2, 10)}`;

/** `POST /v1/runner/claim`; returns the status and the body. */
export async function claimItem(cred: keyof typeof TOKENS, secret: string, body: Record<string, unknown> = {}, client?: string) {
  const res = await runnerCall('/v1/runner/claim', { cred, secret, body: { request_id: requestId(), ...body }, ...(client ? { client } : {}) });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** `POST /v1/runner/claims/{id}/end`. */
export async function endClaim(cred: keyof typeof TOKENS, secret: string, claimId: number, body: Record<string, unknown>) {
  const res = await runnerCall(`/v1/runner/claims/${claimId}/end`, { cred, secret, body });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** A claim's row, for assertions. */
export async function claimRow(id: number) {
  return (await rows<{ status: string; end_reason: string | null; fence_pending: number; confirmed_at: number | null; ticket_id: string }>(
    'SELECT status, end_reason, fence_pending, confirmed_at, ticket_id FROM claims WHERE id = ?', id))[0];
}

/** One alarm tick, run directly (each host says how). */
export function tick() {
  return hostTick();
}

// ── the mirror (R3-1218) ──────────────────────────────────────────────────────────────────

/** docs' mirror workflow, as its OIDC token names it (wrangler.toml's BATON_REPOSITORIES). */
export const MIRROR_WORKFLOW_REF = 'immediately-run/docs/.github/workflows/baton-mirror.yml@refs/heads/main';

/** A call as the mirror workflow: an OIDC token from baton-mirror.yml on docs main. */
export async function mirrorCall(path: string, body?: unknown) {
  return syncCall(path, body, await syncToken({ job_workflow_ref: MIRROR_WORKFLOW_REF }));
}

/** Record the core's workflow dispatches instead of sending them, as `<repository>:<kind>`;
 *  returns the live list. */
export async function captureDispatches() {
  const sent: string[] = [];
  await withCore((c) => {
    c.dispatcher = async (wf) => {
      sent.push(`${wf.repository}:${wf.kind}`);
      return true;
    };
  });
  return sent;
}

/** A qualified ticket id in docs, the repository the fixtures post (R-BTN-47). */
export const q = (local: string) => `docs:${local}`;

// ── GitHub App webhooks (R3-1247) ─────────────────────────────────────────────────────────

/** A GitHub App delivery of `event` with `payload`, signed with the run's webhook secret
 *  unless `secret` says otherwise (R-BTN-73). */
export async function webhookCall(event: string, payload: unknown, { id = requestId(), secret = env.BATON_GITHUB_WEBHOOK_SECRET!, signature }: { id?: string; secret?: string; signature?: string } = {}) {
  const body = JSON.stringify(payload);
  const sig = signature ?? (await deliverySignature(secret, new TextEncoder().encode(body)));
  return call('/v1/github/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': event, 'X-GitHub-Delivery': id, 'X-Hub-Signature-256': sig }, body });
}

/** The core's armed alarm (§3), as its scheduler reports it. */
export function armedAt() {
  return withCore((c) => (c as unknown as { ports: { scheduler: { get(): Promise<number | null> } } }).ports.scheduler.get());
}

// ── stations and legs (R3-1232) ───────────────────────────────────────────────────────────

/** A ticket of §7.1's normative post. */
export function ticket(id: string, over: Record<string, unknown> = {}) {
  return { id, course_id: 'roadmap-pr', path: `content/roadmap/${id}.mdx`, title: `${id} — a fixture ticket`, tier: 'routine', requires: [],
    operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: ['immediately-run/docs'], rank: 0, ...over };
}

type NextLeg = [string, 'ready' | 'waiting'] | [string, 'waiting', string];
/** Where a sync places a ticket (R-BTN-70): its station, its path as [leg, reached] pairs, its
 *  next legs as [leg, state, waiting_on?]; the queued leg is the first ready one unless given. */
export function placed(station: string, path: [string, string][], next: NextLeg[], over: Record<string, unknown> = {}) {
  return {
    station, path: path.map(([leg, reached]) => ({ leg, reached })),
    next_leg: next.find((n) => n[1] === 'ready')?.[0] ?? next[0]?.[0] ?? null, next_source: 'marker',
    next: next.map(([leg, state, waiting_on]) => ({ leg, state, ...(waiting_on ? { waiting_on } : {}) })), bars: {}, ...over,
  };
}

/** A repository's git as its sync reports it, in the normative shape (§7.1): each `post` is a new
 *  head over the last, each `refresh` the same head again, both with a fresh observation. */
export class Git {
  private n = 0;
  head: string | null = null;
  readonly tickets = new Map<string, Record<string, unknown>>();
  readonly stations: Record<string, unknown> = {};
  private closed: { id: string; as: 'done' | 'withdrawn' }[] = [];
  registry: unknown[] = [course()];
  constructor(private readonly token?: string) {}

  add(id: string, over: Record<string, unknown> = {}, station: unknown = placed('filed', [], [['implement', 'ready']])) {
    this.tickets.set(id, ticket(id, over));
    this.stations[id] = station;
    return this;
  }
  place(id: string, station: unknown) {
    this.stations[id] = station;
    return this;
  }
  close(id: string, as: 'done' | 'withdrawn') {
    this.tickets.delete(id);
    delete this.stations[id];
    this.closed.push({ id, as });
    return this;
  }
  body(sha: string, parent: string | null, extra: Record<string, unknown> = {}) {
    return { registry: this.registry, sha, parent_sha: parent, tickets: [...this.tickets.values()], closed: this.closed, stations: this.stations, ...extra };
  }
  /** A new head; the response's JSON (with its status). */
  async post(extra: Record<string, unknown> = {}) {
    const sha = (++this.n).toString(16).padStart(40, '0');
    const res = await syncCall('/v1/sync/board', this.body(sha, this.head, extra), this.token);
    const json = (await res.json()) as Record<string, any>;
    if (res.status === 200) {
      this.head = sha;
      this.closed = [];
    }
    return { status: res.status, ...json };
  }
  /** A refresh of the head: its tickets unchanged, its stations and closures replaced. The body
   *  is read at the head, as a sync whose checkout stands there posts it (B-183: `read_sha`). */
  async refresh(extra: Record<string, unknown> = {}) {
    const res = await syncCall('/v1/sync/board', { ...this.body(this.head!, this.head), read_sha: this.head!, ...extra }, this.token);
    const json = (await res.json()) as Record<string, any>;
    if (res.status === 200) this.closed = [];
    return { status: res.status, ...json };
  }
}

/** `POST /v1/runner/claims/{id}/advance`. */
export async function advance(cred: keyof typeof TOKENS, secret: string, claimId: number, body: Record<string, unknown>) {
  const res = await runnerCall(`/v1/runner/claims/${claimId}/advance`, { cred, secret, body });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

// ── administration (R3-1240) ──────────────────────────────────────────────────────────────

/** BATON_ADMIN_KEYS for this test (R-BTN-57): the core reads the port on every call. */
export function setAdminKeys(...keys: (TestKey | string)[]) {
  return withCore((c) => {
    // A string is a line as written (an API key's public line, R-BTN-159); a key, its public key.
    (c as unknown as { ports: { adminKeys: { list: () => string[] } } }).ports.adminKeys = { list: () => keys.map((k) => (typeof k === 'string' ? k : k.publicKey)) };
  });
}

/** BATON_HUMAN_KEYS for this test (R-BTN-185, B-145): the host's break-glass keys, replaced the
 *  same way the administrators' are. */
export function setHumanKeys(...keys: (TestKey | string)[]) {
  return withCore((c) => {
    (c as unknown as { ports: { humanKeys?: { list: () => string[] } } }).ports.humanKeys = { list: () => keys.map((k) => (typeof k === 'string' ? k : k.publicKey)) };
  });
}

/** R-BTN-159: an API key and its public line, as `baton key create` makes them. */
export async function makeApiKey(comment = '') {
  const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = `bak_${hex(8)}_${hex(32)}`;
  return { key, fingerprint: key.slice(0, 20), line: `${key.slice(0, 20)} sha256:${await sha256(key)}${comment ? ` ${comment}` : ''}` };
}

/** A request to an administrator's or owner's route with an API key as its bearer (R-BTN-159). */
export async function apiKeyCall(key: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const res = await hostCall(new Request(ORIGIN + path, { method, headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** A request signed by `key` (an administrator's or an owner's), at the core's clock. */
export async function keyCall(key: TestKey, path: string, body?: unknown, method?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, method, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

/** A dashboard session minted from an administrator's key (R-BTN-57): its `Cookie` header value. */
export async function adminSession(key: TestKey): Promise<string> {
  const token = (await keyCall(key, '/v1/admin/login-links', {})).json.url.split('#')[1];
  const res = await hostCall(new Request(`${ORIGIN}/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ token }) }));
  return res.headers.get('Set-Cookie')!.split(';')[0];
}

/** A dashboard request under a session cookie. */
export function sessionCall(cookie: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookie);
  if (init.method && init.method !== 'GET') headers.set('Origin', ORIGIN);
  return hostCall(new Request(ORIGIN + path, { ...init, headers }));
}

// Storage fixtures for states that a scenario cannot cheaply arrange through the API.
// Keep supplied columns as explicit fields: a schema change must update the seeder contract.
// Use the public request helpers instead when the write itself is under test.
type FixtureValue = string | number | null;

function insertFixture(store: Pick<Store, 'exec'>, table: string, fields: Record<string, FixtureValue | undefined>): void {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  store.exec(`INSERT INTO ${table} (${entries.map(([key]) => key).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`,
    ...entries.map(([, value]) => value)).toArray();
}

type ActivitySeed = {
  runner_id: number; id: string; claim_id: number | null; kind: string; label: string; source: string;
  started_at: number; ended_at: number | null; outcome: string | null; received_at: number; detail_json?: string;
};
export function seedActivity(fields: ActivitySeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'activities', fields));
}

type ClaimLegSeed = {
  claim_id: number; seq: number; run_id?: string; leg: string; from_station: string; started_at: number;
  started_observation: number; finished_at?: number | null; session_url?: string | null; bars?: string; to_station?: string;
  evidence?: string; leg_log_dir?: string;
};
export function seedClaimLeg(fields: ClaimLegSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'claim_legs', fields));
}

type ClaimSeatSeed = {
  claim_id: number; capability: string;
};
export function seedClaimSeat(fields: ClaimSeatSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'claim_seats', fields));
}

type ClaimSeed = {
  ticket_id: string; runner_id: number; request_id: string; nonce: string; snapshot_sha: string | null;
  claimed_at: number; status: string; ended_at?: number | null; end_reason?: string | null; station?: string;
  start_path?: string; course_id?: string; confirmed_at?: number; ended_at_sha?: string | null;
  end_observation?: number; leg?: string; fence_pending?: number; reap_after?: number;
};
/** Seed an already-held claim (or a historical claim) when allocation itself is not under test. */
export function seedClaim(runnerId: number, ticket: string, at?: number): Promise<number>;
export function seedClaim(fields: ClaimSeed): Promise<number>;
export function seedClaim(runnerOrFields: number | ClaimSeed, ticket?: string, at = 0): Promise<number> {
  const fields: ClaimSeed = typeof runnerOrFields === 'number' ? {
    ticket_id: ticket!, runner_id: runnerOrFields, request_id: `seed:${runnerOrFields}:${ticket}`,
    nonce: 'abc123', snapshot_sha: '', claimed_at: at, status: 'active',
  } : runnerOrFields;
  return withCore((core) => {
    insertFixture(core.store, 'claims', fields);
    return core.store.exec<{ id: number }>('SELECT id FROM claims WHERE runner_id = ? AND request_id = ?', fields.runner_id, fields.request_id).toArray()[0].id;
  });
}

type ConditionSeed = {
  repository_id: string; ticket_id: string; claim_id: number; run_id: string; leg: string; type: string;
  disposition: string; severity: string; restarts_json: string; raised_at: number; outcome: string;
};
export function seedCondition(fields: ConditionSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'conditions', fields));
}

type CredentialSeed = {
  id: string; hostname: string; allowed_capabilities: string; kind?: string; public_key?: string;
  created_by?: string;
};
export function seedCredentialIn(store: Pick<Store, 'exec'>, fields: CredentialSeed): void {
  insertFixture(store, 'credentials', fields);
}
export function seedCredential(fields: CredentialSeed): Promise<void> {
  return withCore((core) => seedCredentialIn(core.store, fields));
}

type EventSeed = {
  at: number; kind: string; actor: string; detail_json: string; ticket_id: string | null; repository_id: string;
  claim_id?: number | null;
};
export function seedEvent(fields: EventSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'events', fields));
}

type ResourceSeed = {
  name: string; scope: string; detail_schema: string;
};
export function seedResource(fields: ResourceSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'external_resources', fields));
}

type HumanKeySeed = {
  fingerprint: string; public_key: string; added_by: string; added_at: number;
};
export function seedHumanKey(fields: HumanKeySeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'human_keys', fields));
}

type InstanceServesSeed = {
  instance: string; resource: string;
};
export function seedInstanceServes(fields: InstanceServesSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'instance_serves', fields));
}

type InstanceStateSeed = {
  instance: string; state: string; changed_at: number;
};
export function seedInstanceState(fields: InstanceStateSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'instance_states', fields));
}

type LegQueueSeed = {
  repository_id: string; course_id: string; leg: string; depth: number; max_queue: number;
};
export function seedLegQueue(fields: LegQueueSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'leg_queues', fields));
}

type MessageSeed = {
  kind: string; payload_json: string; from_runner_id?: number; to_runner_id: number; sent_at: number;
  delivered_at?: number; acknowledged_at?: number | null; status: string; from_principal?: string;
};
export function seedMessage(fields: MessageSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'messages', fields));
}

type PendingTranscriptSeed = {
  runner_id: number; repo: string; path: string; role: string; first_seen_at: number; last_pushed_at: number | null;
};
export function seedPendingTranscript(fields: PendingTranscriptSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'pending_transcripts', fields));
}

type PolicyFloorSeed = {
  repository_id: string; name: string; guarantees: string; remove_by: string; added_by: string; added_at: number;
};
export function seedPolicyFloor(fields: PolicyFloorSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'policy_floors', fields));
}

type RepositoryOwnerSeed = {
  repository_id: string; public_key: string; fingerprint: string; added_by: string; added_at: number;
};
export function seedRepositoryOwnerIn(store: Pick<Store, 'exec'>, fields: RepositoryOwnerSeed): void {
  insertFixture(store, 'repository_owners', fields);
}
export function seedRepositoryOwner(fields: RepositoryOwnerSeed): Promise<void> {
  return withCore((core) => seedRepositoryOwnerIn(core.store, fields));
}

type RepositoryPolicySeed = {
  repository_id: string; version: number; policy_json: string; hash: string; previous_hash: string;
  changed_by: string; approver: string | null; preset: string | null; at: number;
};
export function seedRepositoryPolicyIn(store: Pick<Store, 'exec'>, fields: RepositoryPolicySeed): void {
  insertFixture(store, 'repository_policies', fields);
}

type ResourceInstanceSeed = {
  name: string; repositories: string;
};
export function seedResourceInstance(fields: ResourceInstanceSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'resource_instances', fields));
}

type RunnerCapabilitySeed = {
  runner_id: number; capability: string; declared: string;
};
export function seedRunnerCapability(fields: RunnerCapabilitySeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'runner_capabilities', fields));
}

type RunnerCourseSeed = {
  runner_id: number; repository_id: string; course_id: string; version: number;
};
export function seedRunnerCourse(fields: RunnerCourseSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'runner_courses', fields));
}

type RunnerGrantSeed = {
  credential_id: string; repository_id: string; capabilities: string; max_tier?: string | null;
  max_claims?: number; granted_by: string; granted_at: number;
};
export function seedRunnerGrant(fields: RunnerGrantSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'runner_grants', fields));
}

type RunnerSeed = {
  hostname: string; session_name: string; secret_hash: string; credential_id: string; harness: string;
  kind: string; tier_ceiling: string; lease_timeout_ms: number; settings_hash: string; first_seen_at: number;
  last_seen_at: number;
};
export function seedRunner(fields: RunnerSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'runners', fields));
}

type ScopeFindingSeed = {
  repository_id: string; ticket_id: string; claim_id: number; kind: string; target: string; detail_json: string;
  raised_at: number; updated_at: number;
};
export function seedScopeFinding(fields: ScopeFindingSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'scope_findings', fields));
}

type TicketBlockSeed = {
  repository_id: string; ticket_id: string; leg?: string; kind: string; ref: string; since: number;
};
export function seedTicketBlock(fields: TicketBlockSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'ticket_blocks', fields));
}

type TicketOverrideSeed = {
  ticket_id: string; expedite?: number; hold?: number; hold_reason?: string | null; retry_after?: number;
  set_by: string; set_at: number;
};
export function seedTicketOverrideIn(store: Pick<Store, 'exec'>, fields: TicketOverrideSeed): void {
  insertFixture(store, 'ticket_overrides', fields);
}
export function seedTicketOverride(fields: TicketOverrideSeed): Promise<void> {
  return withCore((core) => seedTicketOverrideIn(core.store, fields));
}

type TicketRowSeed = {
  id: string; repository_id: string; local_id: string; path: string; title: string; status: string; node: string;
  queue: string; tags: string; requires_clause: string; depends_on: string; blocked_by: string; repos: string;
  snapshot_sha: string; row_hash: string;
};
export function seedTicketRow(fields: TicketRowSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'tickets', fields));
}

type TranscriptSeed = {
  runner_id: number; claim_id: number | null; repo: string; path: string; role: string; activity_id?: string | null;
  first_seen_at: number; last_pushed_at?: number | null;
};
export function seedTranscript(fields: TranscriptSeed): Promise<void> {
  return withCore((core) => insertFixture(core.store, 'transcripts', fields));
}

type UnblockedDispatchSeed = {
  repository_id: string; pending_json: string; due_at: number; last_sent_at?: number;
};
export function seedUnblockedDispatchIn(store: Pick<Store, 'exec'>, fields: UnblockedDispatchSeed): void {
  insertFixture(store, 'unblocked_dispatch', fields);
}
export function seedUnblockedDispatch(fields: UnblockedDispatchSeed): Promise<void> {
  return withCore((core) => seedUnblockedDispatchIn(core.store, fields));
}

type WebhookDispatchSeed = {
  repository_id: string; last_dispatch_at: number; trailing_at: number;
};
export function seedWebhookDispatchIn(store: Pick<Store, 'exec'>, fields: WebhookDispatchSeed): void {
  insertFixture(store, 'webhook_dispatch', fields);
}
export function seedWebhookDispatch(fields: WebhookDispatchSeed): Promise<void> {
  return withCore((core) => seedWebhookDispatchIn(core.store, fields));
}

type WebhookSyncSeed = {
  repository_id: string; last_dispatch_at: number;
};
export function seedWebhookSyncIn(store: Pick<Store, 'exec'>, fields: WebhookSyncSeed): void {
  insertFixture(store, 'webhook_syncs', fields);
}
export function seedWebhookSync(fields: WebhookSyncSeed): Promise<void> {
  return withCore((core) => seedWebhookSyncIn(core.store, fields));
}

// Recorded state transitions used by scenario setup, not by the request under test.
export function setTicketRankIn(store: Pick<Store, 'exec'>, ticket: string, rank: number): void {
  store.exec("UPDATE tickets SET rank = ? WHERE id = ?", rank, ticket).toArray();
}
export function setTicketRank(ticket: string, rank: number) {
  return withCore((core) => setTicketRankIn(core.store, ticket, rank));
}
export function setRunnerReaped(runner: number, at: number | null) {
  return rows("UPDATE runners SET reaped_at = ? WHERE id = ?", at, runner);
}
export function setRunnerLastSeen(runner: number, at: number) {
  return rows("UPDATE runners SET last_seen_at = ? WHERE id = ?", at, runner);
}
export function setGrantTrust(credential: string, level: string, domain: string) {
  return rows("UPDATE runner_grants SET trust_level = ?, trust_domain = ? WHERE credential_id = ?", level, domain, credential);
}
export function revokeRunnerGrants(credential: string, at: number) {
  return rows("UPDATE runner_grants SET revoked_at = ? WHERE credential_id = ?", at, credential);
}
export function setGrantRole(repository: string, role: string, credential: string) {
  return rows("UPDATE runner_grants SET role = ? WHERE credential_id = ? AND repository_id = ?", role, credential, repository);
}
export function setOwnerAttestation(fingerprint: string, attestation: string) {
  return rows("UPDATE repository_owners SET fido_attestation = ? WHERE fingerprint = ?", attestation, fingerprint);
}
export function setRepositoryGrantTrust(repository: string, level: string, domain: string, credential: string) {
  return rows("UPDATE runner_grants SET trust_level = ?, trust_domain = ? WHERE credential_id = ? AND repository_id = ?", level, domain, credential, repository);
}
export function clearPolicyFloors(repository: string) {
  return rows("DELETE FROM policy_floors WHERE repository_id = ?", repository);
}
export function replaceClaimControl(claim: number, control: string) {
  return rows("UPDATE claims SET control_json = ? WHERE id = ?", control, claim);
}
export function replaceSignedControl(repository: string, control: string) {
  return rows("UPDATE signed_control SET control_json = ? WHERE repository_id = ?", control, repository);
}
export function setCredentialCreatedBy(credential: string, createdBy: string) {
  return rows("UPDATE credentials SET created_by = ? WHERE id = ?", createdBy, credential);
}
export function revokeCredentialIn(store: Pick<Store, 'exec'>, credential: string, at: number): void {
  store.exec("UPDATE credentials SET revoked_at = ? WHERE id = ?", at, credential).toArray();
}
export function setCredentialAllowedCapabilities(credential: string, capabilities: string[]) {
  return rows("UPDATE credentials SET allowed_capabilities = ? WHERE id = ?", JSON.stringify(capabilities), credential);
}
export function setCourseLegCapabilities(repository: string, course: string, legCapabilities: Record<string, string[]>) {
  return rows("UPDATE courses SET leg_capabilities_json = ? WHERE repository_id = ? AND id = ?", JSON.stringify(legCapabilities), repository, course);
}
export function setCoursePersonLegs(repository: string, course: string, legs: string[]) {
  return rows("UPDATE courses SET person_legs_json = ? WHERE repository_id = ? AND id = ?", JSON.stringify(legs), repository, course);
}
/** A grant written, or rewritten and un-revoked, with these capabilities. */
export function putRunnerGrant(fields: { credential_id: string; repository_id: string; capabilities: string[]; granted_by: string; granted_at: number }) {
  return rows(`INSERT INTO runner_grants (credential_id, repository_id, capabilities, granted_by, granted_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (credential_id, repository_id)
    DO UPDATE SET capabilities = excluded.capabilities, revoked_at = NULL`,
  fields.credential_id, fields.repository_id, JSON.stringify(fields.capabilities), fields.granted_by, fields.granted_at);
}
export function removeRunnerCapability(runner: number, capability: string) {
  return rows("DELETE FROM runner_capabilities WHERE runner_id = ? AND capability = ?", runner, capability);
}
export function clearTicketRequirements(ticket: string) {
  return rows("DELETE FROM ticket_requires WHERE ticket_id = ?", ticket);
}
export function retireRepositoryIn(store: Pick<Store, 'exec'>, id: string, at: number): void {
  store.exec("UPDATE repositories SET retired_at = ? WHERE id = ?", at, id).toArray();
}
export function retireRepository(id: string, at: number) {
  return withCore((core) => retireRepositoryIn(core.store, id, at));
}
export function removeRepositoryOwner(fingerprint: string, at: number) {
  return rows("UPDATE repository_owners SET removed_at = ? WHERE fingerprint = ?", at, fingerprint);
}
export function setRepositoryWeight(id: string, weight: number) {
  return rows("UPDATE repositories SET weight = ? WHERE id = ?", weight, id);
}
export function setTranscriptRepositories(id: string, repositories: string) {
  return rows("UPDATE repositories SET transcript_repos = ? WHERE id = ?", repositories, id);
}
export function setRunnerLastActivity(runner: number, at: number) {
  return rows("UPDATE runners SET last_activity_at = ? WHERE id = ?", at, runner);
}
export function setTicketBlockedSince(ticket: string, at: number) {
  return rows("UPDATE tickets SET blocked_since = ? WHERE id = ?", at, ticket);
}
export function setClosedTicketTime(ticket: string, at: number) {
  return rows("UPDATE closed_tickets SET closed_at = ? WHERE ticket_id = ?", at, ticket);
}
export function setTicketRetry(ticket: string, at: number) {
  return rows("UPDATE ticket_overrides SET retry_after = ? WHERE ticket_id = ?", at, ticket);
}
export function setOwnerHumanOnly(fingerprint: string) {
  return rows("UPDATE repository_owners SET human_only = 1 WHERE fingerprint = ?", fingerprint);
}
export function setReadingLapse(instance: string, at: number) {
  return rows("UPDATE instance_readings SET lapses_at = ? WHERE instance = ?", at, instance);
}
export function revokeCredential(credential: string, at: number) {
  return rows("UPDATE credentials SET revoked_at = ? WHERE id = ?", at, credential);
}
export function setAllRunnersReaped(at: number) {
  return rows("UPDATE runners SET reaped_at = ?", at);
}
export function clearRunnerCapabilities(runner: number) {
  return rows("DELETE FROM runner_capabilities WHERE runner_id = ?", runner);
}
export function replaceRecordedInputDigest(input: string, digest: string) {
  return rows("UPDATE leg_run_inputs SET digest = ? WHERE name = ?", digest, input);
}
export function replaceClaimSnapshot(ticket: string, sha: string) {
  return rows("UPDATE claims SET snapshot_sha = ? WHERE ticket_id = ?", sha, ticket);
}
export function clearSettingIn(store: Pick<Store, 'exec'>, key: string): void {
  store.exec("DELETE FROM baton_settings WHERE key = ?", key).toArray();
}
/** B-259 (S-BTN-244, B-236): an events row as retention sees it — only the columns given are
 *  written, the rest take the table's defaults; the new row's `seq`. */
type EventRowSeed = { at: number; kind: string; actor: string; detail_json?: string; repository_id?: string };
function eventInsert(e: EventRowSeed): [string, unknown[]] {
  const cols = Object.entries(e).filter(([, v]) => v !== undefined);
  return [`INSERT INTO events (${cols.map(([k]) => k).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING seq`, cols.map(([, v]) => v)];
}
export async function addEventRow(e: EventRowSeed): Promise<{ seq: number }> {
  const [sql, params] = eventInsert(e);
  return (await rows<{ seq: number }>(sql, ...params))[0];
}
export function addEventRowIn(store: Pick<Store, 'exec'>, e: EventRowSeed): void {
  const [sql, params] = eventInsert(e);
  store.exec(sql, ...params).toArray();
}
/** B-259: the mirror's acknowledged cursor — `seq`, or the newest event's when `'max'`; for one
 *  repository, or every one when `repository` is null. */
function mirrorAck(repository: string | null, seq: number | 'max'): [string, unknown[]] {
  const value = seq === 'max' ? '(SELECT MAX(seq) FROM events)' : '?';
  return [`UPDATE repositories SET mirror_acked_seq = ${value}${repository == null ? '' : ' WHERE id = ?'}`,
    [...(seq === 'max' ? [] : [seq]), ...(repository == null ? [] : [repository])]];
}
export function setMirrorAcked(repository: string | null, seq: number | 'max') {
  const [sql, params] = mirrorAck(repository, seq);
  return rows(sql, ...params);
}
export function setMirrorAckedIn(store: Pick<Store, 'exec'>, repository: string | null, seq: number | 'max'): void {
  const [sql, params] = mirrorAck(repository, seq);
  store.exec(sql, ...params).toArray();
}
/** B-249: the instant Baton last served, so a clock jump reads as elapsed service time, not an outage. */
export function setLastServedAt(at: number) {
  return rows("UPDATE baton_settings SET value = ? WHERE key = 'last_served_at'", String(at));
}
export function clearSetting(key: string) {
  return withCore((core) => clearSettingIn(core.store, key));
}
export function clearInstanceReadings() {
  return rows("DELETE FROM instance_readings");
}
export function clearCourseRegistry() {
  return rows("DELETE FROM courses");
}
export function releaseSeededClaim(claim: number, at: number) {
  return rows("UPDATE claims SET status = 'released', ended_at = ? WHERE id = ?", at, claim);
}
export function releaseActiveTicketClaim(ticket: string, at: number) {
  return rows("UPDATE claims SET status = 'released', ended_at = ? WHERE ticket_id = ? AND status = 'active'", at, ticket);
}
export function setUnblockedTriggerIn(store: Pick<Store, 'exec'>, id: string, trigger: string): void {
  store.exec("UPDATE repositories SET unblocked_trigger = ? WHERE id = ?", trigger, id).toArray();
}
export function releaseAllSeededClaims(at: number) {
  return rows("UPDATE claims SET status = 'released', ended_at = ?, end_reason = 'released:requested'", at);
}
export function setCredentialHostname(credential: string, hostname: string) {
  return rows("UPDATE credentials SET hostname = ? WHERE id = ?", hostname, credential);
}
export function setTranscriptRepositoriesForAll(repositories: string) {
  return rows("UPDATE repositories SET transcript_repos = ?", repositories);
}
export function removeAllRepositoryOwnersIn(store: Pick<Store, 'exec'>, at: number): void {
  store.exec("UPDATE repository_owners SET removed_at = ?", at).toArray();
}
export function removeRepositoryOwnersIn(store: Pick<Store, 'exec'>, repository: string, at: number): void {
  store.exec("UPDATE repository_owners SET removed_at = ? WHERE repository_id = ?", at, repository).toArray();
}
export function removeRepositoryOwners(repository: string, at: number) {
  return withCore((core) => removeRepositoryOwnersIn(core.store, repository, at));
}
export function setSyncDispatchTimeIn(store: Pick<Store, 'exec'>, repository: string, at: number): void {
  store.exec("UPDATE webhook_syncs SET last_dispatch_at = ? WHERE repository_id = ?", at, repository).toArray();
}
export function setWebhookTrailingTimeIn(store: Pick<Store, 'exec'>, repository: string, at: number): void {
  store.exec("UPDATE webhook_dispatch SET trailing_at = ? WHERE repository_id = ?", at, repository).toArray();
}

export function claimRows() {
  return rows<{ id: number; ticket_id: string; status: string; end_reason: string | null; fence_pending: number }>(
    'SELECT id, ticket_id, status, end_reason, fence_pending FROM claims ORDER BY id');
}

export async function runnerId(session?: string): Promise<number> {
  const found = session === undefined
    ? await rows<{ id: number }>('SELECT id FROM runners')
    : await rows<{ id: number }>('SELECT id FROM runners WHERE session_name = ?', session);
  if (found.length !== 1) throw new Error(`Expected one runner, found ${found.length}`);
  return found[0].id;
}

/** Replace the implicit bootstrap grant with an owner grant covering the runner's declaration. */
export function grantRunnerConcurrency(runner: number, maxClaims: number) {
  return withCore(({ store }) => store.transaction(() => {
    const { credential_id } = store.exec<{ credential_id: string }>('SELECT credential_id FROM runners WHERE id = ?', runner).one();
    const caps = store.exec<{ capability: string }>('SELECT capability FROM runner_capabilities WHERE runner_id = ?', runner).toArray();
    const owner = 'owner:owner@example.com';
    store.exec('UPDATE credentials SET created_by = ? WHERE id = ?', owner, credential_id).toArray();
    store.exec(`INSERT INTO runner_grants (credential_id, repository_id, capabilities, max_tier, max_claims, granted_by, granted_at)
                VALUES (?, 'docs', ?, NULL, ?, ?, 0)
                ON CONFLICT (credential_id, repository_id) DO UPDATE SET max_claims = excluded.max_claims`,
      credential_id, JSON.stringify(caps.map((c) => c.capability)), maxClaims, owner).toArray();
  }));
}

/** R-BTN-10: the post fields of a sync that found the evidence an unconfirmed end named — its
 *  `std:git.evidence@1` for that claim, `ticket` a local id. Spread into `Git.refresh`/`post`. */
export function evidenceFound(claim: number, evidence: string, ticket = 'T-1', found = true) {
  return { attestations: [{ type: 'std:git.evidence@1', ticket, ref: String(claim), value: { claim, evidence, found } }] };
}

// Recorded setup that main's later scenarios wrote inline (B-279's ratchet: named here, never
// in a scenario file).
type SqlExec = { exec(query: string, ...bindings: unknown[]): unknown };
/** Migration tests: the legacy reviewer rows and settings migration 0076 retires. */
export function seedLegacyReviewerSql(sql: SqlExec): void {
  sql.exec(`INSERT INTO reviewer_agents (name, reviews_on, family, bills) VALUES ('review', 'm', 'family', '[]')`);
}
export function seedSettingsSql(sql: SqlExec, entries: [string, string][]): void {
  for (const [key, value] of entries) sql.exec('INSERT INTO baton_settings (key, value) VALUES (?, ?)', key, value);
}
/** Migration tests (B-239): an administrator-made key's runner holding `capabilities`. */
export function seedAdminRunnerSql(sql: SqlExec, credential: string, runner: number, capabilities: string[]): void {
  sql.exec("UPDATE credentials SET created_by = 'admin:test' WHERE id = ?", credential);
  sql.exec(`INSERT INTO runners (id, hostname, session_name, secret_hash, credential_id, harness, kind,
            tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
            VALUES (?, 'host', 's', 'hash', ?, 'opencode', 'vm', 'routine', 900000, '', 0, 0)`, runner, credential);
  for (const c of capabilities) sql.exec('INSERT INTO runner_capabilities (runner_id, capability, declared) VALUES (?, ?, ?)', runner, c, c);
}
/** S-BTN-243: months of history for one runner — `count` linked and pending transcripts and
 *  status reports, half an hour apart from `from`. */
export async function seedRunnerHistory(runner: number, count: number, repo: string, from: number, step: number): Promise<void> {
  const series = 'WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)';
  await rows(`${series}
    INSERT INTO transcripts (runner_id, claim_id, repo, path, role, first_seen_at)
    SELECT c.runner_id, c.id, ?, 'linked-' || i, 'session', ? + i * ? FROM k CROSS JOIN claims c WHERE c.runner_id = ?`,
    count, repo, from, step, runner);
  await rows(`${series}
    INSERT INTO pending_transcripts (runner_id, repo, path, role, first_seen_at)
    SELECT ?, ?, 'pending-' || i, 'session', ? + i * ? FROM k`, count, runner, repo, from, step);
  await rows(`${series}
    INSERT INTO messages (kind, from_runner_id, to_runner_id, sent_at, status, payload_json)
    SELECT 'status_report', ?, ?, ? + i * ?, 'acknowledged', '{"text":"history"}' FROM k`, count, runner, runner, from, step);
}
/** S-BTN-243: an ended claim, a linked and a pending transcript and a report for every
 *  `extra-*` runner. */
export async function seedExtraRunnersHistory(ticket: string, claimedAt: number, endedAt: number, repo: string): Promise<void> {
  await rows(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at)
    SELECT ?, id, 'history-' || id, 'test', '', ?, 'released', ? FROM runners WHERE hostname GLOB 'extra-*'`, ticket, claimedAt, endedAt);
  await rows(`INSERT INTO transcripts (runner_id, claim_id, repo, path, role, first_seen_at)
    SELECT c.runner_id, c.id, ?, 'linked-' || c.runner_id, 'session', ? FROM claims c WHERE c.ticket_id = ?`, repo, endedAt, ticket);
  await rows(`INSERT INTO pending_transcripts (runner_id, repo, path, role, first_seen_at)
    SELECT id, ?, 'pending-' || id, 'session', ? FROM runners WHERE hostname GLOB 'extra-*'`, repo, endedAt);
  await rows(`INSERT INTO messages (kind, from_runner_id, to_runner_id, sent_at, status, payload_json)
    SELECT 'status_report', id, id, ?, 'acknowledged', '{"text":"extra"}' FROM runners WHERE hostname GLOB 'extra-*'`, endedAt);
}
/** An event and a ticket-history row as an older Baton wrote them (S-BTN-310's migration). */
export function seedLegacyEvent(at: number, kind: string, detail: string) {
  return rows('INSERT INTO events (at, kind, actor, detail_json) VALUES (?, ?, \'baton\', ?)', at, kind, detail);
}
export function seedTicketHistory(repository: string, ticket: string, at: number, kind: string, detail: string) {
  return rows('INSERT INTO ticket_history (repository_id, ticket_id, at, kind, detail_json) VALUES (?, ?, ?, ?, ?)', repository, ticket, at, kind, detail);
}
export function setRepositoryDefaultBranch(id: string, branch: string) {
  return rows('UPDATE repositories SET default_branch = ? WHERE id = ?', branch, id);
}
