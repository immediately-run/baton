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
import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import { course as courseEntry, cutover, Git, keyCall, placed, register, rows, setAdminKeys, setClock, syncCall, tick, ticket, TOKENS } from '../helpers';
import { makeKey } from '../lib/sshKeys';
import { Runner } from '../../src/runner/runner';
import { BatonApi } from '../../src/runner/api';
import { builtinExecutor, type Executor, type Handle } from '../../src/runner/executor';
import { graphOf } from '../../src/core/graph';
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
  for (let i = 0; i < 100 && raise('interact') !== 0; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise(() => {});
}
`,
  };
}

/** A scratch home checkout: both courses, their leg scripts, the settings naming them. */
function writeHome(scripts: Record<string, string>): { home: string; sha: string } {
  const home = mkdtempSync(join(tmpdir(), 'baton-222-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', home, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(home, path)), { recursive: true });
    writeFileSync(join(home, path), text);
  };
  write('.baton/courses/roadmap-pr/course.json', `${JSON.stringify(COURSE, null, 2)}\n`);
  write('.baton/courses/timeout-pr/course.json', `${JSON.stringify(TIMEOUT_COURSE, null, 2)}\n`);
  write('.baton/baton.json', `${JSON.stringify({ courses: [{ id: 'roadmap-pr', version: 3 }, { id: 'timeout-pr', version: 1 }] }, null, 2)}\n`);
  for (const [name, text] of Object.entries(scripts)) write(`.baton/courses/roadmap-pr/legs/${name}.mjs`, text);
  write('.baton/courses/timeout-pr/legs/linger.mjs', scripts.linger!);
  g('add', '-A');
  g('-c', 'user.email=b234@test', '-c', 'user.name=b234 test', 'commit', '--no-gpg-sign', '-qm', 'courses');
  return { home, sha: g('rev-parse', 'HEAD').trim() };
}

let git: Git;
let stateFile: string;
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
  const owner = await makeKey('ssh-ed25519', 'docs-owner');
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

const newRunner = (home: string, log: (l: string) => void, over: Record<string, unknown> = {}, onBeat?: (body: Record<string, any>) => void) => new Runner({
  api: new BatonApi({
    url: 'https://baton.test',
    transport: async (req) => {
      // §7.5 R-BTN-90 (B-234): the beats a run's finish went out on, for the assertions below.
      if (onBeat && new URL(req.url).pathname === '/v1/runner/heartbeat') onBeat(await req.clone().json() as Record<string, any>);
      return hostCall(req);
    },
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
  }),
  home, repository: 'docs', hostname: 'vm-a', harness: 'opencode', capabilities: ['key:zai'],
  session: `b234-${Math.random().toString(16).slice(2, 8)}`, courses: [{ course: 'roadmap-pr', version: 3 }, { course: 'timeout-pr', version: 1 }],
  stateFile, beatEvery: 150, log, executor: linkingExecutor(LINK), signalGraceMs: 500, ...over,
});

const said = (record: string) => (existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; code: number | null; err?: string; out?: string }) : []);
const conditionRows = (ticket: string) => rows<{ type: string; disposition: string; outcome: string; url: string | null; closed_how: string | null }>(
  'SELECT type, disposition, outcome, url, closed_how FROM conditions WHERE ticket_id = ? ORDER BY id', ticket);
const cleanup = (home: string) => {
  rmSync(home, { recursive: true, force: true });
  rmSync(stateFile, { force: true });
  rmSync(`${stateFile}.spool.jsonl`, { force: true });
};

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
      const r = newRunner(home, (l) => lines.push(l), {}, (b) => beats.push(b));
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
      let alive = 'alive';
      for (let i = 0; i < 100 && alive === 'alive'; i++) {
        try { process.kill(person, 0); } catch { alive = 'gone'; }
        if (alive === 'alive') await new Promise((res) => setTimeout(res, 50));
      }
      expect(alive).toBe('gone');
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
      // A non-retryable class holds the ticket (R-BTN-122): the owner's to clear.
      expect(await rows<{ hold: number; hold_reason: string | null }>('SELECT hold, hold_reason FROM ticket_overrides WHERE ticket_id = ?', 'docs:B'))
        .toEqual([{ hold: 1, hold_reason: 'non-retryable:spec' }]);
    } finally {
      cleanup(home);
    }
  }, 240_000);

  it('a joinable session nobody joins ends leg-timeout at its deadline_s — a failed attempt — and its condition closes with it', async () => {
    const rec = join(mkdtempSync(join(tmpdir(), 'baton-222-rec-')), 'raises.jsonl');
    const { home, sha } = writeHome(legScripts(rec));
    boardSha = sha;
    await postBoard([{ id: 'C', course_id: 'timeout-pr' }], { C: placed('filed', [], [['linger', 'ready']]) });
    await register('vm-a');
    try {
      const lines: string[] = [];
      const beats: Record<string, any>[] = [];
      const r = newRunner(home, (l) => lines.push(l), {}, (b) => beats.push(b));
      r.start(); // the beats: what lands the session link and delivers the deadline's release
      const once = r.runOnce();
      // The ask lands once a beat has carried the link; then the run waits, joined by no one.
      for (let i = 0; i < 300 && !(await conditionRows('docs:C')).length; i++) await new Promise((res) => setTimeout(res, 100));
      expect(await conditionRows('docs:C')).toEqual([
        { type: 'interact', disposition: 'notify', outcome: 'open', url: LINK, closed_how: null },
      ]);
      // R-BTN-90: the deadline takes the claim back at its instant — a release with reason
      // leg-timeout, delivered by the next beat, the leg stopped at its safe point.
      await setClock(T0 + 61_000);
      await tick();
      const outcome = await once;
      r.stop();
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

  it('the channel\'s own refusals, checked without a claim: no link, baton, an unknown type, a bad severity — none reaching Baton', async () => {
    const { home } = writeHome(legScripts(join(tmpdir(), `baton-222-rec-${process.pid}.jsonl`)));
    try {
      let reported = 0;
      const r = new Runner({
        api: { setSecret: () => {}, conditions: async () => { reported++; return { condition_id: 1, disposition: 'notify' }; } } as unknown as BatonApi,
        home, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session: 'b234-checks',
        courses: [{ course: 'roadmap-pr', version: 3 }], stateFile, beatEvery: 60_000, log: () => {},
      });
      // A live claim's shape, as the raise handler reads it; the run holds no link.
      (r as unknown as { inflight: unknown }).inflight = { claimId: 1, ticket: 'docs:X', course: null, leg: 'implement', legAt: 0, child: null, waiters: [] };
      const course = { course: 'roadmap-pr', graph: graphOf(COURSE), scripts: new Map(), scratch: home };
      const ctx = { ticket: { id: 'docs:X' }, claim: { id: 1 } };
      const ask = (req: Record<string, unknown>) => (r as unknown as { onChannel(req: unknown, course: unknown, leg: string, ctx: unknown): Promise<{ ok: boolean; error?: string }> }).onChannel(req, course, 'implement', ctx);

      expect(await ask({ op: 'raise', type: 'interact', subject: 'join' })).toMatchObject({ ok: false, error: expect.stringContaining('session link') });
      expect(await ask({ op: 'raise', type: 'baton.retries', subject: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining("core's alone") });
      expect(await ask({ op: 'raise', type: 'unheard-of', subject: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('declares') });
      expect(await ask({ op: 'raise', type: 'warning', subject: 'x', severity: 'loud' })).toMatchObject({ ok: false, error: expect.stringContaining('severity') });
      expect(reported).toBe(0); // nothing reached Baton
      expect(await ask({ op: 'raise', type: 'warning', subject: 'a note' })).toMatchObject({ ok: true, condition_id: 1 });
      expect(reported).toBe(1);
    } finally {
      cleanup(home);
    }
  });
});
