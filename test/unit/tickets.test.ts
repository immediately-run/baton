// R3-1206 — the tickets cache (BATON_SPEC §4, §7.1, §7.2 rules 4 and 6, R-BTN-33/35;
// G-BTN-39's server half) and the reference data and dashboard state built from it.
import { describe, it, expect, inject } from 'vitest';
import prices from '../fixtures/data/model-prices.json';
import providers from '../fixtures/data/model-providers.json';
import matrix from '../fixtures/data/reviewer-matrix.json';
import { ownerCall, payload, q, rows, syncCall } from '../helpers';

const board = inject('board');
// The reference data: the fixture repository's own scripts/data files (one source with S-BTN-13).
const reference = { prices, providers, matrix };
const { A, B } = board.shas;
// The hand-built cases below vary the items alone, so they post them without the fixture's
// reference data; the reference cases add the fixture repository's scripts/data files.
const stateA = { items: board.states.A.state.items as Record<string, unknown>[], ready: board.states.A.ready };
const post = (sha: string, parent: string | null, state: { items: unknown[]; ready: string[] }, extra: Record<string, unknown> = {}) =>
  syncCall('/v1/sync/board', payload(sha, parent, state, extra));
const requiresOf = async (id: string) =>
  (await rows<{ name: string }>('SELECT name FROM ticket_requires WHERE ticket_id = ? ORDER BY name', q(id))).map((r) => r.name);

describe('the tickets cache', () => {
  it('a snapshot changing one item rewrites one row', async () => {
    await post(A, null, stateA);
    const retitled = { ...stateA, items: stateA.items.map((it) => (it.id === 'R3-9002' ? { ...it, title: 'Fixture: renamed' } : it)) };
    const res = await post(B, A, retitled);
    expect(await res.json()).toMatchObject({ ok: true, upserted: 1, deleted: 0 });
    const written = await rows<{ id: string; snapshot_sha: string }>('SELECT local_id AS id, snapshot_sha FROM tickets ORDER BY id');
    expect(written.filter((r) => r.snapshot_sha === B).map((r) => r.id)).toEqual(['R3-9002']);
  });

  it('stores requires expanded, the clause kind, and operator_only (§7.2 rules 4 and 6)', async () => {
    const extra = { id: 'R3-9010', title: 'clause only', status: 'available', tags: ['FEAT'], requires: ['human-operator'], tier: 'routine', queue: 'operator', node: 'ready-operator' };
    const legacy = { id: 'R3-9011', title: 'legacy name', status: 'available', tags: [], requires: ['mcp-chrome'], tier: 'routine', queue: 'autonomous', node: 'ready-autonomous' };
    await post(A, null, { items: [...stateA.items, extra, legacy], ready: [...stateA.ready, 'R3-9010', 'R3-9011'] });
    const caps = ['authentication', 'create-pr', 'drivable-browser', 'llm-call'];
    expect(await requiresOf('R3-9002')).toEqual(caps); // agent-venue → its four capabilities
    expect(await requiresOf('R3-9001')).toEqual([]); // Requires: none
    expect(await requiresOf('R3-9011')).toEqual(['mcp-chrome']); // a legacy name stays itself
    expect(await requiresOf('R3-9003')).toEqual(['github-admin', 'human-operator'].sort()); // B-104: the literal stays, never an expansion
    expect(await requiresOf('R3-9010')).toEqual(['human-operator']); // B-104: the literal, never an expansion
    const flags = await rows<{ id: string; requires_clause: string; operator_only: number }>('SELECT local_id AS id, requires_clause, operator_only FROM tickets ORDER BY id');
    expect(flags).toEqual([
      { id: 'R3-9001', requires_clause: 'none', operator_only: 0 },
      { id: 'R3-9002', requires_clause: 'listed', operator_only: 0 },
      { id: 'R3-9003', requires_clause: 'listed', operator_only: 1 }, // the OP tag
      { id: 'R3-9004', requires_clause: 'absent', operator_only: 0 },
      { id: 'R3-9010', requires_clause: 'listed', operator_only: 1 }, // the clause alone
      { id: 'R3-9011', requires_clause: 'listed', operator_only: 0 },
    ]);
    // B-104: the literal stores as itself — a clause carrying it holds a human-operator row
    // (the two OP fixtures), where the expansion used to spread it into the four.
    expect(await rows(`SELECT 1 FROM ticket_requires WHERE name = 'human-operator'`)).toHaveLength(2);
  });

  it('deletes the row of an item no longer live (R-BTN-35)', async () => {
    await post(A, null, stateA);
    const without = { items: stateA.items.filter((it) => it.id !== 'R3-9003'), ready: stateA.ready.filter((id) => id !== 'R3-9003') };
    expect(await (await post(B, A, without)).json()).toMatchObject({ deleted: 1 });
    expect(await rows(`SELECT id FROM tickets WHERE id = 'docs:R3-9003'`)).toHaveLength(0);
    expect(await rows(`SELECT 1 FROM ticket_requires WHERE ticket_id = 'docs:R3-9003'`)).toHaveLength(0);
  });

  it('G-BTN-39 (server half): no column holds body text, even when the payload carries some', async () => {
    const leak = 'BODY-TEXT-MUST-NOT-LAND';
    const withBody = { ...stateA, items: stateA.items.map((it) => ({ ...it, body: leak, notes: leak, exitCriteria: leak, prs: [leak] })) };
    await post(A, null, withBody);
    const tables = await rows<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'`);
    for (const { name } of tables) {
      for (const row of await rows(`SELECT * FROM ${name}`)) expect(JSON.stringify(row)).not.toContain(leak);
    }
    const cols = (await rows<{ name: string }>(`SELECT name FROM pragma_table_info('tickets')`)).map((c) => c.name);
    expect(cols).toEqual(['id', 'repository_id', 'local_id', 'path', 'title', 'project', 'status', 'node', 'queue', 'tags', 'tier', 'requires_clause', 'operator_only',
      'depends_on', 'blocked_by', 'repos', 'ord', 'rank', 'snapshot_sha', 'row_hash', 'since', 'holder', 'course_id', 'tier_position', 'expedite', 'display', 'blocked_since', 'answer_lost']);
  });
});

