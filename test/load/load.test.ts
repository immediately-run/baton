// load.test.ts — `npm run test:load` (BATON_SPEC §15, R-BTN-87; R3-1258): the envelope's mix on
// the local host — 50 live runners heartbeating, claiming, advancing and ending; syncs posting
// boards for 20 repositories, one of them the 5,000-ticket board the latency budget names;
// dashboard reads; bursts — over 1,000,000 seeded history rows. Fails on any error and on any
// route over its p99 budget (§2.3), and reports the figures it reached (G-BTN-77): the
// envelope never refuses anything. Local only (vitest.config.ts's LOAD_TEST list): CI's job
// wiring is the owner's; the Cloudflare budgets are read on production (B-224).
import { describe, it, expect } from 'vitest';
import { adminSession, call, keyCall, rows, setAdminKeys, setClock, syncCall, syncToken, tick, withCore, runnerCall, hbBody, sha256, placed, course } from '../helpers';
import { makeKey, type TestKey } from '../lib/sshKeys';
import { adjustCounts } from '../../src/core/capacity';

const T0 = Date.parse('2026-11-18T12:00:00Z');
const REPOS = 20;
const RUNNERS = 50;
const TICKETS_PER_REPO = 250; // 20 × 250 = the envelope's 5,000 live tickets
const HISTORY_ROWS = 1_000_000;
/** §2.3's latency budgets, p99 at the Worker — the local host must sit inside them. */
const BUDGETS = { heartbeat: 300, end: 300, read: 300, observation: 300, claim: 500, advance: 500, board: 5_000 } as const;

/** One route class's latencies: every sample within budget, the p99 reported (G-BTN-77). */
class Lane {
  private readonly times: number[] = [];
  constructor(readonly name: string, readonly budget: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await work();
    } finally {
      this.times.push(performance.now() - start);
    }
  }
  check(): string {
    const sorted = [...this.times].sort((a, b) => a - b);
    const over = sorted.filter((t) => t > this.budget);
    expect(over, `${this.name}: ${over.length} of ${sorted.length} over the ${this.budget} ms budget (worst ${sorted[sorted.length - 1] ?? 0} ms)`).toHaveLength(0);
    return `${this.name}: n=${sorted.length} p50=${Math.round(sorted[Math.floor(sorted.length * 0.5)] ?? 0)}ms p99=${Math.round(sorted[Math.floor(sorted.length * 0.99)] ?? 0)}ms (budget ${this.budget}ms)`;
  }
}

// The mix's lanes, set by the test (the helpers below are module-level for the board posts).
let heartbeat: Lane;
let claim: Lane;
let advanceLane: Lane;
let end: Lane;
let read: Lane;
let observation: Lane;
let board: Lane;

let clock = T0;
const advanceClock = (ms: number) => {
  clock += ms;
  return setClock(clock);
};

const tokenFor = (github: string) => syncToken({ repository: github, job_workflow_ref: `${github}/.github/workflows/baton-sync.yml@refs/heads/main` });

/** A repository's first board: `n` tickets at their course's start, posted as its sync. */
async function postBoard(github: string, n: number): Promise<void> {
  const token = await tokenFor(github);
  const tickets = Array.from({ length: n }, (_, i) => ({
    id: `L${i}`, course_id: 'roadmap-pr', path: `tickets/L${i}.mdx`, title: `L${i}`, requires: [], operator_only: false, expedite: false,
    depends_on: [], blocked_by: [], repos: [github], rank: i,
  }));
  const stations: Record<string, unknown> = {};
  for (const t of tickets) stations[t.id] = placed('filed', [], [['implement', 'ready']]);
  const sha = `${String(n)}${github.slice(-2)}`.replace(/[^0-9a-f]/g, '0').padEnd(40, '0').slice(0, 40);
  const body = { registry: [course()], sha, parent_sha: null, tickets, closed: [], stations };
  // syncCall takes the observation itself; the whole post (number and body) sits in the lane.
  const posted = await board!.run(async () => syncCall('/v1/sync/board', body, token));
  if (posted.status !== 200) throw new Error(`board ${github} (${n} tickets): ${posted.status} ${(await posted.text()).slice(0, 300)}`);
}

