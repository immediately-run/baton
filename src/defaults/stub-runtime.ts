// Standard leg execution and verification (R-BTN-131, S-BTN-104, S-BTN-105).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newestWrite } from '../runner/log';
import { splitWords } from './agent-words';
import { lastLine, requireAnswer } from './answer';
import { DEFAULT_BRANCH_PATTERN, branchMatches, matchPatterns } from './course-pr';
import { COMMENTING_LEGS, PR_URL, prClose, testsClose, type CloseCtx } from './pr-close';
import { deliveredDetail, findDelivered, ticketRepositories, verifyDelivered, verifyPrOpen, type PrExec } from './pr-verify';
import { positionOf, type AgentLeg, type StubConfig } from './stub-config';
import { bareTicketId, closeTicket, execRaw, RUN_TESTS_TIMEOUT_MS, ticketsBranch } from './ticket-state';
import type { BatonJson, CourseEntry } from './repo-source';

const OUTPUT_MAX = 64 * 1024 * 1024;
const AGENT_IDLE_MS = 900_000;
const LEG_CEILING_MS = 18_000_000;

interface LegCtx extends CloseCtx {
  ticket: CloseCtx['ticket'] & { file?: string | null };
  claim?: CloseCtx['claim'] & { station?: string };
  snapshot?: { sha?: string };
  signed_control?: { overrides?: string; agent_command?: string; course?: string };
  signal?: AbortSignal;
  run?: number;
}

type Conclusion = { cause: 'agent_concluded_idle'; idle_ms: number; quiet_signals: string[] }
  | { cause: 'agent_concluded_absolute'; ceiling_ms: number };

function defaultBranch(ctx: CloseCtx): string | null | undefined {
  return ctx.default_branch ?? (process.env.BATON_DEFAULT_BRANCH || undefined);
}

function gitAt(checkout: string, args: string[], opts?: { maxBuffer?: number }): string {
  return execRaw('git', ['-C', checkout, ...args], undefined, opts);
}

function show(checkout: string, sha: string, rel: string, maxBuffer = OUTPUT_MAX): string {
  return gitAt(checkout, ['show', `${sha}:${rel}`], { maxBuffer });
}

function hasPath(checkout: string, sha: string, rel: string): boolean {
  // An empty listing means absent. A failed probe is not an absent file.
  return gitAt(checkout, ['ls-tree', '--name-only', sha, '--', rel]).trim() !== '';
}

function ticketTextOf({ ticket, checkout }: LegCtx): string | null {
  try { return ticket.file ? readFileSync(ticket.file, 'utf8') : ticket.path ? readFileSync(join(checkout, ticket.path), 'utf8') : null; }
  catch { return null; }
}

function courseEntry(settings: BatonJson, course: string): Partial<CourseEntry> {
  return (Array.isArray(settings.courses) ? settings.courses : []).find((c) => c && c.id === course) ?? {};
}

function matchingHeads(ctx: LegCtx, entry: Partial<CourseEntry>): { wanted: string[]; heads: string[] } {
  const id = bareTicketId(ctx.ticket);
  const wanted = matchPatterns([entry.branch_pattern ?? DEFAULT_BRANCH_PATTERN, entry.previous_branch_pattern]
    .filter((p): p is string => typeof p === 'string' && p !== '')).map((p) => p.replace(/\{ticket\}/g, id));
  const heads = gitAt(ctx.checkout, ['ls-remote', '--heads', 'origin']).split('\n').filter((line) => {
    const ref = line.split('\t')[1] ?? '';
    return ref.startsWith('refs/heads/') && wanted.some((p) => branchMatches(p, ref.slice('refs/heads/'.length)));
  });
  return { wanted, heads };
}

const legRun: PrExec = (cmd, args, cwd) => {
  try { return execRaw(cmd, args, cwd, { maxBuffer: OUTPUT_MAX }).trim(); }
  catch (e) {
    const stderr = (e as { stderr?: string } | null)?.stderr;
    const why = (typeof stderr === 'string' ? stderr.trim().split('\n')[0] : '') || (e instanceof Error ? e.message : String(e));
    throw new Error(`${cmd} ${args.join(' ')} failed: ${why}`);
  }
};

