// S-BTN-222's runner half (BATON_SPEC §15; §8.2 R-BTN-106, §7.1 R-BTN-160, R-BTN-195,
// §8.3 R-BTN-107, §7.5 R-BTN-90; B-234), Node only: the leg's channel answers a raise with the
// reason and reaches Baton not at all when the check fails — an autonomous leg may raise no
// `interact` and no suspend type (`hitl` and a course's own included) and its claim ends
// `released:cannot-finish:spec` with `error.needs-person`, the ticket held; `interact` from a
// leg with no deadline is refused while `hitl` from the same leg is taken; a linked run's
// `interact` is reported, the subject and body staying in the runner's log and out of Baton; a
// joinable session ends at the result posted on its channel with a person still in it, and the
// runner stops the session; a joinable session nobody joins ends `leg-timeout` at its
// `deadline_s`, a failed attempt, its condition closing with it. The API side is
// S-BTN-222.interact.test.ts, on both hosts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { callChannel } from '../../src/runner/channel';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { claimItem, course as courseEntry, cutover, Git, keyCall, placed, register, rows, setAdminKeys, setClock, syncCall, tick, ticket } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { runnerApi, testRunner, until } from '../lib/runnerRig';
import type { BatonApi } from '../../src/runner/api';
import { builtinExecutor, type Executor, type Handle } from '../../src/runner/executor';
import { graphOf } from '../../src/core/graph';
import { CREATE_PR_COURSE } from '../../src/defaults/course-pr';
import { call as hostCall } from '#host';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'cli', 'baton.mjs');
const T0 = Date.parse('2026-11-14T11:00:00Z');
const LINK = 'https://claude.ai/s/r_0000000000000000000000000';

/** The course under test: `implement` runs with a deadline, `review` without one (a script leg
 *  with no deadline), `merge` joinable (its agent posts its result and runs on), `auto-review`
 *  autonomous, and `ask.owner` a course-declared `suspend` type. The `timeout-pr` course's one
 *  leg carries a short deadline for the unjoined ask. */
const COURSE = {
  ...roadmapPr,
  conditions: { 'ask.owner': { disposition: 'suspend', restarts: { retry: 'again' } } },
  legs: {
    ...roadmapPr.legs,
    implement: { from: ['filed'], to: 'pr-open', max_duration: 600 },
    review: { from: ['pr-open', 'fixed'], to: 'reviewed' },
    merge: { from: ['reviewed', 'adjudicated'], to: 'merged', max_duration: 600 },
    'auto-review': { from: ['pr-open'], to: 'reviewed', autonomous: true, max_duration: 600 },
  },
} as Record<string, unknown>;
const TIMEOUT_COURSE = {
  start: 'filed', start_leg: 'linger', end: ['merged'],
  stations: { filed: {}, merged: {} },
  legs: { linger: { from: ['filed'], to: 'merged', max_duration: 60 } },
} as Record<string, unknown>;

/** An executor whose leg sessions name a session link (R-BTN-113: the handle's `link` is the
 *  session's own — what a cloud-session executor reports; `builtin` names none). */
function linkingExecutor(link: string): Executor {
  const base = builtinExecutor();
  return {
    api: base.api, source: base.source, digest: base.digest, provides: base.provides,
    async start(o) { return { ...(await base.start(o)), ...(o.brief.kind === 'leg' ? { link } : {}) }; },
    exec: (h: Handle, a: string[], o: Parameters<Executor['exec']>[2]) => base.exec(h, a, o),
    stop: base.stop.bind(base),
    end: base.end.bind(base),
    salvage: base.salvage.bind(base),
  };
}

/** The leg scripts, each recording what the channel answered into `record`. `raise` is the CLI
 *  as the agent runs it — BATON_SOCKET is already in the environment the runner gave the leg —
 *  and its subject carries a link, which nothing that reaches Baton may hold. */
