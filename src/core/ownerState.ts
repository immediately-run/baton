// ownerState.ts — owner state exported and imported (BATON_SPEC §4.8 R-BTN-88; R3-1258): the
// state git does not hold, moved between Batons. Baton rebuilds tickets and readiness from git;
// owner state lives only in SQLite, and the tenant's administrator moves it — freeze, seal,
// export, import — through `/v1/admin/*` and `baton admin`. The export is deterministic
// (`exported_at` is `sealed_at`), of format `baton.owner-state/v1`, its digest the SHA-256 over
// the RFC 8785 canonical JSON of the rest; its sections come from ONE list beside the exporter
// — the tables that exist when this lands, R3-1258's own list — and each later ticket adds its
// own table to that list in its PR (conditions B-55, `ticket_timers` B-61/B-63, the outbox
// B-64, check runners B-5, MCP keys B-25, registration tokens and instance settings B-8/B-46).
import { BatonError } from './http';
import { sha256HexSync } from './policy';
import { logEvent } from './db';
import { REPOSITORY_ID, TICKET_ID } from './validate';
import type { Store } from './ports';

export const OWNER_STATE_FORMAT = 'baton.owner-state/v1';

/** One exported section: its table, the order that makes the export deterministic, and — for
 *  `ticket_overrides` — that its rows are ticket-scoped, waiting in `pending_owner_state` for
 *  the first snapshot that creates their ticket. R3-1258's list; later tickets append their own
 *  tables here, in the PR that adds the section. */
export interface Section {
  table: string;
  /** The column list of the ORDER BY, the table's key in order. */
  order: string;
  /** §4.8: ticket-scoped rows an import holds back until their ticket's first snapshot. */
  ticketScoped?: { kind: 'override' | 'condition' | 'timer' | 'outbox' };
}

/** The one list (§4.8, R3-1258): repositories and their settings, owners, credentials, sync
 *  keys, grants, runners, owner bars, overrides, closed tickets, resources, instances, serves,
 *  couriers, readings in force. Claims, events, notices, instrument readings' history and sync
 *  wants are never exported (R-BTN-88); the history, `leg_outputs` and `leg_run_inputs` only
 *  with `--with-history`. */
export const SECTIONS: readonly Section[] = [
  { table: 'repositories', order: 'id' },
  { table: 'repository_owners', order: 'repository_id, fingerprint' },
  { table: 'registration_tokens', order: 'id' },
  { table: 'token_registrations', order: 'token_id, at' },
  { table: 'credentials', order: 'id' },
  { table: 'sync_keys', order: 'fingerprint' },
  { table: 'runner_grants', order: 'credential_id, repository_id' },
  { table: 'runners', order: 'id' },
  { table: 'owner_bars', order: 'id' },
  { table: 'ticket_overrides', order: 'ticket_id', ticketScoped: { kind: 'override' } },
  { table: 'closed_tickets', order: 'ticket_id' },
  { table: 'external_resources', order: 'name' },
  { table: 'resource_instances', order: 'name' },
  { table: 'instance_serves', order: 'instance, resource' },
  { table: 'couriers', order: 'credential_id, repository_id, asks' },
  // Readings in force: lapsed rows are deleted by the alarm, so the table holds them alone.
  { table: 'instance_readings', order: 'instance, source, kind' },
];

/** The tables `--with-history` adds (§4.8): the history and the outputs and inputs replay reads.
 *  An import without them loses them. */
export const HISTORY_SECTIONS: readonly Section[] = [
  { table: 'ticket_history', order: 'id' },
  { table: 'leg_outputs', order: 'ticket_id, leg, run, name' },
  { table: 'leg_run_inputs', order: 'claim_id, seq, name' },
];

/** The export (§4.8's shape), before its digest. */
export interface OwnerStateExport {
  format: string;
  schema_version: number;
  exported_at: number;
  origin: string;
  events_seq: number;
  sections: Record<string, Record<string, unknown>[]>;
  digest?: string;
}

