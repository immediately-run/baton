// R3-1230 — migration 0005 renames work items to tickets in place (BATON_SPEC §2a, §4, §15):
// a database at 0004 holding a claim, an override, a requires row, an event and a message keeps
// every row, and the JSON keys stored in them, under the new names, and the renamed indexes still bind.
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { MIGRATIONS } from '../../src/migrations';
import { mintRunId } from '../../src/core/db';
import type { Store } from '../../src/core/ports';
import { RECOMMENDED_CLIENT } from '../../src/core/http';
import { front } from '../../src/core/front';
import { clockBucket, stateEtag } from '../../src/core/stateVersion';
import type { Baton } from '../../src/cloudflare/baton';
import { Git, hbBody, ORIGIN, sha256, syncToken } from '../helpers';
import { makeKey, signedRequest } from '../lib/sshKeys';

import { dropDerivedSchema } from '../lib/migrationRewind';

describe('migration 0142: retire tiers (B-322)', () => {
  it('preserves provenance (S-BTN-220) and lets the same capped key claim after upgrade (S-BTN-39)', async () => {
    const stub = env.BATON.get(env.BATON.idFromName('migrations-0142'));
    const key = await makeKey('ssh-ed25519', 'capped');
    const secret = 'migration-test';
    const secretHash = await sha256(secret);
    const at = Date.parse('2026-11-24T12:00:00Z');
    const oldHead = '1'.repeat(40);
    const newHead = '2'.repeat(40);
    const author = JSON.stringify({ pusher: 'known', pusher_id: 42, commit: oldHead, at });
    const ticketsPath = '/v1/repositories/docs/tickets';
    // The 0076 row builders hashed the raw parent even when resolution discarded it.
    const oldHash = (id: string, parent: string, rank: number, tier: string, tierPosition: number) => sha256(JSON.stringify({
      id, path: `tickets/${id}.md`, version: '', key: `tickets/${id}.md`, title: id, project: null,
      status: '', node: '', queue: '', tags: '[]', tier, requires_clause: 'none', operator_only: 0,
      depends_on: '[]', blocked_by: '[]', repos: '["immediately-run/docs"]', ord: null, rank,
      course_id: 'roadmap-pr', parent, requires: [], since: null, holder: null, expedite: 0, display: null,
      brief: null, tier_position: tierPosition,
    }));
    const aHash = await oldHash('A', 'B', 4, 'critical', 2);
    const bHash = await oldHash('B', 'A', 5, 'routine', 0);
    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      for (const o of sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray()) sql.exec(`DROP TABLE "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id < 142)) sql.exec(m.sql);
    });
    const oldTag = await runInDurableObject(stub, (o: Baton, state: DurableObjectState) => {
      o.core.now = () => at;
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = ON');
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow, cutover_at, web_base, ci_identity)
        VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml', 1, 'https://github.com/immediately-run/docs', '{"kind":"github-actions"}')`);
      sql.exec('INSERT INTO board_head (repository_id, sha) VALUES (?, ?)', 'docs', oldHead);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key) VALUES (?, 'host', '["agent-venue"]', 'runner', ?)`, key.fingerprint, key.publicKey);
      sql.exec(`INSERT INTO runner_grants (credential_id, repository_id, capabilities, max_tier, granted_by, granted_at) VALUES (?, 'docs', '["agent-venue"]', 1, 'owner:k', 1)`, key.fingerprint);
      sql.exec(`INSERT INTO runners (id, hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, tier_ceilings, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
          VALUES (7, 'host', 's', ?, ?, 'opencode', 'vm', 'critical', '{"docs":"critical"}', 900000, '', ?, ?)`, secretHash, key.fingerprint, at, at);
      sql.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash, tier, tier_position, course_id, rank, key, last_written_by)
          VALUES ('docs:A', 'docs', 'A', 'tickets/A.md', 'A', '', '', '', '[]', 'none', '[]', '[]', '["immediately-run/docs"]', ?, ?, 'critical', 2, 'roadmap-pr', 4, 'tickets/A.md', ?)`, oldHead, aHash, author);
      sql.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash, tier, tier_position, course_id, rank, key, last_written_by)
          VALUES ('docs:B', 'docs', 'B', 'tickets/B.md', 'B', '', '', '', '[]', 'none', '[]', '[]', '["immediately-run/docs"]', ?, ?, 'routine', 0, 'roadmap-pr', 5, 'tickets/B.md', ?)`, oldHead, bHash, author);
      sql.exec(`
        INSERT INTO ticket_stations (ticket_id, station, path, path_len, to_end, next_leg, next_source, snapshot_sha, observation)
          VALUES ('docs:A', 'filed', '[]', 0, 1, 'implement', 'course', '', 1);
        INSERT INTO ticket_next_legs (ticket_id, leg, state, ready_since) VALUES ('docs:A', 'implement', 'ready', 1);`);
      const all = (q: string) => sql.exec(q).toArray();
      // The original gate 5 compared the position against the lower of the grant and runner
      // ceilings: judgement (1) refused critical (2), even with a critical runner ceiling.
      expect(all(`SELECT tier_position > max_tier AS refused FROM tickets JOIN runner_grants USING (repository_id) WHERE tickets.id = 'docs:A'`)).toEqual([{ refused: 1 }]);
      const ready = () => all('SELECT ticket_id, leg, rank, ready_since FROM ready_tickets INDEXED BY ready_tickets_order');
      expect(ready()).toEqual([{ ticket_id: 'docs:A', leg: 'implement', rank: 4, ready_since: 1 }]);
      // Hold the route, caller and clock bucket fixed to isolate 0142's invalidation (S-BTN-243).
      const tag = () => stateEtag(o.core.store, `key:runner:${key.fingerprint}`, `repo.tickets\n${ticketsPath}\n\nredacted`, clockBucket(at), false);
      const before = tag();
      sql.exec(MIGRATIONS.find((m) => m.id === 142)!.sql);
      expect(tag()).not.toBe(before);
      expect(ready()).toEqual([{ ticket_id: 'docs:A', leg: 'implement', rank: 4, ready_since: 1 }]);
      expect(all('SELECT credential_id, capabilities FROM runner_grants')).toEqual([{ credential_id: key.fingerprint, capabilities: '["agent-venue"]' }]);
      expect(all('SELECT id, credential_id FROM runners')).toEqual([{ id: 7, credential_id: key.fingerprint }]);
      expect(all("SELECT name FROM sqlite_master WHERE sql LIKE '%tier%' AND name NOT LIKE '_cf_%'")).toEqual([]);
      expect(all('PRAGMA foreign_key_check')).toEqual([]);
      sql.exec("UPDATE tickets SET rank = 5 WHERE id = 'docs:A'");
      expect(ready()).toEqual([{ ticket_id: 'docs:A', leg: 'implement', rank: 5, ready_since: 1 }]);
      sql.exec("UPDATE ticket_next_legs SET state = 'waiting' WHERE ticket_id = 'docs:A'");
      expect(ready()).toEqual([]);
      sql.exec("UPDATE tickets SET rank = 4 WHERE id = 'docs:A'; UPDATE ticket_next_legs SET state = 'ready' WHERE ticket_id = 'docs:A'");
      for (const m of MIGRATIONS.filter((x) => x.id > 142)) sql.exec(m.sql);
      return before;
    });

    const syncAuth = await syncToken();
    const client = { 'Baton-Client': `baton/${RECOMMENDED_CLIENT}` };
    const send = (req: Request) => front(req, env, (forwarded) => stub.fetch(forwarded));
    const sync = (path: string, body: unknown) => send(new Request(ORIGIN + path, {
      method: 'POST', headers: { ...client, Authorization: `Bearer ${syncAuth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const refreshed = await send(await signedRequest(key, ORIGIN + ticketsPath, {
      method: 'GET', created: at / 1000, headers: { ...client, 'If-None-Match': oldTag },
    }));
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get('ETag')).not.toBe(oldTag);
    const { tickets } = await refreshed.json<{ tickets: { id: string }[] }>();
    expect(tickets).toHaveLength(2);
    for (const ticket of tickets) expect(ticket).not.toHaveProperty('tier');

    // Only B edits its posted parent, breaking the cycle. A's stored parent now resolves.
    const git = new Git().add('A', { path: 'tickets/A.md', title: 'A', rank: 4, parent: 'B' })
      .add('B', { path: 'tickets/B.md', title: 'B', rank: 5 });
    const observed = await sync('/v1/sync/observation', {});
    const { observation } = await observed.json<{ observation: number }>();
    expect(observed.status).toBe(200);
    const posted = await sync('/v1/sync/board', git.body(newHead, oldHead, { observation }));
    expect(await posted.json()).toMatchObject({ ok: true, upserted: 1 });
    await runInDurableObject(stub, (_o: Baton, state: DurableObjectState) => {
      expect(state.storage.sql.exec('SELECT local_id, parent, snapshot_sha, row_hash, last_written_by FROM tickets ORDER BY local_id').toArray()).toEqual([
        { local_id: 'A', parent: 'docs:B', snapshot_sha: oldHead, row_hash: expect.stringMatching(/^v2:/), last_written_by: author },
        { local_id: 'B', parent: null, snapshot_sha: newHead, row_hash: expect.stringMatching(/^v2:/), last_written_by: JSON.stringify({ pusher: 'pusher-unknown', commit: newHead, at }) },
      ]);
    });
    const runner = async (path: string, body: unknown) => send(await signedRequest(key, ORIGIN + path, {
      created: at / 1000, body: JSON.stringify(body), headers: { ...client, 'X-Runner-Secret': secret },
    }));
    const beat = await runner('/v1/runner/heartbeat', hbBody('vm-a', { hostname: 'host', session_name: 's', secret_hash: secretHash }));
    expect(await beat.json()).toMatchObject({ runner_id: 7 });
    const claimed = await runner('/v1/runner/claim', { request_id: 'migration-test', ticket_id: 'docs:A' });
    expect(await claimed.json()).toMatchObject({ ticket_id: 'docs:A', claim_id: expect.any(Number) });
  });
});

