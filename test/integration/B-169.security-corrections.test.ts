// B-169, the security review's corrections built (BATON_SPEC §15 S-BTN-42, S-BTN-68 and
// S-BTN-124; R-BTN-73, R-BTN-114, R-BTN-16): a delivery of 26,214,401 bytes is `too-large`
// before any digest, on `/v1/github/webhook` and on `/v1/forges/{repository}/notify`, under a
// forged signature too (the size is judged first), while 26,214,400 is read and judged by its
// signature; the owners' `checks` map is refused when it names two `success` stations, none
// `failure`, a `neutral` or a station its course lacks, accepted where it names none, any
// owner key sets a course's first map, and under a human-only `approvers.policy` the plain
// owner key's change is refused whichever way it moves while the human key's lands; every
// answer a credential or a session authorizes carries `Cache-Control: no-store`. The masking
// pattern is B-169's one definition, checked in test/unit/mask.test.ts. Runs on both hosts.
import { describe, it, expect, inject, beforeEach } from 'vitest';
import { call as hostCall } from '#host';
import { adminSession, course, syncToken, keyCall, ORIGIN, payload, rows, setAdminKeys, setClock, setHumanKeys, setPolicySigningKey, sessionCall, syncCall, withCore } from '../helpers';
import { makeKey, sshsig, signedRequest, type TestKey } from '../lib/sshKeys';
import { MAX_DELIVERY } from '../../src/core/webhook';

const board = inject('board');
const T0 = Date.parse('2026-10-30T12:00:00Z');
let admin: TestKey;
let owner: TestKey;
let human: TestKey;
let breakGlass: TestKey;

/** A signed call by an arbitrary key, with a body as given (`undefined`: none). */
async function as(key: TestKey, path: string, body?: unknown, method?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created, method, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, any> };
}

/** A course whose three ends a check's map names; the check-course half of R-BTN-153
 *  (`end_leg`, `check_command`) is B-175's build. */
const CHECK_COURSE = {
  start: 'filed',
  start_leg: 'check',
  end: ['passed', 'failed', 'hung'],
  stations: { filed: { label: 'Filed' }, passed: { label: 'Passed' }, failed: { label: 'Failed' }, hung: { label: 'Hung' } },
  legs: { check: { from: ['filed'], to: ['passed', 'failed', 'hung'] } },
};
const PASS = { passed: 'success', failed: 'failure', hung: 'timed_out' };

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  human = await makeKey('ssh-ed25519', 'human');
  breakGlass = await makeKey('ssh-ed25519', 'break-glass');
  await setAdminKeys(admin);
  await setPolicySigningKey();
  { const reg = await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', forge: 'github', remote: 'ssh://git@github.com/immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', sync_keys: [], owner_keys: [owner.publicKey] }); expect(reg.status).toBe(200); }
  // The check course's file rides a post's own registry (R-BTN-48); the owner's repository takes it.
  const withCheck = await syncCall('/v1/sync/board', payload(board.shas.A, null, { ...board.states.A, registry: [course(), { id: 'check', version: 1, min_worker_version: 1, skill: 'next-roadmap-item', course: CHECK_COURSE, step_kinds: ['implement'], branch_pattern: 'claude/{ticket}-*' }] }), await syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' }));
  expect((await withCheck.json() as Record<string, unknown>).ok).toBe(true);
  expect(await rows<{ id: string }>('SELECT id FROM courses WHERE repository_id = ? AND id = ?', 'ops', 'check')).toEqual([{ id: 'check' }]);
});

/** Register `key` as a human-only key (by break-glass) and add it as an owner, `human_only`. */
async function addHumanOwner(repository: string) {
  await setHumanKeys(breakGlass);
  const blob = await sshsig(breakGlass, new TextEncoder().encode(human.publicKey.trim()), 'baton-human-keys@1');
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(breakGlass, ORIGIN + '/v1/human-keys', {
    created, method: 'POST', body: JSON.stringify({ public_key: human.publicKey, signature: btoa(String.fromCharCode(...blob)) }),
  }));
  expect(res.status).toBe(200);
  expect((await as(owner, `/v1/owner/${repository}/owners`, { public_key: human.publicKey })).status).toBe(200);
  expect((await rows<{ human_only: number }>('SELECT human_only FROM repository_owners WHERE fingerprint = ?', human.fingerprint))[0].human_only).toBe(1);
}

