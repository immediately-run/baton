// S-BTN-210 repository code through `exec` (BATON_SPEC §15; §8.3 R-BTN-107, §8.4 R-BTN-133;
// B-184), Node only: under a recording executor — `builtin` wrapped, every call noted — a leg's
// `run` begins by `start`, keyed by its run id's first session, and it and the leg's `close` reach
// `exec` as wrapper calls in that session; the runner's own process runs none of them, and each
// call reads its arguments from stdin and returns on stdout's last line. (A ticket source's `read`
// runs the same way in a `source` session: S-BTN-207's runner scenarios exercise it under
// `builtin`.)
import { describe, it, expect, beforeEach, inject } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { keyCall, payload, course, rows, setAdminKeys, setClock, syncCall, cutover, TOKENS } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { Runner } from '../../src/runner/runner';
import { BatonApi } from '../../src/runner/api';
import { builtinExecutor, type Executor } from '../../src/runner/executor';
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

/** `builtin`, with every start, exec and stop recorded. */
function recording(): { executor: Executor; log: { op: string; session: string; kind?: string; argv?: string[] }[] } {
  const inner = builtinExecutor();
  const log: { op: string; session: string; kind?: string; argv?: string[] }[] = [];
  const executor: Executor = {
    ...inner,
    source: 'pinned', digest: 'test',
    async start(o) {
      log.push({ op: 'start', session: o.brief.session_id, kind: o.brief.kind });
      return await inner.start(o);
    },
    exec(h, argv, o) {
      log.push({ op: 'exec', session: h.session_id, argv });
      return inner.exec(h, argv, o);
    },
    async stop(h, reason) {
      log.push({ op: 'stop', session: h.session_id, kind: reason });
      await inner.stop(h, reason);
    },
  };
  return { executor, log };
}

describe('S-BTN-210: repository code runs only through the executor (R-BTN-107)', () => {
  it('each leg starts a session keyed by its run id; run and close are wrapper calls in it, never in the runner\'s process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-210-'));
    const stateFile = join(tmpdir(), `baton-210-${process.pid}.json`);
    try {
      const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
      g('init', '-q', '-b', 'main');
      const write = (path: string, text: string) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      };
      write('.baton/courses/roadmap-pr/course.json', `${JSON.stringify(roadmapPr, null, 2)}\n`);
      write('.baton/baton.json', `${JSON.stringify({ courses: [{ id: 'roadmap-pr', version: 3 }] }, null, 2)}\n`);
      // Every call notes its pid and what it was handed.
      const leg = (name: string, result: string) => write(`.baton/courses/roadmap-pr/legs/${name}.mjs`, `import { appendFileSync } from 'node:fs';
const note = (ctx, call) => appendFileSync([ctx.checkout, '.baton', 'calls.jsonl'].join('/'), JSON.stringify({ leg: ${JSON.stringify(name)}, call, pid: process.pid, run_id: ctx.run_id ?? null }) + '\\n');
export async function run(ctx) { note(ctx, 'run'); return ${result}; }
export async function close(ctx, result) { note(ctx, 'close'); return 'https://example.test/close/' + ${JSON.stringify(name)} + '/' + (result && result.reached); }
export async function handoff(ctx) { note(ctx, 'handoff'); return 'https://example.test/handoff'; }
`);
      leg('implement', `{ reached: 'pr-open', next: 'review' }`);
      leg('review', `{ end: 'done', reached: 'reviewed' }`);
      g('add', '-A');
      g('-c', 'user.email=b184@test', '-c', 'user.name=b184 test', 'commit', '--no-gpg-sign', '-qm', 'courses');
      const sha = g('rev-parse', 'HEAD').trim();
      const base = structuredClone((board.states.A.state.items as Record<string, unknown>[]).find((i) => i.id === 'R3-9001')) as Record<string, unknown>;
      expect((await syncCall('/v1/sync/board', payload(sha, null, board.states.A, {
        registry: [course(3, 3)], state: { items: [{ ...base, id: 'R3-9910', requires: ['none'] }] }, ready: ['R3-9910'],
      }))).status).toBe(200);

      const api = new BatonApi({
        url: 'https://baton.test',
        transport: (req) => hostCall(req),
        auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
      });
      const { executor, log } = recording();
      const runner = new Runner({
        api, home: dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', capabilities: ['key:zai'], executor,
        session: 'b184-exec', courses: [{ course: 'roadmap-pr', version: 3 }], stateFile, beatEvery: 60_000, log: () => {},
      });
      expect(await runner.runOnce()).not.toBeNull();
      runner.stop();

      const runIds = (await rows<{ leg: string; run_id: string }>('SELECT leg, run_id FROM claim_legs ORDER BY id'));
      expect(runIds.map((r) => r.leg)).toEqual(['implement', 'review']);
      // Each leg's session starts keyed by its run id's first session, of kind `leg`…
      const starts = log.filter((e) => e.op === 'start');
      expect(starts).toEqual(runIds.map((r) => ({ op: 'start', session: `${r.run_id}.r0`, kind: 'leg' })));
      // …and its run and close are wrapper calls in that session: `node <wrapper> <call> <script>`.
      for (const r of runIds) {
        const calls = log.filter((e) => e.op === 'exec' && e.session === `${r.run_id}.r0` && e.argv?.[0] === 'node').map((e) => [e.argv![2], e.argv![3].split('/').at(-1)]);
        expect(calls).toEqual([['run', `${r.leg}.mjs`], ['close', `${r.leg}.mjs`]]);
      }
      // Every session the runner started, it stopped.
      expect(new Set(log.filter((e) => e.op === 'stop').map((e) => e.session))).toEqual(new Set(starts.map((e) => e.session)));
      // The calls ran in their own processes, never the runner's; `close` got its ctx and result.
      const calls = readFileSync(join(dir, '.baton', 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { leg: string; call: string; pid: number; run_id: string });
      expect(calls.map((c) => `${c.leg}:${c.call}`)).toEqual(['implement:run', 'implement:close', 'review:run', 'review:close']);
      for (const c of calls) expect(c.pid).not.toBe(process.pid);
      expect(calls.map((c) => c.run_id)).toEqual([runIds[0].run_id, runIds[0].run_id, runIds[1].run_id, runIds[1].run_id]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(stateFile, { force: true });
      rmSync(`${stateFile}.spool.jsonl`, { force: true });
    }
  });
}, 120_000);