describe('migration 0076: retire reviewer settings (B-285, S-BTN-26)', () => {
  it('drops the old reviewer data without changing other instance settings', async () => {
    const stub = env.BATON.get(env.BATON.idFromName('migrations-0076'));
    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      for (const o of sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray()) sql.exec(`DROP TABLE "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id < 76)) sql.exec(m.sql);
      sql.exec(`INSERT INTO reviewer_agents (name, reviews_on, family, bills) VALUES ('review', 'm', 'family', '[]')`);
      const settings = () => sql.exec('SELECT key, value FROM baton_settings ORDER BY key').toArray();
      const before = settings();
      sql.exec(`INSERT INTO baton_settings (key, value) VALUES ('reviewer_matrix', '{}'), ('reviewer_catalog', '{}')`);
      sql.exec(MIGRATIONS.find((m) => m.id === 76)!.sql);
      expect(sql.exec("SELECT name FROM sqlite_master WHERE name = 'reviewer_agents'").toArray()).toEqual([]);
      expect(settings()).toEqual(before);
    });
  });
});

describe('migration 0070: retire policy pins (B-160, S-BTN-190)', () => {
  it('removes retired conditions and keeps the preceding server’s pin query working on rollback', async () => {
    const stub = env.BATON.get(env.BATON.idFromName('migrations-0070'));
    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      for (const o of sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray()) sql.exec(`DROP TABLE "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id < 70)) sql.exec(m.sql);
    });
    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = ON');
      sql.exec("INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'o/docs', 'main', 'sync.yml')");
      sql.exec("INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('key', 'host', '[]', 'runner')");
      sql.exec(`INSERT INTO runners (id, hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES (7, 'host', 's', 'hash', 'key', 'opencode', 'vm', 'critical', 900000, '', 1, 2)`);
      sql.exec("INSERT INTO policy_pins (runner_id, repository_id, hash, at) VALUES (7, 'docs', 'old', 1)");
      sql.exec(`INSERT INTO policy_conditions (repository_id, type, ref, raised_at) VALUES
                ('docs', 'baton.policy-unpinned', 'runner:7', 1), ('docs', 'baton.unprotected', '', 1)`);
      sql.exec(MIGRATIONS.find((m) => m.id === 70)!.sql);

      // The preceding server's pinDiffers query runs whether or not the runner ever pinned.
      const pin = 'SELECT hash, floors_hash FROM policy_pins WHERE runner_id = ? AND repository_id = ?';
      expect(sql.exec(pin, 7, 'docs').toArray()).toEqual([{ hash: 'old', floors_hash: null }]);
      expect(sql.exec(pin, 8, 'docs').toArray()).toEqual([]);
      expect(sql.exec('SELECT type, closed_at FROM policy_conditions').toArray()).toEqual([{ type: 'baton.unprotected', closed_at: null }]);
      expect(sql.exec('PRAGMA foreign_key_check').toArray()).toEqual([]);
    });
  });
});

describe('migration 0005: work items become tickets (R3-1230)', () => {
  it('keeps every row under the new names', async () => {
    const id = env.BATON.idFromName('migrations-0005');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      // Rewind this object to an empty schema, then build it to 0004 as a deployed Baton was.
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type IN ('table','index')").toArray() as { type: string; name: string }[];
      for (const o of objects.filter((x) => x.type === 'table')) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 4)) sql.exec(m.sql);

      sql.exec(`INSERT INTO work_items (id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash)
                VALUES ('R3-9001', 'content/roadmap/R3-9001.mdx', 't', 'in-progress', 'blocked', 'autonomous', '[]', 'listed', '[]', '[]', '[]', 'aaa', 'h')`);
      sql.exec(`INSERT INTO work_item_requires (work_item_id, name) VALUES ('R3-9001', 'llm-call')`);
      sql.exec(`INSERT INTO work_item_claims (id, work_item_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status)
                VALUES (7, 'R3-9001', 1, 'req-1', 'abc123', 'aaa', 1000, 'active')`);
      sql.exec(`INSERT INTO item_overrides (work_item_id, hold, hold_reason, set_by, set_at) VALUES ('R3-9001', 1, 'owner', 'owner:x', 1000)`);
      sql.exec(`INSERT INTO events (at, kind, work_item_id, claim_id, actor) VALUES (1000, 'claimed', 'R3-9001', 7, 'worker:1')`);
      sql.exec(`INSERT INTO board_snapshots (sha, parent_sha, received_at, item_count) VALUES ('aaa', NULL, 1000, 1)`);
      sql.exec(`INSERT INTO messages (id, kind, payload_json, from_principal, to_worker_id, sent_at, status)
                VALUES (3, 'release', '{"work_item_id":"R3-9001","reason":"stale-board"}', 'owner:x', 1, 1000, 'delivered')`);
      sql.exec(`INSERT INTO events (at, kind, actor, detail_json) VALUES (1001, 'snapshot-accepted', 'sync', '{"sha":"aaa","item_count":1}')`);

      sql.exec(MIGRATIONS.find((x) => x.id === 5)!.sql);

      const one = (q: string) => sql.exec(q).toArray()[0] as Record<string, unknown>;
      expect(one("SELECT id, title FROM tickets")).toEqual({ id: 'R3-9001', title: 't' });
      expect(one("SELECT ticket_id, name FROM ticket_requires")).toEqual({ ticket_id: 'R3-9001', name: 'llm-call' });
      expect(one("SELECT id, ticket_id, status FROM claims")).toEqual({ id: 7, ticket_id: 'R3-9001', status: 'active' });
      expect(one("SELECT ticket_id, hold_reason FROM ticket_overrides")).toEqual({ ticket_id: 'R3-9001', hold_reason: 'owner' });
      expect(one("SELECT ticket_id, claim_id FROM events")).toEqual({ ticket_id: 'R3-9001', claim_id: 7 });
      expect(one("SELECT ticket_count FROM board_snapshots")).toEqual({ ticket_count: 1 });
      // JSON already stored under the old keys reads under the new ones (review gate round 1, 1-B-0).
      expect(JSON.parse(one("SELECT payload_json FROM messages WHERE id = 3").payload_json as string)).toEqual({ ticket_id: 'R3-9001', reason: 'stale-board' });
      expect(one("SELECT count(*) AS n FROM messages m JOIN claims c ON c.ticket_id = json_extract(m.payload_json, '$.ticket_id')")).toEqual({ n: 1 });
      expect(JSON.parse(one("SELECT detail_json FROM events WHERE kind = 'snapshot-accepted'").detail_json as string)).toEqual({ sha: 'aaa', ticket_count: 1 });
      const names = (sql.exec("SELECT name FROM sqlite_master WHERE type IN ('table','index')").toArray() as { name: string }[]).map((r) => r.name);
      for (const gone of ['work_items', 'work_item_claims', 'item_overrides', 'work_item_requires', 'one_active_claim_per_item', 'work_items_ready', 'events_by_item']) {
        expect(names).not.toContain(gone);
      }
      for (const added of ['one_active_claim_per_ticket', 'tickets_ready', 'events_by_ticket']) expect(names).toContain(added);
      // The renamed unique index still binds: a second active claim on the ticket is refused.
      expect(() => sql.exec(`INSERT INTO claims (id, ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status)
                              VALUES (8, 'R3-9001', 2, 'req-2', 'def456', 'aaa', 1001, 'active')`)).toThrow(/UNIQUE/);
    });
  });
});

