// S-BTN-242 a runner's local queue (BATON_SPEC §15 S-BTN-242, §8.3 R-BTN-202; B-248). Must hold:
// with Baton answering errors, a runner with nothing queued stays idle and runs nothing; an order
// the host's user adds (`baton queue add`) then runs its leg without a claim, saying that nothing
// guarantees another runner is not working the same leg; when Baton answers again the runner
// claims the ticket as usual, and the leg Baton offers — the same one, from the same station — is
// reported from the kept result, never run twice, its finishing advance carrying the order's
// provenance on its `advanced` event and the course going on as usual; an offer of another leg
// runs that leg and reports nothing of the offline one; with Baton up, an order goes first,
// through the ordinary claim, and a refusal drops it; an order waits while no claim answer has
// said the repository requires no owner-signed control. Node only: it spawns the legs' child
// processes and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BatonApi } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { LocalQueue, queueMain, queuePath } from '../../src/runner/queue';
import { checkAdvance, checkEnd } from '../../src/core/validate';
import { call as hostCall } from '#host';
import { course, cutover, placed, rows, setClock, syncCall, ticket, TOKENS } from '../helpers';
import relay from '../fixtures/courses/relay/course.json';

const T0 = Date.parse('2026-11-19T12:00:00Z');

/** A leg script whose run is the body given; `close` commits a record (the evidence) — reading
 *  `ctx.claim?.nonce`, null when the leg ran under a local order. */
function legFile(run: string): string {
  return `import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const at = (ctx, name) => [ctx.checkout, '.baton', name].join('/');
const ev = (ctx, line) => appendFileSync(at(ctx, 'evidence.jsonl'), line + '\\n');
const git = (ctx, ...a) => execFileSync('git', ['-C', ctx.checkout, ...a], { encoding: 'utf8' }).trim();
export async function run(ctx) {
  ev(ctx, 'run ' + ctx.leg + ' station=' + (ctx.claim?.station ?? '?') + ' claim=' + (ctx.claim?.nonce ?? 'none') + ' order=' + (ctx.local_order?.by ?? 'none'));
${run}
}
export async function close(ctx, result) {
  appendFileSync(at(ctx, 'closes.jsonl'), JSON.stringify({ leg: ctx.leg, claim: ctx.claim?.nonce ?? null }) + '\\n');
  git(ctx, 'add', '.baton/closes.jsonl');
  git(ctx, 'commit', '--allow-empty', '--no-gpg-sign', '-q', '-m', 'baton:close ' + ctx.leg);
  ev(ctx, 'close ' + ctx.leg);
  return git(ctx, 'rev-parse', 'HEAD');
}
export async function handoff(ctx) {
  ev(ctx, 'handoff ' + ctx.leg);
  return 'https://example.test/handoff/' + ctx.leg;
}
`;
}

