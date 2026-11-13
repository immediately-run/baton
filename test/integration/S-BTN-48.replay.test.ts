// S-BTN-48 contracts and replay, the replay half (BATON_SPEC §9.8 R-BTN-84, §8.4 R-BTN-143/
// R-BTN-144, §5.5 R-BTN-82; B-190), Node only: a real repository, a real runner claim, and
// `baton leg replay` re-running the recorded run without a claim. The runner reports each run's
// inputs at its start — the ticket's version and the digest of what its source's `read`
// returned, stored in `leg_run_inputs` beside the head the holder reported — and replay: runs
// the recorded run writing nothing to Baton, in R-BTN-144's replay environment (no
// write-capable credential reaches the leg, and the masked report carries nothing it would
// leak); refuses a leg marked `"replay_safe": false`; compares a second run of the scripts at
// `--against <sha>`; stops on a current source whose version moved since the run, running only
// with `--accept-moved` (the report says so); replays a pinned source at the recorded version;
// and fails a tampered input by its digest. The contracts' input/output half is B-39's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { call as hostCall } from '#host';
import { initMain, parseSyncArgs, syncMain } from '../../src/defaults/cli';
import { Runner } from '../../src/runner/runner';
import { BatonApi } from '../../src/runner/api';
import { replayMain } from '../../src/runner/replay';
import { call, ORIGIN, TOKENS, advance, claimItem, cutover, makeApiKey, register, rows, setAdminKeys, setClock, syncToken } from '../helpers';

const T0 = Date.parse('2026-11-13T12:00:00Z');
const sha256 = (text: string) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

/** The fixture tracker source of S-BTN-207's: `versions: "current"` over a JSON store outside
 *  git, its version the store's own stamp over a digest of the ticket — the shape whose edits
 *  reach replay's version check with no commit at all. */
const trackerSource = (store: string): string => `import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const STORE = ${JSON.stringify(store)};
const digest = (t) => createHash('sha256').update(JSON.stringify({ id: t.id, title: t.title, body: t.body ?? '', status: t.status ?? 'live' })).digest('hex').slice(0, 16);
const readStore = () => JSON.parse(readFileSync(STORE, 'utf8'));
export default {
  versions: 'current',
  async tickets(ctx) {
    const store = readStore();
    const tickets = store.tickets.filter((t) => t.status !== 'withdrawn').map((t) => ({
      id: t.id, version: store.rev + ':' + digest(t), key: 'tracker:' + (t.key ?? t.id), course_id: 'create-pr',
      title: t.title, tier: t.tier ?? 'routine', requires: [], operator_only: false, expedite: false,
      depends_on: [], blocked_by: [], repos: [], rank: t.rank ?? 0,
    }));
    return { tickets, closed: [] };
  },
  async read(id) {
    const t = readStore().tickets.find((x) => x.id === id);
    if (t == null || t.status === 'withdrawn') return null;
    const store = readStore();
    return { version: store.rev + ':' + digest(t), ticket: t };
  },
};
`;

/** One scaffolded repository, as S-BTN-207's, with a real local origin: the remote's URL keeps
 *  the github spelling a `git:` input names, and an `insteadOf` rewrite sends its fetches to the
 *  bare clone beside it — so R-BTN-143's one bounded fetch into `refs/baton/<repository>/default`
 *  runs exactly as it would against the forge. */
