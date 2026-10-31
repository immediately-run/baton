// admin.ts — Baton's administration, the one set of validated functions behind `/v1/admin/*`,
// `/v1/owner/{repository}/*` and `POST /v1/login`, which `baton admin` and `baton owner` call on
// either host (BATON_SPEC §10.6 R-BTN-57/-58, R-BTN-66/-67, R-BTN-16). Every limit the owners
// need to hold against agents lives here, in SQLite, set by an administrator's or an owner's key:
// grants, owners, owner bars and the settings — never read from a board post. Administrators are
// BATON_ADMIN_KEYS alone. One key holds one role: administrator, owner, worker, probe, courier or
// sync key. Each act is an `admin` event; a bar change also dispatches the repository's sync.
import { BatonError, SESSION_COOKIE } from './http';
import { logEvent, randomHex } from './db';
import { API_KEY_FINGERPRINT, KEY_FINGERPRINT, parseApiKeyLine, parseSshKey, verifyNamespacedSignature, type SshKey } from './auth';
import { capabilitiesOf } from '../shared/vocabulary.mjs';
import { COURSE_ID, HOSTNAME, INSTANCE_NAME, TAG, checkAsks, checkRepositoryId, HOLDING_TYPE } from './validate';
import { REMIND_AFTER_S, type Notices } from './notices';
import { parseTranscriptRepo } from './links';
import { checkRegistration, seedEntries, tierPosition, type Registration, type Registry } from './registry';
import { graphOf, resolveLeg, type Graph } from './graph';
import type { ApproverEntry, ApproverFacts, Policies } from './policy';
import type { Config, Store } from './ports';
import { sha256Hex } from './workerApi';

/** A one-time link lives 5 minutes; a session 12 hours (R-BTN-57). */
export const LOGIN_LINK_MS = 5 * 60_000;
export const SESSION_MS = 12 * 3_600_000;
/** R-BTN-16: the one cookie Baton sets. */
export { SESSION_COOKIE };
/** Spec-silent bounds (recorded on R3-1240): owner bars in force per repository, required bars,
 *  legs per bar, owners per repository, capabilities per grant, backoffs per retry policy. */
const BARS_MAX = 200;
const REQUIRED_BARS_MAX = 32;
const LEGS_MAX = 64;
const OWNERS_MAX = 16;
const CAPABILITIES_MAX = 64;
const BACKOFFS_MAX = 8;
/** A registered repository's fields §11's change form may set besides weight, tiers and keys. */
const LINK_FIELDS = ['remote', 'web_base', 'ci_identity', 'sync_workflow', 'mirror_workflow'] as const;
/** A capability or role name, as a heartbeat declares one. */
const CAPABILITY = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A login link's token and a session's value: 32 random bytes, hex. */
const TOKEN = /^[0-9a-f]{64}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,99}$/;

export interface RequiredBar {
  course: string;
  leg: string;
  except?: string[];
  tag_prefix: string;
}

export interface RetryPolicy {
  backoff_ms: number[];
  max_failed: number;
}

export interface OwnerBar {
  id: number;
  repository_id: string;
  course: string;
  tag: string;
  legs: string[];
  applies: 'claim' | 'claim+advance';
  starts_at: number;
  ends_at: number | null;
  release_holders: boolean;
  reason: string;
}

const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};
/** A key's fingerprint as a path or body names it, checked before any SQL (§10.4; round 2, 2-A-3). */
const fingerprintOf = (v: unknown, field: string): string => (typeof v === 'string' && (KEY_FINGERPRINT.test(v) || API_KEY_FINGERPRINT.test(v)) ? v : bad(field, 'must be a key fingerprint, SHA256:… or bak_…'));
/** A bearer-token credential's id (CREDENTIALS' keys). */
const TOKEN_CREDENTIAL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (b: Record<string, unknown>, keys: string[], at: string) => {
  for (const k of Object.keys(b)) if (!keys.includes(k)) bad(`${at}.${k}`, 'unknown field');
};
/** A key's stored line: its type and base64 only — a comment is for people, never stored. */
const lineOf = (key: SshKey, text: string) => `${key.type} ${text.trim().split(/\s+/)[1]}`;

/** R-BTN-67: an owner bar's reason becomes `released:<reason>`; never one of §6.5's closed
 *  reasons, so an owner bar's release is never counted as a failed attempt (§6.10). */
export function isOwnerBarReason(r: unknown): r is string {
  return typeof r === 'string' && COURSE_ID.test(r) && !(CLOSED_RELEASE_REASONS as readonly string[]).includes(r) && !r.startsWith('cannot-finish');
}
/** §6.5's closed release reasons, which an owner bar's never is. `provider-suspended` is not one:
 *  R-BTN-67 gives it as an owner bar's own reason (round 2, 2-A-0). */
const CLOSED_RELEASE_REASONS = ['done', 'stale-board', 'cannot-finish', 'lease-lost', 'requested', 'owner-cancel', 'course-changed', 'leg-timeout', 'awaiting-review-capacity', 'provider-exhausted'] as const;

/** Whether `tags` meet a required bar: one of them starts with its prefix (R-BTN-67). */
export const meetsRequiredBar = (bar: RequiredBar, tags: string[]) => tags.some((t) => t.startsWith(bar.tag_prefix));

/** A required bar covers a leg of a course (R-BTN-67): its course, or `*`; its named leg —
 *  followed through `renamed_from` in the course's file — or every leg but those in `except`. */
export function requiredBarCovers(bar: RequiredBar, course: string, leg: string, g: Graph | null): boolean {
  if (bar.course !== '*' && bar.course !== course) return false;
  const name = (n: string) => (g ? resolveLeg(g, n) ?? n : n);
  if (bar.leg !== '*') return name(bar.leg) === leg;
  return !(bar.except ?? []).some((e) => name(e) === leg);
}

export class Admin {
  constructor(private readonly c: {
    store: Store;
    now: () => number;
    registry: Registry;
    /** BATON_ADMIN_KEYS' lines, read on every call (a key that leaves ends its sessions). */
    adminKeys: () => string[];
    origin: string;
    /** R-BTN-67: a bar change dispatches the repository's sync, after commit. */
    dispatchSync: (repository: string) => void;
    /** R-BTN-75, R-BTN-76: a grant made, changed or revoked moves the fleet's counts. */
    fleetChanged?: () => void;
    /** R-BTN-80: a courier registered or revoked queues or closes its notices. */
    notices?: Notices;
    /** §12.8 (B-145): the repository policies — the approver lists the owner routes read. */
    policies?: Policies;
    /** R-BTN-185 (B-145): BATON_HUMAN_KEYS' fingerprints (break-glass), parsed per call. */
    humanBreakGlass?: () => Promise<Map<string, string>>;
  }) {}

