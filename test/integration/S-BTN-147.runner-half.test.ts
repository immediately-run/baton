// S-BTN-153's runner half (BATON_SPEC §15 §6.10 R-BTN-177; B-105), Node only: the runner loop
// itself — BATON_ADVICE carrying the starting advance's advice into the leg's environment,
// BATON_TAKEN returning as the finishing advance's taken, the dead holding leaving both the
// server's declared set and every later beat's declaration. The API-side scenarios are
// S-BTN-147.route-choices.test.ts, on both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { keyCall, payload, course, rows, setAdminKeys, setClock, syncCall, cutover, TOKENS } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { Runner } from '../../src/runner/runner';
import { BatonApi } from '../../src/runner/api';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { call as hostCall } from '#host';

const board = inject('board');
/** Thursday 2026-10-29, 06:00Z — minute of day 360, inside the peak rule's [120, 600). */
const T0 = Date.parse('2026-10-29T06:00:00Z');


/** The program the advice resolves under (S-BTN-147's, compactly): codegen over the two
 *  providers with the peak rule, and the offers facts that derive the models. */
const program = {
  version: 1,
  builtin: 'baton@1',
  derived: ['capability', 'model'],
  entries: [
    { id: 'offers-ocg-dsflash', fact: ['offers', 'key:opencode-go', 'model:deepseek-v4.1-flash'] },
    { id: 'offers-di-dsflash', fact: ['offers', 'key:deepinfra', 'model:deepseek-v4.1-flash'] },
    { id: 'meters-ocg', fact: ['meters', 'key:opencode-go', 'opencode-go'] },
    { id: 'meters-di', fact: ['meters', 'key:deepinfra', 'deepinfra'] },
    { id: 'ocg-peak', head: ['ocg_peak'], body: [['now', 'utc_minute_of_day', '$t'], { cmp: ['$t', '>=', 120] }, { cmp: ['$t', '<', 600] }] },
    { id: 'direct-model', head: ['derived', '$m'], body: [['offers', '$k', '$m'], ['holds', '$k']] },
  ],
  route_choices: [
    {
      id: 'codegen',
      alternatives: [
        { id: 'opencode-go', needs: ['model:deepseek-v4.1-flash', 'key:opencode-go'], demote_when: [[['ocg_peak']]] },
        { id: 'deepinfra', needs: ['model:deepseek-v4.1-flash', 'key:deepinfra'] },
      ],
    },
  ],
};

const CAPACITY_BASE = { type: 'object', additionalProperties: false, properties: { remaining_permille: { type: 'integer', minimum: 0, maximum: 1000 } }, required: ['remaining_permille'], 'x-baton-base': 'std:api-capacity@1' };

let admin: TestKey;
let owner: TestKey;
let head: string | null = null;
let headNo = 0;
const nextHead = () => {
  const sha = board.shas[String.fromCharCode(65 + headNo++)] ?? [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const parent = head;
  head = sha;
  return { sha, parent };
};

/** One ticket of the fixture, cloned under a fresh id. */
const item = (id: string) => {
  const base = structuredClone((board.states.A.state.items as Record<string, unknown>[]).find((i) => i.id === 'R3-9001')) as Record<string, unknown>;
  return { ...base, id, requires: ['none'] };
};

beforeEach(async () => {
  await setClock(T0);
  head = null;
  headNo = 0;
  admin = await makeKey('ssh-ed25519', 'admin');
  owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'opencode-go', scope: 'account', detail_schema: { type: 'object' } })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'deepinfra', scope: 'account', detail_schema: { type: 'object' } })).status).toBe(200);
  expect((await keyCall(admin, '/v1/admin/resources', { name: 'anthropic-capacity', scope: 'account', detail_schema: CAPACITY_BASE, atoms_from: 'any' })).status).toBe(200);
  for (const [instance, serves] of [['ocg:go-plus', ['opencode-go']], ['di:main', ['deepinfra']], ['ac:main', ['anthropic-capacity']]] as const) {
    expect((await keyCall(admin, '/v1/admin/instances', { name: instance, serves, repositories: ['docs'] })).status).toBe(200);
  }
  await cutover(T0);
});

