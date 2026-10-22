// defaults-cli.test.ts — `baton repo sync`'s argument parser, `baton repo init`'s scaffolding
// and `close` (BATON_SPEC §2f R-BTN-74, R-BTN-83; R3-1249): the flags; the scaffold's every
// file, run through the BUILT CLI (the esbuild bundle production runs, not the source); the leg
// stubs imported from a scratch copy, as the runner loads them, and run; the spawn contract
// every stub gives its agent — no shell, stdin never an open pipe (B-84); both ejections
// imported and called, answering what the defaults answer; and `prClose` in a real git repo.
// Node only: init writes a real tree and runs git.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { courseSchemas, githubFacts, parseSyncArgs, remoteSlug, syncWorkflow } from '../../src/defaults/cli';
import { HARNESS_AGENTS } from '../../src/runner/harness';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { githubFake } from '../githubFake';
import { graphOf } from '../../src/core/graph';
import { decide } from '../../src/runner/protocol';
import { CREATE_PR_COURSE, stationsPr, stationsReviewPr, type PrFact } from '../../src/defaults/course-pr';
import { prClose, verdictLine, type Exec } from '../../src/defaults/pr-close';
import { splitWords } from '../../src/defaults/agent-words';
import { ticketsMarkdown } from '../../src/defaults/tickets-markdown';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'cli', 'baton.mjs');
const baton = (cwd: string, ...args: string[]) => execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BATON_HOME: cwd } });
const gitInit = (dir: string) => {
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { stdio: 'ignore' });
};
/** Commit everything in `dir`; its new HEAD. */
const commitAll = (dir: string): string => {
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'scaffold', '--allow-empty'], { stdio: 'ignore' });
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
};
/** A fresh import of an ejected or scaffolded module (the query defeats the module cache). */
/** The source init writes for `course` (B-33): this CLI's repository at this CLI's commit — not
 * `--pin`'s, which only pins the workflow. */
