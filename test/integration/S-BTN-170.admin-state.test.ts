// S-BTN-170 the state in one request equals the entity reads (BATON_SPEC §15, §11.2 R-BTN-57,
// §12.1 R-BTN-179; B-118, B-216's Decision 4a): `GET /v1/admin/state` is `stateView()`, an
// administrator's key's alone, built by the functions the entity reads use. With the fake
// clock held, over a state with something in most sections (test/lib/cutoverFixture.ts), each
// section of it — filtered to a repository, for each registered repository — equals that
// repository's entity read followed over every page, and the tenant-wide sections equal the
// tenant reads. Where an entity read deliberately serves another shape or a superset, the
// equality is asserted on the fields both carry and the case says which; where no entity read
// carries a section, the case is a named `todo`, never a faked equality:
//   repositories    repo.list's row (the fields both carry), admin.repo.list's (a superset)
//                   and repo.board's `repository` (exactly)
//   ready           repo.board's `ready` (exactly); repo.tickets?state=ready
//                   is the stricter word — the rows nothing outranks — so: a subset, the rest
//                   listed under the word that outranks `ready`
//   running         repo.tickets' rows whose state or reasons say `running`, by claim
//   runners         repo.runners, row by row on the fields both carry; the union over every
//                   repository, plus the runners granted nowhere, is the whole section
//   timeline        each lane's claims on the repository — runner.show's window
//   discrepancies,
//   held            repo.sync
//   limits          owner.grant.list (owners, grants, settings, bars); admin.resource.list's
//                   probes; `couriers` has no read (todo)
//   blocked         repo.blocked over every page
//   needs_you       S-BTN-305's ledger asserts each key against its home
//   resources,
//   instance,
//   capacity        admin.instance.list and admin.resource.list, admin.settings.show, admin.tenant
// And who reads it: an administrator's signature or API key; an owner's key is `forbidden`, an
// unknown key and no principal `unauthenticated`, a session's cookie is no key, and a POST is
// `not-found`. Runs on both hosts.
import { describe, it, expect, beforeEach } from 'vitest';
import { apiKeyCall, keyCall, makeApiKey, ORIGIN, rows, sessionCall, setAdminKeys } from '../helpers';
import { cutoverFixture, everyPage, ofRepository, read, type CutoverFixture } from '../lib/cutoverFixture';
import { readSession, type Json } from '../lib/needsYouFixture';
import { DISCREPANCY_WINDOW_MS } from '../../src/core/history';
import { call as hostCall } from '#host';

let f: CutoverFixture;
let state: Json;

const pick = (row: Json, keys: string[]): Json => Object.fromEntries(keys.map((k) => [k, row[k]]));
const byTicket = (a: Json, b: Json) => (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0);
/** The state words that outrank `ready` (src/core/tickets.ts's one precedence). */
const OUTRANKS_READY = ['unconfirmed', 'running', 'waiting-person', 'held', 'blocked', 'backing-off'];

beforeEach(async () => {
  f = await cutoverFixture();
  state = await read(f, '/v1/admin/state');
});

