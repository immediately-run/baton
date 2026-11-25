import { beforeEach, expect, it } from 'vitest';
import { course, cutover, Git, keyCall, placed, rows, setAdminKeys, setClock, syncToken } from '../helpers';
import { grantedRunner, signed } from '../lib/fleet';
import { makeKey, type TestKey } from '../lib/sshKeys';

const now = Date.parse('2026-10-16T12:00:00Z');
let owner: TestKey;

beforeEach(async () => {
  await setClock(now);
  const admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
});

const why = (ticket: string, query = '') => signed(owner, `/v1/repositories/docs/tickets/${ticket}/prerequisites${query}`);
const review = placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]);

it('S-BTN-72: replays a posted prerequisite that gates review but not implement', async () => {
  const git = new Git().add('P').add('B', { depends_at: [{ ticket: 'P', at: ['pr-open'], leg: 'review' }] });
  expect(await git.post()).toMatchObject({ status: 200 });
  await cutover(now);
  const w = await grantedRunner(owner, 'docs', 'runner', []);
  const claim = await w.call('/v1/runner/claim', { request_id: 'posted-only', ticket_id: 'docs:B' });
  expect(claim.status).toBe(200);
  const advance = (body: Record<string, unknown>) => w.call(`/v1/runner/claims/${claim.json.claim_id}/advance`, body);
  expect((await advance({ leg: 'implement' })).status).toBe(200);
  expect((await advance({ leg: 'review', reached: 'pr-open' })).json).toMatchObject({ code: 'blocked' });
  git.place('P', review);
  expect(await git.post()).toMatchObject({ status: 200 });
  expect((await advance({ leg: 'review', reached: 'pr-open' })).status).toBe(200);
});

it('S-BTN-72 and S-BTN-74: binds only the named leg and reports met and unmet indexed rows', async () => {
  const base = course();
  const file = structuredClone(base.course);
  const configured = { ...file, legs: { ...file.legs, review: { ...file.legs.review, requires: {
    tickets: [{ select: 'parent', reached: ['pr-open'] }], capabilities: ['agent-venue'],
  } } } };
  const git = new Git().add('P').add('B', { parent: 'P', depends_at: [{ ticket: 'P', at: ['pr-open'], leg: 'review' }] }).add('NO-PARENT');
  git.registry = [{ ...base, course: configured }];
  expect(await git.post()).toMatchObject({ status: 200 });
  await cutover(now);
  const w = await grantedRunner(owner, 'docs', 'runner', []);
  const out = await w.call('/v1/repositories/docs/tickets/B/prerequisites?leg=review&runner=me');
  expect(out.status).toBe(200);
  expect(out.json.prerequisites).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'station', met: false, why: 'not-at' }),
    expect.objectContaining({ kind: 'capability', why: 'not-declared' }),
    expect.objectContaining({ ref: 'docs:P@at:pr-open', why: 'not-at' }),
    expect.objectContaining({ ref: 'docs:P@reached:pr-open', why: 'not-reached' }),
  ]));
  expect((await why('NO-PARENT', '?leg=review')).json.prerequisites).toEqual(expect.arrayContaining([
    expect.objectContaining({ ref: 'parent@reached:pr-open', why: 'no-parent' }),
  ]));
  expect((await why('B')).json.ready).toBe(true);
  const recommendations = await w.call('/v1/runner/recommendations');
  expect(recommendations.json.recommendations).toEqual(expect.arrayContaining([expect.objectContaining({ ticket_id: 'docs:B' })]));
  const claim = await w.call('/v1/runner/claim', { request_id: 'prereq-test', ticket_id: 'docs:B' });
  expect(claim.status).toBe(200);
  const advance = (body: Record<string, unknown>) => w.call(`/v1/runner/claims/${claim.json.claim_id}/advance`, body);
  expect((await advance({ leg: 'implement' })).status).toBe(200);
  expect((await advance({ leg: 'review', reached: 'pr-open' })).json).toMatchObject({ code: 'blocked' });

  git.place('P', review).place('B', review);
  expect(await git.post()).toMatchObject({ status: 200 });
  expect((await why('B')).json.prerequisites).toEqual(expect.arrayContaining([
    expect.objectContaining({ ref: 'docs:P@at:pr-open', met: true }),
    expect.objectContaining({ ref: 'docs:P@reached:pr-open', met: true }),
  ]));
  expect(await rows("SELECT ref FROM ticket_blocks WHERE ticket_id = 'docs:B' AND kind = 'ticket'")).toEqual([]);
});