/** RFC 8785's canonical JSON over the export's domain — integers, strings, booleans, nulls,
 *  arrays and objects (keys sorted, as `canonicalJson` sorts them), and blobs, which the wire
 *  carries as their base64 under a name no column holds. Non-finite numbers refuse: no row of
 *  these tables holds one. */
function canonical(v: unknown): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new BatonError('internal', 'the export holds a number it cannot canonicalize');
    return v === 0 ? '0' : String(v);
  }
  if (v instanceof ArrayBuffer) return JSON.stringify({ __b64__: btoa(String.fromCharCode(...new Uint8Array(v))) });
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v != null && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export class OwnerState {
  constructor(private readonly c: {
    store: Store;
    now: () => number;
    origin: string;
    /** §4.8's step 2: a seal refused for lagging mirrors dispatches their workflows (R-BTN-94). */
    dispatchMirror: (repository: string) => void;
  }) {}

  private rows<T = Record<string, unknown>>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }

  private setting(key: string): string | null {
    return this.rows<{ value: string }>('SELECT value FROM baton_settings WHERE key = ?', key)[0]?.value ?? null;
  }

  private setSetting(key: string, value: string | null): void {
    if (value == null) this.c.store.exec('DELETE FROM baton_settings WHERE key = ?', key);
    else this.c.store.exec('INSERT INTO baton_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
  }

  // ── freeze and seal (§4.8's steps 1–2) ────────────────────────────────────────────────

  frozenAt(): number | null {
    const raw = this.setting('frozen_at');
    const n = raw == null ? NaN : Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  sealedAt(): number | null {
    const raw = this.setting('sealed_at');
    const n = raw == null ? NaN : Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  /** Step 1 (§4.8): freeze — new claims and owner writes are refused `frozen` (the claims and
   *  the routes read `frozenAt`); unfreeze undoes it before the seal. Idempotent: a frozen
   *  Baton re-frozen changes nothing and logs nothing. */
  freeze(actor: string): { ok: true } {
    if (this.frozenAt() == null) {
      this.setSetting('frozen_at', String(this.c.now()));
      logEvent(this.c.store, this.c.now(), 'frozen', actor, {}, null, null, null);
    }
    return { ok: true };
  }

  unfreeze(actor: string): { ok: true } {
    if (this.frozenAt() != null) {
      this.setSetting('frozen_at', null);
      logEvent(this.c.store, this.c.now(), 'unfrozen', actor, {}, null, null, null);
    }
    return { ok: true };
  }

  /** Step 2 (§4.8): seal — once no claim is active or fence-pending and every live repository
   *  with a mirror has `mirror_acked_seq` at the last event. The lagging mirrors' workflows are
   *  dispatched (R-BTN-94), so the administrator can seal once they catch up; the claims named
   *  are the work that must drain. From the seal, the Baton logs nothing and refuses all but an
   *  administrator's read (the route's gate, `sealed`). */
  seal(actor: string): { ok: true } {
    const claims = this.rows<{ id: number; ticket_id: string; status: string; fence_pending: number }>(
      `SELECT id, ticket_id, status, fence_pending FROM claims WHERE status = 'active' OR (fence_pending = 1 AND status = 'reaped') ORDER BY id`);
    const last = this.rows<{ n: number }>('SELECT COALESCE(MAX(seq), 0) AS n FROM events')[0].n;
    const lagging = this.rows<{ id: string }>(
      `SELECT r.id FROM repositories r
       WHERE r.retired_at IS NULL AND r.mirror_acked_seq < ?
         AND (r.mirror_workflow IS NOT NULL OR EXISTS (SELECT 1 FROM sync_keys k WHERE k.repository_id = r.id AND k.role = 'mirror' AND k.revoked_at IS NULL))
       ORDER BY r.id`, last);
    if (claims.length || lagging.length) {
      for (const m of lagging) this.c.dispatchMirror(m.id);
      throw new BatonError('conflict', `the seal waits: ${claims.length ? `claims ${claims.map((c) => `${c.id} (${c.ticket_id}${c.fence_pending ? ', fence pending' : ''})`).join(', ')}` : ''}${claims.length && lagging.length ? '; ' : ''}${lagging.length ? `mirrors lagging on ${lagging.map((m) => m.id).join(', ')}` : ''}`.trim(), {
        claims: claims.map((c) => ({ id: c.id, ticket_id: c.ticket_id, status: c.status, fence_pending: c.fence_pending === 1 })),
        lagging_mirrors: lagging.map((m) => m.id),
      });
    }
    const at = this.c.now();
    this.setSetting('sealed_at', String(at));
    logEvent(this.c.store, at, 'sealed', actor, { events_seq: last }, null, null, null);
    return { ok: true };
  }

  // ── export (§4.8's step 3) ─────────────────────────────────────────────────────────────

  private columns(table: string): string[] {
    return this.rows<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name);
  }

  private sectionRows(table: string, order: string): Record<string, unknown>[] {
    const cols = this.columns(table);
    if (!cols.length) throw new BatonError('internal', `the export finds no table ${table}`);
    return this.rows<Record<string, unknown>>(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table} ORDER BY ${order}`);
  }

  /** Step 3 (§4.8): the export, sealed only and deterministic — `exported_at` is `sealed_at`,
   *  every section ordered by its key, the digest over the RFC 8785 canonical JSON of the rest.
   *  Logs nothing (a sealed Baton logs nothing). */
  export(withHistory: boolean): OwnerStateExport {
    const sealedAt = this.sealedAt();
    if (sealedAt == null) throw new BatonError('conflict', 'the export is of a sealed Baton: freeze, let the claims drain and the mirrors acknowledge, then seal (R-BTN-88)');
    const sections: Record<string, Record<string, unknown>[]> = {};
    for (const s of [...SECTIONS, ...(withHistory ? HISTORY_SECTIONS : [])]) {
      sections[s.table] = this.sectionRows(s.table, s.order);
    }
    const out: OwnerStateExport = {
      format: OWNER_STATE_FORMAT,
      schema_version: this.rows<{ n: number }>('SELECT COALESCE(MAX(id), 0) AS n FROM _baton_migrations')[0].n,
      exported_at: sealedAt,
      origin: this.c.origin,
      events_seq: this.rows<{ n: number }>('SELECT COALESCE(MAX(seq), 0) AS n FROM events')[0].n,
      sections,
    };
    out.digest = sha256HexSync(canonical(out));
    return out;
  }

  // ── import (§4.8's step 4) ─────────────────────────────────────────────────────────────

  /** Whether the Baton is empty enough to import into (§4.8): no repository, owner or
   *  credential but the seeded `legacy` row. */
  isEmpty(): boolean {
    return !this.rows('SELECT 1 FROM repositories LIMIT 1').length
      && !this.rows('SELECT 1 FROM repository_owners LIMIT 1').length
      && !this.rows(`SELECT 1 FROM credentials WHERE kind != 'legacy' LIMIT 1`).length;
  }

  /** The write path's invariants (§4.8) over the imported rows: id grammars, one role per key,
   *  and referents that exist in the import itself — the first failing row refuses the whole
   *  import, before anything is written. */
  private validate(sections: Record<string, Record<string, unknown>[]>): void {
    const bad = (at: string, why: string): never => {
      throw new BatonError('invalid-params', `the import's ${at}: ${why}`);
    };
    const str = (v: unknown): v is string => typeof v === 'string';
    for (const r of sections.repositories ?? []) {
      if (!str(r.id) || !REPOSITORY_ID.test(r.id)) bad('repositories row', `id ${JSON.stringify(r.id)} is not a repository id`);
      if (r.retired_at == null && !str(r.github)) bad('repositories row', `${r.id}: a live row names its forge path`);
      if (r.retired_at != null && !(str(r.github) && r.github.startsWith('~retired/'))) bad('repositories row', `${r.id}: a retired row is tombstoned`);
      if (!str(r.forge) || !['github', 'gitlab', 'gitea', 'git'].includes(r.forge)) bad('repositories row', `${r.id}: forge is unknown`);
    }
    const repoIds = new Set((sections.repositories ?? []).map((r) => r.id));
    for (const r of sections.repository_owners ?? []) {
      if (!str(r.repository_id) || !repoIds.has(r.repository_id)) bad('repository_owners row', `${JSON.stringify(r.repository_id)} is not an imported repository`);
      if (!str(r.fingerprint)) bad('repository_owners row', 'a fingerprint is required');
    }
    for (const r of sections.credentials ?? []) {
      if (!str(r.id) || !r.id.length) bad('credentials row', 'an id is required');
      if (!str(r.kind) || !/^[a-z][a-z0-9-]{0,31}$/.test(r.kind)) bad('credentials row', `${r.id}: kind is unknown`);
    }
    for (const r of sections.sync_keys ?? []) {
      if (!str(r.fingerprint)) bad('sync_keys row', 'a fingerprint is required');
      if (!str(r.repository_id) || !repoIds.has(r.repository_id)) bad('sync_keys row', `${JSON.stringify(r.repository_id)} is not an imported repository`);
      if (!str(r.role) || !['sync', 'mirror'].includes(r.role)) bad('sync_keys row', `${r.fingerprint}: role is unknown`);
    }
    // One role per key (R-BTN-57): across credentials, owners and sync keys, within the import.
    const roles = new Map<string, string>();
    for (const r of sections.credentials ?? []) {
      if (roles.has(String(r.id))) bad('credentials row', `${r.id} holds a second role (one role per key, R-BTN-57)`);
      roles.set(String(r.id), 'credential');
    }
    for (const r of sections.repository_owners ?? []) {
      const fp = String(r.fingerprint);
      const prior = roles.get(fp);
      const here = r.removed_at == null ? 'owner' : 'owner-removed';
      if (prior != null && prior !== here) bad('repository_owners row', `${fp} holds a second role (${prior} and ${here}, R-BTN-57)`);
      roles.set(fp, here);
    }
    for (const r of sections.sync_keys ?? []) {
      const fp = String(r.fingerprint);
      const prior = roles.get(fp);
      const here = r.revoked_at == null ? `sync:${r.role}` : 'sync-removed';
      if (prior != null && prior !== here) bad('sync_keys row', `${fp} holds a second role (${prior} and ${here}, R-BTN-57)`);
      roles.set(fp, here);
    }
    const creds = new Set((sections.credentials ?? []).map((r) => String(r.id)));
    for (const r of sections.runner_grants ?? []) {
      if (!str(r.credential_id) || !creds.has(r.credential_id)) bad('runner_grants row', `${JSON.stringify(r.credential_id)} is not an imported credential`);
      if (!str(r.repository_id) || !repoIds.has(r.repository_id)) bad('runner_grants row', `${JSON.stringify(r.repository_id)} is not an imported repository`);
      if (r.role != null && !['runner', 'trusted-runner'].includes(String(r.role))) bad('runner_grants row', `${r.credential_id}: role is unknown`);
      if ('deliver_interactions' in r && r.deliver_interactions !== 0 && r.deliver_interactions !== 1) bad('runner_grants row', 'deliver_interactions must be 0 or 1');
    }
    for (const r of sections.couriers ?? []) {
      if (!str(r.credential_id) || !creds.has(r.credential_id)) bad('couriers row', `${JSON.stringify(r.credential_id)} is not an imported credential`);
      if (!str(r.repository_id) || !repoIds.has(r.repository_id)) bad('couriers row', `${JSON.stringify(r.repository_id)} is not an imported repository`);
    }
    for (const r of sections.runners ?? []) {
      if (!Number.isSafeInteger(r.id)) bad('runners row', 'an integer id is required');
      if (!str(r.hostname) || !str(r.session_name)) bad('runners row', `${JSON.stringify(r.id)}: hostname and session_name are required`);
    }
    for (const table of ['closed_tickets', 'ticket_overrides']) {
      for (const r of sections[table] ?? []) {
        if (!str(r.ticket_id) || !TICKET_ID.test(r.ticket_id)) bad(`${table} row`, `ticket_id ${JSON.stringify(r.ticket_id)} is not a qualified id`);
      }
    }
  }

  /** Step 4 (§4.8): the import — one transaction, into an empty Baton of the same schema, every
   *  row through the write path's validation; ticket-scoped rows wait in `pending_owner_state`
   *  for the first snapshot that creates their ticket; the event sequence continues from
   *  `events_seq`; runners' `last_seen_at` is 0 (they resume unkeyed). A sealed source's
   *  `sealed_at` becomes the new instance's floor for signed `created` (§11.1: a pre-seal
   *  replay reaches nothing). */
  import(actor: string, body: unknown): { ok: true } {
    const b = body as OwnerStateExport;
    if (!b || typeof b !== 'object') throw new BatonError('invalid-params', 'the body is not an owner-state export');
    if (b.format !== OWNER_STATE_FORMAT) throw new BatonError('invalid-params', `the export's format is not ${OWNER_STATE_FORMAT}`);
    const mine = this.rows<{ n: number }>('SELECT COALESCE(MAX(id), 0) AS n FROM _baton_migrations')[0].n;
    if (b.schema_version !== mine) throw new BatonError('invalid-params', `the export's schema_version ${b.schema_version} is not this Baton's ${mine}`);
    const { digest: _d, ...rest } = b;
    if (typeof b.digest !== 'string' || b.digest !== sha256HexSync(canonical(rest))) {
      throw new BatonError('invalid-params', 'the export fails its digest (R-BTN-88)');
    }
    if (!this.isEmpty()) throw new BatonError('conflict', 'the import is into an empty Baton alone (R-BTN-88)');
    this.validate(b.sections ?? {});
    const importOne = (table: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return;
      const cols = this.columns(table);
      if (!cols.length) throw new BatonError('internal', `the import finds no table ${table}`);
      for (const row of rows) {
        const named = cols.filter((c) => row[c] !== undefined);
        this.c.store.exec(
          `INSERT INTO ${table} (${named.map((c) => `"${c}"`).join(', ')}) VALUES (${named.map(() => '?').join(', ')})`,
          ...named.map((c) => (row[c] instanceof ArrayBuffer ? new Uint8Array(row[c] as ArrayBuffer) : row[c])));
      }
    };
    // Ticket-scoped rows wait (§4.8): the first snapshot that creates their ticket applies them;
    // the repository's first snapshot drops and logs the ones it does not post. The marker the
    // snapshot reads is the setting below.
    const awaiting: Record<string, true> = {};
    for (const s of SECTIONS) {
      if (!s.ticketScoped) continue;
      for (const row of b.sections?.[s.table] ?? []) {
        const ticket = String(row.ticket_id);
        const repo = ticket.slice(0, ticket.indexOf(':'));
        this.c.store.exec('INSERT INTO pending_owner_state (repository_id, ticket_id, kind, key, row_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repository_id, ticket_id, kind, key) DO UPDATE SET row_json = excluded.row_json',
          repo, ticket, s.ticketScoped.kind, '', canonical(row));
        awaiting[repo] = true;
      }
    }
    if (Object.keys(awaiting).length) this.setSetting('pending_first_snapshot', JSON.stringify(Object.keys(awaiting).sort()));
    for (const s of SECTIONS) {
      if (s.ticketScoped) continue;
      const rows = (b.sections?.[s.table] ?? []).map((r) => (s.table === 'runners' ? { ...r, last_seen_at: 0, last_activity_at: 0 } : r));
      importOne(s.table, rows);
    }
    for (const s of HISTORY_SECTIONS) importOne(s.table, b.sections?.[s.table] ?? []);
    // §4.8's step 6 — the repository's first post after the move: each imported repository
    // needs its head row (the cache itself is git's to rebuild — the export holds no head), the
    // shape the registry's own seed writes, with no number ever handed out.
    for (const r of b.sections?.repositories ?? []) {
      this.c.store.exec('INSERT INTO board_head (repository_id, sha) VALUES (?, NULL) ON CONFLICT (repository_id) DO NOTHING', String(r.id));
    }
    // §4.8: the event sequence continues from the export's `events_seq` — the `imported` event
    // sits at the floor, so every event after it is above everything the source logged.
    const floor = Math.max(Number(b.events_seq) || 0, this.rows<{ n: number }>('SELECT COALESCE(MAX(seq), 0) AS n FROM events')[0].n);
    logEvent(this.c.store, this.c.now(), 'imported', actor, { events_seq: b.events_seq, origin: b.origin }, null, null, null);
    this.c.store.exec('UPDATE events SET seq = ? WHERE seq = (SELECT MAX(seq) FROM events)', Math.max(floor, 1));
    if (typeof b.exported_at === 'number' && b.exported_at > 0) this.setSetting('sign_created_floor', String(b.exported_at));
    return { ok: true };
  }

  /** The floor for a signed request's `created` (§4.8): an import sets it to the source's
   *  `sealed_at`, so a request signed before the source sealed — a captured one — reaches
   *  nothing on the instance it was replayed against. Epoch milliseconds, as `created` is. */
  signCreatedFloor(): number | null {
    const n = Number(this.setting('sign_created_floor'));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  /** §4.8: apply the pending ticket-scoped rows the post's live tickets answer to, inside the
   *  transaction that accepted it. The repository's first snapshot since the import is the
   *  judge: a pending row whose ticket it does not post is dropped and logged, and the rest
   *  wait no longer than their own ticket's first appearance. */
  applyPending(repository: string, postedLive: ReadonlySet<string>, at: number): void {
    const pending = this.rows<{ ticket_id: string; kind: string; key: string; row_json: string }>(
      'SELECT ticket_id, kind, key, row_json FROM pending_owner_state WHERE repository_id = ?', repository);
    if (!pending.length) return;
    const awaiting = new Set(JSON.parse(this.setting('pending_first_snapshot') ?? '[]') as string[]);
    const first = awaiting.has(repository);
    for (const row of pending) {
      const local = row.ticket_id.slice(repository.length + 1);
      if (postedLive.has(local)) {
        // The override's columns, as the export held them; the table's own keys decide the row.
        const value = JSON.parse(row.row_json) as Record<string, unknown>;
        if (row.kind === 'override') {
          const cols = Object.keys(value).filter((c) => c !== 'ticket_id');
          this.c.store.exec(`INSERT INTO ticket_overrides (ticket_id, ${cols.map((c) => `"${c}"`).join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})
                             ON CONFLICT (ticket_id) DO UPDATE SET ${cols.map((c) => `"${c}" = excluded."${c}"`).join(', ')}`,
            row.ticket_id, ...cols.map((c) => value[c]));
        }
        this.c.store.exec('DELETE FROM pending_owner_state WHERE repository_id = ? AND ticket_id = ? AND kind = ? AND key = ?', repository, row.ticket_id, row.kind, row.key);
      } else if (first) {
        // §4.8: one the repository's first snapshot does not post is dropped and logged.
        this.c.store.exec('DELETE FROM pending_owner_state WHERE repository_id = ? AND ticket_id = ? AND kind = ? AND key = ?', repository, row.ticket_id, row.kind, row.key);
        logEvent(this.c.store, at, 'imported', 'server', { act: 'pending-dropped', ticket: row.ticket_id, kind: row.kind }, row.ticket_id, null, repository);
      }
    }
    if (first) {
      awaiting.delete(repository);
      this.setSetting('pending_first_snapshot', awaiting.size ? JSON.stringify([...awaiting].sort()) : null);
    }
  }
}
