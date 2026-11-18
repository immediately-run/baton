// S-BTN-235 dependencies on another repository's tickets (BATON_SPEC §3.1 R-BTN-47 *Relations
// stay home* as relaxed, §4.4, R-BTN-120; B-113): a ticket's `depends_on` may name another
// registered repository's ticket by its qualified id. Must hold: a target that is no live
// repository, or a ticket neither live nor closed there, refuses the post naming the id, nothing
// stored; a dependency on a less visible repository — its owners not the dependent's, its grants
// not the dependent's — is refused naming the consent route, accepted the moment the target's
// owners consent (`POST /v1/owner/{target}/dependency-consents`), refused again after `withdraw`,
// each change a `dependency-consent` event; a cycle through two boards is refused as one board's
// is, named as its path with qualified ids; the sync's dependencies read answers the target's
// standing `{done, withdrawn, closed, station, url}` — the url built from the target's
// registration — with the post's own refusals, the unconsented one `forbidden`; `blocked_by`
// stays local. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { Git, keyCall, rows, setAdminKeys, setClock, syncCall, syncToken } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-11-18T09:00:00Z');
let admin: TestKey;
let opsOwner: TestKey;
let fhOwner: TestKey;

const fhToken = async () => syncToken({ repository: 'immediately-run/fieldhouse', job_workflow_ref: 'immediately-run/fieldhouse/.github/workflows/baton-sync.yml@refs/heads/main' });
const opsToken = async () => syncToken({ repository: 'immediately-run/ops', job_workflow_ref: 'immediately-run/ops/.github/workflows/baton-sync.yml@refs/heads/main' });
const batonToken = async () => syncToken({ repository: 'immediately-run/baton', job_workflow_ref: 'immediately-run/baton/.github/workflows/baton-sync.yml@refs/heads/main' });
const fhCall = async (path: string, body?: unknown) => syncCall(path, body, await fhToken());

beforeEach(async () => {
  await setClock(T0);
  admin = await makeKey('ssh-ed25519', 's235-admin');
  opsOwner = await makeKey('ssh-ed25519', 's235-ops-owner');
  fhOwner = await makeKey('ssh-ed25519', 's235-fh-owner');
  await setAdminKeys(admin);
  // `fieldhouse` (the dependent) and `ops` (the target) with *different* owner keys, so each is
  // less visible than the other from one side: fieldhouse's board is seen by fhOwner, who does
  // not see ops' — every dependency between them needs the target's owners' consent.
  for (const [id, path, key] of [['fieldhouse', 'immediately-run/fieldhouse', fhOwner], ['ops', 'immediately-run/ops', opsOwner]] as const) {
    expect((await keyCall(admin, '/v1/admin/repositories', {
      id, github: path, forge: 'github', remote: `ssh://git@github.com/${path}`, default_branch: 'main',
      sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [key.publicKey],
    })).status).toBe(200);
  }
});

const consent = (who: TestKey, body: unknown) => keyCall(who, '/v1/owner/ops/dependency-consents', body);

