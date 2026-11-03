// S-BTN-199 the git-lock pickup asks Baton (B-129; R-BTN-179's one-answer rule, R-BTN-81's
// history, §9's branch-holder query, R-BTN-85 both values): `baton tickets claim` reads the
// ticket from Baton before it writes, so one wrong `status: available` line over an open PR (the
// 2026-10-27 release over PR #109) hands the next session Baton's position instead of a fresh
// start. Must hold: the board read answers the station, the ready leg and — the field B-129 adds —
// the repository's live claims, each with its holder and when its lease ends; the history read
// answers the path and — the other field — the newest ended claim's branches and PRs, the PR a
// false `prs: []` lost; the branch-holder query answers a held branch; and a post whose
// frontmatter says `available` while it places the ticket past its course's start is a
// `position-disagrees` discrepancy with both values, listed once among the dashboard's
// discrepancies. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, advance, claimItem, cutover, endClaim, Git, keyCall, placed, register, rows, sessionCall, setAdminKeys, setClock, workerCall } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall } from '#host';
import { ORIGIN } from '../helpers';

const T0 = Date.parse('2026-10-27T12:00:00Z');
const PR = 'https://github.com/immediately-run/docs/pull/109';

let admin: TestKey;
let reader: TestKey;

/** A GET signed by `key` — the read a claiming session signs (R-BTN-13, R-BTN-179). */
async function read(key: TestKey, path: string): Promise<{ status: number; json: Record<string, any> }> {
  const res = await hostCall(await signedRequest(key, ORIGIN + path, { created: Math.floor(Date.parse('2026-10-27T12:00:01Z') / 1000) }));
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  reader = await makeKey('ssh-ed25519', 'granted');
  await setAdminKeys(admin);
  // A granted key on the seeded repository (R-BTN-58): the session claiming through git signs
  // the three reads with it. The grant registers the key, so it needs no heartbeat to read.
  expect((await keyCall(admin, '/v1/admin/grants', { repository: 'docs', public_key: reader.publicKey, hostname: 'pickup-vm', capabilities: ['create-pr'] })).status).toBe(200);
});

