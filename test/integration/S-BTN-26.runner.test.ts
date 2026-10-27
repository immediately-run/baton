// S-BTN-26's runner half (BATON_SPEC §15, §6.13 R-BTN-72, §6.2; B-103): one runner, one checkout
// declaring two courses, serves either. Must hold: with no `--course` the runner declares both
// courses in its heartbeat (`courses: [{repository, course, version}, …]`, rule 9 per course);
// it is offered and CLAIMS a leg of either course — two consecutive claims, one per course, the
// second after the first's ticket has moved on; each claim's course is the answer's `course_id`,
// loaded from that claim's snapshot (so each course's own leg script runs); and `--course <id>`
// narrows the declaration to that one course alone. Node only: it runs git and spawns the legs'
// child processes (the S-BTN-41 pattern), so it sits in `NODE_ONLY` beside S-BTN-41; the
// registry half of the scenario stays on both hosts in S-BTN-26.two-repositories.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BatonApi } from '../../src/runner/api';
import { Runner } from '../../src/runner/runner';
import { declareCourses, servedCourses } from '../../src/runner/main';
import { capabilitiesOf } from '../../src/shared/vocabulary.mjs';
import { call as hostCall } from '#host';
import { course, cutover, placed, rows, setClock, syncCall, ticket, TOKENS } from '../helpers';
import roadmapPr from '../fixtures/courses/roadmap-pr/course.json';
import chore from '../fixtures/courses/chore/course.json';

const T0 = Date.parse('2026-10-20T12:00:00Z');

/** One leg script: the body given; `close` commits a closing marker and returns the commit (the
 *  position is in git before it is reported, R-BTN-83). Each line it writes lands in the home's
 *  `.baton/evidence.jsonl` — which course's script ran, and for which claim. */
const legFile = (run: string): string => `import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const f = (ctx) => [ctx.checkout, '.baton', 'evidence.jsonl'].join('/');
const out = (ctx, o) => { const was = existsSync(f(ctx)) ? readFileSync(f(ctx), 'utf8') : ''; writeFileSync(f(ctx), was + JSON.stringify(o) + '\\n'); };
const git = (ctx, ...a) => execFileSync('git', ['-C', ctx.checkout, ...a], { encoding: 'utf8' }).trim();
export async function run(ctx) {
${run}
}
export async function close(ctx, result) {
  appendFileSync([ctx.checkout, '.baton', 'markers.jsonl'].join('/'), JSON.stringify({ leg: ctx.leg, ...(result && result.reached ? { reached: result.reached } : {}), claim: ctx.claim.nonce }) + '\\n');
  git(ctx, 'add', '.baton/markers.jsonl');
  git(ctx, 'commit', '--allow-empty', '--no-gpg-sign', '-m', 'baton:close ' + ctx.leg);
  return git(ctx, 'rev-parse', 'HEAD');
}
`;

/** The home checkout: a real git repository carrying two courses — the board's `roadmap-pr` and
 *  `chore` — each with its own leg scripts, and a `.baton/baton.json` declaring both (B-103). */