// R3-1231 part 2a — migration 0006 makes the one board docs' (BATON_SPEC §2a R-BTN-47, §4): a
// database at 0005 holding a board, a hold, a claim, an override, an adoption request, events and
// a message keeps every row, now under repository 'docs' with qualified ticket ids.
describe('migration 0006: one Baton, many repositories (R3-1231)', () => {
  const rewind = (sql: SqlStorage, upTo: number) => {
    sql.exec('PRAGMA foreign_keys = OFF');
    dropDerivedSchema(sql);
    const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
    for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
    for (const m of MIGRATIONS.filter((x) => x.id <= upTo)) sql.exec(m.sql);
    sql.exec('PRAGMA foreign_keys = ON');
  };

  it('moves the board, the cutover and every ticket id under docs', async () => {
    const id = env.BATON.idFromName('migrations-0006');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      rewind(sql, 5);
      sql.exec(`INSERT INTO tickets (id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, rank, snapshot_sha, row_hash)
                VALUES ('R3-9001', 'content/roadmap/R3-9001.mdx', 't', 'available', 'ready-autonomous', 'autonomous', '[]', 'listed', '["R3-9000"]', '[]', '[]', 1, 'aaa', 'h')`);
      sql.exec(`INSERT INTO ticket_requires (ticket_id, name) VALUES ('R3-9001', 'llm-call')`);
      sql.exec(`INSERT INTO claims (id, ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status)
                VALUES (7, 'R3-9001', 1, 'req-1', 'abc123', 'aaa', 1000, 'active')`);
      sql.exec(`INSERT INTO ticket_overrides (ticket_id, hold, hold_reason, set_by, set_at) VALUES ('R3-9001', 1, 'owner', 'owner:x', 1000)`);
      sql.exec(`INSERT INTO adoptions (ticket_id, claim_id, worker_id, requested_at) VALUES ('R3-9001', 7, 1, 1000)`);
      sql.exec(`INSERT INTO board_head (id, sha) VALUES (1, 'aaa')`);
      sql.exec(`INSERT INTO board_snapshots (sha, parent_sha, received_at, ticket_count) VALUES ('aaa', NULL, 1000, 1)`);
      sql.exec(`INSERT INTO held_snapshots (sha, parent_sha, head_sha, ticket_count, received_at, auto_accept_at) VALUES ('bbb', 'zzz', 'aaa', 1, 1000, 2000)`);
      sql.exec(`INSERT INTO baton_settings (key, value) VALUES ('cutover_at', '900'), ('transcript_repos', '["immediately-run/claude-sessions"]'), ('min_skills_version', '3')`);
      sql.exec(`INSERT INTO events (at, kind, ticket_id, claim_id, actor) VALUES (1000, 'claimed', 'R3-9001', 7, 'worker:1')`);
      sql.exec(`INSERT INTO events (at, kind, actor, detail_json) VALUES (1001, 'cutover', 'owner:x', '{"imported":["R3-9001"]}')`);
      sql.exec(`INSERT INTO events (at, kind, actor, detail_json) VALUES (1002, 'rekeyed', 'admin', '{}')`);
      sql.exec(`INSERT INTO messages (id, kind, payload_json, from_principal, to_worker_id, sent_at, status)
                VALUES (3, 'release', '{"ticket_id":"R3-9001","reason":"stale-board"}', 'owner:x', 1, 1000, 'delivered')`);

      sql.exec(MIGRATIONS.find((x) => x.id === 6)!.sql);

      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      expect(all('SELECT id, github, default_branch, cutover_at, transcript_repos FROM repositories')).toEqual([
        { id: 'docs', github: 'immediately-run/docs', default_branch: 'main', cutover_at: 900, transcript_repos: '["immediately-run/claude-sessions"]' }]);
      expect(all(`SELECT key FROM baton_settings ORDER BY key`)).toEqual([{ key: 'min_skills_version' }]);
      expect(all('SELECT repository_id, sha FROM board_head')).toEqual([{ repository_id: 'docs', sha: 'aaa' }]);
      expect(all('SELECT repository_id, sha FROM board_snapshots')).toEqual([{ repository_id: 'docs', sha: 'aaa' }]);
      expect(all('SELECT repository_id, sha, head_sha FROM held_snapshots')).toEqual([{ repository_id: 'docs', sha: 'bbb', head_sha: 'aaa' }]);
      // Dependencies stay local: they never leave their repository (R-BTN-47).
      expect(all('SELECT id, repository_id, local_id, depends_on FROM tickets')).toEqual([{ id: 'docs:R3-9001', repository_id: 'docs', local_id: 'R3-9001', depends_on: '["R3-9000"]' }]);
      expect(all('SELECT ticket_id FROM ticket_requires')).toEqual([{ ticket_id: 'docs:R3-9001' }]);
      expect(all('SELECT ticket_id FROM claims')).toEqual([{ ticket_id: 'docs:R3-9001' }]);
      expect(all('SELECT ticket_id FROM ticket_overrides')).toEqual([{ ticket_id: 'docs:R3-9001' }]);
      expect(all('SELECT ticket_id, claim_id FROM adoptions')).toEqual([{ ticket_id: 'docs:R3-9001', claim_id: 7 }]);
      expect(all('SELECT kind, ticket_id, repository_id, detail_json FROM events ORDER BY seq')).toEqual([
        { kind: 'claimed', ticket_id: 'docs:R3-9001', repository_id: 'docs', detail_json: null },
        { kind: 'cutover', ticket_id: null, repository_id: 'docs', detail_json: '{"imported":["docs:R3-9001"]}' },
        { kind: 'rekeyed', ticket_id: null, repository_id: null, detail_json: '{}' }]);
      expect(JSON.parse(all('SELECT payload_json FROM messages')[0].payload_json as string)).toEqual({ ticket_id: 'docs:R3-9001', reason: 'stale-board' });
      // The rebuilt keys bind: one local id per repository; the requires rows follow the renamed table.
      expect(() => sql.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash)
                              VALUES ('docs:other', 'docs', 'R3-9001', 'p', 't', 'available', 'blocked', 'autonomous', '[]', 'none', '[]', '[]', '[]', 'aaa', 'h')`)).toThrow(/UNIQUE/);
      expect(all(`SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('ticket_requires')`)).toEqual([{ table: 'tickets', from: 'ticket_id', to: 'id', on_delete: 'CASCADE' }]);
      const names = (sql.exec("SELECT name FROM sqlite_master WHERE type = 'index'").toArray() as { name: string }[]).map((r) => r.name);
      for (const added of ['tickets_ready', 'events_by_repository']) expect(names).toContain(added);
    });
  });

  it('a fresh Baton gets no repository from the migration; the seed registers them', async () => {
    const id = env.BATON.idFromName('migrations-0006-fresh');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      rewind(sql, 5);
      sql.exec(MIGRATIONS.find((x) => x.id === 6)!.sql);
      expect(sql.exec('SELECT count(*) AS n FROM repositories').toArray()).toEqual([{ n: 0 }]);
    });
  });
});

// R3-1231 part 2b — migration 0007 adds the course registry (R-BTN-48): a database at 0006 keeps
// its tickets, now roadmap-pr's, and loses the instance-wide min_skills_version.
describe('migration 0007: courses (R3-1231)', () => {
  it('adds the registry tables, names every ticket roadmap-pr and drops min_skills_version', async () => {
    const id = env.BATON.idFromName('migrations-0007');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 6)) sql.exec(m.sql);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      sql.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash)
                VALUES ('docs:R3-9001', 'docs', 'R3-9001', 'p', 't', 'available', 'blocked', 'autonomous', '[]', 'none', '[]', '[]', '[]', 'aaa', 'h')`);
      sql.exec(`INSERT INTO baton_settings (key, value) VALUES ('min_skills_version', '3'), ('reviewer_matrix', '{}')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities) VALUES ('vm-a', 'vm-a', '[]')`);
      sql.exec(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at, skills_version)
                VALUES ('vm-a', 's', 'h', 'vm-a', 'opencode', 'vm', 'critical', 900000, '', 1, 1, 3)`);
      sql.exec(MIGRATIONS.find((x) => x.id === 7)!.sql);
      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      expect(all('SELECT id, course_id FROM tickets')).toEqual([{ id: 'docs:R3-9001', course_id: 'roadmap-pr' }]);
      expect(all('SELECT key FROM baton_settings')).toEqual([{ key: 'reviewer_matrix' }]);
      // The worker keeps its row; its version is per course now.
      expect(all('SELECT hostname, session_name FROM workers')).toEqual([{ hostname: 'vm-a', session_name: 's' }]);
      expect(all(`SELECT name FROM pragma_table_info('workers') WHERE name = 'skills_version'`)).toEqual([]);
      for (const t of ['courses', 'course_refusals', 'worker_courses']) expect(all(`SELECT count(*) AS n FROM ${t}`)).toEqual([{ n: 0 }]);
    });
  });
});

// R3-1231 part 3 — migration 0008 adds the observation counter (R-BTN-62): a board at 0007 starts
// at 0 with nothing outstanding, and claims made before it are judged by any reading.
describe('migration 0008: observations (R3-1231)', () => {
  it('adds the counter to each board head and the numbers to claims and holds', async () => {
    const id = env.BATON.idFromName('migrations-0008');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 7)) sql.exec(m.sql);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      sql.exec(`INSERT INTO board_head (repository_id, sha) VALUES ('docs', 'aaa')`);
      sql.exec(`INSERT INTO claims (id, ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status) VALUES (7, 'docs:R3-9001', 1, 'r', 'abc123', 'aaa', 1, 'active')`);
      sql.exec(MIGRATIONS.find((x) => x.id === 8)!.sql);
      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      expect(all('SELECT sha, observation, last_handed_out, handed_out_at FROM board_head')).toEqual([{ sha: 'aaa', observation: 0, last_handed_out: 0, handed_out_at: null }]);
      expect(all('SELECT claim_observation, end_observation FROM claims')).toEqual([{ claim_observation: 0, end_observation: null }]);
      expect(all(`SELECT name FROM pragma_table_info('held_snapshots') WHERE name = 'observation'`)).toEqual([{ name: 'observation' }]);
    });
  });

  it('gives a board head to a repository 0006 created without one (round 1, 1-A-2)', async () => {
    const id = env.BATON.idFromName('migrations-0008-headless');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 5)) sql.exec(m.sql);
      sql.exec(`INSERT INTO baton_settings (key, value) VALUES ('cutover_at', '900')`); // a cutover, no board yet
      for (const m of MIGRATIONS.filter((x) => x.id >= 6 && x.id <= 8)) sql.exec(m.sql);
      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      expect(all('SELECT id FROM repositories')).toEqual([{ id: 'docs' }]);
      expect(all('SELECT repository_id, sha, observation, last_handed_out FROM board_head')).toEqual([{ repository_id: 'docs', sha: null, observation: 0, last_handed_out: 0 }]);
    });
  });
});

// R3-1231 part 4 — migration 0009 stores each ticket's tier as its position in its repository's
// ladder (R-BTN-66), and gives workers per-repository ceilings.
describe('migration 0009: tiers per repository (R3-1231)', () => {
  it('backfills every ticket’s position: a known name its index, an unknown one the ladder’s length, none null', async () => {
    const id = env.BATON.idFromName('migrations-0009');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 8)) sql.exec(m.sql);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      const ticket = (local: string, tier: string | null) => sql.exec(`INSERT INTO tickets (id, repository_id, local_id, path, title, status, node, queue, tags, tier, requires_clause, depends_on, blocked_by, repos, snapshot_sha, row_hash)
        VALUES (?, 'docs', ?, 'p', 't', 'available', 'blocked', 'autonomous', '[]', ?, 'none', '[]', '[]', '[]', 'aaa', 'h')`, `docs:${local}`, local, tier);
      ticket('A', 'routine');
      ticket('B', 'critical');
      ticket('C', null);
      ticket('D', 'someday');
      sql.exec(MIGRATIONS.find((x) => x.id === 9)!.sql);
      expect(sql.exec('SELECT local_id, tier_position FROM tickets ORDER BY local_id').toArray()).toEqual([
        { local_id: 'A', tier_position: 0 }, { local_id: 'B', tier_position: 2 }, { local_id: 'C', tier_position: null }, { local_id: 'D', tier_position: 3 }]);
      expect(sql.exec(`SELECT dflt_value FROM pragma_table_info('workers') WHERE name = 'tier_ceilings'`).toArray()).toEqual([{ dflt_value: "'{}'" }]);
    });
  });
});

describe('migration 0010: credentials by SSH key (R3-1239, round 1, 1-B-3)', () => {
  it('keeps a deployed 0009 database’s token credentials, legacy row and workers, and adds the key columns', async () => {
    const id = env.BATON.idFromName('migrations-0010');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 9)) sql.exec(m.sql);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities) VALUES ('vm-1', 'vm-1', '["llm-call"]'), ('vm-2', 'vm-1', '[]'), ('legacy', 'legacy', '[]')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, revoked_at) VALUES ('old', 'old', '[]', 5)`);
      sql.exec(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES ('vm-1', 's', 'h', 'vm-1', 'opencode', 'vm', 'critical', 900000, '', 1, 1)`);

      sql.exec(MIGRATIONS.find((x) => x.id === 10)!.sql);

      expect(sql.exec('SELECT id, kind, public_key, created_by, revoked_at FROM credentials ORDER BY id').toArray()).toEqual([
        { id: 'legacy', kind: 'legacy', public_key: null, created_by: null, revoked_at: null },
        { id: 'old', kind: 'token', public_key: null, created_by: null, revoked_at: 5 },
        { id: 'vm-1', kind: 'token', public_key: null, created_by: null, revoked_at: null },
        { id: 'vm-2', kind: 'token', public_key: null, created_by: null, revoked_at: null },
      ]);
      expect(sql.exec('SELECT credential_id FROM workers').toArray()).toEqual([{ credential_id: 'vm-1' }]);
      // Two token credentials may share a name (they always could); two worker keys in force may not.
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key) VALUES ('SHA256:a', 'vm-1', '[]', 'worker', 'ssh-ed25519 A')`);
      expect(() => sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind, public_key) VALUES ('SHA256:b', 'vm-1', '[]', 'worker', 'ssh-ed25519 B')`)).toThrow(/UNIQUE/);
      expect(() => sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('x', 'x', '[]', 'nonsense')`)).toThrow(/CHECK/);
      expect(sql.exec('SELECT count(*) AS n FROM request_nonces').one()).toEqual({ n: 0 });
    });
  });
});

