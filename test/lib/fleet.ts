// fleet.ts — the block scenarios' fleet (S-BTN-44, S-BTN-45; R3-1251): workers as granted SSH keys
// — the keys whose repositories readings and `uses` are judged by (R-BTN-58, R-BTN-101) — probes,
// and the GET a granted key, an owner or an administrator signs to ask what blocks a ticket.
import { ORIGIN, hbBody, keyCall, sha256, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from './sshKeys';
import { call as hostCall } from '#host';

/** A signed request by `key`, with a worker secret when given; JSON back. */
export async function signed(key: TestKey, path: string, o: { body?: unknown; secret?: string; method?: string } = {}) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const req = await signedRequest(key, ORIGIN + path, { created, method: o.method, body: o.body === undefined ? undefined : JSON.stringify(o.body), headers: o.secret ? { 'X-Worker-Secret': o.secret } : {} });
  const res = await hostCall(req);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

export interface FleetWorker {
  key: TestKey;
  id: number;
  secret: string;
  hostname: string;
  /** A heartbeat; `over` replaces fields of the body (`uses`, `capabilities`). */
  beat: (over?: Record<string, unknown>) => Promise<{ status: number; json: Record<string, any> }>;
  call: (path: string, body?: unknown, method?: string) => Promise<{ status: number; json: Record<string, any> }>;
}

/** A worker key `name` that `owner` grants on `repository` with `capabilities`, registered by a
 *  first heartbeat declaring them and using `uses`. */
export async function grantedWorker(owner: TestKey, repository: string, name: string, capabilities: string[], uses: string[] = []): Promise<FleetWorker> {
  const key = await makeKey('ssh-ed25519', name);
  const hostname = `${name}-host`;
  const g = await keyCall(owner, `/v1/owner/${repository}/grants`, { public_key: key.publicKey, hostname, capabilities });
  if (g.status !== 200) throw new Error(`grant ${name}: ${JSON.stringify(g.json)}`);
  const secret = `secret-${name}`;
  let current = { capabilities, uses };
  const body = (extra: Record<string, unknown>) => hbBody('vm-a', { hostname, session_name: name, capabilities: current.capabilities, uses: current.uses,
    courses: [{ repository, course: 'roadmap-pr', version: 3 }], ...extra });
  const first = await signed(key, '/v1/runner/heartbeat', { body: body({ secret_hash: await sha256(secret) }) });
  if (first.status !== 200) throw new Error(`register ${name}: ${JSON.stringify(first.json)}`);
  return {
    key, id: first.json.worker_id as number, secret, hostname,
    beat: async (over = {}) => {
      current = { capabilities: (over.capabilities as string[]) ?? current.capabilities, uses: (over.uses as string[]) ?? current.uses };
      return signed(key, '/v1/runner/heartbeat', { body: body(over), secret });
    },
    call: (path, b, method) => signed(key, path, { body: b, secret, method }),
  };
}

/** The account resource every scenario here shares: an `llm:` name, a schema with one optional
 *  number, served by account instances that list `docs`. */
export const SCHEMA = { type: 'object', properties: { used: { type: 'number', minimum: 0 } }, additionalProperties: false };
