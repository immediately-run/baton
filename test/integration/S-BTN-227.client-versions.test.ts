// S-BTN-227 the client versions Baton serves (BATON_SPEC §15, §11.3 R-BTN-197, B-254), the API
// half, on both hosts. Must hold: a Baton that under the test bindings serves `min` 0.1.4
// (vitest.config.ts's TEST_MIN_CLIENT; the code's MIN_CLIENT is a constant, 0.0.0, and nothing
// in the field raises it) and `recommended` 0.1.5 (the code's RECOMMENDED_CLIENT) answers a
// client below `min` — `baton/0.1.3`, or no `Baton-Client` at all, compared as `0.0.0`, or a
// claim no short validated string would make (R-BTN-33) — with one `client-too-old` (426)
// naming the client's version, `min` and `recommended`, before its signature is checked and
// with nothing written; `baton/0.1.4`, `baton/0.1.4+dev` (`+dev` no part of the comparison) and
// `baton/0.1.5` are served, every response under /v1 carrying `Baton-Client-Versions:
// min=0.1.4, recommended=0.1.5`; `admin settings set --recommended-client` raises the
// recommendation to 0.1.6 — on the core's answers and the front's own refusals alike — and a
// value below the code's is `invalid-params`; every runner call records its `Baton-Client` as
// the runner's `client_version`, and Needs you lists a live runner below `recommended` with its
// version; a runner below `min` takes no claim, and the claim it held ends as its lease lapses.
// The runner's own half — the warning, the refusal, the exit — is S-BTN-227.runner.test.ts
// (Node only).
import { describe, it, expect, beforeEach } from 'vitest';
import { claimItem, course, cutover, Git, hbBody, HOST, keyCall, ORIGIN, rawCall, rows, setAdminKeys, setClock, sha256, syncToken, tick, withCore, runnerCall, SSH_KEYS } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-17T10:00:00Z');
const SERVED = 'min=0.1.4, recommended=0.1.5';

let admin: TestKey;

/** A request to Baton exactly as built: the version the client names is the test's own, never
 *  the harness's (R-BTN-197: the header is a claim the client makes). */
const at = (client: string | null, path: string, init: RequestInit = {}) => {
  const headers = { ...(init.headers as Record<string, string> | undefined), ...(client ? { 'Baton-Client': client } : {}) };
  return rawCall(new Request(ORIGIN + path, { ...init, headers }));
};

/** `GET /v1/sync/head` with the run's sync token — an unsigned client — at `client`'s version. */
const read = async (client: string | null) =>
  at(client, '/v1/sync/head', { headers: { Authorization: `Bearer ${await syncToken()}` } });

/** The same read, signed by a test key (R-BTN-13's shape; the core would judge the key's role —
 *  a refusal below `min` comes before that judgement, and never depends on it). */
const readSigned = async (client: string | null) =>
  rawCall(await signedRequest(SSH_KEYS['vm-ed'], `${ORIGIN}/v1/sync/head`, { headers: { ...(client ? { 'Baton-Client': client } : {}) } }));

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
});

