// S-BTN-46 a decision reaches its owner (BATON_SPEC §13a, §2g R-BTN-80; R3-1256), on both hosts.
// docs' owner registers two couriers for `asks: owner` — the owner's CLI key and a phone-push
// service's key — and the other repository's owner one for theirs; E posts the open decision
// R3-E-1; the push courier claims and dies before marking; the CLI runs `baton decision list`; a
// day passes; the owner answers in git; the push courier, restarted, marks its notice sent after
// the answer. Must hold: one notice per docs courier and none for the other repository's, the
// lapsed lease claimed again, the CLI printing E's title, question and link as text and marking
// its notice sent, `--all` listing R3-E-1 whatever the notices' state, the reminder after 24 h,
// both notices closed by the answering snapshot that fires `unblocked`, the late mark answered
// `closed`, a third courier queued its notice at once, and the CLI's key refused as a worker key.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, keyCall, placed, rows, setAdminKeys, setClock, tick } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { signed } from '../lib/fleet';
// @ts-expect-error a plain .mjs module, no types
import { listOnce } from '../../cli/decisions.mjs';

const T0 = Date.parse('2026-10-16T12:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const URL7 = 'https://github.com/immediately-run/docs/pull/7';

let admin: TestKey;
let owner: TestKey;
let opsOwner: TestKey;
let cli: TestKey;
let push: TestKey;
let opsCli: TestKey;
let git: Git;

const notices = () => rows<{ credential_id: string; repository_id: string; ref: string; state: string }>(
  'SELECT credential_id, repository_id, ref, state FROM notices ORDER BY repository_id, ref, credential_id');
/** The CLI courier as `baton decision list` runs it, its requests signed with `key`. */
const decisionList = async (key: TestKey, all = false) => {
  const out: string[] = [];
  await listOnce((method: string, path: string, body?: unknown) => signed(key, path, { method, body }), (t: string) => out.push(t), { all });
  return out.join('\n');
};

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  opsOwner = await makeKey('ssh-ed25519', 'ops-owner');
  cli = await makeKey('ssh-ed25519', 'owner-cli');
  push = await makeKey('ssh-ed25519', 'phone-push');
  opsCli = await makeKey('ssh-ed25519', 'ops-cli');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'ops', github: 'immediately-run/ops', default_branch: 'main',
    sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [opsOwner.publicKey] })).status).toBe(200);
  for (const k of [cli, push]) expect((await keyCall(owner, '/v1/owner/docs/couriers', { public_key: k.publicKey, asks: ['owner'] })).status).toBe(200);
  expect((await keyCall(opsOwner, '/v1/owner/ops/couriers', { public_key: opsCli.publicKey, asks: ['owner'] })).status).toBe(200);
  git = new Git().add('E', {}, placed('filed', [], [['implement', 'ready']], { decisions: [{ id: 'R3-E-1', asks: 'owner', url: URL7 }] }));
  expect((await git.post()).status).toBe(200);
});

describe('S-BTN-46 a decision reaches its owner', () => {
  it('queues per courier, re-claims a lapsed lease, prints as text, reminds, closes on the answer, and answers a late mark `closed`', async () => {
    // One notice per docs courier; none for the other repository's.
    expect(await notices()).toEqual([cli.fingerprint, push.fingerprint].sort().map((c) => ({ credential_id: c, repository_id: 'docs', ref: 'R3-E-1', state: 'queued' })));
    expect((await signed(opsCli, '/v1/courier/notices/claim', { body: {} })).json.notices).toEqual([]);

    // The push courier claims and dies before marking.
    const first = await signed(push, '/v1/courier/notices/claim', { body: {} });
    expect(first.json.notices).toEqual([{ notice_id: expect.stringMatching(/^[0-9a-f]{32}$/), kind: 'decision', repository: 'docs', ticket: 'docs:E',
      title: 'E — a fixture ticket', decision: { id: 'R3-E-1', asks: 'owner', url: URL7 }, unblocks: ['docs:E'], created_at: T0 }]);
    const pushNotice = first.json.notices[0].notice_id as string;

    // The CLI runs `baton decision list`: the title, the question and the link, as text; its notice is marked sent.
    expect(await decisionList(cli)).toBe(`docs:E — E — a fixture ticket\n  decision R3-E-1 (asks owner)\n  ${URL7}`);
    expect(await rows('SELECT state, channel FROM notices WHERE credential_id = ?', cli.fingerprint)).toEqual([{ state: 'sent', channel: 'cli' }]);
    // A second run has nothing new; `--all` still lists R3-E-1, whatever its notices' state.
    expect(await decisionList(cli)).toBe('');
    expect(await decisionList(cli, true)).toBe(`docs:E — E — a fixture ticket\n  decision R3-E-1 (asks owner)\n  ${URL7}\n  notice: sent`);

    // The push courier's lease lapses, and its notice is claimed again.
    await setClock(T0 + 10 * MIN);
    await tick();
    const again = await signed(push, '/v1/courier/notices/claim', { body: {} });
    expect(again.json.notices.map((n: { notice_id: string }) => n.notice_id)).toEqual([pushNotice]);

    // A day after it was sent, the CLI's notice is queued again: the decision is still open.
    await setClock(T0 + DAY);
    await tick();
    expect(await rows('SELECT state FROM notices WHERE credential_id = ?', cli.fingerprint)).toEqual([{ state: 'queued' }]);

    // The owner answers in git: the next snapshot no longer posts the decision. It closes both
    // notices in its transaction and fires `unblocked`.
    await setClock(T0 + DAY + MIN);
    git.place('E', placed('filed', [], [['implement', 'ready']]));
    expect((await git.post()).status).toBe(200);
    expect((await notices()).map((n) => n.state)).toEqual(['closed', 'closed']);
    const unblocked = await rows<{ ticket_id: string; detail_json: string }>(`SELECT ticket_id, detail_json FROM events WHERE kind = 'unblocked'`);
    expect(unblocked.map((e) => [e.ticket_id, JSON.parse(e.detail_json).cleared])).toEqual([['docs:E', [{ kind: 'decision', ref: 'R3-E-1' }]]]);
    expect(await decisionList(cli, true)).toBe('no open decisions');

    // The push courier, restarted, marks its notice sent after the answer: `closed`.
    const late = await signed(push, `/v1/courier/notices/${pushNotice}`, { body: { state: 'sent', channel: 'push' } });
    expect(late.status).toBe(409);
    expect(late.json.code).toBe('closed');
  });

  it('a third courier added while another decision is open is queued its notice at once; the CLI’s key is no worker key', async () => {
    git.add('F', {}, placed('filed', [], [['implement', 'ready']], { decisions: [{ id: 'F-1', asks: 'owner' }] }));
    expect((await git.post()).status).toBe(200);
    const third = await makeKey('ssh-ed25519', 'chat-relay');
    expect((await keyCall(owner, '/v1/owner/docs/couriers', { public_key: third.publicKey, asks: ['owner'] })).status).toBe(200);
    expect((await rows<{ ref: string; state: string }>('SELECT ref, state FROM notices WHERE credential_id = ? ORDER BY ref', third.fingerprint)))
      .toEqual([{ ref: 'F-1', state: 'queued' }, { ref: 'R3-E-1', state: 'queued' }]);
    const grant = await keyCall(owner, '/v1/owner/docs/grants', { public_key: cli.publicKey, hostname: 'owner-laptop', capabilities: ['agent-venue'] });
    expect(grant.status).toBe(409);
    expect(grant.json.code).toBe('conflict');
  });
});