describe('S-BTN-170 the state in one request equals the entity reads (B-216)', () => {
  it('the fixture fills the sections the cases compare', () => {
    // `baton` is the instance's own registration (wrangler.toml), with no board: the empty case.
    expect(f.repositories).toEqual(['baton', 'docs', 'ops']);
    expect(state.server_time).toBe(f.now);
    expect(Object.keys(state).sort()).toEqual(['blocked', 'capacity', 'discrepancies', 'held', 'instance', 'limits', 'needs_you', 'ready', 'repositories',
      'resources', 'runners', 'running', 'server_time', 'timeline']);
    for (const section of ['repositories', 'ready', 'running', 'runners', 'held', 'blocked']) expect([section, (state[section] as unknown[]).length > 0]).toEqual([section, true]);
    expect(state.timeline.lanes.length).toBeGreaterThan(0);
    expect(state.discrepancies.rows.length).toBe(2);
    expect(state.resources.instances.length).toBe(1);
    expect(state.limits.probes.length).toBe(1);
    for (const r of ['docs', 'ops']) expect([r, (state.running as Json[]).some((c) => ofRepository(r)(c.ticket_id))]).toEqual([r, true]);
  });

  it('repositories: repo.list’s row on the fields both carry, admin.repo.list’s as a superset, repo.board’s exactly', async () => {
    const list = (await read(f, '/v1/repositories')).repositories as Json[];
    const registry = (await read(f, '/v1/admin/repositories')).repositories as Json[];
    expect(list.map((r) => r.id)).toEqual((state.repositories as Json[]).map((r) => r.id));
    for (const row of state.repositories as Json[]) {
      const mine = list.find((r) => r.id === row.id)!;
      // repo.list serves the shell's row: the registry fields, the head without its parent and
      // count, the mode as its word, the courses by id and version — and counts of the sections.
      const shared = ['id', 'github', 'forge', 'web_base', 'default_branch', 'weight'];
      expect(pick(mine, shared)).toEqual(pick(row, shared));
      expect(mine.mode).toBe(row.mode.mode);
      expect(mine.head == null ? null : pick(mine.head, ['sha', 'received_at'])).toEqual(row.head == null ? null : pick(row.head, ['sha', 'received_at']));
      expect(mine.courses).toEqual((row.courses as Json[]).map((c) => pick(c, ['id', 'version'])));
      // repo.list counts the Tickets list's `ready` rows — the state's ready rows less those a
      // claim, a hold, a block or a back-off outranks — so the strip links to a list of its length.
      expect(mine.ready).toBe((await read(f, `/v1/repositories/${row.id}/tickets?state=ready`)).matched);
      expect(mine.ready).toBeLessThanOrEqual((state.ready as Json[]).filter((t) => t.repository_id === row.id).length);
      expect(mine.running).toBe((state.running as Json[]).filter((c) => ofRepository(row.id)(c.ticket_id)).length);
      expect(mine.discrepancies_7d).toBe((state.discrepancies.rows as Json[]).filter((d) => ofRepository(row.id)(d.ticket_id)).length);
      // admin.repo.list carries the state's row whole, with the registry's own fields beside it.
      expect(registry.find((r) => r.id === row.id)).toMatchObject(row);
      expect((await read(f, `/v1/repositories/${row.id}/board`)).repository).toEqual(row);
    }
  });

  it('ready: the board’s, exactly; the tickets list’s `ready` is the rows nothing outranks', async () => {
    for (const r of f.repositories) {
      const sync = (state.ready as Json[]).filter((t) => t.repository_id === r);
      const board = await read(f, `/v1/repositories/${r}/board`);
      expect(board.ready).toEqual(sync);
      // repo.tickets gives each ticket ONE state word by precedence: a ticket the sync posts
      // ready that is also held, blocked, claimed or a person's is listed under that word. So
      // `?state=ready` is a subset of the section, and the rest is found under a word above it.
      const all = await everyPage(f, `/v1/repositories/${r}/tickets`, 'tickets');
      const ready = await everyPage(f, `/v1/repositories/${r}/tickets?state=ready`, 'tickets');
      expect(ready.map((t) => t.ticket_id)).toEqual(all.filter((t) => t.state === 'ready').map((t) => t.ticket_id));
      for (const t of ready) {
        const s = sync.find((x) => x.id === t.ticket_id);
        expect([t.ticket_id, s !== undefined]).toEqual([t.ticket_id, true]);
        expect({ title: t.title, requires: t.requires, station: t.position.station, leg: t.position.next_leg })
          .toEqual({ title: s!.title, requires: s!.requires, station: s!.station, leg: s!.leg });
      }
      for (const s of sync.filter((x) => !ready.some((t) => t.ticket_id === x.id))) {
        const row = all.find((t) => t.ticket_id === s.id);
        expect([s.id, OUTRANKS_READY.includes(row?.state)]).toEqual([s.id, true]);
      }
    }
    // The fixture has both kinds: docs' sync-ready rows are each filed under a word that
    // outranks `ready` (running, held, blocked, a person's), ops' Q is listed `ready`.
    const docs = await everyPage(f, '/v1/repositories/docs/tickets', 'tickets');
    const words = new Set(docs.filter((t) => (state.ready as Json[]).some((s) => s.id === t.ticket_id)).map((t) => t.state as string));
    expect([words.has('ready'), words.size > 1]).toEqual([false, true]);
    expect((await everyPage(f, '/v1/repositories/ops/tickets?state=ready', 'tickets')).map((t) => t.ticket_id)).toEqual(['ops:Q']);
  });

  it('running: the tickets list’s rows that say `running`, by claim', async () => {
    for (const r of f.repositories) {
      const claims = (state.running as Json[]).filter((c) => ofRepository(r)(c.ticket_id));
      const all = await everyPage(f, `/v1/repositories/${r}/tickets`, 'tickets');
      // A claim whose completion is unconfirmed is listed `unconfirmed` with `running` a reason.
      const listed = all.filter((t) => t.state === 'running' || (t.reasons as string[]).includes('running'));
      expect(listed.map((t) => t.ticket_id).sort()).toEqual(claims.map((c) => c.ticket_id as string).sort());
      const only = await everyPage(f, `/v1/repositories/${r}/tickets?state=running`, 'tickets');
      expect(only.map((t) => t.ticket_id)).toEqual(all.filter((t) => t.state === 'running').map((t) => t.ticket_id));
      expect([r, only.length]).toEqual([r, r === 'baton' ? 0 : 1]);
      // Both cases are in the fixture: docs' claim runs its leg, ops' has not advanced yet.
      expect([r, claims.map((c) => c.leg)]).toEqual([r, r === 'baton' ? [] : [r === 'docs' ? 'implement' : null]]);
      for (const t of only) {
        const c = claims.find((x) => x.ticket_id === t.ticket_id)!;
        // The list's detail carries the claim's facts under its own names (`since`,
        // `lease_ends_at`). Its `leg` is the leg the claim runs — the section's — and, before
        // the first advance, where the section says null, the leg the claim was offered.
        const offered = (await rows<{ offered_leg: string | null }>('SELECT offered_leg FROM claims WHERE id = ?', c.id))[0].offered_leg;
        expect(t.detail).toMatchObject({ claim_id: c.id, runner_id: c.runner_id, hostname: c.hostname, session_name: c.session_name, leg: c.leg ?? offered, since: c.claimed_at,
          lease_ends_at: c.reap_at, last_activity_at: c.last_activity_at, alive: c.alive, stalled: c.stalled });
      }
    }
  });

  it('runners: each repository’s rows on the fields both carry; their union and the runners granted nowhere are the section', async () => {
    const seen = new Set<number>();
    for (const r of f.repositories) {
      const listed = (await read(f, `/v1/repositories/${r}/runners`)).runners as Json[];
      expect([r, listed.length > 0]).toEqual([r, r !== 'baton']);
      for (const w of listed) {
        seen.add(w.runner_id);
        const s = (state.runners as Json[]).find((x) => x.id === w.runner_id)!;
        expect([w.runner_id, s !== undefined]).toEqual([w.runner_id, true]);
        const shared = ['hostname', 'session_name', 'harness', 'kind', 'isolation', 'last_seen_at', 'last_activity_at', 'reaped_at', 'alive', 'transcript_url'];
        expect(pick(w, shared)).toEqual(pick(s, shared));
        expect(w.capabilities).toEqual((s.capabilities as Json[]).map((c) => pick(c, ['capability', 'declared'])));
        // The state lists every repository's courses and claims; the read, this repository's.
        expect(w.courses).toEqual((s.courses as Json[]).filter((c) => c.repository === r).map((c) => pick(c, ['course', 'version', 'min_runner_version'])));
        expect((w.claims as Json[]).map((c) => pick(c, ['claim_id', 'ticket_id', 'claimed_at'])))
          .toEqual((s.claims as Json[]).filter((c) => ofRepository(r)(c.ticket_id)).map((c) => ({ claim_id: c.id, ticket_id: c.ticket_id, claimed_at: c.claimed_at })));
      }
    }
    // Whoever is in the section and in no repository's list holds no grant and declares no course.
    const nowhere = (state.runners as Json[]).filter((s) => !seen.has(s.id));
    expect(nowhere.length).toBe(1);
    for (const s of nowhere) {
      expect(s.courses).toEqual([]);
      expect(await rows('SELECT COUNT(*) AS n FROM runner_grants g JOIN runners w ON w.credential_id = g.credential_id WHERE w.id = ? AND g.revoked_at IS NULL', s.id)).toEqual([{ n: 0 }]);
    }
    expect(seen.size + nowhere.length).toBe((state.runners as Json[]).length);
  });

  it('timeline: each lane’s claims on a repository are that runner’s window there', async () => {
    let compared = 0;
    for (const r of f.repositories) {
      const listed = new Set(((await read(f, `/v1/repositories/${r}/runners`)).runners as Json[]).map((w) => w.runner_id as number));
      for (const lane of state.timeline.lanes as Json[]) {
        const mine = (lane.claims as Json[]).filter((c) => ofRepository(r)(c.ticket_id));
        // A runner the repository does not list holds nothing there.
        if (!listed.has(lane.id)) {
          expect([r, lane.id, mine]).toEqual([r, lane.id, []]);
          continue;
        }
        const shown = await read(f, `/v1/repositories/${r}/runners/${lane.id}`);
        expect([shown.window.since, shown.window.until]).toEqual([state.timeline.from, state.timeline.to]);
        const window = shown.window.claims as Json[];
        expect(window.map((c) => pick(c, ['claim_id', 'ticket_id', 'started_at', 'ended_at'])))
          .toEqual(mine.map((c) => ({ claim_id: c.id, ticket_id: c.ticket_id, started_at: c.claimed_at, ended_at: c.ended_at })));
        window.forEach((c, i) => {
          // The window's runs and activities carry more (a run's id and log, an activity's
          // source and detail); the fields both carry are equal, in the same order.
          expect((c.runs as Json[]).map((x) => ({ ...pick(x, ['leg', 'started_at', 'ended_at', 'session_link']), session_url: null }))).toEqual(mine[i].runs);
          const fields = ['id', 'kind', 'label', 'started_at', 'ended_at', 'outcome', 'parent_id'];
          expect((c.activities as Json[]).map((a) => pick(a, fields))).toEqual((mine[i].activities as Json[]).map((a) => pick(a, fields)));
          compared += 1;
        });
      }
    }
    expect(compared).toBeGreaterThan(1);
  });

  it('discrepancies and held: repo.sync’s, the repository’s own', async () => {
    const counted: Record<string, number> = {};
    for (const r of f.repositories) {
      const sync = await read(f, `/v1/repositories/${r}/sync`);
      expect(sync.discrepancies.since).toBe(state.server_time - DISCREPANCY_WINDOW_MS);
      // The read adds each row's event id; the rest is the section's row.
      expect((sync.discrepancies.rows as Json[]).map(({ id: _id, ...row }) => row)).toEqual((state.discrepancies.rows as Json[]).filter((d) => ofRepository(r)(d.ticket_id)));
      expect(sync.discrepancies.truncated).toBe(false);
      for (const [kind, n] of Object.entries(sync.discrepancies.by_kind as Record<string, number>)) counted[kind] = (counted[kind] ?? 0) + n;
      // The read lists the accepted posts too; the section, the ones still held.
      expect((sync.held as Json[]).filter((h) => h.accepted_at == null).map(({ accepted_at: _a, ...h }) => h))
        .toEqual((state.held as Json[]).filter((h) => h.repository_id === r).map(({ repository_id: _r, ...h }) => h));
    }
    expect(counted).toEqual(state.discrepancies.by_kind);
    expect((state.held as Json[]).map((h) => h.repository_id)).toEqual(['docs']);
  });

  it('limits: owner.grant.list’s owners, grants, settings and bars; admin.resource.list’s probes', async () => {
    for (const r of f.repositories) {
      // The grants read is an owner's and a session's — an administrator's key is never an
      // owner key (R-BTN-57) — so the administrator's session reads it here.
      const answered = await readSession(f.cookie, `/v1/owner/${r}/grants`);
      expect([r, answered.status]).toEqual([r, 200]);
      const grants = answered.json;
      const of = (rows_: Json[]) => rows_.filter((x) => x.repository_id === r);
      // B-199 widened each list's rows (an owner's `kind`, a grant's `role`, a bar's `set_by`):
      // the read's row carries the section's row whole.
      const owners = of(state.limits.owners);
      expect((grants.owners as Json[]).length).toBe(owners.length);
      owners.forEach((o, i) => expect(grants.owners[i]).toMatchObject(o));
      const granted = of(state.limits.grants);
      expect((grants.grants as Json[]).length).toBe(granted.length);
      const fields = ['credential_id', 'hostname', 'label', 'repository_id', 'capabilities', 'max_claims', 'granted_by', 'granted_at'];
      granted.forEach((g, i) => expect(pick(grants.grants[i], fields)).toEqual(pick(g, fields)));
      expect(grants.settings).toEqual((state.limits.settings as Json[]).find((s) => s.repository_id === r) ?? null);
      const bars = of(state.limits.bars);
      expect((grants.bars as Json[]).length).toBe(bars.length);
      bars.forEach((b, i) => expect(grants.bars[i]).toMatchObject(b));
    }
    expect((state.limits.grants as Json[]).map((g) => g.repository_id).sort()).toEqual(['docs', 'ops']);
    // The probe keys are the tenant's: admin.resource.list names them by the same fingerprint
    // and label, with the instances parsed and who added them.
    const probes = (await read(f, '/v1/admin/resources')).probes as Json[];
    expect(probes).toEqual((state.limits.probes as Json[]).map((p) => ({ fingerprint: p.fingerprint, label: p.label, instances: JSON.parse(p.allowed_instances), added_by: p.created_by })));
  });

  it.todo('limits.couriers: no entity read carries the personal channels (R-BTN-80) — the section is the state’s alone until a read of the notices’ channels is built');

  it('blocked: repo.blocked over every page', async () => {
    const shape = (t: Json) => ({ ticket_id: t.ticket_id, since: t.since, blocks: (t.blocks as Json[]).map((b) => `${b.kind}:${b.ref}`).sort() });
    for (const r of f.repositories) {
      const tickets = await everyPage(f, `/v1/repositories/${r}/blocked`, 'tickets');
      expect(tickets.map(shape).sort(byTicket)).toEqual((state.blocked as Json[]).filter((t) => t.repository_id === r).map(shape).sort(byTicket));
    }
  });

  it('the tenant-wide sections: resources, instance and capacity are the tenant reads’', async () => {
    // admin.instance.list is the section's instance rows, each with its readings beside it.
    expect(((await read(f, '/v1/admin/instances')).instances as Json[]).map(({ readings: _r, ...i }) => i)).toEqual(state.resources.instances);
    expect(((await read(f, '/v1/admin/resources')).resources as Json[]).map((x) => pick(x, ['name', 'scope']))).toEqual(state.resources.resources);
    expect(await read(f, '/v1/admin/settings')).toEqual(state.instance);
    // The request figures and the day's usage count the requests reading them (R-BTN-87,
    // R-BTN-2): the envelope and the store's own counts are compared, the rates are not.
    const tenant = await read(f, '/v1/admin/tenant');
    expect(tenant.envelope).toEqual(state.capacity.envelope);
    const counts = (figures: Json[]) => figures.filter((x) => ['live_runners', 'repositories', 'live_tickets', 'history_rows'].includes(x.figure));
    expect(counts(tenant.figures)).toEqual(counts(state.capacity.figures));
    expect(counts(tenant.figures).length).toBe(4);
    expect(tenant.day.day).toBe(state.capacity.day.day);
  });

  it('an administrator’s API key reads it as its signature does', async () => {
    const api = await makeApiKey('admin');
    await setAdminKeys(api.line);
    const res = await apiKeyCall(api.key, '/v1/admin/state');
    expect(res.status).toBe(200);
    const { capacity: _volatile, ...viaApi } = res.json;
    const { capacity: _too, ...viaSignature } = state;
    expect(viaApi).toEqual(viaSignature);
  });

  it('an owner’s key, an unknown key, no principal, a session’s cookie and a write are refused, with their codes', async () => {
    expect((await keyCall(f.owner, '/v1/admin/state')).json).toMatchObject({ code: 'forbidden' });
    expect((await keyCall(f.k.key, '/v1/admin/state')).json).toMatchObject({ code: 'unauthenticated' });
    const bare = await hostCall(new Request(`${ORIGIN}/v1/admin/state`));
    expect((await bare.json()) as Record<string, unknown>).toMatchObject({ code: 'unauthenticated' });
    // R-BTN-57: the state is a key's. An administrator's session is no key — its cookie opens
    // the entity reads, never this.
    const session = await sessionCall(f.cookie, '/v1/admin/state', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    expect([session.status, ((await session.json()) as Json).code]).toEqual([401, 'unauthenticated']);
    expect((await keyCall(f.admin, '/v1/admin/state', {})).json).toMatchObject({ code: 'not-found' });
  });
});
