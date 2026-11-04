// S-BTN-77 host allowlists (BATON_SPEC §15's scenario table, §8.3 R-BTN-113; B-4): a leg run
// carries its session's link on a heartbeat, an advance and an end — kept only for an `https`
// link on the instance's `session_hosts` (default `claude.ai`), at most 512 characters, without
// userinfo; the rest is dropped and logged. An administrator widens the allowlist with
// `PUT /v1/admin/settings` (R-BTN-57) and the next link is kept. Must hold: the kept link is
// stored on `claim_legs.session_url` (latest wins while running), shown by Running and the
// Timeline, and rides the run's history row; each dropped link is a `session-url-dropped` event
// and never refuses what carried it. G-BTN-101 is this scenario's gate. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, advance, beat, claimItem, cutover, endClaim, Git, keyCall, placed, register, rows, sessionCall, setAdminKeys, setClock } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-19T12:00:00Z');
const AT_REVIEWED = placed('reviewed', [['implement', 'pr-open'], ['review', 'reviewed']], [['merge', 'ready']]);

let git: Git;
let admin: TestKey;
let owner: TestKey;

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  git = new Git();
  git.add('T-1', { rank: 1 });
  await git.post();
  await cutover();
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

/** The stored link of a claim's leg run, and every drop event so far. */
const storedUrl = async (claimId: number) =>
  (await rows<{ session_url: string | null }>('SELECT session_url FROM claim_legs WHERE claim_id = ? ORDER BY seq DESC LIMIT 1', claimId))[0]?.session_url ?? null;
const drops = () => rows<{ claim_id: number | null; detail_json: string }>("SELECT claim_id, detail_json FROM events WHERE kind = 'session-url-dropped' ORDER BY seq");

