// S-BTN-204's runner half (BATON_SPEC §15; §8.4 R-BTN-144, §5.3 R-BTN-63; B-185), Node only: the
// runner hands each leg the run id the advance that started it returned — BATON_RUN_ID, and
// BATON_SESSION_ID as `<run_id>.r0`, the run's first session — and the leg's ctx carries it too.
// The API side is S-BTN-204.run-ids.test.ts, on both hosts.
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { keyCall, payload, course, rows, setAdminKeys, setClock, syncCall, cutover, TOKENS } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { Runner } from '../../src/runner/runner';
import { BatonApi } from '../../src/runner/api';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { call as hostCall } from '#host';

const board = inject('board');
const T0 = Date.parse('2026-11-09T12:00:00Z');

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  await cutover(T0);
});

describe('S-BTN-204 (the runner half): each leg gets BATON_RUN_ID and BATON_SESSION_ID', () => {
  it('the leg\'s environment and ctx hold the run id its advance returned, the session `<run_id>.r0`', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-204-'));
    const stateFile = join(tmpdir(), `baton-204-${process.pid}.json`);
    try {
      const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
      g('init', '-q', '-b', 'main');
      const write = (path: string, text: string) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      };
      write('.baton/courses/roadmap-pr/course.json', `${JSON.stringify(roadmapPr, null, 2)}\n`);
      write('.baton/baton.json', `${JSON.stringify({ courses: [{ id: 'roadmap-pr', version: 3 }] }, null, 2)}\n`);
      // Each leg records what it was handed: the env's two names and ctx's run id.
      const leg = (name: string, result: string) => write(`.baton/courses/roadmap-pr/legs/${name}.mjs`, `import { appendFileSync } from 'node:fs';
export async function run(ctx) {
  appendFileSync([ctx.checkout, '.baton', 'runs.jsonl'].join('/'), JSON.stringify({ leg: ${JSON.stringify(name)}, env: process.env.BATON_RUN_ID, session: process.env.BATON_SESSION_ID, ctx: ctx.run_id }) + '\\n');
  return ${result};
}
export async function close() { return 'https://example.test/close'; }
`);
      leg('implement', `{ reached: 'pr-open', next: 'review' }`);
      leg('review', `{ end: 'done', reached: 'reviewed' }`);
      g('add', '-A');
      g('-c', 'user.email=b185@test', '-c', 'user.name=b185 test', 'commit', '--no-gpg-sign', '-qm', 'courses');
      const sha = g('rev-parse', 'HEAD').trim();
      const base = structuredClone((board.states.A.state.items as Record<string, unknown>[]).find((i) => i.id === 'R3-9001')) as Record<string, unknown>;
      expect((await syncCall('/v1/sync/board', payload(sha, null, board.states.A, {
        registry: [course(3, 3)], state: { items: [{ ...base, id: 'R3-9904', requires: ['none'] }] }, ready: ['R3-9904'],
      }))).status).toBe(200);

      const api = new BatonApi({
        url: 'https://baton.test',
        transport: (req) => hostCall(req),
        auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
      });
      const runner = new Runner({
        api, home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', capabilities: ['key:zai'],
        session: 'b185-run-ids', courses: [{ course: 'roadmap-pr', version: 3 }], stateFile, beatEvery: 60_000, log: () => {},
      });
      expect(await runner.runOnce()).not.toBeNull();
      runner.stop();

      const runs = readFileSync(join(dir, '.baton', 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { leg: string; env: string; session: string; ctx: string });
      const stored = await rows<{ leg: string; run_id: string }>('SELECT leg, run_id FROM claim_legs ORDER BY id');
      expect(runs.map((r) => r.leg)).toEqual(stored.map((r) => r.leg));
      for (const [i, r] of runs.entries()) {
        expect(r.env).toBe(stored[i].run_id);
        expect(r.ctx).toBe(stored[i].run_id);
        expect(r.session).toBe(`${stored[i].run_id}.r0`);
      }
      expect(new Set(runs.map((r) => r.env)).size).toBe(runs.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(stateFile, { force: true });
      rmSync(`${stateFile}.spool.jsonl`, { force: true });
    }
  });
}, 120_000);
