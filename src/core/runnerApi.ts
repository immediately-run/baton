// runnerApi.ts — the server side of runners (BATON_SPEC §5, §6.8, §6.9, §9, §10.1–10.2, §11;
// R3-1211): registration and heartbeats with credential binding and per-runner secrets,
// activities, transcript pointers, messages, the alarm's share of them, and shadow reports. No
// claim logic lives here (R3-1212): claims are read, and written only by the shadow report,
// whose rows the unique indexes guard. The model tables are gone (B-142): a heartbeat may still
// carry `model_provider_id`, `billing`, `usage` and `rate_limits`, all accepted and ignored,
// and an unavailable provider is a reading (§6.3, R-BTN-76), never a table core keeps.
import { BatonError } from './http';
import { groupBy, logEvent } from './db';
import type { Deprecated } from './deprecated';
import { NONCE_TTL_MS, parseSshKey } from './auth';
import { SESSION_HOSTS, isPullRequestUrl, sessionLinkWhy, transcriptUrl } from './links';
import { ticketRepositories } from './codeRepos';
import { DEFAULT_TRANSCRIPT_REPOS, repositoryOf, transcriptReposOf } from './registry';

export { DEFAULT_TRANSCRIPT_REPOS };
import { capabilitiesOf } from '../shared/vocabulary.mjs';
import { compareVersions } from '../shared/versions.mjs';
import {
  REPORT_HORIZON_MS, REPORT_KEYS_MAX, checkAck, checkActivity, checkHeartbeat, checkMessage, checkShadowReport, bad, HOSTNAME, isGrantedKey,
  type ActivityReport, type Heartbeat, HOLDING } from './validate';
import type { Policies } from './policy';

import type { Config, Row, SqlValue, Store } from './ports';
import { liveness } from './stateVersion';
import { REPORT_AGE_FROM, REPORTS_FROM } from './runnerViews';

const CLOSE_GRACE_MS = 10 * 60_000; // §6.9: closing updates are accepted 10 minutes after a claim ends

/** FNV-1a (32-bit), hex: a cheap synchronous change detector. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length}:${h.toString(16)}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Ctx {
  store: Store;
  config: Config;
  now: () => number;
  /** R-BTN-19: a heartbeat's `fenced` report, handed to the claims (R3-1212). */
  fenced?: (runnerId: number, incarnation: number, claimId: number) => boolean;
  /** §7.5 R-BTN-90 (B-234): a heartbeat's `leg_finished` for its claim's running run, handed to
   *  the claims — the re-arm and the withdrawal, before this beat delivers its messages. */
  legFinished?: (runnerId: number, claimId: number, seq: number) => void;
  /** §11: where the claim is and what git shows of its ticket (R3-1232), from the claims. */
  claimView?: (claimId: number) => Record<string, unknown>;
  /** R-BTN-67: the owner bars in force on the credential's repositories, for the heartbeat's `bars`. */
  bars?: (now: number, credentialId: string) => unknown[];
  /** R-BTN-103: store the repositories and `asks` a heartbeat delivers notices for (`granted`: the
   *  repositories a machine key works on, null for any other key), returning what was refused. */
  couriers?: (runnerId: number, granted: string[] | null, entries: { repository: string; asks: string[] }[]) => { repository: string; code: string }[];
  /** §12.8 (B-145): the policy store — the protection reports and pins a heartbeat carries
   *  (R-BTN-180, R-BTN-189) and the hashes the answer carries for its repositories. */
  policies?: Policies;
  /** R-BTN-75: a runner became live or changed what it declares. */
  fleetChanged?: () => void;
  /** R-BTN-75: a shadow report's claim holds its ticket, or no longer does — the claim's start
   *  is silent (R-BTN-77), its end an event that wakes no one (R-BTN-75 as amended by R3-1254,
   *  B-26). */
  held?: (ticketId: string, silent: boolean) => void;
  /** The retired-fields window's one writer (B-168): a heartbeat's `uses`. */
  deprecated?: Deprecated;
  /** B-4 (R-BTN-113): the instance's session-host allowlist, `instance_settings` first, else the
   *  deploy's BATON_SESSION_HOSTS. Absent, the config's alone (a unit test's RunnerApi). */
  sessionHosts?: () => string[];
}

export class RunnerApi {
  constructor(private readonly c: Ctx) {}

