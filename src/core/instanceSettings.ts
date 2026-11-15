// instanceSettings.ts — the administrators' instance settings (BATON_SPEC §13.1, §11.2 R-BTN-57;
// B-4): one row — `link_hosts`, `session_hosts` and `check_app_id` — behind `PUT
// /v1/admin/settings`, which an administrator's key alone signs. The session-host list is what
// R-BTN-113's link rule reads: a `session_url` whose host it does not name is dropped and logged,
// never a refused call. Until an administrator sets `session_hosts`, the deploy's
// BATON_SESSION_HOSTS stands (B-234's interim home of the same rule), whose default is claude.ai
// alone — so an upgrade changes no instance's allowlist.
import { BatonError } from './http';
import { logEvent } from './db';
import { SESSION_HOSTS } from './links';
import type { Config, Store } from './ports';

/** Spec-silent bounds, recorded as the owner settings' are (admin.ts): hosts per list, and a
 *  host's own length (a DNS name's 253). */
export const HOSTS_MAX = 32;
const HOST_MAX = 253;
/** A hostname as a URL's `hostname` lowercases it: labels of letters, digits and hyphens, none
 *  starting or ending in a hyphen, dot-separated. A single label is a host (`localhost`). */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};

/** A host list as `PUT /v1/admin/settings` takes it: null to clear the setting (its column's
 *  default stands again), or at most `HOSTS_MAX` hostnames, each named once — lowercased, as the
 *  link rule compares them. An empty list is allowed: for `session_hosts` it allows nothing,
 *  which is a safe direction, never a silent reset to the default. */
function checkHosts(v: unknown, field: string): string[] | null {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length > HOSTS_MAX
    || !v.every((h) => typeof h === 'string' && h.length <= HOST_MAX && HOST.test((h as string).trim().toLowerCase()))) {
    bad(field, `must be null or a list of at most ${HOSTS_MAX} hostnames`);
  }
  const hosts = (v as string[]).map((h) => h.trim().toLowerCase());
  if (new Set(hosts).size !== hosts.length) bad(field, 'names a host twice');
  return hosts;
}

export class InstanceSettings {
  constructor(private readonly c: { store: Store; now: () => number; config?: Config }) {}

  private row(): { link_hosts: string; session_hosts: string | null; check_app_id: string | null } | null {
    return this.c.store.exec<{ link_hosts: string; session_hosts: string | null; check_app_id: string | null }>(
      'SELECT link_hosts, session_hosts, check_app_id FROM instance_settings WHERE id = 1').toArray()[0] ?? null;
  }

  /** A host column's list: the row's when set, else the deploy's config (claude.ai alone by
   *  default) — the one fallback both reads share. */
  private hostsOf(raw: string | null): string[] {
    return raw == null ? SESSION_HOSTS.of(this.c.config ?? {}) : JSON.parse(raw) as string[];
  }

  /** R-BTN-113's allowlist: the row's `session_hosts` where an administrator set one, else the
   *  deploy's BATON_SESSION_HOSTS (default claude.ai). */
  sessionHosts(): string[] {
    return this.hostsOf(this.row()?.session_hosts ?? null);
  }

  /** R-BTN-112's hosts, whose links a view may draw (§12.3's `link_hosts`; default empty). */
  linkHosts(): string[] {
    return JSON.parse(this.row()?.link_hosts ?? '[]') as string[];
  }

  /** §12.7 R-BTN-115: the check App's id, when an administrator set one. */
  checkAppId(): string | null {
    return this.row()?.check_app_id ?? null;
  }

  /** `PUT /v1/admin/settings` (§14, R-BTN-57): each given setting replaces its own whole; `null`
   *  clears it back to what stands without it. Each act is an `admin` event, as every
   *  administrator's is. */
  set(actor: string, body: unknown): { ok: true } {
    if (!isObj(body)) bad('body', 'must be a JSON object');
    const b = body as Record<string, unknown>;
    for (const k of Object.keys(b)) if (!['link_hosts', 'session_hosts', 'check_app_id'].includes(k)) bad(`body.${k}`, 'unknown field');
    if (!Object.keys(b).length) bad('body', 'names at least one setting');
    const link = b.link_hosts === undefined ? undefined : checkHosts(b.link_hosts, 'link_hosts');
    const session = b.session_hosts === undefined ? undefined : checkHosts(b.session_hosts, 'session_hosts');
    // §12.7: GitHub's App ids are numeric — the check App's is what `baton admin check-app create`
    // writes here.
    const app = b.check_app_id === undefined ? undefined
      : b.check_app_id === null ? null
        : typeof b.check_app_id === 'string' && /^\d{1,21}$/.test(b.check_app_id) ? b.check_app_id
          : bad('check_app_id', 'must be null or the check App’s numeric id (§12.7)');
    return this.c.store.transaction(() => {
      if (link !== undefined) this.c.store.exec('UPDATE instance_settings SET link_hosts = ? WHERE id = 1', JSON.stringify(link));
      if (session !== undefined) this.c.store.exec('UPDATE instance_settings SET session_hosts = ? WHERE id = 1', session === null ? null : JSON.stringify(session));
      if (app !== undefined) this.c.store.exec('UPDATE instance_settings SET check_app_id = ? WHERE id = 1', app);
      logEvent(this.c.store, this.c.now(), 'admin', actor, { act: 'instance-settings',
        ...(link !== undefined ? { link_hosts: link } : {}), ...(session !== undefined ? { session_hosts: session } : {}),
        ...(app !== undefined ? { check_app_id: app } : {}) }, null, null, null);
      return { ok: true };
    });
  }

  /** The state read's instance section (§11.4's tenant settings): the row's settings, the session
   *  hosts as they stand — the list the client's link gate checks against (§12.3). */
  view(): { link_hosts: string[]; session_hosts: string[]; check_app_id: string | null } {
    const r = this.row();
    return {
      link_hosts: r ? JSON.parse(r.link_hosts) as string[] : [],
      session_hosts: this.hostsOf(r?.session_hosts ?? null),
      check_app_id: r?.check_app_id ?? null,
    };
  }
}
