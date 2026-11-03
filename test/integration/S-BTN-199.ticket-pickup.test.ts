// S-BTN-199 the git-lock pickup asks Baton (B-129; R-BTN-179's one-answer rule, R-BTN-81's
// history, §9's branch-holder query, R-BTN-85 both values): `baton tickets claim` reads the
// ticket from Baton before it writes, so one wrong `status: available` line over an open PR (the
// 2026-10-27 release over PR #109) hands the next session Baton's position instead of a fresh
// start. Must hold: the board read answers the station, the ready leg and — the field B-129 adds —
// the repository's live claims, each with its holder and when its lease ends; the history read
// answers the path and — the other field — the ended claims' branches and PRs (newest first,
// each once, so a later review claim that pushed nothing keeps the PR), the PR a false `prs: []`
// lost; a legacy claim is a holder with no lease; the branch-holder query answers a held branch;
// the CLI's own reader (`readTicketPosition`) reads the real core's answers as the takeover's
// position (local host: it reads a key file); and a post whose frontmatter says `available`
// while it places the ticket past its course's start and whose `prs` lacks a PR Baton's record
// holds is a `position-disagrees` discrepancy with both values (prs included), listed once among
// the dashboard's discrepancies — a release that keeps its PRs is none. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { adminSession, advance, claimItem, cutover, endClaim, Git, keyCall, placed, register, rows, sessionCall, setAdminKeys, setClock, workerCall } from '../helpers';
import { makeKey, signedRequest, type TestKey } from '../lib/sshKeys';
import { call as hostCall, HOST } from '#host';
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

/** A legacy worker's claim on `ticket` (§13 step 3's shape, as the cutover import makes it): a
 *  holder with no lease the alarm would end. */