class Home {
  readonly dir: string;
  head: string | null = null;
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'baton-s26-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'b103@test');
    g('config', 'user.name', 'b103 test');
    this.write('.baton/courses/roadmap-pr/course.json', `${JSON.stringify(roadmapPr, null, 2)}\n`);
    this.write('.baton/courses/chore/course.json', `${JSON.stringify(chore, null, 2)}\n`);
    this.write('.baton/baton.json', `${JSON.stringify({ courses: [{ id: 'roadmap-pr', version: 3 }, { id: 'chore', version: 3 }] }, null, 2)}\n`);
  }
  write(path: string, text: string): void {
    const file = join(this.dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  /** A leg of one course: `run` is the body, and the evidence line names the course it belonged
   *  to (`ctx.course` is the loaded course, so a wrong load shows up as the wrong name). */
  leg(course: string, name: string, run: string): void {
    this.write(`.baton/courses/${course}/legs/${name}.mjs`, legFile(`out(ctx, { course: ctx.course ?? '${course}', leg: '${name}', ticket: ctx.ticket.id, run: ctx.run });
${run}`));
  }
  sha(): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  commit(): string {
    execFileSync('git', ['-C', this.dir, 'add', '.baton'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--no-gpg-sign', '-q', '-m', 'courses'], { stdio: 'ignore' });
    return this.sha();
  }
  /** Post the board: the home's head, its two-course registry, and the tickets given. */
  async post(tickets: unknown[], stations: Record<string, unknown>): Promise<void> {
    const sha = this.sha();
    const res = await syncCall('/v1/sync/board', {
      registry: [course(3, 3, { id: 'roadmap-pr', course: roadmapPr as unknown as Record<string, unknown> }),
        course(3, 3, { id: 'chore', skill: 'run-chore', course: chore as unknown as Record<string, unknown> })],
      sha, parent_sha: this.head, tickets, closed: [], stations,
    });
    if (res.status !== 200) throw new Error(`board post: ${res.status} ${await res.text()}`);
    this.head = sha;
  }
  evidence(): { course: string; leg: string; ticket: string; run: number }[] {
    const file = join(this.dir, '.baton', 'evidence.jsonl');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { course: string; leg: string; ticket: string; run: number }) : [];
  }
}

let home: Home;
let n = 0;
const runners: Runner[] = [];

/** A runner against this test's Baton, heartbeating as credential vm-a, serving `courses`. */
function makeRunner(courses: { course: string; version: number }[], over: Record<string, unknown> = {}): Runner {
  const api = new BatonApi({
    url: 'https://baton.test',
    transport: (req) => hostCall(req),
    auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
  });
  const runner = new Runner({
    api, home: home.dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode',
    // B-86: vm-a's grant expands `agent-venue` to the capabilities whose roles it carries, so the
    // declaration is what the grant allows (the legs here require nothing; the grant is realistic).
    capabilities: [...capabilitiesOf(['agent-venue'])],
    session: `s26-${++n}`, courses, stateFile: join(tmpdir(), `baton-s26-${process.pid}-${n}.json`),
    beatEvery: 60_000, log: () => {},
    ...over,
  });
  runners.push(runner);
  return runner;
}

beforeEach(async () => {
  await setClock(T0);
  home = new Home();
  await cutover();
});

afterEach(() => {
  for (const r of runners.splice(0)) r.stop();
  if (home) rmSync(home.dir, { recursive: true, force: true });
});

describe('S-BTN-26 the runner half (B-103): one runner, one checkout, two courses', () => {
  /** Two tickets of one repository, one per course: `roadmap-pr` and `chore` both at `filed`/`open`. */
  const TWO = [ticket('R3-9001', { course_id: 'roadmap-pr' }), ticket('C-1', { course_id: 'chore', path: 'content/chore/C-1.mdx' })];
  const STATIONS = { 'R3-9001': placed('filed', [], [['implement', 'ready']]), 'C-1': placed('open', [], [['do', 'ready']]) };

  it('declares both courses and claims a leg of either, loading each claim’s course from its snapshot', async () => {
    home.leg('roadmap-pr', 'implement', `return { suspend: true, reached: 'pr-open' };`);
    home.leg('chore', 'do', `return { suspend: true, reached: 'done-once' };`);
    home.commit();
    await home.post(TWO, STATIONS);
    // The declaration the home makes, and what the runner serves without `--course`: both, in
    // the home's order, at their named versions.
    expect(declareCourses(home.dir)).toEqual([{ course: 'roadmap-pr', version: 3 }, { course: 'chore', version: 3 }]);
    const served = servedCourses(home.dir);
    expect(served).toEqual([{ course: 'roadmap-pr', version: 3 }, { course: 'chore', version: 3 }]);

    // What the heartbeat declares: the runner's own calls, recorded as S-BTN-41's `recording` does.
    const runner = makeRunner(served);
    const sent: { repository: string; course: string; version: number }[][] = [];
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    api.heartbeat = async (body: Record<string, unknown>) => {
      sent.push((body.courses ?? []) as { repository: string; course: string; version: number }[]);
      return await beat.call(api, body) as Record<string, any>;
    };
    // The first claim: either course, the server's choice. Both tickets are ready and docs is
    // cut over, so the recommendation's first pick is what the runner takes.
    const first = await runner.runOnce();
    expect(first).not.toBeNull();
    // The first beat of the attempt carried both courses (rule 9, per course).
    expect(sent[0]).toEqual([
      { repository: 'docs', course: 'roadmap-pr', version: 3 },
      { repository: 'docs', course: 'chore', version: 3 }]);
    // The claim named its ticket's course; the server stored exactly that on the claim.
    const [firstClaim] = await rows<{ ticket_id: string; course_id: string }>('SELECT ticket_id, course_id FROM claims ORDER BY id');
    expect(firstClaim.course_id).toBe(first!.ticket === 'docs:R3-9001' ? 'roadmap-pr' : 'chore');
    // ...and the leg that ran was that course's own script: `implement` for roadmap-pr's ticket,
    // `do` for chore's — the load followed `course_id`, never a guess from the snapshot.
    const ran = home.evidence();
    expect(ran).toEqual([{ course: firstClaim.course_id, leg: firstClaim.course_id === 'roadmap-pr' ? 'implement' : 'do',
      ticket: firstClaim.course_id === 'roadmap-pr' ? 'docs:R3-9001' : 'docs:C-1', run: 1 }]);

    // The second claim: the other course. The first ticket suspended at its station; the second
    // is still ready, so this one claim is the other's leg — one runner, two consecutive claims.
    const second = await runner.runOnce();
    expect(second).not.toBeNull();
    const claims = await rows<{ ticket_id: string; course_id: string }>('SELECT ticket_id, course_id FROM claims ORDER BY id');
    expect(claims.map((c) => c.ticket_id).sort()).toEqual(['docs:C-1', 'docs:R3-9001']);
    expect(claims.map((c) => c.course_id).sort()).toEqual(['chore', 'roadmap-pr']);
    expect(second!.ticket).not.toBe(first!.ticket);
    // The second leg's script is the second course's, from its own claim's snapshot.
    const other = claims.find((c) => c.ticket_id === second!.ticket)!;
    expect(home.evidence().at(-1)).toMatchObject({ course: other.course_id, ticket: other.ticket_id,
      leg: other.course_id === 'roadmap-pr' ? 'implement' : 'do' });
    // Both claims ran under one runner process (one session), one leg each: one claim per worker.
    expect(await rows(`SELECT COUNT(DISTINCT worker_id) AS n FROM claims`)).toEqual([{ n: 1 }]);
    expect(await rows(`SELECT COUNT(*) AS n FROM claim_legs WHERE finished_at IS NOT NULL`)).toEqual([{ n: 2 }]);
  }, 60_000);

  it('a claim answer naming no course is refused loudly with several declared, never guessed (B-103)', async () => {
    home.leg('roadmap-pr', 'implement', `return { suspend: true, reached: 'pr-open' };`);
    home.leg('chore', 'do', `return { suspend: true, reached: 'done-once' };`);
    home.commit();
    await home.post(TWO, STATIONS);
    const runner = makeRunner(servedCourses(home.dir));
    // The answer loses its `course_id`, as a pre-B-103 server's did: with two courses declared
    // the runner must not choose one from the snapshot's list.
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const claim = api.claim;
    api.claim = async (body: { request_id: string; ticket_id?: string }) => ({ ...await claim.call(api, body) as Record<string, unknown>, course_id: null });
    const lines: string[] = [];
    (runner as unknown as { log: (l: string) => void }).log = (l: string) => lines.push(l);
    const out = await runner.runOnce();
    expect(out).toMatchObject({ end_reason: 'released:stale-board' });
    expect(lines.join('\n')).toContain('the claim names no course and this runner declares 2 (roadmap-pr, chore) — the runner never guesses');
    // No leg ran: the release came before any course was loaded.
    expect(home.evidence()).toEqual([]);
    expect(await rows(`SELECT COUNT(*) AS n FROM claim_legs`)).toEqual([{ n: 0 }]);
  }, 60_000);

  it('--course narrows the declaration and the claims to that one course', async () => {
    home.leg('roadmap-pr', 'implement', `return { suspend: true, reached: 'pr-open' };`);
    home.leg('chore', 'do', `return { suspend: true, reached: 'done-once' };`);
    home.commit();
    await home.post(TWO, STATIONS);
    const narrowed = servedCourses(home.dir, 'chore');
    expect(narrowed).toEqual([{ course: 'chore', version: 3 }]);
    const runner = makeRunner(narrowed);
    const sent: unknown[] = [];
    const api = (runner as unknown as { o: { api: BatonApi } }).o.api;
    const beat = api.heartbeat;
    api.heartbeat = async (body: Record<string, unknown>) => {
      sent.push(body.courses);
      return await beat.call(api, body) as Record<string, any>;
    };
    const out = await runner.runOnce();
    expect(out).toMatchObject({ ticket: 'docs:C-1' });
    expect(sent[0]).toEqual([{ repository: 'docs', course: 'chore', version: 3 }]);
    // A roadmap-pr ticket is not its to take (rule 9): it stays unclaimed, and a second attempt
    // has nothing left — the runner declares one course, and only that course's ticket was served.
    expect(await rows(`SELECT ticket_id FROM claims`)).toEqual([{ ticket_id: 'docs:C-1' }]);
    expect(await runner.runOnce()).toBeNull();
    expect(home.evidence().map((e) => e.course)).toEqual(['chore']);
  }, 60_000);
});