  private rows<T = Record<string, unknown>>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }
  private exec(q: string, ...p: unknown[]) {
    return this.c.store.exec(q, ...p);
  }
  /** Rows the last statement changed (SQLite's `changes()`, the same on both hosts). */
  private changed(): number {
    return this.rows<{ n: number }>('SELECT changes() AS n')[0].n;
  }
  private event(actor: string, detail: Record<string, unknown>, repository: string | null) {
    logEvent(this.c.store, this.c.now(), 'admin', actor, detail, null, null, repository);
  }

  // ── principals ──────────────────────────────────────────────────────────────────────────

  /** The administrators' keys by fingerprint (R-BTN-57). An unparsable line is no key. */
  async adminFingerprints(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const line of this.c.adminKeys()) {
      // An API key's public line (R-BTN-159) or an OpenSSH public key.
      const api = parseApiKeyLine(line);
      if (api) {
        out.set(api.fingerprint, api.line);
        continue;
      }
      try {
        const k = await parseSshKey(line);
        out.set(k.fingerprint, lineOf(k, line));
      } catch {
        // A line that is no key admits nobody.
      }
    }
    return out;
  }

  /** An owner key's line by fingerprint, if it owns any repository (R-BTN-58). */
  ownerKey(fingerprint: string): string | null {
    return this.rows<{ public_key: string }>('SELECT public_key FROM repository_owners WHERE fingerprint = ? AND removed_at IS NULL LIMIT 1', fingerprint)[0]?.public_key ?? null;
  }

  /** Whether `fingerprint` owns `repository` now. */
  owns(fingerprint: string, repository: string): boolean {
    return this.rows('SELECT 1 FROM repository_owners WHERE fingerprint = ? AND repository_id = ? AND removed_at IS NULL', fingerprint, repository).length > 0;
  }

  /** R-BTN-57: the role a key already holds, if any — one role per key. */
  private roleOf(fingerprint: string, admins: Map<string, string>): string | null {
    if (admins.has(fingerprint)) return 'administrator';
    if (this.rows('SELECT 1 FROM repository_owners WHERE fingerprint = ? AND removed_at IS NULL', fingerprint).length) return 'owner';
    if (this.rows('SELECT 1 FROM sync_keys WHERE fingerprint = ?', fingerprint).length) return 'sync';
    const c = this.rows<{ kind: string }>('SELECT kind FROM credentials WHERE id = ?', fingerprint)[0];
    return c ? c.kind : null;
  }

  /** Whether an administrator revoked `fingerprint` as an owner key, on any repository (R-BTN-57):
   *  the route refuses it (`mayOwn`), the seed skips it (`seedOwners`). */
  private revokedOwner(fingerprint: string): boolean {
    return this.rows('SELECT 1 FROM repository_owners WHERE fingerprint = ? AND revoked_at IS NOT NULL', fingerprint).length > 0;
  }

  /** Whether `fingerprint` may become an owner of `repository` (null: a new one): no other role
   *  (R-BTN-57), and not an owner key an administrator revoked — another owner never brings it
   *  back (round 1, 1-A-3). Throws `conflict`. */
  private mayOwn(fingerprint: string, admins: Map<string, string>) {
    if (this.revokedOwner(fingerprint)) throw new BatonError('conflict', 'this owner key was revoked; its holder needs a new key');
    const role = this.roleOf(fingerprint, admins);
    if (role && role !== 'owner') throw new BatonError('conflict', `this key is already a ${role} key (R-BTN-57: one role per key)`);
  }

  // ── the policy's approver lists (R-BTN-188, R-BTN-185; B-145 items 11 and 12) ──────────

  /** Every fingerprint that counts as a human-only key: the tenant's registered ones and the
   *  host's BATON_HUMAN_KEYS lines (break-glass). Parsed per call, like the administrators'. */
  private async humanMarks(): Promise<Set<string>> {
    const out = new Set(this.rows<{ fingerprint: string }>('SELECT fingerprint FROM human_keys WHERE revoked_at IS NULL').map((r) => r.fingerprint));
    for (const fp of await this.breakGlassSet()) out.add(fp);
    return out;
  }

  /** BATON_HUMAN_KEYS' fingerprints alone — the break-glass set (R-BTN-185). */
  private async breakGlassSet(): Promise<Set<string>> {
    return new Set(this.c.humanBreakGlass ? (await this.c.humanBreakGlass()).keys() : []);
  }

  /** B-145 item 12: membership through `approvers.members` — the one authorisation hook for
   *  adding and removing owners, granting and revoking runner keys, and registering couriers,
   *  none of them a plain owner action any more. An owner key matches the list in force; an
   *  administrator passes a list that is not human-only (the deployment's root), and a
   *  human-only one only with a break-glass key — R-BTN-185: an action whose list is human-only
   *  is a human gate, for administrators too. A delegated key never gets here: none is
   *  registered yet (B-124), and its class will answer before this runs. */
  private requireMembersApprover(repository: string, fingerprint: string, by: 'owner' | 'admin', breakGlass: ReadonlySet<string>): void {
    const policies = this.c.policies;
    if (!policies) return; // no policy store wired (a unit test's Admin)
    const cur = policies.current(repository);
    if (!cur) return;
    const facts = policies.facts(repository, breakGlass);
    const list: ApproverEntry[] = cur.policy.approvers.members;
    if (policies.entryMatches(list, fingerprint, facts, cur.policy.human_key)) return;
    const humanOnly = list.every((e) => e === 'human' || (e.startsWith('key:') && facts.humans.has(e.slice(4))));
    if (by === 'admin' && !humanOnly) return;
    throw new BatonError('forbidden', `this credential is not an approver on approvers.members (${list.join(', ')}) (R-BTN-188)`);
  }

  /** R-BTN-188's no-gate-without-a-key, on removing an owner or revoking a key: the lists that
   *  would be left with no key to open them — not just now but ever — are refused. An `owner`
   *  entry is always openable again (the administrator's owner route can add one, B-91's
   *  repair of an ownerless repository); a `human` entry is openable while break-glass exists
   *  (without it, no first human key can ever be registered, R-BTN-185); a `key:` entry is
   *  openable only while its key stays a live owner. `approvers.policy` and a floor's
   *  `remove_by` are what this guards: nothing else can rewrite them. */
  private refuseUnsatisfiableLists(repository: string, facts: ApproverFacts): void {
    const policies = this.c.policies;
    if (!policies) return;
    const cur = policies.current(repository);
    if (!cur) return;
    if (!policies.listSatisfiable(cur.policy.approvers.policy, facts, cur.policy.human_key)
      && !policies.listRecoverable(cur.policy.approvers.policy, facts)) {
      throw new BatonError('unsatisfiable-approvers', 'approvers.policy: this would leave no credential, now or later, able to satisfy it, and no other route can change the policy (R-BTN-188)', { list: 'approvers.policy' });
    }
    for (const floor of policies.floors(repository)) {
      if (floor.remove_by === 'human' && !policies.listSatisfiable(['human'], facts, cur.policy.human_key) && !policies.listRecoverable(['human'], facts)) {
        throw new BatonError('unsatisfiable-approvers', `floor ${floor.name}'s remove_by: human would have no credential, now or later, able to satisfy it (R-BTN-188)`, { list: `floor:${floor.name}` });
      }
    }
  }

  /** The approver facts of `repository` with only `remaining` owners counted. */
  private async factsWithout(repository: string, remaining: string[] | null): Promise<ApproverFacts> {
    const policies = this.c.policies;
    if (!policies) return { owners: new Map(), humans: new Set(), breakGlass: new Set() };
    const breakGlass = this.c.humanBreakGlass ? new Set((await this.c.humanBreakGlass()).keys()) : new Set<string>();
    const facts = policies.facts(repository, breakGlass);
    if (remaining == null) return facts;
    return { owners: new Map([...facts.owners].filter(([fp]) => remaining.includes(fp))), humans: facts.humans, breakGlass };
  }

  // ── administrators (R-BTN-57) ───────────────────────────────────────────────────────────

  /** `POST /v1/admin/repositories`: register one with its first owner keys, change one (never its
   *  forge or forge path, R-BTN-92), or retire one. */
  async repositories(actor: string, body: unknown) {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    const id = checkRepositoryId(b.id, 'id');
    const known = this.c.registry.get(id);
    if (b.retire === true) {
      only(b, ['id', 'retire'], 'body');
      if (!known) throw new BatonError('not-found', `${id} is not registered`);
      this.c.store.transaction(() => {
        this.exec('UPDATE repositories SET retired_at = ? WHERE id = ? AND retired_at IS NULL', this.c.now(), id);
        this.event(actor, { act: 'repository-retired', repository: id }, id);
      });
      return { ok: true };
    }
    if (!known) {
      const owners = await this.ownerKeys(b.owner_keys, 'owner_keys');
      if (!owners.length) bad('owner_keys', 'a repository is registered with at least one owner key');
      const { owner_keys: _o, ...registration } = b;
      const admins = await this.adminFingerprints();
      // R-BTN-185: an owner key the tenant knows as human-only (a registered human key, or a
      // BATON_HUMAN_KEYS line) is stored with its mark.
      const marks = await this.humanMarks();
      for (const o of owners) this.mayOwn(o.fingerprint, admins);
      // One role per key (R-BTN-57): a key named both as owner and as sync key is refused before
      // either is written — registerWithKeys commits the sync keys in a transaction of its own.
      const syncKeys = Array.isArray(registration.sync_keys) ? registration.sync_keys : [];
      for (const k of syncKeys) {
        const line = isObj(k) && typeof k.public_key === 'string' ? k.public_key : null;
        const fp = line ? (await parseSshKey(line).catch(() => null))?.fingerprint : null;
        if (fp && owners.some((o) => o.fingerprint === fp)) throw new BatonError('conflict', 'a key is named both as an owner key and as a sync key (R-BTN-57)');
      }
      // registerWithKeys runs its own transaction; the owners follow in another, after it.
      await this.c.registry.registerWithKeys(registration, actor, this.c.adminKeys());
      this.c.store.transaction(() => {
        for (const o of owners) {
          this.mayOwn(o.fingerprint, admins);
          this.insertOwner(id, o, actor, marks.has(o.fingerprint) ? 1 : 0);
        }
        this.event(actor, { act: 'repository-registered', repository: id, owners: owners.map((o) => o.fingerprint) }, id);
      });
      return { ok: true };
    }
    return this.changeRepository(actor, id, b);
  }

  /** A change to a registered repository: its weight and tiers (the tickets' positions follow),
   *  its sync keys, and — for a repository registered before owners existed (BATON_REPOSITORIES'
   *  seed; spec-silent, recorded on R3-1240) — owner keys. Everything else is its registration's. */
  private async changeRepository(actor: string, id: string, b: Record<string, unknown>) {
    only(b, ['id', 'weight', 'tiers', 'sync_keys_add', 'sync_keys_remove', 'owner_keys_add', ...LINK_FIELDS], 'body');
    // A change names something to change; an empty one is a caller's mistake (round 3, 3-A-1).
    if (Object.keys(b).length === 1) bad('body', 'a change names at least one field besides id');
    const newOwners = b.owner_keys_add === undefined ? [] : await this.ownerKeys(b.owner_keys_add, 'owner_keys_add');
    // R-BTN-185: the same mark for keys an administrator adds later.
    const marks = newOwners.length ? await this.humanMarks() : new Set<string>();
    const weight = b.weight === undefined ? undefined
      : Number.isInteger(b.weight) && (b.weight as number) >= 0 && (b.weight as number) <= 10_000 ? (b.weight as number) : bad('weight', 'must be an integer from 0 to 10000');
    const tiers = b.tiers === undefined ? undefined
      : Array.isArray(b.tiers) && b.tiers.length >= 1 && b.tiers.length <= 16 && b.tiers.every((t) => typeof t === 'string' && COURSE_ID.test(t)) && new Set(b.tiers).size === b.tiers.length
        ? (b.tiers as string[]) : bad('tiers', 'must be 1–16 distinct tier names, lowest first');
    const add = b.sync_keys_add === undefined ? [] : Array.isArray(b.sync_keys_add) && b.sync_keys_add.length <= 4 && b.sync_keys_add.every((k) => isObj(k) && typeof k.public_key === 'string' && ['sync', 'mirror'].includes(k.role as string))
      ? (b.sync_keys_add as { public_key: string; role: 'sync' | 'mirror' }[]) : bad('sync_keys_add', 'must be at most 4 {public_key, role: sync|mirror}');
    const remove = b.sync_keys_remove === undefined ? [] : Array.isArray(b.sync_keys_remove) && b.sync_keys_remove.length <= 4
      ? b.sync_keys_remove.map((f, i) => fingerprintOf(f, `sync_keys_remove[${i}]`)) : bad('sync_keys_remove', 'must be at most 4 fingerprints');
    // §11's remote, web_base, ci_identity and workflows: the whole registration they leave behind is
    // checked as a registration is — never the forge or forge path (R-BTN-92; round 2, 2-A-4).
    let linked: Registration | null = null;
    if (LINK_FIELDS.some((k) => b[k] !== undefined)) {
      const cur = this.c.registry.get(id)!;
      const keys = [
        ...this.rows<{ fingerprint: string; public_key: string; role: 'sync' | 'mirror' }>('SELECT fingerprint, public_key, role FROM sync_keys WHERE repository_id = ? AND revoked_at IS NULL', id)
          .filter((k) => !remove.includes(k.fingerprint)).map(({ public_key, role }) => ({ public_key, role })),
        ...add,
      ];
      const current = { id, github: cur.github, forge: cur.forge, remote: cur.remote, ...(cur.web_base != null ? { web_base: cur.web_base } : {}), ci_identity: cur.ci_identity,
        default_branch: cur.default_branch, sync_workflow: cur.sync_workflow || null, mirror_workflow: cur.mirror_workflow, sync_keys: keys };
      linked = checkRegistration({ ...current, ...Object.fromEntries(LINK_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]])) }, 'body');
    }
    // Every check before any write: the sync keys commit in transactions of their own, so a
    // refusal after them would leave the change half applied.
    const admins = await this.adminFingerprints();
    for (const o of newOwners) this.mayOwn(o.fingerprint, admins);
    const addKeys = await Promise.all(add.map((k) => parseSshKey(k.public_key)));
    for (const key of addKeys) {
      if (this.roleOf(key.fingerprint, admins)) throw new BatonError('conflict', `${key.fingerprint} already holds a role (R-BTN-57)`);
      if (newOwners.some((o) => o.fingerprint === key.fingerprint)) throw new BatonError('conflict', 'a key is named both as an owner key and as a sync key (R-BTN-57)');
    }
    for (const k of add) await this.c.registry.addSyncKey(id, k.public_key, k.role, actor, this.c.adminKeys());
    // The ladder a grant's max_tier was a position in, read before the new one is written.
    const old = this.c.registry.get(id)!.tiers;
    this.c.store.transaction(() => {
      for (const o of newOwners) {
        if (this.owns(o.fingerprint, id)) continue;
        this.mayOwn(o.fingerprint, admins);
        this.insertOwner(id, o, actor, marks.has(o.fingerprint) ? 1 : 0);
      }
      if (weight !== undefined) this.exec('UPDATE repositories SET weight = ? WHERE id = ?', weight, id);
      if (tiers) {
        this.exec('UPDATE repositories SET tiers = ? WHERE id = ?', JSON.stringify(tiers), id);
        // A ticket's tier is matched as its position in the ladder (R-BTN-66): recompute them.
        for (const t of this.rows<{ id: string; tier: string | null }>('SELECT id, tier FROM tickets WHERE repository_id = ?', id)) {
          this.exec('UPDATE tickets SET tier_position = ? WHERE id = ?', tierPosition(tiers, t.tier), t.id);
        }
        // A grant's max_tier was a position in the old ladder: kept by name where the new one has it.
        for (const g of this.rows<{ credential_id: string; max_tier: number | null }>('SELECT credential_id, max_tier FROM worker_grants WHERE repository_id = ? AND max_tier IS NOT NULL', id)) {
          const name = old[g.max_tier!];
          this.exec('UPDATE worker_grants SET max_tier = ? WHERE credential_id = ? AND repository_id = ?', name && tiers.includes(name) ? tiers.indexOf(name) : 0, g.credential_id, id);
        }
      }
      for (const fp of remove) this.exec('UPDATE sync_keys SET revoked_at = ? WHERE fingerprint = ? AND repository_id = ? AND revoked_at IS NULL', this.c.now(), fp, id);
      if (linked) {
        this.exec('UPDATE repositories SET remote = ?, web_base = ?, ci_identity = ?, sync_workflow = ?, mirror_workflow = ?, dispatch = ? WHERE id = ?',
          linked.remote, linked.web_base, linked.ci_identity ? JSON.stringify(linked.ci_identity) : null, linked.sync_workflow, linked.mirror_workflow,
          // The App serves github.com alone, as at registration.
          linked.forge === 'github' && linked.web_base?.toLowerCase() === `https://github.com/${linked.github.toLowerCase()}` ? '{"kind":"github-app"}' : null, id);
      }
      this.event(actor, { act: 'repository-changed', repository: id, ...(weight !== undefined ? { weight } : {}), ...(tiers ? { tiers } : {}),
        ...(add.length ? { sync_keys_added: add.length } : {}), ...(remove.length ? { sync_keys_removed: remove } : {}),
        ...(newOwners.length ? { owners_added: newOwners.map((o) => o.fingerprint) } : {}),
        ...(linked ? Object.fromEntries(LINK_FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, (linked as unknown as Record<string, unknown>)[k]])) : {}) }, id);
    });
    return { ok: true };
  }

  /** BATON_REPOSITORIES' `owner_keys` at start (B-91; R-BTN-47, R-BTN-58), read and parsed before
   *  the seed registers anything: each entry's keys as the administrator's route reads `owner_keys`
   *  (`ownerKeys`; at least one where the field is given), so a malformed key stops the start
   *  before any entry registers. `seedOwners` writes what this returns. */
  async readSeedOwners(config: Config): Promise<{ id: string; keys: { fingerprint: string; line: string }[] }[]> {
    const out: { id: string; keys: { fingerprint: string; line: string }[] }[] = [];
    for (const { entry, r: { id }, at } of seedEntries(config)) {
      const v = (entry as Record<string, unknown>).owner_keys;
      if (v === undefined) continue;
      const keys = await this.ownerKeys(v, `${at}.owner_keys`);
      if (!keys.length) bad(`${at}.owner_keys`, 'names at least one key, or is left out');
      out.push({ id, keys });
    }
    return out;
  }

  /** The seed's owner keys written (B-91), after the seed and its sync keys: each entry's keys are
   *  its repository's owners, `added_by: 'admin:seed'`, written only where that repository has no
   *  live owner and is not retired — so a registration that has owners keeps them. Every key of
   *  every entry is checked as the route checks an owner (`mayOwn`, R-BTN-57), owned repository or
   *  not, and the whole pass is one transaction: a key that holds another role stops the start
   *  with nothing written. A key an administrator revoked is skipped, never written and never a
   *  stop — a revocation after the seed was written must not take the instance down (the owner,
   *  2026-10-27); a repository it leaves with no owner is named in `seed_owners`. */
  async seedOwners(entries: { id: string; keys: { fingerprint: string; line: string }[] }[]): Promise<void> {
    if (!entries.length) return;
    const admins = await this.adminFingerprints();
    this.c.store.transaction(() => {
      for (const { id, keys } of entries) {
        const write = !this.rows('SELECT 1 FROM repository_owners WHERE repository_id = ? AND removed_at IS NULL', id).length
          && !this.rows('SELECT 1 FROM repositories WHERE id = ? AND retired_at IS NOT NULL', id).length;
        for (const key of keys) {
          if (this.revokedOwner(key.fingerprint)) continue;
          this.mayOwn(key.fingerprint, admins);
          if (write) this.insertOwner(id, key, 'admin:seed');
        }
      }
    });
  }

  /** `POST /v1/admin/probes`: a probe key with its label. Since R-BTN-101 a probe reports on any
   *  registered instance: `instances` is still taken, for the CLI that sends it, and ignored —
   *  `allowed_instances` is written `[]`. */
  async addProbe(actor: string, body: unknown) {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    only(b, ['public_key', 'label', 'instances'], 'body');
    const key = await this.parseKey(b.public_key, 'public_key');
    const label = typeof b.label === 'string' && LABEL.test(b.label) ? b.label : bad('label', 'must be a short label');
    if (b.instances !== undefined && !(Array.isArray(b.instances) && b.instances.length <= 64 && b.instances.every((i) => typeof i === 'string' && INSTANCE_NAME.test(i)))) {
      bad('instances', 'must be at most 64 instance names');
    }
    const admins = await this.adminFingerprints();
    this.c.store.transaction(() => {
      const role = this.roleOf(key.fingerprint, admins);
      if (role) throw new BatonError('conflict', `this key is already a ${role} key (R-BTN-57: one role per key)`);
      this.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by, label, allowed_instances) VALUES (?, ?, '[]', 'probe', ?, ?, ?, ?)`,
        key.fingerprint, `probe:${key.fingerprint}`, key.line, actor, label, '[]');
      this.event(actor, { act: 'probe-added', key: key.fingerprint, label }, null);
    });
    return { ok: true };
  }

  /** `POST /v1/admin/keys/{fingerprint}/revoke`: any key, at once — a worker, probe or courier
   *  credential, a sync key, or an owner key on every repository it owns. A worker's grants go
   *  with it, so its next call is refused. An administrator key is revoked by editing the secret.
   *  R-BTN-188 (B-145): refused while an approver list or a floor's `remove_by` the key alone
   *  satisfies would be left with no live credential. */
  async revokeKey(actor: string, raw: string) {
    // A key's fingerprint, or a bearer-token credential's id while tokens serve (R3-1239).
    const fingerprint = KEY_FINGERPRINT.test(raw) || TOKEN_CREDENTIAL.test(raw) ? raw : bad('fingerprint', 'must be a key fingerprint, SHA256:…, or a token credential’s id');
    // The pool's reserved credential has no key to revoke (R-BTN-103).
    if (fingerprint === 'pool') bad('fingerprint', 'pool is reserved for worker couriers’ pool copies, not a key');
    for (const { repository_id } of this.rows<{ repository_id: string }>('SELECT DISTINCT repository_id FROM repository_owners WHERE fingerprint = ? AND removed_at IS NULL', fingerprint)) {
      const facts = await this.factsWithout(repository_id, null);
      this.refuseUnsatisfiableLists(repository_id, { owners: new Map([...facts.owners].filter(([fp2]) => fp2 !== fingerprint)), humans: facts.humans, breakGlass: facts.breakGlass });
    }
    return this.c.store.transaction(() => {
      const now = this.c.now();
      // `revoked_by` keeps an administrator's revoke through a later CREDENTIALS/TOKEN_HASHES edit (round 2, 2-A-2).
      this.exec('UPDATE credentials SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL', now, actor, fingerprint);
      let changed = this.changed();
      // A credential already revoked otherwise — a courier key whose last registration its owners
      // ended — becomes the administrator's revoke too, so no owner can bring it back (R-BTN-80).
      this.exec(`UPDATE credentials SET revoked_by = ? WHERE id = ? AND revoked_at IS NOT NULL AND (revoked_by IS NULL OR revoked_by NOT LIKE 'admin:%')`, actor, fingerprint);
      changed += this.changed();
      this.exec('UPDATE worker_grants SET revoked_at = ? WHERE credential_id = ? AND revoked_at IS NULL', now, fingerprint);
      this.exec('UPDATE sync_keys SET revoked_at = ? WHERE fingerprint = ? AND revoked_at IS NULL', now, fingerprint);
      changed += this.changed();
      this.exec('UPDATE repository_owners SET removed_at = coalesce(removed_at, ?), revoked_at = ? WHERE fingerprint = ? AND revoked_at IS NULL', now, now, fingerprint);
      changed += this.changed();
      // A courier key's registrations go with it, and its notices close (R-BTN-80).
      this.exec('DELETE FROM couriers WHERE credential_id = ?', fingerprint);
      this.c.notices?.revoked(fingerprint, null);
      if (!changed && !this.rows('SELECT 1 FROM credentials WHERE id = ? UNION SELECT 1 FROM sync_keys WHERE fingerprint = ? UNION SELECT 1 FROM repository_owners WHERE fingerprint = ?', fingerprint, fingerprint, fingerprint).length) {
        throw new BatonError('not-found', 'no key with that fingerprint');
      }
      this.event(actor, { act: 'key-revoked', key: fingerprint }, null);
      this.c.fleetChanged?.();
      return { ok: true };
    });
  }

  /** `POST /v1/admin/login-links`: a one-time dashboard link, its token in the fragment so it never
   *  reaches a log; valid 5 minutes, single use. */
  async loginLink(adminFingerprint: string) {
    const token = randomHex(32);
    const hash = await sha256Hex(token);
    this.c.store.transaction(() => {
      this.exec('DELETE FROM login_links WHERE expires_at < ?', this.c.now() - LOGIN_LINK_MS);
      this.exec('INSERT INTO login_links (token_hash, admin_key, expires_at) VALUES (?, ?, ?)', hash, adminFingerprint, this.c.now() + LOGIN_LINK_MS);
      this.event(`admin:${adminFingerprint}`, { act: 'login-link' }, null);
    });
    return { url: `${this.c.origin}/login#${token}` };
  }

  /** `POST /v1/login {token}`: marks the link used and opens a session, returning the cookie's
   *  value — only while the key that minted the link is still an administrator. */
  async login(body: unknown): Promise<string> {
    const token = isObj(body) && typeof body.token === 'string' && TOKEN.test(body.token) ? body.token : bad('token', 'must be the link’s token');
    const hash = await sha256Hex(token);
    const admins = await this.adminFingerprints();
    const value = randomHex(32);
    const id = await sha256Hex(value);
    return this.c.store.transaction(() => {
      const now = this.c.now();
      const link = this.rows<{ admin_key: string; expires_at: number; used_at: number | null }>('SELECT admin_key, expires_at, used_at FROM login_links WHERE token_hash = ?', hash)[0];
      if (!link || link.used_at != null || link.expires_at <= now || !admins.has(link.admin_key)) throw new BatonError('unauthenticated', 'the link is used, expired or unknown');
      this.exec('UPDATE login_links SET used_at = ? WHERE token_hash = ?', now, hash);
      this.exec('DELETE FROM dashboard_sessions WHERE expires_at < ?', now - SESSION_MS);
      this.exec('INSERT INTO dashboard_sessions (id_hash, admin_key, created_at, expires_at) VALUES (?, ?, ?, ?)', id, link.admin_key, now, now + SESSION_MS);
      return value;
    });
  }

  /** The administrator a dashboard session cookie stands for, or null: a live, unrevoked session
   *  whose key is still in BATON_ADMIN_KEYS — checked on every request. */
  async session(value: string | null): Promise<string | null> {
    if (!value || !TOKEN.test(value)) return null;
    const id = await sha256Hex(value);
    const s = this.rows<{ admin_key: string; expires_at: number; revoked_at: number | null }>('SELECT admin_key, expires_at, revoked_at FROM dashboard_sessions WHERE id_hash = ?', id)[0];
    if (!s || s.revoked_at != null || s.expires_at <= this.c.now()) return null;
    return (await this.adminFingerprints()).has(s.admin_key) ? s.admin_key : null;
  }

  // ── grants (R-BTN-58) ───────────────────────────────────────────────────────────────────

  /** `POST /v1/owner/{repository}/grants` and `POST /v1/admin/grants`: grant a worker key access to
   *  one repository, with the capabilities it may use there and its `max_tier`. The first grant of
   *  an unknown key names its hostname, unique among keys in force; a later one naming another is
   *  `conflict` — only an administrator changes it. `human-operator` is granted like any capability
   *  (B-104: rule 6 retired, R-BTN-121 as amended). */
  async grant(actor: string, repository: string, body: unknown, by: 'owner' | 'admin') {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    only(b, by === 'admin' ? ['repository', 'public_key', 'hostname', 'label', 'capabilities', 'max_tier'] : ['public_key', 'hostname', 'label', 'capabilities', 'max_tier'], 'body');
    const repo = this.c.registry.get(repository);
    if (!repo || repo.retired_at != null) throw new BatonError('not-found', `${repository} is not registered`);
    const key = await this.parsePersonOrWorkerKey(b.public_key, 'public_key');
    const hostname = b.hostname === undefined ? null : typeof b.hostname === 'string' && HOSTNAME.test(b.hostname) ? b.hostname : bad('hostname', 'must be a hostname');
    const label = b.label === undefined ? null : typeof b.label === 'string' && LABEL.test(b.label) ? b.label : bad('label', 'must be a short label');
    // B-104 (R-BTN-121/174): a grant names capabilities and may name a typed holding —
    // `<type>:<value>`, as `capability:*` and `key:*` always could by their type.
    const raw = Array.isArray(b.capabilities) && b.capabilities.length <= CAPABILITIES_MAX && b.capabilities.every((x) => typeof x === 'string' && (CAPABILITY.test(x) || new RegExp(`^${HOLDING_TYPE}:[A-Za-z0-9:.*_/@-]{1,128}$`).test(x)))
      ? (b.capabilities as string[]) : bad('capabilities', `must be at most ${CAPABILITIES_MAX} capability names`);
    // Stored expanded (§4): a role as its capabilities; human-operator as itself — B-104 (rule 6
    // retired, R-BTN-121 as amended): a capability like any other, granted by owners and
    // administrators alike, checked by rule 4 as the literal it is.
    const expanded = [...new Set([...capabilitiesOf(raw), ...(raw.includes('human-operator') ? ['human-operator'] : [])])].sort();
    const maxTier = b.max_tier == null ? null : typeof b.max_tier === 'string' && repo.tiers.includes(b.max_tier) ? repo.tiers.indexOf(b.max_tier) : bad('max_tier', `must be one of ${repo.tiers.join(', ')}`);
    const admins = await this.adminFingerprints();
    // B-145 item 12: granting a runner key is an `approvers.members` action, never a plain
    // owner's any more (R-BTN-188).
    this.requireMembersApprover(repository, actor.slice(actor.indexOf(':') + 1), by, await this.breakGlassSet());
    return this.c.store.transaction(() => {
      const role = this.roleOf(key.fingerprint, admins);
      if (role && role !== 'worker') throw new BatonError('conflict', `this key is already a ${role} key (R-BTN-57: one role per key)`);
      const cred = this.rows<{ hostname: string; revoked_at: number | null }>('SELECT hostname, revoked_at FROM credentials WHERE id = ?', key.fingerprint)[0];
      if (cred?.revoked_at != null) throw new BatonError('conflict', 'this key was revoked; the machine needs a new key');
      if (!cred) {
        if (!hostname) bad('hostname', 'the first grant of a key names its hostname');
        if (this.rows(`SELECT 1 FROM credentials WHERE hostname = ? AND revoked_at IS NULL AND kind IN ('worker','token')`, hostname).length) {
          throw new BatonError('conflict', `${hostname} already has a key in force`);
        }
        this.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by, label) VALUES (?, ?, '[]', 'worker', ?, ?, ?)`,
          key.fingerprint, hostname, key.line, actor, label);
      } else if (this.rows(`SELECT 1 FROM credentials WHERE id = ? AND created_by = 'seed'`, key.fingerprint).length) {
        // A BATON_KEYS key reaches every repository until grants bind it; binding it would cut it
        // off from the others, which owning one repository never may (R-BTN-58; round 1, 1-B-0).
        // Only an administrator takes it over — its grants bind it from then on, and the seed never
        // revokes it.
        if (by !== 'admin') throw new BatonError('conflict', 'this key is seeded from BATON_KEYS and reaches every repository; an administrator grants it');
        this.exec('UPDATE credentials SET created_by = ? WHERE id = ?', actor, key.fingerprint);
      }
      if (cred && hostname && hostname !== cred.hostname) {
        if (by !== 'admin') throw new BatonError('conflict', `this key's hostname is ${cred.hostname}; only an administrator changes it (R-BTN-58)`);
        if (this.rows(`SELECT 1 FROM credentials WHERE hostname = ? AND revoked_at IS NULL AND id != ?`, hostname, key.fingerprint).length) throw new BatonError('conflict', `${hostname} already has a key in force`);
        this.exec('UPDATE credentials SET hostname = ? WHERE id = ?', hostname, key.fingerprint);
      }
      const prior = this.rows<{ capabilities: string; revoked_at: number | null }>('SELECT capabilities, revoked_at FROM worker_grants WHERE credential_id = ? AND repository_id = ?', key.fingerprint, repository)[0];
      const caps = expanded;
      this.exec(`INSERT INTO worker_grants (credential_id, repository_id, capabilities, max_tier, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (credential_id, repository_id) DO UPDATE SET capabilities = excluded.capabilities, max_tier = excluded.max_tier,
                   granted_by = excluded.granted_by, granted_at = excluded.granted_at, revoked_at = NULL`,
        key.fingerprint, repository, JSON.stringify(caps), maxTier, actor, this.c.now());
      this.event(actor, { act: 'grant', key: key.fingerprint, repository, capabilities: caps, max_tier: maxTier }, repository);
      this.c.fleetChanged?.();
      return { ok: true, fingerprint: key.fingerprint };
    });
  }

  /** `POST /v1/owner/{repository}/grants/{fingerprint}/revoke`: this repository's grant only. */
  async revokeGrant(actor: string, repository: string, raw: string) {
    const fingerprint = fingerprintOf(raw, 'fingerprint');
    // B-145 item 12: revoking a runner key is an `approvers.members` action too.
    this.requireMembersApprover(repository, actor.slice(actor.indexOf(':') + 1), 'owner', await this.breakGlassSet());
    return this.c.store.transaction(() => {
      this.exec('UPDATE worker_grants SET revoked_at = ? WHERE credential_id = ? AND repository_id = ? AND revoked_at IS NULL', this.c.now(), fingerprint, repository);
      if (!this.changed()) throw new BatonError('not-found', `no grant of ${fingerprint} on ${repository}`);
      this.event(actor, { act: 'grant-revoked', key: fingerprint, repository }, repository);
      this.c.fleetChanged?.();
      return { ok: true };
    });
  }

  // ── owners (R-BTN-58) ───────────────────────────────────────────────────────────────────

  /** `POST /v1/owner/{repository}/owners`: `{public_key}` adds an owner, `{fingerprint, remove:
   *  true}` removes one — never the last, and never leaving an approver list or a floor's
   *  `remove_by` no live credential can satisfy (R-BTN-188). */
  async owners(actor: string, repository: string, body: unknown) {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    // B-145 item 12: adding and removing owners is an `approvers.members` action.
    this.requireMembersApprover(repository, actor.slice(actor.indexOf(':') + 1), 'owner', await this.breakGlassSet());
    if (b.remove === true) {
      only(b, ['fingerprint', 'remove'], 'body');
      const fp = fingerprintOf(b.fingerprint, 'fingerprint');
      const facts = await this.factsWithout(repository, null);
      return this.c.store.transaction(() => {
        const left = this.rows<{ fingerprint: string }>('SELECT fingerprint FROM repository_owners WHERE repository_id = ? AND removed_at IS NULL', repository);
        if (!left.some((o) => o.fingerprint === fp)) throw new BatonError('not-found', `${fp} does not own ${repository}`);
        if (left.length === 1) throw new BatonError('conflict', 'a repository keeps at least one owner (R-BTN-58)');
        // R-BTN-188: no list, and no floor's remove_by, left without a live credential.
        this.refuseUnsatisfiableLists(repository, { owners: new Map([...facts.owners].filter(([fp2]) => fp2 !== fp)), humans: facts.humans, breakGlass: facts.breakGlass });
        this.exec('UPDATE repository_owners SET removed_at = ? WHERE repository_id = ? AND fingerprint = ? AND removed_at IS NULL', this.c.now(), repository, fp);
        this.event(actor, { act: 'owner-removed', key: fp, repository }, repository);
        return { ok: true };
      });
    }
    only(b, ['public_key'], 'body');
    const [key] = await this.ownerKeys([b.public_key], 'public_key');
    const admins = await this.adminFingerprints();
    // R-BTN-185: a registered human-only key — or a break-glass line — becomes an owner marked
    // `human_only`; registering one with the tenant owns nothing until this adds it.
    const human = (await this.humanMarks()).has(key.fingerprint) ? 1 : 0;
    return this.c.store.transaction(() => {
      if (this.owns(key.fingerprint, repository)) return { ok: true };
      this.mayOwn(key.fingerprint, admins);
      if (this.rows('SELECT 1 FROM repository_owners WHERE repository_id = ? AND removed_at IS NULL', repository).length >= OWNERS_MAX) bad('public_key', `a repository has at most ${OWNERS_MAX} owners`);
      this.insertOwner(repository, key, actor, human);
      this.event(actor, { act: 'owner-added', key: key.fingerprint, repository, human_only: human === 1 }, repository);
      return { ok: true };
    });
  }

  // ── couriers (R-BTN-80) ─────────────────────────────────────────────────────────────────

  /**
   * `POST /v1/owner/{repository}/couriers`: `{public_key, asks}` registers a personal courier on
   * this repository for those `asks` (replacing its asks here), `{fingerprint, revoke: true}`
   * ends its registration here. A key in another role is `conflict` (R-BTN-57); a courier key
   * another repository registered may be added — one person's CLI serves every repository they
   * own. Revoking closes its notices here, and the credential goes with its last registration;
   * one an administrator revoked never comes back. B-145 items 10 and 12: registering a courier
   * is an `approvers.members` action, and its trust level and trust domain are set — on the
   * same registration, or a later one — only by an approver on `approvers.trust` (R-BTN-180).
   */
  async couriers(actor: string, repository: string, body: unknown) {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    const fingerprint = actor.slice(actor.indexOf(':') + 1);
    this.requireMembersApprover(repository, fingerprint, 'owner', await this.breakGlassSet());
    if (b.revoke === true) {
      only(b, ['fingerprint', 'revoke'], 'body');
      const fp = fingerprintOf(b.fingerprint, 'fingerprint');
      return this.c.store.transaction(() => {
        this.exec('DELETE FROM couriers WHERE credential_id = ? AND repository_id = ?', fp, repository);
        if (!this.changed()) throw new BatonError('not-found', `${fp} is no courier of ${repository}`);
        this.c.notices?.revoked(fp, repository);
        if (!this.rows('SELECT 1 FROM couriers WHERE credential_id = ?', fp).length) {
          this.exec('UPDATE credentials SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL', this.c.now(), actor, fp);
        }
        this.event(actor, { act: 'courier-revoked', key: fp, repository }, repository);
        return { ok: true };
      });
    }
    only(b, ['public_key', 'asks', 'trust_level', 'trust_domain'], 'body');
    const key = await this.parseKey(b.public_key, 'public_key');
    const asks = checkAsks(b.asks);
    // R-BTN-180: the trust attributes only an `approvers.trust` approver sets; absent, the
    // courier takes `grants.default_trust` like a grant nobody marked (B-147 reads it so).
    let trustLevel: 'trusted' | 'untrusted' | null = null;
    let trustDomain: string | null = null;
    const policies = this.c.policies;
    const cur = policies?.current(repository);
    const facts = cur ? policies!.facts(repository, await this.breakGlassSet()) : null;
    if (cur && facts && (b.trust_level !== undefined || b.trust_domain !== undefined)) {
      if (!policies!.entryMatches(cur.policy.approvers.trust, fingerprint, facts, cur.policy.human_key)) {
        throw new BatonError('forbidden', 'trust_level and trust_domain are set by an approver on approvers.trust (R-BTN-180)');
      }
      if (b.trust_level !== undefined) {
        if (b.trust_level !== 'trusted' && b.trust_level !== 'untrusted') bad('trust_level', "must be 'trusted' or 'untrusted'");
        trustLevel = b.trust_level as 'trusted' | 'untrusted';
      }
      if (b.trust_domain !== undefined) {
        if (typeof b.trust_domain !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,62}$/.test(b.trust_domain)) bad('trust_domain', 'must be a short host name');
        trustDomain = b.trust_domain as string;
      }
    }
    const admins = await this.adminFingerprints();
    const setTrust = trustLevel != null || trustDomain != null;
    return this.c.store.transaction(() => {
      const role = this.roleOf(key.fingerprint, admins);
      if (role && role !== 'courier') throw new BatonError('conflict', `this key is already a ${role} key (R-BTN-57: one role per key)`);
      const cred = this.rows<{ revoked_at: number | null; revoked_by: string | null }>('SELECT revoked_at, revoked_by FROM credentials WHERE id = ?', key.fingerprint)[0];
      if (!cred) {
        this.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key, created_by) VALUES (?, ?, '[]', 'courier', ?, ?)`,
          key.fingerprint, `courier:${key.fingerprint}`, key.line, actor);
      } else if (cred.revoked_at != null) {
        // An owner's revoke of its last registration ends the credential, and another
        // registration brings it back; an administrator's revoke is final.
        if (cred.revoked_by?.startsWith('admin:')) throw new BatonError('conflict', 'this courier key was revoked by an administrator; its holder needs a new key');
        this.exec('UPDATE credentials SET revoked_at = NULL, revoked_by = NULL WHERE id = ?', key.fingerprint);
      }
      this.exec('DELETE FROM couriers WHERE credential_id = ? AND repository_id = ?', key.fingerprint, repository);
      for (const a of asks) this.exec('INSERT INTO couriers (credential_id, repository_id, asks, trust_level, trust_domain, trust_set_by) VALUES (?, ?, ?, ?, ?, ?)',
        key.fingerprint, repository, a, trustLevel, trustDomain, setTrust ? actor : null);
      this.c.notices?.registered(key.fingerprint, repository);
      this.event(actor, { act: 'courier-added', key: key.fingerprint, repository, asks, ...(trustLevel ? { trust_level: trustLevel } : {}), ...(trustDomain ? { trust_domain: trustDomain } : {}) }, repository);
      return { ok: true, fingerprint: key.fingerprint };
    });
  }

  // ── human-only keys (R-BTN-185, B-145 item 11) ────────────────────────────────────────

  /** `POST /v1/human-keys`, called by a `human_only` key: `{public_key, signature}` registers
   *  each later one with a signature by an existing one over the new key's public line in
   *  `baton-human-keys@1`; `{fingerprint, revoke: true, confirm: true}` revokes one — refused
   *  while an approver list or a floor's `remove_by` it alone satisfies would be left with no
   *  live credential (R-BTN-188's `unsatisfiable-approvers`). */
  async humanKeys(body: unknown, actor: string, breakGlass: ReadonlySet<string>): Promise<{ ok: true }> {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    if (b.revoke === true) {
      only(b, ['fingerprint', 'revoke', 'confirm'], 'body');
      if (b.confirm !== true) throw new BatonError('confirm-required', 'revoking a human key takes confirm: true');
      const fp = fingerprintOf(b.fingerprint, 'fingerprint');
      // Refuse where the key is the last live credential a list or a floor's `remove_by` has
      // (R-BTN-188) — judged per repository it owns, with the key counted out.
      for (const { repository_id } of this.rows<{ repository_id: string }>('SELECT DISTINCT repository_id FROM repository_owners WHERE fingerprint = ? AND removed_at IS NULL', fp)) {
        const facts = await this.factsWithout(repository_id, null);
        this.refuseUnsatisfiableLists(repository_id, { owners: new Map([...facts.owners].filter(([fp2]) => fp2 !== fp)), humans: facts.humans, breakGlass: facts.breakGlass });
      }
      return this.c.store.transaction(() => {
        const row = this.rows<{ revoked_at: number | null }>('SELECT revoked_at FROM human_keys WHERE fingerprint = ?', fp)[0];
        const isBreakGlass = breakGlass.has(fp);
        if (!row && !isBreakGlass) throw new BatonError('not-found', `${fp} is no registered human key`);
        if (row?.revoked_at != null) return { ok: true };
        if (row) this.exec('UPDATE human_keys SET revoked_at = ? WHERE fingerprint = ?', this.c.now(), fp);
        // The key's ownership goes with it, on every repository (a revocation ends the key).
        this.exec('UPDATE repository_owners SET removed_at = coalesce(removed_at, ?), revoked_at = ? WHERE fingerprint = ? AND revoked_at IS NULL', this.c.now(), this.c.now(), fp);
        this.event(`human:${fp}`, { act: 'human-key-revoked', key: fp, ...(isBreakGlass ? { note: 'a BATON_HUMAN_KEYS line: revoke it in the host configuration, not here' } : {}) }, null);
        return { ok: true };
      });
    }
    only(b, ['public_key', 'signature'], 'body');
    const publicKey = typeof b.public_key === 'string' ? b.public_key : bad('public_key', 'must be an OpenSSH public key line');
    const signature = typeof b.signature === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(b.signature) ? b.signature : bad('signature', 'must be the base64 SSHSIG over the new key’s public line');
    const key = await this.parseKey(publicKey, 'public_key');
    const admins = await this.adminFingerprints();
    if (admins.has(key.fingerprint)) throw new BatonError('conflict', 'an administrator key holds no other role (R-BTN-57)');
    if (this.rows('SELECT 1 FROM credentials WHERE id = ?', key.fingerprint).length || this.rows('SELECT 1 FROM sync_keys WHERE fingerprint = ?', key.fingerprint).length) {
      throw new BatonError('conflict', 'this key already holds a role (R-BTN-57: one role per key)');
    }
    // The signature is by the acting human_only key — a registered one or a break-glass line —
    // over the new key's public line exactly as sent.
    const signerLine = this.rows<{ public_key: string }>('SELECT public_key FROM human_keys WHERE fingerprint = ? AND revoked_at IS NULL', actor)[0]?.public_key
      ?? (await this.c.humanBreakGlass?.().then((m) => m.get(actor)) ?? null);
    if (!signerLine) throw new BatonError('unauthenticated', 'the acting key is not a live human_only key');
    const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    await verifyNamespacedSignature(signerLine, sig, new TextEncoder().encode(publicKey.trim()), 'baton-human-keys@1');
    this.c.store.transaction(() => {
      this.exec('INSERT INTO human_keys (fingerprint, public_key, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (fingerprint) DO UPDATE SET revoked_at = NULL, added_by = excluded.added_by',
        key.fingerprint, key.line, `human:${actor}`, this.c.now());
      this.event(`human:${actor}`, { act: 'human-key-added', key: key.fingerprint }, null);
    });
    return { ok: true };
  }


  private insertOwner(repository: string, key: { fingerprint: string; line: string }, actor: string, humanOnly = 0) {
    this.exec(`INSERT INTO repository_owners (repository_id, public_key, fingerprint, added_by, added_at, human_only) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (repository_id, public_key) DO UPDATE SET removed_at = NULL, added_by = excluded.added_by, added_at = excluded.added_at, human_only = excluded.human_only`,
      repository, key.line, key.fingerprint, actor, this.c.now(), humanOnly);
  }

  // ── owner bars and settings (R-BTN-66, R-BTN-67) ────────────────────────────────────────

  /** `POST /v1/owner/{repository}/bars`: an owner bar `{course, tag, legs?, applies, starts_at?,
   *  ends_at?, release_holders?, reason}`; named legs need a named course. */
  // @model setOwnerBar sha256:95bd0786c624
  setBar(actor: string, repository: string, body: unknown) {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    only(b, ['course', 'tag', 'legs', 'applies', 'starts_at', 'ends_at', 'release_holders', 'reason'], 'body');
    const now = this.c.now();
    const course = b.course === '*' ? '*' : typeof b.course === 'string' && COURSE_ID.test(b.course) ? b.course : bad('course', "must be a course id or '*'");
    const tag = typeof b.tag === 'string' && TAG.test(b.tag) ? b.tag : bad('tag', 'must be a tag');
    const legs = b.legs === undefined ? [] : Array.isArray(b.legs) && b.legs.length <= LEGS_MAX && b.legs.every((l) => typeof l === 'string' && COURSE_ID.test(l))
      ? [...new Set(b.legs as string[])] : bad('legs', `must be at most ${LEGS_MAX} leg names`);
    if (legs.length && course === '*') bad('legs', "named legs need a named course, not '*'");
    // A named course is one the repository registers, and each named leg resolves in its file —
    // a typo would bar nothing (round 1, 1-A-4).
    if (course !== '*') {
      const file = this.rows<{ course_json: string }>('SELECT course_json FROM courses WHERE repository_id = ? AND id = ?', repository, course)[0]?.course_json;
      if (!file) bad('course', `${repository} registers no course ${course}`);
      const g = graphOf(JSON.parse(file!));
      for (const l of legs) if (!resolveLeg(g, l)) bad('legs', `${course}'s course file has no leg ${l}`);
    }
    const applies = b.applies === 'claim' || b.applies === 'claim+advance' ? b.applies : bad('applies', "must be 'claim' or 'claim+advance'");
    const startsAt = b.starts_at === undefined ? now : Number.isSafeInteger(b.starts_at) && (b.starts_at as number) >= 0 ? (b.starts_at as number) : bad('starts_at', 'must be epoch ms');
    const endsAt = b.ends_at == null ? null : Number.isSafeInteger(b.ends_at) && (b.ends_at as number) > Math.max(startsAt, now) ? (b.ends_at as number) : bad('ends_at', 'must be epoch ms after starts_at and now');
    if (b.release_holders !== undefined && typeof b.release_holders !== 'boolean') bad('release_holders', 'must be true or false');
    const reason = isOwnerBarReason(b.reason) ? b.reason : bad('reason', 'must be a short id, never one of §6.5’s closed reasons');
    return this.c.store.transaction(() => {
      if (this.rows('SELECT 1 FROM owner_bars WHERE repository_id = ? AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?)', repository, now).length >= BARS_MAX) {
        bad('body', `a repository has at most ${BARS_MAX} bars in force or scheduled`);
      }
      this.exec(`INSERT INTO owner_bars (repository_id, course, tag, legs, applies, starts_at, ends_at, release_holders, reason, set_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        repository, course, tag, JSON.stringify(legs), applies, startsAt, endsAt, b.release_holders === true ? 1 : 0, reason, actor);
      const id = this.rows<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id;
      this.event(actor, { act: 'bar-set', id, repository, course, tag, legs, applies, starts_at: startsAt, ends_at: endsAt, release_holders: b.release_holders === true, reason }, repository);
      this.c.dispatchSync(repository);
      return { id };
    });
  }

  /** `POST /v1/owner/{repository}/bars/{id}/lift`. */
  // @model liftOwnerBars sha256:d44622a86dbe
  liftBar(actor: string, repository: string, id: number) {
    return this.c.store.transaction(() => {
      this.exec('UPDATE owner_bars SET lifted_at = ? WHERE id = ? AND repository_id = ? AND lifted_at IS NULL', this.c.now(), id, repository);
      if (!this.changed()) throw new BatonError('not-found', `no bar ${id} in force on ${repository}`);
      this.event(actor, { act: 'bar-lifted', id, repository }, repository);
      this.c.dispatchSync(repository);
      return { ok: true };
    });
  }

  /** `PUT /v1/owner/{repository}/settings`: `required_bars`, `retry`, `transcript_repos`,
   *  `unblocked_trigger`, `remind_after` (seconds, R-BTN-80), `required_independence`
   *  (R-BTN-106) — each given replaces that setting whole. */
  setSettings(actor: string, repository: string, body: unknown) {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    only(b, ['required_bars', 'retry', 'transcript_repos', 'unblocked_trigger', 'remind_after', 'required_independence'], 'body');
    if (!Object.keys(b).length) bad('body', 'names at least one setting');
    const sets: [string, string | null][] = [];
    if (b.required_bars !== undefined) sets.push(['required_bars', JSON.stringify(this.checkRequiredBars(repository, b.required_bars))]);
    if (b.retry !== undefined) sets.push(['retry', b.retry === null ? null : JSON.stringify(checkRetry(b.retry))]);
    if (b.transcript_repos !== undefined) {
      const t = Array.isArray(b.transcript_repos) && b.transcript_repos.length <= 20 && b.transcript_repos.every((x) => typeof x === 'string' && parseTranscriptRepo(x) !== null)
        ? b.transcript_repos : bad('transcript_repos', 'must be at most 20 repositories, each a GitHub owner/name or <forge>:<web_base>');
      sets.push(['transcript_repos', JSON.stringify(t)]);
    }
    if (b.unblocked_trigger !== undefined) sets.push(['unblocked_trigger', b.unblocked_trigger === null ? null : JSON.stringify(checkTrigger(b.unblocked_trigger))]);
    if (b.remind_after !== undefined) {
      const r = Number.isInteger(b.remind_after) && (b.remind_after as number) >= REMIND_AFTER_S.min && (b.remind_after as number) <= REMIND_AFTER_S.max
        ? (b.remind_after as number) : bad('remind_after', `must be whole seconds from ${REMIND_AFTER_S.min} to ${REMIND_AFTER_S.max}`);
      sets.push(['remind_after_s', JSON.stringify(r)]);
    }
    if (b.required_independence !== undefined) sets.push(['required_independence', JSON.stringify(checkIndependence(b.required_independence))]);
    return this.c.store.transaction(() => {
      for (const [k, v] of sets) this.exec(`UPDATE repositories SET ${k} = ? WHERE id = ?`, v, repository);
      this.event(actor, { act: 'settings', repository, ...Object.fromEntries(sets.map(([k, v]) => [k === 'remind_after_s' ? 'remind_after' : k, v == null ? null : JSON.parse(v)])) }, repository);
      // Required bars are applied as a snapshot's legs are stored: the next sync re-stores them
      // now rather than at the schedule (round 1, 1-A-8).
      if (b.required_bars !== undefined) this.c.dispatchSync(repository);
      return { ok: true };
    });
  }

  /** R-BTN-67's required bars: `{course | *, leg | *, except?, tag_prefix}`, a named `leg` only
   *  under a named course — and, while that course's file is in force, a leg it has. */
  private checkRequiredBars(repository: string, v: unknown): RequiredBar[] {
    if (!Array.isArray(v) || v.length > REQUIRED_BARS_MAX) bad('required_bars', `must be a list of at most ${REQUIRED_BARS_MAX}`);
    return (v as unknown[]).map((raw, i) => {
      const at = `required_bars[${i}]`;
      if (!isObj(raw)) bad(at, 'must be an object');
      const x = raw as Record<string, unknown>;
      only(x, ['course', 'leg', 'except', 'tag_prefix'], at);
      const course = x.course === '*' ? '*' : typeof x.course === 'string' && COURSE_ID.test(x.course) ? x.course : bad(`${at}.course`, "must be a course id or '*'");
      const leg = x.leg === '*' ? '*' : typeof x.leg === 'string' && COURSE_ID.test(x.leg) ? x.leg : bad(`${at}.leg`, "must be a leg name or '*'");
      if (leg !== '*' && course === '*') bad(`${at}.leg`, "a named leg needs a named course, not '*'");
      const except = x.except === undefined ? undefined : Array.isArray(x.except) && x.except.length <= LEGS_MAX && x.except.every((e) => typeof e === 'string' && COURSE_ID.test(e))
        ? [...new Set(x.except as string[])] : bad(`${at}.except`, `must be at most ${LEGS_MAX} leg names`);
      if (except && leg !== '*') bad(`${at}.except`, "only with leg '*'");
      const prefix = typeof x.tag_prefix === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,63}$/.test(x.tag_prefix) ? x.tag_prefix : bad(`${at}.tag_prefix`, 'must be a tag prefix');
      // A named course is one the repository registers, as an owner bar's is (round 2, 2-A-1).
      if (course !== '*') {
        const file = this.rows<{ course_json: string }>('SELECT course_json FROM courses WHERE repository_id = ? AND id = ?', repository, course)[0]?.course_json;
        if (!file) bad(`${at}.course`, `${repository} registers no course ${course}`);
        if (leg !== '*' && !resolveLeg(graphOf(JSON.parse(file!)), leg)) bad(`${at}.leg`, `${course}'s course file has no leg ${leg}`);
      }
      return { course, leg, ...(except ? { except } : {}), tag_prefix: prefix };
    });
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  /** The owner bars of `repositories` in force at `now` — and, with `scheduled`, those not yet
   *  started — for the heartbeat, the observation and the gates (R-BTN-67). */
  bars(repositories: string[] | null, now: number, scheduled = false): OwnerBar[] {
    return this.rows<Omit<OwnerBar, 'legs' | 'release_holders'> & { legs: string; release_holders: number }>(
      `SELECT id, repository_id, course, tag, legs, applies, starts_at, ends_at, release_holders, reason FROM owner_bars
       WHERE lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?) AND (? OR starts_at <= ?)
         AND (? IS NULL OR repository_id IN (SELECT value FROM json_each(?))) ORDER BY id`,
      now, scheduled ? 1 : 0, now, repositories ? 1 : null, JSON.stringify(repositories ?? []))
      .map((b) => ({ ...b, legs: JSON.parse(b.legs) as string[], release_holders: !!b.release_holders }));
  }

  /** A repository's required bars (R-BTN-67). */
  requiredBars(repository: string): RequiredBar[] {
    return JSON.parse(this.rows<{ required_bars: string }>('SELECT required_bars FROM repositories WHERE id = ?', repository)[0]?.required_bars ?? '[]');
  }

  /** R-BTN-106: the owners' `required_independence`, leg → the legs a key that ran any of them
   *  on a ticket may not take it; joined to every course file's `no_chain_from`. */
  requiredIndependence(repository: string): Record<string, string[]> {
    return JSON.parse(this.rows<{ v: string }>('SELECT required_independence AS v FROM repositories WHERE id = ?', repository)[0]?.v ?? '{}');
  }

  /** A repository's retry policy (R-BTN-23), or null for the default. */
  retry(repository: string): RetryPolicy | null {
    const r = this.rows<{ retry: string | null }>('SELECT retry FROM repositories WHERE id = ?', repository)[0]?.retry;
    return r ? JSON.parse(r) : null;
  }

  /** `seed_owners` (B-91, R-BTN-179): the unretired repositories whose live owners are all
   *  BATON_REPOSITORIES' (`admin:seed`), or that have none — the registrations that lean on the
   *  deploy for their owner keys. `GET /v1/admin/repositories` alone reads it. */
  seedOwnedRepositories(): string[] {
    const owners = this.rows<{ repository_id: string; added_by: string }>('SELECT repository_id, added_by FROM repository_owners WHERE removed_at IS NULL');
    return this.rows<{ id: string }>('SELECT id FROM repositories WHERE retired_at IS NULL ORDER BY id')
      .map((r) => r.id).filter((id) => {
        const live = owners.filter((o) => o.repository_id === id);
        return !live.length || live.every((o) => o.added_by === 'admin:seed');
      });
  }

  /** The dashboard's read-only view (R-BTN-66: no management path but the CLI). */
  view(now: number) {
    return {
      owners: this.rows('SELECT repository_id, fingerprint, added_by, added_at FROM repository_owners WHERE removed_at IS NULL ORDER BY repository_id, added_at'),
      grants: this.grants(),
      // §14: probes too, with the instances each may report on (round 3, 3-A-3).
      probes: this.rows(`SELECT id AS fingerprint, label, allowed_instances, created_by FROM credentials WHERE kind = 'probe' AND revoked_at IS NULL ORDER BY label`),
      bars: this.bars(null, now, true),
      settings: this.rows('SELECT id AS repository_id, required_bars, retry, transcript_repos, unblocked_trigger, remind_after_s AS remind_after, required_independence FROM repositories WHERE retired_at IS NULL ORDER BY id'),
      // R-BTN-80: the personal channels, by repository.
      couriers: this.c.notices?.couriers() ?? [],
    };
  }

  /** Every grant in force, the dashboard's `limits.grants` (R-BTN-66, R-BTN-146) — the one read
   *  `GET /v1/owner/{repository}/grants` narrows to a repository (R-BTN-179, B-90). */
  grants() {
    // max_tier as its name in the repository's ladder (stored as a position, R-BTN-66).
    return this.rows<{ credential_id: string; hostname: string | null; label: string | null; repository_id: string; capabilities: string; max_tier: number | null; granted_by: string; granted_at: number }>(`SELECT g.credential_id, c.hostname, c.label, g.repository_id, g.capabilities, g.max_tier, g.granted_by, g.granted_at
                       FROM worker_grants g JOIN credentials c ON c.id = g.credential_id WHERE g.revoked_at IS NULL ORDER BY g.repository_id, c.hostname`)
      .map((g) => ({ ...g, max_tier: g.max_tier == null ? null : this.c.registry.get(g.repository_id)?.tiers[g.max_tier] ?? null }));
  }

  // ── keys ────────────────────────────────────────────────────────────────────────────────

  private async parseKey(v: unknown, field: string): Promise<{ fingerprint: string; line: string }> {
    if (typeof v !== 'string') bad(field, 'must be an OpenSSH public key line');
    const key = await parseSshKey(v as string);
    return { fingerprint: key.fingerprint, line: lineOf(key, v as string) };
  }

  /** An owner's or a worker's key: an OpenSSH public key, or an API key's public line (R-BTN-159).
   *  Probe, courier and sync keys stay SSH keys (parseKey). */
  private async parsePersonOrWorkerKey(v: unknown, field: string): Promise<{ fingerprint: string; line: string }> {
    const api = typeof v === 'string' ? parseApiKeyLine(v) : null;
    return api ? { fingerprint: api.fingerprint, line: api.line } : this.parseKey(v, field);
  }

  private async ownerKeys(v: unknown, field: string): Promise<{ fingerprint: string; line: string }[]> {
    if (!Array.isArray(v) || v.length > OWNERS_MAX) bad(field, `must be a list of at most ${OWNERS_MAX} public keys`);
    const keys = await Promise.all((v as unknown[]).map((k, i) => this.parsePersonOrWorkerKey(k, `${field}[${i}]`)));
    if (new Set(keys.map((k) => k.fingerprint)).size !== keys.length) bad(field, 'names a key twice');
    return keys;
  }
}