describe('migration 0013: stations and legs (R3-1232, round 1, 1-B-2)', () => {
  it('keeps a deployed 0012 database’s events (seq, kinds, indexes) and claims, giving each claim its defaults', async () => {
    const id = env.BATON.idFromName('migrations-0013');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 12)) sql.exec(m.sql);
      sql.exec('PRAGMA foreign_keys = ON'); // as the host runs it
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities) VALUES ('vm-1', 'vm-1', '[]')`);
      sql.exec(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES ('vm-1', 's', 'h', 'vm-1', 'opencode', 'vm', 'critical', 900000, '', 1, 1)`);
      sql.exec(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status) VALUES ('docs:T-1', 1, 'r-1', 'abcdef', '', 1, 'active')`);
      sql.exec(`INSERT INTO events (seq, at, kind, ticket_id, claim_id, actor, detail_json, repository_id) VALUES (7, 1, 'claimed', 'docs:T-1', 1, 'worker:1', '{}', 'docs'), (9, 2, 'cutover', NULL, NULL, 'owner:x', '{}', 'docs')`);

      sql.exec(MIGRATIONS.find((x) => x.id === 13)!.sql);

      expect(sql.exec('SELECT seq, kind, ticket_id, claim_id, repository_id FROM events ORDER BY seq').toArray()).toEqual([
        { seq: 7, kind: 'claimed', ticket_id: 'docs:T-1', claim_id: 1, repository_id: 'docs' }, { seq: 9, kind: 'cutover', ticket_id: null, claim_id: null, repository_id: 'docs' }]);
      expect(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events' ORDER BY name`).toArray().map((r) => r.name))
        .toEqual(['events_by_claim', 'events_by_repository', 'events_by_ticket']);
      // The mirror's cursor carries on: the next event follows the last seq.
      sql.exec(`INSERT INTO events (at, kind, ticket_id, actor) VALUES (3, 'advanced', 'docs:T-1', 'worker:1')`);
      expect(sql.exec('SELECT max(seq) AS s FROM events').one()).toEqual({ s: 10 });
      expect(() => sql.exec(`INSERT INTO events (at, kind, actor) VALUES (3, 'nonsense', 'x')`)).toThrow(/CHECK/);
      expect(sql.exec('SELECT station, leg, start_path, offered_leg, course_id, regressed_since, ended_regressed, end_detail, advice_json FROM claims').toArray()).toEqual([
        { station: '', leg: null, start_path: '[]', offered_leg: null, course_id: null, regressed_since: null, ended_regressed: 0, end_detail: null, advice_json: null }]);
      expect(sql.exec(`SELECT dflt_value FROM pragma_table_info('tickets') WHERE name = 'expedite'`).toArray()).toEqual([{ dflt_value: '0' }]);
    });
  });
});

