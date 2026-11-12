// S-BTN-43 a repository with no course code (BATON_SPEC §15 S-BTN-43, §4.2 R-BTN-74; R3-1249):
// a fresh repository with a `tickets/` wiki of five items (one `depends_on` another, one
// `done`, one with an unknown frontmatter field, one file without `id`) runs `baton repo init` and
// its sync with no `.baton/tickets.mjs` or `sync.mjs`; a PR opens for one ticket, the run-tests
// gate stands green before each review round (B-110), checks pass, a review requests changes, a
// fix is pushed, a review approves, the PR merges and the item is marked `done`; then
// `baton repo init --eject tickets` and an edit to the copy. Must hold: four
// tickets on the `create-pr` course (the file without `id` is none, the `done` one closed); the
// dependent ticket is not ready until its dependency is done; the ticket moves
// filed → pr-open (run-tests ready, then review waiting on ci, then ready) → reviewed (fix
// ready) → fixed (run-tests ready, then review ready) → reviewed (merge ready) → merged; after
// the eject the edited source's tickets are posted; Baton's
// src/core/ gains no line (the boundary test asserts the defaults' exemption and core's
// non-import); a second run where the PR is authored and reviewed by one identity, with
// `<!-- baton:verdict … -->` comment-only reviews, moves the same way; a red check makes
// `review` ready once the gate stands green. B-110 round 1: a gate marker counts only as the
// evidence Baton recorded for a claim's run-tests leg (one it has no record of leaves the gate
// open), and three failed rounds post `review-rounds-3`, which the owner answers through Baton —
// `round` granting one review run, the fourth round asking `review-rounds-4`, `owner` parking
// it. Node only: it writes a real repository and runs git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
// No --pin: the CLI pins its own commit, the one its courses' sources name (B-33).
const init = (root: string, ...argv: string[]) => initMain(argv, { root, log: () => {} });
import type { PrFact } from '../../src/defaults/course-pr';
import type { BranchCommit } from '../../src/defaults/pr-markers';
import { ORIGIN, keyCall, register, rows, setAdminKeys, setClock, syncToken } from '../helpers';
import { makeKey } from '../lib/sshKeys';

const T0 = Date.parse('2026-10-16T12:00:00Z');

/** The fixture repository: a git tree with a tickets/ wiki, no course code of its own. */
class Repo {
  readonly dir: string;
  facts: PrFact[] = [];
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'baton-s43-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'relay@test');
    g('config', 'user.name', 'relay test');
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
    this.write('tickets/first.md', '---\nid: T-1\ntitle: First\ntier: routine\nmystery: unknown-field\n---\n');
    this.write('tickets/second.md', '---\nid: T-2\ntitle: Second\ndepends_on: [T-1]\n---\n');
    // T-3 depends on an archived done item, which the source reads from tickets/archive/.
    this.write('tickets/third.md', '---\nid: T-3\ntitle: Third\ndepends_on: [T-0]\n---\n');
    mkdirSync(join(this.dir, 'tickets', 'archive'), { recursive: true });
    this.write('tickets/archive/zero.md', '---\nid: T-0\nstatus: done\n---\n');
    this.write('tickets/done.md', '---\nid: T-9\nstatus: done\n---\n');
    this.write('tickets/noid.md', '---\ntitle: no id here\n---\n');
    this.write('tickets/notes.txt', 'not markdown\n');
  }
  write(path: string, text: string): void {
    writeFileSync(join(this.dir, path), text);
  }
  commit(): string {
    execFileSync('git', ['-C', this.dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', this.dir, 'commit', '--allow-empty', '-qm', 'wiki'], { stdio: 'ignore' });
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  /** One sync: recorded facts, the harness's sync credential, the local host's transport. */
  async sync(...extra: string[]): Promise<void> {
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, JSON.stringify(this.facts));
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts, ...extra], {});
    await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: () => {} });
  }
}

