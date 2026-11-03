// S-BTN-21's machine-lock half (BATON_SPEC §15, §6.11 R-BTN-178, §5.7 R-BTN-121; B-106): one
// machine's singleton is the runner's own business — a capability with a `lock` in the runner's
// configuration (`--lock capability=path`) is declared only while this process holds the file's
// exclusive lock. Must hold: of two runners on one machine configured for the same lock, only
// the holder declares the capability, so no leg requiring it is offered to the other — it never
// claims one, with no core capacity set at all; a claim whose next leg needs a lock another
// process on the machine holds suspends at once rather than sending the advance, the finished
// leg's evidence in git; the holder's claim through the lock legs runs, and the lock releases at
// the claim's end. Node only: it runs git, spawns the legs' child processes and takes real
// file locks (the S-BTN-41 pattern).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BatonApi } from '../../src/runner/api';
import { lockWatcherArgv, Runner, type RunnerOptions } from '../../src/runner/runner';
import { call as hostCall } from '#host';
import { course, cutover, ORIGIN, placed, rows, setClock, syncCall, tick, ticket, TOKENS } from '../helpers';

const T0 = Date.parse('2026-11-03T12:00:00Z');
const LOCKED = 'capability:code-generation-llm'; // the venue list admits it, and it is a typed name

/** The course of the first test: two lock legs back to back, then a plain one — the holder
 * advances from one lock leg into another without a gap another runner could steal, and the
 * plain leg releases. */
const THROUGH = {
  start: 'filed', start_leg: 'rdp1', end: ['done'],
  stations: { filed: { label: 'Filed' }, lab: { label: 'In the lab' }, review: { label: 'Reviewed' }, done: { label: 'Done' } },
  legs: {
    rdp1: { from: ['filed'], to: 'lab', requires: { capabilities: [LOCKED] } },
    rdp3: { from: ['lab'], to: 'review', requires: { capabilities: [LOCKED] } },
    plain: { from: ['review'], to: 'done' },
  },
};
/** The course of the second: an unlocked leg between the lock ones, whose advance releases the
 * machine's lock — an outsider takes it, and the advance into the last lock leg suspends. */
const GAP = {
  start: 'filed', start_leg: 'rdp1', end: ['done'],
  stations: { filed: { label: 'Filed' }, lab: { label: 'In the lab' }, mid: { label: 'Between' }, review: { label: 'Reviewed' }, done: { label: 'Done' } },
  legs: {
    rdp1: { from: ['filed'], to: 'lab', requires: { capabilities: [LOCKED] } },
    rdp2: { from: ['lab'], to: 'mid' },
    rdp3: { from: ['mid'], to: 'review', requires: { capabilities: [LOCKED] } },
    plain: { from: ['review'], to: 'done' },
  },
};

/** One leg script: `run` records itself and waits when asked, so the test can interleave. */
const legFile = (run: string): string => `import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ev = (ctx, line) => appendFileSync([ctx.checkout, '.baton', 'evidence.jsonl'].join('/'), line + '\\n');
const git = (ctx, ...a) => execFileSync('git', ['-C', ctx.checkout, ...a], { encoding: 'utf8' }).trim();
export async function run(ctx) {
${run}
}
export async function close(ctx, result) {
  ev(ctx, 'close ' + ctx.leg);
  git(ctx, 'commit', '--allow-empty', '--no-gpg-sign', '-m', 'baton:close ' + ctx.leg);
  return git(ctx, 'rev-parse', 'HEAD');
}
`;

/** The home repository: a real git checkout whose `.baton/` the runner reads at the claim's
 * snapshot, and whose board posts carry the real head sha. */
