// S-BTN-305 no listing lost (BATON_SPEC §7.3 R-BTN-163, §11.4; B-203): every key of
// `stateView().needs_you` — what V1's Needs you drew — has a V2 home named in the ledger
// (test/lib/needsYouLedger.ts): a read a session may call, a field of its answer, the screen
// that draws it. Must hold:
//   1. the ledger's keys are exactly the state's `needs_you` keys, at run time — a listing
//      added to the state without a home fails here;
//   2. each home's read is a registered action a session may call with `GET`, served by the
//      reads dispatcher, and its screen is a registered screen;
//   3. over a state with rows in the listings (a held ticket, a queued person leg, an open
//      condition, a runner declaring no course, a runner on an old client, a refused key
//      list), each home's field equals the state's list — narrowed to the repository for a
//      repository's home, whole for the instance's — for every registered repository, and a
//      key split over two homes is their union: nothing is in the state and in no home;
//   4. the route that served the listings as one answer is gone: `GET /v1/ui/state` is
//      `not-found` to a session, and no action names it.
// Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, listsSession } from '../../src/core/actions';
import { READS } from '../../src/core/reads';
import { SCREENS } from '../../src/core/screens';
import { hbBody, runnerCall, sha256, sessionCall, withCore } from '../helpers';
import { cutoverFixture, ofRepository, read, type CutoverFixture } from '../lib/cutoverFixture';
import type { Json } from '../lib/needsYouFixture';
import { LEDGER, type Home } from '../lib/needsYouLedger';

let f: CutoverFixture;
let needs: Record<string, Json[] | Json | null>;

const at = (answer: Json, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v == null ? undefined : (v as Json)[k]), answer);
const parsed = (text: unknown): Json => JSON.parse(String(text)) as Json;

/** The state's rows of `key` that are `repository`'s, in the shape the repository's read serves
 *  them: by the row's ticket or its `repository_id`, a stored JSON column parsed. Written from
 *  each module's own list, not from the read — the oracle is the state. */
function narrowed(key: string, repository: string): Json[] {
  const mine = ofRepository(repository);
  const list = needs[key] as Json[];
  switch (key) {
    case 'unacknowledged_releases':
      return list.map(({ payload_json, ...m }) => ({ ...m, payload: parsed(payload_json) })).filter((m) => mine(m.payload.ticket_id));
    case 'bars_mismatch':
      return list.filter((e) => mine(e.ticket_id)).map(({ detail_json, ...e }) => ({ ...e, detail: parsed(detail_json) }));
    case 'stale_skills': case 'pool_unclaimed': case 'no_owner_channel': case 'courses_refused': case 'scope': case 'unsigned_control': case 'sync_late': case 'mirror_late': case 'forge_secret_missing': case 'sync_lapses': case 'sync_control_changes':
      return list.filter((x) => x.repository_id === repository);
    default:
      return list.filter((x) => mine(x.ticket_id));
  }
}