let repo: Repo;
beforeEach(async () => {
  await setClock(T0);
  repo = new Repo();
  gateWorker = null;
});
afterEach(() => rmSync(repo.dir, { recursive: true, force: true }));

type StationRow = { station: string; next_leg: string | null };
type NextRow = { leg: string; state: string; waiting_on: string | null };
const stationOf = (id: string): Promise<StationRow[]> => rows('SELECT station, next_leg FROM ticket_stations WHERE ticket_id = ?', `docs:${id}`);
const nextOf = (id: string): Promise<NextRow[]> => rows('SELECT leg, state, waiting_on FROM ticket_next_legs WHERE ticket_id = ? ORDER BY leg', `docs:${id}`);

/** One run-tests gate run (B-110): its marker on the branch, and the claim whose run-tests leg
 *  Baton recorded with that marker as its evidence — the only way a marker counts (round 1,
 *  finding 3: a marker in git is a record, never the authority). */
interface Gate { at: number; tests: 'green' | 'red'; nonce: string; sha: string }
function gate(ago: number, tests: 'green' | 'red' = 'green'): Gate {
  return { at: T0 - ago, tests, nonce: `g${ago}`, sha: `9${ago.toString(16).padStart(39, '0')}` };
}
const contentSha = (at: number) => `c${at.toString(16).padStart(39, '0')}`;
/** The PR branch's commits as the adapter records them: a content commit at each push, and each
 *  gate's marker — an empty-tree commit — on the newest content commit before it. */
function branch(pushes: number[], gates: Gate[]): BranchCommit[] {
  const events = [...pushes.map((at) => ({ at, gate: null as Gate | null })), ...gates.map((g) => ({ at: g.at, gate: g }))].sort((x, y) => x.at - y.at);
  const out: BranchCommit[] = [];
  let content: string | null = null;
  for (const e of events) {
    const parent = out.at(-1)?.sha ?? null;
    if (!e.gate) {
      content = contentSha(e.at);
      out.push({ sha: content, at: e.at, parent, empty: false, message: 'work' });
    } else {
      out.push({ sha: e.gate.sha, at: e.at, parent, empty: true, message: `baton: tests ${e.gate.tests} for T-1\n\nBaton-Tests: ${e.gate.tests}\nBaton-Tested: ${parent}\nBaton-Claim: ${e.gate.nonce}` });
    }
  }
  return out;
}
/** One fact in the shape R-BTN-96's adapter records. */
function fact(number: number, state: PrFact['state'], checks: (string | null)[], reviews: PrFact['reviews'], pushedAt?: number, gates: Gate[] = [], pushes?: number[]): PrFact {
  const at = pushedAt ?? reviews.at(-1)?.submittedAt ?? T0;
  const content = pushes ?? [at];
  const commits = branch(content, gates);
  return { number, head: `claude/T-1-${number}`, state, pushedAt: at, pushes: commits.map((c) => c.at), checks, reviews, commits };
}
function rev(author: string, state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED', ago: number, body = ''): PrFact['reviews'][number] {
  return { author, state, submittedAt: T0 - ago, body };
}
let gateWorker: number | null = null;
/** Baton's record of each gate's run: a finished claim on T-1 whose run-tests leg passed the
 *  marker's sha as its evidence (what a runner's advance records, R-BTN-63). */
async function recorded(...gates: Gate[]): Promise<void> {
  gateWorker ??= (await register('vm-a')).id;
  for (const g of gates) {
    if ((await rows('SELECT 1 FROM claims WHERE request_id = ?', `gate:${g.nonce}`)).length) continue;
    await rows(`INSERT INTO claims (ticket_id, worker_id, request_id, nonce, snapshot_sha, claimed_at, status, ended_at, end_reason) VALUES ('docs:T-1', ?, ?, ?, '', 0, 'released', 1, 'released:requested')`, gateWorker, `gate:${g.nonce}`, g.nonce);
    const [{ id }] = await rows<{ id: number }>('SELECT id FROM claims WHERE request_id = ?', `gate:${g.nonce}`);
    await rows(`INSERT INTO claim_legs (claim_id, seq, leg, from_station, to_station, started_at, started_observation, finished_at, evidence) VALUES (?, 1, 'run-tests', 'pr-open', 'pr-open', 0, 0, 1, ?)`, id, g.sha);
  }
}

