// S-BTN-39 limits agents cannot change (BATON_SPEC §15, R-BTN-66, R-BTN-67, R-BTN-23, R-BTN-58;
// R3-1240): docs' owner sets an owner bar on `account:go_plus` (every course, claims only, from
// +1 h), an owner bar on `family:x` for the course `chore` only, the required bar
// `{course: roadmap-pr, leg: *, except: [implement, review, adjudicate], tag_prefix: family:}`,
// `retry` of one backoff; an agent then commits a sync that drops every `family:` bar and
// a `baton.json` with no backoff. Must hold: from +1 h Go runners are refused new claims `barred-tag` while a held Go
// claim still advances; the `chore` bar bars no `roadmap-pr` leg; the next snapshot's `fix` and
// `merge` legs are stored `waiting` on `policy` and listed under Needs you; the retry policy is
// the owner's. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import chore from '../fixtures/courses/chore/course.json';
import { adminSession, advance, beat, captureDispatches, claimItem, course, cutover, endClaim, Git, hbBody, keyCall, ORIGIN, placed, register, rows, sessionCall, setAdminKeys, setClock, sha256, tick, withCore } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';
import { DAY_MS, DROP_TIERS_MIGRATION } from '../../src/core/deprecated';

// Drive time explicitly; do not let a real workerd alarm race a simulated clock jump.
const T0 = Date.parse('2030-10-16T12:00:00Z');
const H = 3_600_000;
const M10 = 10 * 60_000;
const REVIEWED: [string, string][] = [['implement', 'pr-open'], ['review', 'reviewed']];
const AT_REVIEWED = (bars: Record<string, string[]>) =>
  placed('reviewed', REVIEWED, [['fix', 'ready'], ['adjudicate', 'waiting', 'disagreement'], ['merge', 'ready']], { bars });
let admin: TestKey;
let owner: TestKey;
let git: Git;
const wholeState = async () => (await keyCall(admin, '/v1/admin/state')).json as Record<string, any>;

const own = (path: string, body: unknown, method?: string) => keyCall(owner, `/v1/owner/docs${path}`, body, method);

