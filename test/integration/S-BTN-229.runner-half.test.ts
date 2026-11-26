// S-BTN-229 several claims per runner (B-188), the runner half (BATON_SPEC §8.3 R-BTN-72, §9.1
// R-BTN-4, §9.2 R-BTN-6, §8.1's heartbeat), Node only: it spawns legs and runs git. A runner
// declaring `concurrency` 2, granted `max_claims` 2, holds two claims and runs their legs side by
// side, each in a clone of the home of its own; a claim whose leg waits holds only its own place;
// a release message for one ticket stops that claim alone; a claim Baton no longer lists (a
// force-reap) is fenced alone and reported in `fenced`; the runner's lost lease stops every claim;
// a restart within the lease ends a claim its executor cannot reattach to
// `released:cannot-finish:transient`, and reattaches through an executor that can. A runner at
// the default 1 is the rest of the runner suites, unchanged. The server half is
// S-BTN-229.several-claims.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BatonApi } from '../../src/runner/api';
import { callChannel, channelPath } from '../../src/runner/channel';
import { Runner } from '../../src/runner/runner';
import { builtinExecutor, type Executor, type Handle } from '../../src/runner/executor';
import { call as hostCall } from '#host';
import { course, cutover, ORIGIN, ownerCall, placed, rows, setClock, syncCall, ticket, TOKENS } from '../helpers';
import relay from '../fixtures/courses/relay/course.json';

const T0 = Date.parse('2026-11-17T12:00:00Z');

/** The `check` leg: it says where it runs, then waits for its gate file (or a release), and
 *  suspends at `checked`. Its lines go to one log outside every checkout, since each claim works
 *  in a clone of its own. */
function checkLeg(log: string, gates: string): string {
  return `import { appendFileSync, existsSync } from 'node:fs';
const note = (o) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(o) + '\\n');
export async function run(ctx) {
  note({ ev: 'start', ticket: ctx.ticket.id, checkout: ctx.checkout });
  await new Promise((resolve) => {
    const t = setInterval(() => {
      if (ctx.signal.aborted || existsSync(${JSON.stringify(gates)} + '/' + ctx.ticket.id)) { clearInterval(t); resolve(); }
    }, 10);
  });
  note({ ev: 'end', ticket: ctx.ticket.id, aborted: ctx.signal.aborted });
  return { suspend: true, reached: 'checked' };
}
export async function close(ctx) { note({ ev: 'close', ticket: ctx.ticket.id }); return null; }
export async function handoff(ctx) { note({ ev: 'handoff', ticket: ctx.ticket.id }); return 'https://example.test/handoff/' + ctx.leg; }
`;
}

let dir: string;
let homeDir: string;
let head: string | null;
let log: string;
let gates: string;
let n = 0;
const clock = { now: T0 };
const runners: Runner[] = [];
/** Baton out of reach: every runner call fails, as a dropped network does. */
let down = false;
/** A beat held after Baton answered it and before the runner reads the answer: `caught` counts
 *  the beats waiting on `held`. */
let held: Promise<void> | null = null;
let caught = 0;

function writeHome(): string {
  homeDir = join(dir, 'home');
  mkdirSync(homeDir, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-C', homeDir, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(homeDir, path)), { recursive: true });
    writeFileSync(join(homeDir, path), text);
  };
  write('.baton/courses/relay/course.json', `${JSON.stringify(relay, null, 2)}\n`);
  write('.baton/baton.json', `${JSON.stringify({ course: 'relay', skills_version: 3 }, null, 2)}\n`);
  write('.baton/courses/relay/legs/check.mjs', checkLeg(log, gates));
  g('add', '-A');
  g('-c', 'user.email=b188@test', '-c', 'user.name=b188 test', 'commit', '--no-gpg-sign', '-qm', 'courses');
  return g('rev-parse', 'HEAD').trim();
}

