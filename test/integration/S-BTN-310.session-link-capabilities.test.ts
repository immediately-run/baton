// S-BTN-310 session-link capabilities (BATON_SPEC §15, R-BTN-33, R-BTN-113, R-BTN-195), both hosts.
import { beforeEach, describe, expect, it } from 'vitest';
import { course, keyCall, rows, sessionCall, withCore } from '../helpers';
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

async function raiseInteraction() {
  const result = await signed(reporter.key, `/v1/runner/claims/${claim}/conditions`, { type: 'interact.review' }, reporter.secret);
  expect(result.status).toBe(200);
  return result.json.condition_id;
}

describe('S-BTN-310 session-link capabilities', () => {
  it('projects each claim link for the dashboard and its reporting runner, not other keys', async () => {
    const surfaces: [string, (body: Json) => unknown[]][] = [
      [`${BASE}/board`, (b) => [b.holders[0]]],
      [TICKET, (b) => [b.claim]],
      [`${BASE}/runners`, (b) => { const r = b.runners.find((r: Json) => r.runner_id === reporter.id); return [r.claim, ...r.claims]; }],
      [`${BASE}/runners/${reporter.id}`, (b) => [b.runner.claim, ...b.runner.claims, b.window.claims[0], ...b.window.claims[0].runs]],
      [`${BASE}/courses/roadmap-pr`, (b) => b.legs.flatMap((l: Json) => l.runs ?? [])],
    ];
    for (const [path, links] of surfaces) {
      const reader = await signed(other.key, path);
      const owner = await signed(f.docsOwner, path);
      const own = await signed(reporter.key, path);
      const res = await sessionCall(f.cookie, path);
      expect([path, reader.status, owner.status, own.status, res.status]).toEqual([path, 200, 200, 200, 200]);
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(own.res.headers.get('Cache-Control')).toContain('no-store');
      const cases = [[reader.json, hidden], [owner.json, hidden], [own.json, visible], [await res.json() as Json, visible]] as const;
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

  it('delivers open interactions without leaking them to general condition reads or exports', async () => {
    const id = await raiseInteraction();
    const poll = `${BASE}/conditions?open=1&type=interact`;
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
  });

  it('keeps tokens out of drop replies, event logs and history when reporting and finishing runs', async () => {
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
    await withCore((core) => core.store.transaction(() => core.store.script(MIGRATIONS.find((m) => m.id === 71)!.sql)));
    for (const table of ['events', 'ticket_history']) {
      const values = (await rows<{ detail_json: string }>(`SELECT detail_json FROM ${table}`)).map((r) => r.detail_json);
      expect(values.join()).not.toContain(TOKEN);
      expect(values).toContain(ordinary);
    }
    expect(await rows("SELECT detail_json FROM ticket_history WHERE kind = 'leg-finished'")).toEqual([{ detail_json: '{"evidence":"commit"}' }]);
    expect(await rows('SELECT session_url FROM claim_legs WHERE claim_id = ?', claim)).toEqual([{ session_url: LINK }]);
  });
});
