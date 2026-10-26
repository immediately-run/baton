// R3-1212 — claims (BATON_SPEC §6.1–6.7, §7.2, §11): G-BTN-1, -2, -3, -6, -14 and -40, plus the
// claim and end contracts, the holder query, matching's worker rules, and the held history.
import { describe, it, expect, inject, beforeEach } from 'vitest';
import { confirmations } from '../../src/shared/batonSync.mjs';
import { gatesFor } from '../../src/core/gates';
import {
  beat, claimItem, claimRow, course, cutover, q, endClaim, hbBody, keyCall, ORIGIN, ownerCall, payload, recommended, refresh, register, requestId, rows, setAdminKeys, setClock, sha256, syncCall, withCore, workerCall, tick,
} from '../helpers';
import { makeKey, signedRequest } from '../lib/sshKeys';
import { capabilitiesOf } from '../../src/shared/vocabulary.mjs';
import { call as hostCall } from '#host';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';

const board = inject('board');
type Item = { id: string; status: string; tier: string | null; tags: string[]; requires: string[] | null; queue: string; node: string };
const itemsOf = (label: keyof typeof board.states) => board.states[label].state.items as Item[];
const sha = board.shas;
const T0 = Date.parse('2026-10-13T12:00:00Z');
const S = 1000;
const code = async (res: Response) => ((await res.json()) as { code: string }).code;
const owner = (path: string, body: unknown) =>
  ownerCall(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });
const alarmAt = async (ms: number) => {
  await setClock(ms);
  await tick();
};

beforeEach(async () => {
  await setClock(T0);
  await syncCall('/v1/sync/board', payload(sha.A, null, board.states.A));
  await cutover();
});