/** Load only the override's snapshot bytes; the standard close always stays in force. */
export function makeLeg({ course, leg, reads, spec, overridePath }: StubConfig) {
  const standard = spec.tests
    ? async (ctx: LegCtx) => runTests(ctx, course, leg)
    : (ctx: LegCtx) => runAgent(ctx, { course, leg, names: reads === 'prs' && COMMENTING_LEGS.has(leg), spec });
  const closeLeg = spec.tests ? testsClose : reads === 'prs' ? prClose : closeTicket;
  return {
    async run(ctx: LegCtx) {
      const sha = ctx.snapshot?.sha;
      if (typeof sha !== 'string' || sha === '') throw new Error('the leg has no snapshot to read its override at');
      const overrideSha = ctx.signed_control?.overrides;
      const readSha = !spec.tests && typeof overrideSha === 'string' && overrideSha !== '' ? overrideSha : sha;
      if (!hasPath(ctx.checkout, readSha, overridePath)) return standard(ctx);
      const dir = mkdtempSync(join(tmpdir(), 'baton-override-'));
      try {
        const file = join(dir, basename(overridePath));
        writeFileSync(file, show(ctx.checkout, readSha, overridePath));
        const mod: { run?: (ctx: LegCtx, standard: (ctx: LegCtx) => Promise<unknown>) => unknown } = await import(pathToFileURL(file).href);
        if (typeof mod.run !== 'function') throw new Error(overridePath + ' exports no run(ctx, standard)');
        return await mod.run(ctx, standard);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    close(ctx: CloseCtx, result: Parameters<typeof closeLeg>[1]) {
      return closeLeg({ ...ctx, default_branch: defaultBranch(ctx) }, result);
    },
    async handoff() { return null; },
  };
}

async function runAgent(ctx: LegCtx, { course, leg, names, spec }: { course: string; leg: string; names: boolean; spec: AgentLeg }) {
  const { ask, verify, pushes, delivered } = spec;
  const heading = `baton: ${course}/${leg} ticket ${ctx.ticket.id}: `;
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== 'string' || sha === '') throw new Error('the leg has no snapshot to read .baton/baton.json at');
  // B-127: where the repository requires owner-signed control, `agent_command` and
  // `agent_wrapper` are read at the signed commit `ctx.signed_control.agent_command` names —
  // the last owner-signed version of `.baton/baton.json`, whose signature the runner verified —
  // so an unsigned change to the settings never picks the agent every leg runs.
  const settingsSha = typeof ctx.signed_control?.agent_command === 'string' && ctx.signed_control.agent_command !== '' ? ctx.signed_control.agent_command : sha;
  const settings: BatonJson = JSON.parse(show(ctx.checkout, settingsSha, '.baton/baton.json'));
  // B-83: the snapshot's settings stay authoritative; BATON_AGENT_COMMAND — the harness command
  // `baton run --harness` chose — fills their absence, never overrides their choice.
  const settingsCommand = typeof settings.agent_command === 'string' && settings.agent_command !== '' ? settings.agent_command : process.env.BATON_AGENT_COMMAND ?? '';
  if (settingsCommand === '') throw new Error('.baton/baton.json names no agent_command — run `baton repo init --agent opencode` (or --agent claude-code, or --agent-command <cmd>); baton run --harness <harness> runs its command when the settings name none');
  // §6.10 (R-BTN-131, B-167): the course's choice of model is the repository's own — the
  // words `agent_command` carries, run exactly as written. Baton delivers no advice and core
  // resolves no route; a repository that picks its model at run time writes a leg override
  // (R-BTN-131) that reads its own configuration or the instance views (R-BTN-99).
  const agentWords = splitWords(settingsCommand);
  const agentCommand = agentWords.join(' ');
  const entry = courseEntry(settings, course);
  const patterns = [entry.branch_pattern, entry.previous_branch_pattern].filter((p): p is string => typeof p === 'string' && p !== '');
  // Read from the checkout (including a pathless ticket's materialized file), before the agent.
  const ticketText = verify || pushes ? ticketTextOf(ctx) : null;
  const redEdge = ctx.claim?.station === 'pr-open' || ctx.claim?.station === 'fixed';
  const prHeads = () => matchingHeads(ctx, entry).heads.sort().join('\n');
  // B-231, B-255: a fix of a red head must push, unless its PRs may be in other repositories.
  const headsBefore = pushes && redEdge && ticketRepositories(ticketText, settings.repos).length === 0 ? prHeads() : '';
  // B-127: instructions and settings use their respective owner-signed commits when required.
  const signedCourse = ctx.signed_control?.course;
  const courseSha = typeof signedCourse === 'string' && signedCourse !== '' ? signedCourse : sha;
  const rel = `.baton/courses/${course}/legs/${leg}.md`;
  const text = hasPath(ctx.checkout, courseSha, rel) ? show(ctx.checkout, courseSha, rel) : null;
  const dir = text == null ? null : mkdtempSync(join(tmpdir(), 'baton-leg-'));
  const instructions = dir == null ? '' : join(dir, `${leg}.md`);
  try {
    if (text != null) writeFileSync(instructions, text);
    // B-84: no shell stands between the stub and the agent, and stdin is never an open pipe — the
    // two halves of the hang that burned claims to reap. The command string splits into words as
    // sh would (quotes; no substitutions) and runs as argv, the ticket, the leg and the checkout
    // appended last; stdin closes at spawn (below), and stdout and stderr are captured pipes — and
    // the command's exit is the agent's completion, which its own contract (the leg .md's header)
    // requires it to mean.
    const [command, ...words] = agentWords;
    if (command === undefined) throw new Error('.baton/baton.json names no agent_command to run');
    // B-95: the repository's `agent_wrapper` — a host's BATON_AGENT_WRAPPER first, else the
    // snapshot's setting — is one more command, split the same way, whose words go in front of the
    // agent's argv. Baton only composes it; what it does with stdio, time or the log is its own.
    const envWrapper = process.env.BATON_AGENT_WRAPPER;
    const wrapper = typeof envWrapper === 'string' && envWrapper.trim() !== '' ? envWrapper : settings.agent_wrapper;
    if (wrapper != null && (typeof wrapper !== 'string' || wrapper.trim() === '')) throw new Error('.baton/baton.json\'s agent_wrapper is not a command');
    const [wrapped, ...wrapping] = wrapper == null ? [] : splitWords(wrapper);
    const argv = wrapped === undefined
      ? [command, ...words, ctx.ticket.id, leg, ctx.checkout]
      : [wrapped, ...wrapping, command, ...words, ctx.ticket.id, leg, ctx.checkout];
    // Verbose (B-23's slice): the runner asked, so say on stderr — which it drains into its log —
    // the one line an operator needs: the local command actually completing this leg, resolved
    // here at the claim's snapshot, and the wrapper in front of it when one is named.
    if (process.env.BATON_VERBOSE) process.stderr.write(heading + 'agent_command: ' + agentCommand + (wrapper != null ? '; wrapper: ' + wrapper : '') + '; argv: ' + argv.join(' ') + '\n');
    // B-108's streaming half (2026-10-24): the agent runs under spawn — its stdout accumulated
    // here for the answer protocol, and when the runner asked (BATON_VERBOSE) both streams
    // mirrored to this stub's stderr, which the runner pipes and drains into its log: a live
    // leg is watchable line by line instead of silence until the exit. The bound execFile kept
    // is kept too: an agent whose output outgrows the cap is killed and refused.
    // B-108's bounds (the owner, 2026-10-22): the wait below ends at the earliest of the agent's
    // exit, AGENT_IDLE_MS and LEG_CEILING_MS — an agent's completion is its exit or its silence,
    // whichever comes first. The signals the idle bound reads, resolved before the spawn: the
    // wrapper's log (B-95's example tees to .baton/logs/<ticket>-<leg>.log, whose mtime is
    // streamed activity even when the stub cannot see the pipe) and, when the agent's command
    // names a harness the stub knows, that harness's own store — opencode's data directory (its
    // session db, and any directory it keys by this checkout), claude-code's projects directory
    // keyed the same way. No session id: the store's newest write keyed by the stub's own cwd is
    // the agent's activity.
    const startedAt = new Date().getTime();
    const wrapperLog = join(ctx.checkout, '.baton', 'logs', `${ctx.ticket.id}-${leg}.log`);
    const agentBin = basename(command);
    const storePaths: string[] = [];
    if (agentBin === 'opencode' || agentBin === 'claude') {
      const dataHome = process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME !== '' ? process.env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
      const dashed = ctx.checkout.split('/').join('-');
      if (agentBin === 'opencode') {
        const root = join(dataHome, 'opencode');
        storePaths.push(join(root, 'opencode.db'), join(root, 'opencode.db-wal'), join(root, 'opencode.db-shm'), join(root, 'project', dashed));
        const key = createHash('sha1').update(ctx.checkout).digest('hex');
        let instances: string[] = [];
        try { instances = readdirSync(join(root, 'snapshot')); } catch { /* none yet */ }
        for (const i of instances) storePaths.push(join(root, 'snapshot', i, key));
      } else {
        storePaths.push(join(process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR !== '' ? process.env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude'), 'projects', dashed));
      }
    }
    // The agent's last output (2026-10-24; B-256): the last lines of both streams, bounded — what a
    // failed leg's error carries, so the runner's log alone can diagnose it, whether the agent
    // exited non-zero or exited 0 and the checks after it failed.
    const lastOutput = (so: string, se: string) => (so + '\n' + se).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '').slice(-20).join('\n  ');
    const answerRule = ask && `print ${ask.values.join(' or ')} as your last line${names ? ", then the URL of the PR to write it on when it is not the checkout branch's" : ''}`;
    const received = await new Promise<{ text: string; stderr: string; conclusion: Conclusion | null }>((resolve, reject) => {
      const echo = process.env.BATON_VERBOSE === '1';
      const child = spawn(argv[0], argv.slice(1), {
        cwd: ctx.checkout, stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env, BATON_COURSE: course, BATON_LEG: leg, BATON_INSTRUCTIONS: instructions, BATON_TICKET_FILE: ctx.ticket.file ?? ctx.ticket.path ?? '',
          ...(answerRule ? { BATON_ANSWER: answerRule, ...(ask?.name === 'verdict' ? { BATON_VERDICT: answerRule } : {}) } : {}),
        },
      });
      let so = '', se = '';
      // B-108: stdout is the one signal read off the pipe — timestamped as it drains.
      let lastOut = startedAt;
      let watch: NodeJS.Timeout | undefined;
      child.stdout.on('data', (c) => {
        lastOut = new Date().getTime();
        so += c;
        if (so.length > OUTPUT_MAX) { if (watch != null) clearInterval(watch); child.kill('SIGKILL'); reject(new Error(`the agent printed more than ${OUTPUT_MAX} bytes`)); return; }
        if (echo) process.stderr.write(c);
      });
      child.stderr.on('data', (c) => { if (se.length < 2048) se = (se + String(c)).slice(-2048); if (echo) process.stderr.write(c); });
      child.on('error', (e) => { if (watch != null) clearInterval(watch); reject(e); });
      // B-227: a release (the runner's abort line, `ctx.signal`) stops the agent at once — its
      // TERM, then KILL after a grace — so the leg reaches its safe point inside the runner's
      // immediate-stop window and the claim is released with its hand-off, not left to the reaper.
      let stopped: string | null = null;
      let conclusion: Conclusion | null = null;
      const onAbort = () => {
        if (stopped != null) return;
        stopped = String(ctx.signal?.reason ?? 'release');
        if (watch != null) clearInterval(watch);
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
      };
      if (ctx.signal) { if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true }); }
      // B-108: the bounds' watch. Either bound concluding is the same act: the stub kills the
      // agent (it is the parent; SIGKILL to the child alone), takes the received stdout as the
      // agent's output, and the wait ends exactly as an exit would — the last-line contract, the
      // forge verification, the checks judging the work as it stands. Idle concludes only when
      // EVERY signal is quiet past the bound; any live one vetoes it however long the rest stay
      // quiet, and the ceiling alone may catch an agent still working.
      const signals = (): [string, number][] => [
        ['stdout', lastOut],
        ['wrapper-log', newestWrite(wrapperLog)],
        ...(storePaths.length > 0 ? [['harness-store', storePaths.reduce((best, p) => Math.max(best, newestWrite(p)), 0)] as [string, number]] : []),
      ];
      const finishWatch = (conclusion: Conclusion) => {
        if (watch != null) clearInterval(watch);
        child.kill('SIGKILL');
        process.stderr.write(heading + 'the agent ' + conclusion.cause + (conclusion.cause === 'agent_concluded_idle' ? ' — quiet past ' + Math.round(AGENT_IDLE_MS / 60000) + ' minutes on ' + conclusion.quiet_signals.join(', ') : ' — the leg\'s ceiling of ' + Math.round(LEG_CEILING_MS / 60000) + ' minutes') + '; the stdout it received is its output\n');
        resolve({ text: so, stderr: se, conclusion });
      };
      watch = setInterval(() => {
        if (stopped != null || conclusion != null) return;
        const now = new Date().getTime();
        if (now - startedAt >= LEG_CEILING_MS) {
          conclusion = { cause: 'agent_concluded_absolute', ceiling_ms: LEG_CEILING_MS };
          finishWatch(conclusion);
          return;
        }
        const all = signals();
        if (all.every(([, at]) => now - at >= AGENT_IDLE_MS)) {
          conclusion = { cause: 'agent_concluded_idle', idle_ms: AGENT_IDLE_MS, quiet_signals: all.map(([name]) => name) };
          finishWatch(conclusion);
        }
      }, Math.max(250, Math.round(AGENT_IDLE_MS / 5)));
      watch.unref?.();
      // A stopped agent is done when it exits: a child of its own may still hold its pipes open
      // (`close` would wait for that), and the session's end takes whatever is left.
      child.on('exit', () => { if (stopped != null) reject(new Error('the agent was stopped: ' + stopped)); });
      child.on('close', (code, sig) => {
        if (watch != null) clearInterval(watch);
        if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
        if (stopped != null) { reject(new Error('the agent was stopped: ' + stopped)); return; }
        if (conclusion != null) return; // a bound concluded; the kill's own close changes nothing
        if (code === 0) { resolve({ text: so, stderr: se, conclusion: null }); return; }
        // The failure names its cause with a tail, not a single line (2026-10-24).
        reject(new Error('the agent exited ' + (code != null ? 'with code ' + code : 'on signal ' + sig) + '; its last output:\n  ' + lastOutput(so, se)));
      });
    });
    const { text: out, stderr, conclusion } = received;
    const said = lastOutput(out, stderr);
    const failed = (e: unknown) => new Error((e instanceof Error ? e.message : String(e))
      + (said !== '' ? `; the agent's last output:\n  ${said}` : '; the agent printed nothing'));
    if (headsBefore !== '' && prHeads() === headsBefore) {
      const heads = headsBefore.split('\n').map((line) => line.split('\t')[1].slice('refs/heads/'.length) + ' at ' + line.slice(0, 10));
      throw failed(`the ${leg} leg pushed nothing: ${heads.join(', ')} is the head the run-tests gate tested red, unchanged — no fix, no position (B-231)`);
    }
    try {
      const answer = ask ? requireAnswer(out, ask, leg) : null;
      const last = names && !ask ? lastLine(out) : '';
      const on = names ? answer?.pr ?? (PR_URL.test(last) ? last : null) : null;
      const concluded = conclusion ? { conclusion } : {};
      if (verify) {
        const claimed = delivered && !names ? findDelivered(out) : null;
        if (claimed) {
          const shas = verifyDelivered({ checkout: ctx.checkout, shas: claimed.shas, branch: ticketsBranch(ctx.checkout, defaultBranch(ctx)) }, legRun);
          if (process.env.BATON_VERBOSE) process.stderr.write(`${heading}delivered at ${shas.join(', ')}, on the default branch — a person confirms\n`);
          return { suspend: true, reached: 'delivered', next: 'confirm', delivered: shas[0], detail: deliveredDetail(shas, claimed.evidence), ...concluded };
        }
        verifyPrOpen({ checkout: ctx.checkout, ticket: ctx.ticket, branchPatterns: patterns, repositories: ticketRepositories(ticketText, settings.repos) }, legRun);
        if (process.env.BATON_VERBOSE) process.stderr.write(`${heading}the forge verified an open PR on a branch matching ${patterns.join(' or ')}\n`);
      }
      return { ...positionOf(spec, answer?.answer, ctx.run ?? 1), ...(on ? { pr: on } : {}), ...concluded };
    } catch (e) {
      throw failed(e);
    }
  } finally {
    if (dir != null) rmSync(dir, { recursive: true, force: true });
  }
}

