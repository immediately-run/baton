// S-BTN-41 the runner (BATON_SPEC §15 S-BTN-41, §8.3 R-BTN-72; R3-1245): `baton run` on a VM
// with a home repository's `.baton/` — stub leg scripts that push evidence into git, `close`
// writing the closing marker as a commit — claims a ticket and follows its results. Must hold:
// the runner holds the claim through a `ci` wait and goes on; it takes the leg each result names
// — the merge advance carrying the adjudicate result's `bars` — never inferring a single edge;
// the `max-runs` refusal suspends, writing the hand-off; a regressed path aborts the leg and
// suspends at its `from`; `close` and `handoff` run before the suspension and it ends
// `suspended:<station>`; on a lost lease it aborts the leg and kills its process group before
// any fence report, with no hand-off; the second claim runs new scripts with no restart; a bad
// `next` suspends at its station; a release aborts the leg at its next safe point, writes the
// hand-off and ends `released:requested` naming whether the leg reached its `to`; a leg
// session's claim is refused, since it carries BATON_PARENT, and leg sessions register no
// worker of their own; an `unblocked` message is acknowledged. Node only: it spawns the legs'
// child processes and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BatonApi, BatonRefusal } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { legNeeds, readHead } from '../../src/runner/home';
import { capabilitiesOf } from '../../src/shared/vocabulary.mjs';
import { call as hostCall } from '#host';
import { course, cutover, ORIGIN, ownerCall, placed, rows, setClock, syncCall, ticket, TOKENS } from '../helpers';
import relay from '../fixtures/courses/relay/course.json';

const T0 = Date.parse('2026-10-16T12:00:00Z');

/** One leg script: `run` is the body given; `close` commits a closing marker and returns the
 * commit (the position is in git before it is reported, R-BTN-83); `handoff` records its call.
 * Every line the test asserts on lands in `<home>/.baton/evidence.jsonl`. */
function legFile(run: string, defaultExport = false): string {
  return `import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const at = (ctx, name) => [ctx.checkout, '.baton', name].join('/');
const ev = (ctx, line) => appendFileSync(at(ctx, 'evidence.jsonl'), line + '\\n');
const out = (ctx, o) => { const f = at(ctx, 'evidence.jsonl'); const was = existsSync(f) ? readFileSync(f, 'utf8') : ''; writeFileSync(f, was + JSON.stringify(o) + '\\n'); };
const git = (ctx, ...a) => execFileSync('git', ['-C', ctx.checkout, ...a], { encoding: 'utf8' }).trim();
${defaultExport ? 'export default' : 'export'} async function run(ctx) {
${run}
}
export async function close(ctx, result) {
  appendFileSync(at(ctx, 'markers.jsonl'), JSON.stringify({ leg: ctx.leg, ...(result && result.reached ? { reached: result.reached } : {}), claim: ctx.claim.nonce }) + '\\n');
  git(ctx, 'add', '.baton/markers.jsonl');
  git(ctx, 'commit', '--allow-empty', '--no-gpg-sign', '-m', 'baton:close ' + ctx.leg);
  ev(ctx, 'close ' + ctx.leg);
  return git(ctx, 'rev-parse', 'HEAD');
}
export async function handoff(ctx) {
  ev(ctx, 'handoff ' + ctx.leg + (ctx.bug ? ' bug=' + ctx.bug : ''));
  return 'https://example.test/handoff/' + ctx.leg;
}
`;
}

/** The home repository: a real git checkout whose `.baton/` the runner reads at the claim's
 * snapshot, and whose board posts carry the real head sha (R-BTN-34's fetch never fires). */