/** A refresh of a repository's head (§4.3): the same tickets under a newer number. */
async function refreshBoard(repo: string, github: string): Promise<void> {
  const token = await tokenFor(github);
  const head = (await rows<{ sha: string | null }>('SELECT sha FROM board_head WHERE repository_id = ?', repo))[0]?.sha ?? null;
  const tickets = (await rows<{ local_id: string; course_id: string; path: string; title: string }>('SELECT local_id, course_id, path, title FROM tickets WHERE repository_id = ?', repo))
    .map((t) => ({ id: t.local_id, course_id: t.course_id, path: t.path, title: t.title, requires: [], operator_only: false, expedite: false, depends_on: [], blocked_by: [], repos: [github], rank: 0 }));
  const stations: Record<string, unknown> = {};
  for (const t of tickets) stations[t.id] = placed('filed', [], [['implement', 'ready']]);
  const posted = await board!.run(async () => syncCall('/v1/sync/board', { registry: [course()], sha: head, parent_sha: head, read_sha: head, tickets, closed: [], stations }, token));
  if (posted.status !== 200) throw new Error(`refresh ${repo}: ${posted.status} ${(await posted.text()).slice(0, 200)}`);
}

describe('npm run test:load — the envelope mix on the local host (G-BTN-77)', () => {
  it('drives the envelope with no error and every route within its budget', { timeout: 20 * 60_000 }, async () => {
    heartbeat = new Lane('heartbeat', BUDGETS.heartbeat);
    claim = new Lane('claim', BUDGETS.claim);
    advanceLane = new Lane('advance', BUDGETS.advance);
    end = new Lane('end', BUDGETS.end);
    read = new Lane('read', BUDGETS.read);
    observation = new Lane('observation', BUDGETS.observation);
    board = new Lane('board post', BUDGETS.board);
    const lanes = [heartbeat, claim, advanceLane, end, read, observation, board];

    const admin: TestKey = await makeKey('ssh-ed25519', 'admin');
    const owner: TestKey = await makeKey('ssh-ed25519', 'load-owner');
    await setAdminKeys(admin);

    // 20 repositories, one owner key each, all cut over.
    const githubs: string[] = [];
    for (let i = 0; i < REPOS; i++) {
      const github = `immediately-run/load-${i}`;
      githubs.push(github);
      const r = await keyCall(admin, '/v1/admin/repositories', { id: `load-${i}`, github, default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [owner.publicKey], cut_over: true });
      expect(r.status, `register load-${i}: ${JSON.stringify(r.json).slice(0, 160)}`).toBe(200);
    }
    // Their boards: 250 tickets each — the envelope's 5,000 live tickets across 20 repositories.
    for (const github of githubs) {
      await postBoard(github, TICKETS_PER_REPO);
      advanceClock(1_000);
    }
    // One 5,000-ticket board: the post the 5-second budget names, on its own repository.
    const big = 'immediately-run/load-big';
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'load-big', github: big, default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml', owner_keys: [owner.publicKey], cut_over: true })).status).toBe(200);
    await postBoard(big, 5_000);
    // 1,000,000 seeded history rows: the envelope's history figure, in one statement. The
    // maintained count (R-BTN-87) is moved by the write sites; a raw seed answers for itself.
    await rows(`WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ${HISTORY_ROWS})
                 INSERT INTO ticket_history (repository_id, ticket_id, at, kind, runner_id, leg, reached, detail_json)
                 SELECT 'load-0', 'load-0:L' || (i % ${TICKETS_PER_REPO}), ${T0} + i, 'leg-finished', 1, 'implement', 'filed', NULL FROM seq`);
    await withCore((c) => adjustCounts(c.store, { history: HISTORY_ROWS }));

    // 50 runners, one session each, declaring the course.
    const runners: { secret: string; id: number; session: string }[] = [];
    for (let i = 0; i < RUNNERS; i++) {
      const secret = `load-secret-${i}`;
      const session = `load-${i}`;
      const res = await heartbeat.run(async () => runnerCall('/v1/runner/heartbeat', { body: hbBody('vm-a', { session_name: session, secret_hash: await sha256(secret), courses: [{ repository: 'load-0', course: 'roadmap-pr', version: 3 }] }) }));
      expect(res.status, `runner ${i} register`).toBe(200);
      runners.push({ secret, id: ((await res.json()) as { runner_id: number }).runner_id, session });
    }

    // The mix: every runner heartbeats, claims, advances and ends; a dashboard read and an
    // observation interleave; a burst of 100 reads lands inside five seconds.
    const session = await adminSession(admin);
    let ended = 0;
    for (let round = 0; round < 4; round++) {
      advanceClock(30_000);
      // A refresh of load-0's head, so its tickets stay claimable between rounds (R-BTN-62).
      await refreshBoard('load-0', 'immediately-run/load-0');
      for (const r of runners) {
        const beat = await heartbeat.run(async () => runnerCall('/v1/runner/heartbeat', { secret: r.secret, body: hbBody('vm-a', { session_name: r.session, courses: [{ repository: 'load-0', course: 'roadmap-pr', version: 3 }] }) }));
        expect(beat.status, `runner ${r.id} heartbeat`).toBe(200);
      }
      const takes: { r: { secret: string; id: number; session: string }; res: Response }[] = [];
      // The claims go in waves — the envelope's mean is 20 requests a second, and the host
      // serializes requests anyway (§3): fifty at once is a queue, not a mix.
      for (let wave = 0; wave < RUNNERS / 5; wave++) {
        const part = await Promise.all(runners.slice(wave * 5, wave * 5 + 5).map(async (r) => ({
          r,
          res: await claim.run(async () => runnerCall('/v1/runner/claim', { secret: r.secret, body: { request_id: `load-${r.id}-${round}` } })),
        })));
        takes.push(...part);
        await new Promise((done) => setTimeout(done, 50));
      }
      for (const { r, res } of takes) {
        expect(res.status, `runner ${r.id} claim`).toBe(200);
        const c = (await res.json()) as { claim_id: number };
        const moved = await advanceLane.run(async () => runnerCall(`/v1/runner/claims/${c.claim_id}/advance`, { secret: r.secret, body: { leg: 'implement' } }));
        expect(moved.status, `runner ${r.id} advance of ${c.claim_id} (${r.session}): ${await moved.clone().text()}`).toBe(200);
        const done = await end.run(async () => runnerCall(`/v1/runner/claims/${c.claim_id}/end`, { secret: r.secret, body: { end_reason: 'released:requested' } }));
        expect(done.status, `runner ${r.id} end`).toBe(200);
        ended++;
      }
      const state = await read.run(async () => call('/v1/ui/state', { headers: { Cookie: session } }));
      expect(state.status).toBe(200);
      // The observation beside the load — its number released at once: this read judges
      // nothing, and an outstanding number would hold the next board post `sync-busy`.
      const observed = await observation.run(async () => syncCall('/v1/sync/observation', {}, await tokenFor('immediately-run/load-0')));
      expect(observed.status).toBe(200);
      const number = ((await observed.clone().json()) as { observation: number }).observation;
      expect((await syncCall('/v1/sync/observation', { release: number }, await tokenFor('immediately-run/load-0'))).status).toBe(200);
    }
    // The burst: 100 reads inside five seconds (the envelope's burst figure).
    const burstToken = await tokenFor('immediately-run/load-0');
    const burst = await Promise.all(Array.from({ length: 100 }, () => read.run(async () => syncCall('/v1/sync/head', undefined, burstToken))));
    for (const res of burst) expect(res.status).toBe(200);
    // One alarm tick runs the envelope's judgement (R-BTN-87) — nothing refused, whatever it sees.
    await tick();

    // G-BTN-77's report: every lane inside its budget, and the figures the run reached.
    const report = lanes.map((lane) => lane.check());
    const capacity = await withCore((c) => c.capacity.view(c.capacityFigures()));
    const counts = await withCore((c) => c.capacity.counts());
    process.stdout.write([
      'baton: load test reached the envelope',
      ...report,
      `figures: live_runners=${counts.live_runners} repositories=${counts.repositories} live_tickets=${counts.live_tickets} history_rows=${counts.history_rows}`,
      `day's usage: ${capacity.day.requests} requests, ${capacity.day.rows_written} rows written (limits ${capacity.day.limits.requests}/${capacity.day.limits.rows_written})`,
      `over 80%: ${capacity.figures.filter((f) => f.over).map((f) => f.figure).join(', ') || 'none'}`,
    ].join('\n') + '\n');
    expect(counts.live_runners).toBe(RUNNERS);
    expect(counts.repositories).toBe(REPOS + 3); // the load's own, the 5,000-ticket board, docs and baton
    expect(counts.history_rows).toBeGreaterThanOrEqual(HISTORY_ROWS);
    expect(counts.live_tickets).toBeGreaterThanOrEqual(5_000); // at the envelope; the big board's own 5,000 stand beside the 20 boards'
    expect(ended).toBe(RUNNERS * 4);
  });
});