async function runnerAs(key: TestKey, path: string, body?: unknown, secret?: string) {
  const created = Math.floor((await withCore((c) => c.now())) / 1000);
  const req = await signedRequest(key, ORIGIN + path, { created, body: body === undefined ? undefined : JSON.stringify(body), headers: secret ? { 'X-Runner-Secret': secret } : {} });
  const res = await hostCall(req);
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  git = new Git();
  git.registry = [course(), course(1, 1, { id: 'chore', skill: 'chore', course: chore, step_kinds: ['other'] })];
  git
    .add('T-1', { rank: 1 })
    .add('T-2', { rank: 2 })
    .add('T-3', { rank: 3 }, AT_REVIEWED({ fix: ['family:glm'], merge: ['family:glm'] }))
    .add('T-4', { rank: 4 });
  await git.post();
  await cutover();
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

describe('S-BTN-39 limits agents cannot change', () => {
  it('ignores legacy ceilings and ticket tiers without limiting or releasing a claim', async () => {
    const k = await makeKey('ssh-ed25519', 'legacy-grant-client');
    const secret = 'tier-test';
    const grant = { public_key: k.publicKey, hostname: 'k-host', capabilities: ['agent-venue'], max_tier: 'judgement' };
    expect((await own('/grants', grant)).status).toBe(200);
    const legacy = { tier_ceiling: 'nonsense', tier_ceilings: [false, {}] };
    const hb = hbBody('vm-a', { hostname: 'k-host', session_name: 'k', secret_hash: await sha256(secret) });
    expect((await runnerAs(k, '/v1/runner/heartbeat', { ...hb, ...legacy })).status).toBe(200);
    git.tickets.get('T-1')!.tier = 'normal';
    expect((await git.post()).status).toBe(200);
    const claimed = await runnerAs(k, '/v1/runner/claim', { request_id: 'tier-test', ticket_id: 'docs:T-1' }, secret);
    expect(claimed.status).toBe(200);
    git.tickets.get('T-1')!.tier = 'critical';
    expect((await git.post()).status).toBe(200);
    expect((await runnerAs(k, '/v1/runner/heartbeat', { ...hb, ...legacy }, secret)).json.messages).toEqual([]);
    expect(await rows('SELECT status FROM claims WHERE id = ?', claimed.json.claim_id)).toEqual([{ status: 'active' }]);
    const events = () => rows(`SELECT json_extract(detail_json, '$.field') AS field FROM events WHERE kind = 'deprecated-field' ORDER BY field`);
    expect(await events()).toEqual(['grant.max_tier', 'heartbeat.tier_ceiling', 'heartbeat.tier_ceilings', 'ticket.tier'].map((field) => ({ field })));
    await setClock(T0 + DAY_MS);
    expect((await runnerAs(k, '/v1/runner/heartbeat', { ...hb, ...legacy }, secret)).status).toBe(200);
    expect(await events()).toHaveLength(6);
  });

  it('expires 30 days after the last sighting, including a same-day repeat', async () => {
    await rows('UPDATE _baton_migrations SET applied_at = ? WHERE id = ?', T0, DROP_TIERS_MIGRATION);
    const change = () => keyCall(admin, '/v1/admin/repositories', { id: 'docs', tiers: false });
    expect((await change()).status).toBe(200);
    await setClock(T0 + H);
    expect((await change()).status).toBe(200);
    expect(await rows("SELECT seen_at FROM deprecated_fields WHERE field = 'repository.tiers'")).toEqual([{ seen_at: T0 + H }]);
    await setClock(T0 + 30 * DAY_MS);
    expect((await change()).status).toBe(200);
    await setClock(T0 + 60 * DAY_MS);
    expect(await change()).toMatchObject({ status: 400, json: { code: 'invalid-params' } });
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', weight: 100 })).status).toBe(200);
  });

  it('keeps the tickets ETag when an ignored filter is seen again (R-BTN-196)', async () => {
    const path = ORIGIN + '/v1/repositories/docs/tickets?tier=ignored';
    const read = async (etag?: string) => hostCall(await signedRequest(owner, path, {
      created: T0 / 1000, headers: etag ? { 'If-None-Match': etag } : {},
    }));
    const first = await read();
    expect(first.status).toBe(200);
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();
    expect((await read(etag!)).status).toBe(304);
    await setClock(T0 + 1_000);
    expect((await read(etag!)).status).toBe(304);
    expect(await rows("SELECT seen_at FROM deprecated_fields WHERE field = 'tickets.tier'")).toEqual([{ seen_at: T0 + 1_000 }]);
  });
  it('an owner bar on every course, claims only, from +1 h: new Go claims are refused, a held one still advances', async () => {
    expect((await own('/bars', { course: '*', tag: 'account:go_plus', applies: 'claim', starts_at: T0 + H, reason: 'go-quota' })).status).toBe(200);
    // Scheduled, not yet in force: the observation shows it, and a Go runner still claims.
    const go1 = await register('vm-a', { tags: ['account:go_plus'] });
    const held = await claimItem('vm-a', go1.secret, { ticket_id: 'docs:T-1' });
    expect(held.status).toBe(200);

    await setClock(T0 + H);
    const go2 = await register('vm-b', { tags: ['account:go_plus'] });
    expect((await claimItem('vm-b', go2.secret, { ticket_id: 'docs:T-2' })).json).toMatchObject({ code: 'barred-tag', rule: 8 });
    // The heartbeat names the bar in force.
    expect((await beat('vm-a', go1.secret)).json.bars).toEqual([expect.objectContaining({ tag: 'account:go_plus', course: '*', applies: 'claim' })]);
    // Claims only: the held Go claim advances.
    expect((await advance('vm-a', go1.secret, held.json.claim_id, { leg: 'implement' })).json).toMatchObject({ ok: true, station: 'filed' });
    expect((await advance('vm-a', go1.secret, held.json.claim_id, { reached: 'pr-open', leg: 'review' })).json).toMatchObject({ ok: true, station: 'pr-open' });
    // Another runner is not barred.
    const other = await register('test', { tags: ['account:other'] });
    expect((await claimItem('test', other.secret, { ticket_id: 'docs:T-2' })).status).toBe(200);
  });

  it('a bar for the course chore bars no roadmap-pr leg', async () => {
    expect((await own('/bars', { course: 'chore', tag: 'family:x', applies: 'claim+advance', reason: 'chore-only' })).status).toBe(200);
    const x = await register('vm-a', { tags: ['family:x'] });
    const c = await claimItem('vm-a', x.secret, { ticket_id: 'docs:T-1' });
    expect(c.status).toBe(200);
    expect((await advance('vm-a', x.secret, c.json.claim_id, { leg: 'implement' })).status).toBe(200);
    expect((await advance('vm-a', x.secret, c.json.claim_id, { reached: 'pr-open', leg: 'review' })).status).toBe(200);
  });

  it('a sync that drops every family: bar leaves fix and merge waiting on policy, under Needs you', async () => {
    const required = [{ course: 'roadmap-pr', leg: '*', except: ['implement', 'review', 'adjudicate'], tag_prefix: 'family:' }];
    expect((await own('/settings', { required_bars: required }, 'PUT')).status).toBe(200);
    // With the bars posted, fix is ready.
    await git.refresh();
    expect(await rows(`SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = 'docs:T-3' ORDER BY leg`)).toEqual([
      { leg: 'adjudicate', state: 'waiting', waiting_on: 'disagreement' },
      { leg: 'fix', state: 'ready', waiting_on: null },
      { leg: 'merge', state: 'ready', waiting_on: null },
    ]);
    // An agent commits a course-side change that posts no bars at all.
    git.place('T-3', AT_REVIEWED({}));
    expect(await git.post()).toMatchObject({ status: 200 });
    expect(await rows(`SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = 'docs:T-3' ORDER BY leg`)).toEqual([
      { leg: 'adjudicate', state: 'waiting', waiting_on: 'disagreement' },
      { leg: 'fix', state: 'waiting', waiting_on: 'policy' },
      { leg: 'merge', state: 'waiting', waiting_on: 'policy' },
    ]);
    const state = await wholeState();
    expect(state.needs_you.policy).toEqual([
      { ticket_id: 'docs:T-3', leg: 'fix', waiting_since: T0 },
      { ticket_id: 'docs:T-3', leg: 'merge', waiting_since: T0 },
    ]);
    // Nor is the ticket offered.
    const w = await register('vm-a', { tags: ['family:glm'] });
    expect((await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-3' })).status).toBe(409);
  });

  it('the retry policy and transcript repositories are the owner’s, whatever baton.json says', async () => {
    expect((await own('/settings', { retry: { backoff_ms: [2 * H], max_failed: 2 }, transcript_repos: ['immediately-run/transcripts'] }, 'PUT')).status).toBe(200);
    // The sync posts a baton.json with no backoff and other transcript repositories: ignored.
    git.add('T-5', { rank: 5 });
    expect(await git.post({ retry: { backoff_ms: [], max_failed: 9 }, transcript_repos: ['someone/else'] })).toMatchObject({ status: 200 });
    expect(await rows(`SELECT retry, transcript_repos FROM repositories WHERE id = 'docs'`)).toEqual([
      { retry: JSON.stringify({ backoff_ms: [2 * H], max_failed: 2 }), transcript_repos: JSON.stringify(['immediately-run/transcripts']) },
    ]);
    const w = await register('vm-a');
    const first = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    await endClaim('vm-a', w.secret, first.json.claim_id, { end_reason: 'released:cannot-finish:transient' });
    expect(await rows(`SELECT retry_after, hold FROM ticket_overrides WHERE ticket_id = 'docs:T-1'`)).toEqual([{ retry_after: T0 + 2 * H, hold: 0 }]);
    // The second failed attempt is the owner's max_failed: held.
    await git.refresh();
    await setClock(T0 + 2 * H);
    await beat('vm-a', w.secret);
    const second = await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-1' });
    expect(second.status).toBe(200);
    await endClaim('vm-a', w.secret, second.json.claim_id, { end_reason: 'released:cannot-finish:transient' });
    expect(await rows(`SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = 'docs:T-1'`)).toEqual([{ hold: 1, hold_reason: 'attempts-exhausted' }]);
  });

  it('a bar that releases holders sends each tagged holder one release, once; the end it asks for is no failed attempt', async () => {
    const dispatched = await captureDispatches();
    const go = await register('vm-a', { tags: ['account:go_plus'] });
    const held = (await claimItem('vm-a', go.secret, { ticket_id: 'docs:T-1' })).json;
    const other = await register('vm-b', { tags: ['account:other'] });
    const kept = (await claimItem('vm-b', other.secret, { ticket_id: 'docs:T-2' })).json;
    const { json: bar } = await own('/bars', { course: 'roadmap-pr', tag: 'account:go_plus', applies: 'claim', starts_at: T0 + M10, release_holders: true, reason: 'go-quota' });
    // A bar change dispatches the repository's sync (R-BTN-67).
    await tick();
    expect(dispatched).toContain('docs:sync');
    // Not before it starts.
    expect((await beat('vm-a', go.secret, { tags: ['account:go_plus'] })).json.messages).toEqual([]);
    await setClock(T0 + M10);
    await tick();
    await tick();
    const releases = (await beat('vm-a', go.secret, { tags: ['account:go_plus'] })).json.messages.filter((m: { kind: string }) => m.kind === 'release');
    expect(releases).toEqual([expect.objectContaining({ kind: 'release', payload: expect.objectContaining({ ticket_id: 'docs:T-1', reason: 'go-quota', bar: bar.id }) })]);
    expect((await beat('vm-b', other.secret, { tags: ['account:other'] })).json.messages).toEqual([]);
    expect(await rows('SELECT holders_released_at FROM owner_bars WHERE id = ?', bar.id)).toEqual([{ holders_released_at: T0 + M10 }]);
    // An owner-bar reason no bar has is refused; the bar's own is accepted and never counted failed.
    expect((await endClaim('vm-a', go.secret, held.claim_id, { end_reason: 'released:other-quota' })).json).toMatchObject({ code: 'invalid-params' });
    expect((await endClaim('vm-a', go.secret, held.claim_id, { end_reason: 'released:go-quota' })).status).toBe(200);
    expect(await rows(`SELECT retry_after, hold FROM ticket_overrides WHERE ticket_id = 'docs:T-1'`)).toEqual([]);
    expect(await rows('SELECT status FROM claims WHERE id = ?', kept.claim_id)).toEqual([{ status: 'active' }]);
  });

  it('a required bar refuses an advance into a covered leg without its prefix, and the judge names a snapshot that drops it', async () => {
    const required = [{ course: 'roadmap-pr', leg: '*', except: ['implement', 'fix', 'adjudicate'], tag_prefix: 'family:' }];
    expect((await own('/settings', { required_bars: required }, 'PUT')).status).toBe(200);
    const w = await register('vm-a', { tags: ['family:qwen'] });
    const c = (await claimItem('vm-a', w.secret, { ticket_id: 'docs:T-3' })).json;
    expect(c).toMatchObject({ station: 'reviewed', legs: ['fix'] });
    await advance('vm-a', w.secret, c.claim_id, { leg: 'fix' });
    // Into review (covered), with no family: bar posted or declared: refused, the claim unchanged.
    expect((await advance('vm-a', w.secret, c.claim_id, { reached: 'fixed', leg: 'review' })).json).toMatchObject({ code: 'not-eligible', rule: 8, rule_code: 'policy' });
    expect(await rows('SELECT station, leg FROM claims WHERE id = ?', c.claim_id)).toEqual([{ station: 'reviewed', leg: 'fix' }]);
    // A bar the holder declares meets it (one it does not carry itself: rule 8 still binds it).
    expect((await advance('vm-a', w.secret, c.claim_id, { reached: 'fixed', leg: 'review', bars: ['family:glm'] })).json).toMatchObject({ ok: true, station: 'fixed' });
    // The next snapshot posts review with no bars: bars-mismatch, naming the policy.
    git.place('T-3', placed('fixed', [...REVIEWED, ['fix', 'fixed']], [['review', 'ready']], { bars: { review: [] } }));
    expect(await git.post()).toMatchObject({ status: 200 });
    const mismatch = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'bars-mismatch' AND claim_id = ?`, c.claim_id);
    expect(mismatch.map((m) => JSON.parse(m.detail_json))).toEqual([expect.objectContaining({ leg: 'review', declared_only: ['family:glm'], policy: ['family:'] })]);
  });

  it('a course file that no longer has a required bar’s named leg is held, the one in force staying', async () => {
    expect((await own('/settings', { required_bars: [{ course: 'roadmap-pr', leg: 'fix', tag_prefix: 'family:' }] }, 'PUT')).status).toBe(200);
    const { fix: _f, ...legs } = roadmapPr.legs;
    const { fixed: _s, ...stations } = roadmapPr.stations;
    const withoutFix = { ...roadmapPr, stations, legs: { ...legs, review: { ...legs.review, from: ['pr-open'] } } };
    git.registry = [course(4, 3, { course: withoutFix }), course(1, 1, { id: 'chore', skill: 'chore', course: chore, step_kinds: ['other'] })];
    const posted = await git.post();
    expect(posted).toMatchObject({ status: 200 });
    expect(await rows(`SELECT version FROM courses WHERE repository_id = 'docs' AND id = 'roadmap-pr'`)).toEqual([{ version: 3 }]);
    const refused = await rows<{ violations: string }>(`SELECT violations FROM course_refusals WHERE course_id = 'roadmap-pr'`);
    expect(JSON.parse(refused[0].violations)).toEqual([expect.objectContaining({ rule: 'required-bar', path: 'legs.fix' })]);
  });

  it('the heartbeat carries the bars of the runner’s repositories only', async () => {
    const opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
    expect((await keyCall(opsOwner, '/v1/owner/ops/bars', { course: '*', tag: 'account:x', applies: 'claim', reason: 'ops-only' })).status).toBe(200);
    expect((await own('/bars', { course: '*', tag: 'account:y', applies: 'claim', reason: 'docs-only' })).status).toBe(200);
    const k = await makeKey('ssh-ed25519', 'k');
    await own('/grants', { public_key: k.publicKey, hostname: 'k-host', capabilities: ['agent-venue'] });
    const hb = await runnerAs(k, '/v1/runner/heartbeat', hbBody('vm-a', { hostname: 'k-host', session_name: 'k', secret_hash: await sha256('s') }));
    expect(hb.json.bars).toEqual([expect.objectContaining({ repository: 'docs', tag: 'account:y' })]);
  });
});