async function post(ids: string[]): Promise<void> {
  const sha = execFileSync('git', ['-C', homeDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const res = await syncCall('/v1/sync/board', {
    registry: [course(3, 3, { id: 'relay', course: relay as unknown as Record<string, unknown> })],
    sha, parent_sha: head, tickets: ids.map((id) => ticket(id, { course_id: 'relay' })), closed: [],
    stations: Object.fromEntries(ids.map((id) => [id, placed('built', [['build', 'built']], [['check', 'ready']])])),
  });
  if (res.status !== 200) throw new Error(`board post: ${res.status} ${await res.text()}`);
  head = sha;
}

function makeRunner(over: Record<string, unknown> = {}, beats?: Record<string, any>[]): Runner {
  const api = new BatonApi({
    url: 'https://baton.test',
    transport: async (req) => {
      if (down) throw new Error('the network is down');
      const beat = new URL(req.url).pathname === '/v1/runner/heartbeat';
      if (beats && beat) beats.push(await req.clone().json() as Record<string, any>);
      const res = await hostCall(req);
      if (beat && held) {
        caught++;
        await held;
      }
      return res;
    },
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) }),
  });
  const r = new Runner({
    api, home: homeDir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
    session: `b188-${++n}`, courses: [{ course: 'relay', version: 3 }],
    stateFile: join(dir, 'state', `b188-${n}.json`), clonesDir: join(dir, 'clones'),
    beatEvery: 60, now: () => clock.now, log: () => {}, signalGraceMs: 500,
    ...over,
  });
  runners.push(r);
  return r;
}

/** The owner's grant on docs for the runner's key, with `max_claims` (R-BTN-4): the runner's
 *  first beats register it, then the key is bound as `owner grant add --max-claims` binds it. */
async function grant(r: Runner, maxClaims: number): Promise<void> {
  await r.tick();
  await r.tick();
  const [{ id, credential_id }] = await rows<{ id: number; credential_id: string }>('SELECT id, credential_id FROM runners');
  const caps = (await rows<{ capability: string }>('SELECT capability FROM runner_capabilities WHERE runner_id = ?', id)).map((x) => x.capability);
  await rows(`UPDATE credentials SET created_by = 'owner:owner@example.com' WHERE id = ?`, credential_id);
  await rows(`INSERT INTO runner_grants (credential_id, repository_id, capabilities, max_tier, max_claims, granted_by, granted_at)
              VALUES (?, 'docs', ?, NULL, ?, 'owner:owner@example.com', 0)`, credential_id, JSON.stringify(caps), maxClaims);
  await r.tick();
}

const said = (): { ev: string; ticket: string; checkout?: string; aborted?: boolean }[] =>
  (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

async function until<T>(q: () => Promise<T> | T, ok: (v: T) => boolean, what: string): Promise<T> {
  const end = Date.now() + 30_000;
  for (;;) {
    const v = await q();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`never: ${what}`);
    await new Promise((res) => setTimeout(res, 20));
  }
}

const claimRows = () => rows<{ id: number; ticket_id: string; status: string; end_reason: string | null; fence_pending: number }>(
  'SELECT id, ticket_id, status, end_reason, fence_pending FROM claims ORDER BY id');
const owner = (path: string, body: unknown) =>
  ownerCall(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body) });
const gate = (id: string) => writeFileSync(join(gates, id), '');

beforeEach(async () => {
  clock.now = T0;
  down = false;
  held = null;
  caught = 0;
  await setClock(T0);
  dir = mkdtempSync(join(tmpdir(), 'baton-229-'));
  log = join(dir, 'legs.jsonl');
  gates = join(dir, 'gates');
  mkdirSync(gates, { recursive: true });
  head = null;
  writeHome();
  await cutover();
});

