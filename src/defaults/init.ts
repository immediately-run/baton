// `baton repo init` (R-BTN-74, R-BTN-131): scaffold standard courses and check their stubs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { HARNESS_AGENTS, type Harness } from '../runner/harness';
import { DEFAULT_BRANCH_PATTERN } from './course-pr';
import { parseSource, printSource } from './course-source';
import { DEFAULT_COURSE, builtIn, scaffoldable, type BuiltIn } from './courses';
import { cliPin, cliSelf, courseFileText, defaultSkill, parsePin, sameRepo, type BatonJson, type CourseEntry } from './repo-source';
import { OVERRIDE_SUFFIX } from './stub-config';
import { instructionsOf, overrideSource, runnerLegs, stubBytes, wrapperExample, WRAPPER_EXAMPLE, writeWrapper } from './stubs';
import { readTicketSettings } from './tickets-config';
import { PAGE_NAME, ticketsPage } from './tickets-page';

export { prebuildDefaults } from './stubs';

/** The `courses` entry `baton repo init` writes: every R-BTN-51 field, so a repository edits
 * them where the spec says rather than discovering them. Never `min_worker_version`: init
 * writes the new name only; the window is on the read (above). */
function courseEntry(course: string, legs: string[]): Required<Omit<CourseEntry, 'previous_branch_pattern' | 'source' | 'min_worker_version'>> {
  return { id: course, version: 1, min_runner_version: 1, skill: defaultSkill(course), step_kinds: legs, branch_pattern: DEFAULT_BRANCH_PATTERN, protocol_files: [] };
}

/** Compare installed stubs to the recorded course source without loading or writing them. */
async function checkStubs(root: string, settings: BatonJson | null, named: string | null, log: (line: string) => void): Promise<number> {
  const sourced = (settings?.courses ?? []).filter((c) => c.source != null && (named == null || c.id === named));
  if (!sourced.length) {
    log(`baton: no pinned course${named ? ` named ${named}` : 's'} in .baton/baton.json`);
    return 1;
  }
  const self = cliSelf();
  let failed = false;
  let checked = 0;
  for (const c of sourced) {
    const src = parseSource(c.source!);
    const b = builtIn(c.id);
    if (b?.id !== c.id || src.course !== c.id || !self || !sameRepo(src, self) || src.ref !== self.sha) {
      failed = true;
      log(`baton: cannot check ${c.id} against ${c.source} — use a Baton CLI built from that pin`);
      continue;
    }
    for (const leg of runnerLegs(b)) {
      const rel = `.baton/courses/${c.id}/legs/${leg}.mjs`;
      let actual: Buffer;
      try {
        actual = readFileSync(join(root, rel));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        log(`baton: ${rel} is missing (pinned to ${c.source})`);
        failed = true;
        continue;
      }
      checked++;
      if (!actual.equals(await stubBytes(b, leg))) {
        log(`baton: ${rel} differs from ${c.source}`);
        failed = true;
      }
    }
  }
  if (!failed) log(`baton: ${checked} leg stubs match their pinned sources`);
  return failed ? 1 : 0;
}

/** `baton repo init [--course <standard course>] [--agent opencode|claude-code]
 * [--agent-command <cmd>] [--override <leg>]… [--eject tickets|stations] [--pin owner/name@commit]
 * [--force]` (R-BTN-74, R-BTN-131). Run again with another `--course`, it adds that course beside the first:
 * its files, and its entry in `.baton/baton.json`'s `courses`. With no `--course` it takes the
 * repository's `default_course`, else `create-pr`; a repository still on `pr`, the name
 * `create-pr` replaced, keeps its files and gets the new pin only.
 *
 * The `agent_command` the stubs run (B-83): `--agent` names the harness whose command it is
 * (`opencode` by default, `claude-code` the other), `--agent-command` names any command
 * outright — including `echo`, the no-op stub for tests, which is never written otherwise. A
 * fresh repository gets the chosen harness's command, printed for the unfamiliar; an existing
 * bare `echo` is replaced by it, loudly; any other named command is kept, as the repository's
 * own.
 *
 * Each standard course's entry names its `source`, `github/<owner>/<name>/<commit>/<course>`: the
 * CLI's own repository at the commit that wrote the files, which the sync holds the course file to
 * (B-33). Files are Baton's or the repository's. Baton's — the course file and the leg scripts —
 * are written when missing, under `--force`, and whenever a course's source moves to this CLI's
 * commit, which every init does for every course from this repository, as it moves the workflow's
 * pin. The repository's — the leg instructions, `--override`'s `legs/<leg>.run.mjs`, the tickets
 * README — are written only when missing, never over its edits. `--force` also rewrites the named
 * course's entry, never the rest of the file. */