describe('reference data and the dashboard state', () => {
  it('materializes the reviewer catalog; the advisory blocks post through the window and store nothing (B-107)', async () => {
    await post(A, null, stateA, reference);
    expect(await rows('SELECT name, family, bills, models FROM reviewer_agents ORDER BY name')).toEqual([
      { name: 'review-pr-claude', family: 'claude', bills: '["zai-coding-plan","anthropic"]', models: '{"zai-coding-plan":"zai-coding-plan/glm-5.3-flash","anthropic":"claude-opus-5-5"}' },
      { name: 'review-pr-glm', family: 'glm', bills: '["zai-coding-plan"]', models: null }]);
    // min_skills_version is gone (R-BTN-22): the registry carries each course's version.
    expect(await rows(`SELECT id, version, min_worker_version FROM courses`)).toEqual([{ id: 'roadmap-pr', version: 3, min_worker_version: 3 }]);
    // The `providers` and `prices` the reference still carries (the sync keeps posting them
    // through the window) reach no table: the advisory's are gone by migration.
    expect(await rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('model_providers', 'provider_models', 'peak_schedules', 'provider_suspensions')`)).toEqual([]);
  });

  it('the Ready view orders each tier ceiling by rank', async () => {
    await post(A, null, stateA, reference);
    const s = (await (await ownerCall('/v1/ui/state')).json()) as {
      repositories: { id: string; head: { sha: string; ticket_count: number } }[];
      ready: { id: string; title: string; url: string; rank_reason: string; requires: string[]; operator_only: boolean }[];
      ready_by_tier: Record<string, string[]>;
    };
    expect(s.repositories.find((r) => r.id === 'docs')!.head).toMatchObject({ sha: A, ticket_count: 4 });
    expect(s.ready.map((r) => r.id)).toEqual(stateA.ready.map(q));
    expect(s.ready_by_tier).toEqual({ routine: [q('R3-9001')], judgement: [q('R3-9001'), q('R3-9002')], critical: [q('R3-9001'), q('R3-9002'), q('R3-9003')] });
    expect(s.ready[0]).toMatchObject({ repository_id: 'docs', local_id: 'R3-9001', url: 'https://github.com/immediately-run/docs/blob/main/content/roadmap/R3-9001.mdx', rank_reason: 'autonomous queue · order 10' });
    expect(s.ready.find((r) => r.id === q('R3-9003'))).toMatchObject({ operator_only: true });
  });
});
