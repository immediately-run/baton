import { beforeEach, expect, it } from 'vitest';
import { course, cutover, Git, keyCall, placed, rows, setAdminKeys, setClock } from '../helpers';
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