describe('migration 0022: the leg needs derived beside the course file (B-86, review round 6)', () => {
  it('gives every held course an empty derived view, leaving its stored file untouched', async () => {
    const id = env.BATON.idFromName('migrations-0022');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 21)) sql.exec(m.sql);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      const file = JSON.stringify({ capability_roles: { deployer: ['vpn:corp'] }, legs: { work: { requires: { capabilities: ['deployer'] } } } });
      sql.exec(`INSERT INTO courses (repository_id, id, version, skill, course_json, step_kinds, min_worker_version) VALUES ('docs', 'roadmap-pr', 3, 's', ?, '[]', 3)`, file);

      sql.exec('PRAGMA foreign_keys = ON');
      sql.exec(MIGRATIONS.find((x) => x.id === 22)!.sql);

      // The file is still the one the repository posted, roles and all (§12.1); the view is written
      // by the next accepted post, which alone can expand a role in code.
      expect(sql.exec('SELECT course_json, leg_capabilities_json FROM courses').toArray()).toEqual([{ course_json: file, leg_capabilities_json: '{}' }]);
      expect(sql.exec(`SELECT dflt_value FROM pragma_table_info('courses') WHERE name = 'leg_capabilities_json'`).toArray()).toEqual([{ dflt_value: "'{}'" }]);
    });
  });
});

describe('migration 0021: leg queues (R3-1255)', () => {
  it('counts the tickets already queued and unheld, leaving the bound to the next course file; keeps the events and admits the new kinds', async () => {
    const id = env.BATON.idFromName('migrations-0021');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 20)) sql.exec(m.sql);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      const file = JSON.stringify({ legs: { fix: { max_queue: 1 }, review: {} } });
      sql.exec(`INSERT INTO courses (repository_id, id, version, skill, course_json, step_kinds, min_worker_version) VALUES ('docs', 'roadmap-pr', 3, 's', ?, '[]', 3)`, file);
      for (const [t, leg] of [['docs:A', 'fix'], ['docs:B', 'fix'], ['docs:C', 'review'], ['docs:D', null], ['docs:E', 'fix']] as const) {
        // Every other required column of the ticket filled with an empty value of its type.
        const rest = (sql.exec(`SELECT name, type FROM pragma_table_info('tickets') WHERE "notnull" = 1 AND dflt_value IS NULL AND name NOT IN ('id', 'repository_id', 'local_id')`)
          .toArray() as { name: string; type: string }[]);
        sql.exec(`INSERT INTO tickets (id, repository_id, local_id, course_id${rest.map((c) => `, ${c.name}`).join('')}) VALUES (?, 'docs', ?, 'roadmap-pr'${rest.map((c) => (c.name === 'requires_clause' ? ", 'absent'" : /INT|REAL/.test(c.type) ? ', 0' : ", ''")).join('')})`, t, t.slice(5));
        sql.exec(`INSERT INTO ticket_stations (ticket_id, station, path, path_len, to_end, next_leg, next_source, snapshot_sha, observation) VALUES (?, 's', '[]', 0, 1, ?, 'course', '', 1)`, t, leg);
      }
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities) VALUES ('vm-1', 'vm-1', '[]')`);
      sql.exec(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES ('vm-1', 's', 'h', 'vm-1', 'opencode', 'vm', 'critical', 900000, '', 1, 1)`);
      // E is held: its claim is active.
      sql.exec(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status) VALUES ('docs:E', 1, 'r-1', 'abcdef', '', 1, 'active')`);
      sql.exec(`INSERT INTO events (seq, at, kind, ticket_id, actor, detail_json, repository_id) VALUES (4, 1, 'discrepancy', 'docs:A', 'sync', '{}', 'docs')`);

      sql.exec('PRAGMA foreign_keys = ON');
      sql.exec(MIGRATIONS.find((x) => x.id === 21)!.sql);

      // fix is over its course file's bound of 1, but seeded unjudged: the next accepted course file
      // judges it on Baton's clock, with its event and notices (round 1, 1-B-1; queues.test.ts).
      expect(sql.exec('SELECT leg, depth, max_queue FROM leg_queues ORDER BY leg').toArray()).toEqual([{ leg: 'fix', depth: 2, max_queue: null }, { leg: 'review', depth: 1, max_queue: null }]);
      expect(sql.exec('SELECT ticket_id FROM leg_queue_members ORDER BY ticket_id').toArray().map((r) => r.ticket_id)).toEqual(['docs:A', 'docs:B', 'docs:C']);
      expect(sql.exec('SELECT seq, kind FROM events').toArray()).toEqual([{ seq: 4, kind: 'discrepancy' }]);
      for (const kind of ['queue-over', 'course-closed', 'course-opened']) sql.exec(`INSERT INTO events (at, kind, actor) VALUES (2, ?, 'baton')`, kind);
      expect(() => sql.exec(`INSERT INTO events (at, kind, actor) VALUES (3, 'nonsense', 'x')`)).toThrow(/CHECK/);
      expect(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events' ORDER BY name`).toArray().map((r) => r.name))
        .toEqual(['events_by_claim', 'events_by_repository', 'events_by_ticket', 'events_discrepancies']);
    });
  });
});

describe('migration 0029: the repository policy tables (B-145)', () => {
  it('creates the append-only policy log with its floors, and the columns the trust and human marks land in', async () => {
    const id = env.BATON.idFromName('migrations-0029');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type IN ('table','index')").toArray() as { type: string; name: string }[];
      for (const o of objects.filter((x) => x.type === 'table')) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 27)) sql.exec(m.sql);
      sql.exec(MIGRATIONS.find((x) => x.id === 29)!.sql);
      sql.exec('PRAGMA foreign_keys = ON');

      // A policy version row, a floor, a human key, a checker's report and a pin.
      sql.exec(`INSERT INTO repositories (id, github, forge, remote, default_branch, sync_workflow, weight, transcript_repos, tiers, cutover_at)
                VALUES ('ops', 'o/ops', 'github', 'ssh://git@h/o/ops', 'main', '', 100, '[]', '["routine"]', 1)`);
      sql.exec(`INSERT INTO repository_policies (repository_id, version, policy_json, hash, previous_hash, changed_by, approver, preset, at)
                VALUES ('ops', 1, '{}', '${'a'.repeat(64)}', NULL, 'server', NULL, 'cooperative', 1)`);
      sql.exec(`INSERT INTO policy_floors (repository_id, name, guarantees, remove_by, added_by, added_at)
                VALUES ('ops', 'fieldhouse', '["no-runner-lands"]', 'human', 'owner:x', 1)`);
      // Append-only: no UPDATE, no DELETE (R-BTN-188).
      expect(() => sql.exec(`UPDATE repository_policies SET policy_json = '{}' WHERE repository_id = 'ops'`)).toThrow(/append-only/);
      expect(() => sql.exec(`DELETE FROM repository_policies WHERE repository_id = 'ops'`)).toThrow(/append-only/);
      // A second version chains on the first; a second floor with the name is refused by the key.
      sql.exec(`INSERT INTO repository_policies (repository_id, version, policy_json, hash, previous_hash, changed_by, approver, preset, at)
                VALUES ('ops', 2, '{}', '${'b'.repeat(64)}', '${'a'.repeat(64)}', 'owner:x', 'owner', NULL, 2)`);
      expect(() => sql.exec(`INSERT INTO policy_floors (repository_id, name, guarantees, remove_by, added_by, added_at)
                VALUES ('ops', 'fieldhouse', '[]', 'human', 'owner:x', 3)`)).toThrow(/UNIQUE/);
      expect(() => sql.exec(`INSERT INTO repository_policies (repository_id, version, policy_json, hash, previous_hash, changed_by, approver, preset, at)
                VALUES ('ops', 2, '{}', '${'b'.repeat(64)}', '${'a'.repeat(64)}', 'owner:x', 'owner', NULL, 2)`)).toThrow(/UNIQUE/);
      // The columns the rest of §12.8 lands in: owners' human marks, grants' and couriers' trust
      // attributes, a reading's writer, nonce and signature.
      const cols = (table: string) => sql.exec(`SELECT name FROM pragma_table_info('${table}')`).toArray().map((r) => (r as { name: string }).name);
      expect(cols('repository_owners')).toEqual(expect.arrayContaining(['human_only', 'fido_attestation']));
      expect(cols('worker_grants')).toEqual(expect.arrayContaining(['trust_level', 'trust_domain', 'model_family', 'role', 'trust_set_by']));
      expect(cols('couriers')).toEqual(expect.arrayContaining(['trust_level', 'trust_domain', 'trust_set_by']));
      expect(cols('instance_readings')).toEqual(expect.arrayContaining(['writer', 'nonce', 'signature']));
      // The checker's report carries its baseline (the last matching reading) and a pin the
      // floors' hash (R-BTN-180, R-BTN-189).
      expect(cols('protection_reports')).toEqual(expect.arrayContaining(['matched_hash']));
      expect(cols('policy_pins')).toEqual(expect.arrayContaining(['floors_hash']));
      for (const table of ['policy_conditions', 'protection_reports', 'policy_pins', 'human_keys']) {
        expect(sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).toArray()).toHaveLength(1);
      }
    });
  });
});

