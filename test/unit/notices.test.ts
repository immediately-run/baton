// notices.test.ts — the one writer of `notices` (BATON_SPEC §2g R-BTN-80, §2l R-BTN-103; R3-1256):
// each transition and its backoff on the fake clock, the lease and its lapse, the reminder, a
// revocation, a new `asks`, deletion 7 days after closing, and the checks every courier-supplied
// field goes through first.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, keyCall, placed, rows, setAdminKeys, setClock, tick } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { grantedWorker, signed } from '../lib/fleet';
import { BACKOFF_MS, CLOSED_KEPT_MS, LEASE_MS, POOL, backoffMs } from '../../src/core/notices';
import { checkAsks, checkCouriers, checkMark, checkNoticeClaim, CLAIM_MAX } from '../../src/core/validate';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

let admin: TestKey;
let owner: TestKey;
let cli: TestKey;
let git: Git;

const decided = (id: string, asks = 'owner') => placed('filed', [], [['implement', 'ready']], { decisions: [{ id, asks, url: 'https://github.com/immediately-run/docs/pull/7' }] });
const notices = () => rows<{ credential_id: string; ticket_id: string; ref: string; state: string; attempts: number; not_before: number }>(
  'SELECT credential_id, ticket_id, ref, state, attempts, not_before FROM notices ORDER BY credential_id, ticket_id, ref');
const claim = (key: TestKey, body: unknown = {}) => signed(key, '/v1/courier/notices/claim', { body });
const mark = (key: TestKey, id: string, body: unknown) => signed(key, `/v1/courier/notices/${id}`, { body });
const addCourier = (key: TestKey, asks: string[], repo = 'docs', by = owner) => keyCall(by, `/v1/owner/${repo}/couriers`, { public_key: key.publicKey, asks });
/** Move the clock and run the alarm, as a minute's tick does. */
const at = async (ms: number) => {
  await setClock(ms);
  await tick();
};

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  cli = await makeKey('ssh-ed25519', 'owner-cli');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await addCourier(cli, ['owner'])).status).toBe(200);
  git = new Git().add('E', {}, decided('R3-E-1'));
  expect((await git.post()).status).toBe(200);
});