describe('S-BTN-43 a repository with no course code', () => {
  it('init then sync: four tickets on the pr course, the dependent not ready, the timeline to merged', async () => {
    expect(await init(repo.dir)).toBe(0);
    repo.commit();
    await repo.sync();
    // Four tickets from five items — the no-id file (and the .txt) are none; the done one is
    // closed as done; the one with an unknown field (T-1) is a ticket like the rest.
    expect(await rows('SELECT id, course_id FROM tickets ORDER BY id')).toEqual([
      { id: 'docs:T-1', course_id: 'create-pr' },
      { id: 'docs:T-2', course_id: 'create-pr' },
      { id: 'docs:T-3', course_id: 'create-pr' },
    ]);
    expect(await rows('SELECT ticket_id, closed_as FROM closed_tickets ORDER BY ticket_id')).toEqual([{ ticket_id: 'docs:T-0', closed_as: 'done' }, { ticket_id: 'docs:T-9', closed_as: 'done' }]);
    // The archived done dependency counts: T-3's implement is ready.
    expect((await nextOf('T-3'))[0]).toMatchObject({ leg: 'implement', state: 'ready' });
    // The dependent ticket is not ready until its dependency is done.
    expect((await stationOf('T-2'))[0]).toMatchObject({ station: 'filed', next_leg: 'implement' });
    expect((await nextOf('T-2'))[0]).toMatchObject({ state: 'waiting', waiting_on: 'dependencies' });

    // A PR opens for T-1: the run-tests gate comes before every review round (B-110), so with
    // no marker on the head the gate is ready — not review, whatever the checks say.
    repo.facts = [fact(7, 'open', [null], [], T0 - 200)];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'pr-open', next_leg: 'run-tests' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'run-tests', state: 'ready', waiting_on: null });
    // A marker on the branch that Baton has no record of is no gate (round 1, finding 3): a
    // pusher wrote it, not a claim's run-tests leg — the gate stays open.
    const first = gate(190);
    repo.facts = [fact(7, 'open', [null], [], T0 - 200, [first])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'pr-open', next_leg: 'run-tests' });
    // The gate stands green on the head — the marker a claim's advance recorded as its evidence:
    // review queues, ci-waited while the head's checks run, then ready.
    await recorded(first);
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ state: 'waiting', waiting_on: 'ci' });
    repo.facts = [fact(7, 'open', ['success'], [], T0 - 200, [first])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ state: 'ready', waiting_on: null });

    // A review requests changes; a fix is pushed — the push re-opens the gate, and its green
    // marker queues the second round; a review approves; the PR merges.
    const changes = [rev('r1', 'CHANGES_REQUESTED', 100)];
    repo.facts = [fact(7, 'open', ['success'], changes, T0 - 200, [first])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
    repo.facts = [fact(7, 'open', ['success'], changes, T0 - 50, [first], [T0 - 200, T0 - 50])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'fixed', next_leg: 'run-tests' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'run-tests', state: 'ready' });
    const second = gate(40);
    await recorded(second);
    repo.facts = [fact(7, 'open', ['success'], changes, T0 - 50, [first, second], [T0 - 200, T0 - 50])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'fixed', next_leg: 'review' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'review', state: 'ready' });
    const approved = [...changes, rev('r1', 'APPROVED', 10)];
    repo.facts = [fact(7, 'open', ['success'], approved, T0 - 50, [first, second], [T0 - 200, T0 - 50])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'merge', state: 'ready' });
    repo.facts = [fact(7, 'merged', ['success'], approved, T0 - 50, [first, second], [T0 - 200, T0 - 50])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'merged' });

    // The item is marked done; the dependent ticket's implement turns ready.
    repo.write('tickets/first.md', '---\nid: T-1\ntitle: First\nstatus: done\n---\n');
    repo.commit();
    await repo.sync();
    expect((await stationOf('T-2'))[0]).toMatchObject({ station: 'filed', next_leg: 'implement' });
    expect((await nextOf('T-2'))[0]).toMatchObject({ state: 'ready', waiting_on: null });
  }, 60_000);

  it('--eject tickets, then an edit to the copy: the edited source’s tickets are posted', async () => {
    await init(repo.dir);
    repo.commit();
    await repo.sync();
    expect(await rows('SELECT count(*) AS n FROM tickets')).toEqual([{ n: 3 }]);
    await init(repo.dir, '--eject', 'tickets');
    const ejected = readFileSync(join(repo.dir, '.baton', 'tickets.mjs'), 'utf8');
    repo.write('.baton/tickets.mjs', ejected.replace(
      'return stampMarkdownVersions(ctx.root, ticketsMarkdown(files, ctx.settings), ctx.settings.items);',
      "const out = stampMarkdownVersions(ctx.root, ticketsMarkdown(files, ctx.settings), ctx.settings.items);\n    return { tickets: out.tickets.map((t) => (t.id === 'T-2' ? { ...t, title: 'EDITED BY HAND' } : t)), closed: out.closed };",
    ));
    repo.commit();
    await repo.sync();
    expect(await rows('SELECT id, title FROM tickets WHERE id = ?', 'docs:T-2')).toEqual([{ id: 'docs:T-2', title: 'EDITED BY HAND' }]);
  }, 60_000);

  it('one identity, comment-only verdict reviews, moves the same way; a red check makes review ready once the gate stands green', async () => {
    await init(repo.dir);
    repo.commit();
    // The same identity authors and reviews; GitHub refuses self-approval, so the verdict is
    // the marker line a comment-only review opens with. The gate's green marker precedes each
    // round (B-110), and the red check — a content check, not the gate's — never holds it.
    repo.commit();
    await repo.sync();
    await recorded(gate(190), gate(40));
    repo.facts = [fact(7, 'open', ['failure'], [rev('me', 'COMMENTED', 100, '<!-- baton:verdict changes --> one thing')], T0 - 200, [gate(190)])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'fix' });
    repo.facts = [fact(7, 'open', ['failure'], [rev('me', 'COMMENTED', 100, '<!-- baton:verdict changes --> one thing'), rev('me', 'COMMENTED', 10, '<!-- baton:verdict approve -->')], T0 - 50, [gate(190), gate(40)], [T0 - 200, T0 - 50])];
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'merge' });
    // The red check made review ready all along — the review reads it and asks for a fix.
    expect((await nextOf('T-1'))[0]).toMatchObject({ leg: 'merge', state: 'ready' });
  }, 60_000);

  it('three failed reviews hand the blockers to the owner — a decision in Needs you — who answers through Baton (B-110)', async () => {
    await init(repo.dir);
    repo.commit();
    await repo.sync();
    // The owner of docs, who answers through Baton's owner route — never a line in git (the
    // owner, 2026-11-03, "Through Baton, not git").
    const admin = await makeKey('ssh-ed25519', 'admin');
    const owner = await makeKey('ssh-ed25519', 'docs-owner');
    await setAdminKeys(admin);
    expect((await keyCall(admin, '/v1/admin/repositories', { id: 'docs', owner_keys_add: [owner.publicKey] })).status).toBe(200);
    const resolve = (decision: string, answer: string) => keyCall(owner, '/v1/owner/docs/tickets/T-1/resolve', { decision, answer });
    // Three review rounds asking for changes, each round's fix pushed and its gate standing
    // green before the next round; the third round's changes then stand unanswered.
    const rounds = (n: number): PrFact['reviews'] => Array.from({ length: n }, (_, i) => rev(`r${i + 1}`, 'CHANGES_REQUESTED', 200 - i * 60));
    const pushes = [T0 - 250, T0 - 190, T0 - 130];
    const gates = [gate(240), gate(180), gate(120)];
    await recorded(...gates);
    const at = (reviews: PrFact['reviews'], state: PrFact['state'] = 'open') => { repo.facts = [fact(7, state, ['success'], reviews, T0 - 130, gates, pushes)]; };
    at(rounds(3));
    await repo.sync();
    // The third round's blockers are the owner's: adjudicate waits on them, and the decision
    // the sync posts carries the question and its answers to Needs you (§14). No agent
    // reproduces anything. A trailer or a comment line on the branch would answer nothing.
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'reviewed', next_leg: 'adjudicate' });
    expect(await nextOf('T-1')).toEqual([{ leg: 'adjudicate', state: 'waiting', waiting_on: 'owner' }]);
    expect(await rows('SELECT decision_id, leg, asks, question, options_json, source FROM ticket_decisions WHERE ticket_id = ?', 'docs:T-1')).toEqual([{
      decision_id: 'review-rounds-3', leg: 'adjudicate', asks: 'owner', question: '3 failed reviews — manual review or start a 4th round?',
      options_json: JSON.stringify([{ id: 'merge' }, { id: 'owner' }, { id: 'round', grants: { leg: 'review', runs: 1 } }]), source: 'sync',
    }]);
    // The owner answers `round` through Baton: the answer itself grants exactly one more review
    // run, and the next sync — reading the answer with its observation — offers that round.
    await setClock(T0 + 1);
    expect((await resolve('review-rounds-3', 'round')).status).toBe(200);
    expect(await rows(`SELECT runs_json FROM ticket_overrides WHERE ticket_id = 'docs:T-1'`)).toEqual([{ runs_json: '{"review":1}' }]);
    await repo.sync();
    expect(await nextOf('T-1')).toEqual([{ leg: 'review', state: 'ready', waiting_on: null }]);
    expect(await rows('SELECT count(*) AS n FROM ticket_decisions WHERE ticket_id = ?', 'docs:T-1')).toEqual([{ n: 0 }]);
    // The fourth round — on the same head — asks for changes again: back to the owner, asked
    // anew, who this time takes it over by hand — `owner` parks it, merge waiting on them.
    const four = [...rounds(3), { ...rev('r1', 'CHANGES_REQUESTED', 0), submittedAt: T0 + 2 }];
    at(four);
    await repo.sync();
    expect(await nextOf('T-1')).toEqual([{ leg: 'adjudicate', state: 'waiting', waiting_on: 'owner' }]);
    expect((await rows<{ decision_id: string }>('SELECT decision_id FROM ticket_decisions WHERE ticket_id = ?', 'docs:T-1')).map((d) => d.decision_id)).toEqual(['review-rounds-4']);
    expect((await resolve('review-rounds-4', 'owner')).status).toBe(200);
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'adjudicated', next_leg: 'merge' });
    expect(await nextOf('T-1')).toEqual([{ leg: 'merge', state: 'waiting', waiting_on: 'owner' }]);
    at(four, 'merged');
    await repo.sync();
    expect((await stationOf('T-1'))[0]).toMatchObject({ station: 'merged' });
  }, 60_000);
});