class Home {
  readonly dir: string;
  head: string | null = null;
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'baton-home-242-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { stdio: 'ignore' });
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
  leg(name: string, run: string): void {
    this.write(`.baton/courses/relay/legs/${name}.mjs`, legFile(run));
  }
  sha(): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  commit(): string {
    execFileSync('git', ['-C', this.dir, 'add', '.baton'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--no-gpg-sign', '-q', '-m', 'legs'], { stdio: 'ignore' });
    return this.sha();
  }
  async post(stations: Record<string, unknown>, tickets: unknown[] = [ticket('T-1', { course_id: 'relay' })]): Promise<void> {
    const sha = this.sha();
    const res = await syncCall('/v1/sync/board', {
      registry: [course(3, 3, { id: 'relay', course: relay as unknown as Record<string, unknown> })],
      sha, parent_sha: this.head, tickets, closed: [], stations,
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
let scratch: string;
let queue: LocalQueue;
let n = 0;
/** Whether this test's Baton answers: while down, every call is answered 500 — the 2026-11-19
 *  outage's shape (a Durable Object over its daily write quota). */
let down = false;
const lines: string[] = [];
const runners: Runner[] = [];

function makeRunner(): Runner {
  const api = new BatonApi({
    url: 'https://baton.test',
    transport: (req) => down
      ? Promise.resolve(new Response(JSON.stringify({ code: 'internal', message: 'internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }))
      : hostCall(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) }),
  });
  const runner = new Runner({
    api, home: home.dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
    session: `runner-242-${++n}`, courses: [{ course: 'relay', version: 3 }],
    stateFile: join(scratch, `state-${n}.json`), beatEvery: 40,
    // The runner's own wall clock: its idle wait counts beats on it.
    now: () => Date.now(), log: (l) => lines.push(l), queue,
  });
  runners.push(runner);
  return runner;
}

async function until(q: () => boolean): Promise<void> {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (q()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition never became true in 20 s');
}

const legs = () => {
  home.leg('build', `return { reached: 'built', next: 'check' };`);
  home.leg('check', `return { reached: 'checked', next: 'merge' };`);
  home.leg('merge', `return { reached: 'merged' };`);
  home.commit();
};

beforeEach(async () => {
  await setClock(T0);
  home = new Home();
  scratch = mkdtempSync(join(tmpdir(), 'baton-242-'));
  queue = new LocalQueue(queuePath(scratch, home.dir));
  down = false;
  lines.length = 0;
  await cutover();
});

afterEach(async () => {
  for (const r of runners.splice(0)) r.stop();
  rmSync(home.dir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('S-BTN-242 a runner\'s local queue', () => {
  it('Baton down: idle with nothing queued, then an order runs offline with the warning, and on recovery its result is reported once, gated as usual', async () => {
    legs();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    // A claim answer said, before the outage, that the repository requires no signed control.
    queue.setControlRequired(false);
    down = true;
    const runner = makeRunner();
    const working = runner.work();
    // Idle: the loop fails on Baton's errors and runs nothing.
    await until(() => lines.filter((l) => l.includes('the loop failed')).length >= 3);
    expect(home.evidence()).toEqual([]);
    // The host's user orders T-1's build.
    queue.add('docs:T-1', 'build', 'tester@host', T0);
    await until(() => queue.read().worked.length === 1);
    runner.stop();
    await working;
    expect(home.evidence()).toEqual(['run build station=filed claim=none order=tester@host', 'close build']);
    expect(lines.some((l) => l.includes('WITHOUT A CLAIM') && l.includes('docs:T-1'))).toBe(true);
    expect(lines.some((l) => l.includes('WARNING: nothing guarantees that another runner is not executing docs:T-1\'s build'))).toBe(true);
    expect(queue.read()).toMatchObject({ orders: [], worked: [{ ticket_id: 'docs:T-1', leg: 'build', at: 'filed', by: 'tester@host' }] });
    expect(await rows('SELECT COUNT(*) AS n FROM claims')).toEqual([{ n: 0 }]);

    // Baton answers again: an ordinary claim, the build reported from the kept result (not run
    // again), and the course goes on — check and merge run as usual.
    down = false;
    lines.length = 0;
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ ticket: 'docs:T-1', end_reason: 'done', reached: 'merged' });
    expect(home.evidence().filter((l) => l.startsWith('run build'))).toHaveLength(1);
    expect(home.evidence().filter((l) => l.startsWith('close build'))).toHaveLength(1);
    expect(await rows('SELECT leg, to_station FROM claim_legs ORDER BY seq')).toEqual([
      { leg: 'build', to_station: 'built' },
      { leg: 'check', to_station: 'checked' },
      { leg: 'merge', to_station: 'merged' },
    ]);
    // The advance that finished build carries the order's provenance on its event; no other does.
    const events = (await rows<{ ticket_id: string; detail_json: string }>(`SELECT ticket_id, detail_json FROM events WHERE kind IN ('advanced', 'completed', 'released') ORDER BY seq`))
      .map((e) => JSON.parse(e.detail_json) as { local_order?: unknown }).filter((d) => d.local_order);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reached: 'built', local_order: { leg: 'build', by: 'tester@host' } });
    expect(queue.read().worked).toEqual([]);
  }, 60_000);

  it('Baton offers another leg on recovery: that leg runs, and nothing of the offline one is reported', async () => {
    legs();
    // Meanwhile another runner took the ticket on to built: Baton offers check, not build.
    await home.post({ 'T-1': placed('built', [['build', 'built']], [['check', 'ready']]) });
    queue.update((q) => { q.worked = [{ ticket_id: 'docs:T-1', leg: 'build', at: 'filed', result: { reached: 'built', next: 'check' }, closed: null, by: 'tester@host', ran_at: '2026-11-19T11:00:00.000Z' }]; });
    const out = await makeRunner().runOnce();
    expect(out).toMatchObject({ ticket: 'docs:T-1', end_reason: 'done', reached: 'merged' });
    expect(lines.some((l) => l.includes('the offline result is not reported'))).toBe(true);
    expect(home.evidence().filter((l) => l.startsWith('run '))).toEqual([
      expect.stringMatching(/^run check station=built claim=\S+ order=none$/),
      expect.stringMatching(/^run merge /),
    ]);
    expect(await rows(`SELECT COUNT(*) AS n FROM events WHERE detail_json LIKE '%local_order%'`)).toEqual([{ n: 0 }]);
  }, 60_000);

  it('Baton up: an order goes first, through the ordinary claim; a refused one is dropped and runs nothing', async () => {
    legs();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]), 'T-2': placed('filed', [], [['build', 'ready']]) },
      [ticket('T-1', { course_id: 'relay' }), ticket('T-2', { course_id: 'relay' })]);
    // An order for a ticket the board does not hold: Baton refuses the claim, the order goes.
    queue.add('docs:T-9', null, 'tester@host', T0);
    expect(await makeRunner().runOnce()).toBeNull();
    expect(lines.some((l) => l.includes('Baton refused the claim on ordered docs:T-9') && l.includes('dropped'))).toBe(true);
    expect(queue.read().orders).toEqual([]);
    expect(home.evidence()).toEqual([]);
    // An order for T-2: claimed by name, ahead of whatever Baton would choose first.
    queue.add('docs:T-2', null, 'tester@host', T0);
    expect(await makeRunner().runOnce()).toMatchObject({ ticket: 'docs:T-2', end_reason: 'done' });
    expect(lines.some((l) => l.includes('claimed docs:T-2 under tester@host\'s order'))).toBe(true);
    expect(queue.read().orders).toEqual([]);
    // No local order ran offline, so none is recorded as one.
    expect(await rows(`SELECT COUNT(*) AS n FROM events WHERE detail_json LIKE '%local_order%'`)).toEqual([{ n: 0 }]);
  }, 60_000);

  it('an order waits while no claim answer has said the repository requires no owner-signed control', async () => {
    legs();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    down = true;
    queue.add('docs:T-1', 'build', 'tester@host', T0);
    const runner = makeRunner();
    const working = runner.work();
    await until(() => lines.some((l) => l.includes('the order for docs:T-1 waits for Baton') && l.includes('owner-signed control')));
    await until(() => lines.filter((l) => l.includes('the loop failed')).length >= 3);
    runner.stop();
    await working;
    // Said once, not on every retry; nothing ran.
    expect(lines.filter((l) => l.includes('the order for docs:T-1 waits for Baton'))).toHaveLength(1);
    expect(home.evidence()).toEqual([]);
    expect(queue.read().orders).toHaveLength(1);
  }, 60_000);

  it('offline, an order naming no leg waits, said once; without Baton nothing says which leg', async () => {
    legs();
    await home.post({ 'T-1': placed('filed', [], [['build', 'ready']]) });
    queue.setControlRequired(false);
    down = true;
    queue.add('docs:T-1', null, 'tester@host', T0);
    const runner = makeRunner();
    const working = runner.work();
    await until(() => lines.some((l) => l.includes('the order for docs:T-1 waits for Baton') && l.includes('queue it as docs:T-1@<leg>')));
    await until(() => lines.filter((l) => l.includes('the loop failed')).length >= 3);
    runner.stop();
    await working;
    expect(lines.filter((l) => l.includes('the order for docs:T-1 waits for Baton'))).toHaveLength(1);
    expect(home.evidence()).toEqual([]);
    expect(queue.read().orders).toHaveLength(1);
  }, 60_000);
});

describe('S-BTN-242 the queue command and the provenance\'s shape', () => {
  it('baton queue add, list and remove work on the home\'s queue file, refusing an unqualified id', () => {
    const out: string[] = [];
    const say = (l: string) => out.push(l);
    expect(queueMain(['add', 'docs:T-1@build', '--home', home.dir], scratch, (h) => h, say)).toBe(0);
    expect(queue.read().orders).toMatchObject([{ ticket_id: 'docs:T-1', leg: 'build' }]);
    expect(queueMain(['list', '--home', home.dir], scratch, (h) => h, say)).toBe(0);
    expect(out.some((l) => /^order\s+docs:T-1@build {2}by \S+@\S+ at /.test(l))).toBe(true);
    expect(queueMain(['add', 'T-1', '--home', home.dir], scratch, (h) => h, say)).toBe(1);
    expect(queueMain(['remove', 'docs:T-1', '--home', home.dir], scratch, (h) => h, say)).toBe(0);
    expect(queue.read().orders).toEqual([]);
  });

  it('an advance or end carries local_order as {by, ran_at} or not at all', () => {
    const ok = { by: 'neumark@bering', ran_at: '2026-11-19T18:30:00.000Z' };
    expect(checkAdvance({ leg: 'check', reached: 'built', local_order: ok }).local_order).toEqual(ok);
    expect(checkEnd({ end_reason: 'done', reached: 'merged', local_order: ok }).local_order).toEqual(ok);
    expect(checkAdvance({ leg: 'check' }).local_order).toBeNull();
    expect(() => checkAdvance({ leg: 'check', local_order: { by: 'a b', ran_at: ok.ran_at } })).toThrow(/local_order\.by/);
    expect(() => checkAdvance({ leg: 'check', local_order: { by: ok.by, ran_at: 'yesterday' } })).toThrow(/local_order\.ran_at/);
    expect(() => checkEnd({ end_reason: 'done', local_order: 'me' })).toThrow(/local_order/);
  });
});
