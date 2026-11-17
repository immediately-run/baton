// S-BTN-77 host allowlists (BATON_SPEC §15, §8.3 R-BTN-113; B-4), the API half, on both hosts:
// a `session_url` on a heartbeat, an advance or an end is kept only on an allowlisted `https`
// host, without userinfo, at most 512 characters — every other is dropped and logged, never a
// refused call — and a host an administrator adds through `PUT /v1/admin/settings`
// (`instance_settings`, §13.1) is kept from then on. The settings row carries `link_hosts` and
// `check_app_id` beside `session_hosts`; the stored link rides the dashboard's Running and
// Timeline views, the run list and the ticket history (§11.4).
import { describe, it, expect, beforeEach } from 'vitest';
import { advance, beat, claimItem, course, cutover, endClaim, Git, keyCall, register, rows, setAdminKeys, setClock, withCore } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-14T09:00:00Z');
const LINK = 'https://claude.ai/s/r_0000000000000000000000000';
const SECOND = 'https://claude.ai/s/r_0000000000000000000000001';
const REVIEW = 'https://claude.ai/s/r_0000000000000000000000002';
const OTHER = 'https://sessions.example/s/one';

let admin: TestKey;
let owner: TestKey;
let git: Git;

/** Every session-link drop's reason, in order (the heartbeat's, the advance's and the end's
 *  alike: one log shape, `sub: 'session-url'`). */
const drops = () => rows<{ why: string }>(
  `SELECT json_extract(detail_json, '$.why') AS why FROM events WHERE kind = 'discrepancy' AND json_extract(detail_json, '$.sub') = 'session-url' ORDER BY seq`);
const uiState = () => withCore((c) => c.uiState() as Record<string, any>);
const historyRows = async () => ((await keyCall(owner, '/v1/repositories/docs/tickets/A/history')).json).rows as { kind: string; leg: string | null; detail: Record<string, unknown> | null }[];

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  git = new Git().add('A');
  git.registry = [course(3, 3)];
  expect((await git.post()).status).toBe(200);
  await cutover();
});

