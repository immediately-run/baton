import { expect, it } from 'vitest';
import { adminSession, advance, claimItem, claimRow, cutover, endClaim, Git, observe, placed, register, rows, sessionCall, setAdminKeys } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const TICKET = 'T-1';
const EVIDENCE = 'https://github.com/o/r/pull/7#issuecomment-123';

it.each(['done', 'withdrawn', 'dropped'] as const)('S-BTN-326 releases a named suspension when a later accepted snapshot shows the ticket %s', async (closure) => {
  const git = new Git().add(TICKET, {}, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
  expect(await git.post()).toMatchObject({ status: 200 });
  await cutover();
  const admin = await makeKey('ssh-ed25519', 'admin');
  await setAdminKeys(admin);
  const cookie = await adminSession(admin);
  const list = async () => {
    const res = await sessionCall(cookie, '/v1/repositories/docs/tickets?state=unconfirmed');
    expect(res.status).toBe(200);
    return (await res.json() as { tickets: unknown[] }).tickets;
  };
  const runner = await register('vm-a');
  const { json: { claim_id: id } } = await claimItem('vm-a', runner.secret);
  expect((await advance('vm-a', runner.secret, id, { leg: 'review' })).status).toBe(200);
  const early = closure === 'done' ? (await observe()).json.observation : undefined;
  const end = { end_reason: 'suspended:reviewed', reached: 'reviewed', ended_at_sha: EVIDENCE };
  expect((await endClaim('vm-a', runner.secret, id, end)).status).toBe(200);

  if (closure === 'dropped') {
    git.tickets.delete(TICKET);
    delete git.stations[TICKET];
  } else git.close(TICKET, closure);

  if (early !== undefined) {
    // The closure read started before the end: even when accepted, it cannot settle it.
    expect(await git.post({ observation: early })).toMatchObject({ status: 200, confirmed: 0 });
    expect(await list()).toEqual([expect.objectContaining({ ticket_id: 'docs:T-1', title: null, state: 'unconfirmed', detail: expect.objectContaining({ claim_id: id }) })]);
    // A confirm-only repost does not decide ticket membership.
    expect(await git.refresh({ read_sha: '0'.repeat(40) })).toMatchObject({ status: 200, confirmed: 0 });
    expect(await list()).toHaveLength(1);
  } else {
    expect(await list()).toHaveLength(1);
  }

  const later = (await observe()).json.observation;
  const post = early === undefined ? git.post({ observation: later }) : git.refresh({ observation: later });
  expect(await post).toMatchObject({ status: 200, confirmed: 0 });
  expect(await claimRow(id)).toMatchObject({ status: 'released', end_reason: 'released:ticket-closed', confirmed_at: null });
  expect(await rows('SELECT failed_attempt FROM claims WHERE id = ?', id)).toEqual([{ failed_attempt: 0 }]);
  expect(await list()).toEqual([]);
  const events = () => rows<{ actor: string; detail_json: string }>("SELECT actor, detail_json FROM events WHERE claim_id = ? AND kind = 'released'", id);
  const logged = await events();
  expect(logged.map((e) => [e.actor, JSON.parse(e.detail_json)])).toEqual([['sync', { by: 'closure', observation: later, unconfirmed: { end_reason: end.end_reason, ended_at_sha: EVIDENCE } }]]);
  expect(await git.refresh()).toMatchObject({ status: 200, confirmed: 0 });
  expect(await events()).toEqual(logged);
});