class Repo {
  readonly dir: string;
  readonly store: string;
  private readonly tracker: boolean;
  /** What the leg script writes into its checkout, and what it reports of its environment. */
  scriptVersion = 'one';
  constructor(tracker: boolean) {
    this.tracker = tracker;
    this.dir = mkdtempSync(join(tmpdir(), tracker ? 'baton-s48t-' : 'baton-s48m-'));
    const origin = mkdtempSync(join(tmpdir(), 'baton-s48-origin-'));
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'relay@test');
    g('config', 'user.name', 'relay test');
    g('remote', 'add', 'origin', 'https://github.com/immediately-run/docs.git');
    g('config', `url.${origin}.insteadOf`, 'https://github.com/immediately-run/docs.git');
    mkdirSync(join(this.dir, 'tickets'), { recursive: true });
    this.store = join(mkdtempSync(join(tmpdir(), 'baton-s48-store-')), 'store.json');
  }

  /** `baton repo init`, the fixture source and the runnable leg: everything after the tree. */
  async setup(o: { unsafe?: boolean } = {}): Promise<Repo> {
    expect(await initMain([], { root: this.dir, log: () => {} })).toBe(0);
    if (this.tracker) {
      writeFileSync(join(this.dir, '.baton', 'tickets.mjs'), trackerSource(this.store));
      this.writeStore({ rev: 5, tickets: [{ id: 'T-1', key: 'C-1', title: 'The tracked ticket', body: 'As first filed.', rank: 0 }] });
    } else {
      writeFileSync(join(this.dir, 'tickets', 'one.mdx'), '---\nid: T-1\ntitle: One\ntier: routine\n---\nThe body.\n');
    }
    // A leg the runner can run: it writes its version into its checkout (the would-be write
    // replay records) and reports the environment it was given (what R-BTN-144's replay
    // environment must not carry). Its `close` exists and is never called by replay.
    this.writeScript();
    if (o.unsafe) {
      // The scaffolded course is the CLI's own (sourced: its graph is kept exactly), so the
      // marker is written on the repository's own course — the `source` pin dropped first.
      const settings = JSON.parse(readFileSync(join(this.dir, '.baton', 'baton.json'), 'utf8')) as { courses: Record<string, unknown>[] };
      for (const c of settings.courses) delete c.source;
      writeFileSync(join(this.dir, '.baton', 'baton.json'), `${JSON.stringify(settings, null, 2)}\n`);
      const course = JSON.parse(readFileSync(join(this.dir, '.baton', 'courses', 'create-pr', 'course.json'), 'utf8')) as { legs: Record<string, unknown> };
      (course.legs.implement as Record<string, unknown>).replay_safe = false;
      writeFileSync(join(this.dir, '.baton', 'courses', 'create-pr', 'course.json'), `${JSON.stringify(course, null, 2)}\n`);
    }
    this.commit();
    return this;
  }
  /** The leg script of `version`: what it writes, and so what `--against` compares. */
  writeScript(): void {
    writeFileSync(join(this.dir, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs'), `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function run(ctx) {
  const id = ctx.ticket.id.split(':').pop();
  writeFileSync(join(ctx.checkout, 'leg-ran-' + id + '.txt'), ${JSON.stringify(this.scriptVersion)} + ' of ' + (ctx.replay ? 'a replay' : 'a claim') + ' at ' + (ctx.replay?.recorded.head_sha ?? '').slice(0, 10));
  const env = ctx.replay ? process.env : {};
  return { end: 'done', reached: 'filed', version: ${JSON.stringify(this.scriptVersion)}, replay: ctx.replay != null,
           env_keys: Object.keys(env).sort(), has_token: env.MY_PROVIDER_TOKEN != null, my_token: env.MY_PROVIDER_TOKEN ?? null };
}
export async function close() { return 'https://example.test/close'; }
`);
  }
  writeStore(store: unknown): void {
    writeFileSync(this.store, `${JSON.stringify(store, null, 2)}\n`);
  }
  readStore(): { rev: number; tickets: Record<string, unknown>[] } {
    return JSON.parse(readFileSync(this.store, 'utf8')) as { rev: number; tickets: Record<string, unknown>[] };
  }
  commit(message = 'wiki'): string {
    const g = (...a: string[]) => execFileSync('git', ['-C', this.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('add', '-A');
    g('commit', '--allow-empty', '-qm', message);
    g('push', '-q', 'origin', 'main');
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  blob(path: string): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', `HEAD:${path}`], { encoding: 'utf8' }).trim();
  }
  head(): string {
    return execFileSync('git', ['-C', this.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  }
  /** One sync: no facts, the harness's sync credential, the local host's transport. */
  async sync(): Promise<void> {
    const facts = join(this.dir, '.baton', 'facts.json');
    writeFileSync(facts, '[]');
    const token = await syncToken();
    const args = parseSyncArgs(['--root', this.dir, '--url', ORIGIN, '--facts', facts], {});
    const code = await syncMain({ ...args, auth: () => ({ Authorization: `Bearer ${token}` }), transport: (req) => hostCall(req), log: () => {} });
    expect(code).toBe(0);
  }
  /** The runner over this home, as S-BTN-207's: one session, one credential. */
  runner(session: string): Runner {
    const api = new BatonApi({
      url: ORIGIN,
      transport: (req) => hostCall(req),
      auth: (_m, _u, _b, secret) => ({ Authorization: `Bearer ${TOKENS['vm-a']}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) }),
    });
    return new Runner({
      api, home: this.dir, repository: 'docs', hostname: 'vm-a', harness: 'opencode', session,
      courses: [{ course: 'create-pr', version: 1 }], stateFile: join(tmpdir(), `baton-s48-${session}.json`),
      beatEvery: 60_000, log: () => {},
    });
  }
}