function legScripts(record: string): Record<string, string> {
  const prelude = `import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
const CLI = ${JSON.stringify(CLI)};
const note = (x) => appendFileSync(${JSON.stringify(record)}, JSON.stringify(x) + '\\n');
const raise = (type, ...args) => {
  const r = spawnSync(process.execPath, [CLI, 'leg', 'raise', type, '--subject', 'join me at https://evil.example/phish', ...args], { encoding: 'utf8', env: process.env });
  note({ type, code: r.status, err: (r.stderr || '').trim().split('\\n')[0], out: (r.stdout || '').trim() });
  return r.status;
};
export async function close() { return null; }
export async function handoff() { return null; }
`;
  return {
    // A linked, deadlined run: `interact` twice (the second supersedes the first), then `hitl`
    // with restarts and a severity. The first ask waits for the beat that lands the link.
    implement: `${prelude}
export async function run(ctx) {
  for (let i = 0; i < 100 && raise('interact') !== 0; i++) await new Promise((r) => setTimeout(r, 100));
  raise('interact');
  raise('hitl', '--restarts', '{"retry":"run it again"}', '--severity', 'high');
  return { reached: 'pr-open', next: 'review' };
}
`,
    // No deadline: `interact` refused naming it, `hitl` taken.
    review: `${prelude}
export async function run(ctx) {
  raise('interact');
  raise('hitl');
  return { reached: 'reviewed', next: 'merge' };
}
`,
    // Joinable: the agent posts its result with a child still alive (a person in the session),
    // and the script runs on — the session does not exit by itself.
    merge: `${prelude}
export async function run(ctx) {
  const person = spawn('sleep', ['30'], { stdio: 'ignore' });
  writeFileSync(${JSON.stringify(`${record}.person`)}, String(person.pid));
  await new Promise((resolve, reject) => {
    const sock = net.createConnection(process.env.BATON_SOCKET);
    sock.on('error', reject);
    sock.on('connect', () => sock.write(JSON.stringify({ op: 'done', result: { end: 'done', reached: 'merged' } }) + '\\n'));
    sock.on('data', () => { sock.destroy(); resolve(); });
  });
  note({ type: 'done-posted' });
  await new Promise(() => {}); // a person is still in the session
}
`,
    // The autonomous leg: every ask refused, `error.needs-person` taken.
    'auto-review': `${prelude}
export async function run(ctx) {
  raise('interact');
  raise('hitl');
  raise('ask.owner');
  raise('error.needs-person');
  return { release: 'cannot-finish:spec', reached: 'pr-open' };
}
`,
    // The unjoined ask: raise `interact` (the beat's cadence lands the link), then wait — nobody
    // joins, nothing is posted, and the leg's own deadline takes the claim back.
    linger: `${prelude}
export async function run(ctx) {
  note({ can_interact: ctx.can_interact });
  for (let i = 0; i < 100 && raise('interact') !== 0; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise(() => {});
}
`,
  };
}

/** A scratch home checkout: both courses, their leg scripts, the settings naming them. */
function writeHome(scripts: Record<string, string>, graph = COURSE, agent_command?: string): { home: string; sha: string } {
  const home = mkdtempSync(join(tmpdir(), 'baton-222-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', home, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), text);
  };
  write('.baton/courses/roadmap-pr/course.json', `${JSON.stringify(graph, null, 2)}\n`);
  write('.baton/courses/timeout-pr/course.json', `${JSON.stringify(TIMEOUT_COURSE, null, 2)}\n`);
  write('.baton/baton.json', `${JSON.stringify({ agent_command, courses: [{ id: 'roadmap-pr', version: 3 }, { id: 'timeout-pr', version: 1 }] }, null, 2)}\n`);
  for (const [name, text] of Object.entries(scripts)) write(`.baton/courses/roadmap-pr/legs/${name}.mjs`, text);
  if (scripts.linger != null) write('.baton/courses/timeout-pr/legs/linger.mjs', scripts.linger);
  g('add', '-A');
  g('-c', 'user.email=b234@test', '-c', 'user.name=b234 test', 'commit', '--no-gpg-sign', '-qm', 'courses');
  return { home, sha: g('rev-parse', 'HEAD').trim() };
}

let git: Git;
let stateFile: string;
let repoOwner: Awaited<ReturnType<typeof makeKey>>;
/** The board's head is the home checkout's own commit — the runner loads the claim's course
 *  from it (R-BTN-34), so a post's sha must be one the home holds. */
let boardSha: string | null = null;
let boardHead: string | null = null;
async function postBoard(tickets: { id: string; course_id?: string }[], stations: Record<string, unknown>) {
  // The normative post (§7.1): tickets, closed and stations together, at the home's own head.
  const res = await syncCall('/v1/sync/board', {
    registry: git.registry, sha: boardSha!, parent_sha: boardHead,
    tickets: tickets.map((t) => ticket(t.id, t.course_id ? { course_id: t.course_id } : {})),
    closed: [], stations,
  });
  if (res.status !== 200) throw new Error(`the board post failed: ${res.status} ${await res.text()}`);
  boardHead = boardSha;
}

beforeEach(async () => {
  await setClock(T0);
  const admin = await makeKey('ssh-ed25519', 'admin');
  const owner = repoOwner = await makeKey('ssh-ed25519', 'docs-owner');
  await setAdminKeys(admin);
  expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
  git = new Git();
  git.registry = [
    courseEntry(3, 3, { course: COURSE }),
    { ...courseEntry(1, 1, { course: TIMEOUT_COURSE }), id: 'timeout-pr', skill: 'timeout-pr' },
  ];
  boardSha = null;
  boardHead = null;
  await cutover(T0);
  stateFile = join(tmpdir(), `baton-222-${process.pid}-${Math.random().toString(16).slice(2)}.json`);
});

const newRunner = (home: string, log: (l: string) => void, over: Record<string, unknown> = {}, onBeat?: (body: Record<string, any>) => Response | void, transport = hostCall) => testRunner({
  api: runnerApi({
    transport: async (req) => {
      if (onBeat && new URL(req.url).pathname === '/v1/runner/heartbeat') {
        const response = onBeat(await req.clone().json() as Record<string, any>);
        if (response) return response;
      }
      return transport(req);
    },
  }),
  home, capabilities: ['key:zai'],
  session: `b234-${Math.random().toString(16).slice(2, 8)}`, courses: [{ course: 'roadmap-pr', version: 3 }, { course: 'timeout-pr', version: 1 }],
  stateFile, beatEvery: 150, log, executor: linkingExecutor(LINK), signalGraceMs: 500, ...over,
});