afterEach(() => {
  for (const r of runners.splice(0)) {
    r.drain('test end');
    r.killInflight();
    r.stop();
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('S-BTN-229 (the runner half): a runner holds several claims (R-BTN-4, R-BTN-72)', () => {
  it('concurrency 2 holds two claims, runs their legs side by side, each in its own clone; a waiting claim holds only its own place; a release stops one claim alone', async () => {
    await post(['T-1', 'T-2', 'T-3']);
    const beats: Record<string, any>[] = [];
    const r = makeRunner({ concurrency: 2 }, beats);
    await grant(r, 2);
    const working = r.work();

    // Two legs start, side by side, before either ends — and no third claim is taken.
    const starts = await until(() => said().filter((x) => x.ev === 'start'), (v) => v.length === 2, 'two legs running');
    expect(new Set(starts.map((x) => x.ticket)).size).toBe(2);
    expect((await claimRows()).filter((c) => c.status === 'active')).toHaveLength(2);
    // R-BTN-4: every beat declares the runner's concurrency.
    expect(beats.at(-1)).toMatchObject({ concurrency: 2 });

    // R-BTN-72: each claim in a clone of its own — its own git directory, never the home's, never
    // a worktree sharing one.
    const [a, b] = starts.map((x) => resolve(x.checkout!));
    expect(a).not.toBe(b);
    for (const co of [a, b]) {
      expect(co).not.toBe(resolve(homeDir));
      expect(co.startsWith(resolve(join(dir, 'clones')))).toBe(true);
      expect(existsSync(join(co, '.git', 'HEAD'))).toBe(true); // a git dir of its own, not a worktree's `.git` file
      expect(execFileSync('git', ['-C', co, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(head);
    }

    // The state file names both claims, `claim` the oldest (R-BTN-72; the hooks read it).
    const stateFile = (r as unknown as { o: { stateFile: string } }).o.stateFile;
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { claims: { id: number; ticket_id: string }[]; claim: { id: number } };
    expect(state.claims.map((c) => c.ticket_id).sort()).toEqual(starts.map((x) => x.ticket).sort());
    expect(state.claim.id).toBe(Math.min(...state.claims.map((c) => c.id)));

    // A release message for one ticket stops that claim alone (R-BTN-119), with its hand-off.
    const [first, second] = starts.map((x) => x.ticket);
    const [{ id: runner }] = await rows<{ id: number }>('SELECT id FROM runners');
    expect((await owner('/v1/ui/messages', { kind: 'release', confirm: true, to_runner_id: runner, payload: { ticket_id: first, reason: 'requested' } })).status).toBe(200);
    await until(claimRows, (v) => v.some((c) => c.ticket_id === first && c.end_reason === 'released:requested'), 'the released claim ends');
    expect(said()).toContainEqual({ ev: 'end', ticket: first, aborted: true });
    expect(said()).toContainEqual({ ev: 'handoff', ticket: first });
    // The other leg still runs; its claim is still held — and the runner, with room again,
    // claims the third ticket beside it.
    expect(said().some((x) => x.ev === 'end' && x.ticket === second)).toBe(false);
    expect((await claimRows()).find((c) => c.ticket_id === second)?.status).toBe('active');
    const third = await until(() => said().filter((x) => x.ev === 'start' && x.ticket === 'docs:T-3'), (v) => v.length === 1, 'the third claim starts');
    // The third claim reuses the clone the released one gave back.
    expect(resolve(third[0].checkout!)).toBe(resolve(starts.find((x) => x.ticket === first)!.checkout!));

    // Each claim's leg ends at its own gate: the second suspends while the third runs on.
    gate(second);
    await until(claimRows, (v) => v.some((c) => c.ticket_id === second && c.end_reason === 'suspended:checked'), 'the second claim suspends');
    expect((await claimRows()).find((c) => c.ticket_id === 'docs:T-3')?.status).toBe('active');
    gate('docs:T-3');
    await until(claimRows, (v) => v.some((c) => c.ticket_id === 'docs:T-3' && c.end_reason === 'suspended:checked'), 'the third claim suspends');
    r.drain('test');
    await working;
  }, 120_000);

  it('a claim Baton no longer lists is fenced alone and reported in fenced; the lost lease stops every claim', async () => {
    await post(['T-1', 'T-2']);
    const beats: Record<string, any>[] = [];
    const r = makeRunner({ concurrency: 2}, beats);
    await grant(r, 2);
    const working = r.work();
    const starts = await until(() => said().filter((x) => x.ev === 'start'), (v) => v.length === 2, 'two legs running');
    const claims = await claimRows();
    const reaped = claims.find((c) => c.ticket_id === starts[0].ticket)!;
    const other = claims.find((c) => c.ticket_id === starts[1].ticket)!;

    // An administrator's force-reap of one claim: the answer stops listing it, so that leg stops
    // at once with no hand-off, the fence is reported (R-BTN-19), and the other claim runs on.
    expect((await owner(`/v1/ui/claims/${reaped.id}/reap`, { confirm: true })).status).toBe(200);
    await until(claimRows, (v) => v.find((c) => c.id === reaped.id)?.fence_pending === 0, 'the fence is reported');
    expect(beats.some((b) => Array.isArray(b.fenced) && b.fenced.some((f: { claim_id: number }) => f.claim_id === reaped.id))).toBe(true);
    expect(said().some((x) => x.ev === 'handoff' && x.ticket === reaped.ticket_id)).toBe(false);
    expect((await claimRows()).find((c) => c.id === other.id)?.status).toBe('active');
    expect(said().some((x) => x.ev === 'end' && x.ticket === other.ticket_id)).toBe(false);
    const stateFile = (r as unknown as { o: { stateFile: string } }).o.stateFile;
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).lease_lost).toBe(false); // the runner's lease holds

    // Baton goes out of reach and the runner's own lease lapses by its wall clock (R-BTN-26):
    // every claim it holds stops at once, no hand-off.
    // A beat Baton answered before the outage, read by the runner only after its clock moved,
    // renews the lease from when it left — never from when it was read, which would hold the
    // lease (and this leg) for as long as the outage lasts.
    r.drain('test'); // no new claim after it
    let read!: () => void;
    held = new Promise<void>((res) => { read = res; });
    await until(() => caught, (v) => v > 0, 'a beat answered and not yet read');
    down = true;
    clock.now = T0 + 20 * 60_000;
    read();
    await working;
    expect(said().some((x) => x.ev === 'handoff' && x.ticket === other.ticket_id)).toBe(false);
    expect(said().some((x) => x.ev === 'end' && x.ticket === other.ticket_id)).toBe(false); // killed, never returned
    expect(JSON.parse(readFileSync(stateFile, 'utf8')).claims).toEqual([]);
  }, 120_000);

  it('a restart within the lease ends a claim its executor cannot reattach to cannot-finish:transient, and reattaches through one that can', async () => {
    await post(['T-1', 'T-2']);
    const first = makeRunner({ concurrency: 2 });
    await grant(first, 2);
    const [{ id: runner }] = await rows<{ id: number }>('SELECT id FROM runners');
    const stateFile = (first as unknown as { o: { stateFile: string } }).o.stateFile;
    const session = (first as unknown as { o: { session: string } }).o.session;
    first.stop();
    // The two claims the first process held when it died mid-leg, as its state file left them:
    // each with its run, its executor's handle and its leg's place.
    const seed = async (id: string, request: string) => {
      await rows(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, station, start_path, course_id)
                   VALUES (?, ?, ?, ?, ?, ?, 'active', 'built', '[]', 'relay')`, id, runner, request, `n-${request}`, head, clock.now);
      const claimId = (await rows<{ id: number }>('SELECT id FROM claims WHERE request_id = ?', request))[0].id;
      // Its first leg advanced into and running, as the first process's advance left it.
      await rows(`UPDATE claims SET leg = 'check' WHERE id = ?`, claimId);
      await rows(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, started_at, started_observation) VALUES (?, 1, 'check', 'built', ?, 0)`, claimId, clock.now);
      return claimId;
    };
    const one = await seed('docs:T-1', 'run-one-0001');
    const place = (id: number, ticketId: string, request: string) => ({
      id, ticket_id: ticketId, nonce: `n-${request}`, request_id: request, checkout: homeDir,
      run_id: null, seq: null, leg: 'check', at: 'built', handle: { session_id: `s-${request}` },
      ctx: { ticket: { id: ticketId }, claim: { id, nonce: `n-${request}`, station: 'built' }, leg: 'check', run: 1, checkout: homeDir, snapshot: { sha: head, path: [{ leg: 'build', reached: 'built' }], next: [] } },
    });
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    writeFileSync(stateFile, JSON.stringify({ ...state, claims: [place(one, 'docs:T-1', 'run-one-0001')], claim: { id: one, ticket_id: 'docs:T-1', nonce: 'n-run-one-0001' }, last_ok: clock.now }));

    // `builtin` offers no reattach: the restarted runner — its secret resumed, no re-key — ends
    // the claim cannot-finish:transient and says why.
    // The ticket the ended claim frees may be claimed again by the restarted runner: its leg
    // goes straight through.
    gate('docs:T-1');
    gate('docs:T-2');
    const lines: string[] = [];
    const restarted = makeRunner({ session, stateFile, concurrency: 2, log: (l: string) => lines.push(l) });
    await restarted.runOnce();
    expect((await claimRows()).find((c) => c.id === one)).toMatchObject({ status: 'released', end_reason: 'released:cannot-finish:transient' });
    expect(lines.some((l) => l.includes(`claim ${one} on docs:T-1`) && l.includes('cannot be reattached') && l.includes('offers no reattach'))).toBe(true);
    expect(await rows('SELECT reaped_at FROM runners')).toEqual([{ reaped_at: null }]);
    restarted.stop();

    // An executor that can reattach: the session is found again, its result is the leg's, and
    // the claim carries on to its end — the close and hand-off of a suspension, as any leg's.
    const base = builtinExecutor();
    const reattached: Record<string, unknown>[] = [];
    const reattaching: Executor = {
      ...base,
      start: base.start.bind(base), exec: base.exec.bind(base), stop: base.stop.bind(base), salvage: base.salvage.bind(base),
      async reattach(saved) {
        reattached.push(saved);
        // The session found again: calls run in it as in any session of this executor.
        const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));
        const h = await base.start({ brief: { kind: 'leg', session_id: String(saved.session_id), checkout: homeDir, paths: [], wrapper: '', env } });
        return { ...h, reattached: true } as Handle;
      },
      async end(h) {
        if (h.reattached) {
          const socket = channelPath(stateFile, h.session_id);
          expect(await callChannel(socket, { op: 'status' })).toMatchObject({ ok: true, leg: 'check', station: 'built' });
          expect(await callChannel(socket, { op: 'suspend', reached: 'checked' })).toEqual({ ok: true });
          return { status: 'ended', result: (await h.posted!).result };
        }
        return base.end(h);
      },
    };
    const two = await seed('docs:T-2', 'run-two-0002');
    const again = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    writeFileSync(stateFile, JSON.stringify({ ...again, claims: [place(two, 'docs:T-2', 'run-two-0002')], claim: { id: two, ticket_id: 'docs:T-2', nonce: 'n-run-two-0002' }, last_ok: clock.now, lease_lost: false }));
    const resumed = makeRunner({ session, stateFile, concurrency: 1, executor: reattaching, log: (l: string) => lines.push(l) });
    const out = await resumed.runOnce();
    expect(reattached).toEqual([{ session_id: 's-run-two-0002' }]);
    expect(out).toMatchObject({ ticket: 'docs:T-2', end_reason: 'suspended:checked' });
    expect((await claimRows()).find((c) => c.id === two)).toMatchObject({ end_reason: 'suspended:checked' });
    expect(said()).toContainEqual({ ev: 'close', ticket: 'docs:T-2' });
    expect(lines.some((l) => l.includes(`reattached to claim ${two} on docs:T-2`))).toBe(true);
  }, 120_000);

  it('a runner at the default 1 works its one claim in the home checkout, its beats keeping the one-claim shapes beside the new', async () => {
    await post(['T-1']);
    gate('docs:T-1');
    const beats: Record<string, any>[] = [];
    const r = makeRunner({}, beats);
    expect(await r.runOnce()).toMatchObject({ ticket: 'docs:T-1', end_reason: 'suspended:checked' });
    expect(resolve(said().find((x) => x.ev === 'start')!.checkout!)).toBe(resolve(homeDir));
    expect(existsSync(join(dir, 'clones'))).toBe(false);
    expect(beats.every((b) => b.concurrency === 1)).toBe(true);
    // R-BTN-90: the finished run on both shapes — the bare one a Baton before B-188 reads.
    const finished = beats.find((b) => b.leg_finished !== undefined)!;
    expect(finished.legs_finished).toEqual([{ claim_id: expect.any(Number), seq: finished.leg_finished }]);
  }, 60_000);

  it('a claim Baton lists that the runner does not hold is ended released:lease-lost, and said', async () => {
    await post(['T-1']);
    const lines: string[] = [];
    const r = makeRunner({ concurrency: 2, log: (l: string) => lines.push(l) });
    await grant(r, 2);
    const [{ id: runner }] = await rows<{ id: number }>('SELECT id FROM runners');
    await rows(`INSERT INTO claims (ticket_id, runner_id, request_id, nonce, snapshot_sha, claimed_at, status, station, start_path, course_id)
                 VALUES ('docs:T-1', ?, 'stray', 'n-stray', ?, ?, 'active', 'built', '[]', 'relay')`, runner, head, clock.now);
    await r.tick();
    expect((await claimRows())[0]).toMatchObject({ status: 'released', end_reason: 'released:lease-lost' });
    expect(lines.some((l) => l.includes('which this runner does not hold'))).toBe(true);
  }, 60_000);
});