describe('the claim and end contracts (§6.2, §6.5, §11)', () => {
  it('a claim before cutover is not-cut-over; after it, the response names the path and snapshot, never content', async () => {
    const { secret } = await register('vm-a');
    await rows(`UPDATE repositories SET cutover_at = NULL`);
    expect((await claimItem('vm-a', secret)).json.code).toBe('not-cut-over');
    await cutover();
    const c = await claimItem('vm-a', secret);
    expect(c.status).toBe(200);
    // §11, R3-1232: where the ticket starts and its queued leg, the snapshot's next legs.
    expect(c.json).toEqual({ claim_id: expect.any(Number), ticket_id: 'docs:R3-9001', station: 'filed', legs: ['implement'], next: [{ leg: 'implement', state: 'ready' }],
      path: 'content/roadmap/R3-9001.mdx', nonce: expect.stringMatching(/^[0-9a-f]{6}$/), snapshot_sha: sha.A, previous_attempts: [], advice: null });
    expect((await beat('vm-a', secret)).json.claim).toMatchObject({ id: c.json.claim_id, ticket_id: 'docs:R3-9001', nonce: c.json.nonce, station: 'filed',
      git: { station: 'filed', path: [], path_len: 0, regressed: false, next: [{ leg: 'implement', state: 'ready' }] } });
  });

  it('GET next answers what a claim would, without claiming; a named item that is not ready is refused with its rule', async () => {
    const { secret } = await register('vm-a');
    expect(await (await workerCall('/v1/runner/next', { secret })).json()).toMatchObject({ ticket_id: 'docs:R3-9001', station: 'filed', legs: ['implement'] });
    expect(await rows('SELECT count(*) AS n FROM claims')).toEqual([{ n: 0 }]);
    const blocked = await claimItem('vm-a', secret, { ticket_id: 'docs:R3-9004' });
    expect([blocked.status, blocked.json.code, blocked.json.rule]).toEqual([409, 'not-eligible', 1]);
    const op = await claimItem('vm-a', secret, { ticket_id: 'docs:R3-9003' });
    expect([op.json.code, op.json.rule]).toEqual(['not-eligible', 4]); // github-admin is not declared
    expect((await claimItem('vm-a', secret, { ticket_id: 'docs:R3-9002' })).json.ticket_id).toBe('docs:R3-9002');
  });

  it('ends only in §6.5’s vocabulary, at a station the claim can rest at; only the holder ends; a retried end is a no-op', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    const { json: c } = await claimItem('vm-a', a.secret);
    for (const bad of [{ end_reason: 'released:bored' }, { end_reason: 'handed-off:awaiting-ci' }, { end_reason: 'remainder:R3-1' },
      { end_reason: 'released:awaiting-review-capacity' }, { end_reason: 'suspended:filed', reached: 'pr-open' }, { end_reason: 'done', detail: 'a<b' },
      { end_reason: 'released:requested', ended_at_sha: sha.B }, { end_reason: 'done', ended_at_sha: 'http://x' }]) {
      expect([bad, (await endClaim('vm-a', a.secret, c.claim_id, bad)).json.code]).toEqual([bad, 'invalid-params']);
    }
    // R-BTN-71: running nothing at filed, the claim rests at filed and nowhere else.
    expect((await endClaim('vm-a', a.secret, c.claim_id, { end_reason: 'suspended:pr-open' })).json).toMatchObject({ code: 'not-eligible', rule_code: 'off-graph' });
    expect((await endClaim('vm-b', b.secret, c.claim_id, { end_reason: 'released:requested' })).json.code).toBe('not-holder');
    const end = { end_reason: 'suspended:filed', detail: 'awaiting-owner', ended_at_sha: 'https://github.com/immediately-run/docs/pull/1#issuecomment-1' };
    expect((await endClaim('vm-a', a.secret, c.claim_id, end)).status).toBe(200);
    expect((await endClaim('vm-a', a.secret, c.claim_id, end)).status).toBe(200);
    expect((await endClaim('vm-a', a.secret, c.claim_id, { end_reason: 'released:requested' })).json.code).toBe('claim-ended');
    expect(await claimRow(c.claim_id)).toMatchObject({ status: 'completed', end_reason: 'suspended:filed', confirmed_at: null });
    expect(await rows('SELECT end_detail, station FROM claims WHERE id = ?', c.claim_id)).toEqual([{ end_detail: 'awaiting-owner', station: 'filed' }]);
  });

  it('§6.9: an end closes the claim’s open activities abandoned', async () => {
    const { secret } = await register('vm-a');
    const { json: c } = await claimItem('vm-a', secret);
    await workerCall('/v1/runner/activities', { secret, body: { activities: [{ id: 'impl', claim_id: c.claim_id, kind: 'implement', source: 'skill', started_at: T0 }] } });
    await endClaim('vm-a', secret, c.claim_id, { end_reason: 'released:cannot-finish:capability' });
    expect(await rows('SELECT outcome FROM activities')).toEqual([{ outcome: 'abandoned' }]);
  });

  it('§7.2 worker rules: a worker below its course’s min_worker_version gets no claim; a suspended account is no core gate (§7.3)', async () => {
    const { secret } = await register('vm-a');
    // A provider suspension is the course's, enforced as an owner bar's tag (R-BTN-67, R3-1240), never by core.
    await owner('/v1/ui/suspensions', { provider_id: 'zai', mode: 'no-new-work' });
    expect((await claimItem('vm-a', secret)).status).toBe(200);
    const late = await register('vm-b', { model_id: 'opencode-go/kimi-k3', model_provider_id: 'opencode_go_plus', courses: [{ repository: 'docs', course: 'roadmap-pr', version: 2 }] });
    expect(await claimItem('vm-b', late.secret)).toMatchObject({ status: 409, json: { code: 'stale-skills', rule: 9 } });
    expect(await claimItem('vm-b', late.secret, { ticket_id: 'docs:R3-9002' })).toMatchObject({ status: 409, json: { code: 'stale-skills', rule: 9 } });
    // Declaring no course at all is stale too: rule 9 asks for the ticket's course.
    const none = await register('mac', { model_id: 'opencode-go/kimi-k3', model_provider_id: 'opencode_go_plus', courses: [] });
    expect(await claimItem('mac', none.secret)).toMatchObject({ status: 409, json: { code: 'stale-skills', rule: 9 } });
  });

  it('G-BTN-40, rule 9: a ticket whose course is not registered fits no worker, in the query and gatesFor alike', async () => {
    const { id, secret } = await register('vm-a');
    await rows(`DELETE FROM courses`); // a head posted before the registry existed
    expect(await recommended(id)).toEqual([]);
    expect(await claimItem('vm-a', secret, { ticket_id: 'docs:R3-9001' })).toMatchObject({ status: 409, json: { code: 'stale-skills', rule: 9 } });
  });

  it('§7.2 rule 4 reads a leg\'s `requires.capabilities` (R-BTN-120, B-86): accepted by the validator, enforced by the gate and its query', async () => {
    const { id, secret } = await register('vm-a', { capabilities: ['llm-call'] });
    // A course whose start leg requires a capability the worker does not hold, posted as the
    // registry's — the key `validateCourse` accepts.
    const needs = JSON.parse(JSON.stringify(roadmapPr)) as Record<string, any>;
    needs.legs.implement.requires = { capabilities: ['terraform'] };
    // A new head carries a registry: a repeat of the head is a refresh, and applies none.
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { registry: [course(3, 3, { course: needs })] }));
    expect(await rows('SELECT id FROM courses WHERE id = ?', 'roadmap-pr')).toHaveLength(1);
    // Stored as posted: the core reads the leg's list (it is in the file the registry applied).
    expect(await rows(`SELECT length(course_json) AS n FROM courses WHERE id = ?`, 'roadmap-pr')).toEqual([{ n: expect.any(Number) }]);
    expect((await rows(`SELECT instr(course_json, '"requires"') AS r FROM courses WHERE id = ?`, 'roadmap-pr'))[0].r).toBeGreaterThan(0);
    // Rule 4 refuses the queued leg, and the candidate query agrees (G-BTN-40) — a runner that
    // lacks the capability is never offered the ticket its leg would refuse.
    // A ticket whose queued leg is ready (rule 1 passes, so the refusal is rule 4's).
    const ticketId = 'docs:R3-9002';
    expect(await recommended(id)).not.toContain(ticketId);
    const refused = await claimItem('vm-a', secret, { ticket_id: ticketId });
    expect(refused, JSON.stringify(refused.json)).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 4 } });
    // A worker declaring agent-venue has llm-call but not terraform: still refused.
    const role = await register('vm-b', { capabilities: ['agent-venue'] });
    expect((await claimItem('vm-b', role.secret, { ticket_id: ticketId })).json.rule).toBe(4);
    // The role a leg's requires names is met by a declaration that carries it: `agent-venue` for
    // a leg naming the role.
    needs.legs.implement.requires = { capabilities: ['agent-venue'] };
    await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.C, { registry: [course(3, 3, { course: needs })] }));
    const held = await register('vm-a', { session_name: 'held', capabilities: ['agent-venue'] });
    expect(await recommended(held.id)).toContain(ticketId);
    const kept = await claimItem('vm-a', held.secret, { ticket_id: ticketId });
    expect(kept.status).toBe(200);
    // The claim above holds the leg (rule 3): a granted worker is offered it only once that claim
    // has ended, so it ends here as a real one would.
    expect((await endClaim('vm-a', held.secret, kept.json.claim_id, { end_reason: 'released:requested' })).status).toBe(200);
    // §6.7: claimable again only after a sync since that end.
    await syncCall('/v1/sync/board', payload(sha.D, sha.C, board.states.D));
    // Review round 5, finding 1: the same leg for a GRANTED key. Grants store capabilities only
    // (`admin.ts`), so the query reads the role the leg names as the capabilities `graphOf`
    // expanded it to — a granted venue worker is a candidate and claims it, and a worker holding
    // none of the role's capabilities is neither.
    const admin = await makeKey('ssh-ed25519', 'admin-r5');
    const docsOwner = await makeKey('ssh-ed25519', 'docs-owner-r5');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
    const workerKey = async (name: string, capabilities: string[]) => {
      const key = await makeKey('ssh-ed25519', name);
      expect((await keyCall(admin, '/v1/admin/grants', { repository: 'docs', public_key: key.publicKey, hostname: name, capabilities })).status).toBe(200);
      // A granted key declares the courses of the repositories it is granted on (§10.1).
      const body = hbBody('vm-a', { hostname: name, session_name: name, secret_hash: await sha256(name), capabilities, model_id: 'opencode-go/kimi-k3', model_provider_id: 'opencode_go_plus', courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }] });
      const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/runner/heartbeat`, { created: Math.floor((await withCore((x) => x.now())) / 1000), body: JSON.stringify(body) }));
      expect([name, res.status]).toEqual([name, 200]);
      return { worker_id: (await res.json() as { worker_id: number }).worker_id, key, secret: name };
    };
    // `claimItem` speaks a batch credential's token; a granted worker's is its key's own, so its
    // claim is signed here.
    const grantedClaim = async (key: Awaited<ReturnType<typeof makeKey>>, secret: string) => {
      const sec = Math.floor((await withCore((x) => x.now())) / 1000);
      const signed = await signedRequest(key, `${ORIGIN}/v1/runner/claim`, { created: sec, body: JSON.stringify({ request_id: requestId(), ticket_id: ticketId }) });
      // The worker secret joins a signature (§5, `runner/api.ts`'s `Auth`): the key names the
      // credential, the secret names the worker.
      signed.headers.set('X-Worker-Secret', secret);
      const res = await hostCall(signed);
      return { status: res.status, json: (await res.json()) as Record<string, any> };
    };
    // A worker granted only `llm-call` is not offered the leg and is refused it: one of the role's
    // four is not the role (the round-5 probe: `llm-call` alone passed a leg naming a role).
    const grantedPartial = await workerKey('r5-granted-partial', ['llm-call']);
    expect(await recommended(grantedPartial.worker_id)).not.toContain(ticketId);
    expect(await grantedClaim(grantedPartial.key, grantedPartial.secret)).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 4 } });
    // A worker granted the venue is: the query reads the role the leg names as the capabilities
    // `graphOf` expanded it to, and a grant stores capabilities, so it is a candidate and claims.
    const grantedVenue = await workerKey('r5-granted-venue', ['agent-venue']);
    expect(await recommended(grantedVenue.worker_id)).toContain(ticketId);

    expect(await grantedClaim(grantedVenue.key, grantedVenue.secret), 'the granted venue worker claims the leg').toMatchObject({ status: 200, json: { ticket_id: ticketId } });
  });

  it('§7.2 rule 4 holds a human-operator leg the way rule 6 holds an operator-only ticket (R-BTN-121, review round 6)', async () => {
    // The start leg reserved for a person: an approval or hands-on step no autonomous worker takes.
    const needs = JSON.parse(JSON.stringify(roadmapPr)) as Record<string, any>;
    needs.legs.implement.requires = { capabilities: ['human-operator'] };
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { registry: [course(3, 3, { course: needs })] }));
    const venue = await register('vm-a', { capabilities: ['agent-venue'] });
    const operator = await register('mac', { capabilities: ['human-operator', 'agent-venue'] });
    const ticketId = 'docs:R3-9002';
    // The query does not offer it to the agent venue, and the gate refuses it — the two agree.
    expect(await recommended(venue.id)).not.toContain(ticketId);
    expect(await claimItem('vm-a', venue.secret, { ticket_id: ticketId })).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 4 } });
    // The operator is offered it and claims it.
    expect(await recommended(operator.id)).toContain(ticketId);
    expect((await claimItem('mac', operator.secret, { ticket_id: ticketId })).status).toBe(200);
  });

  it('the courses row holds the course file as posted; the leg needs the query reads are its derived view (review round 6)', async () => {
    const file = JSON.parse(JSON.stringify(roadmapPr)) as Record<string, any>;
    file.legs.implement.requires = { capabilities: ['deployer'] };
    file.capability_roles = { deployer: ['vpn:corp', 'credential:DEPLOY_TOKEN'] };
    const post = () => syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { registry: [course(3, 3, { course: file })] }));
    expect((await post()).status).toBe(200);
    expect(JSON.parse((await rows<{ course_json: string }>('SELECT course_json FROM courses WHERE id = ?', 'roadmap-pr'))[0].course_json)).toEqual(file);
    const { leg_capabilities_json: needs } = (await rows<{ leg_capabilities_json: string }>('SELECT leg_capabilities_json FROM courses WHERE id = ?', 'roadmap-pr'))[0];
    expect(JSON.parse(needs).implement).toEqual(['vpn:corp', 'credential:DEPLOY_TOKEN']);
    // A re-post of the same file is a fixed point: the row is byte-identical.
    const before = await rows<{ course_json: string; leg_capabilities_json: string }>('SELECT course_json, leg_capabilities_json FROM courses WHERE id = ?', 'roadmap-pr');
    expect((await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.C, { registry: [course(3, 3, { course: file })] }))).status).toBe(200);
    expect(await rows<{ course_json: string; leg_capabilities_json: string }>('SELECT course_json, leg_capabilities_json FROM courses WHERE id = ?', 'roadmap-pr')).toEqual(before);
  });

  it('§7.2 rule 6: an operator-only item goes only to a worker that declared human-operator', async () => {
    const mac = await register('mac', { capabilities: ['human-operator', 'agent-venue'] });
    const vm = await register('vm-a');
    // R3-9003 also needs github-admin, which neither declares: refused on rule 4 for both. The
    // ordering of refusals is isEligible's: capabilities (4) come before operator-only (6).
    expect((await claimItem('mac', mac.secret, { ticket_id: 'docs:R3-9003' })).json.rule).toBe(4);
    expect((await claimItem('vm-a', vm.secret, { ticket_id: 'docs:R3-9003' })).json.rule).toBe(4);
  });
});

describe('G-BTN-1: one active claim per item and per worker', () => {
  it('two concurrent claims for one item: exactly one succeeds', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    const [x, y] = await Promise.all([claimItem('vm-a', a.secret, { ticket_id: 'docs:R3-9001' }), claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.status === 409)!.json).toMatchObject({ code: 'not-eligible', rule: 3 });
    expect(await rows(`SELECT count(*) AS n FROM claims WHERE status = 'active'`)).toEqual([{ n: 1 }]);
  });

  it('two claims by one worker: the second is refused; the index refuses a second row however it is written', async () => {
    const a = await register('vm-a');
    expect((await claimItem('vm-a', a.secret)).status).toBe(200);
    expect(await claimItem('vm-a', a.secret)).toMatchObject({ status: 409, json: { code: 'not-eligible', rule: 'one-claim-per-worker' } });
    await expect(rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status)
                       VALUES ('docs:R3-9002', ?, 'raw-1', 'abcdef', '', 0, 'active')`, a.id)).rejects.toThrow(/UNIQUE/);
    const b = await register('vm-b');
    await expect(rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status)
                       VALUES ('docs:R3-9001', ?, 'raw-2', 'abcdef', '', 0, 'active')`, b.id)).rejects.toThrow(/UNIQUE/);
  });
});

describe('G-BTN-2: a repeated request_id returns the original claim', () => {
  it('never a second item; another worker cannot reuse it', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    const body = { request_id: requestId() };
    const first = await claimItem('vm-a', a.secret, body);
    const again = await claimItem('vm-a', a.secret, body);
    expect(again.json).toEqual(first.json);
    expect(await rows('SELECT count(*) AS n FROM claims')).toEqual([{ n: 1 }]);
    expect((await claimItem('vm-b', b.secret, body)).json.code).toBe('invalid-params');
  });
});

describe('G-BTN-3: a claim is reaped at its worker’s clamped timeout, not a second earlier', () => {
  it.each([
    ['899 s, clamped to 900', 899, 900],
    ['86401 s, clamped to 86400', 86_401, 86_400],
    ['absent, the default 900', undefined, 900],
  ])('%s', async (_what, declared, clamped) => {
    const { secret } = await register('vm-a', { lease_timeout_s: declared });
    const { json: c } = await claimItem('vm-a', secret);
    await alarmAt(T0 + clamped * S - S);
    expect((await claimRow(c.claim_id)).status).toBe('active');
    await alarmAt(T0 + clamped * S);
    expect(await claimRow(c.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:silent', fence_pending: 0 });
    expect((await beat('vm-a', secret)).json.code).toBe('worker-reaped');
  });

  it('a heartbeat moves the deadline', async () => {
    const { secret } = await register('vm-a');
    const { json: c } = await claimItem('vm-a', secret);
    await setClock(T0 + 600 * S);
    await beat('vm-a', secret);
    await alarmAt(T0 + 900 * S);
    expect((await claimRow(c.claim_id)).status).toBe('active');
    await alarmAt(T0 + 1500 * S);
    expect((await claimRow(c.claim_id)).status).toBe('reaped');
  });
});

describe('G-BTN-6: a completion is confirmed only by ancestry and status; until then the item is not claimable', () => {
  // The sync's own decision (scripts/lib/batonSync.mjs, vendored) over the fixture repository's
  // real ancestry and each snapshot's statuses.
  const deps = (next: keyof typeof sha) => ({
    isAncestor: async (a: string, b: string) => {
      const label = (s: string) => Object.entries(sha).find(([, v]) => v === s)?.[0];
      return board.ancestry[`${label(a)}<${label(b)}`] === true;
    },
    statusOf: (id: string) => itemsOf(next).find((i) => i.id === id)?.status ?? null,
  });
  const decided = (endedAt: keyof typeof sha, next: keyof typeof sha) => confirmations([{ claim_id: 1, ticket_id: 'docs:R3-9001', ended_at_sha: sha[endedAt] }], sha[next], deps(next));

  it('the sync confirms none of: a stale snapshot, a wrong status, a force-pushed sha; it confirms a landed one', async () => {
    expect(await decided('B', 'A')).toEqual([]); // B is not an ancestor of A: the snapshot is stale
    expect(await decided('B', 'C')).toEqual([]); // landed, but git still shows in-progress
    expect(await decided('C', 'D')).toEqual([]); // C was force-pushed away
    expect(await decided('A', 'D')).toEqual([{ claim_id: 1, sha: sha.D }]); // landed; available after an owner reset
  });

  it('the server: unconfirmed blocks the item; the sync’s post confirms it and the item is claimable again', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    const { json: c } = await claimItem('vm-a', a.secret, { ticket_id: 'docs:R3-9001' });
    await endClaim('vm-a', a.secret, c.claim_id, { end_reason: 'done', ended_at_sha: sha.A });
    expect((await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })).json).toMatchObject({ code: 'not-eligible', rule: 3 });
    expect((await (await syncCall('/v1/sync/head')).json() as { unconfirmed: unknown[] }).unconfirmed).toEqual([
      { claim_id: c.claim_id, ticket_id: 'docs:R3-9001', end_reason: 'done', ended_at_sha: sha.A }]);
    const confirmed = await confirmations([{ claim_id: c.claim_id, ticket_id: 'docs:R3-9001', ended_at_sha: sha.A }], sha.D, deps('D'));
    expect((await syncCall('/v1/sync/board', payload(sha.D, sha.A, board.states.D, { confirmations: confirmed }))).status).toBe(200);
    expect((await claimRow(c.claim_id)).confirmed_at).toBe(T0);
    expect((await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })).status).toBe(200);
  });

  it('a confirm-only post (the head re-sent) confirms too; a confirmation for anything else is ignored', async () => {
    const { secret } = await register('vm-a');
    const { json: c } = await claimItem('vm-a', secret);
    await endClaim('vm-a', secret, c.claim_id, { end_reason: 'done', ended_at_sha: sha.A });
    const res = await syncCall('/v1/sync/board', payload(sha.A, sha.A, board.states.A, { confirmations: [{ claim_id: c.claim_id, sha: sha.A }, { claim_id: 999, sha: sha.A }] }));
    expect(await res.json()).toMatchObject({ ok: true, unchanged: true, confirmed: 1 });
  });
});

describe('G-BTN-14: a force-reaped live worker’s item waits for its fence', () => {
  it('not re-issued until fence-cleared, which only that incarnation’s heartbeat with its secret reports', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    const { json: c } = await claimItem('vm-a', a.secret);
    expect((await owner(`/v1/ui/claims/${c.claim_id}/reap`, {})).status).toBe(400); // names its confirmation
    expect(await (await owner(`/v1/ui/claims/${c.claim_id}/reap`, { confirm: true })).json()).toEqual({ ok: true, fence_pending: true });
    expect(await claimRow(c.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:owner', fence_pending: 1 });
    expect((await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })).json.rule).toBe(3);
    const token = await (await workerCall('/v1/runner/tickets/docs:R3-9001/holder', { cred: 'vm-b' })).json();
    expect(token).toEqual({ held_by_other: false, fence_pending: true });
    // The live worker is told: its heartbeat no longer lists the claim.
    const told = await beat('vm-a', a.secret);
    expect(told.json.claim).toBeNull();
    // A fenced report for a claim it never held, or from the hash path, changes nothing.
    await beat('vm-a', a.secret, { fenced: { claim_id: 999, terminated: true } });
    expect((await claimRow(c.claim_id)).fence_pending).toBe(1);
    await beat('vm-a', a.secret, { fenced: { claim_id: c.claim_id, terminated: true } });
    expect((await claimRow(c.claim_id)).fence_pending).toBe(0);
    expect(await rows(`SELECT actor, json_extract(detail_json, '$.by') AS by FROM events WHERE kind = 'fence-cleared'`)).toEqual([{ actor: `worker:${a.id}`, by: 'sidecar' }]);
    await refresh(); // §6.7: a reading since the reap
    expect((await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })).status).toBe(200);
  });

  it('a re-key never clears a fence; the worker’s own timeout does', async () => {
    const a = await register('vm-a');
    const b = await register('vm-b');
    const { json: c } = await claimItem('vm-a', a.secret);
    await owner(`/v1/ui/claims/${c.claim_id}/reap`, { confirm: true });
    const rekeyed = await workerCall('/v1/runner/heartbeat', { body: { ...hbBody('vm-a'), rekey: true, secret_hash: await sha256('second') } });
    expect(((await rekeyed.json()) as { incarnation: number }).incarnation).toBe(2);
    await beat('vm-a', 'second', { fenced: { claim_id: c.claim_id, terminated: true } });
    expect((await claimRow(c.claim_id)).fence_pending).toBe(1);
    await alarmAt(T0 + 900 * S); // the re-keyed worker last heartbeat at T0, so it is silent past 900 s
    expect((await claimRow(c.claim_id)).fence_pending).toBe(0);
    expect(await rows(`SELECT json_extract(detail_json, '$.by') AS by FROM events WHERE kind = 'fence-cleared'`)).toEqual([{ by: 'timeout' }]);
    await setClock(T0 + 900 * S);
    await beat('vm-b', b.secret);
    await refresh();
    expect((await claimItem('vm-b', b.secret, { ticket_id: 'docs:R3-9001' })).status).toBe(200);
  });

  it('§9: a release unacknowledged for 2 hours reaps the claim, fence-pending', async () => {
    const a = await register('vm-a', { lease_timeout_s: 43_200 });
    const { json: c } = await claimItem('vm-a', a.secret);
    await owner('/v1/ui/messages', { to_worker_id: a.id, kind: 'release', payload: { ticket_id: 'docs:R3-9001', reason: 'requested' } });
    await beat('vm-a', a.secret, { lease_timeout_s: 43_200 }); // delivered at T0
    await alarmAt(T0 + 2 * 3_600_000 - S);
    expect(await claimRow(c.claim_id)).toMatchObject({ status: 'active' });
    await alarmAt(T0 + 2 * 3_600_000);
    expect(await claimRow(c.claim_id)).toMatchObject({ status: 'reaped', end_reason: 'reaped:release-unacknowledged', fence_pending: 1 });
  });
});

describe('G-BTN-40: the matching query and gatesFor agree; git overtaking a claim ends it', () => {
  const workers = [
    { cred: 'vm-a' as const, session: 'venue', over: { capabilities: ['agent-venue'], tier_ceiling: 'critical' } },
    { cred: 'vm-a' as const, session: 'judge', over: { capabilities: ['agent-venue'], tier_ceiling: 'judgement' } },
    { cred: 'vm-b' as const, session: 'bare', over: { capabilities: [], tier_ceiling: 'routine' } },
    { cred: 'mac' as const, session: 'owner', over: { capabilities: ['human-operator', 'agent-venue'], tier_ceiling: 'critical' } },
    // Rule 9 (R-BTN-65): below roadmap-pr's min_worker_version, and declaring no course at all.
    { cred: 'vm-b' as const, session: 'stale', over: { capabilities: ['agent-venue'], tier_ceiling: 'critical', courses: [{ repository: 'docs', course: 'roadmap-pr', version: 2 }] } },
    { cred: 'mac' as const, session: 'nocourse', over: { capabilities: ['agent-venue'], tier_ceiling: 'critical', courses: [] } },
  ] as { cred: 'vm-a' | 'vm-b' | 'mac'; session: string; over: { capabilities: string[]; tier_ceiling: string; courses?: unknown[] } }[];
  const chain: Record<string, (keyof typeof sha)[]> = { A: ['A'], B: ['A', 'B'], C: ['A', 'B', 'C'], D: ['A', 'D'] };

  it.each(['A', 'B', 'C', 'D'] as const)('on fixture board %s', async (label) => {
    const steps = chain[label];
    for (let i = 1; i < steps.length; i++) await syncCall('/v1/sync/board', payload(sha[steps[i]], sha[steps[i - 1]], board.states[steps[i]]));
    const snap = board.states[label];
    for (const w of workers) {
      const { id } = await register(w.cred, { session_name: w.session, ...w.over });
      const decl = w.over.capabilities;
      const facts = { tier_ceiling: w.over.tier_ceiling, declared: decl, tags: [], grants: null, courses: (w.over.courses ?? [{ repository: 'docs', course: 'roadmap-pr', version: 3 }]) as { repository: string; course: string; version: number }[] };
      // The reference: gatesFor over the snapshot's own items, in its ready order — each at its
      // course's start, its start leg ready (the interim post's placement).
      const expected = snap.ready.filter((rid: string) => {
        const it = itemsOf(label).find((x) => x.id === rid)!;
        const ticket = { repository: 'docs', course: 'roadmap-pr', tier: it.tier, requires: it.requires, operator_only: it.tags.includes('OP') || (it.requires ?? []).includes('human-operator'), tiers: ['routine', 'judgement', 'critical'] };
        return gatesFor(facts, ticket, { name: 'implement', state: 'ready', bars: [] }, 'claim', { now: T0, claims: [], override: null, minWorkerVersion: 3, headObservation: 1, lastEndObservation: -1 }).ok;
      });
      const got = await recommended(id);
      expect([w.session, got]).toEqual([w.session, expected.map(q)]);
    }
  });

  // Granted keys (R-BTN-58): rule 4 within the grant, rule 5 under its max_tier, rule 6 by a
  // granted human-operator, rule 7 where granted — the query's grant clauses against gatesFor
  // (round 1, 1-A-9 / 1-B-9).
  it('on fixture board A, for granted keys', async () => {
    const admin = await makeKey('ssh-ed25519', 'admin');
    const docsOwner = await makeKey('ssh-ed25519', 'docs-owner');
    const opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
    const TIERS = ['routine', 'judgement', 'critical'];
    const cases = [
      { name: 'venue-judgement', grants: { docs: { capabilities: ['agent-venue'], max_tier: 'judgement' } }, declared: ['agent-venue'], ceiling: 'critical' },
      { name: 'llm-only', grants: { docs: { capabilities: ['llm-call'] } }, declared: ['llm-call'], ceiling: 'critical' },
      { name: 'bare-routine', grants: { docs: { capabilities: [], max_tier: 'routine' } }, declared: [], ceiling: 'critical' },
      { name: 'operator', grants: { docs: { capabilities: ['agent-venue', 'human-operator'] } }, declared: ['agent-venue', 'human-operator'], ceiling: 'critical' },
      { name: 'ops-only', grants: { ops: { capabilities: ['agent-venue'] } }, declared: ['agent-venue'], ceiling: 'critical' },
    ];
    for (const [i, c] of cases.entries()) {
      const key = await makeKey('ssh-ed25519', c.name);
      for (const [repo, g] of Object.entries(c.grants) as [string, { capabilities: string[]; max_tier?: string }][]) {
        const r = await keyCall(admin, '/v1/admin/grants', { repository: repo, public_key: key.publicKey, hostname: `g-${i}`, capabilities: g.capabilities, ...(g.max_tier ? { max_tier: g.max_tier } : {}) });
        expect([c.name, r.status]).toEqual([c.name, 200]);
      }
      const created = Math.floor((await withCore((x) => x.now())) / 1000);
      // A granted key declares courses only of repositories it is granted on (§10.1).
      const courses = Object.keys(c.grants).map((repository) => ({ repository, course: 'roadmap-pr', version: 3 }));
      const body = hbBody('vm-a', { hostname: `g-${i}`, session_name: c.name, secret_hash: await sha256(c.name), capabilities: c.declared, tier_ceiling: c.ceiling, courses });
      const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/runner/heartbeat`, { created, body: JSON.stringify(body) }));
      const hb = (await res.json()) as { worker_id: number };
      expect([c.name, res.status]).toEqual([c.name, 200]);
      const docs = (c.grants as Record<string, { capabilities: string[]; max_tier?: string } | undefined>).docs;
      const grants = Object.fromEntries(Object.entries(c.grants).map(([repo, g]) => [repo, {
        capabilities: [...new Set([...capabilitiesOf(g.capabilities), ...(g.capabilities.includes('human-operator') ? ['human-operator'] : [])])],
      }]));
      // Rule 5 under the grant's cap: the lower of the declared ceiling and max_tier.
      const ceiling = docs?.max_tier && TIERS.indexOf(docs.max_tier) < TIERS.indexOf(c.ceiling) ? docs.max_tier : c.ceiling;
      const facts = { tier_ceiling: ceiling, declared: c.declared, tags: [], grants, courses };
      const expected = board.states.A.ready.filter((rid: string) => {
        const it = itemsOf('A').find((x) => x.id === rid)!;
        const ticket = { repository: 'docs', course: 'roadmap-pr', tier: it.tier, requires: it.requires, operator_only: it.tags.includes('OP') || (it.requires ?? []).includes('human-operator'), tiers: TIERS };
        return gatesFor(facts, ticket, { name: 'implement', state: 'ready', bars: [] }, 'claim', { now: T0, claims: [], override: null, minWorkerVersion: 3, headObservation: 1, lastEndObservation: -1 }).ok;
      });
      expect([c.name, await recommended(hb.worker_id)]).toEqual([c.name, expected.map(q)]);
      // Not vacuous: a docs grant with the venue is offered something; an ops-only key nothing of docs'.
      if (c.name === 'venue-judgement') expect(expected.length).toBeGreaterThan(0);
      if (c.name === 'ops-only') expect(expected).toEqual([]);
    }
  });

  // Review round 7, finding 0: a key granted `human-operator` on one repository and not on another
  // declares it (its own answer is the union of its grants), so the query's leg half asks it of the
  // grant on the TICKET's repository, as rule 6 does — never the declaration alone.
  it('G-BTN-40 on a human-operator leg: a key granted it on another repository only is no candidate, and the gate agrees', async () => {
    const needs = JSON.parse(JSON.stringify(roadmapPr)) as Record<string, any>;
    needs.legs.implement.requires = { capabilities: ['human-operator'] };
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B, { registry: [course(3, 3, { course: needs })] }));
    const admin = await makeKey('ssh-ed25519', 'admin-r7');
    const docsOwner = await makeKey('ssh-ed25519', 'docs-owner-r7');
    const opsOwner = await makeKey('ssh-ed25519', 'ops-owner-r7');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [docsOwner.publicKey] })).status).toBe(200);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
    // One key: the venue on docs, the venue and the literal on ops. Its declaration names both.
    const key = await makeKey('ssh-ed25519', 'r7-two-repos');
    const declared = ['agent-venue', 'human-operator'];
    for (const [repository, capabilities] of [['docs', ['agent-venue']], ['ops', ['agent-venue', 'human-operator']]] as const) {
      expect((await keyCall(admin, '/v1/admin/grants', { repository, public_key: key.publicKey, hostname: 'r7-two-repos', capabilities: [...capabilities] })).status).toBe(200);
    }
    const body = hbBody('vm-a', { hostname: 'r7-two-repos', session_name: 'r7-two-repos', secret_hash: await sha256('r7-two-repos'), capabilities: declared,
      courses: [{ repository: 'docs', course: 'roadmap-pr', version: 3 }, { repository: 'ops', course: 'roadmap-pr', version: 3 }] });
    const res = await hostCall(await signedRequest(key, `${ORIGIN}/v1/runner/heartbeat`, { created: Math.floor((await withCore((x) => x.now())) / 1000), body: JSON.stringify(body) }));
    expect(res.status).toBe(200);
    const { worker_id } = (await res.json()) as { worker_id: number };
    const ticketId = 'docs:R3-9002';
    // The query itself (not only `recommended`, which filters through the gate): docs' leg asks for
    // a literal the docs grant does not hold, so it is no candidate there — and the gate refuses it.
    const atDocs = await withCore((o) => {
      const c = o.claims as unknown as { candidates: (w: unknown, page: number) => { id: string }[]; worker: (id: number) => unknown;
        item: (id: string) => unknown; gate: (w: unknown, item: unknown, leg: string, phase: string) => { ok: boolean; rule?: number } };
      const facts = c.worker(worker_id);
      const item = c.item(ticketId);
      return { query: c.candidates(facts, 0).map((r) => r.id), gate: c.gate(facts, item, 'implement', 'claim') };
    });
    expect(atDocs).toEqual({ query: [], gate: { ok: false, rule: 4, code: 'missing-capability' } });
    expect(await recommended(worker_id)).not.toContain(ticketId);
    // On ops the grant holds the literal: the same ticket is a candidate whose leg names it, and the
    // gate admits it there — the two faces of one name, agreeing on the repository that holds it.
    // The ops posting of the same course, whose one leg asks for the literal too: ops' registry
    // entry is written directly (this scenario posts docs' boards), the other clause of rule 4's
    // leg input satisfied so that the literal is the only reading left.
    await withCore((c) => c.store.exec(`INSERT INTO courses (repository_id, id, version, skill, course_json, leg_capabilities_json, step_kinds, min_worker_version) VALUES ('ops', 'roadmap-pr', 3, 's', ?, ?, '[]', 3)`,
      JSON.stringify(needs), JSON.stringify({ implement: ['human-operator'], review: [], fix: [], adjudicate: [], merge: [] })));
    // A raw move to a cut-over ops, with a sync since the last end — every other clause of the
    // query satisfied, so the leg's literal is the only reading left.
    await rows(`UPDATE tickets SET repository_id = 'ops', course_id = 'roadmap-pr', path = 'content/roadmap/R3-9002.mdx' WHERE id = ?`, ticketId);
    await cutover(1, 'ops');
    await syncCall('/v1/sync/board', payload(sha.C, sha.B, board.states.C, { registry: [course(3, 3, { course: needs })] }));
    const atOps = await withCore((o) => {
      const c = o.claims as unknown as { candidates: (w: unknown, page: number) => { id: string }[]; worker: (id: number) => unknown;
        item: (id: string) => unknown; gate: (w: unknown, item: unknown, leg: string, phase: string) => { ok: boolean; rule?: number } };
      const facts = c.worker(worker_id);
      const item = c.item(ticketId);
      return { query: c.candidates(facts, 0).map((r) => r.id), gate: c.gate(facts, item, 'implement', 'claim') };
    });
    expect(atOps).toEqual({ query: [ticketId], gate: { ok: true } });
  });

  const overtaken = (mutate: (items: any[]) => any[]) => {
    const items = mutate(structuredClone(board.states.A.state.items));
    return payload('e'.repeat(40), sha.A, { ...board.states.A, state: { items }, ready: items.filter((i: any) => i.node?.startsWith('ready-')).map((i: any) => i.id) });
  };
  it.each([
    ['done', (items: any[]) => items.map((i) => (i.id === 'R3-9002' ? { ...i, status: 'done', node: 'done' } : i))],
    ['superseded', (items: any[]) => items.map((i) => (i.id === 'R3-9002' ? { ...i, status: 'superseded', node: 'superseded' } : i))],
    ['archived (gone from the board)', (items: any[]) => items.filter((i) => i.id !== 'R3-9002')],
    ['re-tiered above the holder’s ceiling', (items: any[]) => items.map((i) => (i.id === 'R3-9002' ? { ...i, tier: 'critical' } : i))],
  ])('%s: the claim ends released:stale-board and the holder is told', async (what, mutate) => {
    const { secret } = await register('vm-a', { tier_ceiling: 'judgement' });
    const { json: c } = await claimItem('vm-a', secret, { ticket_id: 'docs:R3-9002' });
    const res = await syncCall('/v1/sync/board', overtaken(mutate));
    expect(await res.json()).toMatchObject({ ok: true, stale_released: 1 });
    expect(await claimRow(c.claim_id)).toMatchObject({ status: 'released', end_reason: 'released:stale-board' });
    expect((await beat('vm-a', secret)).json.messages.filter((m: { kind: string }) => m.kind !== 'unblocked')).toEqual([expect.objectContaining({ kind: 'release', payload: expect.objectContaining({ ticket_id: 'docs:R3-9002', reason: 'stale-board' }) })]);
    // R-BTN-85: a closure under the claim is logged before git wins; a re-tier closes nothing.
    const logged = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'discrepancy' AND ticket_id = 'docs:R3-9002'`);
    expect(logged.map((r) => JSON.parse(r.detail_json).sub)).toEqual(what.startsWith('re-tiered') ? [] : ['closed-under-claim']);
  });

  it('an unchanged item keeps its claim', async () => {
    const { secret } = await register('vm-a');
    const { json: c } = await claimItem('vm-a', secret, { ticket_id: 'docs:R3-9002' });
    expect(await (await syncCall('/v1/sync/board', overtaken((items) => items))).json()).toMatchObject({ stale_released: 0 });
    expect((await claimRow(c.claim_id)).status).toBe('active');
  });
});

describe('§7.1: a held history is accepted after 24 hours or by the owner', () => {
  it('the alarm accepts it at 24 h; the sync’s next force post becomes the head', async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B));
    const force = () => syncCall('/v1/sync/board', payload(sha.D, sha.B, board.states.D, { force: true }));
    expect(await code(await force())).toBe('snapshot-rejected');
    await alarmAt(T0 + 24 * 3_600_000 - S);
    expect(await code(await force())).toBe('snapshot-rejected');
    await alarmAt(T0 + 24 * 3_600_000);
    expect((await force()).status).toBe(200);
    expect((await (await syncCall('/v1/sync/head')).json() as { sha: string }).sha).toBe(sha.D);
  });

  it('the owner accepts it at once', async () => {
    await syncCall('/v1/sync/board', payload(sha.B, sha.A, board.states.B));
    await syncCall('/v1/sync/board', payload(sha.D, sha.B, board.states.D, { force: true }));
    expect((await owner('/v1/ui/board/accept', { repository: 'docs', sha: sha.D })).status).toBe(200);
    expect((await syncCall('/v1/sync/board', payload(sha.D, sha.B, board.states.D, { force: true }))).status).toBe(200);
  });
});