class Home {
  readonly dir: string;
  head: string | null = null;
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'baton-home-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'relay@test');
    g('config', 'user.name', 'relay test');
    this.write('.baton/courses/relay/course.json', `${JSON.stringify(relay, null, 2)}\n`);
    this.write('.baton/baton.json', `${JSON.stringify({ course: 'relay', skills_version: 3 }, null, 2)}\n`);
  }
  write(path: string, text: string): void {
    const file = join(this.dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  leg(name: string, run: string, defaultExport = false): void {
    this.write(`.baton/courses/relay/legs/${name}.mjs`, legFile(run, defaultExport));
  }
  sha(): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  commit(): string {
    execFileSync('git', ['-C', this.dir, 'add', '.baton'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--no-gpg-sign', '-q', '-m', 'legs'], { stdio: 'ignore' });
    return this.sha();
  }
  async post(stations: Record<string, unknown>, tickets: unknown[] = [ticket('T-1', { course_id: 'relay' })], registryOver: Record<string, unknown> = {}): Promise<void> {
    const sha = this.sha();
    const res = await syncCall('/v1/sync/board', {
      registry: [course(3, 3, { id: 'relay', course: relay as unknown as Record<string, unknown>, ...registryOver })],
      sha, parent_sha: this.head, tickets, closed: [], stations,
    });
    if (res.status !== 200) throw new Error(`board post: ${res.status} ${await res.text()}`);
    this.head = sha;
  }
  evidence(): string[] {
    const f = join(this.dir, '.baton', 'evidence.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  }
  markers(): { leg: string; reached?: string; claim: string }[] {
    const f = join(this.dir, '.baton', 'markers.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { leg: string; reached?: string; claim: string }) : [];
  }
}

let home: Home;
let n = 0;
const clock = { now: T0 };
const runners: Runner[] = [];

/** A runner against this test's Baton (the local host), heartbeating as credential vm-a. */
function makeRunner(over: Record<string, unknown> = {}): Runner {
  const stateFile = join(tmpdir(), `baton-runner-${process.pid}-${++n}.json`);
  const api = new BatonApi({
    url: 'https://baton.test',
    transport: (req) => hostCall(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
  });
  const runner = new Runner({
    api, home: home.dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
    session: `runner-${n}`, courses: [{ course: 'relay', version: 3 }],
    stateFile, beatEvery: 40, now: () => clock.now, log: () => {},
    ...over,
  });
  runners.push(runner);
  return runner;
}

/** Wait until `q` returns a non-empty list — the test's window into the runner's progress. */
async function until(q: () => Promise<unknown[]> | unknown[]): Promise<unknown[]> {
  for (let i = 0; i < 400; i++) {
    const r = await q();
    if (r.length) return r;
    await new Promise((r2) => setTimeout(r2, 10));
  }
  throw new Error('condition never became true');
}

/** Wait until `pid` is gone — a killed process group's proof. */
async function untilDead(pid: number): Promise<boolean> {
  for (let i = 0; i < 400; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r2) => setTimeout(r2, 10));
  }
  return false;
}

const ABORTABLE = `await new Promise((resolve) => {
  const t = setInterval(() => { if (ctx.signal.aborted) { clearInterval(t); resolve(); } }, 10);
  setTimeout(() => { clearInterval(t); resolve(); }, 30000);
});`;

beforeEach(async () => {
  clock.now = T0;
  await setClock(T0);
  home = new Home();
  await cutover();
});

afterEach(async () => {
  for (const r of runners.splice(0)) r.stop();
  rmSync(home.dir, { recursive: true, force: true });
});

describe('S-BTN-41 the runner', () => {
  it('claims a ticket and takes the leg each result names, never inferring one', async () => {
    home.leg('build', `out(ctx, { leg: 'build', parent: process.env.BATON_PARENT ?? null, hasState: !!process.env.BATON_STATE, hasOldMarkers: !!(process.env.IR_BATON_PARENT || process.env.IR_BATON_STATE), session: ctx.session ?? null, run: ctx.run });
  return { reached: 'built', next: 'check', session: 's-1' };`);
    home.leg('check', `out(ctx, { leg: 'check', session: ctx.session ?? null, run: ctx.run });
  return { reached: 'checked', next: 'merge', bars: ['family:anthropic'] };`);
    home.leg('merge', `out(ctx, { leg: 'merge', run: ctx.run });
  return { reached: 'merged' };`, true);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ ticket: 'docs:T-1', end_reason: 'done', reached: 'merged' });
    expect(await rows('SELECT status, end_reason FROM claims')).toEqual([{ status: 'completed', end_reason: 'done' }]);
    // The merge advance carried the check result's bars on the edge (R-BTN-63).
    expect(await rows('SELECT leg, to_station, bars FROM claim_legs ORDER BY seq')).toEqual([
      { leg: 'build', to_station: 'built', bars: '[]' },
      { leg: 'check', to_station: 'checked', bars: '[]' },
      { leg: 'merge', to_station: 'merged', bars: '["family:anthropic"]' },
    ]);
    // The leg session's env named its parent and the runner's state file (it registers no worker
    // of its own); the session token travelled from build's result into check's ctx. Each leg's
    // run number is 1 on its first run — the path gains a leg only when it finishes.
    const lines = home.evidence();
    // B-97: the leg's env carries BATON_PARENT and BATON_STATE only — the transition's IR_ names
    // are no longer set beside them.
    expect(JSON.parse(lines[0])).toMatchObject({ leg: 'build', parent: expect.stringMatching(/^\d+$/), hasState: true, run: 1 });
    // B-97: the runner inherits its own environment, so only a run that starts without the old
    // names can say they were not set beside the new ones — true of a runner, not of this test's
    // own shell when it is itself a leg.
    if (!process.env.IR_BATON_PARENT && !process.env.IR_BATON_STATE) expect(JSON.parse(lines[0]).hasOldMarkers).toBe(false);
    expect(JSON.parse(lines[2])).toMatchObject({ leg: 'check', session: 's-1', run: 1 });
    // close ran for every leg (git before the report, R-BTN-83); a done end writes no hand-off.
    expect(lines.filter((l) => l.startsWith('close '))).toEqual(['close build', 'close check', 'close merge']);
    expect(lines.some((l) => l.startsWith('handoff'))).toBe(false);
    expect(home.markers()).toHaveLength(3);
  }, 30_000);

  // R-BTN-109 (B-3, baton#69 round 2): a result's outputs travel on the advance and the done end;
  // an arrival without its station's entry outputs is given up contract-output.
  const ENTRY = { ...relay, stations: { ...relay.stations, built: { ...relay.stations.built, entry: [{ output: 'artifact', schema: 'std:url@1' }] } } };
  const ARTIFACT = `[{ name: 'artifact', schema: 'std:url@1', value: { url: 'https://example.test/a' } }]`;

  it('a result\'s outputs reach Baton and meet the station\'s entry', async () => {
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(ENTRY, null, 2)}\n`);
    home.leg('build', `return { reached: 'built', next: 'check', outputs: ${ARTIFACT} };`);
    home.leg('check', `return { reached: 'checked', next: 'merge' };`);
    home.leg('merge', `return { reached: 'merged' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, undefined, { course: ENTRY });
    expect(await makeRunner().runOnce()).toMatchObject({ ticket: 'docs:T-1', end_reason: 'done', reached: 'merged' });
  }, 30_000);

  it('an arrival without its entry outputs is given up: released cannot-finish:contract-output', async () => {
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(ENTRY, null, 2)}\n`);
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, undefined, { course: ENTRY });
    expect(await makeRunner().runOnce()).toMatchObject({ ticket: 'docs:T-1', end_reason: 'released:cannot-finish:contract-output' });
    expect(await rows('SELECT status, end_reason FROM claims')).toEqual([{ status: 'released', end_reason: 'released:cannot-finish:contract-output' }]);
  }, 30_000);

  it('an advance refused for another reason suspends with the outputs, meeting the entry (3-r3-2)', async () => {
    // check may not be taken by the key that built: the runner's advance into it is refused,
    // rule chain, and it suspends at built — an arrival carrying build's outputs.
    const CHAINED = { ...ENTRY, legs: { ...ENTRY.legs, check: { ...ENTRY.legs.check, no_chain_from: ['build'] } } };
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(CHAINED, null, 2)}\n`);
    home.leg('build', `return { reached: 'built', next: 'check', outputs: ${ARTIFACT} };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, undefined, { course: CHAINED });
    expect(await makeRunner().runOnce()).toMatchObject({ ticket: 'docs:T-1', end_reason: 'suspended:built', reached: 'built' });
    expect(await rows('SELECT status, end_reason FROM claims')).toEqual([{ status: 'completed', end_reason: 'suspended:built' }]);
  }, 30_000);

  it('a done end whose outputs fail its arrival is given up the same way', async () => {
    const END = { ...relay, stations: { ...relay.stations, merged: { ...relay.stations.merged, entry: [{ output: 'artifact', schema: 'std:url@1' }] } } };
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(END, null, 2)}\n`);
    home.leg('merge', `return { reached: 'merged', outputs: [{ name: 'artifact', schema: 'std:url@1', value: { url: 'not a url' } }] };`);
    home.commit();
    await home.post({ 'T-1': placed('checked', [['build', 'built'], ['check', 'checked']], [['merge', 'ready']]) }, undefined, { course: END });
    expect(await makeRunner().runOnce()).toMatchObject({ ticket: 'docs:T-1', end_reason: 'released:cannot-finish:contract-output' });
  }, 30_000);

  it('holds the claim through a short ci wait and goes on when it clears', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.leg('check', `return { reached: 'checked', next: 'merge' };`);
    home.leg('merge', `return { reached: 'merged' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    // The heartbeat is the only thing that moves a claim's sky while the runner waits. It starts
    // before the claim, as `work()` starts it (round 5, finding 2: `tick` awaits the beat in
    // flight, so the boot beat registers and settles before the claim goes out).
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'build'`));
    // While build runs, the snapshot moves: the ticket is built and check waits on ci — the
    // advance into check then reads the wait, deterministically.
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'waiting', 'ci']]) });
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'check'`));
    // The claim is held through the wait — check started only when the wait cleared? No: the
    // advance started check, the wait governs running it. The claim stays active meanwhile.
    expect(await rows('SELECT status FROM claims')).toEqual([{ status: 'active' }]);
    expect(await rows('SELECT leg, started_at FROM claim_legs')).toHaveLength(2);
    // The wait clears (R-BTN-40's re-read at each heartbeat) and the leg runs to the end.
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    expect(await done).toMatchObject({ end_reason: 'done', reached: 'merged' });
    expect(await rows('SELECT leg FROM claim_legs ORDER BY seq')).toEqual([{ leg: 'build' }, { leg: 'check' }, { leg: 'merge' }]);
  }, 30_000);

  it('a short wait that never clears suspends after 30 minutes', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    // The heartbeat starts before the claim (see the short-wait test above).
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'build'`));
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'waiting', 'ci']]) });
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'check'`));
    await new Promise((r) => setTimeout(r, 120));
    expect(await rows('SELECT status FROM claims')).toEqual([{ status: 'active' }]); // still waiting
    clock.now = T0 + 31 * 60_000; // the budget is spent (R-BTN-40)
    expect(await done).toMatchObject({ end_reason: 'suspended:built', reached: 'built' });
    expect(await rows('SELECT end_reason, status FROM claims')).toEqual([{ end_reason: 'suspended:built', status: 'completed' }]);
    // The waiting leg was started then given up at its from; the end names it queued again.
    expect(await rows('SELECT leg, to_station, abandoned_at IS NOT NULL AS gone FROM claim_legs')).toEqual([
      { leg: 'build', to_station: 'built', gone: 0 },
      { leg: 'check', to_station: null, gone: 1 },
    ]);
    expect(home.evidence().at(-1)).toMatch(/^handoff build/);
  }, 30_000);

  it('a release that lands during the short wait is honoured, not dropped', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.leg('check', `return { reached: 'checked', next: 'merge' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => rows('SELECT 1 FROM claims'));
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'waiting', 'ci']]) });
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'check'`)); // the wait holds
    const worker = (await rows<{ id: number }>('SELECT id FROM workers ORDER BY id DESC LIMIT 1'))[0].id;
    const send = await ownerCall('/v1/ui/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ kind: 'release', to_worker_id: worker, payload: { ticket_id: 'docs:T-1', reason: 'requested' } }) });
    expect(send.status).toBe(200);
    // No leg was running when the release landed — the claim still ends released, never
    // suspended, and the message is acked because it was acted on.
    expect(await done).toMatchObject({ end_reason: 'released:requested', reached: 'built' });
    expect(await rows('SELECT end_reason FROM claims')).toEqual([{ end_reason: 'released:requested' }]);
    await until(() => rows(`SELECT 1 FROM messages WHERE status = 'acknowledged'`));
    expect(home.evidence().at(-1)).toMatch(/^handoff build/); // the leg that ran writes it
  }, 30_000);

  it('a home with no .baton/baton.json serves its single course directory (docs today)', async () => {
    home.leg('check', `return { suspend: true, reached: 'checked' };`);
    rmSync(join(home.dir, '.baton', 'baton.json'));
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ end_reason: 'suspended:checked' }); // ran, not stale-board
    expect(await rows('SELECT end_reason FROM claims')).toEqual([{ end_reason: 'suspended:checked' }]);
  }, 30_000);

  it('a lease lost during the short wait stops it at once, no hand-off', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    // The heartbeat starts before the claim (see the short-wait test above).
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'build'`));
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'waiting', 'ci']]) });
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'check'`));
    // The lease goes while the wait holds it: no waiting out the 30 minutes, no hand-off.
    const claim = (await rows<{ id: number }>('SELECT id FROM claims'))[0].id;
    const reap = await ownerCall(`/v1/ui/claims/${claim}/reap`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ confirm: true }) });
    expect(reap.status).toBe(200);
    expect(await done).toMatchObject({ end_reason: 'released:lease-lost', reached: 'built' });
    expect(home.evidence().some((l) => l.startsWith('handoff'))).toBe(false);
  }, 30_000);

  it('a snapshot the checkout lacks is fetched once, and the claim runs (R-BTN-34)', async () => {
    // The runner's home is a clone of the course-only root: the legs commit the claim is
    // decided on does not exist in it yet, so the one bounded fetch must bring it.
    home.commit(); // the course-only root, before any legs
    const clone = mkdtempSync(join(tmpdir(), 'baton-clone-'));
    execFileSync('git', ['clone', '-q', home.dir, clone], { stdio: 'ignore' });
    // A fresh clone carries no identity of its own (CI has no global one), and the stub's
    // close commits from the leg's checkout.
    execFileSync('git', ['-C', clone, 'config', 'user.email', 'relay@test']);
    execFileSync('git', ['-C', clone, 'config', 'user.name', 'relay test']);
    const fetched: string[] = [];
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.leg('check', `return { suspend: true, reached: 'checked' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const runner = makeRunner({ home: clone, fetch: (h: string) => {
      fetched.push(h);
      execFileSync('git', ['-C', h, 'fetch', '-q', 'origin', 'main'], { stdio: 'ignore' });
    } } as Record<string, unknown>);
    const out = await runner.runOnce();
    expect(out).toMatchObject({ ticket: 'docs:T-1', end_reason: 'suspended:checked' }); // ran, not stale-board
    expect(fetched).toEqual([clone]); // one bounded fetch
    expect(await rows('SELECT end_reason FROM claims')).toEqual([{ end_reason: 'suspended:checked' }]);
    rmSync(clone, { recursive: true, force: true });
  }, 30_000);

  it('a script’s own suspension rests at its outcome, close before handoff', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.leg('check', `return { suspend: true, reached: 'checked', next: 'merge' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ end_reason: 'suspended:checked', reached: 'checked', handoff: 'https://example.test/handoff/check' });
    expect(await rows('SELECT end_reason, status FROM claims')).toEqual([{ end_reason: 'suspended:checked', status: 'completed' }]);
    const lines = home.evidence();
    expect(lines.indexOf('close check')).toBeLessThan(lines.indexOf('handoff check')); // §6.13's order
    expect(home.markers().at(-1)).toMatchObject({ leg: 'check', reached: 'checked' });
  }, 30_000);

  it('a max-runs refusal suspends at the station reached, never releasing', async () => {
    // gate has run once already, as git evidences it (R-BTN-63 counts the start_path's runs).
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.leg('check', `return { reached: 'checked', next: 'gate' };`);
    home.leg('gate', `return { reached: 'adjudicated', next: 'merge' };`);
    home.leg('merge', `return { reached: 'merged' };`);
    home.leg('rework', `return { reached: 'checked', next: 'gate' };`);
    home.commit();
    const RAN: [string, string][] = [['build', 'built'], ['check', 'checked'], ['gate', 'adjudicated'], ['rework', 'checked']];
    await home.post({ 'T-1': placed('checked', RAN, [['gate', 'ready'], ['adjudicate', 'ready'], ['merge', 'waiting', 'owner']]) });
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ end_reason: 'suspended:checked', reached: 'checked' });
    expect(await rows('SELECT end_reason, status FROM claims')).toEqual([{ end_reason: 'suspended:checked', status: 'completed' }]);
    expect(await rows('SELECT leg FROM claim_legs')).toEqual([]); // the refused leg never started
  }, 30_000);

  it('a bad next suspends the leg given up at its from, reporting nothing it said', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.leg('check', `return { reached: 'checked', next: 'not-a-leg' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ end_reason: 'suspended:built', reached: 'built' });
    // No closing marker for the buggy leg (a bad pair never reaches git, R-BTN-83)…
    expect(home.markers().some((m) => m.leg === 'check')).toBe(false);
    // …and the hand-off names the fault for the next claimant.
    expect(home.evidence().at(-1)).toMatch(/^handoff check bug=/);
    expect(await rows('SELECT end_reason FROM claims')).toEqual([{ end_reason: 'suspended:built' }]);
  }, 30_000);

  it('a regressed path aborts the leg and suspends at its from', async () => {
    home.leg('check', `${ABORTABLE}
    ev(ctx, 'check aborted:' + ctx.signal.reason);
    throw new Error('aborted');`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'check'`));
    // The PR closed under the leg: git's path went backwards (§2e) — shorter than the
    // snapshot before it and the claim's start_path.
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    expect(await done).toMatchObject({ end_reason: 'suspended:built', reached: 'built' });
    expect(home.evidence().some((l) => l.includes('aborted:regressed'))).toBe(true);
    expect(home.evidence().at(-1)).toMatch(/^handoff check/);
    expect(await rows('SELECT end_reason FROM claims')).toEqual([{ end_reason: 'suspended:built' }]);
  }, 30_000);

  it('a release message aborts the leg at its next safe point and ends released:requested', async () => {
    home.leg('check', `${ABORTABLE}
    ev(ctx, 'check aborted:' + ctx.signal.reason);
    return { reached: 'checked', next: 'merge' }; // it finished its work as it stopped`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'check'`));
    const worker = (await rows<{ id: number }>('SELECT id FROM workers ORDER BY id DESC LIMIT 1'))[0].id;
    const send = await ownerCall('/v1/ui/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ kind: 'release', to_worker_id: worker, payload: { ticket_id: 'docs:T-1', reason: 'requested' } }) });
    expect(send.status).toBe(200);
    // It names that the leg reached its to — validated and closed like any result (R-BTN-83),
    // the marker before the hand-off — and releases naming a leg leaving where it rests.
    expect(await done).toMatchObject({ end_reason: 'released:requested', reached: 'checked' });
    expect(home.evidence().some((l) => l.includes('aborted:release'))).toBe(true);
    const lines = home.evidence();
    expect(lines.indexOf('close check')).toBeLessThan(lines.indexOf('handoff check'));
    expect(home.markers().at(-1)).toMatchObject({ leg: 'check', reached: 'checked' });
    expect(await rows('SELECT end_reason, status FROM claims')).toEqual([{ end_reason: 'released:requested', status: 'released' }]);
    expect((await rows<{ resume_json: string }>('SELECT resume_json FROM claims'))[0].resume_json).toMatch(/"next":"merge"/); // the script's own word (R-BTN-83)
    // The message is acknowledged once acted on (§9).
    await until(() => rows(`SELECT 1 FROM messages WHERE status = 'acknowledged'`));
  }, 30_000);

  it('a lost lease kills the leg’s whole process group with no hand-off', async () => {
    home.leg('check', `const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    ev(ctx, 'grandchild ' + child.pid);
    ${ABORTABLE}
    ev(ctx, 'check aborted:' + ctx.signal.reason);
    throw new Error('aborted');`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => (home.evidence().some((l) => l.startsWith('grandchild')) ? [1] : []));
    const pid = Number(/grandchild (\d+)/.exec(home.evidence().find((l) => l.startsWith('grandchild')) ?? '')?.[1]);
    expect(pid).toBeTruthy();
    // The lease goes: the owner reaps the claim (§6.6), so the heartbeat no longer lists it.
    const claim = (await rows<{ id: number }>('SELECT id FROM claims'))[0].id;
    const reap = await ownerCall(`/v1/ui/claims/${claim}/reap`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ confirm: true }) });
    expect(reap.status).toBe(200);
    expect(await done).toMatchObject({ end_reason: 'released:lease-lost' });
    // The grandchild died with the group, and no hand-off was written (R-BTN-24 covers it).
    expect(await untilDead(pid)).toBe(true);
    expect(home.evidence().some((l) => l.startsWith('handoff'))).toBe(false);
    // R-BTN-19: the next heartbeat reports the fence it cleared, so the ticket is re-issued
    // instead of waiting for the worker to go silent…
    await until(() => rows('SELECT 1 FROM claims WHERE fence_pending = 0'));
    // The owner's reap ended the claim first; the runner's own end was answered claim-ended and
    // the outcome stands — the ticket is re-issued, not fence-pending.
    expect((await rows<{ end_reason: string }>('SELECT end_reason FROM claims'))[0].end_reason).toBe('reaped:owner');
    // …and the lost lease belonged to that claim: the next one runs on a fresh lease.
    home.leg('check', `return { suspend: true, reached: 'checked' };`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    expect(await runner.runOnce()).toMatchObject({ end_reason: 'suspended:checked' });
    expect((await rows<{ end_reason: string }>('SELECT end_reason FROM claims ORDER BY id DESC'))[0].end_reason).toBe('suspended:checked');
  }, 60_000);

  it('a course change between two claims runs the new scripts with no restart', async () => {
    home.leg('adjudicate', `out(ctx, { leg: 'adjudicate', flavour: 'v1', run: ctx.run });
    return { suspend: true, reached: 'adjudicated' };`);
    home.leg('rework', `out(ctx, { leg: 'rework', run: ctx.run });
    return { reached: 'checked', next: 'adjudicate' };`);
    home.commit();
    const TO_CHECKED: [string, string][] = [['build', 'built'], ['check', 'checked']];
    await home.post({ 'T-1': placed('checked', TO_CHECKED, [['adjudicate', 'ready']]) });
    const runner = makeRunner();
    expect(await runner.runOnce()).toMatchObject({ end_reason: 'suspended:adjudicated' });
    expect((JSON.parse(home.evidence().find((l) => l.includes('flavour')) ?? '{}') as Record<string, unknown>).flavour).toBe('v1');
    // The course changes: adjudicate's script behaves differently, on a new head; the same
    // runner (no restart) loads the new bytes with its next claim, through rework's edge.
    home.leg('adjudicate', `out(ctx, { leg: 'adjudicate', flavour: 'v2', run: ctx.run });
    return { suspend: true, reached: 'adjudicated' };`);
    home.commit();
    await home.post({ 'T-1': placed('adjudicated', [...TO_CHECKED, ['adjudicate', 'adjudicated']], [['rework', 'ready']]) });
    expect(await runner.runOnce()).toMatchObject({ end_reason: 'suspended:adjudicated' });
    const second = JSON.parse([...home.evidence()].reverse().find((l) => l.includes('flavour')) ?? '{}') as Record<string, unknown>;
    expect(second.flavour).toBe('v2');
    // The second claim's rework ran once (run 1) and adjudicate again — run 2, the earlier
    // claim's leg counted from git (R-BTN-63).
    expect(second.run).toBe(2);
    const rework = [...home.evidence()].reverse().find((l) => l.startsWith('{') && l.includes('rework')) ?? '{}';
    expect((JSON.parse(rework) as Record<string, unknown>).run).toBe(1);
  }, 30_000);

  it('an off-graph refusal ends released:course-changed', async () => {
    home.leg('build', `await new Promise((r) => setTimeout(r, 200));
    return { reached: 'built', next: 'check' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const runner = makeRunner();
    const done = runner.runOnce();
    await until(() => rows('SELECT 1 FROM claims'));
    // The course changes under the claim: check is gone (no renamed_from — R-BTN-64's other
    // half), on a new head — the runner's claim still carries the old snapshot.
    const CHANGED = { ...relay, legs: { ...(relay.legs as Record<string, unknown>), audit: { from: ['built'], to: 'checked' } } } as Record<string, unknown>;
    delete (CHANGED.legs as Record<string, unknown>).check;
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(CHANGED, null, 2)}\n`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, undefined, { course: CHANGED });
    expect(await done).toMatchObject({ end_reason: 'released:course-changed', reached: 'built' });
    expect(await rows('SELECT end_reason, status FROM claims')).toEqual([{ end_reason: 'released:course-changed', status: 'released' }]);
  }, 30_000);

  it('a heartbeat showing station unknown ends released:course-changed at the leg’s safe point', async () => {
    home.leg('check', `${ABORTABLE}
    ev(ctx, 'check aborted:' + ctx.signal.reason);
    throw new Error('aborted');`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const runner = makeRunner();
    runner.start();
    const done = runner.runOnce();
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'check'`));
    // A file that drops the claim's station: the heartbeat says unknown (R-BTN-64), on a new head.
    const CHANGED = {
      ...relay,
      stations: { ...(relay.stations as Record<string, unknown>), assembled: { label: 'Assembled' } },
      legs: Object.fromEntries(Object.entries(relay.legs as Record<string, { from: string[]; to: string | string[] }>).map(([k, l]) => [k, { ...l, from: l.from.map((s) => (s === 'built' ? 'assembled' : s)), to: l.to === 'built' ? 'assembled' : l.to }])),
    } as Record<string, unknown>;
    delete (CHANGED.stations as Record<string, unknown>).built;
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(CHANGED, null, 2)}\n`);
    home.commit();
    await home.post({ 'T-1': placed('assembled', [], [['check', 'ready']]) }, undefined, { course: CHANGED });
    expect(await done).toMatchObject({ end_reason: 'released:course-changed' });
    expect(home.evidence().some((l) => l.includes('aborted:release'))).toBe(true); // §6.13's closed signal set
    expect(home.evidence().at(-1)).toMatch(/^handoff check/);
  }, 30_000);

  it('a script’s own release ends the claim, no evidence pointer on a released end', async () => {
    home.leg('check', `return { release: 'cannot-finish:capability', reached: 'checked', next: 'merge' };`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ end_reason: 'released:cannot-finish:capability', reached: 'checked' });
    expect(await rows('SELECT end_reason, status, ended_at_sha FROM claims')).toEqual([
      { end_reason: 'released:cannot-finish:capability', status: 'released', ended_at_sha: null },
    ]);
    // close still wrote the marker (the position is in git) before handoff; the end carries no sha.
    const lines = home.evidence();
    expect(lines.indexOf('close check')).toBeLessThan(lines.indexOf('handoff check'));
  }, 30_000);

  it('the spool: transcript pointers ride the beat, activity rows post under their own call, and a dropped request loses nothing', async () => {
    home.leg('check', `return { suspend: true, reached: 'checked' };`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const runner = makeRunner();
    await runner.tick(); // registers the worker
    const stateFile = join(tmpdir(), `baton-runner-${process.pid}-spool.json`);
    rmSync(stateFile, { force: true });
    const spooling = makeRunner({ stateFile, session: 'spool' } as Record<string, unknown>);
    await spooling.tick();
    // A leg session's records: two transcript pointers and an activity row (§6.8, §6.9).
    writeFileSync(`${stateFile}.spool.jsonl`, [
      JSON.stringify({ repo: 'immediately-run/claude-sessions', path: 'claude-code/2026-10-16-x.jsonl', role: 'subagent' }),
      JSON.stringify({ id: 'act-1', kind: 'orient', label: 'a session orienting', source: 'skill', started_at: clock.now }),
      JSON.stringify({ repo: 'immediately-run-worker/session-transcripts', path: 'host1/s.md', role: 'session' }),
      'not json at all',
    ].join('\n') + '\n');
    await spooling.tick();
    // No claim is held, so the pointers wait in pending_transcripts (§6.8) for the next claim.
    expect(await rows(`SELECT repo, path FROM pending_transcripts ORDER BY rowid`)).toEqual([
      { repo: 'immediately-run/claude-sessions', path: 'claude-code/2026-10-16-x.jsonl' },
      { repo: 'immediately-run-worker/session-transcripts', path: 'host1/s.md' },
    ]);
    expect(await rows(`SELECT kind, label FROM activities`)).toEqual([{ kind: 'orient', label: 'a session orienting' }]);
    expect(existsSync(`${stateFile}.spool.jsonl.taken`)).toBe(false); // sent: the taken file is gone
    // A dropped request: the pointers come back to the spool for the next beat.
    const api = (spooling as unknown as { o: { api: { broken: boolean } } }).o.api as unknown as { broken?: boolean } & { heartbeat: (b: unknown) => Promise<unknown> };
    const realHeartbeat = api.heartbeat.bind(api);
    let drop = true;
    (api as unknown as { heartbeat: (b: unknown) => Promise<unknown> }).heartbeat = async (b: unknown) => {
      if (drop) throw new Error('network down');
      return realHeartbeat(b);
    };
    writeFileSync(`${stateFile}.spool.jsonl`, `${JSON.stringify({ repo: 'immediately-run/claude-sessions', path: 'claude-code/2026-10-16-y.jsonl', role: 'session' })}\n`);
    await expect(spooling.tick()).rejects.toThrow(/network down/);
    expect(existsSync(`${stateFile}.spool.jsonl.taken`)).toBe(false); // nothing truncated away
    drop = false;
    await spooling.tick();
    expect(await rows(`SELECT path FROM pending_transcripts WHERE path LIKE '%y.jsonl' ORDER BY rowid`)).toEqual([{ path: 'claude-code/2026-10-16-y.jsonl' }]);
  }, 30_000);

  it('an orphaned claim is ended before the next claim, not held forever (rule 3)', async () => {
    home.leg('check', `return { suspend: true, reached: 'checked' };`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    // A first runner registers the worker, then dies with a claim live — the state file and
    // the server each hold half of it, as a killed process leaves them.
    const stateFile = join(tmpdir(), `baton-runner-${process.pid}-orphan.json`);
    rmSync(stateFile, { force: true });
    const first = makeRunner({ stateFile, session: 'orphan' } as Record<string, unknown>);
    await first.tick();
    const workerId = (await rows<{ id: number }>('SELECT id FROM workers'))[0].id;
    await rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, station, start_path, course_id)
                 VALUES ('docs:T-1', ?, 'seed:orphan', 'orphan1', '', ?, 'active', 'built', '[]', 'relay')`, workerId, clock.now);
    const orphan = (await rows<{ id: number }>('SELECT id FROM claims'))[0].id;
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    state.claim = { id: orphan, ticket_id: 'docs:T-1', nonce: 'orphan1' };
    writeFileSync(stateFile, JSON.stringify(state));
    // The next process over that state file ends the orphan before claiming.
    const runner = makeRunner({ stateFile, session: 'orphan' } as Record<string, unknown>);
    // The orphan ends; the ticket becomes claimable again only after a reading follows the end
    // (§6.7) — the next idle attempt sees it, once the board refreshes.
    expect(await runner.runOnce()).toBeNull();
    // The orphan's lease-lost counts as a failed attempt (§6.10): the backoff passes, then a
    // reading makes the ticket claimable again.
    await setClock(clock.now + 2 * 60 * 60_000);
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const out = await runner.runOnce();
    expect(out).toMatchObject({ end_reason: 'suspended:checked' });
    expect(await rows<{ id: number; end_reason: string }>('SELECT id, end_reason FROM claims ORDER BY id')).toEqual([
      { id: orphan, end_reason: 'released:lease-lost' },
      expect.objectContaining({ end_reason: 'suspended:checked' }),
    ]);
  }, 30_000);

  it('a reaped worker re-keys on its next beat and carries on (R-BTN-14)', async () => {
    home.leg('check', `return { suspend: true, reached: 'checked' };`);
    home.commit();
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    const runner = makeRunner();
    await runner.tick();
    const stateFile = (runner as unknown as { o: { stateFile: string } }).o.stateFile;
    const before = JSON.parse(readFileSync(stateFile, 'utf8')) as { secret: string };
    await rows(`UPDATE workers SET reaped_at = ?`, clock.now); // the alarm's verdict arrived
    await runner.tick(); // the beat that learns it and parks the re-key
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).lease_lost).toBe(true);
    await runner.tick(); // the beat that re-keys
    expect(await rows(`SELECT reaped_at FROM workers`)).toEqual([{ reaped_at: null }]); // a new incarnation
    const after = JSON.parse(readFileSync(stateFile, 'utf8')) as { secret: string; incarnation: number };
    expect(after.secret).not.toBe(before.secret);
    expect(after.incarnation).toBe(2);
    expect(await runner.runOnce()).toMatchObject({ end_reason: 'suspended:checked' }); // serving again
  }, 30_000);

  it('a leg session never claims: the runner refuses to nest under BATON_PARENT', async () => {
    // Through the real CLI entry (the bundle `baton run` runs), as a leg session would.
    const r = spawnSync(process.execPath, [resolve('cli/baton.mjs'), 'run'], {
      cwd: resolve('.'),
      env: { ...process.env, BATON_PARENT: '7' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/BATON_PARENT=7: a leg session never claims/);
    // B-97: the transition's spelling is not read — a hermetic HOME keeps it from parsing a real
    // settings file, and with no credential it stops there instead of refusing to nest.
    const legacy = spawnSync(process.execPath, [resolve('cli/baton.mjs'), 'run'], {
      cwd: resolve('.'),
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('BATON_'))), HOME: mkdtempSync(join(tmpdir(), 'baton-legacy-')), IR_BATON_PARENT: '7' },
      encoding: 'utf8',
    });
    expect(legacy.stderr).not.toMatch(/a leg session never claims/);
    expect(legacy.stderr).toMatch(/no credential: BATON_KEY_FILE, BATON_KEY or BATON_TOKEN/);
  }, 60_000);

  it('the state file carries the runner across a restart: the same worker, not a second one', async () => {
    home.leg('build', `return { suspend: true, reached: 'built' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const stateFile = join(tmpdir(), `baton-runner-${process.pid}-restart.json`);
    rmSync(stateFile, { force: true });
    const first = makeRunner({ stateFile, session: 'restart' } as Record<string, unknown>);
    expect(await first.runOnce()).toMatchObject({ end_reason: 'suspended:built' });
    first.stop();
    // A second runner over the same state file: its heartbeat authenticates as the worker the
    // first registered — the secret and the worker id are what survived (§6.4).
    const second = makeRunner({ stateFile, session: 'restart' } as Record<string, unknown>);
    await second.tick();
    expect(await rows('SELECT count(*) AS n FROM workers')).toEqual([{ n: 1 }]);
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).worker_id).toBe(1);
  }, 30_000);

  it('nothing to claim: one idle attempt, no claim row', async () => {
    home.commit();
    await home.post({});
    expect(await makeRunner().runOnce()).toBeNull();
    expect(await rows('SELECT * FROM claims')).toEqual([]);
  }, 30_000);

  // B-86: the heartbeat's declaration defaults to the grant's — `--capabilities` narrows, never
  // enables — so a granted machine serves what its grant already says. This scenario's Baton
  // grants nothing (its fleet beats under bearer tokens, whose reach is their own), so these
  // tests answer the beat as the granted server would — `grant` and nothing else. The route from
  // a grant to that answer is the core's (a unit test of `WorkerApi`); what is exercised here is
  // the runner's — declare, then claim — end to end. The needs are real ones: the course file's
  // (`legNeeds`, over the home checkout `runMain` wires it to) and the ticket's `Requires:` clause
  // (`requires: ['create-pr']`, the ticket-clause input of gates.ts's rule 4).
  const GRANTED = ['agent-venue', 'create-pr', 'drivable-browser', 'llm-call'];
  function asGranted(runner: Runner): Runner {
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    api.heartbeat = async (body: Record<string, unknown>) => {
      // Every answer is the granted Baton's: the grant its courses' repositories give it.
      return { ...await beat.call(api, body), grant: { capabilities: GRANTED } };
    };
    return runner;
  }
  /** What a granted Baton's runner does: declare the server-side rows of each beat it sends, then
   *  claim. The writes mirror `rewriteSettings`, so a claim's rule 4 reads the declaration the
   *  server last recorded — the runner's real path, not the test's convenience. */
  function recording(runner: Runner): { beats: string[][] } {
    const seen = { beats: [] as string[][] };
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    api.heartbeat = async (body: Record<string, unknown>) => {
      const answer = await beat.call(api, body) as Record<string, any>;
      const declaring = (body.capabilities ?? []) as string[];
      seen.beats.push(declaring);
      if (typeof answer.worker_id === 'number') {
        await rows('DELETE FROM worker_capabilities WHERE worker_id = ?', answer.worker_id);
        const stored = new Set<string>();
        for (const name of declaring) {
          for (const cap of capabilitiesOf([name])) if (!stored.has(cap)) { stored.add(cap); await rows('INSERT INTO worker_capabilities (worker_id, capability, declared) VALUES (?, ?, ?)', answer.worker_id, cap, name); }
          if (name === 'human-operator' && !stored.has(name)) { stored.add(name); await rows('INSERT INTO worker_capabilities (worker_id, capability, declared) VALUES (?, ?, ?)', answer.worker_id, name, name); }
        }
      }
      return answer;
    };
    return seen;
  }

  it('a granted worker with no --capabilities declares the grant and claims a create-pr leg (exit criterion 1)', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    // The ticket's clause: relay's build leg requires create-pr (rule 4's ticket-clause input,
    // gates.ts:129-133) — the declaration must carry it or the claim is refused.
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, [ticket('T-1', { course_id: 'relay', requires: ['create-pr'] })]);
    const lines: string[] = [];
    const needs = legNeeds(home.dir, readHead(home.dir), 'relay');
    expect(needs).toEqual(['create-pr']); // the course file the core accepts carries the leg's need
    const runner = asGranted(makeRunner({ log: (l: string) => lines.push(l), legNeeds: () => needs }));
    const seen = recording(runner);
    expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:T-1' });
    // The claim went out on the settled declaration, never on the registration's `[]` (finding 2):
    // the last beat before it carried what the server then had.
    // Finding 1 (round 4): the answer's names are declared exactly — the granted key's answer is
    // its expanded capabilities, so that is the list, verbatim.
    expect(seen.beats.at(-1)).toEqual(['agent-venue', 'create-pr', 'drivable-browser', 'llm-call']);
    const [worker] = await rows<{ id: number }>('SELECT id FROM workers');
    expect((await rows<{ declared: string }>('SELECT DISTINCT declared FROM worker_capabilities WHERE worker_id = ? ORDER BY declared', worker.id)).map((r) => r.declared)).toEqual(['agent-venue']);
    // Through the role the server stores as its capabilities (§4): `authentication` and the rest.
    expect((await rows<{ capability: string }>('SELECT capability FROM worker_capabilities WHERE worker_id = ? ORDER BY capability', worker.id)).map((r) => r.capability)).toEqual(['authentication', 'create-pr', 'drivable-browser', 'llm-call']);
    // The declaration is the grant's role, said once, and the leg requiring create-pr runs:
    // before the fix `--capabilities` defaulted to agent-venue, which happened to pass this
    // clause — the narrowing tests below are where the default's absence matters.
    expect(await rows(`SELECT leg FROM claim_legs WHERE leg = 'build'`)).toHaveLength(1);
    const said = lines.join('\n');
    expect(said).toContain("baton: declaring agent-venue, create-pr, drivable-browser, llm-call — the grant's capabilities, no --capabilities given");
    expect(said).not.toContain('can never claim');
    const stateFile = (runner as unknown as { o: { stateFile: string } }).o.stateFile;
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).declared).toEqual(['agent-venue', 'create-pr', 'drivable-browser', 'llm-call']);
    expect(lines.filter((l) => l.includes('baton: declaring'))).toHaveLength(1);
  }, 30_000);

  it('work() starts the heartbeat before it claims: the first claim\'s beats carried the settled declaration (round 5, finding 2)', async () => {
    home.leg('build', `return { suspend: true, reached: 'built' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, [ticket('T-1', { course_id: 'relay', requires: ['create-pr'] })]);
    const needs = legNeeds(home.dir, readHead(home.dir), 'relay');
    const runner = asGranted(makeRunner({ legNeeds: () => needs }));
    const seen = recording(runner);
    // The server's own record at the moment of the claim, read by the gate: `rewriteSettings`
    // writes `worker_capabilities` per answered beat, so this is what rule 4 saw — never the
    // client's word about what it sent.
    let atClaim: { declared: string; capabilities: string }[] | null = null;
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const claim = api.claim;
    api.claim = async (body: Record<string, unknown>) => {
      const worker = (await rows<{ id: number }>('SELECT id FROM workers ORDER BY id DESC LIMIT 1'))[0];
      atClaim = worker
        ? await rows<{ declared: string; capabilities: string }>(`SELECT DISTINCT declared, (SELECT group_concat(capability) FROM (SELECT capability FROM worker_capabilities c WHERE c.worker_id = worker_capabilities.worker_id ORDER BY capability)) AS capabilities
                                                                   FROM worker_capabilities WHERE worker_id = ?`, worker.id)
        : [];
      return claim.call(api, body);
    };
    // `work()` is the production path: it starts the sidecar and claims at once. Before round
    // five's fix the boot beat was still in flight, `tick` returned on its guard, and the first
    // claims went out while the server recorded `null` and then `[]`.
    const running = runner.work();
    await until(() => rows(`SELECT 1 FROM claim_legs WHERE leg = 'build'`));
    runner.stop();
    await running;
    // The boot beat asks with nothing (the grant is unknown: `runner.ts`'s `declaring`), the next
    // carries the grant — and the claim went out only after that one had landed, so the server
    // held the grant's list when rule 4 judged it. Before the fix the claim went out on the boot
    // beat's `[]` (and, on a restart from a pre-B-86 state file, on `null`).
    expect(seen.beats.at(-1)).toEqual(['agent-venue', 'create-pr', 'drivable-browser', 'llm-call']);
    // The claim never went out on the unsettled starts: no beat before the last was all this
    // runner could claim on (`[]` or `null`), and exactly one settled beat precedes the claim.
    expect(seen.beats.filter((b) => !b.length)).toHaveLength(1);
    expect(atClaim).toEqual([{ declared: 'agent-venue', capabilities: 'authentication,create-pr,drivable-browser,llm-call' }]);
    expect(await rows(`SELECT leg FROM claim_legs WHERE leg = 'build'`)).toHaveLength(1);
  }, 30_000);

  it('an answer carrying a bare role declares it verbatim — the answer is the grant (round 4, finding 1)', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    // A bearer or seed key's answer is its literal allow-list (`credentialAllowed`), which may
    // name a role as the role — `testCourse.ts`'s `allowed_capabilities: ['agent-venue']`. The
    // heartbeat admits such a name by that name. The ticket's clause names a capability of the
    // role, so rule 4 must find it through the role the runner declares.
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, [ticket('T-1', { course_id: 'relay', requires: ['llm-call'] })]);
    const runner = asGranted(makeRunner());
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    api.heartbeat = async (body: Record<string, unknown>) => ({ ...await beat.call(api, body) as Record<string, unknown>, grant: { capabilities: ['agent-venue', 'llm-call'] } });
    const seen = recording(runner);
    expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:T-1' });
    // Before the fix the role was dropped for its one named capability: a declaration narrower
    // than the allow-list the key holds.
    expect(seen.beats.at(-1)).toEqual(['agent-venue', 'llm-call']);
    const [worker] = await rows<{ id: number }>('SELECT id FROM workers');
    expect((await rows<{ capability: string }>('SELECT capability FROM worker_capabilities WHERE worker_id = ? ORDER BY capability', worker.id)).map((r) => r.capability))
      .toEqual(['authentication', 'create-pr', 'drivable-browser', 'llm-call']);
    expect(await rows(`SELECT leg FROM claim_legs WHERE leg = 'build'`)).toHaveLength(1);
  }, 30_000);

  it('a narrower --capabilities llm-call does not claim the create-pr leg and says why at startup (exit criterion 2)', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    // A claimable ticket sits there from the start: the attempt that cannot take it still beats
    // (the declaration settles on its first answer) and says what it lacks — the startup line.
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, [ticket('T-1', { course_id: 'relay', requires: ['create-pr'] })]);
    const lines: string[] = [];
    const needs = legNeeds(home.dir, readHead(home.dir), 'relay');
    const runner = asGranted(makeRunner({ capabilities: ['llm-call'], log: (l: string) => lines.push(l), legNeeds: () => needs }));
    recording(runner);
    // Rule 4 refuses the create-pr leg, so the attempt idles with no claim.
    expect(await runner.runOnce()).toBeNull();
    expect(await rows('SELECT * FROM claims')).toEqual([]);
    expect(lines.join('\n')).toContain('baton: declaring llm-call (--capabilities — it narrows what the grant allows, never enables what the grant does not)');
    expect(lines.join('\n')).toContain('baton: this runner declared llm-call, which lacks create-pr — a leg requiring it refuses rule 4 (missing-capability), so this runner can never claim one');
    // Said once, not on every beat.
    await runner.tick();
    expect(lines.filter((l) => l.includes('which lacks create-pr'))).toHaveLength(1);
    // Finding 10: a restart over the same state file and session keeps the settled declaration —
    // it is not declared again (no per-answer settle), and the startup line is said once, as a
    // startup line is, not on every beat.
    const stateFile = (runner as unknown as { o: { stateFile: string } }).o.stateFile;
    const session = (runner as unknown as { o: { session: string } }).o.session;
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).declared).toEqual(['llm-call']);
    const restarted: string[] = [];
    asGranted(makeRunner({ stateFile, session, capabilities: ['llm-call'], log: (l: string) => restarted.push(l), legNeeds: () => needs }));
    await runners.at(-1)!.tick();
    await runners.at(-1)!.tick();
    expect(restarted.join('\n')).not.toContain('baton: declaring');
    expect(restarted.filter((l) => l.includes('which lacks create-pr'))).toHaveLength(1);
  }, 30_000);

  it('a ticket with no Requires clause is still claimable by a declaration that settled at nothing (finding 5)', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    // Relay's start leg requires create-pr (R-BTN-120): a grant of nothing never claims it, but a
    // course whose start leg requires nothing claims on an empty declaration all the same — rule
    // 4 reads the leg's own requires (round 4, finding 2), so this leg drops it.
    const open = JSON.parse(JSON.stringify(relay)) as Record<string, any>;
    delete open.legs.build.requires;
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(open, null, 2)}\n`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, undefined, { course: open }); // requires: []
    const lines: string[] = [];
    const needs = legNeeds(home.dir, readHead(home.dir), 'relay');
    const runner = asGranted(makeRunner({ log: (l: string) => lines.push(l), ...(needs.length ? {} : { legNeeds: () => [] }) }));
    recording(runner);
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    api.heartbeat = async (body: Record<string, unknown>) => ({ ...await beat.call(api, body) as Record<string, unknown>, grant: { capabilities: [] } });
    expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:T-1' });
    expect(lines.join('\n')).toContain("declared nothing — its key's grant allows no capability");
    // Said once across idle attempts, and no never-eligible line: no leg names a capability.
    await runner.tick();
    expect(lines.filter((l) => l.includes('declared nothing —'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('can never claim');
  }, 30_000);

  it('an answer carrying no grant settles nothing: the declaration stays, the next beat asks again (finding 6)', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const lines: string[] = [];
    const runner = makeRunner({ log: (l: string) => lines.push(l) });
    // The first answer is a seed key's: no `grant` at all — not a grant of nothing.
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    let first = true;
    const seen: string[][] = [];
    api.heartbeat = async (body: Record<string, unknown>) => {
      const answer = await beat.call(api, body) as Record<string, any>;
      seen.push((body.capabilities ?? []) as string[]);
      if (!first) return answer;
      first = false;
      const { grant: _grant, ...rest } = answer;
      return rest;
    };
    expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:T-1' });
    // Two beats before the claim: the grant-less one, then the one that carried the grant.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    const said = lines.filter((l) => l.includes('answered no grant'));
    expect(said).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('its key\'s grant allows no capability');
  }, 30_000);

  it('a granted key whose grant allows nothing is told so at startup rather than idling silently', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    // As above: the leg requires nothing, so an empty declaration claims it.
    const open = JSON.parse(JSON.stringify(relay)) as Record<string, any>;
    delete open.legs.build.requires;
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(open, null, 2)}\n`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, undefined, { course: open });
    const lines: string[] = [];
    const runner = asGranted(makeRunner({ log: (l: string) => lines.push(l) }));
    // Registers (declaring nothing); every answer after it carries an empty grant — the key granted
    // on none of the repositories its course is in — so the declaration settles at nothing.
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    api.heartbeat = async (body: Record<string, unknown>) => ({ ...(await beat.call(api, body) as Record<string, unknown>), grant: { capabilities: [] } });
    // Finding 5: an empty declaration still claims — the ticket names no capability, so rule 4
    // passes anything — and the line says what the grant allows, once, not per attempt.
    expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:T-1' });
    expect(lines.join('\n')).toContain("baton: this runner declared nothing — its key's grant allows no capability on the repositories its courses are in");
    await runner.tick();
    expect(lines.filter((l) => l.includes('declared nothing —'))).toHaveLength(1);
  }, 30_000);

  it('a grant narrowed under a no-flag runner: the refused beat re-asks with no declaration, and the next answer re-settles it (round 4, finding 3)', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    // The start leg requires nothing, so the claim turns on the declaration alone: the first
    // claim is on the grant as it stands, and after the narrowing it is on what is left.
    const open = JSON.parse(JSON.stringify(relay)) as Record<string, any>;
    delete open.legs.build.requires;
    home.write('.baton/courses/relay/course.json', `${JSON.stringify(open, null, 2)}\n`);
    home.commit();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) }, [ticket('T-1', { course_id: 'relay' })], { course: open });
    const lines: string[] = [];
    const runner = asGranted(makeRunner({ log: (l: string) => lines.push(l) }));
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    // The owner's grant, as the answer carries it — replaced mid-run with a narrower one
    // (`admin.ts`'s upsert replaces the list; the answer is the grant's capabilities).
    let grant = ['agent-venue', 'create-pr', 'drivable-browser', 'llm-call'];
    api.heartbeat = async (body: Record<string, unknown>) => ({ ...await beat.call(api, body) as Record<string, unknown>, grant: { capabilities: grant } });
    const seen = recording(runner);
    // The first claim is on the grant it was answered: the declared list, served as it stood.
    expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:T-1' });
    const stateFile = (runner as unknown as { o: { stateFile: string } }).o.stateFile;
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).declared).toEqual(['agent-venue', 'create-pr', 'drivable-browser', 'llm-call']);
    // The owner narrows the grant: llm-call is gone, so the stale declaration is refused.
    grant = ['agent-venue', 'create-pr', 'drivable-browser'];
    api.heartbeat = async (body: Record<string, unknown>) => {
      // The heartbeat's own check, refused exactly as the server would (workerApi.ts).
      const declaring = (body.capabilities ?? []) as string[];
      if (declaring.some((c) => !grant.includes(c))) throw new BatonRefusal('forbidden', undefined, `this credential may not declare ${declaring.filter((c) => !grant.includes(c)).join(', ')}`, 403);
      return { ...await beat.call(api, body) as Record<string, unknown>, grant: { capabilities: grant } };
    };
    await runner.tick();
    // The declaration is dropped, in memory and in the state file, and said once — with the
    // server's own message, which names the cause (round 5, finding 4: a wrong hostname, a revoked
    // key and a grant that moved are all `forbidden`, and only the message tells them apart).
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).declared).toBeNull();
    expect(lines.filter((l) => l.includes('the heartbeat was refused (forbidden)'))).toHaveLength(1);
    expect(lines.join('\n')).toContain('baton: the heartbeat was refused (forbidden): this credential may not declare llm-call — asking again with no declaration');
    // The next beat asks with no declaration (the refused beat above carried the stale list
    // from before this answer settled it) and re-settles from the narrowed grant.
    await runner.tick();
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).declared).toEqual(['agent-venue', 'create-pr', 'drivable-browser']);
    expect(lines.join('\n')).toContain("baton: declaring agent-venue, create-pr, drivable-browser — the grant's capabilities, no --capabilities given");
    // It claims what it still may: the ticket's clause is create-pr, which the narrowed grant keeps.
    // The first claim has no check script, so it ended (released, never done) and is queued at its
    // start again — a sync since that end (§6.7), then the claim.
    await setClock(clock.now + 2 * 60 * 60_000);
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    const again = await runner.runOnce();
    expect(again).toMatchObject({ ticket: 'docs:T-1' });
    // One claim: the earlier claims above are this file's other tests' (the core is shared by a
    // test file, and reset per test by the host).
    expect((await rows<{ leg: string }>(`SELECT leg FROM claim_legs WHERE leg = 'build'`)).length).toBeGreaterThanOrEqual(1);
    // And a restart never replays the stale list: the state file holds the settled one.
    const session = (runner as unknown as { o: { session: string } }).o.session;
    const restarted: string[] = [];
    asGranted(makeRunner({ stateFile, session, log: (l: string) => restarted.push(l) }));
    await runners.at(-1)!.tick();
    expect(seen.beats.length).toBeGreaterThan(0);
    expect(restarted.join('\n')).not.toContain('grant moved under this runner');
  }, 30_000);

  it('a narrowing past every capability the legs need re-settles at nothing and says it, rather than beating forever refused', async () => {
    home.leg('build', `return { reached: 'built', next: 'check' };`);
    home.commit();
    const lines: string[] = [];
    const needs = legNeeds(home.dir, readHead(home.dir), 'relay');
    expect(needs).toEqual(['create-pr']); // relay's start leg needs it, whatever the clause says
    const runner = asGranted(makeRunner({ log: (l: string) => lines.push(l), legNeeds: () => needs }));
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    // A grant of create-pr: the leg's own need is met, and a ticket naming no clause is claimed.
    let grant = ['create-pr'];
    api.heartbeat = async (body: Record<string, unknown>) => ({
      ...await beat.call(api, body) as Record<string, unknown>,
      grant: { capabilities: (body.capabilities ?? []).length ? grant : ['create-pr'] },
    });
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    expect(await runner.runOnce()).toMatchObject({ ticket: 'docs:T-1' });
    // The owner takes create-pr away: the declaration the runner holds is refused, it asks again
    // with none, and the answer carries nothing the leg needs — said, once, never a wedge. The
    // ticket needs no reading of its own: its leg alone rules a declaration without create-pr out.
    grant = [];
    api.heartbeat = async (body: Record<string, unknown>) => {
      const declaring = (body.capabilities ?? []) as string[];
      if (declaring.some((c) => !grant.includes(c))) throw new BatonRefusal('forbidden', undefined, 'this credential may not declare ' + declaring.join(', '), 403);
      return { ...await beat.call(api, body) as Record<string, unknown>, grant: { capabilities: grant } };
    };
    await runner.tick();
    const second = await runner.runOnce();
    const said = lines.join('\n');
    expect(second).toBeNull();
    // Round 5, finding 4: the line says the heartbeat was refused and names the server's reason.
    expect(said).toContain('baton: the heartbeat was refused (forbidden): this credential may not declare ');
    expect(said).toContain('which lacks create-pr');
    expect(said).toContain('declared nothing');
    expect(await rows('SELECT * FROM claims WHERE status = ?', 'active')).toEqual([]);
    // Said once across attempts, not per beat.
    await runner.tick();
    expect(lines.filter((l) => l.includes('the heartbeat was refused (forbidden)'))).toHaveLength(1);
  }, 30_000);

  it('an unblocked message is acknowledged, so it is not delivered with every beat (R-BTN-77)', async () => {
    home.leg('build', `return { reached: 'built' };`);
    home.commit();
    await home.post({});
    const runner = makeRunner();
    await runner.tick();
    const [{ id: worker }] = await rows<{ id: number }>('SELECT id FROM workers');
    await rows(`INSERT INTO messages (kind, payload_json, from_principal, to_worker_id, sent_at, status) VALUES ('unblocked', '{"tickets":[]}', 'baton', ?, ?, 'pending')`, worker, T0);
    await runner.tick(); // delivered, and acknowledged at once: the runner holds no claim
    expect(await rows(`SELECT status FROM messages WHERE kind = 'unblocked'`)).toEqual([{ status: 'acknowledged' }]);
  }, 30_000);
});