describe('S-BTN-199 the git-lock pickup asks Baton', () => {
  it('the board answers the lock with each holder and its lease\'s end; the history answers the PRs a false frontmatter lost', async () => {
    const git = new Git()
      .add('T-1', { display: { status: 'in-progress' } }, placed('filed', [], [['implement', 'ready']]))
      .add('T-2', { display: { status: 'available' } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    await cutover();

    // W1 ran T-1's implement, pushed a branch and opened #109, and was released: Baton's resume
    // record holds both even after the release wrote `prs: []` over the ticket's frontmatter.
    const w1 = await register('vm-a');
    const c1 = (await claimItem('vm-a', w1.secret, { ticket_id: 'docs:T-1' })).json;
    await advance('vm-a', w1.secret, c1.claim_id, { leg: 'implement' });
    await workerCall('/v1/runner/activities', { secret: w1.secret, body: { activities: [
      { id: 'p1', claim_id: c1.claim_id, kind: 'push', source: 'skill', started_at: T0, ended_at: T0, outcome: 'succeeded', detail: { branch: 'claude/T-1-seed-owner-keys' } },
      { id: 'o1', claim_id: c1.claim_id, kind: 'open-pr', source: 'skill', started_at: T0, ended_at: T0, outcome: 'succeeded', detail: { pr: PR } },
    ] } });
    await advance('vm-a', w1.secret, c1.claim_id, { reached: 'pr-open', leg: 'review' });
    expect((await endClaim('vm-a', w1.secret, c1.claim_id, { end_reason: 'released:requested', reached: 'pr-open', next: 'review' })).status).toBe(200);

    // W2 holds T-2 live: the board's `holders` names the ticket, its holder and the lease's
    // end — the lock a claim through git reads with the same request that answers the station
    // (R-BTN-179's one-answer rule).
    const w2 = await register('vm-b', { lease_timeout_s: 3_600, session_name: 'claude-review' });
    await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-2' });
    const board = await read(reader, '/v1/repositories/docs/board');
    expect(board.status).toBe(200);
    expect(board.json.ready.find((t: Record<string, unknown>) => t.local_id === 'T-2')).toMatchObject({ station: 'pr-open', leg: 'review' });
    expect(board.json.holders).toEqual([{ ticket_id: 'docs:T-2', worker_id: w2.id, hostname: 'vm-b', session_name: 'claude-review', lease_ends_at: T0 + 3_600_000 }]);

    // The history's `resume` is the PR a false `prs: []` lost, and the branch to continue on.
    const history = await read(reader, '/v1/repositories/docs/tickets/docs:T-1/history');
    expect(history.status).toBe(200);
    expect(history.json.rows.some((r: Record<string, unknown>) => r.kind === 'leg-finished' && r.reached === 'pr-open')).toBe(true);
    expect(history.json.resume).toEqual({ end_reason: 'released:requested', ended_at: T0, branches: ['claude/T-1-seed-owner-keys'], prs: [PR] });

    // The branch-holder query (§9), asked for the branch the resume names: T-2's live claim
    // holds the branch it maps to, so a takeover pushing there is refused; the key alone counts
    // every active claim as another's.
    const branch = await read(reader, '/v1/runner/branch-holder?repo=immediately-run/docs&branch=claude/T-2-x');
    expect(branch.json).toMatchObject({ tickets: ['docs:T-2'], held_by_other: true });

    // The lock ends with the claim: a released or suspended ticket is nobody's to refuse.
    const t2 = (await rows<{ id: number }>('SELECT id FROM claims WHERE ticket_id = ? AND status = ?', 'docs:T-2', 'active'))[0];
    expect((await endClaim('vm-b', w2.secret, t2.id, { end_reason: 'suspended:pr-open', reached: 'pr-open', next: 'review' })).status).toBe(200);
    expect((await read(reader, '/v1/repositories/docs/board')).json.holders).toEqual([]);
  });

  it('a post saying available of a ticket past its start is a position-disagrees discrepancy with both values, named once', async () => {
    // The false release: the frontmatter says `available` while the same post's PR facts place
    // the ticket at pr-open — B-91's 2026-10-27 state, `prs: []` included.
    const git = new Git().add('T-1', { display: { status: 'available' } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    await cutover();
    const event = await rows<{ detail_json: string }>(`SELECT detail_json FROM events WHERE kind = 'discrepancy'`);
    expect(event).toHaveLength(1);
    expect(JSON.parse(event[0].detail_json)).toEqual({
      sub: 'position-disagrees',
      baton: { station: 'pr-open', path: [{ leg: 'implement', reached: 'pr-open' }] },
      git: { status: 'available' },
      observation: 1,
    });
    expect(await rows<{ detail_json: string }>(`SELECT detail_json FROM ticket_history WHERE kind = 'discrepancy' AND ticket_id = 'docs:T-1'`)).toEqual(event);
    // The dashboard lists it (R-BTN-85, the Discrepancies of the last 7 days)…
    const cookie = await adminSession(admin);
    const state = (await (await sessionCall(cookie, '/v1/ui/state')).json()) as Record<string, any>;
    expect(state.discrepancies).toMatchObject({ by_kind: { 'position-disagrees': 1 }, rows: [expect.objectContaining({ ticket_id: 'docs:T-1', sub: 'position-disagrees' })] });
    // …and a later post with the same two values is the same disagreement, not a new one every
    // sync; a ticket at its course's start, or one whose frontmatter says otherwise, is none.
    git.add('T-9', { display: { status: 'available' } });
    await git.post();
    git.add('T-9', { display: { status: 'available' } }, placed('filed', [], [['implement', 'ready']]));
    git.add('T-1', { display: { status: 'in-progress' } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    expect(await rows<{ n: number }>(`SELECT count(*) AS n FROM events WHERE kind = 'discrepancy'`)).toEqual([{ n: 1 }]);
  });
});