async function legacyClaim(ticket: string) {
  await rows(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('legacy', 'legacy', '[]', 'legacy') ON CONFLICT (id) DO NOTHING`);
  await rows(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
              VALUES ('legacy', ?, 'x', 'legacy', 'claude-code', 'legacy', 'critical', 0, '', ?, ?)`, `item-${ticket.split(':')[1]}`, T0, T0);
  const worker = (await rows<{ id: number }>(`SELECT id FROM workers WHERE kind = 'legacy' ORDER BY id DESC LIMIT 1`))[0].id;
  await rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status) VALUES (?, ?, ?, 'abc123', '', ?, 'active')`, ticket, worker, `legacy:${ticket}`, T0);
  return worker;
}

/** T-1's implement claim, run by `cred`: it pushes a branch and opens #109, reaches pr-open with
 *  review next, and is released — Baton's resume record then holds both. */
async function implementAndRelease(cred: 'vm-a' | 'vm-b', ticket: string, branch: string, pr: string) {
  const w = await register(cred);
  const c = (await claimItem(cred, w.secret, { ticket_id: ticket })).json;
  await advance(cred, w.secret, c.claim_id, { leg: 'implement' });
  await workerCall('/v1/runner/activities', { cred, secret: w.secret, body: { activities: [
    { id: `p-${ticket}`, claim_id: c.claim_id, kind: 'push', source: 'skill', started_at: T0, ended_at: T0, outcome: 'succeeded', detail: { branch } },
    { id: `o-${ticket}`, claim_id: c.claim_id, kind: 'open-pr', source: 'skill', started_at: T0, ended_at: T0, outcome: 'succeeded', detail: { pr } },
  ] } });
  await advance(cred, w.secret, c.claim_id, { reached: 'pr-open', leg: 'review' });
  expect((await endClaim(cred, w.secret, c.claim_id, { end_reason: 'released:requested', reached: 'pr-open', next: 'review' })).status).toBe(200);
  return w;
}

describe('S-BTN-199 the git-lock pickup asks Baton', () => {
  it('the board answers the lock with each holder and its lease\'s end; the history answers the PRs a false frontmatter lost', async () => {
    const git = new Git()
      .add('T-1', { display: { status: 'in-progress' } }, placed('filed', [], [['implement', 'ready']]))
      .add('T-2', { display: { status: 'available' } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    await cutover();

    // W1 ran T-1's implement, pushed a branch and opened #109, and was released: Baton's resume
    // record holds both even after the release wrote `prs: []` over the ticket's frontmatter.
    await implementAndRelease('vm-a', 'docs:T-1', 'claude/T-1-seed-owner-keys', PR);

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

    // A legacy worker's claim (the cutover import's) is a holder too — with no lease the alarm
    // would end, so `lease_ends_at` is null — and a claim through git is refused by it.
    const legacy = await legacyClaim('docs:T-2');
    expect((await read(reader, '/v1/repositories/docs/board')).json.holders).toEqual([
      { ticket_id: 'docs:T-2', worker_id: legacy, hostname: 'legacy', session_name: 'item-T-2', lease_ends_at: null }]);
  });

  it('the history\'s resume keeps the PR when the newest ended claim is a review that pushed nothing (B-91\'s shape)', async () => {
    const git = new Git().add('T-1', { display: { status: 'in-progress' } }, placed('filed', [], [['implement', 'ready']]));
    await git.post();
    await cutover();
    await implementAndRelease('vm-a', 'docs:T-1', 'claude/T-1-seed-owner-keys', PR);
    // The sync sees the PR: T-1 at pr-open, review ready, its release keeping #109.
    git.add('T-1', { display: { status: 'available' }, course: { prs: [PR] } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    // W2 claims the review leg, runs it and is released having pushed nothing and opened nothing:
    // the newest ended claim's own record names no PR, and the history still answers #109.
    await setClock(T0 + 60_000);
    const w2 = await register('vm-b');
    const c2 = (await claimItem('vm-b', w2.secret, { ticket_id: 'docs:T-1' })).json;
    expect(c2.claim_id).toBeTypeOf('number');
    await advance('vm-b', w2.secret, c2.claim_id, { leg: 'review' });
    expect((await endClaim('vm-b', w2.secret, c2.claim_id, { end_reason: 'released:requested', reached: 'pr-open', next: 'review' })).status).toBe(200);
    const history = await read(reader, '/v1/repositories/docs/tickets/docs:T-1/history');
    expect(history.json.resume).toEqual({ end_reason: 'released:requested', ended_at: T0 + 60_000, branches: ['claude/T-1-seed-owner-keys'], prs: [PR] });
  });

  it.runIf((HOST as string) === 'local')('contract: the CLI\'s reader reads the real core\'s board and history as the takeover\'s position', async () => {
    const git = new Git().add('T-1', { display: { status: 'in-progress' } }, placed('filed', [], [['implement', 'ready']]));
    await git.post();
    await cutover();
    await implementAndRelease('vm-a', 'docs:T-1', 'claude/T-1-seed-owner-keys', PR);
    // B-91's 2026-10-27 state: the sync places T-1 at pr-open from the PR's facts, review ready,
    // while the release wrote `available` and `prs: []`.
    git.add('T-1', { display: { status: 'available' } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    // The CLI's own reader, over the host: an API-key-shaped key file (so `send` signs nothing
    // locally), and a fetch that re-signs each request as the granted reader — the real core's
    // JSON for the board, the history and the branch-holder query, not a stand-in's.
    // The reader and Node's modules, named through a variable: this file is typechecked for both
    // hosts, and the Workers types have no `node:` modules — the test runs on the local host only.
    const nodeModule = (name: string): Promise<any> => import(/* @vite-ignore */ name);
    const { readTicketPosition } = (await nodeModule('../../src/defaults/tickets-baton')) as { readTicketPosition: (o: Record<string, unknown>) => Promise<{ rows: { kind: string; reached?: string }[] } & Record<string, unknown>> };
    const { mkdtempSync, writeFileSync } = await nodeModule('node:fs');
    const { tmpdir } = await nodeModule('node:os');
    const { join } = await nodeModule('node:path');
    const keyFile: string = join(mkdtempSync(join(tmpdir(), 'baton-s199-')), 'key');
    writeFileSync(keyFile, `bak_${'0'.repeat(16)}_${'a'.repeat(64)}\n`);
    const asked: string[] = [];
    const fetchImpl = (async (target: string | URL | Request) => {
      const url = new URL(String(target));
      asked.push(url.pathname);
      return hostCall(await signedRequest(reader, ORIGIN + url.pathname + url.search, { created: Math.floor(Date.parse('2026-10-27T12:00:01Z') / 1000) }));
    }) as typeof fetch;
    const position = await readTicketPosition({ url: ORIGIN, keyFile, repository: 'docs', ticket: 'T-1', forgePath: 'immediately-run/docs', start: 'filed', fetchImpl });
    expect(position).toMatchObject({
      ready: { station: 'pr-open', leg: 'review' },
      station: 'pr-open',
      pastStart: true,
      holders: [],
      resume: { end_reason: 'released:requested', ended_at: T0, branches: ['claude/T-1-seed-owner-keys'], prs: [PR] },
      branch: { branch: 'claude/T-1-seed-owner-keys', held_by_other: false, fence_pending: false },
      serverTime: T0,
    });
    expect(position.rows.some((r) => r.kind === 'leg-finished' && r.reached === 'pr-open')).toBe(true);
    expect(asked).toEqual(['/v1/repositories/docs/board', '/v1/repositories/docs/tickets/docs%3AT-1/history', '/v1/runner/branch-holder']);
  });

  it('a post saying available, without a PR Baton holds, of a ticket past its start is a position-disagrees discrepancy with both values, named once', async () => {
    const PR2 = 'https://github.com/immediately-run/docs/pull/110';
    const git = new Git()
      .add('T-1', { display: { status: 'in-progress' } }, placed('filed', [], [['implement', 'ready']]))
      .add('T-2', { display: { status: 'in-progress' } }, placed('filed', [], [['implement', 'ready']]));
    await git.post();
    await cutover();
    await implementAndRelease('vm-a', 'docs:T-1', 'claude/T-1-seed-owner-keys', PR);
    await implementAndRelease('vm-b', 'docs:T-2', 'claude/T-2-x', PR2);
    const disagreements = () => rows<{ ticket_id: string; detail_json: string }>(
      `SELECT ticket_id, detail_json FROM events WHERE kind = 'discrepancy' AND json_extract(detail_json, '$.sub') = 'position-disagrees' ORDER BY seq`);
    // The false release: T-1's frontmatter says `available` with `prs: []` while the same post's
    // PR facts place it at pr-open and Baton's record holds #109 — B-91's 2026-10-27 state. T-2's
    // release kept its PR: the ordinary hand-off, no disagreement.
    git.add('T-1', { display: { status: 'available' } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    git.add('T-2', { display: { status: 'available' }, course: { prs: [PR2] } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    const event = await disagreements();
    expect(event).toHaveLength(1);
    expect(event[0].ticket_id).toBe('docs:T-1');
    expect(JSON.parse(event[0].detail_json)).toEqual({
      sub: 'position-disagrees',
      baton: { station: 'pr-open', path: [{ leg: 'implement', reached: 'pr-open' }], prs: [PR] },
      git: { status: 'available', prs: [] },
      observation: 2,
    });
    expect(await rows<{ detail_json: string }>(`SELECT detail_json FROM ticket_history WHERE kind = 'discrepancy' AND ticket_id = 'docs:T-1' AND json_extract(detail_json, '$.sub') = 'position-disagrees'`))
      .toEqual([{ detail_json: event[0].detail_json }]);
    // The dashboard lists it (R-BTN-85, the Discrepancies of the last 7 days)…
    const cookie = await adminSession(admin);
    const state = (await (await sessionCall(cookie, '/v1/ui/state')).json()) as Record<string, any>;
    expect(state.discrepancies.by_kind['position-disagrees']).toBe(1);
    expect(state.discrepancies.rows).toEqual(expect.arrayContaining([expect.objectContaining({ ticket_id: 'docs:T-1', sub: 'position-disagrees' })]));
    // …and a later post with the same two values is the same disagreement, not a new one every
    // sync — judged against the last `position-disagrees` row, whatever other discrepancy the
    // ticket logged since; a ticket at its course's start, one whose frontmatter says otherwise,
    // and one whose release kept its PR are none.
    // Another case's discrepancy on the same ticket since (R-BTN-85's `regressed`, logged as the
    // core logs it): the dedup reads the last `position-disagrees` row, not the last row.
    await rows(`INSERT INTO events (at, kind, ticket_id, claim_id, actor, detail_json, repository_id) VALUES (?, 'discrepancy', 'docs:T-1', NULL, 'sync', ?, 'docs')`,
      T0, JSON.stringify({ sub: 'regressed', baton: {}, git: {}, observation: 2 }));
    await git.post();
    expect(await disagreements()).toHaveLength(1);
    git.add('T-9', { display: { status: 'available' } });
    await git.post();
    git.add('T-9', { display: { status: 'available' } }, placed('filed', [], [['implement', 'ready']]));
    await git.post();
    git.add('T-1', { display: { status: 'in-progress' } }, placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]));
    await git.post();
    expect(await disagreements()).toHaveLength(1);
  });
});