beforeEach(async () => {
  f = await cutoverFixture();
  // A live runner on a client below the recommended one (R-BTN-197), and a key list that was
  // refused (R3-1239): the instance's listings, with a row each.
  expect((await runnerCall('/v1/runner/heartbeat', { cred: 'mac', body: hbBody('mac', { secret_hash: await sha256('s-305') }), client: 'baton/0.1.4' })).status).toBe(200);
  await withCore((c) => {
    c.store.exec(`INSERT INTO baton_settings (key, value) VALUES ('keys_notice', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify({ refused: 'line 2: not a key' })).toArray();
  });
  needs = (await read(f, '/v1/admin/state')).needs_you;
});

describe('S-BTN-305 every Needs-you listing has a home (B-203)', () => {
  it('the ledger’s keys are the state’s, and every home is a registered read and a registered screen', () => {
    expect(Object.keys(LEDGER).sort()).toEqual(Object.keys(needs).sort());
    const served = new Set(READS.map((r) => r.action));
    for (const [key, homes] of Object.entries(LEDGER)) {
      expect([key, homes.length > 0]).toEqual([key, true]);
      for (const home of homes) {
        const action = ACTIONS.find((a) => a.id === home.action);
        expect([key, home.action, action?.effect, action?.http.method, action ? listsSession(action) : false, served.has(home.action)])
          .toEqual([key, home.action, 'read', 'GET', true, true]);
        expect([key, home.screen, SCREENS.some((s) => s.id === home.screen)]).toEqual([key, home.screen, true]);
        // A tenant screen is an administrator's, and so is the read behind it.
        const screen = SCREENS.find((s) => s.id === home.screen)!;
        expect([key, home.holds === 'instance' || home.holds === 'declaring-no-course', screen.role]).toEqual(
          home.action === 'admin.tenant' ? [key, true, 'administrator'] : [key, false, 'any']);
      }
    }
  });

  it('the fixture puts a row in the listings the cases compare', () => {
    for (const key of ['held_items', 'questions', 'conditions', 'stale_skills', 'stale_clients']) expect([key, (needs[key] as Json[]).length > 0]).toEqual([key, true]);
    expect(needs.keys).toEqual({ refused: 'line 2: not a key' });
  });

  it('each repository’s home holds the state’s rows of that repository; the instance’s holds them all', async () => {
    const tenant = await read(f, '/v1/admin/tenant');
    const answers = new Map<string, Json>();
    for (const r of f.repositories) {
      answers.set(`repo.needs-you ${r}`, await read(f, `/v1/repositories/${r}/needs-you`));
      answers.set(`repo.sync ${r}`, await read(f, `/v1/repositories/${r}/sync`));
    }
    const fieldOf = (home: Home, r: string) => at(answers.get(`${home.action} ${r}`)!, home.field);
    for (const [key, homes] of Object.entries(LEDGER)) {
      for (const home of homes) {
        if (home.action === 'admin.tenant') {
          const served = at(tenant, home.field);
          if (home.holds === 'instance') expect([key, served]).toEqual([key, needs[key]]);
          else expect([key, served]).toEqual([key, (needs[key] as Json[]).filter((x) => x.repository_id == null)]);
          continue;
        }
        for (const r of f.repositories) {
          const served = fieldOf(home, r) as Json[];
          const mine = ofRepository(r);
          if (key === 'questions') {
            // The read says, beside each question, whether this caller may answer it, and
            // orders them by severity: the state's rows, each carried whole.
            const want = (needs.questions as Json[]).filter((q) => mine(q.ticket_id));
            expect([key, r, served.length]).toEqual([key, r, want.length]);
            for (const q of want) expect(served.find((s) => s.ticket_id === q.ticket_id && s.leg === q.leg)).toMatchObject(q);
          } else if (key === 'conditions') {
            // The read adds each condition's outcome, close and Resolve path to the entry.
            const want = (needs.conditions as Json[]).filter((c) => mine(c.ticket_id));
            expect([key, r, served.map((c) => c.condition_id)]).toEqual([key, r, want.map((c) => c.condition_id)]);
            want.forEach((c, i) => expect(served[i]).toMatchObject(c));
          } else {
            expect([key, r, home.field, served]).toEqual([key, r, home.field, narrowed(key, r)]);
          }
        }
      }
    }
  });

  it('nothing is in the state and in no home: each key’s rows are the union of its homes’', async () => {
    const tenant = await read(f, '/v1/admin/tenant');
    for (const [key, homes] of Object.entries(LEDGER)) {
      const list = needs[key];
      if (!Array.isArray(list)) continue; // `keys` is one notice, compared whole above
      // Counted through the first home of each kind: a row is in a repository's home, or in
      // the instance's.
      let homed = 0;
      const repositoryHome = homes.find((h) => h.action !== 'admin.tenant');
      if (repositoryHome) {
        for (const r of f.repositories) {
          const path = repositoryHome.action === 'repo.sync' ? 'sync' : 'needs-you';
          homed += (at(await read(f, `/v1/repositories/${r}/${path}`), repositoryHome.field) as Json[]).length;
        }
      }
      const tenantHome = homes.find((h) => h.action === 'admin.tenant');
      if (tenantHome) homed += (at(tenant, tenantHome.field) as Json[]).length;
      expect([key, homed]).toEqual([key, list.length]);
    }
  });

  it('the one answer that carried them all is retired: a session’s GET of it is not-found, and no action names it', async () => {
    const res = await sessionCall(f.cookie, '/v1/ui/state', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect([res.status, ((await res.json()) as Json).code]).toEqual([404, 'not-found']);
    expect(ACTIONS.filter((a) => a.http.path === '/v1/ui/state' || a.id === 'ui.state')).toEqual([]);
    const listed = ((await (await sessionCall(f.cookie, '/v1/actions', { headers: { 'Sec-Fetch-Site': 'same-origin' } })).json()) as { actions: { id: string }[] }).actions.map((a) => a.id);
    expect(listed).not.toContain('ui.state');
    expect(listed).toEqual(expect.arrayContaining(['repo.needs-you', 'repo.sync', 'admin.tenant']));
  });
});
