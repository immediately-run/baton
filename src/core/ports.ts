// ports.ts — the platform services core needs, one small interface each (BATON_SPEC §3a,
// R-BTN-55). Everything under src/core/ names only these; src/cloudflare/ and src/local/ each
// implement them. Nothing here imports a platform.

/** A value SQLite stores and returns: the Durable Object's `SqlStorageValue`. */
export type SqlValue = ArrayBuffer | string | number | null;
export type Row = Record<string, SqlValue>;

/** One statement's result: every row, or exactly one (`one` throws on any other count). */
export interface Cursor<T> {
  toArray(): T[];
  one(): T;
  /** The rows a writing statement changed, once drained (the Durable Object's `rowsWritten`);
   *  absent where the host cannot say, which counts as a change (B-237's state version). */
  readonly rowsWritten?: number;
}

/**
 * The database (§3, §4). Synchronous on both hosts — the Durable Object's SQLite and
 * `node:sqlite` alike — so an operation that does not await is atomic with no lock.
 */
export interface Store {
  /** One statement with bound parameters. */
  exec<T = Row>(query: string, ...params: unknown[]): Cursor<T>;
  /** Several statements with no parameters: a migration file. */
  script(sql: string): void;
  /** Run `fn` as one transaction (nestable): its writes commit together or not at all. */
  transaction<T>(fn: () => T): T;
}

/** The one alarm (§3): when it next fires, and setting that. */
export interface Scheduler {
  get(): Promise<number | null>;
  set(at: number): Promise<void>;
}

/** Baton's clock (R-BTN-32): epoch milliseconds. Core reads time only through its `now`;
 *  without one the core uses the system clock, on both hosts alike. */
export type Clock = () => number;

/** The administrators' public keys (R-BTN-57): the `BATON_ADMIN_KEYS` secret, or the file
 *  `--admin-keys` names. One OpenSSH public key per entry. */
export interface AdminKeys {
  list(): string[];
}

/** R-BTN-185 (B-145): the host's human-only keys — `BATON_HUMAN_KEYS`, the same shape as the
 *  administrators'. The deployment's root of trust, set outside Baton; a test replaces it as it
 *  replaces the administrators'. */
export type HumanKeys = AdminKeys;

/** §10.3: a workflow Baton dispatches after a committed transition: one repository's sync or
 *  mirror, resolved by the core to the GitHub repository and the workflow file. */
export interface Workflow {
  repository: string;
  /** `unblocked`: the repository's unblocked trigger (R-BTN-77), carrying `tickets`. */
  kind: 'sync' | 'mirror' | 'unblocked';
  /** B-89: a sync Baton's own webhook path sends — a merge, the alarm, a delivery naming the
   *  repository's tickets — is sent whatever the repository's mode, as `unblocked` is. */
  own?: boolean;
  tickets?: unknown[];
}
export interface DispatchTarget {
  github: string;
  /** The workflow file's name, as `actions/workflows/{workflow}/dispatches` takes it. */
  workflow: string;
  ref: string;
  /** `workflow_dispatch` inputs, strings (R-BTN-77's one input, `tickets`). */
  inputs?: Record<string, string>;
}

/** Outbound dispatch (§10.3), and the host's way to finish work after a response. */
export interface Dispatch {
  send(target: DispatchTarget): Promise<unknown>;
  /** Let `work` finish after the response: `waitUntil` on Cloudflare. Never awaited. */
  defer(work: Promise<unknown>): void;
}

/** The instance's settings (§3a): wrangler.toml's vars and the Worker secrets on Cloudflare,
 *  the start-up options and `--config` file locally. */