describe('R-BTN-80: a notice’s lifecycle', () => {
  it('queued → claimed (leased 10 minutes) → sent, with the reminder after remind_after', async () => {
    expect(await notices()).toEqual([{ credential_id: cli.fingerprint, ticket_id: 'docs:E', ref: 'R3-E-1', state: 'queued', attempts: 0, not_before: T0 }]);
    const c = await claim(cli);
    expect(c.status).toBe(200);
    expect(c.json.notices).toHaveLength(1);
    expect((await notices())[0]).toMatchObject({ state: 'claimed', not_before: T0 + LEASE_MS });
    // Claimed, it is not handed out again.
    expect((await claim(cli)).json.notices).toEqual([]);
    expect((await mark(cli, c.json.notices[0].notice_id, { state: 'sent', channel: 'cli' })).status).toBe(200);
    expect((await notices())[0]).toMatchObject({ state: 'sent', not_before: T0 + DAY });
    expect(await rows('SELECT channel, sent_at FROM notices')).toEqual([{ channel: 'cli', sent_at: T0 }]);
    // Still open a day later: queued again for the same courier.
    await at(T0 + DAY - MIN);
    expect((await notices())[0].state).toBe('sent');
    await at(T0 + DAY);
    expect((await notices())[0]).toMatchObject({ state: 'queued', not_before: T0 + DAY });
    expect((await claim(cli)).json.notices.map((n: { notice_id: string }) => n.notice_id)).toEqual([c.json.notices[0].notice_id]);
  });

  it('a lapsed lease is queued again, and the lapsed claimer’s mark is still accepted', async () => {
    const id = (await claim(cli)).json.notices[0].notice_id;
    await at(T0 + LEASE_MS - MIN);
    expect((await notices())[0].state).toBe('claimed');
    await at(T0 + LEASE_MS);
    expect((await notices())[0]).toMatchObject({ state: 'queued', not_before: T0 + LEASE_MS });
    expect((await mark(cli, id, { state: 'sent' })).status).toBe(200);
    expect((await notices())[0].state).toBe('sent');
  });

  it('failed re-queues after 1, 5, 30 minutes, then hourly; sent resets the backoff', async () => {
    expect(BACKOFF_MS).toEqual([MIN, 5 * MIN, 30 * MIN, H]);
    expect([1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([MIN, 5 * MIN, 30 * MIN, H, H, H]);
    let now = T0;
    for (const wait of [MIN, 5 * MIN, 30 * MIN, H, H]) {
      const id = (await claim(cli)).json.notices[0].notice_id;
      expect((await mark(cli, id, { state: 'failed' })).status).toBe(200);
      expect((await notices())[0]).toMatchObject({ state: 'queued', not_before: now + wait });
      // Not before its backoff.
      await at(now + wait - 1);
      expect((await claim(cli)).json.notices).toEqual([]);
      now += wait;
      await at(now);
    }
    expect((await notices())[0].attempts).toBe(5);
    const id = (await claim(cli)).json.notices[0].notice_id;
    await mark(cli, id, { state: 'sent' });
    expect((await notices())[0].attempts).toBe(0);
  });

  it('closes with its decision whatever its state; a mark then is `closed`; deleted 7 days later', async () => {
    const id = (await claim(cli)).json.notices[0].notice_id;
    await setClock(T0 + MIN);
    git.place('E', placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await notices())[0]).toMatchObject({ state: 'closed', not_before: T0 + MIN + CLOSED_KEPT_MS });
    const late = await mark(cli, id, { state: 'sent' });
    expect(late.status).toBe(409);
    expect(late.json.code).toBe('closed');
    // Neither the lease's lapse nor a reminder reopens a closed notice.
    await at(T0 + DAY);
    expect((await notices())[0].state).toBe('closed');
    await at(T0 + MIN + CLOSED_KEPT_MS - 1);
    expect(await notices()).toHaveLength(1);
    await at(T0 + MIN + CLOSED_KEPT_MS);
    expect(await notices()).toEqual([]);
  });

  it('a ticket that leaves the board closes its decision’s notices, kept 7 days so a late mark is `closed`', async () => {
    const id = (await claim(cli)).json.notices[0].notice_id;
    git.close('E', 'done');
    expect((await git.post()).status).toBe(200);
    expect((await notices()).map((n) => n.state)).toEqual(['closed']);
    expect((await mark(cli, id, { state: 'sent' })).json.code).toBe('closed');
  });

  it('a decision posted again is not queued twice; one whose asks changed goes to the new asks’ couriers', async () => {
    const ops = await makeKey('ssh-ed25519', 'ops-pager');
    expect((await addCourier(ops, ['ops'])).status).toBe(200);
    git.add('F');
    expect((await git.post()).status).toBe(200);
    expect((await notices()).map((n) => n.credential_id)).toEqual([cli.fingerprint]);
    git.place('E', decided('R3-E-1', 'ops'));
    expect((await git.post()).status).toBe(200);
    const byKey = Object.fromEntries((await notices()).map((n) => [n.credential_id, n.state]));
    expect(byKey).toEqual({ [cli.fingerprint]: 'closed', [ops.fingerprint]: 'queued' });
  });

  it('marks another courier’s notice `forbidden`, and an unknown one `not-found`', async () => {
    const other = await makeKey('ssh-ed25519', 'push-relay');
    expect((await addCourier(other, ['owner'])).status).toBe(200);
    const id = (await claim(cli)).json.notices[0].notice_id;
    expect((await mark(other, id, { state: 'sent' })).json.code).toBe('forbidden');
    expect((await mark(other, 'f'.repeat(32), { state: 'sent' })).json.code).toBe('not-found');
    expect((await mark(other, 'not-an-id', { state: 'sent' })).json.code).toBe('invalid-params');
  });
});

describe('R-BTN-80: registration', () => {
  it('a new asks queues the open decisions it now delivers, and closes those it no longer does', async () => {
    git.add('G', {}, decided('G-1', 'legal'));
    expect((await git.post()).status).toBe(200);
    expect((await notices()).map((n) => n.ref)).toEqual(['R3-E-1']);
    expect((await addCourier(cli, ['owner', 'legal'])).status).toBe(200);
    expect((await notices()).map((n) => [n.ticket_id, n.ref, n.state])).toEqual([['docs:E', 'R3-E-1', 'queued'], ['docs:G', 'G-1', 'queued']]);
    expect((await addCourier(cli, ['legal'])).status).toBe(200);
    const states = Object.fromEntries((await notices()).map((n) => [n.ref, n.state]));
    expect(states).toEqual({ 'R3-E-1': 'closed', 'G-1': 'queued' });
  });

  it('revoking on one repository closes its notices there and ends the credential with its last registration', async () => {
    const ops = await makeKey('ssh-ed25519', 'ops-owner');
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [ops.publicKey] })).status).toBe(200);
    // Another repository's owners may add the same courier key to theirs.
    expect((await addCourier(cli, ['owner'], 'ops', ops)).status).toBe(200);
    expect((await keyCall(owner, '/v1/owner/docs/couriers', { fingerprint: cli.fingerprint, revoke: true })).status).toBe(200);
    expect((await notices())[0].state).toBe('closed');
    expect(await rows('SELECT revoked_at FROM credentials WHERE id = ?', cli.fingerprint)).toEqual([{ revoked_at: null }]);
    // Revoked again where it is not registered: not-found.
    expect((await keyCall(owner, '/v1/owner/docs/couriers', { fingerprint: cli.fingerprint, revoke: true })).json.code).toBe('not-found');
    expect((await keyCall(ops, '/v1/owner/ops/couriers', { fingerprint: cli.fingerprint, revoke: true })).status).toBe(200);
    expect(await rows('SELECT revoked_at FROM credentials WHERE id = ?', cli.fingerprint)).toEqual([{ revoked_at: T0 }]);
    expect((await claim(cli)).json.code).toBe('unauthenticated');
    // An owner's revoke is not final: registered again, it delivers the decision open now.
    expect((await addCourier(cli, ['owner'])).status).toBe(200);
    expect((await notices()).map((n) => n.state).sort()).toEqual(['closed', 'queued']);
  });

  it('an administrator’s revoke closes every notice of the key and is final', async () => {
    expect((await keyCall(admin, `/v1/admin/keys/${encodeURIComponent(cli.fingerprint)}/revoke`, {})).status).toBe(200);
    expect((await notices())[0].state).toBe('closed');
    expect(await rows('SELECT 1 FROM couriers WHERE credential_id = ?', cli.fingerprint)).toEqual([]);
    expect((await addCourier(cli, ['owner'])).json.code).toBe('conflict');
    expect((await keyCall(admin, '/v1/admin/keys/pool/revoke', {})).json.code).toBe('invalid-params');
  });

  it('one role per key: an owner, worker or probe key is refused as a courier, a courier key as a worker', async () => {
    expect((await addCourier(owner, ['owner'])).json.code).toBe('conflict');
    const probe = await makeKey('ssh-ed25519', 'probe');
    expect((await keyCall(admin, '/v1/admin/probes', { public_key: probe.publicKey, label: 'probe' })).status).toBe(200);
    expect((await addCourier(probe, ['owner'])).json.code).toBe('conflict');
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
    expect((await addCourier(w.key, ['owner'])).json.code).toBe('conflict');
    expect((await keyCall(owner, '/v1/owner/docs/grants', { public_key: cli.publicKey, hostname: 'cli-host', capabilities: [] })).json.code).toBe('conflict');
    expect((await keyCall(owner, '/v1/owner/docs/owners', { public_key: cli.publicKey })).json.code).toBe('conflict');
  });

  it('remind_after is an owner setting from an hour to 7 days', async () => {
    for (const bad of [3599, 604_801, 1.5, '1h']) {
      expect((await keyCall(owner, '/v1/owner/docs/settings', { remind_after: bad }, 'PUT')).json.code).toBe('invalid-params');
    }
    expect((await keyCall(owner, '/v1/owner/docs/settings', { remind_after: 3600 }, 'PUT')).status).toBe(200);
    const id = (await claim(cli)).json.notices[0].notice_id;
    await mark(cli, id, { state: 'sent' });
    expect((await notices())[0].not_before).toBe(T0 + H);
  });
});