class Home {
  readonly dir: string;
  readonly course: Record<string, unknown>;
  head: string | null = null;
  constructor(file: Record<string, unknown>) {
    this.dir = mkdtempSync(join(tmpdir(), 'baton-s21l-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 's21l@test');
    g('config', 'user.name', 's21l test');
    this.course = file;
    this.write('.baton/courses/lockcourse/course.json', `${JSON.stringify(file, null, 2)}\n`);
    this.write('.baton/baton.json', `${JSON.stringify({ courses: [{ id: 'lockcourse', version: 1 }] }, null, 2)}\n`);
  }
  write(path: string, text: string): void {
    const file = join(this.dir, path);
    execFileSync('mkdir', ['-p', dirname(file)], { stdio: 'ignore' });
    writeFileSync(file, text);
  }
  leg(name: string, run: string): void {
    this.write(`.baton/courses/lockcourse/legs/${name}.mjs`, legFile(run));
  }
  sha(): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  commit(): string {
    execFileSync('git', ['-C', this.dir, 'add', '.baton'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--no-gpg-sign', '-q', '-m', 'legs'], { stdio: 'ignore' });
    return this.sha();
  }
  async post(stations: Record<string, unknown>, tickets: unknown[], extra: Record<string, unknown> = {}): Promise<void> {
    const sha = this.sha();
    const res = await syncCall('/v1/sync/board', {
      registry: [course(1, 1, { id: 'lockcourse', course: this.course, step_kinds: ['orient'] })],
      sha, parent_sha: this.head, tickets, closed: [], stations, ...extra,
    });
    if (res.status !== 200) throw new Error(`board post: ${res.status} ${await res.text()}`);
    this.head = sha;
  }
  evidence(): string[] {
    const f = join(this.dir, '.baton', 'evidence.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  }
}

let home: Home;
let lockPath: string;
let n = 0;
const clock = { now: T0 };
const runners: Runner[] = [];
const logs: string[][] = [];

/** A runner against this test's Baton, on credential `cred`, configured for the machine lock. */
function makeRunner(cred: keyof typeof TOKENS, over: Partial<RunnerOptions> = {}): Runner {
  const stateFile = join(tmpdir(), `baton-s21l-${process.pid}-${++n}.json`);
  const api = new BatonApi({
    url: 'https://baton.test',
    transport: (req) => hostCall(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS[cred]}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
  });
  const log: string[] = [];
  logs.push(log);
  const runner = new Runner({
    api, home: home.dir, repository: 'docs', hostname: cred === 'vm-a' ? 'vm-a' : 'vm-b', harness: 'opencode',
    session: `s21l-${n}`, courses: [{ course: 'lockcourse', version: 1 }],
    capabilities: [LOCKED], locks: { [LOCKED]: lockPath },
    stateFile, beatEvery: 40, now: () => clock.now, log: (l: string) => log.push(l), ...over,
  });
  runners.push(runner);
  return runner;
}

/** Wait until `q` is true. */
async function until(q: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (await q()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition never became true');
}

/** An outsider's hold on the machine's lock: `flock` kept alive; kill it to release. */
function outsiderTakes(): ReturnType<typeof spawn> {
  return spawn('flock', ['--exclusive', lockPath, 'sleep', 'infinity'], { stdio: 'ignore' });
}
const killOutsider = (child: ReturnType<typeof spawn>) => {
  try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
};

beforeEach(async () => {
  clock.now = T0;
  await setClock(T0);
  home = new Home(GAP);
  lockPath = join(tmpdir(), `baton-s21l-lock-${process.pid}-${++n}`);
  await cutover();
});

afterEach(async () => {
  for (const r of runners.splice(0)) r.stop();
  // A claim a stopped runner had already sent may still land in the next test's window — the
  // trace of that test then opens with a 404 no model action explains. Draining the in-flight
  // attempt keeps each trace the model can replay.
  await new Promise((r) => setTimeout(r, 150));
  rmSync(home.dir, { recursive: true, force: true });
});

describe('S-BTN-21 the machine lock (R-BTN-178)', () => {
  it('of two runners on one machine, only the lock holder declares the capability and claims the leg', async () => {
    home = new Home(THROUGH);
    home.leg('rdp1', `ev(ctx, 'run rdp1'); return { reached: 'lab', next: 'rdp3' };`);
    home.leg('rdp3', `ev(ctx, 'run rdp3'); return { reached: 'review', next: 'plain' };`);
    home.leg('plain', `ev(ctx, 'run plain'); return { reached: 'done' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['rdp1', 'ready']]) }, [ticket('T-1', { course_id: 'lockcourse' })]);

    const a = makeRunner('vm-a');
    void a.work();
    await until(async () => (await rows(`SELECT 1 FROM worker_capabilities w JOIN workers k ON k.id = w.worker_id WHERE k.hostname = 'vm-a' AND w.capability = ?`, LOCKED)).length > 0);
    const b = makeRunner('vm-b');
    const bLog = logs.at(-1)!;
    void b.work();
    // B's boot beat cannot take the lock and does not declare it — no leg requiring it is offered.
    await until(() => bLog.some((l) => l.includes('held by another process on this machine')));
    expect(await rows(`SELECT 1 FROM worker_capabilities w JOIN workers k ON k.id = w.worker_id WHERE k.hostname = 'vm-b' AND w.capability = ?`, LOCKED)).toEqual([]);
    // B never claims the lock leg — with no core capacity set at all, the machine lock alone
    // keeps the singleton single.
    try {
      await until(async () => (await rows<{ status: string; ticket_id: string }>(`SELECT status, ticket_id FROM claims WHERE ticket_id = 'docs:T-1'`)).length > 0);
    } catch (e) {
      console.log('A LOGS', JSON.stringify(logs[0], null, 1));
      throw e;
    }
    const holderRow = (await rows<{ worker_id: number }>(`SELECT w.worker_id FROM worker_capabilities w JOIN workers k ON k.id = w.worker_id WHERE w.capability = ?`, LOCKED))[0];
    const claim = (await rows<{ worker_id: number; status: string }>(`SELECT worker_id, status FROM claims WHERE ticket_id = 'docs:T-1'`))[0];
    expect(claim.worker_id).toBe(holderRow.worker_id);
    // The holder runs the claim through, the lock legs and the plain one.
    await until(async () => (await rows(`SELECT status FROM claims WHERE ticket_id = 'docs:T-1'`))[0]?.status === 'completed');
    expect(home.evidence().filter((l) => l.startsWith('run'))).toEqual(['run rdp1', 'run rdp3', 'run plain']);
    // The claim ended: the lock is released, and B's next beat takes it and declares.
    await until(async () => (await rows(`SELECT 1 FROM worker_capabilities w JOIN workers k ON k.id = w.worker_id WHERE k.hostname = 'vm-b' AND w.capability = ?`, LOCKED)).length > 0);
  }, 20_000);

  it('an advance into a leg whose lock an outsider holds suspends the claim rather than sending it', async () => {
    home.leg('rdp1', `ev(ctx, 'run rdp1'); return { reached: 'lab', next: 'rdp2' };`);
    // rdp2 waits a moment, so the outsider's take lands before its advance into rdp3.
    home.leg('rdp2', `await new Promise((r) => setTimeout(r, 600)); ev(ctx, 'run rdp2'); return { reached: 'mid', next: 'rdp3' };`);
    home.leg('rdp3', `ev(ctx, 'run rdp3'); return { reached: 'review', next: 'plain' };`);
    home.leg('plain', `ev(ctx, 'run plain'); return { reached: 'done' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['rdp1', 'ready']]) }, [ticket('T-1', { course_id: 'lockcourse' })]);

    const a = makeRunner('vm-a');
    const aLog = logs.at(-1)!;
    void a.work();
    await until(async () => (await rows(`SELECT leg FROM claim_legs`)).some((r) => r.leg === 'rdp2'));
    // rdp2 needs no lock, so the advance into it released the machine's; an outsider takes it.
    const outsider = outsiderTakes();
    try {
      await until(async () => (await rows(`SELECT status FROM claims WHERE ticket_id = 'docs:T-1'`))[0]?.status !== 'active');
      const claim = (await rows<{ status: string; end_reason: string }>(`SELECT status, end_reason FROM claims WHERE ticket_id = 'docs:T-1'`))[0];
      // A suspension is a completed end that rests at its station (§6.5, R-BTN-71).
      expect(claim).toMatchObject({ status: 'completed', end_reason: 'suspended:mid' });
      // Nothing of rdp3 ran — the suspension touched nothing beyond the finished rdp2.
      expect(home.evidence().filter((l) => l.startsWith('run'))).toEqual(['run rdp1', 'run rdp2']);
      expect(aLog.some((l) => l.includes('the claim suspends rather than run it'))).toBe(true);
    } finally {
      killOutsider(outsider);
    }
  }, 20_000);

  it('a claim answered for a lock leg the runner cannot lock ends suspended at once, touching nothing (R-BTN-121)', async () => {
    home.leg('rdp1', `ev(ctx, 'run rdp1'); return { reached: 'lab', next: 'rdp2' };`);
    home.leg('rdp2', `ev(ctx, 'run rdp2'); return { reached: 'mid', next: 'rdp3' };`);
    home.leg('rdp3', `ev(ctx, 'run rdp3'); return { reached: 'review', next: 'plain' };`);
    home.leg('plain', `ev(ctx, 'run plain'); return { reached: 'done' };`);
    home.commit();
    // The server can satisfy rule 4 for the lock leg while this runner holds no lock: a one-rule
    // ontology derives the capability from a key the runner declares (R-BTN-174 — the declared
    // list is the runner's own word; the derivation is the server's), and another process on
    // this machine holds the lock, so the runner neither declares nor can take the capability.
    const program = {
      version: 1, builtin: 'baton@1', derived: ['capability'],
      entries: [{ id: 'lab-from-key', head: ['derived', LOCKED], body: [['holds', 'key:zai']] }],
    };
    await home.post({ 'T-1': placed('filed', [], [['rdp1', 'ready']]) }, [ticket('T-1', { course_id: 'lockcourse' })], { ontology: { builtin: 'baton@1', program } });

    const outsider = outsiderTakes();
    try {
      const a = makeRunner('vm-a', { capabilities: ['key:zai'] });
      const aLog = logs.at(-1)!;
      void a.work();
      await until(async () => (await rows(`SELECT status FROM claims WHERE ticket_id = 'docs:T-1'`))[0]?.status === 'completed');
      // The claim was answered for the lock leg — the server derived the capability — and the
      // runner, unable to take the machine's lock, ended it suspended at once: no leg started,
      // no advance sent, nothing run.
      const claim = (await rows<{ status: string; end_reason: string }>(`SELECT status, end_reason FROM claims WHERE ticket_id = 'docs:T-1'`))[0];
      expect(claim).toMatchObject({ status: 'completed', end_reason: 'suspended:filed' });
      expect(await rows(`SELECT leg FROM claim_legs`)).toEqual([]);
      expect(home.evidence()).toEqual([]);
      expect(aLog.some((l) => l.includes('the claim suspends rather than run it'))).toBe(true);
    } finally {
      killOutsider(outsider);
    }
  }, 20_000);

  it('a lock released by an unlocked leg and re-taken for the next lock leg goes on (round 1, finding 2)', async () => {
    home.leg('rdp1', `ev(ctx, 'run rdp1'); return { reached: 'lab', next: 'rdp2' };`);
    home.leg('rdp2', `ev(ctx, 'run rdp2'); return { reached: 'mid', next: 'rdp3' };`);
    home.leg('rdp3', `ev(ctx, 'run rdp3'); return { reached: 'review', next: 'plain' };`);
    home.leg('plain', `ev(ctx, 'run plain'); return { reached: 'done' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['rdp1', 'ready']]) }, [ticket('T-1', { course_id: 'lockcourse' })]);

    // One runner, nobody else on the machine: the claim runs the gap course end to end. The
    // advance into rdp2 releases the lock and the one after it takes it again — which must be
    // declared before that advance is sent, or the server's rule 4 refuses a machine that holds
    // the thing (review round 1, finding 2).
    const a = makeRunner('vm-a');
    void a.work();
    await until(async () => (await rows(`SELECT status FROM claims WHERE ticket_id = 'docs:T-1'`))[0]?.status === 'completed');
    const claim = (await rows<{ end_reason: string }>(`SELECT end_reason FROM claims WHERE ticket_id = 'docs:T-1'`))[0];
    expect(claim.end_reason).toBe('done');
    expect(home.evidence().filter((l) => l.startsWith('run'))).toEqual(['run rdp1', 'run rdp2', 'run rdp3', 'run plain']);
  }, 20_000);

  it('a lock held by a killed runner dies with it — the watcher watches the pid (round 2, finding 1)', async () => {
    // The watcher `MachineLocks` spawns, in its own process: a child node runner takes the lock
    // exactly as the runner does (`lockWatcherArgv`, its own pid), is SIGKILLed, and the lock
    // must free within the watcher's second — a plain `sleep infinity` (round 1's shape) leaves
    // it held and this test fails.
    const path = join(tmpdir(), `baton-s21l-death-${process.pid}`);
    const holder = spawn('node', ['-e', `
      const { spawn } = require('node:child_process');
      const argv = ${JSON.stringify(lockWatcherArgv(0))};
      // watch THIS node process's pid, exactly as the runner watches its own
      argv[argv.length - 1] = String(process.pid);
      const child = spawn('flock', ['--exclusive', '--nonblock', process.argv[1], ...argv],
        { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
      child.stdout.on('data', () => process.stdout.write('held'));
      setInterval(() => {}, 1000);
    `, path], { stdio: ['ignore', 'pipe', 'ignore'] });
    let held = false;
    holder.stdout.on('data', () => (held = true));
    await until(() => held);
    // While the holder lives, the lock is its…
    expect(spawnSync('flock', ['--nonblock', path, 'true']).status).not.toBe(0);
    // …and a SIGKILL — no stop(), no finally — frees it within the watcher's second.
    holder.kill('SIGKILL');
    await until(() => spawnSync('flock', ['--nonblock', path, 'true']).status === 0);
  }, 15_000);
});