let repo: Repo;
const repos: Repo[] = [];
/** The administrator's API key replay reads the runs with, and its file. */
let key: { key: string; line: string };
let keyFile: string;
const work: string[] = [];

beforeEach(async () => {
  await setClock(T0);
  await cutover();
  key = await makeApiKey('replay');
  setAdminKeys(key.line);
  keyFile = join(mkdtempSync(join(tmpdir(), 'baton-s48-key-')), 'admin.key');
  writeFileSync(keyFile, `${key.key}\n`);
});
afterEach(() => {
  for (const w of work) rmSync(w, { recursive: true, force: true });
  work.length = 0;
  for (const r of repos) rmSync(r.dir, { recursive: true, force: true });
  repos.length = 0;
});

/** One replay over `repo`, its report read back. The environment carries a secret under a name
 *  `--env` keeps, so the report's masking is exercised on every run. */
async function replay(args: string[], env: Record<string, string> = {}): Promise<{ code: number; report: Record<string, any>; lines: string[] }> {
  const report = join(mkdtempSync(join(tmpdir(), 'baton-s48-report-')), 'report.json');
  work.push(report);
  const lines: string[] = [];
  const code = await replayMain(['docs:T-1', 'implement', '-i', keyFile, '--home', repo.dir, '--report', report, ...args], {
    transport: (req) => hostCall(req),
    env: { ...process.env, MY_PROVIDER_TOKEN: 'tok-secret-value-0123456789', SSH_AUTH_SOCK: '/agent.sock', ...env },
    log: (l) => lines.push(l),
  });
  return { code, report: JSON.parse(readFileSync(report, 'utf8')) as Record<string, any>, lines };
}