const SELF = { slug: remoteSlug(ROOT), sha: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
/** The pin of this CLI's own commit: init refuses a --pin naming any other once a course names
 * its source (B-33). */
const PIN = `${SELF.slug}@${SELF.sha}`;
/** A pin of another commit: refused for a scaffold, taken by the legacy `pr` path, which writes no source. */
const OTHER_PIN = 'immediately-run/baton@abababababababababababababababababababab';
const sourceOf = (course: string) => `github/${SELF.slug}/${SELF.sha}/${course}`;
const load = async (file: string) => import(`${pathToFileURL(file).href}?t=${Math.random()}`);

describe('parseSyncArgs', () => {
  it('defaults from the environment, takes its flags, refuses the unknown', () => {
    expect(parseSyncArgs([], { BATON_HOME: '/h', BATON_URL: 'https://b' })).toMatchObject({ root: '/h', url: 'https://b' });
    expect(parseSyncArgs([], { BATON_HOME: '/h' }).url).toBeUndefined(); // then baton.json's baton_url
    expect(parseSyncArgs(['--root', '/x', '--url', 'https://u', '--facts', '/f.json', '--token', 't1'], {})).toMatchObject({ root: '/x', url: 'https://u', factsFile: '/f.json', token: 't1' });
    expect(() => parseSyncArgs(['--nope'], {})).toThrow('not a flag of baton repo sync');
    expect(() => parseSyncArgs(['--root'], {})).toThrow('needs a value');
  });
});

describe('splitWords — agent_command splits as sh would, quotes and no substitutions (B-84)', () => {
  /** Every row with `sh: true` is pure quoting, so real `sh` must split it into exactly the same
   * words. Rows without it use `$`, newlines or continuations where sh would substitute, split
   * commands or join — the split's own contract (no substitutions) differs from sh by design, so
   * those rows carry their expected words only. */
  const CASES: readonly { text: string; words: string[]; sh?: boolean }[] = [
    { text: 'opencode run --standalone --auto --model zai/glm "You are the leg agent."', words: ['opencode', 'run', '--standalone', '--auto', '--model', 'zai/glm', 'You are the leg agent.'], sh: true },
    { text: "claude -p 'single quotes keep \"double\" and $dollar'", words: ['claude', '-p', 'single quotes keep "double" and $dollar'], sh: true },
    { text: 'echo a\\ b\tc d', words: ['echo', 'a b', 'c', 'd'], sh: true },
    { text: 'echo   spaced\tout ', words: ['echo', 'spaced', 'out'], sh: true },
    { text: 'echo "escaped \\"inner\\" plus \\\\ and \\$literal"', words: ['echo', 'escaped "inner" plus \\ and $literal'], sh: true },
    { text: 'echo "" x', words: ['echo', '', 'x'], sh: true },
    { text: 'echo "line \\\nspread"', words: ['echo', 'line spread'], sh: true }, // a continuation drops both characters, as in sh
    // No substitutions: $ stays literal however written — the values come as BATON_* environment
    // and the stub's trailing arguments, not through the command string.
    { text: 'echo "$BATON_LEG is the leg, $1 the ticket"', words: ['echo', '$BATON_LEG is the leg, $1 the ticket'] },
    { text: 'echo $BATON_INSTRUCTIONS "$@"', words: ['echo', '$BATON_INSTRUCTIONS', '$@'] },
    { text: 'echo one\ntwo', words: ['echo', 'one', 'two'] },
  ];

  it('the table, and for pure quoting the same words sh itself splits', () => {
    for (const { text, words, sh } of CASES) {
      expect(splitWords(text), text).toEqual(words);
      if (!sh) continue;
      // The row's text as a command tail of pure quoting: sh's own split, arg by arg.
      const out = execFileSync('sh', ['-c', `printf '%s\\n' ${text}`], { encoding: 'utf8' });
      expect(out.trimEnd().split('\n'), text).toEqual(words);
    }
  });

  it('refuses what cannot run without a shell, naming the word and the fix', () => {
    expect(() => splitWords('opencode run < /dev/null')).toThrow(/has '<' as a word.*stdin is already closed/s); // the old workaround, caught on migration
    expect(() => splitWords('echo one && echo two')).toThrow("'&&'");
    expect(() => splitWords('cat ticket.md | wc -l')).toThrow("'|'");
    expect(() => splitWords('echo out > log')).toThrow("'>'");
    expect(() => splitWords("echo 'unterminated")).toThrow(/unterminated single quote/);
    expect(() => splitWords('echo "unterminated')).toThrow(/unterminated double quote/);
    expect(() => splitWords('echo trailing\\')).toThrow(/backslash/);
    expect(splitWords('')).toEqual([]);
    expect(splitWords(' \t ')).toEqual([]);
  });

  it('quoted or escaped shell syntax is a literal argument, not a refusal', () => {
    expect(splitWords("echo '<'")).toEqual(['echo', '<']);
    expect(splitWords('echo \\| and ">"')).toEqual(['echo', '|', 'and', '>']);
  });
});

describe('baton repo init, through the built CLI', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'baton-init-'));
    gitInit(root);
    baton(root, 'repo', 'init', '--pin', PIN);
    commitAll(root);
  }, 120_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes the settings with every R-BTN-51 course field, the course file, the pinned workflow and the tickets directory', () => {
    const settings = JSON.parse(readFileSync(join(root, '.baton', 'baton.json'), 'utf8'));
    // B-83: a fresh scaffold names a real agent — the opencode command by default, never the
    // bare `echo` stub.
    expect(settings.agent_command).toBe(HARNESS_AGENTS.opencode);
    // B-84: the command runs with no shell — it names the BATON_* environment the stub sets
    // (nothing expands), carries no redirection, and splits into the argv the stub spawns.
    expect(settings.agent_command).toContain('BATON_INSTRUCTIONS');
    expect(settings.agent_command).not.toMatch(/[<>|]/);
    expect(splitWords(settings.agent_command).at(0)).toBe('opencode');
    expect(settings).toMatchObject({ items: 'tickets', default_course: 'create-pr' });
    expect(settings.courses).toEqual([{ id: 'create-pr', version: 1, min_worker_version: 1, skill: 'baton-create-pr', step_kinds: ['implement', 'review', 'fix', 'adjudicate', 'merge'], report_horizon_h: 6, branch_pattern: 'claude/{ticket}-*', protocol_files: [], source: sourceOf('create-pr') }]);
    expect(JSON.parse(readFileSync(join(root, '.baton', 'courses', 'create-pr', 'course.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(CREATE_PR_COURSE)));
    const workflow = readFileSync(join(root, '.github', 'workflows', 'baton-sync.yml'), 'utf8');
    expect(workflow).toBe(syncWorkflow(PIN));
    // The pinned commit is checked out and run: the CLI is not published to a registry.
    expect(workflow).toContain(`repository: ${SELF.slug}\n          ref: ${SELF.sha}\n          path: .baton-cli`);
    // §7.1: the newest main read after the number, one run at a time, off until registered,
    // and a 15-minute backstop.
    expect(workflow).toContain('- run: node .baton-cli/cli/baton.mjs repo sync --latest main');
    expect(workflow).toContain('concurrency:\n  group: baton-sync\n  cancel-in-progress: false');
    expect(workflow).toContain("if: vars.BATON_ENABLED == 'true'");
    expect(workflow).toContain("- cron: '*/15 * * * *'");
    expect(workflow).toContain('id-token: write'); // the CLI mints the run's OIDC token itself
    expect(readFileSync(join(root, 'tickets', 'README.md'), 'utf8')).toContain('One `*.md` file per ticket');
    // B-95: the worked example of agent_wrapper ships, unused until named.
    const example = readFileSync(join(root, '.baton', 'leg-wrapper.example'), 'utf8');
    expect(example).toContain('mkdir -p .baton/logs');
    expect(example).toContain('| tee ".baton/logs/${ticket}-${leg}.log"');
    expect(settings.agent_wrapper).toBeUndefined();
  });

  it('without --pin, pins the CLI checkout it runs from to its commit; a pin that is not owner/name@commit is refused', () => {
    const other = mkdtempSync(join(tmpdir(), 'baton-init-'));
    try {
      baton(other, 'repo', 'init');
      const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      expect(readFileSync(join(other, '.github', 'workflows', 'baton-sync.yml'), 'utf8')).toContain(`ref: ${sha}\n`);
      expect(() => syncWorkflow('latest')).toThrow('owner/name@<commit sha>');
      expect(() => syncWorkflow('immediately-run/baton@main')).toThrow('owner/name@<commit sha>');
      expect(() => syncWorkflow('immediately-run/baton@abc1234')).toThrow('all 40 hex characters'); // actions/checkout cannot fetch a short sha
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }, 120_000);

  it('--agent names the harness whose command agent_command is (printed for the unfamiliar); --agent-command names one outright — the bare echo only explicitly (B-83)', () => {
    /** One scaffold with `flags`; its settings' agent_command, and everything init said. */
    const scaffold = (...flags: string[]): { dir: string; command: string; said: string } => {
      const dir = mkdtempSync(join(tmpdir(), 'baton-agent-'));
      gitInit(dir);
      const said = baton(dir, 'repo', 'init', '--pin', PIN, ...flags);
      const command = (JSON.parse(readFileSync(join(dir, '.baton', 'baton.json'), 'utf8')) as { agent_command: string }).agent_command;
      return { dir, command, said };
    };
    const run = (s: { dir: string; command: string; said: string }): string => s.command;
    // The default is opencode's validated command — model pinned, the briefing naming the
    // BATON_* environment (no shell expands it, B-84) — and init prints it for the unfamiliar.
    const def = scaffold();
    try {
      expect(def.command).toBe(HARNESS_AGENTS.opencode);
      expect(def.command).toContain('--model zai-coding-plan/glm-5.3');
      expect(def.command).toContain('BATON_INSTRUCTIONS');
      expect(def.command).not.toMatch(/[<>|]/); // no redirection: the stub closes stdin itself
      expect(def.said).toContain(def.command);
    } finally {
      rmSync(def.dir, { recursive: true, force: true });
    }
    const cc = scaffold('--agent', 'claude-code');
    try {
      expect(cc.command).toBe(HARNESS_AGENTS['claude-code']);
      expect(cc.command).toContain('--permission-mode bypassPermissions');
      expect(cc.said).toContain(cc.command);
    } finally {
      rmSync(cc.dir, { recursive: true, force: true });
    }
    const own = scaffold('--agent-command', 'my-agent --flag');
    try {
      expect(own.command).toBe('my-agent --flag');
    } finally {
      rmSync(own.dir, { recursive: true, force: true });
    }
    // The no-op stub is named explicitly or not at all.
    const stub = scaffold('--agent-command', 'echo');
    try {
      expect(run(stub)).toBe('echo');
    } finally {
      rmSync(stub.dir, { recursive: true, force: true });
    }
    // A scaffold from before B-83 (agent_command "echo"): re-running init replaces the stub
    // with the chosen harness's command, loudly; an explicit --agent switches harnesses; a
    // repository's own command is kept, as its own.
    const old = scaffold('--agent-command', 'echo');
    try {
      const command = (): string => (JSON.parse(readFileSync(join(old.dir, '.baton', 'baton.json'), 'utf8')) as { agent_command: string }).agent_command;
      const replaced = baton(old.dir, 'repo', 'init', '--pin', PIN);
      expect(command()).toBe(HARNESS_AGENTS.opencode);
      expect(replaced).toContain('no-op stub');
      expect(replaced).toContain(HARNESS_AGENTS.opencode);
      baton(old.dir, 'repo', 'init', '--pin', PIN, '--agent', 'claude-code');
      expect(command()).toBe(HARNESS_AGENTS['claude-code']);
      baton(old.dir, 'repo', 'init', '--pin', PIN, '--agent-command', 'mine');
      expect(command()).toBe('mine');
      const kept = baton(old.dir, 'repo', 'init', '--pin', PIN);
      expect(command()).toBe('mine');
      expect(kept).toContain('kept .baton/baton.json');
    } finally {
      rmSync(old.dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('each leg stub imports only Node built-ins, so a scratch copy runs as the runner loads it', async () => {
    // A stub and its instructions per leg (R-BTN-131); the runner and the kit read only the .mjs.
    const files = readdirSync(join(root, '.baton', 'courses', 'create-pr', 'legs')).sort();
    const legNames = ['adjudicate', 'fix', 'implement', 'merge', 'review'];
    expect(files).toEqual(legNames.flatMap((l) => [`${l}.md`, `${l}.mjs`]));
    const legs = files.filter((f) => f.endsWith('.mjs'));
    for (const leg of legs) {
      const text = readFileSync(join(root, '.baton', 'courses', 'create-pr', 'legs', leg), 'utf8');
      const specifiers = [...text.matchAll(/^import .* from ["']([^"']+)["']/gm)].map((m) => m[1]);
      expect(specifiers.every((s) => s.startsWith('node:')), `${leg}: ${specifiers.join(', ')}`).toBe(true);
    }
    // The runner copies each script alone into a scratch directory (src/runner/home.ts). The
    // scaffold's agent_command is B-83's real opencode command — which must not run mid-test —
    // so the settings name a no-op, committed at the snapshot the stub reads.
    // B-94 (review round 1): every git and gh call the generated stub makes is bounded and
    // non-interactive — the same bound and environment the close uses, injected at generation.
    for (const leg of legs) {
      const text2 = readFileSync(join(root, '.baton', 'courses', 'create-pr', 'legs', leg), 'utf8');
      expect(text2, leg).toContain('timeout: GIT_BOUND_MS');
      expect(text2, leg).toContain('killSignal');
      expect(text2, leg).toContain('GIT_TERMINAL_PROMPT');
    }
    const settingsFile = join(root, '.baton', 'baton.json');
    const scaffolded = readFileSync(settingsFile, 'utf8');
    const scratch = mkdtempSync(join(tmpdir(), 'baton-legs-'));
    // A gh the verification reads, answering the file beside it: the settings name the no-op
    // agent `true` at the snapshot — exit 0, no PR — so the stub's word for its outcome is gh's.
    const fakeBin = mkdtempSync(join(tmpdir(), 'baton-fakegh-'));
    const answer = join(fakeBin, 'answer');
    writeFileSync(join(fakeBin, 'gh'), '#!/bin/sh\ncat "$(dirname "$0")/answer"\n');
    chmodSync(join(fakeBin, 'gh'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${fakeBin}:${path}`;
    try {
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(scaffolded), agent_command: 'true' }));
      const snapshot = { sha: commitAll(root) };
      copyFileSync(join(root, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs'), join(scratch, 'implement.mjs'));
      const stub = await load(join(scratch, 'implement.mjs'));
      expect(typeof stub.close).toBe('function');
      const ctx = { ticket: { id: 'A-1' }, checkout: root, snapshot };
      // An open PR on a branch the pattern maps to A-1: the stub returns its position.
      writeFileSync(answer, JSON.stringify([{ number: 9, headRefName: 'claude/A-1-kit', headRefOid: '0123456789abcdef0123456789abcdef01234567' }]));
      expect(await stub.run(ctx)).toEqual({ reached: 'pr-open', next: 'review' });
      // No such PR: the leg fails naming the pattern it looked for, not trusting exit 0 (B-81).
      writeFileSync(answer, '[]');
      await expect(stub.run(ctx)).rejects.toThrow('no open PR on a branch matching claude/A-1-* for ticket A-1 exists in the checkout’s repository');
      // A forge that cannot be read fails the leg naming that, too.
      writeFileSync(join(fakeBin, 'gh'), '#!/bin/sh\necho "no git remotes found" >&2\nexit 1\n');
      await expect(stub.run(ctx)).rejects.toThrow('cannot verify A-1’s PR — no repository the ticket reads could be read: the checkout’s repository (gh pr list --state open --limit 300 --json number,headRefName,headRefOid failed: no git remotes found)');
    } finally {
      process.env.PATH = path;
      rmSync(scratch, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
      writeFileSync(settingsFile, scaffolded);
      commitAll(root);
    }
  });

  it('the stubs run the agent_command baton.json names at the claim’s snapshot, arguments and all; the review returns its verdict', async () => {
    const agent = join(root, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\necho "$1 $2 $3 $4" > "$(dirname "$0")/agent.args"\necho "reviewing"\necho "$VERDICT"\n');
    chmodSync(agent, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const before = readFileSync(settingsFile, 'utf8');
    try {
      // Committed after init: the stub reads it at the snapshot, and the command may carry arguments.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: `${agent} --flag` }));
      const snapshot = { sha: commitAll(root) };
      // An uncommitted edit — a branch under review choosing its reviewer — is never read.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: 'echo approve' }));
      const file = join(root, '.baton', 'courses', 'create-pr', 'legs', 'review.mjs');
      process.env.VERDICT = 'changes';
      expect(await (await load(file)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      expect(readFileSync(join(root, 'agent.args'), 'utf8').trim()).toBe(`--flag A-1 review ${root}`);
      process.env.VERDICT = 'approve';
      expect(await (await load(file)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'merge', verdict: 'approve' });
      process.env.VERDICT = 'maybe';
      await expect((await load(file)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).rejects.toThrow('no verdict');
      await expect((await load(file)).run({ ticket: { id: 'A-1' }, checkout: root })).rejects.toThrow('no snapshot');
      // The fix stub queues review, the only leg leaving `fixed`.
      expect(await (await load(join(root, '.baton', 'courses', 'create-pr', 'legs', 'fix.mjs'))).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'fixed', next: 'review' });
    } finally {
      delete process.env.VERDICT;
      writeFileSync(settingsFile, before);
      commitAll(root);
    }
  });

  it('the stub runs BATON_AGENT_COMMAND — what baton run --harness chose — when the snapshot’s settings name no agent_command; the settings win; neither names the fix (B-83)', async () => {
    const agent = join(root, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\necho "$1 $2 $3" > "$(dirname "$0")/agent.args"\n');
    chmodSync(agent, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const before = readFileSync(settingsFile, 'utf8');
    const fix = join(root, '.baton', 'courses', 'create-pr', 'legs', 'fix.mjs');
    const args = join(root, 'agent.args');
    try {
      // The settings name no agent_command: the environment's command runs the leg.
      const noCommand = { ...JSON.parse(before) } as { agent_command?: string };
      delete noCommand.agent_command;
      writeFileSync(settingsFile, JSON.stringify(noCommand));
      const snapshot = { sha: commitAll(root) };
      process.env.BATON_AGENT_COMMAND = agent;
      try {
        expect(await (await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'fixed', next: 'review' });
        expect(readFileSync(args, 'utf8').trim()).toBe(`A-1 fix ${root}`);
      } finally {
        delete process.env.BATON_AGENT_COMMAND;
      }
      // The snapshot's own naming is authoritative: an environment command that would fail
      // never runs, because the settings' command does.
      writeFileSync(args, '');
      writeFileSync(settingsFile, JSON.stringify({ ...noCommand, agent_command: agent }));
      const named = { sha: commitAll(root) };
      process.env.BATON_AGENT_COMMAND = '/nonexistent-baton-agent';
      try {
        expect(await (await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot: named })).toEqual({ reached: 'fixed', next: 'review' });
        expect(readFileSync(args, 'utf8').trim()).toBe(`A-1 fix ${root}`);
      } finally {
        delete process.env.BATON_AGENT_COMMAND;
      }
      // Neither names one: the leg fails saying how to name one.
      writeFileSync(settingsFile, JSON.stringify(noCommand));
      const none = { sha: commitAll(root) };
      await expect((await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot: none })).rejects.toThrow('names no agent_command');
      await expect((await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot: none })).rejects.toThrow('baton repo init --agent opencode');
    } finally {
      writeFileSync(settingsFile, before);
      rmSync(args, { force: true });
      commitAll(root);
    }
  });

  it('the stub spawns its agent with no shell and never an open stdin pipe — the environment that hangs real harness CLIs (B-84)', async () => {
    // The hang itself, reproduced without the harness: execFile leaves the child's stdin an
    // open pipe the stub never writes and never closes — 'ignore' for fd 0 is not honoured —
    // and an agent that reads stdin blocks on it forever, zero output, the claim burning until
    // reap. That is B-84's `opencode run` hang (v2.1.2, macOS, the bun binary), root cause
    // found building this: the old stub's execFile(sh, -c) held the pipe open; the shell was
    // never the culprit, which is why `--standalone` changed nothing and only the manual
    // `< /dev/null` worked. A stdin reader under it, alone and through sh -c as the old stub
    // ran it, must not return:
    const never = <T>(p: Promise<T>, ms: number): Promise<T | 'hung'> =>
      Promise.race([p, new Promise<'hung'>((r) => setTimeout(() => r('hung'), ms))]);
    const hung: ReturnType<typeof execFile>[] = [];
    const open = (file: string, args: string[]): Promise<'hung' | 'returned'> => {
      const child = execFile(file, args, () => {});
      hung.push(child);
      return new Promise((resolve) => child.on('exit', () => resolve('returned'))); // the child's death alone must not settle it
    };
    try {
      expect(await never(open('cat', []), 2_000), 'execFile alone leaves stdin an open pipe: cat never ends').toBe('hung');
      expect(await never(open('sh', ['-c', 'cat']), 2_000), 'the old stub\'s own spawn, through sh -c, hangs the same').toBe('hung');
    } finally {
      for (const c of hung) c.kill('SIGKILL');
    }
    // The stub's own spawn, then: its agent runs with no sh between (the agent's parent is the
    // stub's node, not a shell), reads stdin to EOF at once (an open pipe would hang the cat in
    // the agent below — and with it the whole leg), and a quoted agent_command word arrives as
    // one argument beside the appended ticket, leg and checkout.
    const agent = join(root, 'stdin-agent.sh');
    writeFileSync(agent, [
      '#!/bin/sh',
      '{',
      '  echo "parent=$(ps -o comm= -p $PPID)"',
      '  echo "argc=$#"',
      '  i=1; for a in "$@"; do echo "arg$i=$a"; i=$((i+1)); done',
      "  echo \"stdin-bytes=$(cat | wc -c | tr -d ' ')\"",
      '} > "$(dirname "$0")/stdin.facts"',
      'echo done',
      '',
    ].join('\n'));
    chmodSync(agent, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const before = readFileSync(settingsFile, 'utf8');
    const implement = join(root, '.baton', 'courses', 'create-pr', 'legs', 'implement.mjs');
    const guard = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('the stub never returned — its agent hung, on an open stdin pipe?')), 20_000))]);
    // B-81: the stub verifies its PR on the forge before returning pr-open, so the run below
    // needs a gh answering an open PR on a branch the pattern maps to B-1 — the same scripted
    // gh the verification's own test uses; the spawn facts it reads are the agent's, not gh's.
    const fakeBin = mkdtempSync(join(tmpdir(), 'baton-fakegh-'));
    writeFileSync(join(fakeBin, 'gh'), '#!/bin/sh\ncat "$(dirname "$0")/answer"\n');
    writeFileSync(join(fakeBin, 'answer'), JSON.stringify([{ number: 4, headRefName: 'claude/B-1-kit', headRefOid: '0123456789abcdef0123456789abcdef01234567' }]));
    chmodSync(join(fakeBin, 'gh'), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${fakeBin}:${path}`;
    try {
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: `${agent} --flag 'quoted arg'` }));
      const snapshot = { sha: commitAll(root) };
      expect(await guard((await load(implement)).run({ ticket: { id: 'B-1' }, checkout: root, snapshot }))).toEqual({ reached: 'pr-open', next: 'review' });
      const facts = readFileSync(join(root, 'stdin.facts'), 'utf8');
      expect(facts).toContain('argc=5');
      expect(facts).toContain(`arg1=--flag\narg2=quoted arg\narg3=B-1\narg4=implement\narg5=${root}\n`);
      expect(facts).toContain('stdin-bytes=0'); // read to EOF, instantly: stdin was not an open pipe
      const parent = /parent=(.*)/.exec(facts)?.[1]?.trim() ?? '';
      expect(parent, 'no shell stands between the stub and its agent').not.toMatch(/^(\/usr\/bin\/|\/bin\/)?(ba|da|z)?sh\d?$/);
    } finally {
      process.env.PATH = path;
      rmSync(fakeBin, { recursive: true, force: true });
      writeFileSync(settingsFile, before);
      rmSync(join(root, 'stdin.facts'), { force: true });
      rmSync(agent, { force: true });
      commitAll(root);
    }
  }, 60_000);

  it('the stub prepends the agent_wrapper — the host’s BATON_AGENT_WRAPPER over the file — and the example wrapper passes the answer through with a byte-identical log (B-95)', async () => {
    // A wrapper sees the whole leg command as its arguments. Here it hands them to a reporter
    // (a node script, so nothing in a shell re-splits them), then runs the agent as its own
    // contract says and answers as the agent does.
    const wrapper = join(root, 'wrapper.sh');
    writeFileSync(join(root, 'report.mjs'), "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('wrapper.args', import.meta.url), process.argv.slice(2).map((a, i) => `arg${i + 1}=${a}`).join('\\n') + '\\n');\n");
    writeFileSync(wrapper, [
      '#!/bin/sh',
      `"${process.execPath}" "$(dirname "$0")/report.mjs" "$@"`,
      'echo "from the host wrapper" >> "$(dirname "$0")/wrapper.ran"',
      // Its own flags end where the agent's argv begins: `--its-flag <value>`, or nothing.
      '[ "$1" = --its-flag ] && shift 2',
      'exec "$@"',
      '',
    ].join('\n'));
    chmodSync(wrapper, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const before = readFileSync(settingsFile, 'utf8');
    const review = join(root, '.baton', 'courses', 'create-pr', 'legs', 'review.mjs');
    let unsetRemote: (() => void) | null = null;
    let fakeGh: string | null = null;
    const path = process.env.PATH;
    try {
      delete process.env.BATON_AGENT_WRAPPER;
      // B-81: the stub verifies its PR on the forge before returning, so the review needs a gh
      // answering an open PR on a branch the pattern maps to A-1.
      execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/o/r.git'], { stdio: 'ignore' });
      const fakeBin = mkdtempSync(join(tmpdir(), 'baton-fakegh-'));
      fakeGh = fakeBin;
      writeFileSync(join(fakeBin, 'gh'), '#!/bin/sh\ncat "$(dirname "$0")/answer"\n');
      writeFileSync(join(fakeBin, 'answer'), JSON.stringify([{ number: 5, headRefName: 'claude/A-1-wrapper', headRefOid: '0123456789abcdef0123456789abcdef01234567' }]));
      chmodSync(join(fakeBin, 'gh'), 0o755);
      process.env.PATH = `${fakeBin}:${path}`;
      unsetRemote = () => execFileSync('git', ['-C', root, 'remote', 'remove', 'origin'], { stdio: 'ignore' });
      // Unset, today's argv: the agent alone, its own words, the ticket, the leg and the checkout.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: "/bin/sh -c 'echo approve'" }));
      let snapshot = { sha: commitAll(root) };
      expect(await (await load(review)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'merge', verdict: 'approve' });
      expect(existsSync(join(root, 'wrapper.ran'))).toBe(false);
      // With the setting: the wrapper's words go in front, split as sh would — quotes carry, so a
      // word holding a space arrives whole.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: "/bin/sh -c 'echo approve'", agent_wrapper: `'${wrapper}'` }));
      snapshot = { sha: commitAll(root) };
      expect(await (await load(review)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'merge', verdict: 'approve' });
      expect(readFileSync(join(root, 'wrapper.args'), 'utf8')).toBe(`arg1=/bin/sh\narg2=-c\narg3=echo approve\narg4=A-1\narg5=review\narg6=${root}\n`);
      // A wrapper's own arguments, quoted as sh would carry them, come before the agent's words.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: "/bin/sh -c 'echo approve'", agent_wrapper: `${wrapper} --its-flag 'its arg'` }));
      snapshot = { sha: commitAll(root) };
      expect(await (await load(review)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'merge', verdict: 'approve' });
      expect(readFileSync(join(root, 'wrapper.args'), 'utf8')).toBe(`arg1=--its-flag\narg2=its arg\narg3=/bin/sh\narg4=-c\narg5=echo approve\narg6=A-1\narg7=review\narg8=${root}\n`);
      // The host's environment wins over the file, and is read from the host, not the snapshot.
      const hostWrapper = join(root, 'host-wrapper.sh');
      writeFileSync(hostWrapper, '#!/bin/sh\necho "from the host wrapper" >> "$(dirname "$0")/host.ran"\nexec "$@"\n');
      chmodSync(hostWrapper, 0o755);
      process.env.BATON_AGENT_WRAPPER = hostWrapper;
      expect(await (await load(review)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'merge', verdict: 'approve' });
      expect(readFileSync(join(root, 'host.ran'), 'utf8')).toBe('from the host wrapper\n');
      // The example init ships: named as the wrapper, it logs the agent's stdout byte for byte —
      // the answer line last, intact — and hands the same stdout on.
      const example = join(root, '.baton', 'leg-wrapper.example');
      chmodSync(example, 0o755);
      delete process.env.BATON_AGENT_WRAPPER;
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: `${join(root, 'noisy-agent.sh')}`, agent_wrapper: example }));
      writeFileSync(join(root, 'noisy-agent.sh'), '#!/bin/sh\necho "working on $1"\nprintf \'last line, with a trailing space \\n\'\necho changes\n');
      chmodSync(join(root, 'noisy-agent.sh'), 0o755);
      snapshot = { sha: commitAll(root) };
      expect(await (await load(review)).run({ ticket: { id: 'B-2' }, checkout: root, snapshot })).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      expect(readFileSync(join(root, '.baton', 'logs', 'B-2-review.log'), 'utf8')).toBe('working on B-2\nlast line, with a trailing space \nchanges\n');
      // A file wrapper that is not a command fails the leg naming the setting.
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: 'echo approve', agent_wrapper: '  ' }));
      const blank = { sha: commitAll(root) };
      await expect((await load(review)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot: blank })).rejects.toThrow("agent_wrapper is not a command");
    } finally {
      if (path == null) delete process.env.PATH;
      else process.env.PATH = path;
      unsetRemote?.();
      if (fakeGh) rmSync(fakeGh, { recursive: true, force: true });
      // A host's wrapper is the host's: this process's environment is never left saying so.
      delete process.env.BATON_AGENT_WRAPPER;
      writeFileSync(settingsFile, before);
      for (const f of ['wrapper.sh', 'report.mjs', 'wrapper.args', 'wrapper.ran', 'host-wrapper.sh', 'host.ran', 'noisy-agent.sh']) rmSync(join(root, f), { force: true });
      rmSync(join(root, '.baton', 'logs'), { recursive: true, force: true });
      rmSync(join(root, '.baton', 'leg-wrapper.example'), { force: true });
      commitAll(root);
    }
  }, 60_000);

  it('the stub hands the agent its instructions in a temp file it removes; deleted instructions run with none; any other failure — the temp dir, the probe — stops the leg', async () => {
    const agent = join(root, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\necho "$BATON_INSTRUCTIONS" > "$(dirname "$0")/agent.instr"\ntest -z "$BATON_INSTRUCTIONS" || head -1 "$BATON_INSTRUCTIONS" >> "$(dirname "$0")/agent.instr"\n');
    chmodSync(agent, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const instructions = join(root, '.baton', 'courses', 'create-pr', 'legs', 'fix.md');
    const before = readFileSync(settingsFile, 'utf8');
    const text = readFileSync(instructions, 'utf8');
    const fix = join(root, '.baton', 'courses', 'create-pr', 'legs', 'fix.mjs');
    const tmp = process.env.TMPDIR;
    try {
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: agent }));
      let snapshot = { sha: commitAll(root) };
      await (await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot });
      const [file, title] = readFileSync(join(root, 'agent.instr'), 'utf8').trim().split('\n');
      expect(title).toMatch(/^# create-pr · fix — /);
      expect(existsSync(file)).toBe(false); // removed once the agent finished
      // A temp directory that cannot be made fails the leg rather than run it without instructions.
      process.env.TMPDIR = join(root, 'no-such-dir');
      await expect((await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).rejects.toThrow(/ENOENT/);
      if (tmp == null) delete process.env.TMPDIR;
      else process.env.TMPDIR = tmp;
      // The probe itself failing — not the path missing — stops the leg too.
      const fakeBin = mkdtempSync(join(tmpdir(), 'baton-fakegit-'));
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      writeFileSync(join(fakeBin, 'git'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = ls-tree ] && exit 128; done\nexec ${realGit} "$@"\n`);
      chmodSync(join(fakeBin, 'git'), 0o755);
      const path = process.env.PATH;
      process.env.PATH = `${fakeBin}:${path}`;
      try {
        await expect((await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot })).rejects.toThrow(/ls-tree/);
      } finally {
        process.env.PATH = path;
        rmSync(fakeBin, { recursive: true, force: true });
      }
      // The repository deleted the instructions: the agent runs with none.
      rmSync(instructions);
      snapshot = { sha: commitAll(root) };
      await (await load(fix)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot });
      expect(readFileSync(join(root, 'agent.instr'), 'utf8').trim()).toBe('');
    } finally {
      if (tmp == null) delete process.env.TMPDIR;
      else process.env.TMPDIR = tmp;
      writeFileSync(settingsFile, before);
      writeFileSync(instructions, text);
      rmSync(join(root, 'agent.instr'), { force: true });
      commitAll(root);
    }
  });

  it('re-running init keeps the repository’s files and rewrites only the workflow (the pin); --force overwrites the course, never the rest of baton.json', () => {
    const settingsFile = join(root, '.baton', 'baton.json');
    const stub = join(root, '.baton', 'courses', 'create-pr', 'legs', 'merge.mjs');
    const settings = readFileSync(settingsFile, 'utf8');
    const stubText = readFileSync(stub, 'utf8');
    try {
      writeFileSync(settingsFile, settings.replace('"repos": {}', '"repos": { "docs": "o/docs" }'));
      writeFileSync(stub, `${stubText}\n// edited by hand\n`);
      const workflowFile = join(root, '.github', 'workflows', 'baton-sync.yml');
      writeFileSync(workflowFile, 'an older pin\n');
      expect(baton(root, 'repo', 'init')).toContain('kept .baton/baton.json');
      expect(readFileSync(settingsFile, 'utf8')).toContain('"docs": "o/docs"');
      expect(readFileSync(stub, 'utf8')).toContain('// edited by hand');
      expect(readFileSync(workflowFile, 'utf8')).toContain(`ref: ${SELF.sha}`);
      // --force rewrites the course's files and its own entry; the repository's settings stay.
      const edited = JSON.parse(readFileSync(settingsFile, 'utf8'));
      writeFileSync(settingsFile, JSON.stringify({ ...edited, agent_command: 'my-agent', courses: [{ ...edited.courses[0], version: 9 }, { id: 'bug-report', version: 1 }] }));
      baton(root, 'repo', 'init', '--pin', PIN, '--force');
      const forced = JSON.parse(readFileSync(settingsFile, 'utf8'));
      expect(forced).toMatchObject({ repos: { docs: 'o/docs' }, agent_command: 'my-agent', default_course: 'create-pr' });
      expect(forced.courses.map((c: { id: string; version: number }) => [c.id, c.version])).toEqual([['create-pr', 1], ['bug-report', 1]]);
      expect(readFileSync(stub, 'utf8')).not.toContain('// edited by hand');
    } finally {
      writeFileSync(settingsFile, settings);
      baton(root, 'repo', 'init', '--pin', PIN, '--force');
      commitAll(root);
    }
  }, 120_000);

  it('--eject tickets writes a standalone source that answers what the default answers, and edits take', async () => {
    baton(root, 'repo', 'init', '--eject', 'tickets');
    writeFileSync(join(root, 'tickets', 'a.md'), '---\nid: A-1\ntitle: A\norder: 2\n---\n');
    execFileSync('mkdir', ['-p', join(root, 'tickets', 'archive')]);
    // A done ticket archived in a subdirectory still closes its dependents' dependency.
    writeFileSync(join(root, 'tickets', 'archive', 'b.md'), '---\nid: B-1\nstatus: done\n---\n');
    const ctx = { root, settings: { items: 'tickets', default_course: 'create-pr' } };
    const files = ['README.md', 'a.md', 'archive/b.md'].map((f) => ({ path: f, text: readFileSync(join(root, 'tickets', f), 'utf8') }));
    const ejected = await load(join(root, '.baton', 'tickets.mjs'));
    const out = await ejected.default.tickets(ctx);
    expect(out).toEqual(ticketsMarkdown(files, ctx.settings));
    expect(out.closed).toEqual([{ id: 'B-1', as: 'done' }]);
    // A second eject would overwrite edits: refused without --force.
    expect(() => baton(root, 'repo', 'init', '--eject', 'tickets')).toThrow();
    baton(root, 'repo', 'init', '--eject', 'tickets', '--force');
    const text = readFileSync(join(root, '.baton', 'tickets.mjs'), 'utf8');
    expect([...text.matchAll(/^import .* from ["']([^"']+)["']/gm)].every((m) => m[1].startsWith('node:'))).toBe(true);
  }, 120_000);

  it('--eject stations writes a standalone function returning {stations, markers, course_data}, the default’s answer — for a course that names no source', async () => {
    const settingsFile = join(root, '.baton', 'baton.json');
    // A sourced course is placed by its source's function: ejecting it is refused (B-33).
    expect(() => baton(root, 'repo', 'init', '--eject', 'stations')).toThrow(/names a source, whose station function places its tickets/);
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    writeFileSync(settingsFile, JSON.stringify({ ...settings, courses: settings.courses.map(({ source: _source, ...c }: { source?: string }) => c) }, null, 2));
    baton(root, 'repo', 'init', '--eject', 'stations');
    const tickets = ticketsMarkdown([{ path: 'a.md', text: '---\nid: A-1\n---\n' }]).tickets;
    const facts: PrFact[] = [{ number: 1, head: 'claude/A-1-x', state: 'open', pushedAt: 1, checks: [], reviews: [] }];
    const ctx = { tickets, facts, closed: new Set<string>(), done: new Set<string>(), branchPatterns: ['claude/{ticket}-*'] };
    const ejected = await load(join(root, '.baton', 'courses', 'create-pr', 'sync.mjs'));
    const out = await ejected.default.stations(ctx);
    expect(out).toEqual(stationsPr(ctx));
    expect(out.stations['A-1']).toMatchObject({ station: 'pr-open', next_leg: 'review' });
    expect(() => baton(root, 'repo', 'init', '--eject', 'nope')).toThrow();
  }, 120_000);
});

