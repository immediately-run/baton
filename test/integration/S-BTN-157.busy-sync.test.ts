// S-BTN-157 a busy sync is not a success (B-89, BATON_SPEC R-BTN-62, R-BTN-74): `baton repo sync`
// run while another run's observation is outstanding — the run that follows a failed one, within
// R-BTN-62's ten minutes — used to answer `busy`, post nothing and exit 0: a green check for a
// held board. Must hold: the run waits `--busy-retry` and takes a fresh number once, and the
// board lands when the first number has been released by then; a second `busy` is `busy:again`
// and exits 1; `--busy-retry 0` takes no retry (`busy`, exit 1); and the sync workflow annotates
// every outcome — a notice for a post, a warning for a held board, an error for a failed run.
// Node only: it writes a real repository and runs the workflow's own step against a log.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call as hostCall } from '#host';
import { BUSY_RETRY_S, initMain, parseSyncArgs, syncMain, syncWorkflow, type SyncArgs } from '../../src/defaults/cli';
import { ORIGIN, observe, rows, setClock, syncToken } from '../helpers';

// The harness's clock, a minute behind the real one `syncMain` signs with (S-BTN-156's reason).
const T0 = Date.now() - 60_000;
let minutes = 1;
const later = () => setClock(T0 + (minutes += 1) * 60_000);
/** The repository the checkout's origin names: `docs`, the local host's. */
const SLUG = 'immediately-run/docs';