export async function initMain(argv: string[], io: { root?: string; log?: (l: string) => void } = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let named: string | null = null;
  let eject: 'tickets' | 'stations' | null = null;
  let pin: string | null = null;
  let force = false;
  let check = false;
  let agent: Harness = 'opencode';
  let agentNamed = false;
  let agentCommand: string | null = null;
  const overrides: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--course') named = value();
    else if (a === '--pin') pin = value();
    else if (a === '--force') force = true;
    else if (a === '--check') check = true;
    else if (a === '--override') overrides.push(value());
    else if (a === '--agent') {
      const v = value();
      if (v !== 'opencode' && v !== 'claude-code') throw new Error('--agent: opencode or claude-code');
      agent = v;
      agentNamed = true;
    } else if (a === '--agent-command') agentCommand = value();
    else if (a === '--eject') {
      const v = value();
      if (v !== 'tickets' && v !== 'stations') throw new Error('--eject: tickets or stations');
      eject = v;
    } else throw new Error(`${a}: not a flag of baton repo init`);
  }
  const root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  const settingsPath = join(root, '.baton', 'baton.json');
  const existing = existsSync(settingsPath) ? (JSON.parse(readFileSync(settingsPath, 'utf8')) as BatonJson) : null;
  if (check) {
    if (force || pin || eject || overrides.length || agentNamed || agentCommand != null) throw new Error('--check is read-only and takes only --course');
    return checkStubs(root, existing, named, log);
  }
  const course = named ?? existing?.default_course ?? DEFAULT_COURSE;
  const standard = builtIn(course);
  if (eject === 'tickets') {
    const to = join(root, '.baton', 'tickets.mjs');
    if (existsSync(to) && !force) throw new Error(`${relative(root, to)} already exists — it may hold your edits; --force overwrites it`);
    mkdirSync(join(root, '.baton'), { recursive: true });
    await writeWrapper('tickets', course, to);
    log('baton: .baton/tickets.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run');
    return 0;
  }
  if (eject === 'stations') {
    if (!standard) throw new Error(`--eject stations: ${course} is not a standard course, so there is no default to copy`);
    if (existing?.courses?.some((c) => c.id === course && c.source)) {
      throw new Error(`--eject stations: course ${course} names a source, whose station function places its tickets — remove its \`source\` from .baton/baton.json to own the course`);
    }
    const to = join(root, '.baton', 'courses', course, 'sync.mjs');
    if (existsSync(to) && !force) throw new Error(`${relative(root, to)} already exists — it may hold your edits; --force overwrites it`);
    mkdirSync(dirname(to), { recursive: true });
    await writeWrapper('stations', course, to);
    log(`baton: .baton/courses/${course}/sync.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run`);
    return 0;
  }
  const workflow = syncWorkflow(pin ?? cliPin());
  const writeWorkflow = (): void => {
    // The workflow carries the pin: always written, so re-running init is how the pin moves.
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'baton-sync.yml'), workflow);
  };
  // The source every course scaffolded here names: this CLI's repository at this CLI's commit.
  const own = cliSelf();
  const pinned = pin ? parsePin(pin) : null;
  const self = own ?? pinned;
  const sourceOf = (id: string): string | null => (self ? printSource({ provider: 'github', namespace: self.namespace, repository: self.repository, ref: self.sha, course: id }) : null);
  const kept: string[] = [];
  /** Write `rel` when it is missing, or when `rewrite` (Baton's file, and its course is being
   * rewritten); otherwise it is kept. */
  const put = async (rel: string, write: (abs: string) => void | Promise<void>, rewrite = false): Promise<void> => {
    const abs = join(root, rel);
    if (existsSync(abs) && !rewrite) {
      kept.push(rel);
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    await write(abs);
  };
  /** One standard course's files; `rewrite` rewrites Baton's (the course file, the leg scripts). */
  const scaffold = async (bi: BuiltIn, rewrite: boolean): Promise<void> => {
    await put(`.baton/courses/${bi.id}/course.json`, (abs) => writeFileSync(abs, courseFileText(bi)), rewrite);
    for (const leg of runnerLegs(bi)) {
      // Each stub is bundled with its `close`, so it imports nothing the runner's scratch copy lacks.
      await put(`.baton/courses/${bi.id}/legs/${leg}.mjs`, async (abs) => writeFileSync(abs, await stubBytes(bi, leg)), rewrite);
      // The leg's instructions: shipped with the CLI, the repository's to edit from here on.
      await put(`.baton/courses/${bi.id}/legs/${leg}.md`, (abs) => writeFileSync(abs, instructionsOf(bi.id, leg)));
    }
  };
  // The courses whose source this CLI's commit moves: those naming this CLI's repository at
  // another commit. Their entries take the new source; their files are Baton's to rewrite.
  const moves = (c: CourseEntry): boolean => {
    if (!c.source || !self) return false;
    const src = parseSource(c.source);
    // An entry whose source names another course than its id is the sync's to refuse, not init's to move.
    return sameRepo(src, self) && src.ref !== self.sha && src.course === c.id && builtIn(src.course) != null;
  };
  /** The sources name this CLI's repository at its commit, whose registry writes the files; a
   * workflow pinned to another repository or commit would run a CLI that refuses them
   * (checkSource). So a --pin that differs is refused — before any write — whenever the courses
   * name a source; a repository with none moves its pin freely. */
  const refusePin = (courses: CourseEntry[]): void => {
    if (own && pinned && !(sameRepo(pinned, own) && pinned.sha === own.sha) && courses.some((c) => c.source)) {
      throw new Error(`--pin names ${pinned.namespace}/${pinned.repository}@${pinned.sha.slice(0, 10)}, but this CLI is ${own.namespace}/${own.repository}@${own.sha.slice(0, 10)}, which the courses' sources name — run \`baton repo init\` with the CLI checked out at the pin, or without --pin`);
    }
  };
  if (named == null && standard && standard.id !== course) {
    if (overrides.length) throw new Error(`--override: course ${course} is now ${standard.id} — \`baton repo init --course ${standard.id}\` scaffolds it first`);
    // A repository still on `pr` may list sourced courses beside it: the pin and their sources
    // move together here too, as on every init.
    const courses = existing?.courses ?? [];
    refusePin(courses);
    const movedHere = courses.filter(moves).map((c) => c.id);
    if (movedHere.length) {
      writeFileSync(settingsPath, `${JSON.stringify({ ...existing, courses: courses.map((c) => (moves(c) ? { ...c, source: sourceOf(c.id)! } : c)) }, null, 2)}\n`);
      for (const id of movedHere) await scaffold(builtIn(id)!, true);
      log(`baton: ${movedHere.join(', ')} now from ${self!.sha.slice(0, 10)}`);
    }
    writeWorkflow();
    log(`baton: the workflow's pin moved; course ${course} is now ${standard.id} — its files are kept, and \`baton repo init --course ${standard.id}\` scaffolds the new one`);
    return 0;
  }
  const b = scaffoldable(course);
  for (const leg of overrides) {
    if (!runnerLegs(b).includes(leg)) throw new Error(`--override ${leg}: ${b.id} has no such leg — its legs are ${runnerLegs(b).join(', ')}`);
  }
  const entry = { ...courseEntry(b.id, Object.keys(b.course.legs)), skill: b.skill, ...(sourceOf(b.id) ? { source: sourceOf(b.id)! } : {}) };
  let settings: BatonJson;
  let changed: string | null = null;
  let rewriteNamed = force;
  let commandMoved = false;
  const moved: string[] = [];
  if (existing) {
    // A second course joins the first: its entry is added, everything else in the file kept. With
    // `--force` this course's own entry is replaced — never the file, which holds the others.
    const courses = existing.courses ?? [{ id: existing.default_course ?? DEFAULT_COURSE, version: 1 }];
    const listed = courses.some((c) => c.id === b.id);
    const next = courses.map((c) => {
      if (c.id === b.id && force) return entry;
      if (moves(c)) {
        moved.push(c.id);
        if (c.id === b.id) rewriteNamed = true;
        return { ...c, source: sourceOf(parseSource(c.source!).course)! };
      }
      return c;
    });
    settings = { ...existing, courses: listed ? next : [...next, entry] };
    // B-83: the bare `echo` stub never survives an init — a no-op agent whose every leg
    // "succeeds". An explicit `--agent-command` names any command (`echo` included, for tests);
    // an explicit `--agent` switches to that harness's command; without either, the old default
    // is replaced by the default harness's command, and any other named command — the
    // repository's own — is kept.
    const was = typeof existing.agent_command === 'string' ? existing.agent_command : '';
    const now = agentCommand ?? (agentNamed || was === 'echo' ? HARNESS_AGENTS[agent] : null);
    if (now != null && now !== was) settings.agent_command = now;
    commandMoved = now != null && now !== was;
    if (!listed || force || moved.length || commandMoved) {
      changed = [
        !listed || force || moved.length ? `baton: .baton/baton.json lists course ${b.id}${listed ? (force ? ' afresh' : '') : ' now'}${moved.length ? `; ${moved.join(', ')} now from ${self!.sha.slice(0, 10)}` : ''}` : null,
        commandMoved ? `baton: agent_command ${was === 'echo' ? '"echo" — the no-op stub — ' : ''}is now ${agentCommand != null ? 'the command --agent-command named' : `the ${agent} command`}` : null,
      ].filter(Boolean).join('; ');
    } else kept.push('.baton/baton.json');
  } else {
    // B-83: a fresh repository names a real agent from the start — the chosen harness's command,
    // printed below for the unfamiliar. The bare `echo` stub is written only when named
    // explicitly, never by default.
    const chosen = agentCommand ?? HARNESS_AGENTS[agent];
    if (chosen === 'echo' && agentCommand !== 'echo') {
      throw new Error('baton repo init refuses to write the no-op agent_command "echo" — pass --agent opencode or --agent claude-code for a real command, or --agent-command echo to name the stub explicitly');
    }
    settings = { baton_url: process.env.BATON_URL ?? DEFAULT_URL, items: 'tickets', default_course: b.id, repos: {}, agent_command: chosen, courses: [entry] };
  }
  refusePin(settings.courses ?? []);
  if (changed) log(changed);
  if (!kept.includes('.baton/baton.json')) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    // B-83: the command printed for the unfamiliar, whenever this init named one.
    if (!existing || commandMoved) log(`baton: agent_command${agentCommand != null ? ' (--agent-command)' : ` (the ${agent} harness)`}: ${settings.agent_command}`);
  }
  await scaffold(b, rewriteNamed || !existing);
  for (const id of moved.filter((m) => m !== b.id)) await scaffold(builtIn(id)!, true);
  for (const leg of overrides) {
    // The leg script is what loads the override, so an older one (from before overrides) is
    // replaced: it is Baton's file.
    await put(`.baton/courses/${b.id}/legs/${leg}.mjs`, async (abs) => writeFileSync(abs, await stubBytes(b, leg)), true);
    await put(`.baton/courses/${b.id}/legs/${leg}${OVERRIDE_SUFFIX}`, (abs) => writeFileSync(abs, overrideSource(b, leg)));
    log(`baton: .baton/courses/${b.id}/legs/${leg}${OVERRIDE_SUFFIX} — this repository's run of ${leg}; edit it, and the leg script runs it in place of its own`);
  }
  writeWorkflow();
  await put('tickets/README.md', (abs) => writeFileSync(abs, '# Tickets\n\nOne `*.md` file per ticket; `baton repo init` wrote this directory.\n'));
  // B-112: the conventions page, the same text in every repository — written again whenever it
  // has drifted, like the course files, since it is Baton's (its settings are read where it lands).
  const pagePath = join(root, (settings.items ?? 'tickets').replace(/\/$/, ''), PAGE_NAME);
  const page = ticketsPage(readTicketSettings(root, root));
  if (!existsSync(pagePath) || readFileSync(pagePath, 'utf8') !== page) {
    await put(relative(root, pagePath), (abs) => writeFileSync(abs, page), true);
    log(`baton: ${relative(root, pagePath)} — how tickets work in this repository, generated`);
  }
  // B-95: the worked example of a leg wrapper, there to be copied and named; a repository already
  // has one once it is.
  await put(`.baton/${WRAPPER_EXAMPLE}`, (abs) => writeFileSync(abs, wrapperExample()));
  if (kept.length) log(`baton: kept ${kept.join(', ')} (already there; --force rewrites Baton's files, never your instructions or overrides)`);
  log(`baton: .baton/ scaffolded (course ${b.id}: ${b.summary}) — commit it, add tickets/*.md, and the workflow does the rest`);
  return 0;
}