// G-BTN-69's refusals: each fails the sync before anything is posted, naming what to fix.
describe('S-BTN-43 the sync refuses, posting nothing', () => {
  const posted = async () => (await rows('SELECT count(*) AS n FROM tickets'))[0];
  // A refused run already holds its observation number; the next run is `sync-busy` until the
  // number is 10 minutes old (R-BTN-62), so each retry here moves the clock past that.
  let minutes = 0;
  const later = () => setClock(T0 + (minutes += 11) * 60_000);

  it('a course with no sync.mjs that is not a standard course, a ticket on an unlisted course, a bad stations return, no baton.json', async () => {
    mkdirSync(join(repo.dir, '.baton')); // the harness keeps its recorded facts there
    await expect(repo.sync()).rejects.toThrow('has no .baton/baton.json — run `baton repo init` first');
    await init(repo.dir);
    const settingsFile = join(repo.dir, '.baton', 'baton.json');
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));

    // A ticket on a course baton.json does not list.
    repo.write('tickets/stray.md', '---\nid: S-1\ncourse: epic\n---\n');
    repo.commit();
    await later();
    await expect(repo.sync()).rejects.toThrow('ticket S-1 is on course epic, which .baton/baton.json\'s courses do not list');
    expect(await posted()).toEqual({ n: 0 });

    // A listed course that is not a standard one, with a course file but no sync.mjs.
    mkdirSync(join(repo.dir, '.baton', 'courses', 'epic'), { recursive: true });
    writeFileSync(join(repo.dir, '.baton', 'courses', 'epic', 'course.json'), readFileSync(join(repo.dir, '.baton', 'courses', 'create-pr', 'course.json')));
    writeFileSync(settingsFile, JSON.stringify({ ...settings, courses: [...settings.courses, { id: 'epic', version: 1 }] }));
    repo.commit();
    await later();
    await expect(repo.sync()).rejects.toThrow('course epic has no sync.mjs and is not a standard course');
    expect(await posted()).toEqual({ n: 0 });

    // A station function returning a bare map instead of {stations, markers, course_data}.
    writeFileSync(join(repo.dir, '.baton', 'courses', 'epic', 'sync.mjs'), "export default { stations: () => ({ 'S-1': { station: 'filed' } }) };\n");
    repo.commit();
    await later();
    await expect(repo.sync()).rejects.toThrow('.baton/courses/epic/sync.mjs: stations(ctx) must return {stations, markers, course_data}');
    expect(await posted()).toEqual({ n: 0 });
  }, 60_000);

  it('a checkout behind the head posts nothing: a slow run for an older push never moves the board back', async () => {
    await init(repo.dir);
    const older = repo.commit();
    repo.write('tickets/fourth.md', '---\nid: T-4\ntitle: Fourth\n---\n');
    repo.commit();
    await repo.sync();
    expect(await posted()).toEqual({ n: 4 });
    execFileSync('git', ['-C', repo.dir, 'checkout', '-q', '--detach', older], { stdio: 'ignore' });
    await repo.sync();
    // The older reading (no T-4) was not posted: the head and its four tickets stand.
    expect(await posted()).toEqual({ n: 4 });
  }, 60_000);
});

