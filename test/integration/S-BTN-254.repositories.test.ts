// S-BTN-254 the root read (B-204; BATON_SPEC §11.4, §14): `GET /v1/repositories` (`repo.list`)
// answers the caller's repositories — every live one for an administrator, a key or a
// session; an owner key's own — each with its registry row, head, mode and the counts the
// sidebar and the strip draw, and nothing else feeds them. Must hold:
//   1. an administrator's session lists every repository with `session.role` `administrator`,
//      `seed_owners`, `link_hosts` and `session_hosts`; an administrator's key the same rows
//      with `session` null;
//   2. an owner key lists its repositories only, `session` null and no `seed_owners`;
//   3. `running`, `ready`, `needs_you`, `runners_alive`, `runners_total` and
//      `discrepancies_7d` equal the board's live claims, the Tickets list's ready rows, the open conditions,
//      the granted runners and the discrepancy events of 7 days;
//   4. `exclusive_goal` is null (goals are not built); a retired repository is not listed;
//   5. a runner key is `forbidden`, a stranger `unauthenticated`.
// Owner sessions do not exist yet (B-76). Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, claimItem, cutover, Git, hbBody, keyCall, ORIGIN, register, rows, sessionCall, setAdminKeys, setClock, sha256, TOKENS, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';

const T0 = Date.parse('2026-11-20T12:00:00Z');
const DAY = 86_400_000;

let admin: TestKey;
let docsOwner: TestKey;
let opsOwner: TestKey;
let granted: TestKey;
let cookie: string;

type Row = Record<string, any>;
async function read(key: TestKey, path: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created }));
  return { status: res.status, json: (await res.json()) as Row };
}
async function list(): Promise<Row> {
  const res = await sessionCall(cookie, '/v1/repositories');
  expect(res.status).toBe(200);
  return (await res.json()) as Row;
}
const rowOf = (answer: Row, id: string): Row => (answer.repositories as Row[]).find((r) => r.id === id)!;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  granted = await makeKey('ssh-ed25519', 'granted');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', {
    id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', mirror_workflow: '.github/workflows/baton-mirror.yml', owner_keys: [opsOwner.publicKey],
  })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
  expect((await new Git().add('T-1').add('T-2').add('T-3').post()).status).toBe(200);
  await cutover(T0);
  cookie = await adminSession(admin);
});