const said = (record: string) => (existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; code: number | null; err?: string; out?: string }) : []);
const conditionRows = (ticket: string) => rows<{ type: string; disposition: string; outcome: string; url: string | null; closed_how: string | null }>(
  'SELECT type, disposition, outcome, url, closed_how FROM conditions WHERE ticket_id = ? ORDER BY id', ticket);
const cleanup = (home: string) => {
  rmSync(home, { recursive: true, force: true });
  rmSync(stateFile, { force: true });
  rmSync(`${stateFile}.view`, { force: true });
  rmSync(`${stateFile}.spool.jsonl`, { force: true });
};

describe('S-BTN-62 and S-BTN-75: channel results and bounded chains', () => {
  const scripts = {
    linger: 'export async function run() { return null; }',
    implement: `export async function run() { await new Promise((resolve) => setInterval(resolve, 60000)); }
export async function close() { return 'https://example.test/evidence'; }
export async function handoff() { return 'https://example.test/handoff'; }`,
    review: `export async function run() { return { suspend: true, reached: 'reviewed' }; }
export async function close() { return null; }
export async function handoff() { return 'https://example.test/handoff'; }`,
  };

  it('refuses invalid moves locally, then arrives with a staged output and suspends before an unlisted leg', async () => {
    // The output is this test's own: a declared output is required of every completed run (B-39),
    // so the shared course, whose other tests produce none, declares none.
    const legs = COURSE.legs as Record<string, Record<string, unknown>>;
    const graph = { ...COURSE, legs: { ...legs, implement: { ...legs.implement, outputs: { effect: { schema: 'std:effect@1' } } } },
      stations: { ...roadmapPr.stations, 'pr-open': { entry: [{ output: 'effect', schema: 'std:effect@1' }] } } };
    git.registry[0] = courseEntry(3, 3, { course: graph });
    const { home, sha } = writeHome(scripts, graph);
    boardSha = sha;
    await postBoard([{ id: 'A' }, { id: 'B' }], {
      A: placed('pr-open', [['implement', 'pr-open']], [['review', 'ready']]),
      B: placed('filed', [], [['implement', 'ready']]),
    });
    await register('vm-a');
    const base = builtinExecutor();
    let started!: (o: Parameters<Executor['start']>[0]) => void;
    const ready = new Promise<Parameters<Executor['start']>[0]>((resolve) => { started = resolve; });
    const executor: Executor = { ...base, async start(o) {
      const handle = await base.start(o);
      if (o.channel) started(o);
      return handle;
    } };
    const runner = newRunner(home, () => {}, { executor, bounds: { legs: ['implement'] }, now: () => T0 });
    const locks = vi.spyOn(runner as unknown as { ensureLegLocks(run: unknown, leg: string): Promise<boolean> }, 'ensureLegLocks')
      .mockImplementation(async (_run, leg) => leg !== 'review');
    const running = runner.runOnce();
    try {
      const { channel, brief } = await Promise.race([ready, running.then(() => { throw new Error('runner ended before serving'); })]);
      expect(statSync(channel!).mode & 0o777).toBe(0o600);
      const call = (op: string, fields: Record<string, unknown> = {}) => callChannel(channel!, { op, ...fields });
      const view = JSON.parse(readFileSync(brief.env.BATON_STATE, 'utf8'));
      expect(view.secret).toBeUndefined();
      expect(view.claim).toMatchObject({ ticket_id: 'docs:B', nonce: expect.any(String) });
      expect(brief.env.BATON_TOKEN).toBeUndefined();
      expect(await call('status')).toMatchObject({ ok: true, leg: 'implement' });
      expect(await call('done', { reached: 'merged' })).toMatchObject({ ok: false, error: expect.stringContaining('not an outcome') });
      expect(await call('done', { reached: 'pr-open', next: 'review' })).toMatchObject({ ok: false, error: expect.stringContaining('requires output effect') });
      expect(await call('output', { name: 'effect', value: { kind: 'test' } })).toMatchObject({ ok: false, error: expect.stringContaining('fails std:effect@1') });
      expect(await rows('SELECT leg FROM claim_legs ORDER BY seq')).toEqual([{ leg: 'implement' }]);
      expect(await call('output', { name: 'effect', value: { kind: 'test', at: new Date(T0).toISOString() } })).toEqual({ ok: true });
      expect(await call('done', { result: { suspend: true, reached: 'pr-open', next: 'review', detail: 'x'.repeat(201) } }))
        .toMatchObject({ ok: false, error: expect.stringContaining('200 characters') });
      expect(await call('done', { reached: 'pr-open', next: 'review' })).toEqual({ ok: true });
      expect(await running).toMatchObject({ ticket: 'docs:B', end_reason: 'suspended:pr-open', reached: 'pr-open', handoff: 'https://example.test/handoff' });
      expect(locks.mock.calls.map(([, leg]) => leg)).toEqual(['implement']);
      expect(await rows('SELECT leg FROM claim_legs ORDER BY seq')).toEqual([{ leg: 'implement' }]);
      expect(await runner.runOnce()).toBeNull(); // the bounded claim does not take A's review
    } finally {
      runner.stopNow();
      await running.catch(() => {});
      runner.stop();
      cleanup(home);
    }
  });

  it('accepts a corrected post and advances to an allowed next leg', async () => {
    git.registry = [courseEntry(3, 3)];
    const { home, sha } = writeHome(scripts, roadmapPr);
    boardSha = sha;
    await postBoard([{ id: 'A' }], { A: placed('filed', [], [['implement', 'ready']]) });
    await register('vm-a');
    const base = builtinExecutor();
    let started!: (socket: string) => void;
    const ready = new Promise<string>((resolve) => { started = resolve; });
    const executor: Executor = { ...base, async start(o) {
      if (o.brief.leg === 'implement' && o.channel) started(o.channel);
      return base.start(o);
    } };
    const runner = newRunner(home, () => {}, { executor, bounds: { legs: ['implement', 'review'] } });
    const running = runner.runOnce();
    try {
      const socket = await Promise.race([ready, running.then(() => { throw new Error('runner ended before serving'); })]);
      expect(await callChannel(socket, { op: 'done', reached: 'pr-open', next: 'merge' })).toMatchObject({ ok: false, error: expect.stringContaining('does not leave') });
      expect(await callChannel(socket, { op: 'done', reached: 'pr-open', next: 'review' })).toEqual({ ok: true });
      expect(await running).toMatchObject({ ticket: 'docs:A', end_reason: 'suspended:reviewed' });
      expect(await rows('SELECT leg FROM claim_legs ORDER BY seq')).toEqual([{ leg: 'implement' }, { leg: 'review' }]);
    } finally {
      runner.stopNow();
      await running.catch(() => {});
      runner.stop();
      cleanup(home);
    }
  });

  it.each(['count', 'deadline'])('suspends at the completed leg when the %s bound is reached', async (bound) => {
    git.registry = [courseEntry(3, 3)];
    const { home, sha } = writeHome({ ...scripts, implement: scripts.implement.replace(
      'await new Promise((resolve) => setInterval(resolve, 60000));', "return { reached: 'pr-open', next: 'review' };",
    ) }, roadmapPr);
    boardSha = sha;
    await postBoard([{ id: 'A' }], { A: placed('filed', [], [['implement', 'ready']]) });
    await register('vm-a');
    let now = T0;
    const base = builtinExecutor();
    const executor: Executor = { ...base, exec(h, argv, opts) {
      if (bound === 'deadline' && argv[2] === 'run') now = T0 + 1000;
      return base.exec(h, argv, opts);
    } };
    const runner = newRunner(home, () => {}, { executor, now: () => now,
      bounds: bound === 'count' ? { legs: ['implement', 'review'], maxLegs: 1 } : { until: T0 + 1000 },
    });
    try {
      expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:A', end_reason: 'suspended:pr-open' });
      expect(await rows('SELECT leg FROM claim_legs ORDER BY seq')).toEqual([{ leg: 'implement' }]);
      if (bound === 'deadline') expect(await runner.runOnce()).toBeNull();
    } finally {
      runner.stop();
      cleanup(home);
    }
  });

  it.each(['first', 'successor'])('does not dispatch or record a %s start when /advance crosses the deadline', async (boundary) => {
    git.registry = [courseEntry(3, 3)];
    const { home, sha } = writeHome({ ...scripts, implement: scripts.implement.replace(
      'await new Promise((resolve) => setInterval(resolve, 60000));', "return { reached: 'pr-open', next: 'review' };",
    ) }, roadmapPr);
    boardSha = sha;
    await postBoard([{ id: 'A' }], { A: placed('filed', [], [['implement', 'ready']]) });
    await register('vm-a');
    const runs: string[] = [];
    const base = builtinExecutor();
    const executor: Executor = { ...base, exec(h, argv, opts) {
      if (argv[2] === 'run') runs.push(basename(argv[3]));
      return base.exec(h, argv, opts);
    } };
    const runner = newRunner(home, () => {}, { executor, now: () => T0, bounds: { until: T0 + 1000 } }, undefined, async (req) => {
      if (new URL(req.url).pathname.endsWith('/advance')) {
        const { leg, start_before } = await req.clone().json() as { leg: string; start_before: number };
        expect(start_before).toBe(T0 + 1000);
        if (leg === (boundary === 'first' ? 'implement' : 'review')) await setClock(T0 + 1000);
      }
      return hostCall(req);
    });
    try {
      const station = boundary === 'first' ? 'filed' : 'pr-open';
      expect(await runner.runOnce()).toMatchObject({ end_reason: `suspended:${station}`, reached: station });
      expect(await rows('SELECT leg FROM claim_legs ORDER BY seq')).toEqual(boundary === 'first' ? [] : [{ leg: 'implement' }]);
      expect(runs).toEqual(boundary === 'first' ? [] : ['implement.mjs']);
    } finally {
      runner.stop();
      cleanup(home);
    }
  });

  it.each(['executor setup', 'link heartbeat'])('does not dispatch past the deadline during %s, and retries the final end', async (phase) => {
    git.registry = [courseEntry(3, 3)];
    const { home, sha } = writeHome(scripts, roadmapPr);
    boardSha = sha;
    await postBoard([{ id: 'A' }], { A: placed('filed', [], [['implement', 'ready']]) });
    await register('vm-a');
    let now = T0;
    const calls: string[] = [];
    const ends: unknown[] = [];
    const base = builtinExecutor();
    const executor: Executor = { ...base, async start(o) {
      const h = await base.start(o);
      if (o.brief.leg !== 'implement') return h;
      if (phase === 'executor setup') now = T0 + 1000;
      return { ...h, link: LINK };
    }, exec(h, argv, opts) {
      calls.push(argv[2]);
      // If dispatch were incorrectly allowed, let the test reach its assertion promptly.
      if (argv[2] === 'run') return { result: Promise.resolve({ status: 1, stdout: '', stderr: 'unexpected run' }), write() {}, kill() {} };
      return base.exec(h, argv, opts);
    } };
    const runner = newRunner(home, () => {}, { executor, now: () => now, bounds: { until: T0 + 1000 } }, (body) => {
      if (phase === 'link heartbeat' && body.session_url === LINK) now = T0 + 1000;
    }, async (req) => {
      if (new URL(req.url).pathname.endsWith('/end')) {
        ends.push(await req.clone().json());
        if (ends.length === 1) return Response.json({ code: 'unavailable' }, { status: 503 });
      }
      return hostCall(req);
    });
    try {
      await runner.work();
      expect(calls).not.toContain('run');
      expect(ends).toHaveLength(2);
      expect(ends[0]).toEqual(ends[1]);
      expect(ends[1]).toMatchObject({ end_reason: 'suspended:filed', reached: 'filed', next: 'implement' });
      expect(await rows('SELECT end_reason FROM claims')).toEqual([{ end_reason: 'suspended:filed' }]);
    } finally {
      runner.stop();
      cleanup(home);
    }
  });
});

