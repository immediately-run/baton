// S-BTN-227 the client versions Baton serves (BATON_SPEC §15, §11.3 R-BTN-197, B-254) — the
// runner's half, Node only (the runner is a Node program; the API half is
// S-BTN-227.client-versions.test.ts on both hosts). Must hold: a runner's every call says its
// version (`Baton-Client`, `+dev` from a working tree); it warns `baton: this runner is
// <version>; Baton recommends <recommended> and refuses below <min>` at start and again when
// the served values change, never per call; answered `client-too-old` it takes no claim, logs
// the refusal with the versions, and exits non-zero — nothing installs or switches anything.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatonApi, BatonRefusal } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { raw as hostRaw } from '#host';
import { hbBody, keyCall, ORIGIN, rows, setAdminKeys, setClock, sha256, TOKENS } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-17T11:00:00Z');
/** The run's deploy (vitest.config.ts): min above the old client, recommended above min. */
const MIN = '0.1.4';
const RECOMMENDED = '0.1.5';
/** This checkout's package version — what a real `baton run` names, with `+dev`. */
const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

let dir: string;
let n = 0;
const lines: string[] = [];

/** The runner's client of Baton, as `baton run` wires it — the transport hands the request to
 *  this test's Baton unchanged, so the `Baton-Client` the runner names is its own. */
function api(client?: string): BatonApi {
  return new BatonApi({
    url: ORIGIN,
    transport: (req) => hostRaw(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
    ...(client ? { client } : {}),
  }, (line) => lines.push(line));
}

beforeEach(async () => {
  await setClock(T0);
  dir = mkdtempSync(join(tmpdir(), 'baton-227-'));
  lines.length = 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('S-BTN-227 the runner half', () => {
  it('every call carries Baton-Client — the checkout\'s own version, +dev from a working tree', async () => {
    // api() with no `client` is what a real `baton run` sends: baton/<package version>+dev.
    const seen: string[] = [];
    const a = new BatonApi({
      url: ORIGIN,
      transport: (req) => (seen.push(req.headers.get('Baton-Client')!), hostRaw(req)),
      auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
    });
    await a.heartbeat(hbBody('vm-a', { secret_hash: await sha256('s-own') }));
    expect(seen).toEqual([`baton/${PACKAGE_VERSION}+dev`]);
  });

  it('a runner below recommended warns at start and again when the served versions change, never per call', async () => {
    const a = api('baton/0.1.4');
    const body = hbBody('vm-a', { secret_hash: await sha256('s-warn') });
    expect((await a.heartbeat(body)).worker_id).toBeGreaterThan(0);
    expect(lines).toEqual([`baton: this runner is baton/0.1.4; Baton recommends ${RECOMMENDED} and refuses below ${MIN}`]);
    // The same values again say nothing.
    await a.heartbeat(body);
    expect(lines).toHaveLength(1);
    // An administrator raises the recommendation; the next answer says so, and the runner
    // warns again — the header changed, not this runner.
    const adminKey = await makeKey('ssh-ed25519', 'admin');
    await setAdminKeys(adminKey);
    expect((await keyCall(adminKey, '/v1/admin/settings', { recommended_client: '0.1.6' }, 'PUT')).status).toBe(200);
    await a.heartbeat(body);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(`baton: this runner is baton/0.1.4; Baton recommends 0.1.6 and refuses below ${MIN}`);
    // A runner at or above the recommendation says nothing at all — the raise above stands, so
    // this one runs the very version Baton now recommends.
    lines.length = 0;
    await api('baton/0.1.6').heartbeat(hbBody('vm-a', { session_name: 's-quite-new', secret_hash: await sha256('s-new') }));
    expect(lines).toEqual([]);
    // The raise was this test's own act: clear it back to the code's default for the tests that
    // follow — the clear's own answer teaches the front the served value again (R-BTN-197).
    expect((await keyCall(adminKey, '/v1/admin/settings', { recommended_client: null }, 'PUT')).status).toBe(200);
  });

  it('a sync — the API\'s other client, sharing BatonApi — is warned as itself, never as a runner (R-BTN-197)', async () => {
    const answered = new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Baton-Client-Versions': `min=${MIN}, recommended=${RECOMMENDED}` } });
    const sync = new BatonApi({
      url: ORIGIN,
      transport: () => Promise.resolve(answered),
      auth: () => ({}),
      client: 'baton/0.1.4',
      kind: 'sync',
    }, (line) => lines.push(line));
    await sync.releaseObservation(1).catch(() => {});
    expect(lines).toEqual([`baton: this sync is baton/0.1.4; Baton recommends ${RECOMMENDED} and refuses below ${MIN}`]);
  });

  it('a runner below min is refused naming the versions, takes no claim, and the loop exits non-zero', async () => {
    const a = api('baton/0.1.3');
    // The refusal carries the versions it names, for the runner's log.
    const refusal = await a.heartbeat(hbBody('vm-a', { secret_hash: await sha256('s-old') })).then(() => null, (e: unknown) => e as BatonRefusal);
    expect(refusal).toMatchObject({ code: 'client-too-old', status: 426, versions: { client: '0.1.3', min: MIN, recommended: RECOMMENDED } });
    // The runner's loop: the first beat's refusal propagates out of the claim attempt (no claim
    // is taken), and work() logs the versions and exits non-zero — its one answer to a deploy
    // that refuses it, never a retry loop against a wall.
    const runner = new Runner({
      api: a, home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
      session: `s-227-${++n}`, courses: [{ course: 'roadmap-pr', version: 3 }],
      stateFile: join(dir, `state-${n}.json`), beatEvery: 40, now: () => T0, log: (line: string) => lines.push(line),
    });
    await expect(runner.runOnce()).rejects.toMatchObject({ code: 'client-too-old' });
    expect(await rows('SELECT COUNT(*) AS n FROM claims')).toEqual([{ n: 0 }]);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exited'); }) as never);
    await expect(runner.work()).rejects.toThrow('exited');
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.some((l) => l.includes('this runner is baton/0.1.3') && l.includes(`min ${MIN}`) && l.includes(`recommended ${RECOMMENDED}`))).toBe(true);
  });
});