describe('prClose', () => {
  it('a non-review leg appends its marker line, commits it, and returns the commit sha', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-close-'));
    try {
      gitInit(dir);
      execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-qm', 'base'], { stdio: 'ignore' });
      execFileSync('mkdir', ['-p', join(dir, '.baton')]);
      // The claim's id is repository-qualified; the marker names the ticket as its file does.
      const sha = await prClose({ checkout: dir, ticket: { id: 'docs:A-1', home: 'docs' }, leg: 'implement', claim: { nonce: 'n1' } }, { reached: 'pr-open', next: 'review' });
      expect(sha).toBe(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
      expect(readFileSync(join(dir, '.baton', 'markers.jsonl'), 'utf8')).toBe('{"ticket":"A-1","leg":"implement","reached":"pr-open","next":"review","claim":"n1"}\n');
      expect(execFileSync('git', ['-C', dir, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('baton:close A-1 implement');
      expect(execFileSync('git', ['-C', dir, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('.baton/markers.jsonl');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the review writes the verdict line on the checkout branch’s PR and returns the comment’s URL; no verdict throws', async () => {
    const calls: { cmd: string; args: string[]; cwd: string }[] = [];
    const run: Exec = (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      return 'https://github.com/o/r/pull/7#issuecomment-1';
    };
    const ctx = { checkout: '/co', ticket: { id: 'A-1' }, leg: 'review', claim: { nonce: 'n2' } };
    expect(await prClose(ctx, { reached: 'reviewed', verdict: 'changes' }, run)).toBe('https://github.com/o/r/pull/7#issuecomment-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cmd: 'gh', cwd: '/co' });
    expect(calls[0].args.slice(0, 3)).toEqual(['pr', 'comment', '--body']);
    // The first line is exactly the line the station function reads (course-pr's VERDICT).
    expect(calls[0].args[3].split('\n')[0]).toBe(verdictLine('changes'));
    await expect(prClose(ctx, { reached: 'reviewed' }, run)).rejects.toThrow('no verdict');
    // A PR the agent named (B-29): the line goes there, whatever the checkout's branch.
    calls.length = 0;
    await prClose(ctx, { verdict: 'approve', pr: 'https://github.com/o/site/pull/7' }, run);
    expect(calls[0].args.slice(0, 4)).toEqual(['pr', 'comment', 'https://github.com/o/site/pull/7', '--body']);
    await expect(prClose(ctx, { verdict: 'approve', pr: 'o/site#7' }, run)).rejects.toThrow('named no PR URL to write on');
  });

  /** The comment body prClose posts for `leg`, as a review fact the station functions read. */
  const posted = async (leg: string, result: Record<string, unknown>, at: number) => {
    let body = '';
    await prClose({ checkout: '/co', ticket: { id: 'A-1' }, leg }, result, (_cmd, args) => {
      body = args[3];
      return 'https://github.com/o/r/pull/7#issuecomment-2';
    });
    return { author: 'baton', state: 'COMMENTED' as const, submittedAt: at, body };
  };

  it('adjudicate and conclude write the lines the station functions read; a missing adjudication throws', async () => {
    const changes = await posted('review', { verdict: 'changes' }, 10);
    const pr = (reviews: PrFact['reviews']): PrFact => ({ number: 7, head: 'claude/A-1-x', state: 'open', pushedAt: 1, pushes: [1, 20, 40], checks: ['success'], reviews });
    // create-pr: three rounds of changes and two fixes spend the fixes; the adjudication places.
    const rounds = [changes, await posted('review', { verdict: 'changes' }, 30), await posted('review', { verdict: 'changes' }, 50)];
    for (const [answer, merge] of [['merge', 'ready'], ['owner', 'waiting']] as const) {
      const adjudicated = await posted('adjudicate', { adjudication: answer }, 60);
      expect(adjudicated.body.split('\n')[0]).toBe(`<!-- baton:adjudicated ${answer} -->`);
      const placed = stationsPr({ tickets: [ticketsMarkdown([{ path: 'tickets/a1.md', text: '---\nid: A-1\ntitle: A\n---\n' }]).tickets[0]], facts: [pr([...rounds, adjudicated])], closed: new Set(), graph: CREATE_PR_COURSE }).stations['A-1'];
      expect(placed).toMatchObject({ station: 'adjudicated', next: [{ leg: 'merge', state: merge }] });
    }
    await expect(prClose({ checkout: '/co', ticket: { id: 'A-1' }, leg: 'adjudicate' }, { adjudication: 'maybe' }, () => '')).rejects.toThrow('neither merge nor owner');
    // review-pr: the conclusion line after a changes verdict ends the ticket at `concluded`.
    const concluded = await posted('conclude', { reached: 'concluded' }, 30);
    expect(concluded.body.split('\n')[0]).toBe('<!-- baton:concluded -->');
    const ticket = ticketsMarkdown([{ path: 'tickets/r1.md', text: '---\nid: A-1\ntitle: R\ncourse: review-pr\nprs: [7]\n---\n' }]).tickets[0];
    expect(stationsReviewPr({ tickets: [ticket], facts: [{ ...pr([changes, concluded]), state: 'closed' }], closed: new Set() }).stations['A-1']).toMatchObject({ station: 'concluded', next: [] });
  });
});

describe('githubFacts (R-BTN-96’s GitHub adapter) against a recorded GitHub', () => {
  let dir: string;
  const calls: string[] = [];
  /** A recorded api.github.com (test/githubFake.ts): REST routes, and GraphQL answered from them. */
  const serve = (routes: Record<string, unknown>) => vi.stubGlobal('fetch', githubFake(routes, calls));
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'baton-facts-'));
    gitInit(dir);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git']);
    process.env.GITHUB_TOKEN = 't';
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GITHUB_TOKEN;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
  });
  const pr = (number: number, head: string, state: string, merged = false) => ({ number, head: { ref: head, sha: `s${number}` }, state, merged_at: merged ? '2026-10-01T00:00:00Z' : null });
  const who = (author_association: string, body: string, at: string) => ({ user: { login: 'x' }, author_association, body, created_at: at, submitted_at: at, state: 'COMMENTED' });

  it('pages the PR list, reads detail only for PRs a live ticket owns — closed unmerged ones too — and keeps verdicts from people with a say', async () => {
    serve({
      '/repos/o/r/pulls?state=all': [[pr(1, 'claude/A-1-x', 'open'), pr(2, 'claude/Z-9-old', 'closed', true)], '/repos/o/r/pulls?state=all&page=2'],
      '/repos/o/r/pulls?state=all&page=2': [pr(3, 'claude/A-1-y', 'closed')],
      '/repos/o/r/commits/s1/check-runs': { check_runs: [{ conclusion: 'success' }, { conclusion: null }] },
      '/repos/o/r/pulls/1/commits': [{ commit: { committer: { date: '2026-10-02T00:00:00Z' } } }, { commit: { committer: { date: '2026-10-03T00:00:00Z' } } }],
      '/repos/o/r/pulls/1/reviews': [],
      '/repos/o/r/issues/1/comments': [who('NONE', '<!-- baton:verdict approve -->', '2026-10-04T00:00:00Z'), who('MEMBER', '<!-- baton:verdict changes -->', '2026-10-05T00:00:00Z')],
      '/repos/o/r/commits/s3/check-runs': { check_runs: [] },
      '/repos/o/r/pulls/3/commits': [],
      '/repos/o/r/pulls/3/reviews': [],
      '/repos/o/r/issues/3/comments': [who('MEMBER', '<!-- baton:concluded -->', '2026-10-06T00:00:00Z')],
    });
    const facts = await githubFacts(dir, () => {}, (p) => p.head.startsWith('claude/A-1-'));
    expect(facts.map((f) => [f.number, f.state])).toEqual([[1, 'open'], [2, 'merged'], [3, 'closed']]);
    // The owned open PR: its checks, every commit's date, and the member's verdict alone.
    expect(facts[0]).toMatchObject({ checks: ['success', null], pushes: [Date.parse('2026-10-02T00:00:00Z'), Date.parse('2026-10-03T00:00:00Z')], pushedAt: Date.parse('2026-10-03T00:00:00Z') });
    expect(facts[0].reviews.map((r) => r.body)).toEqual(['<!-- baton:verdict changes -->']);
    // The closed unmerged PR a live ticket owns is read: review-pr concludes on it (R-BTN-131).
    expect(facts[2].reviews.map((r) => r.body)).toEqual(['<!-- baton:concluded -->']);
    // The two owned PRs' detail is one GraphQL query (B-35); the unowned merged PR costs nothing beyond the list.
    expect(calls).toEqual(['/repos/o/r/pulls?state=all', '/repos/o/r/pulls?state=all&page=2', 'graphql o/r 1,3']);
  });

  it('reads each other repository a live ticket names, and only those, tagging every fact with its repository (B-29)', async () => {
    serve({
      '/repos/o/r/pulls?state=all': [],
      '/repos/o/site/pulls?state=all': [pr(7, 'claude/A-1-x', 'open'), pr(8, 'claude/Z-9-x', 'open')],
      '/repos/o/site/commits/s7/check-runs': { check_runs: [] },
      '/repos/o/site/pulls/7/commits': [],
      '/repos/o/site/pulls/7/reviews': [],
      '/repos/o/site/issues/7/comments': [who('MEMBER', '<!-- baton:verdict approve -->', '2026-10-05T00:00:00Z')],
    });
    const facts = await githubFacts(dir, () => {}, (p) => p.repository === 'o/site' && p.head.startsWith('claude/A-1-'), [{ repository: 'o/site', tickets: ['A-1'] }, { repository: 'O/R', tickets: ['A-1'] }]);
    expect(facts.map((f) => [f.repository, f.number])).toEqual([['o/site', 7], ['o/site', 8]]);
    expect(facts[0].reviews.map((r) => r.body)).toEqual(['<!-- baton:verdict approve -->']);
    // The home in another case is no sibling; the unowned sibling PR costs nothing beyond the list.
    expect(calls).toEqual(['/repos/o/r/pulls?state=all', '/repos/o/site/pulls?state=all', 'graphql o/site 7']);
  });

  /** `pages` pages of 100 open PRs in `repo`, every one on a ticket's branch: a list request a page,
   * and a GraphQL request for every 25 owned PRs. */
  const paged = (routes: Record<string, unknown>, repo: string, pages: number) => {
    for (let k = 0; k < pages; k++) {
      const key = `/repos/${repo}/pulls?state=all${k ? `&page=${k + 1}` : ''}`;
      const prs = Array.from({ length: 100 }, (_, i) => pr(k * 100 + i + 1, `claude/A-${k * 100 + i + 1}-x`, 'open'));
      routes[key] = k + 1 < pages ? [prs, `/repos/${repo}/pulls?state=all&page=${k + 2}`] : prs;
    }
    return routes;
  };

  it('refuses before the request budget is spent, rather than truncate or starve the next runs', async () => {
    // 50 pages of 100 owned PRs: 50 list requests and 200 GraphQL batches, over 200.
    serve(paged({}, 'o/r', 50));
    await expect(githubFacts(dir, () => {}, () => true)).rejects.toThrow('more than 200 requests');
  });

  it('the home and the repositories a ticket names share the one budget; an unreadable one fails the sync naming its tickets (B-29)', async () => {
    // 30 pages of 100 owned PRs in each repository: 30 + 3,000 / 25 = 150 requests apiece, 300 together — over 200, though neither alone is.
    const routes = paged(paged({}, 'o/r', 30), 'o/site', 30);
    serve(routes);
    expect((await githubFacts(dir, () => {}, () => true)).length).toBe(3000); // the home alone fits
    await expect(githubFacts(dir, () => {}, () => true, [{ repository: 'o/site', tickets: ['A-1'] }])).rejects.toThrow('more than 200 requests');
    // A repository the token cannot read (or a typo) stops the sync, and says which ticket named it.
    serve({ '/repos/o/r/pulls?state=all': [] });
    await expect(githubFacts(dir, () => {}, () => true, [{ repository: 'o/private', tickets: ['A-1', 'B-2'] }]))
      .rejects.toThrow("GitHub https://api.github.com/repos/o/private/pulls?state=all&per_page=100: 404 — o/private is named in repos: by A-1, B-2; the sync's token cannot read it, or it does not exist");
    // Only the list's 403 or 404 says so: a failure reading a listed PR's detail is passed through as it is.
    const lists = githubFake({ '/repos/o/r/pulls?state=all': [], '/repos/o/site/pulls?state=all': [pr(7, 'claude/A-1-x', 'open')] });
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => (url.endsWith('/graphql') ? new Response('{}', { status: 502 }) : lists(url, init)));
    const detail = githubFacts(dir, () => {}, () => true, [{ repository: 'o/site', tickets: ['A-1'] }]);
    await expect(detail).rejects.toThrow('GitHub https://api.github.com/graphql (o/site): 502');
    await expect(detail).rejects.not.toThrow('named in repos:');
    // A rate-limit 403 on the list is the token's budget, not the repository: passed through too.
    vi.stubGlobal('fetch', async (url: string) => url.includes('/repos/o/r/')
      ? new Response('[]')
      : new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }));
    const limited = githubFacts(dir, () => {}, () => true, [{ repository: 'o/site', tickets: ['A-1'] }]);
    await expect(limited).rejects.toThrow('GitHub https://api.github.com/repos/o/site/pulls?state=all&per_page=100: 403 (rate limited)');
    await expect(limited).rejects.not.toThrow('named in repos:');
  });

  it('reads the owned PRs\' detail over GraphQL, 25 to a query, mapped as the REST lists are (B-35)', async () => {
    const owned = Array.from({ length: 30 }, (_, i) => pr(i + 1, `claude/A-${i + 1}-x`, 'open'));
    const routes: Record<string, unknown> = { '/repos/o/r/pulls?state=all': [...owned, pr(99, 'feature/other', 'open')] };
    routes['/repos/o/r/commits/s1/check-runs'] = { check_runs: [{ conclusion: 'success' }, { conclusion: 'timed_out' }, { conclusion: null }] };
    routes['/repos/o/r/pulls/1/commits'] = [{ commit: { committer: { date: '2026-10-02T00:00:00Z' } } }];
    routes['/repos/o/r/pulls/1/reviews'] = [{ ...who('COLLABORATOR', '<!-- baton:verdict approve -->', '2026-10-03T00:00:00Z'), state: 'APPROVED' }, who('CONTRIBUTOR', 'drive-by', '2026-10-03T01:00:00Z')];
    routes['/repos/o/r/issues/1/comments'] = [who('OWNER', '<!-- baton:verdict changes -->', '2026-10-04T00:00:00Z')];
    serve(routes);
    const facts = await githubFacts(dir, () => {}, (p) => p.head.startsWith('claude/'));
    expect(calls).toEqual(['/repos/o/r/pulls?state=all', `graphql o/r ${owned.slice(0, 25).map((p) => p.number).join(',')}`, 'graphql o/r 26,27,28,29,30']);
    expect(facts).toHaveLength(31);
    expect(facts[0]).toEqual({
      number: 1, head: 'claude/A-1-x', state: 'open', repository: 'o/r',
      checks: ['success', 'timed_out', null], pushes: [Date.parse('2026-10-02T00:00:00Z')], pushedAt: Date.parse('2026-10-02T00:00:00Z'),
      reviews: [
        { author: 'x', state: 'APPROVED', submittedAt: Date.parse('2026-10-03T00:00:00Z'), body: '<!-- baton:verdict approve -->' },
        { author: 'x', state: 'COMMENTED', submittedAt: Date.parse('2026-10-04T00:00:00Z'), body: '<!-- baton:verdict changes -->' },
      ],
    });
    // An owned PR with no checks, commits or reviews; an unowned PR from the list alone.
    expect(facts[1]).toMatchObject({ checks: [], pushes: [], pushedAt: 0, reviews: [] });
    expect(facts[30]).toEqual({ number: 99, head: 'feature/other', state: 'open', pushedAt: 0, checks: [], reviews: [], repository: 'o/r' });
  });

  it('reads over REST, in full, a connection that overflows its first page, and the checks of a head the batch read at another commit (B-35)', async () => {
    const many = Array.from({ length: 150 }, (_, i) => who('MEMBER', `c${i}`, '2026-10-05T00:00:00Z'));
    serve({
      '/repos/o/r/pulls?state=all': [pr(1, 'claude/A-1-x', 'open')],
      '/repos/o/r/issues/1/comments': [many.slice(0, 100), '/repos/o/r/issues/1/comments?page=2'],
      '/repos/o/r/issues/1/comments?page=2': many.slice(100),
      '/repos/o/r/commits/s1/check-runs': { check_runs: [{ conclusion: 'failure' }] },
    });
    const [fact] = await githubFacts(dir, () => {}, () => true);
    expect(fact.reviews.map((r) => r.body)).toEqual(many.map((c) => c.body));
    expect(calls).toEqual(['/repos/o/r/pulls?state=all', 'graphql o/r 1', '/repos/o/r/issues/1/comments', '/repos/o/r/issues/1/comments?page=2']);
    // The list's head moved on after the batch read the PR: its checks are read at the list's head.
    const routes = { '/repos/o/r/pulls?state=all': [pr(1, 'claude/A-1-x', 'open')], '/repos/o/r/commits/s1/check-runs': { check_runs: [{ conclusion: 'failure' }] } };
    const real = githubFake(routes);
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      const res = await real(url, init);
      if (!url.endsWith('/graphql')) return res;
      const body = await res.json();
      body.data.repository.p1.head.nodes[0].commit = { oid: 'older', checkSuites: null };
      return Response.json(body);
    });
    expect((await githubFacts(dir, () => {}, () => true))[0].checks).toEqual(['failure']);
  });

  it('a board shaped like docs\' fits the budget: 35 repositories, 61 list pages, 49 owned PRs in 16 of them (B-35)', async () => {
    // docs' board as measured on 2026-10-18 (B-35): list pages per repository, and the owned PRs.
    const pages = [8, 5, 4, 4, 3, 3, 3, 2, 2, 2, ...Array(25).fill(1)]; // 35 repositories, 61 pages
    const ownedIn = [10, 6, 5, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1]; // 49 owned PRs in 16 repositories
    const routes: Record<string, unknown> = {};
    const repos = pages.map((_, k) => (k === 0 ? 'o/r' : `o/s${k}`));
    repos.forEach((repo, k) => {
      for (let p = 0; p < pages[k]; p++) {
        const key = `/repos/${repo}/pulls?state=all${p ? `&page=${p + 1}` : ''}`;
        const prs = Array.from({ length: p + 1 < pages[k] ? 100 : 40 }, (_, i) => {
          const n = p * 100 + i + 1;
          return pr(n, n <= (ownedIn[k] ?? 0) ? `claude/R3-${k}${n}-x` : `old/${n}`, n <= (ownedIn[k] ?? 0) ? 'open' : 'closed', true);
        });
        routes[key] = p + 1 < pages[k] ? [prs, `/repos/${repo}/pulls?state=all&page=${p + 2}`] : prs;
      }
    });
    serve(routes);
    const facts = await githubFacts(dir, () => {}, (p) => p.head.startsWith('claude/'), repos.slice(1).map((repository) => ({ repository, tickets: ['R3-1'] })));
    expect(facts.filter((f) => f.head.startsWith('claude/'))).toHaveLength(49);
    // 61 list requests and one GraphQL query for each of the 16 repositories with owned PRs: 77, against 200.
    expect(calls.filter((c) => c.startsWith('graphql '))).toHaveLength(16);
    expect(calls).toHaveLength(77);
  });

  it('reads over REST in full each connection that overflows: commits, reviews and the head\'s check runs (B-35)', async () => {
    const at = (i: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + i * 60_000).toISOString();
    const commits = Array.from({ length: 150 }, (_, i) => ({ commit: { committer: { date: at(i) } } }));
    const reviews = Array.from({ length: 150 }, (_, i) => ({ ...who('MEMBER', `r${i}`, at(i)), state: 'COMMENTED' }));
    const runs = Array.from({ length: 150 }, (_, i) => ({ conclusion: i === 149 ? 'failure' : 'success' }));
    serve({
      '/repos/o/r/pulls?state=all': [pr(1, 'claude/A-1-x', 'open')],
      '/repos/o/r/pulls/1/commits': [commits.slice(0, 100), '/repos/o/r/pulls/1/commits?page=2'],
      '/repos/o/r/pulls/1/commits?page=2': commits.slice(100),
      '/repos/o/r/pulls/1/reviews': [reviews.slice(0, 100), '/repos/o/r/pulls/1/reviews?page=2'],
      '/repos/o/r/pulls/1/reviews?page=2': reviews.slice(100),
      '/repos/o/r/commits/s1/check-runs': [{ check_runs: runs.slice(0, 100) }, '/repos/o/r/commits/s1/check-runs?page=2'],
      '/repos/o/r/commits/s1/check-runs?page=2': { check_runs: runs.slice(100) },
    });
    const [fact] = await githubFacts(dir, () => {}, () => true);
    expect(fact.pushes).toHaveLength(150);
    expect(fact.pushedAt).toBe(Date.parse(at(149)));
    expect(fact.reviews.map((r) => r.body)).toEqual(reviews.map((r) => r.body));
    expect(fact.checks).toHaveLength(150);
    expect(fact.checks.at(-1)).toBe('failure');
    expect(calls.filter((c) => !c.startsWith('graphql ')).sort()).toEqual([
      '/repos/o/r/commits/s1/check-runs', '/repos/o/r/commits/s1/check-runs?page=2',
      '/repos/o/r/pulls/1/commits', '/repos/o/r/pulls/1/commits?page=2',
      '/repos/o/r/pulls/1/reviews', '/repos/o/r/pulls/1/reviews?page=2',
      '/repos/o/r/pulls?state=all',
    ]);
  });

  it('maps an answer in GitHub\'s GraphQL shape: runs across suites, a run not completed null, enums lowercased, a ghost author, untrusted authors dropped (B-35)', async () => {
    // Written to GitHub's public GraphQL schema, not built from the REST fixtures: the runs sit in
    // several check suites, one of them empty, and a deleted user is a null author.
    const runs = (nodes: unknown[]) => ({ checkRuns: { pageInfo: { hasNextPage: false }, nodes } });
    const answer = {
      data: { repository: { p4: {
        head: { nodes: [{ commit: { oid: 's4', checkSuites: { pageInfo: { hasNextPage: false }, nodes: [
          runs([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'QUEUED', conclusion: null }]),
          runs([]),
          runs([{ status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' }]),
        ] } } }] },
        commits: { pageInfo: { hasNextPage: false }, nodes: [{ commit: { committedDate: '2026-10-07T10:00:00Z' } }, { commit: { committedDate: '2026-10-07T09:00:00Z' } }] },
        reviews: { pageInfo: { hasNextPage: false }, nodes: [
          { author: null, authorAssociation: 'MEMBER', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-07T11:00:00Z', body: '<!-- baton:verdict changes -->' },
          { author: { login: 'drive' }, authorAssociation: 'FIRST_TIME_CONTRIBUTOR', state: 'APPROVED', submittedAt: '2026-10-07T11:30:00Z', body: '<!-- baton:verdict approve -->' },
        ] },
        comments: { pageInfo: { hasNextPage: false }, nodes: [{ author: { login: 'own' }, authorAssociation: 'OWNER', createdAt: '2026-10-07T12:00:00Z', body: null }] },
      } } },
    };
    const lists = githubFake({ '/repos/o/r/pulls?state=all': [pr(4, 'claude/A-4-x', 'open')] });
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => (url.endsWith('/graphql') ? Response.json(answer) : lists(url, init)));
    const [fact] = await githubFacts(dir, () => {}, () => true);
    expect(fact).toEqual({
      number: 4, head: 'claude/A-4-x', state: 'open', repository: 'o/r',
      checks: ['success', null, 'action_required'],
      pushes: [Date.parse('2026-10-07T10:00:00Z'), Date.parse('2026-10-07T09:00:00Z')], pushedAt: Date.parse('2026-10-07T10:00:00Z'),
      reviews: [
        { author: '?', state: 'CHANGES_REQUESTED', submittedAt: Date.parse('2026-10-07T11:00:00Z'), body: '<!-- baton:verdict changes -->' },
        { author: 'own', state: 'COMMENTED', submittedAt: Date.parse('2026-10-07T12:00:00Z'), body: '' },
      ],
    });
    // More check suites than the first page: the head's runs are read over REST in full.
    const many = structuredClone(answer);
    many.data.repository.p4.head.nodes[0].commit.checkSuites.pageInfo.hasNextPage = true;
    const restRuns = githubFake({ '/repos/o/r/pulls?state=all': [pr(4, 'claude/A-4-x', 'open')], '/repos/o/r/commits/s4/check-runs': { check_runs: [{ conclusion: 'neutral' }] } });
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => (url.endsWith('/graphql') ? Response.json(many) : restRuns(url, init)));
    expect((await githubFacts(dir, () => {}, () => true))[0].checks).toEqual(['neutral']);
    // A listed PR the query cannot find fails the sync, rather than reading it as having no detail.
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => (url.endsWith('/graphql') ? Response.json({ data: { repository: { p4: null } } }) : lists(url, init)));
    await expect(githubFacts(dir, () => {}, () => true)).rejects.toThrow('GitHub GraphQL (o/r): no pull request #4, though the list has it');
  });

  it('fails the sync on a GraphQL answer carrying errors, posting nothing (B-35)', async () => {
    const lists = githubFake({ '/repos/o/r/pulls?state=all': [pr(1, 'claude/A-1-x', 'open')] });
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => (url.endsWith('/graphql') ? Response.json({ data: null, errors: [{ message: 'Something went wrong' }] }) : lists(url, init)));
    await expect(githubFacts(dir, () => {}, () => true)).rejects.toThrow('GitHub GraphQL (o/r): Something went wrong');
  });
});

