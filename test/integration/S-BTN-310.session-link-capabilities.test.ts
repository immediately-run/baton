// S-BTN-310 session-link capabilities (BATON_SPEC §15, R-BTN-33, R-BTN-113, R-BTN-195), both hosts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { course, keyCall, ORIGIN, rows, sessionCall, withCore } from '../helpers';
import { claimAndStart, fleet, grantedRunner, heartbeat, signed, type Fleet, type Granted, type Json } from '../lib/runnerFleet';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { MIGRATIONS } from '../../src/migrations';

const AT = Date.parse('2026-11-20T12:00:00Z');
const TOKEN = 'synthetic-session-capability-310';
const LINK = `https://claude.ai/docs/T-1/implement/run/${TOKEN}`;
const BASE = '/v1/repositories/docs';
const TICKET = `${BASE}/tickets/T-1`;
const hidden = { session_url: null, session_link: true };
const visible = { session_url: LINK, session_link: true };
let f: Fleet;
let reporter: Granted;
let other: Granted;
let claim: number;

beforeEach(async () => {
  f = await fleet(AT);
  f.git.registry = [course(3, 3, { course: { ...roadmapPr, legs: {
    ...roadmapPr.legs, implement: { ...roadmapPr.legs.implement, max_duration: 600 },
  } } })];
  expect((await f.git.refresh()).status).toBe(200);
  const grant = [{ repository: 'docs', owner: f.docsOwner }];
  reporter = await grantedRunner('reporter', 'reporting-host', grant);
  other = await grantedRunner('reader', 'reading-host', grant);
  claim = (await claimAndStart(reporter, 'docs:T-1', 'implement')).claim_id;
  expect((await heartbeat(reporter.key, reporter.hostname, reporter.secret, { session_url: LINK })).status).toBe(200);
});

afterEach(() => vi.restoreAllMocks());

async function raiseInteraction() {
  const result = await signed(reporter.key, `/v1/runner/claims/${claim}/conditions`, { type: 'interact.review' }, reporter.secret);
  expect(result.status).toBe(200);
  return result.json.condition_id;
}