describe(`S-BTN-227 the client versions Baton serves (${HOST})`, () => {
  it('a client below min is answered client-too-old naming the versions, unsigned or signed alike, and nothing is written', async () => {
    const eventsBefore = (await rows<{ n: number }>('SELECT COUNT(*) AS n FROM events'))[0].n;
    // A claim longer than the short validated string R-BTN-33 makes `client_version` is no
    // statement at all: it compares as no header (0.0.0) and is never stored or echoed.
    const overlong = `baton/0.1.3-${'a'.repeat(80)}`;
    const claims = [
      { header: 'baton/0.1.3', claimed: '0.1.3' },
      { header: null, claimed: '0.0.0' },
      { header: overlong, claimed: '0.0.0' },
    ];
    for (const { header, claimed } of claims) {
      for (const answer of [read, readSigned]) {
        const res = await answer(header);
        expect([header, res.status]).toEqual([header, 426]);
        expect(res.headers.get('Baton-Client-Versions')).toBe(SERVED);
        expect(await res.json()).toMatchObject({ ok: false, code: 'client-too-old', client: claimed, min: '0.1.4', recommended: '0.1.5' });
      }
    }
    // Before the signature is checked (the signed requests above were well formed) and before
    // anything is read or written: no nonce row, no event, no credential or runner row.
    expect(await rows('SELECT COUNT(*) AS n FROM request_nonces')).toEqual([{ n: 0 }]);
    expect(await rows<{ n: number }>('SELECT COUNT(*) AS n FROM events')).toEqual([{ n: eventsBefore }]);
    expect(await rows('SELECT COUNT(*) AS n FROM runners')).toEqual([{ n: 0 }]);
  });

  it('clients at min and above are served — +dev no part of the comparison — and every /v1 response carries the versions', async () => {
    for (const client of ['baton/0.1.4', 'baton/0.1.4+dev', 'baton/0.1.5']) {
      const unsigned = await read(client);
      expect([client, unsigned.status, unsigned.headers.get('Baton-Client-Versions')]).toEqual([client, 200, SERVED]);
      const signed = await readSigned(client);
      // Served — never the version refusal; the answer is the key's own (its role is not this
      // scenario's question).
      expect(signed.status).not.toBe(426);
      expect(signed.headers.get('Baton-Client-Versions')).toBe(SERVED);
    }
    // A refusal included: a route that is not one still states the versions, and so does the
    // front's own unauthenticated refusal of a versionless reader.
    const missing = await at('baton/0.1.4', '/v1/no-such-route', { method: 'POST', body: '{}' });
    expect([missing.status, missing.headers.get('Baton-Client-Versions')]).toEqual([404, SERVED]);
    const refused = await at('baton/0.1.5', '/v1/sync/head');
    expect([refused.status, refused.headers.get('Baton-Client-Versions')]).toEqual([401, SERVED]);
    // The dashboard's pages are not under /v1 and carry nothing.
    expect((await at(null, '/')).headers.get('Baton-Client-Versions')).toBeNull();
  });

  it('admin settings set --recommended-client raises the recommendation, refuses one below the code\'s, and served answers carry the raise', async () => {
    const raise = await keyCall(admin, '/v1/admin/settings', { recommended_client: '0.1.6' }, 'PUT');
    expect([raise.status, raise.json]).toEqual([200, { ok: true }]);
    const lower = await keyCall(admin, '/v1/admin/settings', { recommended_client: '0.1.3' }, 'PUT');
    expect([lower.status, lower.json.code]).toEqual([400, 'invalid-params']);
    expect(await rows('SELECT recommended_client FROM instance_settings WHERE id = 1')).toEqual([{ recommended_client: '0.1.6' }]);
    // The core's own answers carry the raised recommendation.
    const served = await read('baton/0.1.4');
    expect(served.headers.get('Baton-Client-Versions')).toBe('min=0.1.4, recommended=0.1.6');
    // And so does every answer the front builds itself, having learned it from the core's: its
    // own refusal of a versionless reader (401) and the one answer an old client reads (426).
    const refused = await at('baton/0.1.5', '/v1/sync/head');
    expect([refused.status, refused.headers.get('Baton-Client-Versions')]).toEqual([401, 'min=0.1.4, recommended=0.1.6']);
    const old = await read('baton/0.1.3');
    expect([old.status, old.headers.get('Baton-Client-Versions')]).toEqual([426, 'min=0.1.4, recommended=0.1.6']);
    // A clear returns to the code's default.
    expect((await keyCall(admin, '/v1/admin/settings', { recommended_client: null }, 'PUT')).status).toBe(200);
    expect((await read('baton/0.1.5')).headers.get('Baton-Client-Versions')).toBe(SERVED);
  });

  it('every runner call records its Baton-Client, and Needs you lists a live runner below the recommendation', async () => {
    const secret = 's-227';
    const first = await runnerCall('/v1/runner/heartbeat', { cred: 'vm-a', body: hbBody('vm-a', { secret_hash: await sha256(secret) }), client: 'baton/0.1.4' });
    expect(first.status).toBe(200);
    const id = ((await first.json()) as { runner_id: number }).runner_id;
    expect(await rows('SELECT client_version FROM runners WHERE id = ?', id)).toEqual([{ client_version: '0.1.4' }]);
    // The last call's statement is the one recorded — a later call at another version moves it.
    await runnerCall('/v1/runner/mode?repository=docs', { cred: 'vm-a', secret, method: 'GET', client: 'baton/0.1.4+dev' });
    expect(await rows('SELECT client_version FROM runners WHERE id = ?', id)).toEqual([{ client_version: '0.1.4+dev' }]);
    await runnerCall('/v1/runner/heartbeat', { cred: 'vm-a', secret, body: hbBody('vm-a'), client: 'baton/0.1.4' });
    expect(await rows('SELECT client_version FROM runners WHERE id = ?', id)).toEqual([{ client_version: '0.1.4' }]);
    // Below the code's recommended (0.1.5) the live runner is listed, with its version.
    const listed = await withCore((c) => c.stateView().needs_you.stale_clients as { hostname: string; session_name: string; client_version: string; recommended: string }[]);
    expect(listed).toEqual([{ hostname: 'vm-a', session_name: 's-vm-a', client_version: '0.1.4', recommended: '0.1.5' }]);
  });

  it('a runner below min takes no claim and the claim it held ends as its lease lapses', async () => {
    const git = new Git().add('T-1');
    git.registry = [course(3, 3)];
    expect((await git.post()).status).toBe(200);
    await cutover();
    // The runner registers and claims at 0.1.4; its next call comes from a client below min (an
    // update that moved it back), and every call of its own is refused before anything is read
    // or written.
    const secret = 's-227b';
    const boot = await runnerCall('/v1/runner/heartbeat', { cred: 'vm-b', body: hbBody('vm-b', { secret_hash: await sha256(secret) }), client: 'baton/0.1.4' });
    expect(boot.status).toBe(200);
    const claim = await claimItem('vm-b', secret, {}, 'baton/0.1.4');
    expect(claim.status).toBe(200);
    const claimId = claim.json.claim_id as number;
    const beat = await runnerCall('/v1/runner/heartbeat', { cred: 'vm-b', secret, body: hbBody('vm-b'), client: 'baton/0.1.3' });
    const refused = await beat.json() as Record<string, any>;
    expect([beat.status, refused.code, refused.client, refused.min, refused.recommended]).toEqual([426, 'client-too-old', '0.1.3', '0.1.4', '0.1.5']);
    // No claim is taken by the refused client, and the claim it held stands untouched.
    expect((await claimItem('vm-b', secret, { ticket_id: 'docs:T-2' }, 'baton/0.1.3')).status).toBe(426);
    expect(await rows('SELECT status FROM claims')).toEqual([{ status: 'active' }]);
    // R-BTN-9: the lease lapses, and the alarm reaps the claim — the runner's one way out.
    await setClock(T0 + 16 * 60_000);
    await tick();
    expect(await rows('SELECT status FROM claims WHERE id = ?', claimId)).toEqual([{ status: 'reaped' }]);
  });
});