/** A checkout with a tickets/ wiki as `baton repo init` writes it, committed. */
function repoWithTickets(): string {
  const dir = mkdtempSync(join(tmpdir(), 'baton-s157-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'relay@test');
  g('config', 'user.name', 'relay test');
  g('remote', 'add', 'origin', `https://github.com/${SLUG}.git`);
  mkdirSync(join(dir, 'tickets'), { recursive: true });
  writeFileSync(join(dir, 'tickets', 'one.mdx'), '---\nid: T-1\ntitle: One\n---\n');
  return dir;
}

let dir: string;
let token: string;
beforeEach(async () => {
  minutes = 1;
  await setClock(T0);
  dir = repoWithTickets();
  expect(await initMain([], { root: dir, log: () => {} })).toBe(0);
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'], { stdio: 'ignore' });
  writeFileSync(join(dir, '.baton', 'facts.json'), '[]');
  // The harness's sync token, spent through `--token` as the CI identity's run spends its own.
  token = await syncToken();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The number a failed run leaves outstanding: handed out by the host's route, never posted. */
async function heldNumber(): Promise<number> {
  const o = await observe();
  expect(o.status).toBe(200);
  return o.json.observation;
}

/** One sync from the checkout with the workflow's flags plus `extra`, its exit code, every line
 *  it logged and each wait's length. `busy` answers the run's first observation `sync-busy` — the
 *  failed run's number in flight, R-BTN-62 — and lets its retry's observation through to the host;
 *  `at` runs where the retry waits, and `then` is the host's clock from then on (a run that waited
 *  past R-BTN-62's ten minutes sees the stale number voided). */
async function sync(extra: string[], opts: { busy?: boolean; at?: () => Promise<void>; then?: number } = {}): Promise<{ code: number; lines: string[]; sleeps: number[] }> {
  const facts = join(dir, '.baton', 'facts.json');
  const args: Omit<SyncArgs, 'log'> = parseSyncArgs(['--root', dir, '--url', ORIGIN, '--facts', facts, '--token', token, ...extra], {});
  const lines: string[] = [];
  const sleeps: number[] = [];
  let busyLeft = opts.busy ? 1 : 0;
  const transport = (req: Request): Promise<Response> => {
    if (new URL(req.url).pathname === '/v1/sync/observation' && busyLeft > 0) {
      busyLeft--;
      return Promise.resolve(new Response(JSON.stringify({ code: 'sync-busy', message: 'observation is still outstanding' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
    }
    return hostCall(req);
  };
  const code = await syncMain({
    ...args,
    transport,
    sleep: async (ms) => {
      sleeps.push(ms);
      await opts.at?.();
      if (opts.then) await setClock(opts.then);
    },
    log: (l) => lines.push(l),
  });
  return { code, lines, sleeps };
}

/** Every repository's tickets, by qualified id. */
const boardOf = () => rows<{ id: string }>('SELECT id FROM tickets ORDER BY id');

describe('S-BTN-157 a busy sync is not a success', () => {
  it('a held number is waited out, then retried once with a fresh number, and the board lands', async () => {
    await later();
    // The failed run's number, and a run that starts while it is outstanding.
    await heldNumber();
    let postsDuringWait = 0;
    const { code, lines, sleeps } = await sync(['--busy-retry', '90'], {
      busy: true,
      // The retry waits ten minutes (past R-BTN-62's ten, as the run that started long enough ago
      // would have): the failed run's number is voided, and the retry's own observation takes the
      // next. Nothing posted before that — the wait is the first thing after the refusal.
      then: T0 + 12 * 60_000,
      at: async () => {
        postsDuringWait = (await boardOf()).length;
      },
    });
    expect(postsDuringWait).toBe(0);
    // One wait, of the flag's length, and never a loop.
    expect(sleeps).toEqual([90_000]);
    expect(lines[0]).toBe('baton: busy — another run\'s reading is in flight (R-BTN-62); retrying once in 90s, with a fresh number');
    // The retry voided the stale number, took its own and posted.
    expect(code).toBe(0);
    expect(lines.at(-1)).toMatch(/^baton: advanced at /);
    expect(await boardOf()).toEqual([{ id: `${SLUG.split('/')[1]}:T-1` }]);
  });

  it('the default retry is the workflow’s minute', () => {
    expect(BUSY_RETRY_S).toBe(60);
    expect(parseSyncArgs(['--busy-retry', '30'], {}).busyRetryS).toBe(30);
    for (const bad of ['0.5', '-1', 'soon', '601', '']) {
      expect(() => parseSyncArgs(['--busy-retry', bad], {})).toThrow(/--busy-retry .*: a whole number of seconds, at most 600/);
    }
    expect(parseSyncArgs([], {}).busyRetryS).toBeUndefined(); // then BUSY_RETRY_S
  });

  it('a second busy is busy:again, and the run exits 1 — a held board is never a green check', async () => {
    await later();
    await heldNumber();
    // The retry's own observation still finds the failed run's number outstanding (under ten
    // minutes): a `busy` retry is still `busy`, and the run says so — nothing posted never reads
    // as a green check.
    const { code, lines, sleeps } = await sync(['--busy-retry', '60'], { busy: true });
    expect(sleeps).toEqual([60_000]);
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(/^baton: busy:again at /);
    expect(await boardOf()).toEqual([]);
  });

  it('--busy-retry 0 waits for nothing: busy is exit 1 at once, and no retry is named', async () => {
    await later();
    await heldNumber();
    // The subject of B-89: `busy` — exit 0 with nothing posted — now exits 1 and says why.
    const { code, lines, sleeps } = await sync(['--busy-retry', '0'], { busy: true });
    expect(sleeps).toEqual([]);
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(/^baton: busy at .*observation: sync-busy$/);
  });

  it('the sync workflow annotates what the run posted: a notice, a warning for a held board, an error for a failure', () => {
    const wf = syncWorkflow('immediately-run/baton@' + 'a'.repeat(40));
    // The sync's outcome is kept in a log, its exit preserved, and the annotation runs even so.
    expect(wf).toContain('node .baton-cli/cli/baton.mjs repo sync --latest main 2>&1 | tee sync.log');
    // Round one's blocking 1: the workflow must not pass a flag the pinned CLI does not know.
    expect(wf).not.toContain('--busy-retry');
    expect(wf).toContain('set -o pipefail');
    expect(wf).toContain('if: ${{ !cancelled() }}');
    // The step's script, run verbatim as GitHub runs it, one annotation per outcome. `sync.log`
    // is written as `tee` writes it — the CLI's line without a timestamp — and each case carries
    // the stamped copy the step's stdout shows beside it: the grep is unanchored, so neither the
    // stamp nor a traced line hides the outcome (B-89 round two, finding 10).
    const script = 'outcome="' + wf.split('          outcome="')[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
    const stamped = (line: string) => `2026-10-24T09:40:43.9024230Z ${line}\n`;
    const annotations = (lines: string[]): string => {
      writeFileSync(join(dir, 'sync.log'), lines.join(''));
      return execFileSync('bash', ['-c', script], { encoding: 'utf8', cwd: dir });
    };
    const retry = 'baton: busy — another run’s reading is in flight; retrying once in 60s, with a fresh number';
    const outcome = 'baton: advanced at 197b21c123 — advance over main; accepted';
    expect(annotations([stamped(retry), retry, stamped(outcome), outcome])).toBe('::notice title=baton sync::the board is posted — advanced\n');
    // A prefixed copy alone, and a traced line in front: both read the same.
    expect(annotations([stamped(outcome)])).toContain('the board is posted — advanced');
    expect(annotations([`+ echo '${outcome}'`])).toContain('the board is posted — advanced');
    // A line that names no sha is not an outcome, even after the real one: the run's is kept.
    expect(annotations([outcome, "+ printf '%s\\n' 'baton: busy — retrying once in 60s'\n"])).toContain('the board is posted — advanced');
    expect(annotations(['baton: busy:again at 197b21c123 — observation: sync-busy\n'])).toContain('::warning title=baton sync held::');
    expect(annotations(['baton: busy at 197b21c123 — observation: sync-busy\n'])).toContain('::warning title=baton sync held::');
    // `held` posted nothing: a warning that says so, never "the board is posted" (round one's 5).
    const held = annotations(['baton: held at 197b21c123 — force over main; snapshot-rejected\n']);
    expect(held).toContain('::warning title=baton sync held::a force post was refused into holding; nothing was posted');
    expect(held).not.toContain('the board is posted');
    expect(annotations(['baton: failed:unavailable at 197b21c123 — observation: unavailable\n'])).toContain('::error title=baton sync failed::the run posted nothing (outcome: failed:unavailable)');
    // No outcome line at all — `npm ci` failed before the CLI ran — names that case, rather
    // than sending an operator to a sync step that never ended one (round one's 9).
    expect(annotations(['added 280 packages, and audited 281 packages in 12s\n'])).toContain('::error title=baton sync failed::the sync ended no sync, so it posted nothing');
    expect(annotations([''])).toContain('the sync ended no sync');
  });

  it('this repository’s own workflow carries the same annotation, and passes no flag its pin lacks', () => {
    const ownWf = readFileSync(join(import.meta.dirname, '..', '..', '.github', 'workflows', 'baton-sync.yml'), 'utf8');
    expect(ownWf).toContain('repo sync --latest main 2>&1 | tee sync.log');
    expect(ownWf).toContain('if: ${{ !cancelled() }}');
    expect(ownWf).toContain('::warning title=baton sync held::');
    expect(ownWf).toContain('        timeout-minutes: 10\n');
    // The step's script is the generator's, line for line: one behaviour, two files.
    const generated = syncWorkflow('immediately-run/baton@' + 'a'.repeat(40));
    const stepOf = (wf: string) => wf.slice(wf.indexOf('        run: |\n          # The outcome'), wf.indexOf('\n\n', wf.indexOf('          esac')));
    expect(stepOf(ownWf)).toBe(stepOf(generated));
    // Neither invokes the CLI with a flag its pin (`838b5ec`) does not know: `--busy-retry`
    // arrives with the pin, not before it (round one, blocking 1).
    expect(ownWf).not.toMatch(/repo sync .*--busy-retry/);
  });
});