/** R-BTN-106's `required_independence`: `{<leg>: [<leg>, …]}`, leg names compared as strings
 *  in every course of the repository (a renamed leg is followed at the gate). At most
 *  LEGS_MAX legs, each naming at most LEGS_MAX; an empty list is dropped. */
export function checkIndependence(v: unknown): Record<string, string[]> {
  if (!isObj(v) || Object.keys(v).length > LEGS_MAX) bad('required_independence', `must be an object of at most ${LEGS_MAX} leg names`);
  const out: Record<string, string[]> = {};
  for (const [leg, from] of Object.entries(v as Record<string, unknown>)) {
    const at = `required_independence.${leg}`;
    if (!COURSE_ID.test(leg)) bad(at, 'must be a leg name');
    if (!Array.isArray(from) || from.length > LEGS_MAX || !from.every((l) => typeof l === 'string' && COURSE_ID.test(l))) bad(at, `must be a list of at most ${LEGS_MAX} leg names`);
    const legs = [...new Set(from as string[])].sort();
    if (legs.length) out[leg] = legs;
  }
  return out;
}

/** R-BTN-23's policy as owners set it: 1–8 backoffs, each 1 minute to 30 days, and the failed
 *  attempt that holds the ticket, 1–10. */
export function checkRetry(v: unknown): RetryPolicy {
  if (!isObj(v)) bad('retry', 'must be {backoff_ms: [..], max_failed}');
  const b = v as Record<string, unknown>;
  only(b, ['backoff_ms', 'max_failed'], 'retry');
  const backoff = Array.isArray(b.backoff_ms) && b.backoff_ms.length >= 1 && b.backoff_ms.length <= BACKOFFS_MAX && b.backoff_ms.every((n) => Number.isSafeInteger(n) && (n as number) >= 60_000 && (n as number) <= 30 * 86_400_000)
    ? (b.backoff_ms as number[]) : bad('retry.backoff_ms', `must be 1 to ${BACKOFFS_MAX} backoffs of 1 minute to 30 days`);
  const max = Number.isInteger(b.max_failed) && (b.max_failed as number) >= 1 && (b.max_failed as number) <= 10 ? (b.max_failed as number) : bad('retry.max_failed', 'must be an integer from 1 to 10');
  return { backoff_ms: backoff, max_failed: max };
}