it('S-BTN-82: every internal edge of a cycle stays blocked even when its predicate is met', async () => {
  const atFiled = (...tickets: string[]) => tickets.map((ticket) => ({ ticket, at: ['filed'] }));
  const git = new Git().add('A', { depends_at: atFiled('B', 'C') })
    .add('B', { depends_at: atFiled('A', 'C') }).add('C', { depends_at: atFiled('B', 'D') }).add('D');
  expect(await git.post()).toMatchObject({ status: 200 });
  expect(await rows('SELECT ticket_id, ref FROM ticket_dependents WHERE cycle = 1 ORDER BY ticket_id, ref')).toEqual([
    { ticket_id: 'docs:A', ref: 'docs:B@at:filed' }, { ticket_id: 'docs:A', ref: 'docs:C@at:filed' },
    { ticket_id: 'docs:B', ref: 'docs:A@at:filed' }, { ticket_id: 'docs:B', ref: 'docs:C@at:filed' },
    { ticket_id: 'docs:C', ref: 'docs:B@at:filed' },
  ]);
  expect((await why('C')).json.prerequisites).toContainEqual(expect.objectContaining({ ref: 'docs:D@at:filed', met: true }));
  git.add('B').add('C', { depends_at: atFiled('D') });
  expect(await git.post()).toMatchObject({ status: 200 });
  expect(await rows('SELECT ref FROM ticket_blocks WHERE kind = \'ticket\'')).toEqual([]);
});

it('S-BTN-72: a posted selector drops withdrawn targets as a group and keeps independent answers', async () => {
  const base = course();
  const file = structuredClone(base.course);
  const git = new Git().add('W').add('P')
    .add('B', { parent: 'P', depends_at: [{ ticket: 'W', closed: true, leg: 'review' }, { ticket: 'P', done: true, leg: 'review' }] })
    .add('EMPTY', { depends_at: [{ ticket: 'W', closed: true, leg: 'review' }] });
  git.registry = [{ ...base, course: { ...file, legs: { ...file.legs, review: { ...file.legs.review, requires: { tickets: [
    { select: 'parent', course: 'other-course', done: true, allow_empty: true },
    { select: 'posted', done: true, skip_withdrawn: true },
  ] } } } } }];
  expect(await git.post()).toMatchObject({ status: 200 });
  git.close('W', 'withdrawn').close('P', 'done');
  expect(await git.post()).toMatchObject({ status: 200 });
  const entries = (await why('B', '?leg=review')).json.prerequisites;
  expect(entries.filter((r: { ref: string }) => r.ref === 'docs:P@done')).toHaveLength(3);
  expect(entries).toContainEqual(expect.objectContaining({ ref: 'docs:W@done', met: true }));
  expect((await why('EMPTY', '?leg=review')).json.prerequisites).toContainEqual(expect.objectContaining({ ref: 'docs:W@done', why: 'empty-selection' }));
});

it('S-BTN-72: refuses a dependency bound to a leg missing from the accepted course', async () => {
  expect(await new Git().add('P').add('B', { depends_at: [{ ticket: 'P', done: true, leg: 'reveiw' }] }).post()).toMatchObject({
    status: 400, message: expect.stringContaining('reveiw is not a leg of roadmap-pr'),
  });
});

