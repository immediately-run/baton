// S-BTN-203 the retired model tables (B-142, BATON_SPEC §4, §15): the pre-route-choice tables
// (`model_providers`, `peak_schedules`, `provider_suspensions` and the children keyed by their
// accounts) are gone by migration — nothing in core reads or writes them, and an unavailable
// provider is a reading (§6.3, R-BTN-76), a peak preference a rule in the course (§6.10). Must
// hold: a board sync without `providers` is accepted; a sync still posting `providers` and
// `prices` (the window) is accepted with both ignored, even malformed; each retired owner
// endpoint answers `not-found`; and the live schema holds none of the tables the migration
// dropped, so no row of them reaches the core. The heartbeat's window half — a sidecar still
// posting `model_provider_id`, `billing`, `usage` and `rate_limits` accepted with them ignored —
// is S-BTN-203's unit half in test/unit/workers.test.ts. Runs on both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { Git, ownerCall, ORIGIN, payload, register, rows, setClock, syncCall } from '../helpers';

const board = inject('board');
const T0 = Date.parse('2026-11-08T12:00:00Z');

beforeEach(async () => {
  await setClock(T0);
});

const ownerPost = (path: string, body: unknown = {}) =>
  ownerCall(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });
const retiredTables = () =>
  rows<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
    ('model_providers', 'provider_models', 'peak_schedules', 'provider_suspensions', 'worker_providers', 'usage_reports', 'rate_limit_events')
    ORDER BY name`);

describe('S-BTN-203 the retired model tables', () => {
  it('a board sync without providers is accepted; the drop migration left the live schema none of the tables', async () => {
    const git = new Git();
    git.add('B-1');
    expect((await git.post()).status).toBe(200);
    expect((await rows(`SELECT local_id FROM tickets WHERE repository_id = 'docs'`)).map((r) => r.local_id)).toEqual(['B-1']);
    // The drop migration (0036) ran at start-up: the schema the core serves holds no retired
    // table, so no code path can read a row of one.
    expect(await retiredTables()).toEqual([]);
  });

  it('a sync still posting providers and prices is accepted with both ignored, even malformed', async () => {
    // The fixture states are the real sync's buildPayload output, `providers` and `prices`
    // included, and the window refuses neither shape nor content — the fields are read nowhere.
    expect((await syncCall('/v1/sync/board', payload(board.shas.A, null, board.states.A))).status).toBe(200);
    const residue = { providers: { accounts: 'not even a list' }, prices: { models: [{ match: '(', input: 'x' }] } };
    const res = await syncCall('/v1/sync/board', payload(board.shas.B, board.shas.A, board.states.B, residue));
    expect(res.status).toBe(200);
    expect(await retiredTables()).toEqual([]);
    expect((await rows<{ sha: string }>(`SELECT sha FROM board_head WHERE repository_id = 'docs'`))).toEqual([{ sha: board.shas.B }]);
  });

  it('each retired owner endpoint answers not-found; the dashboard state serves neither view', async () => {
    await register('vm-a');
    const set = await ownerPost('/v1/ui/suspensions', { provider_id: 'zai', mode: 'no-new-work' });
    expect(set.status).toBe(404);
    expect(await set.json()).toMatchObject({ code: 'not-found' });
    const lift = await ownerPost('/v1/ui/suspensions/1/lift');
    expect(lift.status).toBe(404);
    expect(await lift.json()).toMatchObject({ code: 'not-found' });
    const s = (await (await ownerCall('/v1/ui/state')).json()) as Record<string, unknown>;
    expect(s.providers).toBeUndefined();
    expect(s.suspensions).toBeUndefined();
  });
});