describe('S-BTN-43 --latest, as the workflow runs it', () => {
  it('after its number the run fetches the newest main and posts that board, not the older checkout it started on', async () => {
    await init(repo.dir);
    repo.commit();
    // A bare origin, and a second clone that pushes one commit the local checkout lacks.
    const bare = mkdtempSync(join(tmpdir(), 'baton-s43-origin-'));
    const other = mkdtempSync(join(tmpdir(), 'baton-s43-other-'));
    try {
      execFileSync('git', ['clone', '-q', '--bare', repo.dir, bare], { stdio: 'ignore' });
      execFileSync('git', ['-C', repo.dir, 'remote', 'add', 'origin', bare], { stdio: 'ignore' });
      execFileSync('git', ['clone', '-q', bare, other], { stdio: 'ignore' });
      writeFileSync(join(other, 'tickets', 'fifth.md'), '---\nid: T-5\ntitle: Fifth\n---\n');
      for (const a of [['add', '-A'], ['-c', 'user.email=o@t', '-c', 'user.name=o', 'commit', '-qm', 'T-5'], ['push', '-q', 'origin', 'HEAD:main']]) execFileSync('git', ['-C', other, ...a], { stdio: 'ignore' });
      const newest = execFileSync('git', ['-C', other, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      await repo.sync('--latest', 'main');
      expect(await rows('SELECT id FROM tickets WHERE id = ?', 'docs:T-5')).toEqual([{ id: 'docs:T-5' }]);
      // The checkout now sits at the newest main, detached: the commit it posted.
      expect(execFileSync('git', ['-C', repo.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(newest);
    } finally {
      rmSync(bare, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  }, 60_000);
});