/** R-BTN-94's dispatch shape for `unblocked_trigger` (R-BTN-77): on GitHub a workflow path. */
function checkTrigger(v: unknown): Record<string, unknown> {
  if (!isObj(v) || typeof v.kind !== 'string') bad('unblocked_trigger', 'must be a dispatch {kind, …}');
  const t = v as Record<string, unknown>;
  if (t.kind === 'github-app') {
    only(t, ['kind', 'workflow'], 'unblocked_trigger');
    if (typeof t.workflow !== 'string' || !/^\.github\/workflows\/[A-Za-z0-9._-]{1,100}\.ya?ml$/.test(t.workflow)) bad('unblocked_trigger.workflow', 'must be a path under .github/workflows/');
  } else if (t.kind === 'gitlab-trigger') {
    only(t, ['kind', 'project_id', 'ref'], 'unblocked_trigger');
    if (!Number.isSafeInteger(t.project_id) || typeof t.ref !== 'string' || !/^[A-Za-z0-9._/-]{1,100}$/.test(t.ref)) bad('unblocked_trigger', 'needs project_id and ref');
  } else if (t.kind === 'gitea') {
    only(t, ['kind', 'workflow', 'ref'], 'unblocked_trigger');
    if (typeof t.workflow !== 'string' || !/^[A-Za-z0-9._/-]{1,200}$/.test(t.workflow) || typeof t.ref !== 'string' || !/^[A-Za-z0-9._/-]{1,100}$/.test(t.ref)) bad('unblocked_trigger', 'needs workflow and ref');
  } else {
    bad('unblocked_trigger.kind', 'must be github-app, gitlab-trigger or gitea');
  }
  return t;
}
