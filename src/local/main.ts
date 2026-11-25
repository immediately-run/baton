// main.ts — `npm run start:local -- --db <path> --port <n>` (BATON_SPEC §3a R-BTN-55, R-BTN-57).
// Options, never a `.dev.vars` file: `--origin` (default `http://127.0.0.1:<port>`), `--admin-keys
// <file>` and `--human-keys <file>` (one OpenSSH public key per line), `--access-identities <file>` (R-BTN-155),
// `--github-webhook-secret <file>` (R-BTN-73),
// and `--config <file>`, a JSON object of the
// Runner's other variables and secrets (OIDC_ISSUER, OIDC_JWKS_URL, BATON_REPOSITORIES — the
// repositories to register, as a JSON string —, ACCESS_*, OWNER_EMAILS, TOKEN_HASHES,
// CREDENTIALS, BATON_KEYS, BATON_GITHUB_WEBHOOK_SECRET, BATON_FORGE_SECRETS,
// BATON_SESSION_HOSTS — the hosts whose session links the instance accepts, R-BTN-113 —,
// GITHUB_DISPATCH_TOKEN). The test
// bindings are refused: only the test harness, in-process, may set them.
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseAdminKeys } from '../core/auth';
import { BatonError } from '../core/http';
import type { AccessIdentities, Config } from '../core/ports';
import { LocalHost } from './host';
import { fileEventArchive } from './eventArchive';
import { serve } from './server';
import { openStore } from './store';

const TEST_ONLY = /^(BATON_TEST_BINDINGS|TEST_.*)$/;

/** Whether `--host` names one address clients can use, so the default origin can be built
 *  from it: an IP address that is not the unspecified one (in any spelling), or `localhost`. */
export function concreteHost(host: string): boolean {
  if (host === 'localhost') return true;
  if (isIP(host) === 4) return !host.split('.').every((o) => Number(o) === 0);
  if (isIP(host) === 6) {
    try {
      return new URL(`http://[${host}]`).hostname !== '[::]';
    } catch {
      return false; // a zone id (`fe80::1%eth0`) is not an origin's host
    }
  }
  return false;
}

/** The instance's Config from the `--config` object and the origin; refuses test bindings and
 *  anything that is not a string. */
export function localConfig(file: Record<string, unknown>, origin: string): Config {
  for (const [k, v] of Object.entries(file)) {
    if (TEST_ONLY.test(k)) throw new Error(`${k}: test bindings are never accepted by a local start`);
    if (typeof v !== 'string') throw new Error(`${k}: must be a string`);
  }
  const s = (k: string, d = '') => (typeof file[k] === 'string' ? (file[k] as string) : d);
  const opt = (k: string) => (typeof file[k] === 'string' ? (file[k] as string) : undefined);
  return {
    BATON_ORIGIN: origin,
    OIDC_ISSUER: s('OIDC_ISSUER', 'https://token.actions.githubusercontent.com'),
    OIDC_JWKS_URL: s('OIDC_JWKS_URL', 'https://token.actions.githubusercontent.com/.well-known/jwks'),
    BATON_REPOSITORIES: opt('BATON_REPOSITORIES'),
    ACCESS_TEAM_DOMAIN: s('ACCESS_TEAM_DOMAIN'),
    ACCESS_AUD: s('ACCESS_AUD'),
    OWNER_EMAILS: s('OWNER_EMAILS'),
    TOKEN_HASHES: opt('TOKEN_HASHES'),
    CREDENTIALS: opt('CREDENTIALS'),
    BATON_KEYS: opt('BATON_KEYS'),
    BATON_FORGE_BROKER_KEYS: opt('BATON_FORGE_BROKER_KEYS'),
    BATON_SESSION_HOSTS: opt('BATON_SESSION_HOSTS'),
    BATON_HUMAN_KEY: opt('BATON_HUMAN_KEY'),
    BATON_HUMAN_KEYS: opt('BATON_HUMAN_KEYS'),
    BATON_IDLE_NOTIFY_AFTER_S: opt('BATON_IDLE_NOTIFY_AFTER_S'),
    BATON_GITHUB_WEBHOOK_SECRET: opt('BATON_GITHUB_WEBHOOK_SECRET'),
    BATON_FORGE_SECRETS: opt('BATON_FORGE_SECRETS'),
    GITHUB_DISPATCH_TOKEN: opt('GITHUB_DISPATCH_TOKEN'),
  };
}