describe('S-BTN-153 (the runner half): BATON_ADVICE reaches the leg, BATON_TAKEN returns as taken', () => {
  /** A one-ticket home: the roadmap-pr course, an implement leg that records its advice and
   *  writes a taken naming a dead key, and a review leg that ends the claim done. */
  function adviceHome(): { dir: string; sha: () => string } {
    const dir = mkdtempSync(join(tmpdir(), 'baton-147-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'b105@test');
    g('config', 'user.name', 'b105 test');
    const write = (path: string, text: string) => {
      const file = join(dir, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    };
    write('.baton/courses/roadmap-pr/course.json', `${JSON.stringify(roadmapPr, null, 2)}\n`);
    write('.baton/baton.json', `${JSON.stringify({ courses: [{ id: 'roadmap-pr', version: 3 }] }, null, 2)}\n`);
    write('.baton/courses/roadmap-pr/legs/implement.mjs', `import { readFileSync, writeFileSync } from 'node:fs';
export async function run(ctx) {
  const advice = readFileSync(process.env.BATON_ADVICE, 'utf8');
  writeFileSync([ctx.checkout, '.baton', 'advice.json'].join('/'), advice);
  writeFileSync(process.env.BATON_TAKEN, JSON.stringify([{ choice: 'codegen', alternative: 'opencode-go', dead: ['key:zai'] }]));
  return { reached: 'pr-open', next: 'review' };
}
export async function close() { return 'https://example.test/close'; }
`);
    write('.baton/courses/roadmap-pr/legs/review.mjs', `export async function run() { return { end: 'done', reached: 'reviewed' }; }
export async function close() { return 'https://example.test/close'; }
`);
    g('add', '-A');
    g('-c', 'user.email=b105@test', '-c', 'user.name=b105 test', 'commit', '--no-gpg-sign', '-qm', 'courses');
    return { dir, sha: () => g('rev-parse', 'HEAD') };
  }

  it('the starting advance\'s advice is in BATON_ADVICE, the leg\'s taken rides the finishing advance, and the dead key leaves the declaration', async () => {
    expect((await keyCall(admin, '/v1/admin/readings', { readings: [{ instance: 'ac:main', available: true, valid_for: 86400, detail: { remaining_permille: 900 } }] })).status).toBe(200);
    const home = adviceHome();
    try {
      // The board is posted AT the home's head, so the claim's snapshot loads the legs (R-BTN-34).
      const git = execFileSync('git', ['-C', home.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const parent = head;
      head = git;
      const final = await syncCall('/v1/sync/board', payload(git, parent, board.states.A, {
        ontology: { builtin: 'baton@1', program },
        registry: [course(3, 3, { route_choices: { implement: ['codegen'] } })],
        state: { items: [item('R3-9901')] },
        ready: ['R3-9901'],
      }));
      expect(final.status).toBe(200);
      const api = new BatonApi({
        url: 'https://baton.test',
        transport: (req) => hostCall(req),
        auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
      });
      const declares: string[][] = [];
      const advances: Record<string, unknown>[] = [];
      const beat = api.heartbeat.bind(api);
      (api as unknown as { heartbeat: (b: Record<string, unknown>) => Promise<Record<string, unknown>> }).heartbeat = async (body: Record<string, unknown>) => {
        declares.push((body.capabilities ?? []) as string[]);
        return await beat(body);
      };
      const adv = api.advance.bind(api);
      (api as unknown as { advance: (id: number, body: Record<string, unknown>) => Promise<Record<string, unknown>> }).advance = async (id: number, body: Record<string, unknown>) => {
        advances.push(body);
        return await adv(id, body);
      };
      const runner = new Runner({
        api, home: home.dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
        capabilities: ['key:opencode-go', 'key:deepinfra', 'key:claude-subscription', 'key:zai'],
        session: 'b105-advice', courses: [{ course: 'roadmap-pr', version: 3 }],
        stateFile: join(tmpdir(), `baton-147-${process.pid}.json`), beatEvery: 60_000, log: () => {},
      });
      const outcome = await runner.runOnce();
      expect(outcome).not.toBeNull();
      // The advice the leg read is the advance answer's, identifiers only.
      const adviceText = readFileSync(join(home.dir, '.baton', 'advice.json'), 'utf8');
      expect(adviceText).toMatch(/"choice":"codegen"/);
      expect(adviceText).not.toMatch(/remaining_permille|900/);
      // The finishing advance carried the taken the leg wrote…
      const finishing = advances.find((b) => Array.isArray(b.taken));
      expect(finishing?.taken).toEqual([{ choice: 'codegen', alternative: 'opencode-go', dead: ['key:zai'] }]);
      // …and the server stored it against the finishing leg's run, with the override recorded.
      const legRow = (await rows<{ leg: string; taken_json: string | null }>('SELECT leg, taken_json FROM claim_legs WHERE taken_json IS NOT NULL ORDER BY seq'))[0];
      expect(legRow.leg).toBe('implement');
      expect(JSON.parse(legRow.taken_json!)).toEqual([{ choice: 'codegen', alternative: 'opencode-go', dead: ['key:zai'] }]);
      // T0 is in peak: deepinfra was advised, opencode-go taken — the override is recorded.
      const override = (await rows<{ detail_json: string }>("SELECT detail_json FROM events WHERE kind = 'advice-overridden'")).at(-1);
      expect(JSON.parse(override!.detail_json)).toEqual({ choice: 'codegen', advised: 'deepinfra', taken: 'opencode-go' });
      // The dead key left: server-side in the reporting advance's transaction, and out of every
      // later beat's declaration (one more runOnce forces the beat).
      expect(await rows('SELECT 1 FROM worker_capabilities WHERE capability = ?', 'key:zai')).toEqual([]);
      await (runner as unknown as { tick: () => Promise<void> }).tick(); // one beat of the session
      expect(declares.at(-1)).not.toContain('key:zai');
      expect(declares.at(-1)).toContain('key:deepinfra');
      runner.stop();
      rmSync(join(tmpdir(), `baton-147-${process.pid}.json`), { force: true });
      if (existsSync(join(tmpdir(), `baton-147-${process.pid}.json.spool.jsonl`))) rmSync(join(tmpdir(), `baton-147-${process.pid}.json.spool.jsonl`), { force: true });
    } finally {
      rmSync(home.dir, { recursive: true, force: true });
    }
  });
}, 120_000);