/** The sync workflow `baton repo init` writes: pinned to the CLI's version — the baton
 * repository at one commit, `owner/name@commit` — so a release changes no repository's tickets
 * until that repository bumps the pin (R-BTN-74). The CLI is not published to a registry, so
 * the workflow checks the pinned commit out and installs it (its esbuild bundles the defaults).
 * The CLI mints the run's OIDC token itself (`id-token: write`, R-BTN-15). */
export function syncWorkflow(pin: string): string {
  // A full sha: actions/checkout fetches a 40-hex ref as a commit, never a short one.
  const at = parsePin(pin);
  if (!at) throw new Error(`--pin ${pin}: must be owner/name@<commit sha>, all 40 hex characters — the baton repository at one commit`);
  return `name: baton sync
on:
  push:
    branches: [main]
  workflow_dispatch:
  # A backstop for a missed trigger (§7.1): a run that finds nothing new posts nothing.
  schedule:
    - cron: '*/15 * * * *'
permissions:
  id-token: write
  contents: read
  pull-requests: read
  checks: read
# One run at a time, one pending (§7.1): runs never race for observation numbers.
concurrency:
  group: baton-sync
  cancel-in-progress: false
jobs:
  sync:
    # Off until the repository variable BATON_ENABLED is 'true' — set once the repository is
    # registered with Baton (§7.1), so an unregistered repository's pushes fail nothing.
    if: vars.BATON_ENABLED == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # The CLI's version is pinned: a release changes nothing here until this ref moves.
      - uses: actions/checkout@v4
        with:
          repository: ${at.namespace}/${at.repository}
          ref: ${at.sha}
          path: .baton-cli
      - run: npm ci --prefix .baton-cli
      # --latest main: after its observation number the run reads the newest main, so a slow
      # run for an older push still posts the newest board (§7.1 step 2).
      # \`tee\` keeps the CLI's own output for the annotation step below; \`pipefail\` keeps its
      # exit code, so a failed sync still fails this step.
      - id: sync
        timeout-minutes: 10
        run: |
          set -o pipefail
          node .baton-cli/cli/baton.mjs repo sync --latest main 2>&1 | tee sync.log
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
      # B-89: a run that posted nothing is an annotation, never a green check — a held board
      # from another run's reading in flight (\`busy\`), or any failed post. The step above
      # fails on a failed post, so this runs even then (\`!cancelled()\`).
      - name: A sync that posted nothing is not a success
        if: \${{ !cancelled() }}
        run: |
          # The outcome is any \`baton: <outcome> at <sha>\` line, matched anywhere — never only at
          # the start of a line: a copy the step's own log prefixes, or a retry's line that opens
          # the same way, sits beside the one \`tee\` wrote, so the last such line is the outcome.
          # The \`[0-9a-f]\` demands the sha the outcome line names, which a trace or a retry's
          # line has not (B-89).
          outcome="$(grep -oE 'baton: [a-z][a-z:-]* at [0-9a-f]' sync.log | tail -n 1 | cut -d' ' -f2)"
          case "$outcome" in
            advanced|confirmed)
              echo "::notice title=baton sync::the board is posted — \$outcome" ;;
            held)
              echo "::warning title=baton sync held::a force post was refused into holding; nothing was posted" ;;
            busy|busy:again)
              echo "::warning title=baton sync held::another run's reading was in flight (R-BTN-62); this run posted nothing. A stale reading lapses ten idle minutes after it was handed out, and a dispatch within that window is refused again — dispatch baton-sync.yml once the ten minutes have lapsed" ;;
            "")
              # No outcome line: the sync step failed before the CLI ended a sync (npm ci, the
              # checkout), so its log is the one that says why.
              echo "::error title=baton sync failed::the sync ended no sync, so it posted nothing; see the sync step's log" ;;
            *)
              echo "::error title=baton sync failed::the run posted nothing (outcome: \$outcome); see the sync step's log" ;;
          esac
`;
}