it('S-BTN-74: consent withdrawal clears the indexed answer and reinstates the gate without a sync', async () => {
  const admin = await makeKey('ssh-ed25519', 'admin');
  const target = await makeKey('ssh-ed25519', 'ops-owner');
  await setAdminKeys(admin);
  const path = 'immediately-run/ops';
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: path, forge: 'github',
    remote: `ssh://git@github.com/${path}`, default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [target.publicKey] })).status).toBe(200);
  const ops = new Git(await syncToken({ repository: path, job_workflow_ref: `${path}/.github/workflows/baton-sync.yml@refs/heads/main` })).add('P');
  expect(await ops.post()).toMatchObject({ status: 200 });
  expect(await new Git().add('B', { depends_at: [{ ticket: 'ops:P', at: ['filed'], leg: 'implement' }] }).post()).toMatchObject({ status: 200 });
  await cutover(now);
  const runner = await grantedRunner(owner, 'docs', 'runner', []);
  const consent = (verb: string) => keyCall(target, '/v1/owner/ops/dependency-consents', { repository: 'docs', [verb]: true });
  expect((await consent('confirm')).status).toBe(200);
  expect((await why('B')).json).toMatchObject({ ready: true, prerequisites: expect.arrayContaining([
    expect.objectContaining({ ref: 'ops:P@at:filed', met: true, station: 'filed' }),
  ]) });
  expect((await consent('withdraw')).status).toBe(200);
  expect((await why('B')).json).toMatchObject({ ready: false, prerequisites: expect.arrayContaining([
    expect.objectContaining({ ref: 'ops:P@at:filed', why: 'unknown-ticket', station: null }),
  ]) });
  expect((await runner.call('/v1/runner/claim', { request_id: 'without-consent', ticket_id: 'docs:B' })).json).toMatchObject({ code: 'blocked' });
});

it('S-BTN-74: explains owner bars on the requested leg, not the queued leg', async () => {
  expect(await new Git().add('B').post()).toMatchObject({ status: 200 });
  const runner = await grantedRunner(owner, 'docs', 'runner', []);
  expect((await runner.beat({ tags: ['family:a', 'family:b'] })).status).toBe(200);
  for (const [leg, tag] of [['implement', 'family:a'], ['review', 'family:b']]) {
    expect((await keyCall(owner, '/v1/owner/docs/bars', { course: 'roadmap-pr', tag, legs: [leg], applies: 'claim', reason: 'test' })).status).toBe(200);
  }
  for (const [leg, tag] of [['implement', 'family:a'], ['review', 'family:b']]) {
    expect((await why('B', `?leg=${leg}`)).json).toMatchObject({ ready: false, other: [
      { kind: 'bars', detail: expect.objectContaining({ tag }) },
    ] });
  }
});

it('S-BTN-82: keeps cycles and unknown tickets blocked, and retains the final path on closure', async () => {
  const git = new Git().add('A', { depends_at: [{ ticket: 'B', done: true }] })
    .add('B', { depends_at: [{ ticket: 'A', done: true }] })
    .add('P', {}, review).add('W')
    .add('D', { depends_at: [{ ticket: 'P', reached: ['pr-open'] }, { ticket: 'W', done: true },
      { ticket: 'W', withdrawn: true }, { ticket: 'W', closed: true }, { ticket: 'UNKNOWN', closed: true }] });
  expect(await git.post()).toMatchObject({ status: 200 });
  expect(await rows("SELECT ref FROM ticket_blocks WHERE ticket_id IN ('docs:A', 'docs:B') ORDER BY ref")).toEqual([{ ref: 'docs:A@done' }, { ref: 'docs:B@done' }]);
  expect(await rows("SELECT seq FROM events WHERE json_extract(detail_json, '$.type') = 'baton.prerequisite-cycle'")).toHaveLength(1);
  git.close('P', 'done').close('W', 'withdrawn');
  expect(await git.post()).toMatchObject({ status: 200 });
  expect((await why('D')).json.prerequisites).toEqual(expect.arrayContaining([
    expect.objectContaining({ ref: 'docs:P@reached:pr-open', met: true }),
    expect.objectContaining({ ref: 'docs:W@done', why: 'withdrawn' }),
    expect.objectContaining({ ref: 'docs:W@withdrawn', met: true }),
    expect.objectContaining({ ref: 'docs:W@closed', met: true }),
    expect.objectContaining({ ref: 'docs:UNKNOWN@closed', why: 'unknown-ticket' }),
  ]));
});