export interface Config {
  BATON_ORIGIN: string;
  OIDC_ISSUER: string;
  OIDC_JWKS_URL: string;
  /** The repositories registered at start, insert-only (R-BTN-47; src/core/registry.ts): a JSON
   *  array of `POST /v1/admin/repositories` bodies less their owner keys. Each binds its own
   *  sync and mirror workflow to its board (R-BTN-15). */
  BATON_REPOSITORIES?: string;
  /** R-BTN-16, as amended 2026-10-20: Access is hardening in front of the dashboard that Baton
   *  never reads, and no deployment sets these (R3-1208's provision sets none). B-46 removes
   *  the one read that remains. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAILS?: string;
  /** `{credential id: SHA-256 of its token}` and `{credential id: {hostname, allowed_capabilities}}`
   *  (R-BTN-13; R3-1208 sets them as Worker secrets). */
  TOKEN_HASHES?: string;
  CREDENTIALS?: string;
  /** R-BTN-13 as amended (R3-1239): the runner keys, a JSON array of `{key, name,
   *  allowed_capabilities}` — `key` an OpenSSH public key line, `name` the one hostname it may
   *  register. Seeded into `credentials` at start until R3-1240's owner grants replace it. */
  BATON_KEYS?: string;
  /** §10.3: a fine-grained token, Actions: write on docs only, for workflow_dispatch. Absent,
   *  the two workflows run on their 15-minute schedules. */
  GITHUB_DISPATCH_TOKEN?: string;
  /** R-BTN-94: per repository, `{forge, gitlab_issuer?, webhook?, dispatch?}` as JSON — what the
   *  Runner knows of each repository's forge before the object, and its forge secrets (R3-1262
   *  reads `gitlab_issuer`; R3-1263 and R3-1264 the rest). */
  BATON_FORGE_SECRETS?: string;
  /** R-BTN-73: the GitHub App's webhook secret. Absent, every delivery is refused. */
  BATON_GITHUB_WEBHOOK_SECRET?: string;
  /** R-BTN-185 (B-145): the host's human-only keys, one OpenSSH public key per line — the
   *  deployment's root of trust, set outside Baton. A key in it satisfies every `human` entry
   *  of every repository on the instance, and it is the only recovery from a lost key. */
  BATON_HUMAN_KEYS?: string;
  /** R-BTN-113 (B-234): the hosts whose session links the instance accepts — `session_hosts`,
   *  a comma- or JSON-separated list. An administrator's setting, as the human keys are; the
   *  default is `claude.ai` alone. */
  BATON_SESSION_HOSTS?: string;
  /** R-BTN-114's `SigningKey` (R-BTN-171, R-BTN-189): the tenant's Ed25519 signing key, as the
   *  JWK of its private half — `{"kty":"OKP","crv":"Ed25519","d":…,"x":…}`. A secret on
   *  Cloudflare, a key file locally; Baton never generates or stores one. */
  BATON_SIGNING_KEY?: string;
  /** R-BTN-2 (§2.1, R3-1258): the plan's daily limits, `{"requests": <n>, "rows_written": <n>}`,
   *  a Worker var on Cloudflare and `--plan-limits` locally — the default is Workers Free's
   *  100,000 each. The dashboard draws the day's usage against them; nothing is refused at a
   *  limit. */
  BATON_PLAN_LIMITS?: string;
  /** Test bindings only (vitest.config.ts, §13a): never set by a deploy or a local start. */
  BATON_TEST_BINDINGS?: string;
  TEST_OIDC_JWKS?: string;
  TEST_ACCESS_JWKS?: string;
  TEST_SIGNING_JWK?: string;
  /** The served `min` the suite's Baton plays under the test bindings (R-BTN-197, B-254, §13a):
   *  a Baton whose code has dropped what an older client sends, for S-BTN-227. The code's
   *  `MIN_CLIENT` is a constant no deploy raises — never a binding outside the tests. */
  TEST_MIN_CLIENT?: string;
  /** The test SSH keys' private halves (test/lib/sshKeys.ts), for the harness to sign with. */
  TEST_SSH_KEYS?: string;
  /** The key set GitLab CI tokens verify against under the test bindings (§13a). */
  TEST_GITLAB_JWKS?: string;
}

/** §3: a signed request's signature check (R3-1239) may let another request run. The Durable Object's
 *  input gate opens there by itself; the local queue is released. */
export interface Gate {
  outside<T>(work: () => Promise<T>): Promise<T>;
}

/** What a host hands core (R-BTN-55). */
export interface Ports {
  store: Store;
  scheduler: Scheduler;
  config: Config;
  dispatch: Dispatch;
  adminKeys: AdminKeys;
  /** R-BTN-185 (B-145): the host's human-only keys; absent, `BATON_HUMAN_KEYS` in the config. */
  humanKeys?: HumanKeys;
  /** Absent on Cloudflare, where the input gate needs nothing. */
  gate?: Gate;
  clock?: Clock;
  /** The core's random source (B-185: a run id's random half); tests replace it as they
   *  replace the clock. Absent, the system's. */
  random?: (n: number) => Uint8Array;
}