describe('R-BTN-103: the pool', () => {
  it('a heartbeat’s couriers are kept for granted repositories only, refreshed at most hourly', async () => {
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
    const hb = await w.beat({ couriers: [{ repository: 'docs', asks: ['owner'] }, { repository: 'ops', asks: ['owner'] }] });
    expect(hb.status).toBe(200);
    expect(hb.json.refused_couriers).toEqual([{ repository: 'ops', code: 'forbidden' }]);
    expect(await rows('SELECT repository_id, asks, seen_at FROM worker_couriers')).toEqual([{ repository_id: 'docs', asks: 'owner', seen_at: T0 }]);
    await setClock(T0 + 30 * MIN);
    await w.beat({ couriers: [{ repository: 'docs', asks: ['owner'] }] });
    expect(await rows('SELECT seen_at FROM worker_couriers')).toEqual([{ seen_at: T0 }]);
    await setClock(T0 + H);
    await w.beat({ couriers: [{ repository: 'docs', asks: ['owner'] }] });
    expect(await rows('SELECT seen_at FROM worker_couriers')).toEqual([{ seen_at: T0 + H }]);
    // A heartbeat that stops declaring them drops them; a malformed list refuses the heartbeat.
    await w.beat({ couriers: [] });
    expect(await rows('SELECT 1 FROM worker_couriers')).toEqual([]);
    expect((await w.beat({ couriers: [{ repository: 'docs', asks: [] }] })).json.code).toBe('invalid-params');
  });

  it('a pool copy goes to the first claimer; another worker’s mark is forbidden; a lapse returns it', async () => {
    const w1 = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
    const w2 = await grantedWorker(owner, 'docs', 'w2', ['agent-venue']);
    for (const w of [w1, w2]) await w.beat({ couriers: [{ repository: 'docs', asks: ['owner'] }] });
    git.add('H', {}, decided('H-1'));
    expect((await git.post()).status).toBe(200);
    expect((await notices()).filter((n) => n.credential_id === POOL).map((n) => n.ref)).toEqual(['H-1']);
    const c1 = await signed(w1.key, '/v1/courier/notices/claim?repository=docs', { body: {} });
    expect(c1.json.notices.map((n: { decision: { id: string } }) => n.decision.id)).toEqual(['H-1']);
    expect((await signed(w2.key, '/v1/courier/notices/claim?repository=docs', { body: {} })).json.notices).toEqual([]);
    const id = c1.json.notices[0].notice_id;
    expect((await signed(w2.key, `/v1/courier/notices/${id}?repository=docs`, { body: { state: 'sent' } })).json.code).toBe('forbidden');
    await at(T0 + LEASE_MS);
    expect((await signed(w2.key, '/v1/courier/notices/claim?repository=docs', { body: {} })).json.notices).toHaveLength(1);
    // The pool's copy is not a personal channel's: the CLI never sees it.
    expect((await claim(cli)).json.notices.map((n: { decision: { id: string } }) => n.decision.id).sort()).toEqual(['H-1', 'R3-E-1']);
  });

  it('a machine key without couriers declared, or naming no repository, is refused', async () => {
    const w = await grantedWorker(owner, 'docs', 'w1', ['agent-venue']);
    expect((await signed(w.key, '/v1/courier/notices/claim?repository=docs', { body: {} })).json.code).toBe('forbidden');
    expect((await signed(w.key, '/v1/courier/notices/claim', { body: {} })).json.code).toBe('invalid-params');
    expect((await signed(cli, '/v1/courier/notices/claim?repository=docs', { body: {} })).json.code).toBe('invalid-params');
    expect((await signed(owner, '/v1/courier/notices/claim', { body: {} })).json.code).toBe('unauthenticated');
  });
});