// B-142 — migration 0036 retires the pre-route-choice model tables: a database at 0035 holding
// rows in every one — providers, models, schedules, suspensions, a worker's billing rows and
// its usage — keeps its workers (less model_provider_id) and loses the tables whole, children
// before parents, so nothing references what is gone and no code path reads a row.
describe('migration 0036: the model tables retire (B-142)', () => {
  it('drops every retired table and the workers row’s model_provider_id, keeping the rest', async () => {
    const id = env.BATON.idFromName('migrations-0036');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 35)) sql.exec(m.sql);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities) VALUES ('vm-1', 'vm-1', '[]')`);
      sql.exec(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, model_id, model_provider_id, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES ('vm-1', 's', 'h', 'vm-1', 'opencode', 'vm', 'zai-coding-plan/glm-5.3', 'zai', 'critical', 900000, '', 1, 1)`);
      sql.exec(`INSERT INTO model_providers (id, name, billing) VALUES ('zai', 'Z.AI', 'subscription')`);
      sql.exec(`INSERT INTO peak_schedules (id, rules_json, factor) VALUES ('zai', '{"days":[1],"hoursUtc":[[1,4]]}', 0.5)`);
      sql.exec(`INSERT INTO provider_models (provider_id, model_id, monthly_limit_usd, peak_schedule_id) VALUES ('zai', 'glm-5.3', 10, 'zai')`);
      sql.exec(`INSERT INTO worker_providers (worker_id, prefix, provider_id) VALUES (1, 'zai-coding-plan', 'zai')`);
      sql.exec(`INSERT INTO provider_suspensions (provider_id, mode, starts_at, set_by) VALUES ('zai', 'no-new-work', 1, 'owner:x')`);
      sql.exec(`INSERT INTO usage_reports (worker_id, provider_id, model_id, hour, usd_list) VALUES (1, 'zai', 'glm-5.3', 0, 1.5)`);
      sql.exec(`INSERT INTO rate_limit_events (provider_id, worker_id, at) VALUES ('zai', 1, 1)`);

      sql.exec('PRAGMA foreign_keys = ON'); // as the host runs it
      sql.exec(MIGRATIONS.find((x) => x.id === 36)!.sql);

      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      for (const gone of ['model_providers', 'provider_models', 'peak_schedules', 'provider_suspensions', 'worker_providers', 'usage_reports', 'rate_limit_events']) {
        expect(all(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${gone}'`)).toEqual([{ n: 0 }]);
      }
      // The worker keeps its row, minus the retired column; and a new worker registers against
      // the migrated schema.
      expect(all('SELECT hostname, session_name, model_id FROM workers')).toEqual([{ hostname: 'vm-1', session_name: 's', model_id: 'zai-coding-plan/glm-5.3' }]);
      expect(all(`SELECT name FROM pragma_table_info('workers') WHERE name = 'model_provider_id'`)).toEqual([]);
      sql.exec(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES ('vm-2', 's', 'h', 'vm-1', 'opencode', 'vm', 'critical', 900000, '', 1, 1)`);
      expect(all('SELECT count(*) AS n FROM workers')).toEqual([{ n: 2 }]);
    });
  });
});

describe('migration 0038: run ids (B-185, S-BTN-204)', () => {
  it('rebuilds claim_legs keeping every row, and the backfill gives each a distinct run id minted from its started_at', async () => {
    const id = env.BATON.idFromName('migrations-0038');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 37)) sql.exec(m.sql);
      sql.exec(`INSERT INTO claims (id, ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status) VALUES (1, 'docs:A', 1, 'r1', 'abcdef', 'sha', 1, 'active')`);
      const T = Date.parse('2026-11-01T00:00:00Z');
      sql.exec(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, to_station, bars, started_at, started_observation, finished_at, evidence, route_choices_json, taken_json)
                VALUES (1, 1, 'implement', 'filed', 'pr-open', '["x"]', ?, 3, ?, 'https://pr/1', '[{"choice":"c"}]', '[]')`, T, T + 1);
      sql.exec(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, started_at, started_observation, abandoned_at)
                VALUES (1, 2, 'review', 'pr-open', ?, 4, ?)`, T + 2, T + 3);

      sql.exec('PRAGMA foreign_keys = ON'); // as the host runs it
      const m38 = MIGRATIONS.find((x) => x.id === 38)!;
      sql.exec(m38.sql);
      let draw = 0;
      m38.backfill!({ exec: (q: string, ...p: unknown[]) => sql.exec(q, ...p) } as unknown as Store, (n) => new Uint8Array(n).fill(++draw), () => T);

      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      expect(all(`SELECT id, claim_id, seq, leg, from_station, to_station, bars, started_at, started_observation, finished_at, abandoned_at, evidence, route_choices_json, taken_json
                  FROM claim_legs ORDER BY seq`)).toEqual([
        { id: 1, claim_id: 1, seq: 1, leg: 'implement', from_station: 'filed', to_station: 'pr-open', bars: '["x"]', started_at: T, started_observation: 3, finished_at: T + 1, abandoned_at: null, evidence: 'https://pr/1', route_choices_json: '[{"choice":"c"}]', taken_json: '[]' },
        { id: 2, claim_id: 1, seq: 2, leg: 'review', from_station: 'pr-open', to_station: null, bars: '[]', started_at: T + 2, started_observation: 4, finished_at: null, abandoned_at: T + 3, evidence: null, route_choices_json: null, taken_json: null },
      ]);
      const ids = all('SELECT run_id, started_at FROM claim_legs ORDER BY seq') as { run_id: string; started_at: number }[];
      expect(ids.map((r) => r.run_id)).toEqual([mintRunId(T, () => new Uint8Array(10).fill(1)), mintRunId(T + 2, () => new Uint8Array(10).fill(2))]);
      expect(new Set(ids.map((r) => r.run_id)).size).toBe(2);
      // The run id is unique, (claim_id, seq) still is, and the history has the column.
      expect(() => sql.exec(`UPDATE claim_legs SET run_id = ? WHERE seq = 2`, ids[0].run_id)).toThrow(/UNIQUE/);
      expect(() => sql.exec(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, started_at, started_observation) VALUES (1, 2, 'fix', 'x', 1, 1)`)).toThrow(/UNIQUE/);
      expect(all(`SELECT name FROM pragma_table_info('claim_legs') WHERE name IN ('head_sha', 'session_url', 'leg_log_dir') ORDER BY name`)).toEqual([{ name: 'head_sha' }, { name: 'leg_log_dir' }, { name: 'session_url' }]);
      expect(all(`SELECT name FROM pragma_table_info('ticket_history') WHERE name = 'run_id'`)).toEqual([{ name: 'run_id' }]);
    });
  });
});