describe('S-BTN-310 session-link capabilities', () => {
  it('projects links for the dashboard and verified reporter, not bare keys or another session on the same key', async () => {
    const siblingSecret = 'synthetic-sibling-runner-secret';
    const sibling = await heartbeat(reporter.key, reporter.hostname, siblingSecret, { session_name: 's-sibling' }, true);
    expect(sibling.status).toBe(200);
    expect(sibling.json.runner_id).not.toBe(reporter.id);
    const surfaces: [string, (body: Json) => unknown[]][] = [
      [`${BASE}/board`, (b) => [b.holders[0]]],
      [`${BASE}/tickets?state=running`, (b) => [b.tickets[0].detail]],
      [TICKET, (b) => [b.claim]],
      [`${BASE}/runners`, (b) => { const r = b.runners.find((r: Json) => r.runner_id === reporter.id); return [r.claim, ...r.claims]; }],
      [`${BASE}/runners/${reporter.id}`, (b) => [b.runner.claim, ...b.runner.claims, b.window.claims[0], ...b.window.claims[0].runs]],
      [`${BASE}/courses/roadmap-pr`, (b) => b.legs.flatMap((l: Json) => l.runs ?? [])],
    ];
    for (const [path, links] of surfaces) {
      const reader = await signed(other.key, path);
      const owner = await signed(f.docsOwner, path);
      const bare = await signed(reporter.key, path);
      const own = await signed(reporter.key, path, undefined, reporter.secret);
      const sameKey = await signed(reporter.key, path, undefined, siblingSecret);
      const res = await sessionCall(f.cookie, path);
      expect([path, reader.status, owner.status, bare.status, own.status, sameKey.status, res.status]).toEqual([path, 200, 200, 200, 200, 200, 200]);
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(own.res.headers.get('Cache-Control')).toContain('no-store');
      expect(own.res.headers.get('ETag')).not.toBe(sameKey.res.headers.get('ETag'));
      const cases = [[reader.json, hidden], [owner.json, hidden], [bare.json, hidden], [sameKey.json, hidden], [own.json, visible], [await res.json() as Json, visible]] as const;
      for (const [body, expected] of cases) {
        if (expected === hidden) expect(JSON.stringify(body)).not.toContain(TOKEN);
        const projected = links(body);
        expect(projected.length).toBeGreaterThan(0);
        for (const link of projected) expect(link).toMatchObject(expected);
      }
    }
    const runPath = `${TICKET}/legs/implement/runs`;
    expect((await signed(f.docsOwner, runPath)).json.runs[0]).toMatchObject(hidden);
    expect((await (await sessionCall(f.cookie, runPath)).json() as Json).runs[0]).toMatchObject(visible);
  });

  it('keeps fenced run links bound to the reporting incarnation after re-keying', async () => {
    const paths: [string, (b: Json) => unknown[]][] = [
      [`${BASE}/runners/${reporter.id}`, (b) => [b.window.claims[0], ...b.window.claims[0].runs]],
      [`${BASE}/courses/roadmap-pr`, (b) => b.legs.flatMap((l: Json) => l.runs ?? [])],
    ];
    const reap = await sessionCall(f.cookie, `/v1/ui/claims/${claim}/reap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ confirm: true }),
    });
    expect(reap.status).toBe(200);
    expect(await reap.json()).toMatchObject({ fence_pending: true });
    for (const [path, links] of paths) {
      const res = await signed(reporter.key, path, undefined, reporter.secret);
      expect(res.status).toBe(200);
      expect(links(res.json)).toEqual(expect.arrayContaining([expect.objectContaining(visible)]));
    }
    const replacement = 'synthetic-replacement-secret';
    const rekeyed = await heartbeat(reporter.key, reporter.hostname, replacement, { rekey: true }, true);
    expect(rekeyed.status).toBe(200);
    expect(rekeyed.json).toMatchObject({ runner_id: reporter.id, incarnation: 2 });
    expect(await rows('SELECT fence_pending FROM claims WHERE id = ?', claim)).toEqual([{ fence_pending: 1 }]);
    for (const [path, links] of paths) {
      const res = await signed(reporter.key, path, undefined, replacement);
      expect(res.status).toBe(200);
      expect(links(res.json)).toEqual(expect.arrayContaining([expect.objectContaining(hidden)]));
      expect(JSON.stringify(res.json)).not.toContain(TOKEN);
      const dashboard = await sessionCall(f.cookie, path);
      expect(dashboard.status).toBe(200);
      expect(links(await dashboard.json() as Json)).toEqual(expect.arrayContaining([expect.objectContaining(visible)]));
    }
  });

  it('gives different validators to queries with different first filter values', async () => {
    await raiseInteraction();
    const path = `${BASE}/conditions?open=1&type=interact`;
    const present = await signed(other.key, `${path}&ticket=docs:T-1&ticket=docs:T-2`);
    const absent = await signed(other.key, `${path}&ticket=docs:T-2&ticket=docs:T-1`);
    expect([present.status, absent.status]).toEqual([200, 200]);
    expect(present.json.conditions).toHaveLength(1);
    expect(absent.json.conditions).toHaveLength(0);
    expect(present.res.headers.get('ETag')).toBeTruthy();
    expect(absent.res.headers.get('ETag')).toBeTruthy();
    expect(present.res.headers.get('ETag')).not.toBe(absent.res.headers.get('ETag'));
  });

  it('delivers open interactions without leaking them to general condition reads or exports', async () => {
    const id = await raiseInteraction();
    const poll = `${BASE}/conditions?open=1&type=interact`;
    const grantPath = '/v1/owner/docs/grants';
    const grant = { public_key: other.key.publicKey, capabilities: ['agent-venue'] };
    const before = await signed(other.key, poll, undefined, other.secret);
    expect(before.status).toBe(200);
    expect(before.json.conditions).toEqual([expect.objectContaining({ condition_id: id, url: null, session_link: true })]);
    expect(JSON.stringify(before.json)).not.toContain(TOKEN);
    expect((await keyCall(f.docsOwner, grantPath, { ...grant, deliver_interactions: 'true' })).status).toBe(400);
    expect((await keyCall(f.docsOwner, grantPath, { ...grant, deliver_interactions: true })).status).toBe(200);
    const delivery = await signed(other.key, poll);
    expect(delivery.status).toBe(200);
    expect(delivery.json.conditions).toEqual([expect.objectContaining({ condition_id: id, url: LINK, session_link: true })]);
    for (const path of [`${BASE}/conditions`, `${BASE}/conditions?type=interact`, `${BASE}/needs-you`, `${BASE}/conditions/${id}`]) {
      const reader = await signed(other.key, path);
      const session = await sessionCall(f.cookie, path);
      expect([reader.status, session.status]).toEqual([200, 200]);
      expect(JSON.stringify(reader.json)).not.toContain(TOKEN);
      expect(JSON.stringify(reader.json)).toContain('"session_link":true');
      expect(await session.text()).toContain(LINK);
    }
    const state = await keyCall(f.admin, '/v1/admin/state');
    expect(state.status).toBe(200);
    expect(JSON.stringify(state.json)).not.toContain(TOKEN);
    expect(state.json.needs_you.conditions[0]).toMatchObject({ url: null, session_link: true });
    expect((await keyCall(f.docsOwner, grantPath, { ...grant, deliver_interactions: false })).status).toBe(200);
    expect((await signed(other.key, poll)).json.conditions).toEqual([expect.objectContaining({ condition_id: id, url: null, session_link: true })]);
  });

  it('keeps tokens out of drop replies, event logs and history when reporting and finishing runs', async () => {
    const logs: unknown[][] = [];
    for (const level of ['debug', 'log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args); });
    }
    expect((await heartbeat(reporter.key, reporter.hostname, reporter.secret, { session_url: LINK })).status).toBe(200);
    await raiseInteraction();
    const dropped = `https://${TOKEN}.invalid/${TOKEN}`;
    const advancePath = `/v1/runner/claims/${claim}/advance`;
    const endPath = `/v1/runner/claims/${claim}/end`;
    const beat = await heartbeat(reporter.key, reporter.hostname, reporter.secret, { session_url: dropped });
    const advanced = await signed(reporter.key, advancePath, { reached: 'pr-open', leg: 'review', session_url: dropped }, reporter.secret);
    const fresh = await heartbeat(reporter.key, reporter.hostname, reporter.secret, { session_url: LINK });
    expect(fresh.status).toBe(200);
    const end = await signed(reporter.key, endPath, { end_reason: 'released:requested', session_url: dropped }, reporter.secret);
    for (const reply of [beat, advanced, end]) {
      expect(reply.status).toBe(200);
      expect(reply.json.session_url_dropped).toContain('session_hosts');
      expect(JSON.stringify(reply.json)).not.toContain(TOKEN);
    }
    const events = await rows('SELECT kind, detail_json FROM events WHERE claim_id = ?', claim);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    const history = await signed(other.key, `${TICKET}/history`);
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.json)).not.toContain(TOKEN);
    expect((await signed(other.key, `${BASE}/conditions?open=1&type=interact`)).json.conditions).toEqual([]);
    expect(JSON.stringify(logs, (_key, value) => value instanceof Error ? String(value.stack ?? value) : value)).not.toContain(TOKEN);
  });

  it('scrubs historical audit copies without deleting normal condition URLs or evidence', async () => {
    const interaction = JSON.stringify({ type: 'interact.review', url: LINK });
    const ordinary = JSON.stringify({ type: 'ask.owner', url: 'https://example.test/question' });
    for (const detail of [interaction, ordinary]) {
      await rows("INSERT INTO events (at, kind, actor, detail_json) VALUES (?, 'condition', 'baton', ?)", AT, detail);
      await rows("INSERT INTO ticket_history (repository_id, ticket_id, at, kind, detail_json) VALUES ('docs', 'docs:T-1', ?, 'condition', ?)", AT, detail);
    }
    await rows("INSERT INTO events (at, kind, actor, detail_json) VALUES (?, 'discrepancy', 'baton', ?)", AT, JSON.stringify({ sub: 'session-url', why: `its host ${TOKEN}`, url: LINK }));
    await rows("INSERT INTO ticket_history (repository_id, ticket_id, at, kind, detail_json) VALUES ('docs', 'docs:T-1', ?, 'leg-finished', ?)", AT, JSON.stringify({ evidence: 'commit', session_url: LINK }));
    await withCore((core) => core.store.transaction(() => core.store.script(MIGRATIONS.find((m) => m.id === 79)!.sql)));
    for (const table of ['events', 'ticket_history']) {
      const values = (await rows<{ detail_json: string }>(`SELECT detail_json FROM ${table}`)).map((r) => r.detail_json);
      expect(values.join()).not.toContain(TOKEN);
      expect(values).toContain(ordinary);
    }
    expect(await rows("SELECT detail_json FROM ticket_history WHERE kind = 'leg-finished'")).toEqual([{ detail_json: '{"evidence":"commit"}' }]);
    expect(await rows('SELECT session_url FROM claim_legs WHERE claim_id = ?', claim)).toEqual([{ session_url: LINK }]);
  });
});