describe('the checks before any write (§10.4)', () => {
  it('couriers, asks, a mark and a claim', () => {
    expect(checkCouriers(undefined)).toEqual([]);
    expect(checkCouriers([{ repository: 'docs', asks: ['owner', 'owner', 'legal'] }])).toEqual([{ repository: 'docs', asks: ['legal', 'owner'] }]);
    for (const bad of [{}, [{ repository: 'docs' }], [{ repository: 'docs', asks: ['owner'] }, { repository: 'docs', asks: ['x'] }], [{ repository: 'Docs!', asks: ['owner'] }],
      [{ repository: 'docs', asks: ['owner'], extra: 1 }], Array.from({ length: 17 }, (_, i) => ({ repository: `r${i}`, asks: ['owner'] }))]) {
      expect(() => checkCouriers(bad)).toThrow();
    }
    expect(() => checkAsks([])).toThrow();
    expect(() => checkAsks(Array.from({ length: 9 }, (_, i) => `a${i}`))).toThrow();
    expect(() => checkAsks(['Owner'])).toThrow();
    expect(checkMark({ state: 'failed' })).toEqual({ state: 'failed', channel: null });
    expect(checkMark({ state: 'sent', channel: 'push:phone' })).toEqual({ state: 'sent', channel: 'push:phone' });
    for (const bad of [null, { state: 'read' }, { state: 'sent', channel: '<b>x</b>' }, { state: 'sent', other: 1 }]) expect(() => checkMark(bad)).toThrow();
    expect(checkNoticeClaim(null)).toBe(CLAIM_MAX);
    expect(checkNoticeClaim({})).toBe(CLAIM_MAX);
    expect(checkNoticeClaim({ limit: 3 })).toBe(3);
    for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { other: 1 }, []]) expect(() => checkNoticeClaim(bad)).toThrow();
  });
});