// B-167 — migration 0042 retires the capability ontology and the route choices: a database at
// 0041 holding a program, derived sets, refusals, hysteresis rows, a course's and a run's route
// choices and a `taken-invalid` event keeps every other row and loses the tables and columns the
// retired reads used, so nothing references what is gone and no code path reads a row.
describe('migration 0042: the ontology and route choices retire (B-167)', () => {
  it('drops the retired tables and columns, keeping the rows beside them and the event log minus taken-invalid', async () => {
    const id = env.BATON.idFromName('migrations-0042');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type = 'table'").toArray() as { name: string }[];
      for (const o of objects) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 41)) sql.exec(m.sql);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities) VALUES ('vm-1', 'vm-1', '[]')`);
      sql.exec(`INSERT INTO workers (hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES ('vm-1', 's', 'h', 'vm-1', 'opencode', 'vm', 'critical', 900000, '', 1, 1)`);
      sql.exec(`INSERT INTO courses (repository_id, id, version, skill, course_json, step_kinds, min_worker_version, report_horizon_h, route_choices_json)
                VALUES ('docs', 'roadmap-pr', 3, 'next', '{}', '[]', 3, 6, '{"implement":["codegen"]}')`);
      sql.exec(`INSERT INTO external_resources (name, scope, detail_schema, atoms_from, base_chain_json) VALUES ('anthropic-capacity', 'account', '{}', 'any', '["std:api-capacity@1"]')`);
      sql.exec(`INSERT INTO claims (id, ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status) VALUES (1, 'docs:A', 1, 'r1', 'abcdef', 'sha', 1, 'active')`);
      sql.exec(`INSERT INTO claim_legs (claim_id, seq, run_id, leg, from_station, started_at, started_observation, route_choices_json, taken_json)
                VALUES (1, 1, 'r_01', 'implement', 'filed', 1, 1, '[{"choice":"codegen"}]', '[{"choice":"codegen"}]')`);
      sql.exec(`INSERT INTO ontologies (repository_id, digest, fixed_json, program_json, snapshot_sha, accepted_at) VALUES ('docs', 'd', '[]', '{}', 'sha', 1)`);
      sql.exec(`INSERT INTO worker_derived (worker_id, repository_id, capability, evaluated_at) VALUES (1, 'docs', 'model:x', 1)`);
      sql.exec(`INSERT INTO worker_derived_inputs (worker_id, repository_id, input_digest, limited, evaluated_at) VALUES (1, 'docs', 'i', 0, 1)`);
      sql.exec(`INSERT INTO ontology_refusals (repository_id, reason, detail, at) VALUES ('docs', 'program', 'x', 1)`);
      sql.exec(`INSERT INTO route_last (worker_id, repository_id, choice, alternative, demoted, resolved_at) VALUES (1, 'docs', 'codegen', 'a', 0, 1)`);
      sql.exec(`INSERT INTO events (at, kind, actor, ticket_id) VALUES (1, 'advanced', 'worker:1', 'docs:A')`);
      sql.exec(`INSERT INTO events (at, kind, actor, ticket_id) VALUES (2, 'taken-invalid', 'worker:1', 'docs:A')`);
      sql.exec(`INSERT INTO events (at, kind, actor, repository_id) VALUES (3, 'unsigned-control', 'sync', 'docs')`);

      sql.exec('PRAGMA foreign_keys = ON'); // as the host runs it
      sql.exec(MIGRATIONS.find((x) => x.id === 42)!.sql);

      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      for (const gone of ['ontologies', 'worker_derived', 'worker_derived_inputs', 'ontology_refusals', 'route_last']) {
        expect(all(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${gone}'`)).toEqual([{ n: 0 }]);
      }
      const cols = (table: string) => all(`SELECT name FROM pragma_table_info('${table}')`).map((r) => r.name);
      expect(cols('courses')).not.toContain('route_choices_json');
      expect(cols('courses')).not.toContain('report_horizon_h');
      expect(cols('claim_legs')).not.toContain('route_choices_json');
      expect(cols('claim_legs')).not.toContain('taken_json');
      expect(cols('external_resources').sort()).toEqual(['detail_schema', 'name', 'scope']);
      // What is beside the retired reads is kept whole.
      expect(all(`SELECT id, version FROM courses`)).toEqual([{ id: 'roadmap-pr', version: 3 }]);
      expect(all(`SELECT name FROM external_resources`)).toEqual([{ name: 'anthropic-capacity' }]);
      expect(all(`SELECT seq, leg, run_id FROM claim_legs`)).toEqual([{ seq: 1, leg: 'implement', run_id: 'r_01' }]);
      // The event log keeps every kind but the taken's.
      expect(all(`SELECT kind FROM events ORDER BY seq`)).toEqual([{ kind: 'advanced' }, { kind: 'unsigned-control' }]);
      // The narrowed check refuses a new `taken-invalid`, and takes the kinds the restructure kept.
      expect(() => sql.exec(`INSERT INTO events (at, kind, actor) VALUES (5, 'taken-invalid', 'worker:1')`)).toThrow(/CHECK/);
      sql.exec(`INSERT INTO events (at, kind, actor) VALUES (4, 'advice-overridden', 'worker:1')`);
      sql.exec(`INSERT INTO events (at, kind, actor) VALUES (6, 'unsigned-control', 'sync')`);
      sql.exec(`INSERT INTO courses (repository_id, id, version, skill, course_json, step_kinds, min_worker_version) VALUES ('docs', 'runbook', 1, 'run', '{}', '[]', 1)`);
      sql.exec(`INSERT INTO external_resources (name, scope, detail_schema) VALUES ('bench', 'service', '{}')`);
    });
  });
});