describe('S-BTN-77: host allowlists (R-BTN-113)', () => {
  it('a beat keeps only an allowlisted link (the default, claude.ai), dropping and logging the rest; a dropped link clears nothing', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);

    const kept = await beat('vm-a', w.secret, { session_url: LINK });
    expect(kept.status).toBe(200);
    expect(kept.json.session_url_dropped).toBeUndefined();
    expect(await rows<{ session_url: string | null }>('SELECT session_url FROM claim_legs WHERE claim_id = ?', c.claim_id)).toEqual([{ session_url: LINK }]);

    // Another host, userinfo, over the bound and a plain-http link: each dropped and logged —
    // the beat answers 200 and says why — and the link already kept stands.
    const other = await beat('vm-a', w.secret, { session_url: OTHER });
    expect(other.status).toBe(200);
    expect(other.json.session_url_dropped).toContain('sessions.example');
    expect((await beat('vm-a', w.secret, { session_url: 'https://user:pw@claude.ai/s/x' })).json.session_url_dropped).toContain('userinfo');
    expect((await beat('vm-a', w.secret, { session_url: `https://claude.ai/${'x'.repeat(600)}` })).json.session_url_dropped).toContain('512');
    expect((await beat('vm-a', w.secret, { session_url: 'http://claude.ai/s/x' })).json.session_url_dropped).toContain('https');
    expect(await rows<{ session_url: string | null }>('SELECT session_url FROM claim_legs WHERE claim_id = ?', c.claim_id)).toEqual([{ session_url: LINK }]);
    expect((await drops()).map((d) => d.why)).toEqual([
      expect.stringContaining('sessions.example'), 'carries userinfo', 'over 512 characters', 'not https',
    ]);
  });

  it('the advance and the end carry the link of the leg they finish; one with nothing to finish, or off the allowlist, is dropped and logged the same way', async () => {
    // An end that runs no leg has no row a link could land on.
    const w1 = await register('vm-a');
    const c1 = await claimItem('vm-a', w1.secret, { ticket_id: 'docs:A' });
    const bare = await endClaim('vm-a', w1.secret, c1.json.claim_id, { end_reason: 'released:requested', session_url: LINK });
    expect(bare.status).toBe(200);
    expect(bare.json.session_url_dropped).toContain('runs no leg');
    expect(await rows('SELECT 1 FROM claim_legs WHERE claim_id = ?', c1.json.claim_id)).toEqual([]);

    await git.refresh();
    const w2 = await register('vm-b');
    const c2 = await claimItem('vm-b', w2.secret, { ticket_id: 'docs:A' });
    // The first advance finishes no leg either.
    const first = await advance('vm-b', w2.secret, c2.json.claim_id, { leg: 'implement', session_url: LINK });
    expect(first.status).toBe(200);
    expect(first.json.session_url_dropped).toContain('finishes no leg');

    // A beat lands the run's link; the advance that finishes the leg carries a fresher one,
    // which wins (latest), and the finished run's history row rides it (R-BTN-81, §11.4).
    expect((await beat('vm-b', w2.secret, { session_url: LINK })).status).toBe(200);
    const finished = await advance('vm-b', w2.secret, c2.json.claim_id, { reached: 'pr-open', leg: 'review', session_url: SECOND });
    expect(finished.status).toBe(200);
    expect(finished.json.session_url_dropped).toBeUndefined();
    expect(await rows<{ leg: string; session_url: string | null }>('SELECT leg, session_url FROM claim_legs WHERE claim_id = ? ORDER BY seq', c2.json.claim_id))
      .toEqual([{ leg: 'implement', session_url: SECOND }, { leg: 'review', session_url: null }]);
    expect((await historyRows()).filter((r) => r.kind === 'leg-finished').map((r) => [r.leg, r.detail?.session_url])).toEqual([['implement', SECOND]]);

    // The end may carry the running leg's link; one off the allowlist is dropped and logged,
    // the end never refused, and the run's row keeps what an earlier beat landed (nothing).
    const badEnd = await endClaim('vm-b', w2.secret, c2.json.claim_id, { end_reason: 'released:requested', session_url: OTHER });
    expect(badEnd.status).toBe(200);
    expect(badEnd.json.session_url_dropped).toContain('sessions.example');
    expect(await rows<{ leg: string; session_url: string | null }>('SELECT leg, session_url FROM claim_legs WHERE claim_id = ? ORDER BY seq', c2.json.claim_id))
      .toEqual([{ leg: 'implement', session_url: SECOND }, { leg: 'review', session_url: null }]);
    // The given-up run's history row carries no link (the run's row holds none).
    expect((await historyRows()).filter((r) => r.kind === 'leg-abandoned').map((r) => r.detail?.session_url)).toEqual([undefined]);

    await git.refresh();
    const c3 = await claimItem('vm-a', w1.secret, { ticket_id: 'docs:A' });
    expect((await advance('vm-a', w1.secret, c3.json.claim_id, { leg: 'implement' })).status).toBe(200);
    const done = await endClaim('vm-a', w1.secret, c3.json.claim_id, { end_reason: 'done', session_url: REVIEW });
    expect(done.status).toBe(200);
    expect(done.json.session_url_dropped).toBeUndefined();
    expect(await rows<{ leg: string; session_url: string | null }>('SELECT leg, session_url FROM claim_legs WHERE claim_id = ?', c3.json.claim_id))
      .toEqual([{ leg: 'implement', session_url: REVIEW }]);
    expect((await historyRows()).filter((r) => r.kind === 'leg-finished').map((r) => [r.leg, r.detail?.session_url]))
      .toEqual([['implement', REVIEW], ['implement', SECOND]]); // newest first

    // Every drop above is the one log shape.
    expect((await drops()).map((d) => d.why)).toEqual([
      expect.stringContaining('runs no leg'), expect.stringContaining('finishes no leg'), expect.stringContaining('sessions.example'),
    ]);
  });

  it('PUT /v1/admin/settings: an administrator alone sets the host lists and the check App id; a host added is kept from then on, and clearing restores what stood without it', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    expect((await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);

    // R-BTN-57: an owner's key is no administrator's; the shape refusals are Baton's.
    expect((await keyCall(owner, '/v1/admin/settings', { session_hosts: ['claude.ai'] }, 'PUT')).status).toBe(403);
    expect((await keyCall(admin, '/v1/admin/settings', { session_hosts: ['claude.ai'], no_such: 1 }, 'PUT')).json.code).toBe('invalid-params');
    expect((await keyCall(admin, '/v1/admin/settings', { session_hosts: ['not a host'] }, 'PUT')).json.code).toBe('invalid-params');
    expect((await keyCall(admin, '/v1/admin/settings', { session_hosts: ['a.example', 'A.example'] }, 'PUT')).json.code).toBe('invalid-params');
    expect((await keyCall(admin, '/v1/admin/settings', { check_app_id: 'an-app' }, 'PUT')).json.code).toBe('invalid-params');
    expect((await keyCall(admin, '/v1/admin/settings', {}, 'PUT')).json.code).toBe('invalid-params');

    // The scenario's host added: sessions.example joins the allowlist and a link on it is kept.
    const put = await keyCall(admin, '/v1/admin/settings',
      { session_hosts: ['claude.ai', 'sessions.example'], link_hosts: ['links.example'], check_app_id: '123456' }, 'PUT');
    expect(put.status).toBe(200);
    expect(put.json).toEqual({ ok: true });
    expect(await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'admin' ORDER BY seq DESC LIMIT 1`)).toEqual([
      { detail_json: JSON.stringify({ act: 'instance-settings', link_hosts: ['links.example'], session_hosts: ['claude.ai', 'sessions.example'], check_app_id: '123456' }) },
    ]);
    const kept = await beat('vm-a', w.secret, { session_url: OTHER });
    expect(kept.status).toBe(200);
    expect(kept.json.session_url_dropped).toBeUndefined();
    expect(await rows<{ session_url: string | null }>('SELECT session_url FROM claim_legs WHERE claim_id = ?', c.claim_id)).toEqual([{ session_url: OTHER }]);

    // The state read carries the settings (§11.4's tenant screen): `session_hosts` is the list
    // the client's own link gate checks against (§12.3); `recommended_client` is the version as
    // served — the code's own, until an administrator raises it (R-BTN-197, B-254).
    expect((await uiState()).instance).toEqual({ link_hosts: ['links.example'], session_hosts: ['claude.ai', 'sessions.example'], check_app_id: '123456', recommended_client: '0.1.5' });

    // Clearing the setting restores what stands without it — the deploy's default (claude.ai)
    // — so a sessions.example link is dropped again.
    expect((await keyCall(admin, '/v1/admin/settings', { session_hosts: null }, 'PUT')).status).toBe(200);
    expect((await uiState()).instance.session_hosts).toEqual(['claude.ai']);
    expect((await beat('vm-a', w.secret, { session_url: OTHER })).json.session_url_dropped).toContain('sessions.example');
  });

  it('the stored link rides the Running and Timeline views and the run list (§11.4)', async () => {
    const w = await register('vm-a');
    const { json: c } = await claimItem('vm-a', w.secret, { ticket_id: 'docs:A' });
    const a = await advance('vm-a', w.secret, c.claim_id, { leg: 'implement' });
    expect((await beat('vm-a', w.secret, { session_url: LINK })).status).toBe(200);

    const state = await uiState();
    expect(state.running).toEqual([expect.objectContaining({ ticket_id: 'docs:A', leg: 'implement', session_url: LINK })]);
    const lane = state.timeline.lanes.find((l: { id: number }) => l.id === w.id);
    const claim = lane.claims.find((x: { id: number }) => x.id === c.claim_id);
    expect(claim.runs).toEqual([expect.objectContaining({ leg: 'implement', session_url: LINK })]);

    // B-190's run list: each of a leg's runs carries its own link.
    const runs = await keyCall(owner, '/v1/repositories/docs/tickets/A/legs/implement/runs');
    expect(runs.status).toBe(200);
    expect(runs.json.runs).toEqual([expect.objectContaining({ leg: 'implement', run_id: a.json.run_id, session_url: LINK })]);
  });
});