// B-28 (R-BTN-131): the standard courses beside create-pr — each scaffolded by `init --course`,
// joining the first in baton.json; the leg stubs hand the agent the leg's instructions read at the
// snapshot; the marker courses' stubs return their positions; `pr` is no longer scaffolded, and a
// repository still on it keeps its files when init only moves the pin.
describe('baton repo init --course, the standard courses (R-BTN-131)', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'baton-courses-'));
    gitInit(root);
    baton(root, 'repo', 'init', '--pin', PIN);
    for (const c of ['bug-report', 'decision', 'review-pr', 'draft-ticket']) baton(root, 'repo', 'init', '--course', c, '--pin', PIN);
    commitAll(root);
  }, 240_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('a second course joins the first: its entry is added to baton.json, the default stays, its files are written', () => {
    const settings = JSON.parse(readFileSync(join(root, '.baton', 'baton.json'), 'utf8'));
    expect(settings.default_course).toBe('create-pr');
    expect(settings.courses.map((c: { id: string }) => c.id)).toEqual(['create-pr', 'bug-report', 'decision', 'review-pr', 'draft-ticket']);
    expect(settings.courses[1]).toEqual({ id: 'bug-report', version: 1, min_worker_version: 1, skill: 'baton-bug-report', step_kinds: ['trace', 'origin', 'dedupe', 'file', 'fold', 'prevent'], report_horizon_h: 6, branch_pattern: 'claude/{ticket}-*', protocol_files: [], source: sourceOf('bug-report') });
    for (const [course, legs] of [['bug-report', 6], ['decision', 2], ['review-pr', 2], ['draft-ticket', 3]] as const) {
      expect(readdirSync(join(root, '.baton', 'courses', course, 'legs')).length, course).toBe(legs * 2);
    }
    expect(JSON.parse(readFileSync(join(root, '.baton', 'courses', 'bug-report', 'course.json'), 'utf8')).start).toBe('reported');
  });

  it('a stub hands its agent the instructions read at the snapshot, the course, the leg and the ticket file; an outcome leg checks the last line', async () => {
    const agent = join(root, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\nhead -n 1 "$BATON_INSTRUCTIONS" > "$(dirname "$0")/agent.seen"\necho "$BATON_COURSE $BATON_LEG $BATON_TICKET_FILE" >> "$(dirname "$0")/agent.seen"\necho "$OUTCOME"\n');
    chmodSync(agent, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const before = readFileSync(settingsFile, 'utf8');
    const instructions = join(root, '.baton', 'courses', 'bug-report', 'legs', 'dedupe.md');
    const shipped = readFileSync(instructions, 'utf8');
    try {
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), agent_command: agent }));
      const snapshot = { sha: commitAll(root) };
      // An uncommitted edit to the instructions is never what the agent reads.
      writeFileSync(instructions, '# rewritten by a branch\n');
      const stub = await load(join(root, '.baton', 'courses', 'bug-report', 'legs', 'dedupe.mjs'));
      process.env.OUTCOME = 'duplicate';
      expect(await stub.run({ ticket: { id: 'B-1', path: 'tickets/B-1.md' }, checkout: root, snapshot })).toEqual({ reached: 'duplicate', next: 'fold' });
      expect(readFileSync(join(root, 'agent.seen'), 'utf8')).toBe('# bug-report · dedupe — is the cause already ticketed?\nbug-report dedupe tickets/B-1.md\n');
      process.env.OUTCOME = 'new-cause';
      expect(await stub.run({ ticket: { id: 'B-1' }, checkout: root, snapshot })).toEqual({ reached: 'new-cause', next: 'file' });
      process.env.OUTCOME = 'maybe';
      await expect(stub.run({ ticket: { id: 'B-1' }, checkout: root, snapshot })).rejects.toThrow('the dedupe agent printed no outcome (new-cause or duplicate) as its last line — its last line was "maybe"');
      // A PR course's commenting leg may name the PR after its answer (B-29); anything else after it is refused.
      const review = await load(join(root, '.baton', 'courses', 'review-pr', 'legs', 'review.mjs'));
      process.env.OUTCOME = 'approve https://github.com/o/site/pull/7';
      expect(await review.run({ ticket: { id: 'R-1' }, checkout: root, snapshot })).toEqual({ reached: 'approved', next: null, verdict: 'approve', pr: 'https://github.com/o/site/pull/7' });
      process.env.OUTCOME = 'changes';
      expect(await review.run({ ticket: { id: 'R-1' }, checkout: root, snapshot })).toEqual({ suspend: true, reached: 'changes-requested', next: 'review', verdict: 'changes' });
      process.env.OUTCOME = 'approve o/site#7';
      await expect(review.run({ ticket: { id: 'R-1' }, checkout: root, snapshot })).rejects.toThrow('the review agent\'s last line names no PR URL after its verdict');
      // B-85: prose around the verdict no longer loses the round (B-80's review). The verdict line
      // is read wherever it sits; a summary after it is the agent's, and names no PR.
      for (const [prose, expected] of [
        ['I reviewed the diff and found nothing blocking.\napprove', {}],
        ['approve\n\nI read every hunk of the diff; details above.', {}],
        ['approve https://github.com/o/site/pull/7\nRound 1: the diff is sound, merging is safe.', { pr: 'https://github.com/o/site/pull/7' }],
        ['I read the diff.\napprove https://github.com/o/site/pull/7\n\n', { pr: 'https://github.com/o/site/pull/7' }],
      ] as const) {
        process.env.OUTCOME = prose;
        expect(await review.run({ ticket: { id: 'R-1' }, checkout: root, snapshot }), prose).toEqual({ reached: 'approved', next: null, verdict: 'approve', ...expected });
      }
      process.env.OUTCOME = 'changes https://github.com/o/site/pull/7\nI left two blocking notes above.';
      expect(await review.run({ ticket: { id: 'R-1' }, checkout: root, snapshot })).toEqual({ suspend: true, reached: 'changes-requested', next: 'review', verdict: 'changes', pr: 'https://github.com/o/site/pull/7' });
      // A value word mid-line only is not an answer: a stray mention never stands for a verdict.
      process.env.OUTCOME = 'My verdict: approve';
      await expect(review.run({ ticket: { id: 'R-1' }, checkout: root, snapshot })).rejects.toThrow('the review agent printed no verdict (approve or changes) as its last line — its last line was "My verdict: approve"');
      // A leg with no answer names its PR by a last line that is a URL alone; any other last line names none.
      const conclude = await load(join(root, '.baton', 'courses', 'review-pr', 'legs', 'conclude.mjs'));
      process.env.OUTCOME = 'https://github.com/o/site/pull/7';
      expect(await conclude.run({ ticket: { id: 'R-1' }, checkout: root, snapshot })).toEqual({ reached: 'concluded', next: null, pr: 'https://github.com/o/site/pull/7' });
      process.env.OUTCOME = 'summary posted';
      expect(await conclude.run({ ticket: { id: 'R-1' }, checkout: root, snapshot })).toEqual({ reached: 'concluded', next: null });
      // A marker course's stub closes with markerClose; a PR course's with prClose.
      expect(stub.close.name).toBe('markerClose');
      expect((await load(join(root, '.baton', 'courses', 'review-pr', 'legs', 'conclude.mjs'))).close.name).toBe('prClose');
    } finally {
      delete process.env.OUTCOME;
      writeFileSync(instructions, shipped);
      writeFileSync(settingsFile, before);
      commitAll(root);
    }
  });

  it('the course test kit passes on each scaffolded course: its file, its stubs, one generic run to its end', () => {
    for (const c of ['create-pr', 'review-pr', 'bug-report', 'draft-ticket', 'decision']) {
      expect(baton(root, 'test-course', root, c, '--base', 'none'), c).toContain('✓ no violations');
    }
  }, 240_000);

  it('--course pr is refused, naming create-pr; an unknown course names the choices', () => {
    expect(() => baton(root, 'repo', 'init', '--course', 'pr', '--pin', PIN)).toThrow(/renamed create-pr/);
    expect(() => baton(root, 'repo', 'init', '--course', 'chore', '--pin', PIN)).toThrow(/scaffolds create-pr, review-pr, bug-report, draft-ticket, decision/);
  });

  it('a repository still on pr: init with no --course moves the pin and keeps every file', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'baton-legacy-'));
    try {
      gitInit(legacy);
      execFileSync('mkdir', ['-p', join(legacy, '.baton', 'courses', 'pr')]);
      const settings = { default_course: 'pr', courses: [{ id: 'pr', version: 1 }] };
      writeFileSync(join(legacy, '.baton', 'baton.json'), JSON.stringify(settings));
      writeFileSync(join(legacy, '.baton', 'courses', 'pr', 'course.json'), '{"kept":true}');
      const out = baton(legacy, 'repo', 'init', '--pin', OTHER_PIN);
      expect(out).toMatch(/course pr is now create-pr — its files are kept/);
      expect(JSON.parse(readFileSync(join(legacy, '.baton', 'baton.json'), 'utf8'))).toEqual(settings);
      expect(readFileSync(join(legacy, '.baton', 'courses', 'pr', 'course.json'), 'utf8')).toBe('{"kept":true}');
      expect(readFileSync(join(legacy, '.github', 'workflows', 'baton-sync.yml'), 'utf8')).toContain('ref: abababababababababababababababababababab');
      expect(readdirSync(join(legacy, '.baton', 'courses'))).toEqual(['pr']);
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('a repository still on pr beside a sourced course (B-33)', () => {
  it('init with no --course refuses a --pin its sources do not name, and otherwise moves their sources with the pin', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'baton-legacy-'));
    try {
      gitInit(legacy);
      baton(legacy, 'repo', 'init', '--course', 'create-pr');
      const settingsFile = join(legacy, '.baton', 'baton.json');
      const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
      const old = `github/${SELF.slug}/${'3'.repeat(40)}/create-pr`;
      // `pr` is the default, as a repository scaffolded before create-pr keeps it; create-pr's source is older.
      writeFileSync(settingsFile, JSON.stringify({ ...settings, default_course: 'pr', courses: [{ id: 'pr', version: 1 }, { ...settings.courses[0], source: old }] }, null, 2));
      const before = readFileSync(settingsFile, 'utf8');
      const workflow = readFileSync(join(legacy, '.github', 'workflows', 'baton-sync.yml'), 'utf8');
      expect(() => baton(legacy, 'repo', 'init', '--pin', OTHER_PIN)).toThrow(`--pin names immediately-run/baton@${'ab'.repeat(5)}`);
      expect(readFileSync(settingsFile, 'utf8')).toBe(before);
      expect(readFileSync(join(legacy, '.github', 'workflows', 'baton-sync.yml'), 'utf8')).toBe(workflow);
      const script = join(legacy, '.baton', 'courses', 'create-pr', 'legs', 'review.mjs');
      writeFileSync(script, '// an older release\n');
      expect(baton(legacy, 'repo', 'init')).toContain(`create-pr now from ${SELF.sha.slice(0, 10)}`);
      const moved = JSON.parse(readFileSync(settingsFile, 'utf8'));
      expect(moved).toMatchObject({ default_course: 'pr', courses: [{ id: 'pr' }, { id: 'create-pr', source: sourceOf('create-pr') }] });
      expect(readFileSync(script, 'utf8')).toContain('.baton/courses/create-pr/legs/review.run.mjs');
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  }, 120_000);
});

