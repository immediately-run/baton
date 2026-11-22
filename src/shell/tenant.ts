// R-BTN-135: object naming and the internal handshake live outside the core.
import { frontResponse } from '../core/front';
import { errorResponse } from '../core/http';
import type { Config, Store } from '../core/ports';

export const TENANT_ID = 'baton';
const HEADER = 'X-Baton-Tenant';

/** The first deployment keeps its existing object name and storage. */
export function objectId<T>(namespace: { idFromName(name: string): T }, tenant: string, part?: { kind: string; key: string }): T {
  return namespace.idFromName(part ? `${tenant}/${part.kind}/${part.key}` : tenant);
}

export function foreignHost(pathname: string, config: Config): Response {
  return frontResponse(pathname, config, errorResponse('not-found', 'no such host'));
}

export function servesHost(req: Request, origin: string): boolean {
  return new URL(req.url).host === new URL(origin).host;
}

/** Node's origin-form request target does not include its authority; use Host, not proxy hints. */
export function matchesAuthority(authority: string | undefined, origin: URL): boolean {
  if (!authority || /[\s/\\@?#%,]/.test(authority)) return false;
  try {
    return new URL(`${origin.protocol}//${authority}`).host === origin.host;
  } catch {
    return false;
  }
}

export function forTenant(req: Request, tenant: string): Request {
  const headers = new Headers(req.headers);
  headers.set(HEADER, tenant); // Replaces any client-supplied values, including duplicates.
  return new Request(req, { headers });
}

export function boundTenant(store: Pick<Store, 'exec'>): string | undefined {
  return setting(store, 'tenant_id');
}

function setting(store: Pick<Store, 'exec'>, key: string): string | undefined {
  return store.exec<{ value: string }>('SELECT value FROM baton_settings WHERE key = ?', key).toArray()[0]?.value;
}

/** Mark new storage atomically with schema creation so a restart before any request is not
 *  mistaken for an upgrade from the pre-handshake deployment. */
export function prepareTenantStore(store: Store, migrate: () => void): void {
  if (store.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'baton_settings'").toArray().length) return;
  store.transaction(() => {
    migrate();
    store.exec("INSERT INTO baton_settings (key, value) VALUES ('tenant_handshake_required', '1')");
  });
}

export function admitTenantAlarm(store: Store): boolean {
  const bound = boundTenant(store);
  if (bound !== undefined) return bound === TENANT_ID;
  if (setting(store, 'tenant_handshake_required') !== undefined) return false;
  // One-time upgrade of the existing single-tenant store. No request supplies this value.
  bind(store, TENANT_ID);
  return true;
}

function bind(store: Pick<Store, 'exec'>, id: string): void {
  store.exec("INSERT INTO baton_settings (key, value) VALUES ('tenant_id', ?)", id);
}

/** Both shells serialize this synchronous check with the object or queue's other writes. */
export function acceptTenant(store: Pick<Store, 'exec'>, req: Request, expected: string): Response | 'new' | 'existing' {
  const presented = req.headers.get(HEADER);
  // Check the expected id even on an unbound object; a bad first request cannot bind it.
  const bound = boundTenant(store);
  if (presented !== expected || (bound !== undefined && bound !== presented)) {
    console.warn('tenant-mismatch');
    return errorResponse('forbidden', 'tenant mismatch');
  }
  if (bound !== undefined) return 'existing';
  bind(store, presented);
  return 'new';
}