describe('S-BTN-48 replay: a recorded run re-run without a claim', () => {
  it('the runner records each run\'s inputs — the ticket\'s version, its read\'s digest and the head — and replay runs the run writing nothing to Baton', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    const outcome = await repo.runner(`s48-${process.pid}`).runOnce();
    expect(outcome).not.toBeNull();
    // The run's record: the ticket row (version, read digest) and the head the holder reported.
    const one = repo.blob('tickets/one.mdx');
    expect(await rows('SELECT name, ticket_version, read_digest, uri FROM leg_run_inputs')).toEqual([
      { name: '', ticket_version: one, read_digest: sha256(readFileSync(join(repo.dir, 'tickets', 'one.mdx'), 'utf8')), uri: null },
    ]);
    expect(await rows<{ head_sha: string | null }>('SELECT head_sha FROM claim_legs')).toEqual([{ head_sha: repo.head() }]);
    // What Baton holds as the replay is about to run — replay adds nothing to any of it.
    const before = {
      claims: (await rows<{ n: number }>('SELECT count(*) AS n FROM claims'))[0].n,
      history: (await rows<{ n: number }>('SELECT count(*) AS n FROM ticket_history'))[0].n,
      events: (await rows<{ n: number }>('SELECT count(*) AS n FROM events'))[0].n,
      legs: (await rows<{ n: number }>('SELECT count(*) AS n FROM claim_legs'))[0].n,
    };

    const out = await replay([]);
    expect(out.code).toBe(0);
    expect(out.report).toMatchObject({
      wrote_to_baton: false, run: 1, claim: expect.any(Number),
      version_check: { how: 'pinned', ok: true, recorded_version: one },
      checked_out_at: repo.head(),
      close: expect.stringMatching(/not called/),
    });
    expect(out.report.ran).toMatchObject({ ok: true, result: { version: 'one', replay: true } });
    // The leg ran in a scratch worktree at the recorded head, and its write is recorded as a
    // would-be one — the home checkout itself is untouched (R-BTN-84: no write, no close).
    expect(out.report.would_have_written).toEqual([expect.stringMatching(/leg-ran-T-1\.txt$/)]);
    expect(out.report.inputs).toEqual([]);
    // Replay wrote nothing to Baton: no claim, no leg, no history row, no event (G-BTN-74).
    expect(await rows<{ n: number }>('SELECT count(*) AS n FROM claims')).toEqual([{ n: before.claims }]);
    expect(await rows<{ n: number }>('SELECT count(*) AS n FROM claim_legs')).toEqual([{ n: before.legs }]);
    expect(await rows<{ n: number }>('SELECT count(*) AS n FROM ticket_history')).toEqual([{ n: before.history }]);
    expect(await rows<{ n: number }>('SELECT count(*) AS n FROM events')).toEqual([{ n: before.events }]);
  });

  it('R-BTN-144\'s replay environment: no write credential reaches the leg, and the masked report carries nothing it would leak', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    await repo.runner(`s48-env-${process.pid}`).runOnce();
    const out = await replay(['--env', 'MY_PROVIDER_TOKEN']);
    expect(out.code).toBe(0);
    const result = out.report.ran.result as { env_keys: string[]; has_token: boolean; my_token: string | null };
    // The allowlist: PATH, LANG, TZ, TERM, the isolated HOME, the named secret — never
    // SSH_AUTH_SOCK or anything else of the runner's own.
    expect(result.env_keys.filter((n) => !['PATH', 'LANG', 'TZ', 'TERM', 'HOME', 'MY_PROVIDER_TOKEN', 'BATON_REPLAY'].includes(n))).toEqual([]);
    // The leg saw the named token, and the masked report never carries it (R-BTN-144): the
    // result's copy of the value leaves as `***`.
    expect(result.has_token).toBe(true);
    expect(result.my_token).toBe('***');
    expect(readFileSync(join(work.at(-1)!), 'utf8')).not.toContain('tok-secret-value-0123456789');
  });

  it('a leg marked replay_safe: false is refused', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup({ unsafe: true });
    await repo.sync();
    await repo.runner(`s48-unsafe-${process.pid}`).runOnce();
    const out = await replay([]);
    expect(out.code).toBe(1);
    expect(out.report.refused).toMatch(/replay_safe.*false/);
    expect(out.report.ran).toBeUndefined();
  });

  it('--against <sha> compares the scripts at that sha on the same inputs: the same sha agrees, a changed script differs', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    const recorded = repo.head();
    await repo.runner(`s48-against-${process.pid}`).runOnce();
    // The same scripts again: the comparison agrees.
    const same = await replay(['--against', recorded]);
    expect(same.code).toBe(0);
    expect(same.report.against).toMatchObject({ sha: recorded, same: true });
    // A changed script at a new sha: the comparison differs (R-BTN-143 does not bind --against).
    repo.scriptVersion = 'two';
    repo.writeScript();
    const moved = repo.commit('a different implement script');
    const diff = await replay(['--against', moved]);
    expect(diff.code).toBe(0);
    expect(diff.report.against).toMatchObject({ sha: moved, same: false });
    expect((diff.report.against.ran as { result: { version: string } }).result.version).toBe('two');
    expect((diff.report.ran.result as { version: string }).version).toBe('one');
  });

  it('a current source whose version moved since the run stops the replay; --accept-moved runs it and the report says so', async () => {
    repo = new Repo(true);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    await repo.runner(`s48-moved-${process.pid}`).runOnce();
    // The tracker edits the ticket with no commit and no sync: the version the run recorded is
    // no longer the store's.
    const store = repo.readStore();
    store.tickets = store.tickets.map((t) => (t.id === 'T-1' ? { ...t, body: 'Edited after the run, in the tracker alone.' } : t));
    store.rev = 6;
    repo.writeStore(store);
    const refused = await replay([]);
    expect(refused.code).toBe(1);
    expect(refused.report.refused).toMatch(/ticket moved since the run/);
    expect(refused.report.version_check).toMatchObject({ how: 'current', ok: false, recorded_version: expect.stringMatching(/^5:/) });
    expect(refused.report.ran).toBeUndefined();
    // Deliberately: the replay runs, and the report says the content moved.
    const accepted = await replay(['--accept-moved']);
    expect(accepted.code).toBe(0);
    expect(accepted.report).toMatchObject({ accepted_moved: true });
    expect(accepted.report.version_check).toMatchObject({ ok: false });
    expect(accepted.report.ran.ok).toBe(true);
  });

  it('a pinned source replays at the recorded version: the file may have moved on the branch, the recorded bytes did not', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    await repo.runner(`s48-pinned-${process.pid}`).runOnce();
    // The ticket file is edited and committed after the run: the ticket's version (the old
    // file's blob id) still names the bytes the run read, and replay reads at it (§4.2).
    writeFileSync(join(repo.dir, 'tickets', 'one.mdx'), '---\nid: T-1\ntitle: One, edited\ntier: routine\n---\nA different body.\n');
    repo.commit('the ticket edited');
    const out = await replay([]);
    expect(out.code).toBe(0);
    expect(out.report.version_check).toMatchObject({ how: 'pinned', ok: true });
    expect(out.report.ran.ok).toBe(true);
  });

  it('a tampered input fails its digest; an honest one passes it', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    // A plan beside the leg, and a run recorded by a hand-driven advance carrying the input —
    // the report a runner makes at a run's start (R-BTN-82), here with an input to check.
    writeFileSync(join(repo.dir, 'plan.txt'), 'the plan as the run read it\n');
    const planSha = repo.commit('the plan');
    const uri = `git:immediately-run/docs@${planSha}:plan.txt`;
    const { secret } = await register('vm-a', { courses: [{ repository: 'docs', course: 'create-pr', version: 1 }] });
    const claim = await claimItem('vm-a', secret, { ticket_id: 'docs:T-1' });
    const started = await advance('vm-a', secret, claim.json.claim_id, {
      leg: 'implement',
      run_inputs: {
        ticket: { version: repo.blob('tickets/one.mdx'), read_digest: sha256(readFileSync(join(repo.dir, 'tickets', 'one.mdx'), 'utf8')) },
        inputs: [{ name: 'plan', uri, digest: sha256('the plan as the run read it\n') }],
      },
    });
    expect(started.json).toMatchObject({ ok: true });
    expect(await rows('SELECT name, uri, digest FROM leg_run_inputs WHERE name != \'\'')).toEqual([{ name: 'plan', uri, digest: sha256('the plan as the run read it\n') }]);

    const honest = await replay([]);
    expect(honest.code).toBe(0);
    expect(honest.report.inputs).toEqual([{ name: 'plan', uri, digest: sha256('the plan as the run read it\n'), ok: true }]);

    // Tampered: the recorded digest names bytes the pointer does not hold — a substitution.
    await rows("UPDATE leg_run_inputs SET digest = ? WHERE name = 'plan'", sha256('something else entirely\n'));
    const tampered = await replay([]);
    expect(tampered.code).toBe(1);
    expect(tampered.report.refused).toMatch(/failed its digest/);
    expect(tampered.report.inputs[0]).toMatchObject({ name: 'plan', ok: false, why: expect.stringMatching(/digest to/) });
    expect(tampered.report.ran).toBeUndefined();
  });

  it('the runs read is an owner\'s or an administrator\'s: a worker\'s key is refused, and the record names what replay needs', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    await repo.runner(`s48-read-${process.pid}`).runOnce();
    // The read itself, with the administrator's API key: each field replay stands on.
    const read = await call(`/v1/repositories/docs/tickets/T-1/legs/implement/runs`, { headers: { Authorization: `Bearer ${key.key}` } });
    expect(read.status).toBe(200);
    const body = (await read.json()) as { default_branch: string; runs: { run: number; run_id: string; snapshot_sha: string; head_sha: string; ticket: { version: string } }[] };
    expect(body.default_branch).toBe('main');
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ run: 1, run_id: expect.stringMatching(/^r_/), snapshot_sha: repo.head(), head_sha: repo.head(), ticket: { version: repo.blob('tickets/one.mdx') } });
    // A worker credential may not read it (§14), and so replay with one refuses at the read.
    const worker = await call(`/v1/repositories/docs/tickets/T-1/legs/implement/runs`, { headers: { Authorization: `Bearer ${TOKENS['vm-a']}` } });
    expect(worker.status).toBe(403);
  });

  it('the recorded snapshot must be code the default branch holds (R-BTN-143): an off-branch sha is refused, --against excepted', async () => {
    repo = new Repo(false);
    repos.push(repo);
    await repo.setup();
    await repo.sync();
    await repo.runner(`s48-off-${process.pid}`).runOnce();
    // A commit on a side branch, and the claim's snapshot rewritten to it: the run's record now
    // names a sha the default branch does not hold.
    const g = (...a: string[]) => execFileSync('git', ['-C', repo.dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
    g('checkout', '-q', '-b', 'side');
    writeFileSync(join(repo.dir, 'tickets', 'two.mdx'), '---\nid: T-2\ntitle: Two\ntier: routine\n---\nOff the branch.\n');
    g('add', '-A');
    g('commit', '-qm', 'off the default branch');
    const side = execFileSync('git', ['-C', repo.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    g('checkout', '-q', 'main');
    await rows('UPDATE claims SET snapshot_sha = ? WHERE ticket_id = ?', side, 'docs:T-1');
    const out = await replay([]);
    expect(out.code).toBe(1);
    expect(out.report.refused).toMatch(/not code the default branch main holds/);
    expect(out.report.ran).toBeUndefined();
    // The flag's sha is never ancestry-checked (R-BTN-143's last line) — but the recorded one
    // still is, so the refusal stands with --against given too.
    const withFlag = await replay(['--against', side]);
    expect(withFlag.code).toBe(1);
    expect(withFlag.report.refused).toMatch(/R-BTN-143/);
  });
});