describe('S-BTN-235 dependencies on another repository\'s tickets', () => {
  it('refuses an unregistered repository and an unknown ticket, naming the id, and stores nothing', async () => {
    const ghost = new Git(await fhToken()).add('F-1', { depends_on: ['ghost:B-1'] });
    expect(await ghost.post()).toMatchObject({ status: 400, code: 'invalid-params', message: 'depends_on names ghost:B-1, which is not a repository registered here (B-113)' });
    expect(await rows(`SELECT count(*) AS n FROM tickets WHERE repository_id = 'fieldhouse'`)).toEqual([{ n: 0 }]);
    const ops = new Git(await opsToken()).add('B-1');
    expect((await ops.post()).status).toBe(200);
    const unknown = new Git(await fhToken()).add('F-1', { depends_on: ['ops:B-99'] });
    expect(await unknown.post()).toMatchObject({ status: 400, code: 'invalid-params', message: 'depends_on names ops:B-99, which is neither live nor closed on ops (B-113)' });
    expect(await rows(`SELECT count(*) AS n FROM tickets WHERE repository_id = 'fieldhouse'`)).toEqual([{ n: 0 }]);
    expect(await rows<{ sha: string | null }>(`SELECT sha FROM board_head WHERE repository_id = 'fieldhouse'`)).toEqual([{ sha: null }]);
  });

  it('refuses a dependency on a less visible repository without its owners\' consent, accepts with it, refuses again after withdraw — each change an event', async () => {
    const ops = new Git(await opsToken()).add('B-1');
    expect((await ops.post()).status).toBe(200);
    const fh = new Git(await fhToken());
    fh.add('F-1', { depends_on: ['ops:B-1'] });
    const ask = 'POST /v1/owner/ops/dependency-consents {repository: "fieldhouse", confirm: true} (B-113)';
    const refused = await fh.post();
    expect(refused).toMatchObject({ status: 400, code: 'invalid-params', message: expect.stringContaining('ops is less visible than fieldhouse') });
    expect(refused).toMatchObject({ message: expect.stringContaining(ask) });
    expect(await rows(`SELECT count(*) AS n FROM tickets WHERE repository_id = 'fieldhouse'`)).toEqual([{ n: 0 }]);
    // The consent is the target's owners' to give: the dependent's cannot (R-BTN-140's shape).
    expect((await consent(fhOwner, { repository: 'fieldhouse', confirm: true })).status).toBe(403);
    expect((await consent(opsOwner, { repository: 'fieldhouse', confirm: true })).status).toBe(200);
    expect(await rows(`SELECT granted_by FROM dependency_consents WHERE repository_id = 'ops' AND dependent_id = 'fieldhouse'`)).toEqual([{ granted_by: `owner:${opsOwner.fingerprint}` }]);
    const accepted = await fh.post();
    expect(accepted.status).toBe(200);
    expect(await rows<{ depends_on: string }>(`SELECT depends_on FROM tickets WHERE id = 'fieldhouse:F-1'`)).toEqual([{ depends_on: '["ops:B-1"]' }]);
    // Withdrawn, the next post that keeps the dependency is refused again.
    expect((await consent(opsOwner, { repository: 'fieldhouse', withdraw: true })).status).toBe(200);
    fh.add('F-2', { depends_on: ['ops:B-1'] });
    const again = await fh.post();
    expect(again).toMatchObject({ status: 400, code: 'invalid-params', message: expect.stringContaining(ask) });
    const events = await rows<{ kind: string; detail_json: string }>(`SELECT kind, detail_json FROM events WHERE kind = 'dependency-consent' ORDER BY seq`);
    expect(events.map((e) => [e.kind, (JSON.parse(e.detail_json) as { dependent: string; consent: boolean }).dependent, (JSON.parse(e.detail_json) as { consent: boolean }).consent])).toEqual([
      ['dependency-consent', 'fieldhouse', true],
      ['dependency-consent', 'fieldhouse', false],
    ]);
    // The route's own shape: a repository consents to another's dependencies, never its own, and
    // confirm and withdraw are one of the two.
    expect((await consent(opsOwner, { repository: 'ops', confirm: true })).status).toBe(400);
    expect((await consent(opsOwner, { repository: 'fieldhouse' })).status).toBe(400);
    expect((await consent(opsOwner, { repository: 'ghost', confirm: true })).status).toBe(404);
  });

  it('accepts equally visible repositories with no consent, and refuses a cycle through two boards naming its qualified path', async () => {
    // docs and baton are the seed's, ownerless in tests: every principal that sees one (only an
    // administrator) sees the other, so no dependency between them asks for consent.
    const baton = new Git(await batonToken()).add('B-1', { repos: ['immediately-run/baton'] });
    expect((await baton.post()).status).toBe(200);
    const docs = new Git().add('T-1', { depends_on: ['baton:B-1'] });
    expect((await docs.post()).status).toBe(200);
    expect(await rows<{ depends_on: string }>(`SELECT depends_on FROM tickets WHERE id = 'docs:T-1'`)).toEqual([{ depends_on: '["baton:B-1"]' }]);
    // The cycle, one edge each way: baton's board turns B-1's edge back on a live docs ticket
    // (known there, so accepted), and docs' next post closes the loop — refused as one board's
    // own loop is (B-111), the path named with qualified ids.
    docs.add('T-9');
    expect((await docs.post()).status).toBe(200);
    baton.add('B-1', { depends_on: ['docs:T-9'], repos: ['immediately-run/baton'] });
    expect((await baton.post()).status).toBe(200);
    docs.add('T-9', { depends_on: ['baton:B-1'] });
    const cyclic = await docs.post();
    expect(cyclic).toMatchObject({ status: 400, code: 'invalid-params', message: 'tickets.depends_on: a dependency cycle across repositories: baton:B-1 → docs:T-9 → baton:B-1' });
    // Nothing of the refused post: T-9 stays as the accepted head left it, no edge written.
    expect(await rows<{ depends_on: string }>(`SELECT depends_on FROM tickets WHERE id = 'docs:T-9'`)).toEqual([{ depends_on: '[]' }]);
  });

  it('answers the sync\'s dependencies read against the target\'s board, its url from the registration, and refuses what the post would', async () => {
    const baton = new Git(await batonToken()).add('B-1', { repos: ['immediately-run/baton'] });
    expect((await baton.post()).status).toBe(200);
    const read = await fhCall('/v1/sync/dependencies', { ids: ['ops:B-1'] });
    expect(read.status).toBe(400); // ops holds no B-1: the read refuses what the post would
    expect(((await read.json()) as { message: string }).message).toContain('neither live nor closed on ops');
    expect((await fhCall('/v1/sync/dependencies', { ids: ['ghost:B-1'] })).status).toBe(400);
    // The read is the dependent's credential asking for the target's standing: without consent
    // it is forbidden, naming the consent — never a partial answer.
    const ops = new Git(await opsToken()).add('B-1');
    expect((await ops.post()).status).toBe(200);
    const unconsented = await fhCall('/v1/sync/dependencies', { ids: ['ops:B-1'] });
    expect(unconsented.status).toBe(403);
    expect(((await unconsented.json()) as { message: string }).message).toContain('POST /v1/owner/ops/dependency-consents');
    expect((await consent(opsOwner, { repository: 'fieldhouse', confirm: true })).status).toBe(200);
    const answered = await fhCall('/v1/sync/dependencies', { ids: ['ops:B-1'] });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({
      dependencies: [{
        ticket: 'ops:B-1', repository: 'ops', local: 'B-1', done: false, withdrawn: false, closed: false,
        station: 'filed', url: 'https://github.com/immediately-run/ops/blob/main/content/roadmap/B-1.mdx',
      }],
    });
    // Done there is done here: the target closing `done` turns the answer, and a withdrawn
    // target is closed but not done.
    ops.close('B-1', 'done');
    expect((await ops.post()).status).toBe(200);
    const done = (await (await fhCall('/v1/sync/dependencies', { ids: ['ops:B-1'] })).json()) as { dependencies: { ticket: string; done: boolean; closed: boolean; station: string | null }[] };
    expect(done.dependencies[0]).toMatchObject({ ticket: 'ops:B-1', done: true, closed: true, station: null });
    // The read answers qualified ids of other repositories; a local one is the caller's own.
    expect((await fhCall('/v1/sync/dependencies', { ids: ['F-1'] })).status).toBe(400);
    expect((await fhCall('/v1/sync/dependencies', { ids: ['fieldhouse:F-1'] })).status).toBe(400);
  });

  it('keeps blocked_by local: a qualified id there is refused as a shape error', async () => {
    const bad = new Git(await fhToken()).add('F-1', { blocked_by: ['ops:B-1'] });
    const res = await bad.post();
    expect(res).toMatchObject({ status: 400, code: 'invalid-params', message: expect.stringContaining('blocked_by must be a list') });
  });
});