/** The script's verdict in `cwd`: green, red with its named cause and last lines, or a throw
 *  when npm could not give one (finding 14: not every failure is the script's red). */
function verdictOf(cwd: string, script: string): { tests: 'green' } | { tests: 'red'; tail: string } {
  try {
    // One run, bounded, stdin never an open pipe (B-84's rule holds for any child), npm
    // inheriting git's non-interactive environment (B-94): a credential prompt or a host-key
    // question fails the run rather than waiting on a terminal the runner does not have.
    execRaw('npm', ['run', script], cwd, { timeoutMs: RUN_TESTS_TIMEOUT_MS, maxBuffer: OUTPUT_MAX });
    return { tests: 'green' };
  } catch (error) {
    const e = error as (NodeJS.ErrnoException & { status?: number; signal?: string; stderr?: string; stdout?: string }) | null;
    // The last lines of both streams, one paragraph (blank lines dropped), so the marker's
    // trailer block stays the message's last.
    const tail = [String(e?.stdout ?? ''), String(e?.stderr ?? '')].join('\n').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '').slice(-20).join('\n');
    const named = (why: string) => ({ tests: 'red' as const, tail: 'npm run ' + script + ' ' + why + (tail ? '; its last lines:\n' + tail : '; it printed nothing') });
    // B-230: a run that never reached the tests is no verdict — red would send a fix leg after
    // code that was never tested (B-167: five red markers, every one `vitest: not found`). The
    // shell's own 126/127 (a command not executable, or not found: the test runner, a missing
    // dependency's bin) and npm's missing script fail the leg naming that, as npm that cannot
    // start does; so does the bound: per-test timeouts catch a hung test as a failure the script
    // reports, so a whole run that outlives the bound says the environment or the bound is short.
    const setup = (why: string) => new Error('npm run ' + script + ' ' + why + ' — the tests never ran: no verdict, no marker' + (tail ? '; its last lines:\n' + tail : ''));
    if (e?.code === 'ETIMEDOUT') throw setup('outlived the gate’s bound of ' + Math.round(RUN_TESTS_TIMEOUT_MS / 1000) + ' s (a suite that needs longer raises it in its own copy of this leg)');
    if (e?.code === 'ENOBUFS') return named('printed more than ' + OUTPUT_MAX + ' bytes');
    if (e?.status === 126 || e?.status === 127) throw setup('exited ' + e.status + ', a command its script names could not be run (not found, or not executable)');
    if (/\bMissing script:/.test(String(e?.stderr ?? ''))) throw setup('has no such script in package.json');
    if (typeof e?.status === 'number') return named('exited ' + e.status);
    if (e?.signal) throw new Error('npm run ' + script + ' was killed by ' + e.signal + ', which the gate did not send — no verdict, no marker');
    throw new Error('npm run ' + script + ' could not run (' + (e?.code ?? e?.message ?? String(e)) + ') — no verdict, no marker');
  }
}
/** The course's own run of this leg: what `run` does with no override, and what an override may call. */
function runTests(ctx: LegCtx, course: string, leg: string) {
  const station = ctx.claim?.station;
  if (station !== 'pr-open' && station !== 'fixed') {
    throw new Error('the run-tests gate runs at pr-open or fixed, not ' + JSON.stringify(station ?? null));
  }
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== 'string' || sha === '') throw new Error('the leg has no snapshot to read the course file at');
  const readAt = (rel: string) => show(ctx.checkout, sha, rel, 1024 * 1024);
  const git = (...args: string[]) => gitAt(ctx.checkout, args);
  const heading = `baton: ${course}/${leg} ticket ${ctx.ticket.id}: `;
  // The course file at the snapshot names the script; absent or malformed, the default. The
  // settings never name it: the course owns the gate, not the repository's agent settings.
  let script = 'test';
  try {
    const file = JSON.parse(readAt(`.baton/courses/${course}/course.json`));
    if (file && typeof file.test_script === 'string' && /^[\w:.+-]{1,64}$/.test(file.test_script)) script = file.test_script;
  } catch { /* no course file at the snapshot, or one that is not JSON: the default script */ }
  // The ticket's PR branch in the home repository, by the course's branch patterns as the
  // snapshot's settings carry them: exactly one, or no verdict (the sync asks the owner about a
  // ticket whose PRs the gate cannot reach, rather than offering this leg — finding 2).
  let settings: BatonJson = {};
  try { settings = JSON.parse(readAt('.baton/baton.json')); } catch { /* none: the default pattern */ }
  const id = bareTicketId(ctx.ticket);
  const { wanted, heads } = matchingHeads(ctx, courseEntry(settings, course));
  const branches = heads.map((line) => line.split('\t')[1].slice('refs/heads/'.length));
  // B-255: no PR branch at home, and the ticket's repos: names other repositories — its PRs are
  // there, gated by their own CI, which the sync reads from the forge. Nothing runs here and no
  // marker is made: the claim suspends at its station, and the sync queues review once that CI
  // is green, fix on its red, and waits on ci while it runs.
  if (branches.length === 0) {
    const siblings = ticketRepositories(ticketTextOf(ctx), settings.repos);
    if (siblings.length) {
      if (process.env.BATON_VERBOSE) process.stderr.write(heading + 'no PR branch at home; the gate is the CI of ' + siblings.join(', ') + '\n');
      return { reached: station, next: 'review', suspend: true, tests: 'ci', repositories: siblings };
    }
  }
  if (branches.length !== 1) {
    throw new Error(branches.length
      ? 'the run-tests gate tests one PR branch; ' + id + ' has ' + branches.join(', ') + ' in the home repository'
      : 'no branch matching ' + wanted.join(' or ') + ' in the home repository for ' + id + ' — the gate tests the PR branch it can reach');
  }
  const branch = branches[0];
  git('fetch', '-q', '--no-tags', 'origin', 'refs/heads/' + branch);
  const tested = git('rev-parse', 'FETCH_HEAD').trim();
  if (process.env.BATON_VERBOSE) process.stderr.write(heading + 'npm run ' + script + ' on ' + branch + ' at ' + tested.slice(0, 10) + ' (' + station + ')\n');
  // A scratch worktree at the tested head: the home checkout's branch and working tree are never
  // touched, and the script runs on exactly what the PR holds.
  const dir = mkdtempSync(join(tmpdir(), 'baton-run-tests-'));
  const tree = join(dir, 'tree');
  let verdict;
  try {
    git('worktree', 'add', '-q', '--detach', tree, tested);
    const modules = join(ctx.checkout, 'node_modules');
    if (existsSync(modules) && !existsSync(join(tree, 'node_modules'))) symlinkSync(modules, join(tree, 'node_modules'), 'dir');
    // B-230: a package that declares dependencies and has none installed cannot run its tests —
    // no verdict, rather than a red that names whichever bin was missing first.
    let pkg: Record<string, unknown> = {};
    try { pkg = JSON.parse(readFileSync(join(tree, 'package.json'), 'utf8')); } catch { /* no package.json: npm says so */ }
    const declared = [pkg?.dependencies, pkg?.devDependencies].some((deps) => deps !== null && typeof deps === 'object' && Object.keys(deps).length > 0);
    if (declared && !existsSync(join(tree, 'node_modules'))) {
      throw new Error('npm run ' + script + ' cannot run: ' + branch + ' declares dependencies and neither the tested tree nor the home checkout has node_modules — install them where the leg runs (npm ci); the tests never ran: no verdict, no marker');
    }
    verdict = verdictOf(tree, script);
  } finally {
    try { unlinkSync(join(tree, 'node_modules')); } catch { /* no link made */ }
    try { git('worktree', 'remove', '--force', tree); } catch { /* never added */ }
    try { git('worktree', 'prune'); } catch { /* nothing to prune */ }
    rmSync(dir, { recursive: true, force: true });
  }
  // The marker: an empty-tree commit on the tested head, its trailers the gate's record —
  // counted by the sync only as the evidence Baton records for this claim's advance.
  const trailers = ['Baton-Tests: ' + verdict.tests, 'Baton-Tested: ' + tested, ...(ctx.claim?.nonce ? ['Baton-Claim: ' + ctx.claim.nonce] : [])].join('\n');
  const paragraphs = ['baton: tests ' + verdict.tests + ' for ' + id, ...(verdict.tests === 'red' ? [verdict.tail] : []), trailers];
  const marker = git('commit-tree', tested + '^{tree}', '-p', tested, ...paragraphs.flatMap((m) => ['-m', m])).trim();
  return { reached: station, next: verdict.tests === 'green' ? 'review' : 'fix', tests: verdict.tests, script, branch, tested, marker, ...(verdict.tests === 'red' ? { tail: verdict.tail } : {}) };
}