  private rows<T = Row>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec(q, ...p).toArray() as T[];
  }
  private exec<T = Row>(q: string, ...p: unknown[]) {
    return this.c.store.exec<T>(q, ...p);
  }
  private event(kind: string, actor: string, detail: unknown, ticketId: string | null = null, claimId: number | null = null) {
    logEvent(this.c.store, this.c.now(), kind, actor, detail, ticketId, claimId);
  }
  private setting(key: string): string | null {
    return (this.rows<{ value: string }>('SELECT value FROM baton_settings WHERE key = ?', key)[0]?.value) ?? null;
  }

  // ── credentials (R-BTN-13) ──────────────────────────────────────────────────────────────

  /** Mirror the `CREDENTIALS` secret into `credentials`, and mark revoked a credential whose
   *  token hash is gone. Returns the credential's row, or throws `forbidden`. */
  credential(id: string): { id: string; hostname: string; allowed: string[]; kind: string; granted: boolean } {
    let policy: Record<string, { hostname: string; allowed_capabilities: string[] }> = {};
    let hashes: Record<string, string> = {};
    try {
      policy = JSON.parse(this.c.config.CREDENTIALS ?? '{}');
      hashes = JSON.parse(this.c.config.TOKEN_HASHES ?? '{}');
    } catch {
      throw new BatonError('unavailable', 'the credential tables are unreadable');
    }
    // §3's write budget: mirror only when either secret changed since the last mirror, so a
    // heartbeat writes no credential rows. The marker is a change detector, not a security check.
    const marker = fnv1a(`${this.c.config.CREDENTIALS ?? ''}\u0000${this.c.config.TOKEN_HASHES ?? ''}`);
    const now = this.c.now();
    if (this.setting('credentials_marker') !== marker) this.mirrorCredentials(policy, hashes, marker, now);
    const row = this.rows<{ id: string; hostname: string; allowed_capabilities: string; revoked_at: number | null; kind: string; created_by: string | null }>(
      'SELECT id, hostname, allowed_capabilities, revoked_at, kind, created_by FROM credentials WHERE id = ?', id)[0];
    if (!row || row.revoked_at != null) throw new BatonError('forbidden', 'this credential is not registered or is revoked');
    // R-BTN-58: a key an owner or administrator granted may declare what its grants together give
    // it — expanded capabilities, `human-operator` only from an administrator's grant.
    if (isGrantedKey(row.created_by)) {
      const caps = new Set(this.rows<{ capabilities: string }>('SELECT capabilities FROM runner_grants WHERE credential_id = ? AND revoked_at IS NULL', id)
        .flatMap((g) => JSON.parse(g.capabilities) as string[]));
      return { id: row.id, hostname: row.hostname, allowed: [...caps, 'none'].sort(), kind: row.kind, granted: true };
    }
    return { id: row.id, hostname: row.hostname, allowed: JSON.parse(row.allowed_capabilities), kind: row.kind, granted: false };
  }

  /** The `credentials` table is the secrets' mirror (§4), for the dashboard and the runner rows'
   *  foreign key; a credential whose token hash is gone is marked revoked. */
  private mirrorCredentials(policy: Record<string, { hostname: string; allowed_capabilities: string[] }>, hashes: Record<string, string>, marker: string, now: number) {
    for (const [cid, p] of Object.entries(policy)) {
      const allowed = JSON.stringify([...(p.allowed_capabilities ?? [])].sort());
      this.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, revoked_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET hostname = excluded.hostname, allowed_capabilities = excluded.allowed_capabilities,
                   revoked_at = CASE WHEN credentials.revoked_by IS NOT NULL THEN credentials.revoked_at
                                     WHEN excluded.revoked_at IS NULL THEN NULL ELSE COALESCE(credentials.revoked_at, excluded.revoked_at) END
                 WHERE credentials.kind = 'token'`,
        cid, p.hostname, allowed, Object.hasOwn(hashes, cid) ? null : now);
    }
    // A credential dropped from the policy is revoked too.
    const listed = Object.keys(policy);
    // (Only token credentials: `legacy`, the cutover import's own, and the SSH keys are not this
    // mirror's.)
    this.exec(`UPDATE credentials SET revoked_at = ? WHERE revoked_at IS NULL AND kind = 'token' AND id NOT IN (SELECT value FROM json_each(?))`, now, JSON.stringify(listed));
    this.exec(`INSERT INTO baton_settings (key, value) VALUES ('credentials_marker', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, marker);
  }

  // ── SSH keys (R-BTN-13 as amended; R3-1239) ──────────────────────────────────────────────

  /** Seed the runner keys from `BATON_KEYS` — a JSON array of `{key, name,
   *  allowed_capabilities}`, the key an OpenSSH public key line — until R3-1240's owner grants
   *  replace it. Each key's credential is its fingerprint. Seeding never brings a revoked key
   *  back (a key is revoked for good; a machine gets a new one) — such a key is returned in
   *  `revoked` — and a seeded key the list no longer names is revoked; a key an owner granted
   *  (R3-1240) is never the seed's. The whole list is checked before anything is written: a
   *  malformed entry, a key twice, or two keys for one name throws and changes nothing. */
  async seedKeys(): Promise<{ unchanged: boolean; seeded: number; revoked: string[] }> {
    const raw = this.c.config.BATON_KEYS;
    // An unset secret is no list at all, not an empty one: a start without it (a missed
    // secret on a new environment) changes nothing. `[]` revokes every seeded key.
    if (raw === undefined || raw === '') return { unchanged: true, seeded: 0, revoked: [] };
    const marker = fnv1a(raw);
    if (this.setting('keys_marker') === marker) return { unchanged: true, seeded: 0, revoked: [] };
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error('BATON_KEYS is not JSON');
    }
    if (!Array.isArray(list)) throw new Error('BATON_KEYS must be a JSON array');
    const keys: { id: string; public_key: string; name: string; allowed: string }[] = [];
    for (const [i, e] of list.entries()) {
      const at = `BATON_KEYS[${i}]`;
      if (!e || typeof e !== 'object') throw new Error(`${at} must be an object`);
      const { key, name, allowed_capabilities } = e as Record<string, unknown>;
      if (typeof key !== 'string') throw new Error(`${at}.key must be an OpenSSH public key`);
      const parsed = await parseSshKey(key);
      if (typeof name !== 'string' || !HOSTNAME.test(name)) throw new Error(`${at}.name must be a hostname`);
      // B-104 (R-BTN-121/174): the allow-list names capabilities and may name a typed holding —
      // `<type>:<value>`, the seed's grant for the interim reach it stands in for.
      if (!Array.isArray(allowed_capabilities) || allowed_capabilities.some((c) => typeof c !== 'string' || !(/^[a-z0-9-]{1,64}$/.test(c) || HOLDING.test(c)))) {
        throw new Error(`${at}.allowed_capabilities must be capability or holding names`);
      }
      if (keys.some((k) => k.id === parsed.fingerprint)) throw new Error(`${at}: the key is listed twice`);
      // R-BTN-57: a key holds one role — a sync key (R-BTN-93) is never a runner's.
      if (this.rows('SELECT 1 FROM sync_keys WHERE fingerprint = ?', parsed.fingerprint).length) throw new Error(`${at}: the key is a sync key (one role per key)`);
      if (this.rows('SELECT 1 FROM repository_owners WHERE fingerprint = ? AND removed_at IS NULL', parsed.fingerprint).length) throw new Error(`${at}: the key is an owner key (one role per key)`);
      if (keys.some((k) => k.name === name)) throw new Error(`${at}: ${name} already has a key (one key per name)`);
      // Only the type and the base64: a comment is a label for people, never stored.
      keys.push({ id: parsed.fingerprint, public_key: `${parsed.type} ${key.trim().split(' ')[1]}`, name, allowed: JSON.stringify([...allowed_capabilities].sort()) });
    }
    const now = this.c.now();
    const revoked: string[] = [];
    this.c.store.transaction(() => {
      // Revoke first, so a name whose key changed is free for its new key.
      this.exec(`UPDATE credentials SET revoked_at = ? WHERE kind = 'runner' AND created_by = 'seed' AND revoked_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))`, now, JSON.stringify(keys.map((k) => k.id)));
      for (const k of keys) {
        const held = this.rows<{ id: string }>(`SELECT id FROM credentials WHERE kind = 'runner' AND revoked_at IS NULL AND hostname = ? AND id != ?`, k.name, k.id)[0];
        if (held) throw new Error(`BATON_KEYS: ${k.name} already has a key in force (one key per name)`);
        this.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by) VALUES (?, ?, ?, 'runner', ?, 'seed')
                   ON CONFLICT (id) DO UPDATE SET hostname = excluded.hostname, allowed_capabilities = excluded.allowed_capabilities
                   WHERE credentials.kind = 'runner' AND credentials.created_by = 'seed' AND credentials.revoked_at IS NULL`, k.id, k.name, k.allowed, k.public_key);
      }
      revoked.push(...this.rows<{ id: string }>(`SELECT id FROM credentials WHERE revoked_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))`, JSON.stringify(keys.map((k) => k.id))).map((r) => r.id));
      this.exec(`INSERT INTO baton_settings (key, value) VALUES ('keys_marker', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, marker);
    });
    return { unchanged: false, seeded: keys.length, revoked };
  }

  /** The public key a fingerprint names, if it is registered and not revoked. */
  publicKey(fingerprint: string): string | null {
    return this.rows<{ public_key: string }>(
      'SELECT public_key FROM credentials WHERE id = ? AND public_key IS NOT NULL AND revoked_at IS NULL', fingerprint)[0]?.public_key ?? null;
  }

  /** R-BTN-13: a nonce seen for this key within 10 minutes is a replay. Every signed request
   *  inserts one row and prunes what has aged out (§3's write budget). `now` is the clock
   *  reading the request's `created` was judged by, so a nonce outlives every request that
   *  could carry it. */
  acceptNonce(fingerprint: string, nonce: string, now = this.c.now()): void {
    this.c.store.transaction(() => {
      this.exec('DELETE FROM request_nonces WHERE seen_at < ?', now - NONCE_TTL_MS);
      if (this.rows('SELECT 1 FROM request_nonces WHERE key_fingerprint = ? AND nonce = ?', fingerprint, nonce).length) {
        throw new BatonError('unauthenticated', 'this nonce was already used: a replayed request');
      }
      this.exec('INSERT INTO request_nonces (key_fingerprint, nonce, seen_at) VALUES (?, ?, ?)', fingerprint, nonce, now);
    });
  }

  // ── runners (§5, §10.2) ─────────────────────────────────────────────────────────────────

  /** The runner a later call comes from: this credential's runner whose secret hashes to the
   *  presented `X-Runner-Secret` (R-BTN-14). A reaped runner is refused until it re-keys.
   *  R-BTN-197: the call's `Baton-Client` is recorded as the runner's `client_version` beside
   *  its `last_seen_at` — the runner's own statement, NULL when the call named no version. */
  async authRunner(credentialId: string, secret: string | null, clientVersion: string | null = null, legacyName = false) {
    if (!secret) throw new BatonError('unauthenticated', 'X-Runner-Secret is required after the first heartbeat');
    const hash = await sha256Hex(secret);
    return this.c.store.transaction(() => this.authRunnerTx(credentialId, hash, clientVersion, legacyName));
  }

  private authRunnerTx(credentialId: string, hash: string, clientVersion: string | null = null, legacyName = false) {
    this.credential(credentialId);
    const w = this.rows<{ id: number; reaped_at: number | null; secret_seen: number }>('SELECT id, reaped_at, secret_seen FROM runners WHERE credential_id = ? AND secret_hash = ?', credentialId, hash)[0];
    if (!w) throw new BatonError('unauthenticated', 'no runner holds this secret');
    if (w.reaped_at != null) throw new BatonError('runner-reaped', 'this runner was reaped; re-key with a heartbeat');
    // B-237 (R-BTN-196): a call's `last_seen_at` is liveness — it does not move the state version;
    // the first presentation of the secret does.
    const now = this.c.now();
    const seen = () => this.exec(`UPDATE runners SET last_seen_at = ?, secret_seen = 1, client_version = ?,
      legacy_names_at = CASE WHEN ? THEN ? ELSE legacy_names_at END WHERE id = ?`, now, clientVersion, legacyName ? 1 : 0, now, w.id);
    if (w.secret_seen && !legacyName) liveness(this.c.store, seen);
    else seen();
    return w.id;
  }

  /** §6.8: the repositories any transcript pointer may name — the union of what each registered
   *  repository's claims accept (its `transcript_repos`, or the defaults while it names none;
   *  the defaults when no repository is registered). The heartbeat's
   *  shape check uses it; a pointer is then held to its claim's own repository's list. */
  transcriptRepos(): string[] {
    // Each repository's own list as its claims read it — the defaults for one that names none —
    // so this check never refuses what a claim's own repository allows.
    const repos = this.rows<{ id: string }>('SELECT id FROM repositories WHERE retired_at IS NULL');
    if (!repos.length) return DEFAULT_TRANSCRIPT_REPOS;
    return [...new Set(repos.flatMap((r) => transcriptReposOf(this.c.store, r.id)))].sort();
  }

  /** R-BTN-4 (B-188): the runner's active claims, oldest first — several, up to its bound. */
  private activeClaims(runnerId: number) {
    return this.rows<{ id: number; ticket_id: string; nonce: string; claimed_at: number }>(
      `SELECT id, ticket_id, nonce, claimed_at FROM claims WHERE runner_id = ? AND status = 'active' ORDER BY claimed_at, id`, runnerId);
  }

  /** The runner's oldest active claim — what a caller that knows one claim per runner reads
   *  (the shadow report, and the heartbeat's `claim` kept for runners before B-188). */
  private activeClaim(runnerId: number) {
    return this.activeClaims(runnerId)[0] ?? null;
  }

  /** §9.9: the newest open activity — the runner's, or with `claimId` that claim's (B-188). */
  private currentActivity(runnerId: number, claimId?: number) {
    return this.rows<{ id: string; kind: string; label: string | null; started_at: number; claim_id: number | null }>(
      `SELECT id, kind, label, started_at, claim_id FROM activities WHERE runner_id = ? AND ended_at IS NULL${claimId != null ? ' AND claim_id = ?' : ''}
       ORDER BY started_at DESC, received_at DESC LIMIT 1`, ...(claimId != null ? [runnerId, claimId] : [runnerId]))[0] ?? null;
  }

  /** `POST /v1/runner/heartbeat` (§11): registration on first contact, the secret and re-key
   *  rules (R-BTN-14), the credential's hostname and capability allow-list (R-BTN-13), settings
   *  rewritten only when their hash changes (§3), transcripts; the answer carries the
   *  claim, the messages, the stale courses and the mode. A `uses` a runner still sends is its
   *  retired declaration that it uses account instances (B-168): the heartbeat reads it as
   *  absent, logging `deprecated-field`. */
  // @model heartbeat sha256:b4745be87ea5
  // @model declare sha256:6bcad587d342
  async heartbeat(credentialId: string, secretHeader: string | null, body: unknown, clientVersion: string | null = null, legacyName = false) {
    // B-168 (R-BTN-76): `uses` is retired — a runner uses the repository's instances, never a set
    // it declares — and read as absent while the history's Migrations entry lasts.
    if (body && typeof body === 'object' && !Array.isArray(body) && (body as { uses?: unknown }).uses !== undefined) {
      this.c.deprecated?.note(this.c.now(), `credential:${credentialId}`, 'heartbeat.uses', 'heartbeat');
    }
    const hb = checkHeartbeat(body, this.transcriptRepos());
    // R-BTN-66: a per-repository ceiling names a tier of that registered repository's ladder.
    // One for a repository Baton does not serve (unknown or retired) is kept and reported, never
    // refusing the heartbeat — which would cost the runner its leases everywhere — and, once that
    // repository registers, holds if its ladder has the name and is its bottom if not (ceilingIn).
    const ignoredCeilings: string[] = [];
    for (const [repo, tier] of Object.entries(hb.tier_ceilings)) {
      const r = this.rows<{ tiers: string }>('SELECT tiers FROM repositories WHERE id = ? AND retired_at IS NULL', repo)[0];
      if (!r) {
        ignoredCeilings.push(repo);
        continue;
      }
      const ladder = JSON.parse(r.tiers) as string[];
      if (!ladder.includes(tier)) throw new BatonError('invalid-params', `tier_ceilings.${repo}: must be one of ${ladder.join(', ')}`);
    }
    // R-BTN-47 (B-173): a course the heartbeat declares of a retired repository is dropped,
    // never a refusal (R-BTN-3) — the old holder can still heartbeat and report its fence.
    // Dropped before the settings hash, so what is hashed is what is stored; a course of an
    // unknown repository is kept, as today (rule 9 reads it if it ever registers).
    const coursesRetired: string[] = [];
    hb.courses = hb.courses.filter((c) => {
      if (this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NOT NULL', c.repository).length) {
        coursesRetired.push(c.repository);
        return false;
      }
      return true;
    });
    // Every hash first; then every read and write in one synchronous transaction (§3). The
    // profile joins the hash (B-253): a beat that changes it rewrites the settings it belongs
    // to, as R-BTN-99 counts a profile change among the version-bumping writes.
    const presented = secretHeader ? await sha256Hex(secretHeader) : null;
    const settingsHash = await sha256Hex(JSON.stringify({
      harness: hb.harness, kind: hb.kind, model_id: hb.model_id ?? null,
      capabilities: [...hb.capabilities].sort(), tier: hb.tier_ceiling,
      tiers: Object.entries(hb.tier_ceilings).sort(),
      lease: hb.lease_timeout_s,
      courses: hb.courses.map((c) => `${c.repository}:${c.course}@${c.version}`).sort(),
      tags: [...hb.tags].sort(),
      profile: hb.profile ?? null,
    }));
    const answer = this.c.store.transaction(() => this.heartbeatTx(credentialId, presented, settingsHash, hb, clientVersion, legacyName));
    return {
      ...answer,
      ...(ignoredCeilings.length ? { tier_ceilings_unregistered: ignoredCeilings } : {}),
      ...(coursesRetired.length ? { courses_retired: [...new Set(coursesRetired)] } : {}),
    };
  }

  private heartbeatTx(credentialId: string, presented: string | null, settingsHash: string, hb: Heartbeat, clientVersion: string | null, legacyName: boolean) {
    // B-253: the profile, serialized once — the same bytes compared, stored and hashed.
    const profileJson = hb.profile ? JSON.stringify(hb.profile) : null;
    const cred = this.credential(credentialId);
    if (hb.hostname !== cred.hostname) throw new BatonError('forbidden', `this credential may register only ${cred.hostname}`);
    // B-104 (R-BTN-174, §11.1's refusal deleted): a heartbeat's declaration is recorded as
    // declared — every holding rests on the runner's own statement, and what it is granted
    // bounds the holdings rule 4 reads (H = declared ∩ grant), never the declaration itself.
    // The shape of a capability name is checked where the heartbeat was parsed (§12.3).
    // §10.1: a granted key declares only courses of repositories its grants cover (round 2, 2-A-6).
    if (cred.granted) {
      const granted = new Set(this.rows<{ repository_id: string }>('SELECT repository_id FROM runner_grants WHERE credential_id = ? AND revoked_at IS NULL', cred.id).map((r) => r.repository_id));
      const foreign = [...new Set(hb.courses.map((c) => c.repository).filter((r) => !granted.has(r)))];
      if (foreign.length) throw new BatonError('forbidden', `this credential is granted no access to ${foreign.join(', ')}; it may not declare their courses`);
    }
    // R-BTN-32: only the test credential may run a test-harness sidecar.
    if (hb.test_harness && cred.id !== 'test') throw new BatonError('forbidden', 'test_harness is refused from any credential but the test one');

    const now = this.c.now();
    let w = this.rows<{ id: number; secret_hash: string; credential_id: string; reaped_at: number | null; incarnation: number; settings_hash: string; secret_seen: number }>(
      'SELECT id, secret_hash, credential_id, reaped_at, incarnation, settings_hash, secret_seen FROM runners WHERE hostname = ? AND session_name = ?', hb.hostname, hb.session_name)[0];

    let rekeyed = false;
    // R-BTN-75: a runner that was not live before this heartbeat joins the fleet's counts.
    const was = w ? this.rows<{ live: number }>(`SELECT reaped_at IS NULL AND last_seen_at + lease_timeout_ms > ? AS live FROM runners WHERE id = ?`, now, w.id)[0] : null;
    if (!w) {
      if (!hb.secret_hash) bad('secret_hash', 'the first heartbeat of a session carries its SHA-256');
      this.exec(`INSERT INTO runners (hostname, session_name, secret_hash, credential_id, harness, kind, model_id,
                   tier_ceiling, tier_ceilings, lease_timeout_ms, profile_json, settings_hash, client_version, first_seen_at, last_seen_at, last_activity_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
        hb.hostname, hb.session_name, hb.secret_hash, cred.id, hb.harness, hb.kind, hb.model_id ?? null,
        hb.tier_ceiling, JSON.stringify(hb.tier_ceilings), hb.lease_timeout_s * 1000, profileJson, clientVersion, now, now, hb.last_activity_at ?? null);
      w = this.rows<typeof w>('SELECT id, secret_hash, credential_id, reaped_at, incarnation, settings_hash, secret_seen FROM runners WHERE hostname = ? AND session_name = ?', hb.hostname, hb.session_name)[0];
    } else {
      // R3-1239's handover: a session registered under a bearer token, or under a key since
      // revoked, may continue under its machine's key — the same name, and the session proved
      // below by its secret or a re-key. A session under another key in force never moves.
      const moving = w.credential_id !== cred.id;
      if (moving) {
        const from = this.rows<{ kind: string; revoked_at: number | null }>('SELECT kind, revoked_at FROM credentials WHERE id = ?', w.credential_id)[0];
        if (cred.kind !== 'runner' || !from || (from.kind !== 'token' && from.revoked_at == null)) {
          throw new BatonError('forbidden', 'this session is registered under another credential');
        }
      }
      if (hb.rekey) {
        // R-BTN-14: a re-key replaces the secret when the runner holds no claim or was reaped;
        // it clears reaped_at, bumps the incarnation, and never clears a fence.
        if (!hb.secret_hash) bad('secret_hash', 'a re-key carries the new secret’s SHA-256');
        if (w.reaped_at == null && this.activeClaim(w.id)) throw new BatonError('session-taken', 'a runner holding a claim cannot re-key');
        if (hb.secret_hash === w.secret_hash) {
          // A retried re-key is idempotent — only until the secret is presented, as for a retried
          // first heartbeat; the same hash cannot bring a reaped runner back.
          if (w.reaped_at != null) bad('secret_hash', 'a re-key carries a new secret');
          if (w.secret_seen && presented !== w.secret_hash) throw new BatonError('session-taken', 'a re-key carries a new secret');
        } else {
          this.exec('UPDATE runners SET secret_hash = ?, secret_seen = 0, incarnation = incarnation + 1, reaped_at = NULL WHERE id = ?', hb.secret_hash, w.id);
          this.event('rekeyed', `runner:${w.id}`, { incarnation: w.incarnation + 1 });
          rekeyed = true;
        }
      } else {
        // R-BTN-14: X-Runner-Secret, or — only until the runner has once presented it — the body
        // hash of a retried first heartbeat (idempotent registration).
        const ok = presented ? presented === w.secret_hash : !w.secret_seen && hb.secret_hash === w.secret_hash;
        if (!ok) throw new BatonError('session-taken', 'this session is registered with another secret');
        if (w.reaped_at != null) throw new BatonError('runner-reaped', 'this runner was reaped; re-key to start a new incarnation');
      }
      if (moving) this.exec('UPDATE runners SET credential_id = ? WHERE id = ?', cred.id, w.id);
    }

    const current = rekeyed ? hb.secret_hash : w.secret_hash; // the hash stored now
    const secretSeen = presented != null && presented === current ? 1 : 0;
    // B-237 (R-BTN-196): a beat of a live runner that changes nothing but `last_seen_at` and
    // `last_activity_at` is liveness, and does not move the state version — what those decide
    // (live, stalled) is the clock's; any other field it sets that differs is a change. The
    // caller's own `client_version` (R-BTN-197, B-254) is liveness in every path that records
    // it — this beat and `authRunnerTx`'s `seen` — like `last_seen_at` beside it: the runner's
    // statement of itself, never a state change.
    const stored = this.rows<{ harness: string; kind: string; model_id: string | null; tier_ceiling: string; tier_ceilings: string; lease_timeout_ms: number; isolation: string | null; profile_json: string | null; secret_seen: number; concurrency: number }>(
      'SELECT harness, kind, model_id, tier_ceiling, tier_ceilings, lease_timeout_ms, isolation, profile_json, secret_seen, concurrency FROM runners WHERE id = ?', w.id)[0];
    const beatOnly = !legacyName && !!was?.live && !rekeyed && stored != null && stored.harness === hb.harness && stored.kind === hb.kind
      && stored.model_id === (hb.model_id ?? null) && stored.tier_ceiling === hb.tier_ceiling && stored.tier_ceilings === JSON.stringify(hb.tier_ceilings)
      && stored.lease_timeout_ms === hb.lease_timeout_s * 1000 && stored.isolation === hb.isolation && stored.profile_json === profileJson && stored.secret_seen >= secretSeen
      && stored.concurrency === hb.concurrency;
    const beat = () => this.exec(`UPDATE runners SET last_seen_at = ?, secret_seen = MAX(secret_seen, ?), last_activity_at = COALESCE(?, last_activity_at), harness = ?, kind = ?,
                 model_id = ?, tier_ceiling = ?, tier_ceilings = ?, lease_timeout_ms = ?, isolation = ?, profile_json = ?, concurrency = ?, client_version = ?,
                 legacy_names_at = CASE WHEN ? THEN ? ELSE legacy_names_at END WHERE id = ?`,
      now, secretSeen, hb.last_activity_at ?? null, hb.harness, hb.kind, hb.model_id ?? null, hb.tier_ceiling, JSON.stringify(hb.tier_ceilings),
      hb.lease_timeout_s * 1000, hb.isolation, profileJson, hb.concurrency, clientVersion, legacyName ? 1 : 0, now, w.id);
    if (beatOnly) liveness(this.c.store, beat);
    else beat();
    const rewrote = settingsHash !== w.settings_hash || rekeyed;
    if (rewrote) this.rewriteSettings(w.id, hb, settingsHash);
    const granted = this.grantedRepos(cred);
    // R-BTN-103: the notices it delivers as a runner courier — a machine key's, on repositories it
    // is granted on; a refused entry never refuses the heartbeat either.
    const refusedReports = this.recordReports(w.id, granted, hb.reports, now);
    const refusedCouriers = [...hb.couriers.refused, ...(this.c.couriers?.(w.id, cred.kind === 'runner' ? granted : null, hb.couriers.entries) ?? [])];
    // §12.8 (B-145, R-BTN-180): only the protection checker's reports feed `no-runner-lands` —
    // a report from anyone else is refused per entry; the sync's and other trusted runners'
    // readings only log a discrepancy, so a granted key's report is logged as one.
    const protectionRefused: { repository: string; code: string }[] = [];
    for (const report of hb.protection) {
      if (this.c.policies?.recordProtection(report.repository, report, cred.id)) continue;
      if (this.rows('SELECT 1 FROM runner_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', cred.id, report.repository).length) {
        this.event('discrepancy', `runner:${w.id}`, { kind: 'protection-report', repository: report.repository, matched: report.matched, by: cred.id }, null, null);
        protectionRefused.push({ repository: report.repository, code: 'not-checker' });
      } else {
        protectionRefused.push({ repository: report.repository, code: 'not-granted' });
      }
    }
    if (!was?.live || rewrote) this.c.fleetChanged?.();
    const refused = hb.transcript_refusals;
    const unlinked = this.recordTranscripts(w.id, hb, now);

    const fresh = this.rows<{ incarnation: number; lease_timeout_ms: number }>('SELECT incarnation, lease_timeout_ms FROM runners WHERE id = ?', w.id)[0];
    // R-BTN-19: only a heartbeat with the secret (never the hash path) clears a fence.
    if (secretSeen) for (const f of hb.fenced) this.c.fenced?.(w.id, fresh.incarnation, f.claim_id);
    const claims = this.activeClaims(w.id);
    const mine = new Map(claims.map((c) => [c.id, c]));
    // R-BTN-113 (B-234, B-4): the running leg's session link, stored on its `claim_legs` row (latest
    // wins while the run is live). A link that fails the rule — https, no userinfo, an
    // allowlisted host — is dropped and logged, never a refused beat. The allowlist is the
    // instance's setting (`instance_settings`), the deploy's config until an administrator
    // sets one.
    // B-188: `session_urls` names each link's claim; the bare `session_url` of a runner before
    // B-188 is its one claim's, and with several claims held it names none, so it is dropped.
    let sessionUrlDropped: string | null = null;
    const links = [...hb.session_urls];
    if (hb.session_url !== undefined && claims.length === 1) links.push({ claim_id: claims[0].id, url: hb.session_url });
    else if (hb.session_url !== undefined && claims.length > 1) sessionUrlDropped = 'session_url names no claim while this runner holds several; send session_urls';
    for (const link of links) {
      const claim = mine.get(link.claim_id);
      if (!claim) continue; // a claim this runner no longer holds: its link has nothing to land on
      const why = sessionLinkWhy(link.url, this.c.sessionHosts?.() ?? SESSION_HOSTS.of(this.c.config));
      if (why != null) {
        sessionUrlDropped = why;
        this.event('discrepancy', `runner:${w.id}`, { sub: 'session-url', why, url: link.url.slice(0, 120) }, claim.ticket_id, claim.id);
      } else {
        // The same link again changes no row (B-237: so a working runner's beat moves no version).
        this.exec(`UPDATE claim_legs SET session_url = ? WHERE claim_id = ? AND finished_at IS NULL AND abandoned_at IS NULL AND session_url IS NOT ?`,
          link.url, claim.id, link.url);
      }
    }
    // §7.5 R-BTN-90 (B-234): `leg_finished` is processed before this beat delivers its
    // messages — a `leg-timeout` release still pending for the finished run is withdrawn in
    // there, so the answer below carries it never; one already delivered stands.
    // B-188: by claim (`legs_finished`); the bare `leg_finished` is a lone claim's.
    const finished = [...hb.legs_finished];
    if (hb.leg_finished !== undefined && claims.length === 1) finished.push({ claim_id: claims[0].id, seq: hb.leg_finished });
    for (const f of finished) if (mine.has(f.claim_id)) this.c.legFinished?.(w.id, f.claim_id, f.seq);
    // B-86: the capabilities a runner with no `--capabilities` declares (see `grantCapabilities`).
    const grantCapabilities = this.grantCapabilities(cred, w.id);
    return {
      runner_id: w.id,
      ...(refusedReports.length ? { reports_refused: refusedReports } : {}),
      // B-68's dual-read window: old runners can finish upgrading from the same answer. B-69
      // removes this alias once `legacy_names_at` shows none remain.
      worker_id: w.id,
      incarnation: fresh.incarnation,
      lease_timeout_s: fresh.lease_timeout_ms / 1000,
      grant: { capabilities: grantCapabilities },
      // R-BTN-4 (B-188): every active claim; `claim`, the oldest, stays for runners before B-188.
      ...(() => {
        const views = claims.map((c) => ({ ...c, ...this.c.claimView?.(c.id), activity: this.currentActivity(w.id, c.id) }));
        return { claims: views, claim: views[0] ?? null };
      })(),
      messages: this.deliver(w.id, now),
      // R-BTN-67: the owner bars in force on its repositories, so harness hooks can act on them offline.
      bars: this.c.bars?.(now, credentialId) ?? [],
      // R-BTN-22: the declared courses below their min_runner_version — no new claim on them.
      stale_courses: this.staleCourses(w.id),
      // §11: each repository's mode (R-BTN-28, per repository).
      mode: Object.fromEntries(this.rows<{ id: string; cutover_at: number | null }>('SELECT id, cutover_at FROM repositories WHERE retired_at IS NULL ORDER BY id')
        .map((r) => [r.id, r.cutover_at == null ? 'shadow' : 'cut-over'])),
      server_time: now,
      ...(protectionRefused.length ? { protection_refused: protectionRefused } : {}),
      ...(sessionUrlDropped != null ? { session_url_dropped: sessionUrlDropped } : {}),
      ...(refused.length ? { transcripts_refused: refused } : {}),
      ...(refusedCouriers.length ? { refused_couriers: refusedCouriers } : {}),
      ...(unlinked.length ? { transcripts_unlinked: unlinked } : {}),
    };
  }

  /**
   * B-86: the answer's `grant.capabilities` — what a runner with no `--capabilities` declares,
   * so a granted machine never restates what its grant already says. A granted key: its grants on
   * the repositories it declares courses in, merged (granted on none of them, nothing to declare);
   * a bearer or seed key, which no grant binds: the allow-list it has always declared within.
   * `none` (every runner satisfies it) is left out.
   */
  private grantCapabilities(cred: { id: string; granted: boolean }, runnerId: number): string[] {
    const repos = this.rows<{ repository_id: string }>(
      'SELECT repository_id FROM runner_courses WHERE runner_id = ?', runnerId).map((r) => r.repository_id);
    const mine = cred.granted
      ? repos.flatMap((repository) => this.grantedCapabilities(cred.id, repository))
      : this.credentialAllowed(cred.id);
    return [...new Set(mine)].filter((c) => c !== 'none').sort();
  }

  /** R-BTN-179 (B-90): the capabilities one grant gives on one repository, expanded as it is
   *  stored — the same rows the heartbeat's grantCapabilities unions over. Public: the board
   *  route names the same grant the heartbeat names (src/core/baton.ts). */
  grantedCapabilities(credential: string, repository: string): string[] {
    const row = this.rows<{ capabilities: string }>(
      'SELECT capabilities FROM runner_grants WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', credential, repository)[0];
    return row ? (JSON.parse(row.capabilities) as string[]) : [];
  }

  /** R-BTN-58: a granted key's grants in force, by repository; null for a bearer or seed key,
   *  whose reach is its own. */
  private grantedRepos(cred: { id: string; granted: boolean }): string[] | null {
    return cred.granted
      ? this.rows<{ repository_id: string }>('SELECT repository_id FROM runner_grants WHERE credential_id = ? AND revoked_at IS NULL', cred.id).map((r) => r.repository_id)
      : null;
  }

  /** A bearer or seed key's allow-list, for B-86's grant answer — the reach it has always
   *  declared within. A granted key never comes here (its reach is its grants, `credential()`),
   *  so this is the row's list as mirrored (§4). */
  private credentialAllowed(id: string): string[] {
    const row = this.rows<{ allowed_capabilities: string }>('SELECT allowed_capabilities FROM credentials WHERE id = ?', id)[0];
    return row ? [...(JSON.parse(row.allowed_capabilities) as string[])] : [];
  }

  private recordReports(runner: number, grants: string[] | null, reports: Heartbeat['reports'], now: number): number[] {
    const refused: number[] = [];
    for (const [i, report] of reports.entries()) {
      const claim = 'claim_id' in report ? report.claim_id : 0;
      const held = claim ? this.rows<{ ticket_id: string }>("SELECT ticket_id FROM claims WHERE id = ? AND runner_id = ? AND status = 'active'", claim, runner)[0] : null;
      const repo = held ? repositoryOf(held.ticket_id) : 'repository' in report ? report.repository : null;
      if (!repo || (grants && !grants.includes(repo)) || !this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NULL', repo).length) {
        refused.push(i);
        continue;
      }
      const scope = [runner, repo, claim] as const;
      this.exec(`INSERT INTO runner_reports (runner_id, repository_id, claim_id, key, received_at, payload, insertion_order)
        VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(insertion_order), 0) + 1 FROM runner_reports))
        ON CONFLICT (runner_id, repository_id, claim_id, key) DO UPDATE SET received_at = excluded.received_at, payload = excluded.payload`,
        ...scope, report.key, now, report.payload);
      this.exec(`DELETE FROM runner_reports WHERE runner_id = ? AND repository_id = ? AND claim_id = ? AND key IN (
        SELECT key FROM runner_reports WHERE runner_id = ? AND repository_id = ? AND claim_id = ?
        ORDER BY received_at DESC, insertion_order DESC LIMIT -1 OFFSET ?)`, ...scope, ...scope, REPORT_KEYS_MAX);
    }
    return refused;
  }

  /** §3's write budget: capability rows change only with the settings hash. */
  private rewriteSettings(runnerId: number, hb: Heartbeat, hash: string) {
    this.exec('DELETE FROM runner_capabilities WHERE runner_id = ?', runnerId);
    const seen = new Set<string>();
    for (const declared of hb.capabilities) {
      // A role is stored as its capabilities (§7.2 rule 4), each row naming what was declared;
      // a name that expands to nothing (`none`) stores no row.
      for (const cap of capabilitiesOf([declared])) {
        if (seen.has(cap)) continue;
        seen.add(cap);
        this.exec('INSERT INTO runner_capabilities (runner_id, capability, declared) VALUES (?, ?, ?)', runnerId, cap, declared);
      }
      if (declared === 'human-operator' && !seen.has('human-operator')) {
        // Rule 6 reads the declared role itself (§7.2), so it gets a row of its own.
        seen.add('human-operator');
        this.exec('INSERT INTO runner_capabilities (runner_id, capability, declared) VALUES (?, ?, ?)', runnerId, 'human-operator', declared);
      }
    }
    // R-BTN-60: the tags rule 8 matches, as declared.
    this.exec('DELETE FROM runner_tags WHERE runner_id = ?', runnerId);
    for (const tag of hb.tags) this.exec('INSERT INTO runner_tags (runner_id, tag) VALUES (?, ?)', runnerId, tag);
    // R-BTN-48: the courses its checkouts run, at their versions — rule 9 reads them.
    this.exec('DELETE FROM runner_courses WHERE runner_id = ?', runnerId);
    for (const c of hb.courses) {
      this.exec('INSERT INTO runner_courses (runner_id, repository_id, course_id, version) VALUES (?, ?, ?, ?)', runnerId, c.repository, c.course, c.version);
    }
    this.exec('UPDATE runners SET settings_hash = ? WHERE id = ?', hash, runnerId);
  }

  /** §6.8: a path reported under a claim is linked to it; one reported with none waits for the
   *  next claim (`Claims.claim` links it). A repeat report moves `last_pushed_at` and fills a
   *  missing `activity_id` once that activity has arrived. */
  private recordTranscripts(runnerId: number, hb: Heartbeat, now: number) {
    const unlinked: number[] = [];
    if (!hb.transcripts.length) return unlinked;
    const claims = this.activeClaims(runnerId);
    for (const t of hb.transcripts) {
      // An activity not received yet only defers the link: the pointer is stored, and a later
      // report of it, once the activity has arrived, fills the link in.
      if (t.activity_id && !this.rows('SELECT 1 FROM activities WHERE runner_id = ? AND id = ?', runnerId, t.activity_id).length) {
        unlinked.push(t.index ?? -1);
        t.activity_id = undefined;
      }
      // B-188: the claim a pointer belongs to — the one it names, else its activity's, else the
      // lone claim; with several held and none named, it waits for a claim as one with none does.
      const named = t.claim_id ?? (t.activity_id ? this.rows<{ claim_id: number | null }>('SELECT claim_id FROM activities WHERE runner_id = ? AND id = ?', runnerId, t.activity_id)[0]?.claim_id ?? undefined : undefined);
      const claim = named != null ? claims.find((c) => c.id === named) ?? null : claims.length === 1 ? claims[0] : null;
      if (claim) {
        // A pointer under a claim names one of that claim's repository's transcript repositories
        // (§6.8, R-BTN-66): another repository's list does not widen it.
        if (!transcriptReposOf(this.c.store, repositoryOf(claim.ticket_id)).includes(t.repo)) {
          hb.transcript_refusals.push({ index: t.index ?? -1, code: 'invalid-params', message: `transcripts[${t.index}].repo: ${t.repo} is not one of ${repositoryOf(claim.ticket_id)}'s transcript repositories` });
          continue;
        }
        this.exec(`INSERT INTO transcripts (runner_id, claim_id, repo, path, role, activity_id, first_seen_at, last_pushed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (runner_id, repo, path, claim_id) DO UPDATE SET last_pushed_at = COALESCE(excluded.last_pushed_at, transcripts.last_pushed_at),
                     activity_id = COALESCE(transcripts.activity_id, excluded.activity_id)`,
          runnerId, claim.id, t.repo, t.path, t.role, t.activity_id ?? null, now, t.pushed_at ?? null);
      } else {
        this.exec(`INSERT INTO pending_transcripts (runner_id, repo, path, role, activity_id, first_seen_at, last_pushed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (runner_id, repo, path) DO UPDATE SET last_pushed_at = COALESCE(excluded.last_pushed_at, pending_transcripts.last_pushed_at),
                     activity_id = COALESCE(pending_transcripts.activity_id, excluded.activity_id)`,
          runnerId, t.repo, t.path, t.role, t.activity_id ?? null, now, t.pushed_at ?? null);
      }
    }
    return unlinked;
  }

  // ── messages (§9) ────────────────────────────────────────────────────────────────────────

  /** Delivery is the heartbeat (§9): pending messages become delivered; delivered ones not yet
   *  acknowledged are sent again, so a lost response loses nothing. */
  private deliver(runnerId: number, now: number) {
    const out = this.rows<{ id: number; kind: string; payload_json: string | null; sent_at: number }>(
      `SELECT id, kind, payload_json, sent_at FROM messages WHERE to_runner_id = ? AND status IN ('pending','delivered')
       AND kind IN ('release','status_request','wind-down','unblocked') ORDER BY id`, runnerId);
    this.exec(`UPDATE messages SET status = 'delivered', delivered_at = ? WHERE to_runner_id = ? AND status = 'pending'`, now, runnerId);
    return out.map((m) => ({ id: m.id, kind: m.kind, payload: m.payload_json ? JSON.parse(m.payload_json) : null, sent_at: m.sent_at }));
  }

  /** `POST /v1/ui/messages`: a release (`requested`, `owner-cancel`, `provider-suspended`), a
   *  status request, or a wind-down (B-109: the runner drains — its current leg completes, then
   *  it exits without claiming again), from the owner to one runner. */
  sendMessage(owner: string, body: unknown) {
    const m = checkMessage(body);
    if (!this.rows('SELECT 1 FROM runners WHERE id = ?', m.to_runner_id).length) throw new BatonError('not-found', 'no such runner');
    return this.exec<{ id: number }>(`INSERT INTO messages (kind, payload_json, from_principal, to_runner_id, sent_at, status)
      VALUES (?, ?, ?, ?, ?, 'pending') RETURNING id`,
      m.kind, m.payload ? JSON.stringify(m.payload) : null, `owner:${owner}`, m.to_runner_id, this.c.now()).one();
  }

  /** `POST /v1/runner/messages/{id}/ack`: the runner acknowledges; a status request's reply is
   *  stored as a `status_report` carrying the current activity (the server attaches it). */
  ack(runnerId: number, messageId: number, body: unknown) {
    const reply = checkAck(body); // §10.4: before any write
    const m = this.rows<{ id: number; kind: string; status: string }>('SELECT id, kind, status FROM messages WHERE id = ? AND to_runner_id = ?', messageId, runnerId)[0];
    if (!m) throw new BatonError('not-found', 'no such message for this runner');
    if (m.status === 'expired') bad('message', 'has expired');
    if (m.status === 'acknowledged') return { ok: true };
    const now = this.c.now();
    this.exec(`UPDATE messages SET status = 'acknowledged', acknowledged_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id = ?`, now, now, m.id);
    if (m.kind === 'status_request' && reply) {
      // The table needs a recipient; a report is addressed back to its sender and read by the dashboard.
      this.exec(`INSERT INTO messages (kind, payload_json, from_runner_id, to_runner_id, in_reply_to, sent_at, delivered_at, acknowledged_at, status)
                 VALUES ('status_report', ?, ?, ?, ?, ?, ?, ?, 'acknowledged')`,
        JSON.stringify({ activity: this.currentActivity(runnerId), text: reply.text }), runnerId, runnerId, m.id, now, now, now);
    }
    return { ok: true };
  }

  // ── activities (§6.9) ───────────────────────────────────────────────────────────────────

  /** `POST /v1/runner/activities`: each one upserted under `(runner_id, id)`, so a retry is
   *  idempotent and one runner never touches another's rows. Refusals are per activity. */
  activities(runnerId: number, body: unknown) {
    const list = (body as { activities?: unknown })?.activities;
    if (!Array.isArray(list) || list.length > 200) bad('activities', 'must be a list of at most 200');
    const refused: { id: string | null; code: string; message: string }[] = [];
    const now = this.c.now();
    for (const [i, raw] of (list as unknown[]).entries()) {
      try {
        this.c.store.transaction(() => this.upsertActivity(runnerId, checkActivity(raw, `activities[${i}]`), now));
      } catch (e) {
        if (!(e instanceof BatonError)) throw e;
        refused.push({ id: (raw as { id?: string })?.id ?? null, code: e.code, message: e.message });
      }
    }
    return { ok: true, refused };
  }

  /** §10.4 as amended (R-BTN-92, B-182): an activity's pull-request URL belongs to the claim's
   *  ticket's repositories — its home, or one of its `repos:` resolving to a `code_repos` entry
   *  (R-BTN-140) — each by the link rule over its own `web_base`, whatever its forge; with no
   *  claim, to any registered repository. */
  private checkPullRequest(url: string, claimId: number | null, field: string) {
    type Home = { id: string; repos: string };
    const ofClaim = claimId === null ? [] : this.rows<Home>(
      `SELECT p.id, t.repos FROM claims c JOIN tickets t ON t.id = c.ticket_id JOIN repositories p ON p.id = t.repository_id WHERE c.id = ?`, claimId);
    // A claim whose ticket the board no longer carries, or no claim: any registered repository.
    const homes = ofClaim.length ? ofClaim : this.rows<Home>(`SELECT id, '[]' AS repos FROM repositories WHERE retired_at IS NULL`);
    for (const h of homes) {
      const repos = JSON.parse(h.repos) as string[];
      for (const base of ticketRepositories(this.c.store, h.id, repos)) {
        if (isPullRequestUrl(base.forge, url, base.webBase)) return;
      }
    }
    bad(field, 'must be a pull request of the ticket’s repositories, under its forge');
  }

  private upsertActivity(runnerId: number, a: ActivityReport, now: number) {
    const existing = this.rows<{ kind: string; claim_id: number | null; ended_at: number | null; parent_id: string | null }>(
      'SELECT kind, claim_id, ended_at, parent_id FROM activities WHERE runner_id = ? AND id = ?', runnerId, a.id)[0];
    if (existing && (existing.kind !== a.kind || (existing.claim_id ?? null) !== (a.claim_id ?? null))) {
      bad(`activity ${a.id}`, 'kind and claim_id cannot change');
    }
    if (typeof a.detail?.pr === 'string') this.checkPullRequest(a.detail.pr, a.claim_id, `activity ${a.id}.detail.pr`);
    if (a.claim_id !== null) {
      const claim = this.rows<{ runner_id: number; status: string; ended_at: number | null }>(
        'SELECT runner_id, status, ended_at FROM claims WHERE id = ?', a.claim_id)[0];
      if (!claim || claim.runner_id !== runnerId) throw new BatonError('not-holder', `claim ${a.claim_id} is not this runner's`);
      if (claim.status !== 'active') {
        // §6.9: for 10 minutes after the end, an update that only closes an open activity is
        // accepted; anything else, and every later update, is claim-ended.
        const closesOpen = existing && existing.ended_at == null && a.ended_at !== undefined;
        if (!closesOpen || now - (claim.ended_at ?? 0) > CLOSE_GRACE_MS) throw new BatonError('claim-ended', `claim ${a.claim_id} has ended`);
      }
    }
    let parent = a.parent_id ?? existing?.parent_id ?? null;
    if (a.parent_id) {
      const p = this.rows<{ claim_id: number | null }>('SELECT claim_id FROM activities WHERE runner_id = ? AND id = ?', runnerId, a.parent_id)[0];
      if (!p || (p.claim_id ?? null) !== a.claim_id) bad(`activity ${a.id}.parent_id`, 'must name this runner’s activity under the same claim');
    } else if (!existing && a.kind === 'reviewer' && a.claim_id !== null) {
      // §6.9: a reviewer is parented to the newest open review-round on its claim.
      parent = this.rows<{ id: string }>(`SELECT id FROM activities WHERE runner_id = ? AND claim_id = ? AND kind = 'review-round' AND ended_at IS NULL
                                           ORDER BY started_at DESC LIMIT 1`, runnerId, a.claim_id)[0]?.id ?? null;
    }
    if (a.call_id) {
      const other = this.rows<{ id: string }>('SELECT id FROM activities WHERE runner_id = ? AND call_id = ?', runnerId, a.call_id)[0];
      if (other && other.id !== a.id) bad(`activity ${a.id}.call_id`, `is already activity ${other.id}'s`);
    }
    if (existing) {
      this.exec(`UPDATE activities SET label = COALESCE(?, label), detail_json = COALESCE(?, detail_json), ended_at = COALESCE(?, ended_at),
                   outcome = COALESCE(?, outcome), seq = COALESCE(?, seq), received_at = ? WHERE runner_id = ? AND id = ?`,
        a.label ?? null, a.detail ? JSON.stringify(a.detail) : null, a.ended_at ?? null, a.outcome ?? null, a.seq ?? null, now, runnerId, a.id);
      return;
    }
    this.exec(`INSERT INTO activities (runner_id, id, claim_id, parent_id, call_id, kind, seq, label, source, started_at, ended_at, outcome, received_at, detail_json, insertion_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(insertion_order), 0) + 1 FROM activities))`,
      runnerId, a.id, a.claim_id, parent, a.call_id ?? null, a.kind, a.seq ?? null, a.label ?? null, a.source, a.started_at,
      a.ended_at ?? null, a.outcome ?? null, now, a.detail ? JSON.stringify(a.detail) : null);
    if (a.kind === 'reviewer' && typeof a.detail?.substituted_for === 'string') {
      // §6.9: a substitution is derived from the reviewer activity, not reported separately.
      const item = a.claim_id ? this.rows<{ ticket_id: string }>('SELECT ticket_id FROM claims WHERE id = ?', a.claim_id)[0]?.ticket_id ?? null : null;
      this.event('reviewer-substituted', `runner:${runnerId}`, { activity: a.id, agent: a.detail.agent ?? a.label ?? null, substituted_for: a.detail.substituted_for }, item, a.claim_id);
    }
  }

  // ── the alarm's share (§3) ──────────────────────────────────────────────────────────────

  /** The expiry of a reaped runner's open messages (§9). R3-1212 adds reaping. */
  alarm() {
    const now = this.c.now();
    this.exec(`DELETE FROM runner_reports WHERE insertion_order IN (
      SELECT rr.insertion_order FROM ${REPORTS_FROM} WHERE (${REPORT_AGE_FROM}) <= ?)`, now - REPORT_HORIZON_MS);
    // B-236: driven from the open messages (`messages_by_status`), each runner read by its key —
    // never from the reaped runners, whose rows are kept forever (R-BTN-3).
    this.exec(`UPDATE messages SET status = 'expired' WHERE status IN ('pending','delivered')
               AND EXISTS (SELECT 1 FROM runners w WHERE w.id = messages.to_runner_id AND w.reaped_at IS NOT NULL)`);
  }

  // ── mode and shadow reports (R-BTN-28, §13 step 2) ──────────────────────────────────────

  /** `GET /v1/runner/mode?repository=` (§11): whether that repository has cut over. */
  mode(repo: string) {
    const at = this.rows<{ cutover_at: number | null }>('SELECT cutover_at FROM repositories WHERE id = ?', repo)[0]?.cutover_at ?? null;
    return at != null ? { mode: 'cut-over' as const, cutover_at: at } : { mode: 'shadow' as const };
  }

  /** `POST /v1/runner/shadow-report`: in shadow, `claim.sh` reports each git transition and
   *  Baton records it as a claim row, deciding nothing; a report the claim constraints refuse —
   *  a second active claim on the item or for the runner — is a `shadow-conflict` event. */
  shadowReport(runnerId: number, body: unknown) {
    const r = checkShadowReport(body);
    const repo = repositoryOf(r.ticket_id);
    if (!this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NULL', repo).length) throw new BatonError('invalid-params', 'ticket_id: not a registered repository’s ticket');
    if (this.mode(repo).mode !== 'shadow') throw new BatonError('forbidden', `${repo}'s shadow reports ended at its cutover`);
    const actor = `runner:${runnerId}`;
    const conflict = (reason: string) => {
      this.event('shadow-conflict', actor, { ...r, reason }, r.ticket_id);
      return { ok: true, conflict: reason };
    };
    const holder = this.rows<{ id: number; runner_id: number }>(`SELECT id, runner_id FROM claims WHERE ticket_id = ? AND status = 'active'`, r.ticket_id)[0];
    if (r.transition === 'claim') {
      if (holder && holder.runner_id === runnerId) {
        // A retried report (same nonce) is the same claim; another nonce is a second git claim.
        const same = this.rows('SELECT 1 FROM claims WHERE id = ? AND nonce = ?', holder.id, r.nonce).length;
        return same ? { ok: true, claim_id: holder.id } : conflict('already-held');
      }
      if (holder) return conflict(`held-by-runner:${holder.runner_id}`);
      const mine = this.activeClaim(runnerId);
      if (mine) return conflict(`runner-holds:${mine.ticket_id}`);
      const head = this.rows<{ sha: string | null }>('SELECT sha FROM board_head WHERE repository_id = ?', repo)[0]?.sha ?? '';
      // R-BTN-62: as any claim, judged only by a reading numbered after it.
      const { id } = this.exec<{ id: number }>(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, claim_observation, station, start_path, course_id)
                 VALUES (?, ?, ?, ?, ?, ?, 'active', COALESCE((SELECT last_handed_out FROM board_head WHERE repository_id = ?), 0),
                         COALESCE((SELECT station FROM ticket_stations WHERE ticket_id = ?), ''), COALESCE((SELECT path FROM ticket_stations WHERE ticket_id = ?), '[]'),
                         (SELECT course_id FROM tickets WHERE id = ?)) RETURNING id`,
        r.ticket_id, runnerId, `shadow:${runnerId}:${r.ticket_id}:${r.nonce}`, r.nonce!, head, r.at, repo, r.ticket_id, r.ticket_id, r.ticket_id).one();
      this.event('claimed', actor, { shadow: true, nonce: r.nonce }, r.ticket_id, id);
      this.c.held?.(r.ticket_id, true); // a claim's start is silent (R-BTN-77)
      return { ok: true, claim_id: id };
    }
    // `set`: in-progress and in-review keep the claim — in-review is an activity of an active
    // claim, which lasts through the gate and the merge (§6.5); any other status ends it.
    const keeps = r.status === 'in-progress' || r.status === 'in-review';
    if (!holder) return keeps ? conflict('no-claim') : { ok: true };
    if (holder.runner_id !== runnerId) return conflict(`held-by-runner:${holder.runner_id}`);
    if (keeps) return { ok: true, claim_id: holder.id };
    // R-BTN-62: the counter when it ended, as every end records.
    this.exec(`UPDATE claims SET status = 'released', ended_at = ?, end_reason = ?,
                 end_observation = COALESCE((SELECT last_handed_out FROM board_head WHERE repository_id = ?), 0) WHERE id = ?`,
      r.at, `shadow:${r.status}`, repo, holder.id);
    this.event('released', actor, { shadow: true, status: r.status }, r.ticket_id, holder.id);
    // The end leaves the ticket unheld: like every end it is never an unblocking, and one that
    // leaves the ticket blocked logs `blocked`, which wakes no one (R3-1254, B-26).
    this.c.held?.(r.ticket_id, false);
    return { ok: true, claim_id: holder.id };
  }

  /** A runner's declared courses (R-BTN-48) with each one's `min_runner_version` — only those
   *  below it (rule 9), or all of them for the Runners view. A course no repository registered
   *  has no minimum and is never stale. A runner that declares no course at all (a sidecar from
   *  before R-BTN-22's change) is stale on every registered course, its version `null`. */
  staleCourses(runnerId: number, all = false) {
    type Stale = { repository: string; course: string; version: number | null; min_runner_version: number | null };
    const declared = this.rows<Stale>(
      `SELECT f.repository_id AS repository, f.course_id AS course, f.version, c.min_runner_version
       FROM runner_courses f LEFT JOIN courses c ON c.repository_id = f.repository_id AND c.id = f.course_id
       WHERE f.runner_id = ? ORDER BY f.repository_id, f.course_id`, runnerId);
    if (all) return declared;
    if (!declared.length) {
      return this.rows<Stale>('SELECT repository_id AS repository, id AS course, NULL AS version, min_runner_version FROM courses ORDER BY repository_id, id');
    }
    return declared.filter((d) => d.min_runner_version != null && (d.version as number) < d.min_runner_version);
  }

  // ── the dashboard's Runners view (§14) ──────────────────────────────────────────────────

  /** Every runner row ever registered (R-BTN-3 keeps them) with its declarations, active
   *  claims, current activity, latest transcript and latest status report. B-250: one read per
   *  list, whatever the fleet's size — the per-runner loop this replaced ran about six queries
   *  for *every* runner, reaped ones included, ~1.9k statements a poll at 300 runners. Each
   *  read covers a set bounded without the runners' count — the declarations (R-BTN-149's
   *  retention prunes a runner unseen 30 days), the active claims (`claims_active_by_runner`)
   *  and open activities (`activities_open`) through their partial indexes, the status reports
   *  through 0063's `messages_reports` — or a table the per-runner reads already walked in sum
   *  (the transcripts: a latest-per-runner read keyed by `runner_id` costs the runners
   *  registered, the very count this view stops paying, so it walks the table once instead).
   *  The rows are grouped here to the order the per-runner reads served, and the latest of a
   *  list is kept in code by the key its per-runner `ORDER BY … LIMIT 1` broke ties on — the
   *  unique `received_at` of an activity, the unique `id` of a report, and, for the
   *  transcripts, the union read's own arrival order at their fold below. `runners` itself is
   *  read in its served order through 0063's `runners_by_hostname`: a sort reads every row
   *  twice on the Cloudflare host. */
  runnersView(now: number, page?: { repository: string; after: number; limit: number }) {
    const runners = this.rows<Row>(`SELECT id, hostname, session_name, harness, kind, isolation, model_id, tier_ceiling, tier_ceilings, lease_timeout_ms,
                                       first_seen_at, last_seen_at, last_activity_at, reaped_at, incarnation, profile_json, client_version, legacy_names_at FROM runners ${page ? `w WHERE w.id IN (SELECT DISTINCT runner_id FROM runner_courses WHERE repository_id = ? AND runner_id > ? ORDER BY runner_id LIMIT ?)
                                       ORDER BY w.id` : 'ORDER BY hostname, id'}`, ...(page ? [page.repository, page.after, page.limit] : []));
    const ids = JSON.stringify(runners.map((r) => r.id));
    if (!runners.length) return [];
    const capabilities = groupBy(this.rows(`SELECT runner_id, capability, declared FROM runner_capabilities${page ? ' WHERE runner_id IN (SELECT value FROM json_each(?))' : ''} ORDER BY capability`, ...(page ? [ids] : [])), 'runner_id');
    const courses = groupBy(this.rows(`SELECT f.runner_id, f.repository_id AS repository, f.course_id AS course, f.version, c.min_runner_version
                                       FROM runner_courses f LEFT JOIN courses c ON c.repository_id = f.repository_id AND c.id = f.course_id
                                       ${page ? 'WHERE f.runner_id IN (SELECT value FROM json_each(?))' : ''} ORDER BY f.repository_id, f.course_id`, ...(page ? [ids] : [])), 'runner_id');
    const claims = groupBy(this.rows(`SELECT runner_id, id, ticket_id, nonce, claimed_at FROM claims WHERE status = 'active'${page ? ' AND runner_id IN (SELECT value FROM json_each(?))' : ''} ORDER BY claimed_at, id`, ...(page ? [ids] : [])), 'runner_id');
    // §9.9: the newest open activity per runner — `received_at` breaks ties and is never served.
    const activity = new Map<number, { id: string; kind: string; label: string | null; started_at: number; claim_id: number | null; received_at: number }>();
    for (const a of this.rows<{ runner_id: number; id: string; kind: string; label: string | null; started_at: number; claim_id: number | null; received_at: number }>(
      `SELECT runner_id, id, kind, label, started_at, claim_id, received_at FROM activities WHERE ended_at IS NULL${page ? ' AND runner_id IN (SELECT value FROM json_each(?))' : ''}`, ...(page ? [ids] : []))) {
      const best = activity.get(a.runner_id);
      if (!best || a.started_at > best.started_at
        || (a.started_at === best.started_at && a.received_at > best.received_at)) activity.set(a.runner_id, a);
    }
    // §6.8: the latest transcript per runner, by the rule the per-runner union read settled
    // ties with. That read fed its `ORDER BY t DESC LIMIT 1` sorter the linked table's rows
    // first and each table in its autoindex's order — `(runner_id, repo, path, claim_id)`,
    // `(runner_id, repo, path)` — and a sorter keeps the first of a tie, so: a greater t wins,
    // a tie keeps a linked pointer over a pending one, and within one table the
    // lexicographically least (repo, path, claim_id). A first heartbeat reports several
    // pointers at one instant (they share its `first_seen_at`), so the tie is ordinary, and a
    // walk that kept the first row it saw — rowid order, not the autoindex's — would serve
    // another transcript_url than the per-runner read did. The fold below walks the linked
    // table first and replaces the kept pointer only at a strictly greater t or, same table
    // and instant, a lexicographically smaller (repo, path, claim_id): the old rule exactly.
    type Pointer = { runner_id: number; repo: string; path: string; claim_id: number; t: number; linked: boolean };
    const transcript = new Map<number, Pointer>();
    const latest = (r: Pointer) => {
      const best = transcript.get(r.runner_id);
      if (!best || r.t > best.t
        || (r.t === best.t && r.linked === best.linked
          && (r.repo < best.repo || (r.repo === best.repo && (r.path < best.path
            || (r.path === best.path && r.claim_id < best.claim_id)))))) transcript.set(r.runner_id, r);
    };
    for (const t of this.rows<{ runner_id: number; repo: string; path: string; claim_id: number; t: number }>(
      `SELECT runner_id, repo, path, claim_id, COALESCE(last_pushed_at, first_seen_at) AS t FROM transcripts${page ? " WHERE id IN (SELECT (SELECT t.id FROM transcripts t WHERE t.runner_id = j.value ORDER BY COALESCE(t.last_pushed_at, t.first_seen_at) DESC, t.repo, t.path, t.claim_id LIMIT 1) FROM json_each(?) j)" : ""}`, ...(page ? [ids] : []))) latest({ ...t, linked: true });
    for (const t of this.rows<{ runner_id: number; repo: string; path: string; t: number }>(
      `SELECT runner_id, repo, path, COALESCE(last_pushed_at, first_seen_at) AS t FROM pending_transcripts${page ? " WHERE rowid IN (SELECT (SELECT t.rowid FROM pending_transcripts t WHERE t.runner_id = j.value ORDER BY COALESCE(t.last_pushed_at, t.first_seen_at) DESC, t.repo, t.path LIMIT 1) FROM json_each(?) j)" : ""}`, ...(page ? [ids] : []))) latest({ ...t, claim_id: 0, linked: false });
    // §9: the latest status report per runner — `id` decides, never the scan's order.
    const reports = new Map<number, { payload_json: string | null; sent_at: number; id: number }>();
    for (const m of this.rows<{ runner_id: number; id: number; payload_json: string | null; sent_at: number }>(
      `SELECT from_runner_id AS runner_id, id, payload_json, sent_at FROM messages WHERE ${page ? "id IN (SELECT (SELECT m.id FROM messages m WHERE m.kind = 'status_report' AND m.from_runner_id = j.value ORDER BY m.id DESC LIMIT 1) FROM json_each(?) j)" : "kind = 'status_report'"}`, ...(page ? [ids] : []))) {
      const best = reports.get(m.runner_id);
      if (!best || m.id > best.id) reports.set(m.runner_id, m);
    }
    return runners.map((w) => {
      const id = w.id as number;
      const alive = w.reaped_at == null && now - (w.last_seen_at as number) < (w.lease_timeout_ms as number);
      const claimsList = claims.get(id) ?? [];
      const a = activity.get(id);
      const t = transcript.get(id);
      const report = reports.get(id);
      return {
        ...w,
        tier_ceilings: JSON.parse(w.tier_ceilings as string) as Record<string, string>,
        // B-253 (R-BTN-72): the runner's own opaque statement, stored as received — its `cli`
        // key names the CLI's pinning. NULL until a heartbeat carried one.
        profile: w.profile_json == null ? null : JSON.parse(w.profile_json as string) as Record<string, unknown>,
        alive,
        capabilities: capabilities.get(id) ?? [],
        courses: courses.get(id) ?? [],
        // R-BTN-4 (B-188): every claim the runner holds; `claim`, the oldest, for readers before it.
        claims: claimsList,
        claim: claimsList[0] ?? null,
        activity: a == null ? null : { id: a.id, kind: a.kind, label: a.label, started_at: a.started_at, claim_id: a.claim_id },
        // §6.8: built only as a blob link from validated parts, never a reported URL.
        transcript_url: t ? transcriptUrl(t.repo, t.path) : null,
        last_report: report == null ? null : { payload_json: report.payload_json, sent_at: report.sent_at },
      };
    });
  }

  /** R-BTN-197 (B-254): Needs you's runners below the recommended client — each live runner
   *  whose own statement (`client_version`, its last call's `Baton-Client`) is below
   *  `recommended`, with its version, folded out of the Runners view's own read so the state
   *  read costs no statement of its own for it (B-240's budget). A runner that named no version
   *  said nothing to compare and is not listed; liveness is the Runners view's own rule
   *  (`reaped_at` clear and the lease un-lapsed). */
  staleClients(runners: ({ alive: boolean } & Record<string, unknown>)[], recommended: string) {
    return runners
      .filter((w) => w.client_version != null && w.kind !== 'legacy' && w.alive && compareVersions(w.client_version as string, recommended) < 0)
      .map((w) => ({ hostname: w.hostname, session_name: w.session_name, client_version: w.client_version, recommended }));
  }
}