export async function main(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: 'string' },
      port: { type: 'string', default: '8787' },
      host: { type: 'string', default: '127.0.0.1' },
      origin: { type: 'string' },
      'admin-keys': { type: 'string' },
      'human-keys': { type: 'string' },
      'access-identities': { type: 'string' },
      'github-webhook-secret': { type: 'string' },
      'event-archive': { type: 'string' },
      'signing-key': { type: 'string' }, // Retired; accept old launch commands without reading the file.
      config: { type: 'string' },
    },
  });
  if (!values.db) throw new Error('--db <path> is required (the SQLite file; created if absent)');
  const archive = values['event-archive'];
  if (archive !== undefined && (!archive.trim() || resolve(archive) === resolve(values.db))) {
    throw new Error('--event-archive must name a separate NDJSON file');
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a port number');
  // The origin is the OIDC audience and the dashboard's Origin (R-BTN-56): it must be the
  // address clients use, so it is derived only from a concrete host and port.
  if (!values.origin && (port === 0 || !concreteHost(values.host!))) {
    throw new Error('--origin is required with --port 0, or a --host that is not one IP address or localhost: the origin must be the address clients use');
  }
  const bind = values.host!.includes(':') ? `[${values.host}]` : values.host;
  const origin = (values.origin ?? `http://${bind}:${port}`).replace(/\/+$/, '');
  // R-BTN-56: an origin verbatim — scheme and host (and port), no path.
  let parsed: string | null = null;
  try {
    parsed = new URL(origin).origin;
  } catch {
    parsed = null;
  }
  if (parsed !== origin) throw new Error(`--origin ${origin}: must be an origin, such as https://baton.example.com or http://127.0.0.1:8787, with no path`);
  const file = values.config ? JSON.parse(readFileSync(values.config, 'utf8')) : {};
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('--config must hold a JSON object');

  const { store } = openStore(values.db);
  const config = localConfig(file, origin);
  // R-BTN-55: the GitHub App's webhook secret, from the file `--github-webhook-secret` names
  // (a file, so the secret is in no process list); it wins over a --config value.
  if (values['github-webhook-secret']) config.BATON_GITHUB_WEBHOOK_SECRET = readFileSync(values['github-webhook-secret'], 'utf8').trim();
  const host = new LocalHost({ store, config, adminKeys: adminKeysFrom(values['admin-keys']), accessIdentities: accessIdentitiesFrom(values['access-identities']),
    humanKeys: values['human-keys'] ? adminKeysFrom(values['human-keys']) : undefined,
    archiveEvents: archive ? fileEventArchive(archive, values.db === ':memory:' ? null : resolve(values.db)) : undefined });
  await host.start();
  const server = serve(host, origin);
  server.listen(port, values.host, () => console.log(`baton: serving ${origin} from ${values.db}`));
  const stop = () => server.close(() => host.stop().then(() => process.exit(0)));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/** The administrators' keys from the file `--admin-keys` names (R-BTN-57), read on every call as
 *  BATON_ADMIN_KEYS is on Cloudflare: a key taken out of the file ends its sessions at their next
 *  request (round 3, 3-A-4). A file that cannot be read lists no administrator — fail closed. */
export function adminKeysFrom(path: string | undefined): { list: () => string[] } {
  return {
    list: () => {
      if (!path) return [];
      try {
        return parseAdminKeys(readFileSync(path, 'utf8'));
      } catch {
        return [];
      }
    },
  };
}

/** The local Access binding is re-read like the administrator keys, not loaded at startup. */
export function accessIdentitiesFrom(path: string | undefined): AccessIdentities {
  return {
    read: () => {
      if (!path) return '';
      try {
        return readFileSync(path, 'utf8');
      } catch {
        throw new BatonError('unavailable', 'the Access identities file could not be read');
      }
    },
  };
}