// B-33 (R-BTN-131, R-BTN-51): a course named by its source runs the source's graph exactly, and
// a repository replaces only the run of the legs it implements differently.
describe('course sources and leg overrides (B-33)', () => {
  let root: string;
  const legs = () => join(root, '.baton', 'courses', 'create-pr', 'legs');
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'baton-override-'));
    gitInit(root);
    baton(root, 'repo', 'init', '--pin', PIN, '--override', 'review');
    commitAll(root);
  }, 120_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('--override seeds legs/<leg>.run.mjs calling the course’s own run; a leg the course lacks is refused before anything is written', () => {
    const seeded = readFileSync(join(legs(), 'review.run.mjs'), 'utf8');
    expect(seeded).toContain('export async function run(ctx, standard) {\n  return standard(ctx);\n}');
    expect(seeded).toContain("{ reached: 'reviewed', next: answer === 'approve' ? 'merge' : 'fix', verdict: answer }");
    expect(() => baton(root, 'repo', 'init', '--pin', PIN, '--override', 'deploy')).toThrow(/--override deploy: create-pr has no such leg — its legs are implement, review, fix, adjudicate, merge/);
    expect(existsSync(join(legs(), 'deploy.run.mjs'))).toBe(false);
  });

  it('--force rewrites Baton’s files — the leg scripts, the course file — never the repository’s instructions or overrides', () => {
    const stub = join(legs(), 'merge.mjs');
    const md = join(legs(), 'merge.md');
    const override = join(legs(), 'review.run.mjs');
    const before = [stub, md, override].map((f) => readFileSync(f, 'utf8'));
    try {
      writeFileSync(stub, `${before[0]}\n// edited\n`);
      writeFileSync(md, `${before[1]}\n<!-- ours -->\n`);
      writeFileSync(override, `${before[2]}\n// ours\n`);
      baton(root, 'repo', 'init', '--pin', PIN, '--course', 'create-pr', '--force', '--override', 'review');
      expect(readFileSync(stub, 'utf8')).not.toContain('// edited');
      expect(readFileSync(md, 'utf8')).toContain('<!-- ours -->');
      expect(readFileSync(override, 'utf8')).toContain('// ours');
    } finally {
      [stub, md, override].forEach((f, i) => writeFileSync(f, before[i]));
    }
  }, 120_000);

  it('init moves a course’s source to this CLI’s commit, rewriting its course file and leg scripts and keeping the repository’s files', () => {
    const settingsFile = join(root, '.baton', 'baton.json');
    const stub = join(legs(), 'fix.mjs');
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    const old = `github/${SELF.slug}/${'1'.repeat(40)}/create-pr`;
    writeFileSync(settingsFile, JSON.stringify({ ...settings, agent_command: 'mine', courses: [{ ...settings.courses[0], source: old, version: 4 }] }, null, 2));
    writeFileSync(stub, '// an older release\n');
    writeFileSync(join(legs(), 'review.run.mjs'), '// ours\nexport async function run(ctx, standard) { return standard(ctx); }\n');
    try {
      expect(baton(root, 'repo', 'init', '--pin', PIN)).toContain(`create-pr now from ${SELF.sha.slice(0, 10)}`);
      const moved = JSON.parse(readFileSync(settingsFile, 'utf8'));
      expect(moved).toMatchObject({ agent_command: 'mine', courses: [{ id: 'create-pr', version: 4, source: sourceOf('create-pr') }] });
      expect(readFileSync(stub, 'utf8')).toContain('.baton/courses/create-pr/legs/fix.run.mjs'); // the current leg script, bundled
      expect(readFileSync(join(legs(), 'review.run.mjs'), 'utf8')).toContain('// ours');
    } finally {
      writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
      commitAll(root);
    }
  }, 120_000);

  it('the leg script runs the override at the claim’s snapshot, keeping its own close; one only in the working tree is not run; one with no run fails the leg', async () => {
    const agent = join(root, 'agent.sh');
    writeFileSync(agent, '#!/bin/sh\necho "$VERDICT"\n');
    chmodSync(agent, 0o755);
    const settingsFile = join(root, '.baton', 'baton.json');
    const override = join(legs(), 'review.run.mjs');
    const before = [readFileSync(settingsFile, 'utf8'), readFileSync(override, 'utf8')];
    const script = join(legs(), 'review.mjs');
    try {
      writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before[0]), agent_command: agent }));
      process.env.VERDICT = 'changes';
      // A snapshot with no override runs the course's own run — even with one in the working tree.
      rmSync(override);
      const plain = { sha: commitAll(root) };
      writeFileSync(override, 'export async function run() { throw new Error("from the working tree"); }\n');
      expect(await (await load(script)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot: plain, leg: 'review' })).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      // The override at the snapshot: its own work, then the course's run, its verdict kept.
      writeFileSync(override, `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export async function run(ctx, standard) {
  writeFileSync(join(ctx.checkout, 'override.ran'), ctx.leg);
  return { ...(await standard(ctx)), reached: 'reviewed' };
}
`);
      const snapshot = { sha: commitAll(root) };
      rmSync(join(root, 'override.ran'), { force: true });
      const stub = await load(script);
      expect(await stub.run({ ticket: { id: 'A-1' }, checkout: root, snapshot, leg: 'review' })).toEqual({ reached: 'reviewed', next: 'fix', verdict: 'changes' });
      expect(readFileSync(join(root, 'override.ran'), 'utf8')).toBe('review');
      expect(stub.close.name).toBe('prClose'); // the course's close, whatever the override does
      // An override exporting no run fails the leg, naming the file.
      writeFileSync(override, 'export const nothing = 1;\n');
      const broken = { sha: commitAll(root) };
      await expect((await load(script)).run({ ticket: { id: 'A-1' }, checkout: root, snapshot: broken, leg: 'review' })).rejects.toThrow('.baton/courses/create-pr/legs/review.run.mjs exports no run(ctx, standard)');
    } finally {
      delete process.env.VERDICT;
      writeFileSync(settingsFile, before[0]);
      writeFileSync(override, before[1]);
      commitAll(root);
    }
  }, 120_000);

  it('a --pin other than this CLI’s repository at its commit is refused before anything is written while a course names a source; with none, the pin moves', () => {
    const workflowFile = join(root, '.github', 'workflows', 'baton-sync.yml');
    const settingsFile = join(root, '.baton', 'baton.json');
    const workflow = readFileSync(workflowFile, 'utf8');
    const settings = readFileSync(settingsFile, 'utf8');
    expect(() => baton(root, 'repo', 'init', '--pin', OTHER_PIN)).toThrow(`--pin names immediately-run/baton@${'ab'.repeat(5)}, but this CLI is ${SELF.slug}@${SELF.sha.slice(0, 10)}, which the courses' sources name`);
    // A refused init reports no change it did not make.
    let said = '';
    try {
      baton(root, 'repo', 'init', '--course', 'bug-report', '--pin', OTHER_PIN);
    } catch (e) {
      said = String((e as { stdout?: unknown }).stdout);
    }
    expect(said).not.toContain('lists course bug-report');
    // Another repository at this very commit — a fork's pin — is refused just the same.
    expect(() => baton(root, 'repo', 'init', '--pin', `Fork-Owner/baton@${SELF.sha}`)).toThrow(`--pin names Fork-Owner/baton@${SELF.sha.slice(0, 10)}`);
    expect(readFileSync(workflowFile, 'utf8')).toBe(workflow);
    expect(readFileSync(settingsFile, 'utf8')).toBe(settings);
    try {
      // A repository whose courses name no source: its sync checks none, so its pin moves freely.
      const parsed = JSON.parse(settings);
      writeFileSync(settingsFile, JSON.stringify({ ...parsed, courses: parsed.courses.map(({ source: _s, ...c }: { source?: string }) => c) }, null, 2));
      baton(root, 'repo', 'init', '--pin', OTHER_PIN);
      expect(readFileSync(workflowFile, 'utf8')).toContain(`ref: ${'ab'.repeat(20)}`);
    } finally {
      writeFileSync(settingsFile, settings);
      writeFileSync(workflowFile, workflow);
    }
  }, 120_000);

  it('--override replaces an older leg script, which could not load the override, even on a course with no source', () => {
    const settingsFile = join(root, '.baton', 'baton.json');
    const settings = readFileSync(settingsFile, 'utf8');
    const script = join(legs(), 'review.mjs');
    try {
      const parsed = JSON.parse(settings);
      writeFileSync(settingsFile, JSON.stringify({ ...parsed, courses: parsed.courses.map(({ source: _s, ...c }: { source?: string }) => c) }, null, 2));
      writeFileSync(script, 'export async function run() { return null; } // a leg script from before overrides\n');
      baton(root, 'repo', 'init', '--pin', PIN, '--override', 'review');
      expect(readFileSync(script, 'utf8')).toContain('.baton/courses/create-pr/legs/review.run.mjs');
    } finally {
      writeFileSync(settingsFile, settings);
      commitAll(root);
    }
  }, 120_000);

  it('init moves every course from this CLI’s repository: a second course’s source and leg scripts move too', () => {
    const settingsFile = join(root, '.baton', 'baton.json');
    const before = readFileSync(settingsFile, 'utf8');
    try {
      baton(root, 'repo', 'init', '--pin', PIN, '--course', 'bug-report');
      const two = JSON.parse(readFileSync(settingsFile, 'utf8'));
      const old = (c: string) => `github/${SELF.slug}/${'2'.repeat(40)}/${c}`;
      // A third entry whose source names another course than its id: the sync refuses it; init leaves it.
      const stray = { id: 'docs-pr', version: 1, source: old('create-pr') };
      writeFileSync(settingsFile, JSON.stringify({ ...two, courses: [...two.courses.map((c: { id: string }) => ({ ...c, source: old(c.id) })), stray] }, null, 2));
      const trace = join(root, '.baton', 'courses', 'bug-report', 'legs', 'trace.mjs');
      writeFileSync(trace, '// an older release\n');
      expect(baton(root, 'repo', 'init', '--pin', PIN, '--course', 'create-pr')).toContain(`create-pr, bug-report now from ${SELF.sha.slice(0, 10)}`);
      expect(JSON.parse(readFileSync(settingsFile, 'utf8')).courses.map((c: { source: string }) => c.source)).toEqual([sourceOf('create-pr'), sourceOf('bug-report'), old('create-pr')]);
      expect(readFileSync(trace, 'utf8')).toContain('.baton/courses/bug-report/legs/trace.run.mjs');
    } finally {
      writeFileSync(settingsFile, before);
      rmSync(join(root, '.baton', 'courses', 'bug-report'), { recursive: true, force: true });
      commitAll(root);
    }
  }, 180_000);

  it('an override whose position is no edge is refused by the runner’s decision, before close writes anything', async () => {
    const override = join(legs(), 'review.run.mjs');
    const before = readFileSync(override, 'utf8');
    try {
      writeFileSync(override, "export async function run() { return { reached: 'merged', next: null, verdict: 'approve' }; }\n");
      const snapshot = { sha: commitAll(root) };
      const result = await (await load(join(legs(), 'review.mjs'))).run({ ticket: { id: 'A-1' }, checkout: root, snapshot, leg: 'review' });
      // The runner decides on the result before it calls close (runner.ts): a script bug suspends.
      expect(decide(result, graphOf(CREATE_PR_COURSE), 'review', 'pr-open')).toMatchObject({ bug: true, why: "reached merged, which is not an outcome of review (reviewed)", reached: 'pr-open', next: 'review' });
    } finally {
      writeFileSync(override, before);
      commitAll(root);
    }
  }, 120_000);

  it('the course test kit passes a course with an override, and fails one that exports no run or overrides no leg', () => {
    expect(baton(root, 'test-course', root, 'create-pr', '--base', 'none')).toContain('✓ no violations');
    const extra = join(legs(), 'deploy.run.mjs');
    const override = join(legs(), 'review.run.mjs');
    const before = readFileSync(override, 'utf8');
    try {
      writeFileSync(override, 'export const nothing = 1;\n');
      writeFileSync(extra, 'export async function run(ctx, standard) { return standard(ctx); }\n');
      let out = '';
      try {
        baton(root, 'test-course', root, 'create-pr', '--base', 'none');
      } catch (e) {
        out = String((e as { stdout?: unknown }).stdout);
      }
      expect(out).toContain('✗ legs-scripts: legs/review.run.mjs exports no run(ctx, standard)');
      expect(out).toContain('✗ legs-scripts: legs/deploy.run.mjs overrides no leg of the course');
    } finally {
      writeFileSync(override, before);
      rmSync(extra, { force: true });
    }
  }, 120_000);

  it('the kit fails a start leg that returns its position for a no-op agent with no PR (B-81), and passes the standard one', () => {
    // The scaffolded stub above — the standard one — already passed the same run in the test
    // before: its implement fails the no-op leg naming what it looked for.
    const script = join(legs(), 'implement.mjs');
    const before = readFileSync(script, 'utf8');
    try {
      writeFileSync(script, 'export async function run() { return { reached: "pr-open", next: "review" }; }\nexport async function handoff() { return null; }\nexport const close = () => "";\n');
      let out = '';
      try {
        baton(root, 'test-course', root, 'create-pr', '--base', 'none');
      } catch (e) {
        out = String((e as { stdout?: unknown }).stdout);
      }
      expect(out).toContain('✗ no-op: legs/implement.mjs returned {"reached":"pr-open","next":"review"} for an agent_command that exits 0 with no PR — the course opens PRs, so its start leg must verify one on the forge before returning its position, failing the leg naming what it looked for (B-81)');
    } finally {
      writeFileSync(script, before);
    }
  }, 120_000);
});

describe('courseSchemas: the sync posts a course\'s schemas (R-BTN-108)', () => {
  it('reads .baton/schemas/<course>/<name>@<n>.json as <course>:<name>@<n>, with the SHA-256 of its bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'baton-schemas-'));
    try {
      expect(courseSchemas(root, 'roadmap-pr')).toEqual({});
      const dir = join(root, '.baton', 'schemas', 'roadmap-pr');
      mkdirSync(dir, { recursive: true });
      const text = '{ "type": "object" }\n';
      writeFileSync(join(dir, 'findings@2.json'), text);
      writeFileSync(join(dir, 'README.md'), 'not a schema');
      writeFileSync(join(dir, 'findings.json'), '{}');
      expect(courseSchemas(root, 'roadmap-pr')).toEqual({ schemas: [{ id: 'roadmap-pr:findings@2', digest: createHash('sha256').update(text).digest('hex'), schema: { type: 'object' } }] });
      writeFileSync(join(dir, 'broken@1.json'), '{');
      expect(() => courseSchemas(root, 'roadmap-pr')).toThrow(/broken@1.json is not JSON/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