describe('S-BTN-222 (the runner half): the channel checks a raise (R-BTN-160, R-BTN-195)', () => {
  it('a linked run raises interact twice and hitl; a leg with no deadline raises no interact; the subject and body stay in the runner\'s log', async () => {
    const rec = join(mkdtempSync(join(tmpdir(), 'baton-222-rec-')), 'raises.jsonl');
    const { home, sha } = writeHome(legScripts(rec));
    boardSha = sha;
    await postBoard([{ id: 'A' }], { A: placed('filed', [], [['implement', 'ready']]) });
    await register('vm-a');
    try {
      const lines: string[] = [];
      const beats: Record<string, any>[] = [];
      const r = newRunner(home, (l) => lines.push(l), {}, (b) => { beats.push(b); });
      r.start(); // the beats: what lands the session link (R-BTN-113) while the leg runs
      const outcome = await r.runOnce(); // implement → review → merge, merge joinable: ends done
      r.stop();
      expect(outcome).toMatchObject({ ticket: 'docs:A', end_reason: 'done', reached: 'merged' });

      // §7.5 R-BTN-90 (B-234): each run's return went out on a beat of its own before the
      // validation, close and advance that followed — implement (seq 1), review (2), the
      // joinable merge (3, its posted result ended the session; the beat still says the script
      // returned) — each once, and never one for a leg that did not run.
      expect(beats.filter((b) => b.leg_finished !== undefined).map((b) => b.leg_finished)).toEqual([1, 2, 3]);

      // The channel's answers as the leg recorded them: two interacts and a hitl taken from the
      // deadlined leg; the undeadlined leg's interact refused naming the deadline, its hitl
      // taken (a script leg with no link included). The joinable merge leg's own note is racy
      // by design — the runner stops the session the moment its posted result lands — so only
      // the raises are ordered here; the posted result itself is the claim's done end below.
      const answers = said(rec);
      const raisesOnly = answers.filter((x) => x.code !== undefined);
      expect(raisesOnly.map((x) => [x.type, x.code])).toEqual([
        ['interact', 0], ['interact', 0], ['hitl', 0],
        ['interact', 1], ['hitl', 0],
      ]);
      expect(raisesOnly[3].err).toContain('deadline_s');
      expect(raisesOnly[0].out).toContain('condition');

      // What reached Baton: the two interacts (the first superseded by the second, the second
      // closed with its run) and the two hitls — no interact row for the refused leg, and no
      // field anywhere holding the subject's link.
      expect(await conditionRows('docs:A')).toEqual([
        { type: 'interact', disposition: 'notify', outcome: 'superseded', url: LINK, closed_how: 'superseded' },
        { type: 'interact', disposition: 'notify', outcome: 'closed', url: LINK, closed_how: 'run-ended' },
        { type: 'hitl', disposition: 'suspend', outcome: 'open', url: null, closed_how: null },
        { type: 'hitl', disposition: 'suspend', outcome: 'open', url: null, closed_how: null },
      ]);
      expect(JSON.stringify(await rows('SELECT * FROM conditions'))).not.toContain('evil.example');

      // The joinable session: the posted result ended the leg, the runner stopped the session —
      // the person it held is gone with it — and the log holds both that and the subject (the
      // one place the leg's own words live, R-BTN-33).
      expect(lines.join('\n')).toContain('ended at the result posted on its channel');
      expect(lines.join('\n')).toContain('evil.example/phish');
      const person = Number(readFileSync(`${rec}.person`, 'utf8'));
      await until(() => {
        try { process.kill(person, 0); return false; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
      }, Boolean, 'the session child to exit');
    } finally {
      cleanup(home);
    }
  }, 240_000);

  it('an autonomous leg raises no ask — its interact, hitl and the course\'s suspend type refused on the channel, reaching Baton not at all — and error.needs-person ends its claim cannot-finish:spec, the ticket held', async () => {
    const rec = join(mkdtempSync(join(tmpdir(), 'baton-222-rec-')), 'raises.jsonl');
    const { home, sha } = writeHome(legScripts(rec));
    boardSha = sha;
    await postBoard([{ id: 'B' }], { B: placed('pr-open', [['implement', 'pr-open']], [['auto-review', 'ready']]) });
    await register('vm-a');
    try {
      const r = newRunner(home, () => {});
      const outcome = await r.runOnce();
      r.stop();
      expect(outcome).toMatchObject({ ticket: 'docs:B', end_reason: 'released:cannot-finish:spec' });

      // Every ask refused naming R-BTN-195; the error taken and its class named in the answer.
      const answers = said(rec);
      expect(answers.map((x) => [x.type, x.code])).toEqual([['interact', 1], ['hitl', 1], ['ask.owner', 1], ['error.needs-person', 0]]);
      for (const refused of answers.slice(0, 3)) expect(refused.err).toContain('R-BTN-195');
      expect(answers[3].out).toContain('released:cannot-finish:spec');
      // The refusals reached Baton not at all: one condition, the error alone — an `interrupt`
      // closes as it is raised (R-BTN-160), its record the history's.
      expect(await conditionRows('docs:B')).toEqual([
        { type: 'error.needs-person', disposition: 'interrupt', outcome: 'recorded', url: null, closed_how: 'raised' },
      ]);
      expect(await rows(`SELECT json_extract(detail_json, '$.error.type') AS type,
                                json_extract(detail_json, '$.error.message') AS message
                         FROM events WHERE kind = 'released' AND ticket_id = ?`, 'docs:B'))
        .toEqual([{ type: 'error.needs-person', message: 'The leg raised error.needs-person.' }]);
      // A non-retryable class holds the ticket (R-BTN-122): the owner's to clear.
      expect(await rows<{ hold: number; hold_reason: string | null }>('SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = ?', 'docs:B'))
        .toEqual([{ hold: 1, hold_reason: 'non-retryable:spec' }]);
    } finally {
      cleanup(home);
    }
  }, 240_000);

  it('a late heartbeat makes a run joinable after startup fails; an unanswered ask ends at its deadline_s', async () => {
    const rec = join(mkdtempSync(join(tmpdir(), 'baton-222-rec-')), 'raises.jsonl');
    const { home, sha } = writeHome(legScripts(rec));
    boardSha = sha;
    await postBoard([{ id: 'C', course_id: 'timeout-pr' }], { C: placed('filed', [], [['linger', 'ready']]) });
    await register('vm-a');
    try {
      const lines: string[] = [];
      const beats: Record<string, any>[] = [];
      const r = newRunner(home, (l) => lines.push(l), {}, (b) => {
        beats.push(b);
        // Fail the startup beat and keep the link from landing until the leg has tried to ask.
        if (b.session_url === LINK && !said(rec).some((x) => x.type === 'interact')) {
          return new Response('{}', { status: 503 });
        }
      });
      r.start(); // the beats: what lands the session link and delivers the deadline's release
      const once = r.runOnce();
      // The ask lands once a beat has carried the link; then the run waits, joined by no one.
      for (let i = 0; i < 300 && !(await conditionRows('docs:C')).length; i++) await new Promise((res) => setTimeout(res, 100));
      const open = await conditionRows('docs:C');
      // R-BTN-90: the deadline takes the claim back at its instant — a release with reason
      // leg-timeout, delivered by the next beat, the leg stopped at its safe point.
      await setClock(T0 + 61_000);
      await tick();
      const outcome = await once;
      r.stop();
      expect(lines.some((l) => l.includes('the heartbeat that lands the session link failed'))).toBe(true);
      expect(said(rec)[0]).toEqual({ can_interact: true });
      expect(said(rec)[1]).toMatchObject({ type: 'interact', code: 1, err: expect.stringContaining('session link') });
      expect(open).toEqual([
        { type: 'interact', disposition: 'notify', outcome: 'open', url: LINK, closed_how: null },
      ]);
      expect(outcome).toMatchObject({ ticket: 'docs:C', end_reason: 'released:leg-timeout' });
      expect(await rows<{ failed_attempt: number }>('SELECT failed_attempt FROM claims WHERE ticket_id = ? AND end_reason = ?', 'docs:C', 'released:leg-timeout'))
        .toEqual([{ failed_attempt: 1 }]); // §6.10: a failed attempt
      expect(await conditionRows('docs:C')).toEqual([
        { type: 'interact', disposition: 'notify', outcome: 'closed', url: LINK, closed_how: 'run-ended' },
      ]);
      // §7.5 R-BTN-90: the script never returned, so no `leg_finished` went out — the ask
      // nobody joined ends at its own deadline, exactly as R-BTN-195 says.
      expect(beats.some((b) => b.leg_finished !== undefined)).toBe(false);
    } finally {
      cleanup(home);
    }
  }, 240_000);

  it.each([
    { thrown: `new LegError('error.spec', 'declared failure')`, type: 'error.spec', cls: 'spec', message: 'declared failure' },
    { thrown: `new Error('plain failure')`, type: 'error.transient', cls: 'transient', message: 'plain failure' },
  ])('G-BTN-146: ctx.raise and a script that throws $type', async ({ thrown, type, cls, message }) => {
    const { home, sha } = writeHome({ implement: `
      import { LegError } from '@immediately-run/baton/leg';
      export async function run(ctx) {
        await ctx.raise('warning', { subject: 'private subject', body: 'private body' });
        throw ${thrown};
      }
    ` });
    boardSha = sha;
    await postBoard([{ id: 'A' }], { A: placed('filed', [], [['implement', 'ready']]) });
    await register('vm-a');
    const r = newRunner(home, () => {});
    try {
      expect(await r.runOnce()).toMatchObject({ ticket: 'docs:A', end_reason: `released:cannot-finish:${cls}` });
      expect((await conditionRows('docs:A')).map(({ type, outcome }) => ({ type, outcome }))).toEqual([
        { type: 'warning', outcome: 'recorded' },
        ...(cls === 'spec' ? [{ type, outcome: 'recorded' }] : []),
      ]);
      expect(await rows(`SELECT json_extract(detail_json, '$.error.type') AS type,
                                json_extract(detail_json, '$.error.message') AS message
                         FROM events WHERE kind = 'released' AND ticket_id = 'docs:A'`)).toEqual([{ type, message }]);
    } finally {
      r.stop();
      cleanup(home);
    }
  }, 240_000);

  it('a conflicting open PR abandons merge once and waits for the owner', async () => {
    const reason = 'PR #364 conflicts with main; merge refused';
    const { home, sha } = writeHome({ merge: `
      import { run as merge } from ${JSON.stringify(join(ROOT, '.baton/courses/standard-create-pr/legs/merge.mjs'))};
      export async function run(ctx) {
        process.env.PATH = ctx.checkout + ':' + process.env.PATH;
        return merge({ ...ctx, forge_home: undefined });
      }
    ` }, COURSE, `sh -c 'echo "${reason}"'`);
    boardSha = sha;
    mkdirSync(join(home, 'content', 'roadmap'), { recursive: true });
    writeFileSync(join(home, 'content', 'roadmap', 'A-1.mdx'), '---\nid: A-1\n---\n');
    writeFileSync(join(home, 'gh'), `#!/bin/sh
case "$*" in
  *"--state open"*) echo '[{"number":364,"headRefName":"claude/A-1-conflict","headRefOid":"0123456789abcdef0123456789abcdef01234567","isCrossRepository":false}]' ;;
  *) echo '[]' ;;
esac
`, { mode: 0o755 });
    await postBoard([{ id: 'A-1' }], { 'A-1': placed('reviewed', [], [['merge', 'ready']]) });
    const r = newRunner(home, () => {});
    try {
      expect(await r.runOnce()).toMatchObject({ ticket: 'docs:A-1', end_reason: 'released:cannot-finish:blocked' });
      expect(await rows("SELECT station, failed_attempt, end_detail FROM claims WHERE ticket_id = 'docs:A-1'"))
        .toEqual([{ station: 'reviewed', failed_attempt: 1, end_detail: reason }]);
      expect(await rows("SELECT decision_id, question FROM ticket_decisions WHERE ticket_id = 'docs:A-1'"))
        .toEqual([{ decision_id: 'baton:retries', question: reason }]);
      await setClock(T0 + 8 * 3_600_000);
      await postBoard([{ id: 'A-1' }], { 'A-1': placed('reviewed', [], [['merge', 'ready']]) });
      const b = await register('vm-b');
      const claim = () => claimItem('vm-b', b.secret, { ticket_id: 'docs:A-1' });
      expect((await claim()).json).toMatchObject({ code: 'not-eligible' });
      expect((await keyCall(repoOwner, '/v1/owner/docs/tickets/docs%3AA-1/resolve', { decision: 'baton:retries', answer: 'retry' })).status).toBe(200);
      expect((await claim()).json).toMatchObject({ ticket_id: 'docs:A-1', legs: ['merge'] });
    } finally {
      r.stop();
      cleanup(home);
    }
  }, 240_000);

  it('a typed close refusal is reported without retrying close or advancing', async () => {
    const { home, sha } = writeHome({ implement: `
      import { LegError } from '@immediately-run/baton/leg';
      export function run() { return { reached: 'pr-open', suspend: true }; }
      export function close() { throw new LegError('error.blocked', 'push refused by branch protection'); }
    ` });
    boardSha = sha;
    await postBoard([{ id: 'A' }], { A: placed('filed', [], [['implement', 'ready']]) });
    const r = newRunner(home, () => {});
    try {
      expect(await r.runOnce()).toMatchObject({ end_reason: 'released:cannot-finish:blocked' });
      expect(await conditionRows('docs:A')).toMatchObject([{ type: 'error.blocked' }]);
      expect(await rows("SELECT station, failed_attempt, end_detail FROM claims WHERE ticket_id = 'docs:A'"))
        .toEqual([{ station: 'filed', failed_attempt: 1, end_detail: 'push refused by branch protection' }]);
    } finally {
      r.stop();
      cleanup(home);
    }
  }, 240_000);

  it('the channel refuses invalid raises and honors standard create-pr\'s question policy (B-325)', async () => {
    const { home } = writeHome(legScripts(join(tmpdir(), `baton-222-rec-${process.pid}.jsonl`)));
    try {
      let reported = 0;
      const r = testRunner({
        api: { setSecret: () => {}, conditions: async (_: number, body: Record<string, unknown>) => {
          expect(body).not.toHaveProperty('restarts'); // old servers require omission for an empty map
          reported++;
          return { condition_id: 1, disposition: 'notify' };
        } } as unknown as BatonApi,
        home, session: 'b234-checks',
        courses: [{ course: 'roadmap-pr', version: 3 }], stateFile, beatEvery: 60_000,
      });
      // A live claim's shape, as the raise handler reads it; the run holds no link.
      const claim = (r as unknown as { makeRun(path: string): unknown }).makeRun(home);
      (claim as { inflight: unknown }).inflight = { claimId: 1, ticket: 'docs:X', course: null, leg: 'implement', legAt: 0, child: null, waiters: [] };
      const course = { course: 'roadmap-pr', graph: graphOf(COURSE), scripts: new Map(), scratch: home };
      const ctx = { ticket: { id: 'docs:X' }, claim: { id: 1 } };
      const ask = (req: Record<string, unknown>, loaded = course, leg = 'implement') => (claim as { onChannel(req: unknown, course: unknown, leg: string, ctx: unknown): Promise<{ ok: boolean; error?: string }> }).onChannel(req, loaded, leg, ctx);

      expect(await ask({ op: 'raise', type: 'interact', subject: 'join' })).toMatchObject({ ok: false, error: expect.stringContaining('session link') });
      expect(await ask({ op: 'raise', type: 'baton.retries', subject: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining("core's alone") });
      expect(await ask({ op: 'raise', type: 'unheard-of', subject: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('declares') });
      expect(await ask({ op: 'raise', type: 'warning', subject: 'x', severity: 'loud' })).toMatchObject({ ok: false, error: expect.stringContaining('severity') });
      const narrowed = { ...course, graph: graphOf({ ...COURSE, legs: { ...roadmapPr.legs, implement: { ...roadmapPr.legs.implement, conditions: [] } } }) };
      expect(await ask({ op: 'raise', type: 'warning', subject: 'x' }, narrowed)).toMatchObject({ ok: false, error: expect.stringContaining('narrow') }); // S-BTN-130
      expect(await ask({ op: 'raise', type: 'ask.owner', subject: 'x', restarts: { park: 'park' } })).toMatchObject({ ok: false, error: expect.stringContaining('subset') });
      expect(await ask({ op: 'raise', type: 'ask.owner', subject: 'x', default: 'park' })).toMatchObject({ ok: false, error: expect.stringContaining('default') });
      expect(reported).toBe(0); // nothing reached Baton
      expect(await ask({ op: 'raise', type: 'warning', subject: 'a note' })).toMatchObject({ ok: true, condition_id: 1 });
      expect(reported).toBe(1);

      const createPr = { ...course, course: 'create-pr', graph: graphOf(CREATE_PR_COURSE) };
      Object.assign(claim as object, { legSessionUrl: LINK, sessionLinkLanded: true });
      const question = { op: 'raise', type: 'interact', subject: 'join' };
      expect(await ask(question, createPr, 'review')).toMatchObject({ ok: false, error: expect.stringContaining('this leg is autonomous') });
      expect(reported).toBe(1);
      expect(await ask(question, createPr, 'implement')).toMatchObject({ ok: true, condition_id: 1 });
      expect(reported).toBe(2);
    } finally {
      cleanup(home);
    }
  });
});