describe('S-BTN-254 the root read (B-204)', () => {
  it('an administrator’s session and key list every repository; the row is the registry’s', async () => {
    const answer = await list();
    expect(Object.keys(answer).sort()).toEqual(['link_hosts', 'repositories', 'seed_owners', 'server_time', 'session', 'session_hosts']);
    expect(answer.session).toEqual({ role: 'administrator' });
    expect((answer.repositories as Row[]).map((r) => r.id)).toEqual(['baton', 'docs', 'ops']);
    // `baton` is registered by the deploy's seed with no owner key of its own: it leans on it.
    const registry = await read(admin, '/v1/admin/repositories');
    expect(answer.seed_owners).toEqual(registry.json.seed_owners);
    expect(answer.seed_owners).toContain('baton');
    const settings = await withCore((c) => c.instance.view());
    expect(answer.link_hosts).toEqual(settings.link_hosts);
    expect(answer.session_hosts).toEqual(settings.session_hosts);
    expect(answer.server_time).toBe(T0);

    const docs = rowOf(answer, 'docs');
    expect(Object.keys(docs).sort()).toEqual(['courses', 'default_branch', 'discrepancies_7d', 'exclusive_goal', 'forge', 'github', 'head', 'id', 'mode',
      'needs_you', 'ready', 'runners_alive', 'runners_total', 'running', 'web_base', 'weight']);
    const reg = (registry.json.repositories as Row[]).find((r) => r.id === 'docs')!;
    for (const k of ['id', 'github', 'forge', 'web_base', 'default_branch', 'weight']) expect([k, docs[k]]).toEqual([k, reg[k]]);
    expect(docs.courses).toEqual((reg.courses as Row[]).map((c) => ({ id: c.id, version: c.version })));
    expect(docs.head).toEqual({ sha: reg.head.sha, received_at: reg.head.received_at, observation: expect.any(Number) });
    expect(docs.mode).toBe('cut-over');
    expect(rowOf(answer, 'ops').mode).toBe('shadow');
    expect(rowOf(answer, 'ops').head).toBeNull();
    expect(docs.exclusive_goal).toBeNull();

    // An administrator's key: the same rows, and no session.
    const keyed = await read(admin, '/v1/repositories');
    expect(keyed.status).toBe(200);
    expect(keyed.json.session).toBeNull();
    expect(keyed.json.repositories).toEqual(answer.repositories);
    expect(keyed.json.seed_owners).toEqual(answer.seed_owners);
  });

  it('an owner key lists its own repositories; a runner key is forbidden, a stranger unauthenticated', async () => {
    const mine = await read(docsOwner, '/v1/repositories');
    expect(mine.status).toBe(200);
    expect((mine.json.repositories as Row[]).map((r) => r.id)).toEqual(['docs']);
    expect(mine.json.session).toBeNull();
    expect('seed_owners' in mine.json).toBe(false);
    // Readable with a key (R-BTN-179): the owner's row is the administrator's.
    expect(rowOf(mine.json, 'docs')).toEqual(rowOf(await list(), 'docs'));
    expect((await read(opsOwner, '/v1/repositories')).json.repositories.map((r: Row) => r.id)).toEqual(['ops']);

    expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
    const runner = await read(granted, '/v1/repositories');
    expect([runner.status, runner.json.code]).toEqual([403, 'forbidden']);
    const token = await hostCall(new Request(`${ORIGIN}/v1/repositories`, { headers: { Authorization: `Bearer ${TOKENS['vm-a']}` } }));
    expect(token.status).toBe(403);
    const stranger = await read(await makeKey('ssh-ed25519', 'stranger'), '/v1/repositories');
    expect([stranger.status, stranger.json.code]).toEqual([401, 'unauthenticated']);
    expect((await hostCall(new Request(`${ORIGIN}/v1/repositories`))).status).toBe(401);

    // A retired repository is no one's to list.
    await rows('UPDATE repositories SET retired_at = ? WHERE id = ?', T0, 'ops');
    expect((await list()).repositories.map((r: Row) => r.id)).toEqual(['baton', 'docs']);
    // …and its owner's key, owning nothing live, is no key Baton knows.
    expect((await read(opsOwner, '/v1/repositories')).status).toBe(401);
  });

  it('the counts are the board’s live claims, the Tickets list’s ready rows, the open conditions, the granted runners and 7 days of discrepancies', async () => {
    const before = rowOf(await list(), 'docs');
    const board = (await read(docsOwner, '/v1/repositories/docs/board')).json;
    // Nothing is claimed or held yet, so the Tickets list's ready rows are the board's.
    expect(before.ready).toBe((board.ready as unknown[]).length);
    expect(before.ready).toBe(3);
    expect(before.ready).toBe((await read(docsOwner, '/v1/repositories/docs/tickets?state=ready')).json.matched);
    expect([before.running, before.needs_you, before.runners_alive, before.runners_total, before.discrepancies_7d]).toEqual([0, 0, 0, 0, 0]);

    // A granted runner registers, and a seed credential's runner claims a ticket.
    expect((await keyCall(docsOwner, '/v1/owner/docs/grants', { public_key: granted.publicKey, hostname: 'granted-host', capabilities: ['agent-venue'] })).status).toBe(200);
    const created = Math.floor(T0 / 1000);
    const hb = await hostCall(await signedRequest(granted, `${ORIGIN}/v1/runner/heartbeat`, { created,
      body: JSON.stringify(hbBody('vm-a', { hostname: 'granted-host', session_name: 'granted-host', secret_hash: await sha256('secret-254') })) }));
    expect(hb.status).toBe(200);
    const w = await register('vm-a');
    const claim = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect(claim.status).toBe(200);
    // An open condition, a closed one, and discrepancies inside and outside the window.
    await rows(`INSERT INTO conditions (repository_id, ticket_id, claim_id, run_id, leg, type, disposition, severity, restarts_json, raised_at, outcome)
                VALUES ('docs', 'docs:T-1', ?, 'r_1', 'implement', 'x.wait', 'suspend', 'normal', '{}', ?, 'open'),
                       ('docs', 'docs:T-1', ?, 'r_1', 'implement', 'x.done', 'suspend', 'normal', '{}', ?, 'closed')`, claim.json.claim_id, T0, claim.json.claim_id, T0);
    await rows(`INSERT INTO events (at, kind, ticket_id, actor, detail_json, repository_id) VALUES
                (?, 'discrepancy', 'docs:T-2', 'sync', '{"sub":"x"}', 'docs'), (?, 'discrepancy', 'docs:T-3', 'sync', '{"sub":"x"}', NULL),
                (?, 'discrepancy', 'docs:T-2', 'sync', '{"sub":"x"}', 'docs'), (?, 'discrepancy', 'ops:T-9', 'sync', '{"sub":"x"}', 'ops')`,
      T0 - DAY, T0 - 6 * DAY, T0 - 8 * DAY, T0 - DAY);

    const after = rowOf(await list(), 'docs');
    const now = (await read(docsOwner, '/v1/repositories/docs/board')).json;
    expect(after.running).toBe((now.holders as unknown[]).length);
    expect(after.running).toBe(1);
    // The claimed ticket is `running` on the Tickets list, so it is no longer counted ready —
    // the strip's number is the length of the list it links to, not the board's queue.
    expect(after.ready).toBe(2);
    expect(after.ready).toBe((await read(docsOwner, '/v1/repositories/docs/tickets?state=ready')).json.matched);
    expect(after.needs_you).toBe(1);
    const open = (await read(docsOwner, '/v1/repositories/docs/conditions?open=1')).json;
    expect(after.needs_you).toBe((open.conditions as unknown[]).length);
    // The granted key's one runner: counted. The seed credential's, which no grant binds: not.
    expect([after.runners_alive, after.runners_total]).toEqual([1, 1]);
    expect(after.discrepancies_7d).toBe(2);
    expect(rowOf(await list(), 'ops').discrepancies_7d).toBe(1);
    expect(rowOf(await list(), 'ops').running).toBe(0);

    // The lease lapses with no heartbeat: alive falls, total stands (the row is not reaped).
    // (A day's end is the session's too: a new one reads. The alarm may have reaped the runner
    // meanwhile on a host that runs it in the background, and a reaped runner is not counted.)
    await setClock(T0 + 2 * DAY);
    cookie = await adminSession(admin);
    const later = rowOf(await list(), 'docs');
    expect(later.runners_alive).toBe(0);
    expect(later.runners_total).toBeLessThanOrEqual(1);
  });
});