describe('S-BTN-77 session links on allowlisted hosts', () => {
  it('G-BTN-101: a heartbeat keeps only an allowlisted https link without userinfo, at most 512 characters; the rest is logged, never refusing the beat', async () => {
    const a = await register('vm-a');
    const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', a.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);

    // The default allowlist is claude.ai (R-BTN-113); a heartbeat's link is the running leg's.
    expect((await beat('vm-a', a.secret, { session_url: 'https://claude.ai/session/first' })).status).toBe(200);
    expect(await storedUrl(c.claim_id)).toBe('https://claude.ai/session/first');

    // Latest wins while running.
    await beat('vm-a', a.secret, { session_url: 'https://claude.ai/session/second' });
    expect(await storedUrl(c.claim_id)).toBe('https://claude.ai/session/second');

    // Every other shape is dropped and logged; each heartbeat still succeeds.
    const refused: [string, string][] = [
      ['https://evil.example/s', 'host'],
      ['https://user:pw@claude.ai/s', 'userinfo'],
      [`https://claude.ai/${'a'.repeat(600)}`, 'too-long'],
      ['http://claude.ai/s', 'not-https'],
      ['claude.ai/session', 'unparsed'],
    ];
    for (const [url, reason] of refused) {
      const b = await beat('vm-a', a.secret, { session_url: url });
      expect(b.status).toBe(200);
      expect(b.json.session_url_refused).toBe(reason);
    }
    expect(await storedUrl(c.claim_id)).toBe('https://claude.ai/session/second');
    const logged = await drops();
    expect(logged).toHaveLength(5);
    expect(logged.map((e) => JSON.parse(e.detail_json).reason)).toEqual(['host', 'userinfo', 'too-long', 'not-https', 'unparsed']);
    expect(logged.every((e) => e.claim_id === c.claim_id)).toBe(true);
    expect(JSON.parse(logged[0].detail_json)).toMatchObject({ reason: 'host', host: 'evil.example' });

    // A heartbeat without the field keeps the stored link (an absent link clears nothing).
    await beat('vm-a', a.secret, {});
    expect(await storedUrl(c.claim_id)).toBe('https://claude.ai/session/second');
  });

  it('an advance and an end carry the link of the leg they finish; the kept link rides the history row and both dashboard views', async () => {
    const a = await register('vm-a');
    const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', a.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    await beat('vm-a', a.secret, { session_url: 'https://claude.ai/session/hb' });

    // A bad link on the finishing advance is dropped and logged, and the heartbeat's stands.
    const bad = await advance('vm-a', a.secret, c.claim_id, { reached: 'pr-open', leg: 'review', session_url: 'https://evil.example/s' });
    expect(bad.status).toBe(200);
    expect(bad.json.session_url_refused).toBe('host');
    expect((await drops()).length).toBe(1);
    expect(await rows<{ session_url: string }>('SELECT session_url FROM claim_legs WHERE claim_id = ? AND leg = ?', c.claim_id, 'implement')).toEqual([{ session_url: 'https://claude.ai/session/hb' }]);
    // R-BTN-81: the finished run's history row carries the link.
    let history = await rows<{ kind: string; leg: string; detail_json: string }>("SELECT kind, leg, detail_json FROM ticket_history WHERE ticket_id = 'docs:T-1' AND kind = 'leg-finished'");
    expect(history).toHaveLength(1);
    expect(JSON.parse(history[0].detail_json)).toMatchObject({ session_url: 'https://claude.ai/session/hb' });

    // The link of the leg the END finishes arrives on the end (no advance finished it).
    const end = await endClaim('vm-a', a.secret, c.claim_id, { end_reason: 'suspended:reviewed', reached: 'reviewed', next: 'merge', session_url: 'https://claude.ai/session/review' });
    expect(end.status).toBe(200);
    expect(await rows<{ session_url: string }>('SELECT session_url FROM claim_legs WHERE claim_id = ? AND leg = ?', c.claim_id, 'review')).toEqual([{ session_url: 'https://claude.ai/session/review' }]);
    history = await rows<{ kind: string; leg: string; detail_json: string }>("SELECT kind, leg, detail_json FROM ticket_history WHERE ticket_id = 'docs:T-1' AND kind = 'leg-finished'");
    expect(JSON.parse(history.find((h) => h.leg === 'review')!.detail_json)).toMatchObject({ session_url: 'https://claude.ai/session/review' });
    expect(await drops()).toHaveLength(1);

    // §11.4: Running shows the active claim's running-leg link; the Timeline carries the legs.
    git.place('T-1', AT_REVIEWED);
    await git.post();
    const b = await register('vm-b');
    const { json: c2 } = await claimItem('vm-b', b.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-b', b.secret, c2.claim_id, { leg: 'merge' })).status).toBe(200);
    expect((await beat('vm-b', b.secret, { session_url: 'https://claude.ai/session/merge' })).status).toBe(200);
    const state = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as {
      running: { id: number; leg: string | null; session_url: string | null }[];
      timeline: { lanes: { claims: { ticket_id: string; legs: { leg: string; session_url: string | null }[] }[] }[] };
    };
    expect(state.running.find((r) => r.id === c2.claim_id)).toMatchObject({ leg: 'merge', session_url: 'https://claude.ai/session/merge' });
    const lane = state.timeline.lanes.find((l) => l.claims.some((x) => x.ticket_id === 'docs:T-1' && x.legs.some((g) => g.leg === 'merge')))!;
    expect(lane.claims.flatMap((x) => x.legs).find((g) => g.leg === 'merge')?.session_url).toBe('https://claude.ai/session/merge');
  });

  it('an administrator widens session_hosts with PUT /v1/admin/settings; the next link is kept; owners and bad bodies are refused', async () => {
    // §11.2: an administrator's key alone sets the instance settings; an owner's is forbidden.
    expect((await keyCall(owner, '/v1/admin/settings', { session_hosts: ['evil.example'] }, 'PUT')).status).toBe(403);
    expect((await keyCall(admin, '/v1/admin/settings', {}, 'PUT')).status).toBe(400);
    expect((await keyCall(admin, '/v1/admin/settings', { session_hosts: 'claude.ai' }, 'PUT')).status).toBe(400);
    expect((await keyCall(admin, '/v1/admin/settings', { session_hosts: ['https://evil.example'] }, 'PUT')).status).toBe(400);
    // Hostnames are lowercased and deduplicated; the check App's id rides the same row (§12.7).
    expect((await keyCall(admin, '/v1/admin/settings', { session_hosts: ['Claude.AI', 'sessions.example', 'sessions.example'], check_app_id: 41276 }, 'PUT')).status).toBe(200);

    const state = (await (await sessionCall(await adminSession(admin), '/v1/ui/state')).json()) as { limits: { instance: { link_hosts: string[]; session_hosts: string[]; check_app_id: number | null } } };
    expect(state.limits.instance).toEqual({ link_hosts: [], session_hosts: ['claude.ai', 'sessions.example'], check_app_id: 41276 });

    // The widened allowlist keeps a link the default dropped, and still the old one.
    const a = await register('vm-a');
    const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:T-1' });
    expect((await advance('vm-a', a.secret, c.claim_id, { leg: 'implement' })).status).toBe(200);
    expect((await beat('vm-a', a.secret, { session_url: 'https://sessions.example/s/1' })).status).toBe(200);
    expect(await storedUrl(c.claim_id)).toBe('https://sessions.example/s/1');
    await beat('vm-a', a.secret, { session_url: 'https://claude.ai/s/2' });
    expect(await storedUrl(c.claim_id)).toBe('https://claude.ai/s/2');
    expect(await drops()).toEqual([]);
  });
});