// B-173 — migration 0050 adds the retired row's `former_paths` and backfills the tombstone over
// rows retired before it: a retire that set `retired_at` alone left the forge path in `github`,
// which would hold the path against `Registry.register`'s duplicate check (it matches over every
// row) and never reach the former-path fence. Such a row comes to the tombstone the retiring
// transaction writes — path to `former_paths`, `~retired/<id>` in its place, the same columns
// cleared — and a live row, and one retired by the new code, are untouched.
describe('migration 0050: the retirement tombstone (B-173)', () => {
  it('backfills rows retired before the deploy to the tombstone, leaving live rows alone', async () => {
    const id = env.BATON.idFromName('migrations-0050');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type IN ('table','index')").toArray() as { type: string; name: string }[];
      for (const o of objects.filter((x) => x.type === 'table')) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 49)) sql.exec(m.sql);
      // A live repository, and one retired the old way — `retired_at` alone, its path still in
      // `github` and the columns the tombstone clears still set.
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow, web_base) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml', 'https://github.com/immediately-run/docs')`);
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow, web_base, dispatch, unblocked_trigger, sync_wanted_at, sync_wanted_after, retired_at)
                VALUES ('ops', 'immediately-run/ops', 'main', '.github/workflows/baton-sync.yml', 'https://github.com/immediately-run/ops', '{"kind":"github-app"}', '{"kind":"github-app"}', 111, 222, 1000)`);

      sql.exec('PRAGMA foreign_keys = ON'); // as the host runs it
      sql.exec(MIGRATIONS.find((x) => x.id === 50)!.sql);

      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      // The retired row: the tombstone, its path moved, the columns the retiring transaction
      // clears NULL, `retired_at` kept.
      expect(all(`SELECT github, former_paths, web_base, dispatch, unblocked_trigger, sync_wanted_at, sync_wanted_after, retired_at FROM repositories WHERE id = 'ops'`))
        .toEqual([{ github: '~retired/ops', former_paths: '["immediately-run/ops"]', web_base: null, dispatch: null, unblocked_trigger: null, sync_wanted_at: null, sync_wanted_after: null, retired_at: 1000 }]);
      // The live row is untouched, `former_paths` NULL among its columns.
      expect(all(`SELECT github, former_paths, web_base FROM repositories WHERE id = 'docs'`))
        .toEqual([{ github: 'immediately-run/docs', former_paths: null, web_base: 'https://github.com/immediately-run/docs' }]);
      // The path is free among live rows: a new repository may take it. The tombstone cannot
      // collide with a live path — a `~` is outside every forge-path grammar — and two rows
      // never share one.
      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('ops2', 'immediately-run/ops', 'main', '.github/workflows/baton-sync.yml')`);
      expect(() => sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow) VALUES ('ops3', '~retired/ops', 'main', '.github/workflows/baton-sync.yml')`)).toThrow(/UNIQUE/);
    });
  });
});

// B-68 — migration 0061 changes only the live schema's vocabulary. Historical migrations keep
// their original SQL; a database at 0059 keeps every row while its runner-facing names move.
describe('migration 0061: workers become runners (B-68, S-BTN-236)', () => {
  it('renames the schema and credential kind in place without losing rows', async () => {
    const id = env.BATON.idFromName('migrations-0061');
    await runInDurableObject(env.BATON.get(id), (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      const objects = sql.exec("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND type IN ('table','index')").toArray() as { type: string; name: string }[];
      for (const o of objects.filter((x) => x.type === 'table')) sql.exec(`DROP TABLE IF EXISTS "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id <= 59)) sql.exec(m.sql);

      sql.exec(`INSERT INTO repositories (id, github, default_branch, sync_workflow, worker_pushers) VALUES ('docs', 'immediately-run/docs', 'main', '.github/workflows/baton-sync.yml', '["bot"]')`);
      sql.exec(`INSERT INTO credentials (id, hostname, allowed_capabilities, kind) VALUES ('vm-a', 'vm-a', '["agent-venue"]', 'worker')`);
      sql.exec(`INSERT INTO workers (id, hostname, session_name, secret_hash, credential_id, harness, kind, tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES (7, 'vm-a', 's', 'hash', 'vm-a', 'opencode', 'vm', 'critical', 900000, '', 1, 2)`);
      sql.exec(`INSERT INTO worker_grants (credential_id, repository_id, capabilities, granted_by, granted_at) VALUES ('vm-a', 'docs', '["agent-venue"]', 'owner:x', 1)`);
      sql.exec(`INSERT INTO worker_capabilities (worker_id, capability, declared) VALUES (7, 'agent-venue', 'agent-venue')`);
      sql.exec(`INSERT INTO worker_tags (worker_id, tag) VALUES (7, 'family:test')`);
      sql.exec(`INSERT INTO worker_courses (worker_id, repository_id, course_id, version) VALUES (7, 'docs', 'roadmap-pr', 3)`);
      sql.exec(`INSERT INTO courses (repository_id, id, version, skill, course_json, step_kinds, min_worker_version) VALUES ('docs', 'roadmap-pr', 3, 'run', '{}', '[]', 2)`);
      sql.exec(`INSERT INTO claims (id, ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status) VALUES (9, 'docs:T-1', 7, 'r', 'abc123', 'sha', 3, 'active')`);
      sql.exec(`INSERT INTO messages (kind, from_worker_id, to_worker_id, sent_at, status) VALUES ('status_report', 7, 7, 4, 'pending')`);
      sql.exec(`INSERT INTO events (at, kind, actor) VALUES (5, 'claimed', 'worker:7')`);

      sql.exec('PRAGMA foreign_keys = ON');
      sql.exec(MIGRATIONS.find((x) => x.id === 61)!.sql);

      const all = (q: string) => sql.exec(q).toArray() as Record<string, unknown>[];
      expect(all(`SELECT id, legacy_names_at FROM runners`)).toEqual([{ id: 7, legacy_names_at: null }]);
      expect(all(`SELECT runner_id, capability FROM runner_capabilities`)).toEqual([{ runner_id: 7, capability: 'agent-venue' }]);
      expect(all(`SELECT runner_id, ticket_id FROM claims`)).toEqual([{ runner_id: 7, ticket_id: 'docs:T-1' }]);
      expect(all(`SELECT from_runner_id, to_runner_id FROM messages`)).toEqual([{ from_runner_id: 7, to_runner_id: 7 }]);
      expect(all(`SELECT min_runner_version FROM courses`)).toEqual([{ min_runner_version: 2 }]);
      expect(all(`SELECT runner_pushers FROM repositories`)).toEqual([{ runner_pushers: '["bot"]' }]);
      expect(all(`SELECT kind FROM credentials WHERE id = 'vm-a'`)).toEqual([{ kind: 'runner' }]);
      expect(all(`SELECT actor FROM events`)).toEqual([{ actor: 'runner:7' }]);
      expect(all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'worker%'`)).toEqual([]);
      expect(all('PRAGMA foreign_key_check')).toEqual([]);
    });
  });
});

// B-287 / S-BTN-243: migrate populated state, then mutate and rebuild derived sets.
describe('migration 0065: normalized matching inputs and ready candidates', () => {
  it('backfills deployed rows and keeps capability sets and candidates consistent through cascades', async () => {
    const stub = env.BATON.get(env.BATON.idFromName('migrations-0065'));
    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = OFF');
      dropDerivedSchema(sql);
      for (const o of sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").toArray()) sql.exec(`DROP TABLE "${o.name}"`);
      for (const m of MIGRATIONS.filter((x) => x.id < 65)) sql.exec(m.sql);
    });
    // The rewind's implicit transaction must commit before foreign_keys can be re-enabled.
    await runInDurableObject(stub, (_o: unknown, state: DurableObjectState) => {
      const sql = state.storage.sql;
      sql.exec('PRAGMA foreign_keys = ON');
      expect(sql.exec('PRAGMA foreign_keys').toArray()).toEqual([{ foreign_keys: 1 }]);
      sql.exec("INSERT INTO repositories(id, github, default_branch, sync_workflow) VALUES ('docs','o/docs','main','sync.yml')");
      sql.exec(`INSERT INTO courses(repository_id,id,version,skill,course_json,step_kinds,min_runner_version,leg_capabilities_json,person_legs_json)
        VALUES ('docs','roadmap-pr',1,'run','{}','[]',1,'{"implement":["capability:code"],"approve":[]}','["approve"]')`);
      sql.exec("INSERT INTO credentials(id,hostname,allowed_capabilities,kind) VALUES ('key','host','[]','runner')");
      sql.exec(`INSERT INTO runner_grants(credential_id,repository_id,capabilities,granted_by,granted_at) VALUES ('key','docs','["capability:*"]','owner',0)`);
      sql.exec(`INSERT INTO tickets(id,repository_id,local_id,path,title,status,node,queue,tags,requires_clause,depends_on,blocked_by,repos,snapshot_sha,row_hash)
        VALUES ('docs:A','docs','A','A.mdx','A','available','ready-autonomous','autonomous','[]','none','[]','[]','["O/Docs"]','sha','hash')`);
      sql.exec(`INSERT INTO ticket_stations(ticket_id,station,path,path_len,to_end,next_leg,next_source,snapshot_sha,observation)
        VALUES ('docs:A','filed','[]',0,3,'implement','course','sha',1)`);
      sql.exec("INSERT INTO ticket_next_legs(ticket_id,leg,state,ready_since) VALUES ('docs:A','implement','ready',10)");
      sql.exec(MIGRATIONS.find((m) => m.id === 65)!.sql);
      const all = (q: string) => sql.exec(q).toArray();
      expect(all('SELECT leg,person FROM course_legs ORDER BY leg')).toEqual([{ leg: 'approve', person: 1 }, { leg: 'implement', person: 0 }]);
      expect(all('SELECT capability FROM course_leg_capabilities')).toEqual([{ capability: 'capability:code' }]);
      expect(all('SELECT capability_pattern FROM grant_capabilities')).toEqual([{ capability_pattern: 'capability:*' }]);
      expect(all('SELECT repository_key FROM ticket_repositories')).toEqual([{ repository_key: 'o/docs' }]);
      expect(all('SELECT ticket_id,ready_since FROM ready_tickets')).toEqual([{ ticket_id: 'docs:A', ready_since: 10 }]);
      sql.exec(`UPDATE courses SET leg_capabilities_json='{"implement":["new"]}', person_legs_json='[]'`);
      expect(all('SELECT capability FROM course_leg_capabilities')).toEqual([{ capability: 'new' }]);
      expect(all('SELECT leg FROM course_legs')).toEqual([{ leg: 'implement' }]);
      sql.exec(`UPDATE runner_grants SET capabilities='["new"]'`);
      expect(all('SELECT capability_pattern FROM grant_capabilities')).toEqual([{ capability_pattern: 'new' }]);
      sql.exec("UPDATE ticket_next_legs SET state='waiting'");
      expect(all('SELECT * FROM ready_tickets')).toEqual([]);
      sql.exec("UPDATE ticket_next_legs SET state='ready'");
      sql.exec('DELETE FROM ready_tickets');
      sql.exec('INSERT INTO ready_tickets SELECT * FROM ready_ticket_source');
      expect(all('SELECT * FROM ready_tickets EXCEPT SELECT * FROM ready_ticket_source')).toEqual([]);
      expect(all('SELECT * FROM ready_ticket_source EXCEPT SELECT * FROM ready_tickets')).toEqual([]);
      // B-239: upgrade the populated 0065 projection, not just an empty database.
      sql.exec("UPDATE credentials SET created_by = 'admin:test' WHERE id = 'key'");
      sql.exec(`INSERT INTO runners (id, hostname, session_name, secret_hash, credential_id, harness, kind,
                tier_ceiling, lease_timeout_ms, settings_hash, first_seen_at, last_seen_at)
                VALUES (1, 'host', 's', 'hash', 'key', 'opencode', 'vm', 'routine', 900000, '', 0, 0)`);
      sql.exec("INSERT INTO runner_capabilities (runner_id, capability, declared) VALUES (1, 'new', 'new'), (1, 'missing', 'missing')");
      sql.exec(MIGRATIONS.find((m) => m.id === 124)!.sql);
      expect(all('SELECT * FROM runner_effective_caps')).toEqual([{ runner_id: 1, repository_id: 'docs', capability: 'new' }]);
      expect(all('SELECT repository_key, repository_id FROM ticket_repositories')).toEqual([{ repository_key: 'o/docs', repository_id: 'docs' }]);
      sql.exec("DELETE FROM tickets WHERE id='docs:A'");
      sql.exec('DELETE FROM runner_grants');
      sql.exec('DELETE FROM courses');
      for (const table of ['ready_tickets','ticket_repositories','grant_capabilities','course_legs','course_leg_capabilities','runner_effective_caps']) expect(all(`SELECT * FROM ${table}`)).toEqual([]);
      expect(all('PRAGMA foreign_key_check')).toEqual([]);
    });
  });
});