describe('B-169 the security review’s corrections', () => {
  it('a 26,214,401-byte delivery is too-large before any digest on both routes; 26,214,400 is not', async () => {
    const body = (n: number) => 'x'.repeat(n);
    // Built by hand so the Content-Length is the body's own, as Node's listener sends it.
    for (const path of ['/v1/github/webhook', '/v1/forges/ops/notify']) {
      const over = await hostCall(new Request(ORIGIN + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64), 'X-GitHub-Event': 'push' }, body: body(MAX_DELIVERY + 1),
      }));
      expect([path, over.status, (await over.json() as Record<string, unknown>).code]).toEqual([path, 413, 'too-large']);
    }
    // A chunked body under the cap is read whole and then judged by its signature — never by size.
    const under = await hostCall(new Request(ORIGIN + '/v1/github/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64), 'X-GitHub-Event': 'push' }, body: body(MAX_DELIVERY),
    }));
    expect([under.status, (await under.json() as Record<string, unknown>).code]).toEqual([401, 'unauthenticated']);
  });

  it('a checks map names exactly one success, one failure and at most one timed_out', async () => {
    const good = { check: { name: 'baton check', conclusions: PASS } };
    expect((await as(owner, '/v1/owner/ops/settings', { checks: good }, 'PUT')).status).toBe(200);
    const two: Record<string, 'success' | 'failure' | 'timed_out'> = { passed: 'success', failed: 'success' };
    const bad: [Record<string, unknown>, string][] = [
      [{ check: { conclusions: two } }, 'checks.check.conclusions'],
      [{ check: { conclusions: { passed: 'success', hung: 'timed_out' } } }, 'checks.check.conclusions'],
      [{ check: { conclusions: { passed: 'success', failed: 'failure', hung: 'failure' } } }, 'checks.check.conclusions'],
      [{ check: { conclusions: { passed: 'success', failed: 'failure', hung: 'neutral' } } }, 'checks.check.conclusions.hung'],
      [{ check: { conclusions: { passed: 'success', failed: 'failure', elsewhere: 'timed_out' } } }, 'checks.check.conclusions.elsewhere'],
      [{ nowhere: { conclusions: PASS } }, 'checks.nowhere'],
    ];
    for (const [checks, field] of bad) {
      const out = await as(owner, '/v1/owner/ops/settings', { checks }, 'PUT');
      expect([out.status, out.json.code, String(out.json.message).startsWith(`${field}:`)]).toEqual([400, 'invalid-params', true]);
    }
    // A map without `timed_out` is valid: a timeout falls back to failure (R-BTN-153).
    expect((await as(owner, '/v1/owner/ops/settings', { checks: { check: { conclusions: { passed: 'success', failed: 'failure' } } } }, 'PUT')).status).toBe(200);
    expect(JSON.parse((await rows<{ checks: string }>('SELECT checks FROM repositories WHERE id = ?', 'ops'))[0].checks)).toEqual({ check: { conclusions: { passed: 'success', failed: 'failure' } } });
    // Registering a check-runner stays approvers.members' route: `checks` names no runner.
    expect(await rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'check_runners'")).toEqual([]);
  });

  it('under a human-only approvers.policy a checks change is forbidden to the owner key and accepted by the human key, whichever way it moves', async () => {
    await addHumanOwner('ops');
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected' }, 'PUT')).status).toBe(200);
    const set = (checks: unknown, key: TestKey = owner) => as(key, '/v1/owner/ops/settings', { checks }, 'PUT');
    const stored = async () => JSON.parse((await rows<{ checks: string }>('SELECT checks FROM repositories WHERE id = ?', 'ops'))[0].checks);
    // Under a human-only list every `checks` change is the approver list's: a course added (a
    // tightening), and, from the human key's map, a swap (toward `success`) and a dropped station.
    for (const conclusions of [PASS, { passed: 'failure', failed: 'success', hung: 'timed_out' }, { passed: 'success', failed: 'failure' }]) {
      const out = await set({ check: { conclusions } });
      expect([out.status, out.json.code]).toEqual([403, 'forbidden']);
    }
    expect(await stored()).toEqual({});
    expect((await set({ check: { conclusions: PASS } }, human)).status).toBe(200);
    expect(await stored()).toEqual({ check: { conclusions: PASS } });
    expect((await set({ check: { conclusions: { passed: 'failure', failed: 'success', hung: 'timed_out' } } }, human)).status).toBe(200);
    expect(await stored()).toEqual({ check: { conclusions: { passed: 'failure', failed: 'success', hung: 'timed_out' } } });
  });

  it('a course added is a tightening any owner key makes; each way it moves from there is governed by the approver list', async () => {
    const set = (checks: unknown, key: TestKey = owner) => as(key, '/v1/owner/ops/settings', { checks }, 'PUT');
    // A course's first map governs nothing yet: any owner key sets it.
    expect((await set({ check: { conclusions: PASS } })).status).toBe(200);
    // A human-only approvers.policy refuses the plain owner key however the map moves — toward
    // `success` (a swap), or away from it (a `timed_out` station dropped is a removal).
    await addHumanOwner('ops');
    expect((await as(owner, '/v1/owner/ops/policy', { base_version: 1, preset: 'protected' }, 'PUT')).status).toBe(200);
    for (const conclusions of [
      PASS, // a course added
      { passed: 'failure', failed: 'success', hung: 'timed_out' }, // a swap: a station now success
    ]) {
      const out = await set({ check: { conclusions } });
      expect([out.status, out.json.code]).toEqual([403, 'forbidden']);
    }
  });

  it('every answer a credential or a session authorizes carries Cache-Control: no-store, and a public page does not', async () => {
    // A dashboard session's read (S-BTN-124), and the sign-in that hands out the cookie.
    const cookie = await adminSession(admin);
    const state = await sessionCall(cookie, '/v1/ui/state');
    expect([state.status, state.headers.get('Cache-Control')]).toEqual([200, 'no-store']);
    // Every other path a session answers carries it too: a bare `/v1/ui` and an `/ui/` path that
    // is no public file (both `not-found`, both authorized by the session — R-BTN-16).
    for (const path of ['/v1/ui', '/v1/ui/', '/ui/unknown']) {
      const answered = await sessionCall(cookie, path);
      expect([path, answered.status, answered.headers.get('Cache-Control')]).toEqual([path, 404, 'no-store']);
    }
    const signedIn = await hostCall(new Request(`${ORIGIN}/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ token: (await keyCall(admin, '/v1/admin/login-links', {})).json.url.split('#')[1] }) }));
    expect([signedIn.status, signedIn.headers.get('Set-Cookie')?.startsWith('__Host-baton_session='), signedIn.headers.get('Cache-Control')]).toEqual([200, true, 'no-store']);
    // A signed owner read, its refusal, and the delivery route.
    const read = await as(owner, '/v1/owner/ops/grants');
    expect([read.status, read.headers.get('Cache-Control')]).toEqual([200, 'no-store']);
    const refused = await as(owner, '/v1/owner/nope/grants');
    expect([refused.status, refused.headers.get('Cache-Control')]).toEqual([403, 'no-store']);
    const delivery = await hostCall(new Request(ORIGIN + '/v1/github/webhook', { method: 'POST', headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }, body: '{}' }));
    expect([delivery.status, delivery.headers.get('Cache-Control')]).toEqual([401, 'no-store']);
    // A public page holds no data: its own header, and no security-header side effect.
    const page = await hostCall(new Request(ORIGIN + '/'));
    expect(page.status).toBe(200);
    expect(page.headers.get('Cache-Control')).toBe('no-store');
  });
});
