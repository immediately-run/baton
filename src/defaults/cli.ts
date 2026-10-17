// cli.ts — `baton repo sync` and `baton repo init` (BATON_SPEC §2f R-BTN-74, §7.1, R-BTN-127's
// names): the defaults a repository with no course code runs. `sync` builds the board post from
// `.baton/tickets.mjs` and each course's `sync.mjs`, falling back to the markdown ticket source
// and the `pr` course's station function; `init` scaffolds `.baton/` (the settings, the course
// file, the leg stubs, the pinned sync workflow), and `--eject` copies a default out to edit.
// Course code in the CLI, never core (§2b). Reached through the esbuild bundle
// (scripts/baton-cli.mjs), the way `baton run` reaches src/runner.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BatonApi, type Auth, type Transport } from '../runner/api';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { DEFAULT_BRANCH_PATTERN, PR_COURSE, stationsPr, type PrFact, type StationsResult } from './course-pr';
import { ticketsMarkdown, type MarkdownSettings, type TicketsResult } from './tickets-markdown';

const git = (root: string, ...a: string[]): string => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();

/** The baton package's root: the nearest directory above this module whose package.json is
 * `@immediately-run/baton`. Found by walking up, because this module runs both as source
 * (`src/defaults/`) and inside the bundle (`.local/`), where `import.meta.url` differs. */
export function packageRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === '@immediately-run/baton') return dir;
    if (dirname(dir) === dir) throw new Error(`no @immediately-run/baton package above ${from}`);
  }
}
const source = (file: string): string => join(packageRoot(), 'src', 'defaults', file);

/** One `courses` entry of `.baton/baton.json` (R-BTN-51). An older file's `{id, version}` takes
 * the defaults below. */
interface CourseEntry {
  id: string;
  version: number;
  min_worker_version?: number;
  skill?: string;
  step_kinds?: string[];
  report_horizon_h?: number;
  branch_pattern?: string;
  previous_branch_pattern?: string;
  protocol_files?: string[];
}

/** `.baton/baton.json`'s shape (R-BTN-51): the settings these commands read. */
interface BatonJson {
  baton_url?: string;
  courses?: CourseEntry[];
  default_course?: string;
  items?: string;
  repos?: Record<string, string>;
  agent_command?: string;
}

/** The skill a course entry names when its file names none: the course's own (`baton-pr`). */
const defaultSkill = (course: string): string => `baton-${course}`;

/** The `courses` entry `baton repo init` writes: every R-BTN-51 field, so a repository edits
 * them where the spec says rather than discovering them. */
function courseEntry(course: string, legs: string[]): Required<Omit<CourseEntry, 'previous_branch_pattern'>> {
  return { id: course, version: 1, min_worker_version: 1, skill: defaultSkill(course), step_kinds: legs, report_horizon_h: 6, branch_pattern: DEFAULT_BRANCH_PATTERN, protocol_files: [] };
}

export interface SyncArgs {
  root: string;
  /** Baton's origin; absent, `baton.json`'s `baton_url`, then the CLI's default. */
  url?: string;
  /** Recorded PR facts (tests, R-BTN-96's adapter offline); absent, the forge is read live. */
  factsFile?: string;
  token?: string;
  transport?: Transport;
  auth?: Auth;
  log?: (line: string) => void;
}

export function parseSyncArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Omit<SyncArgs, 'log'> {
  const out: Omit<SyncArgs, 'log'> = { root: env.BATON_HOME ?? process.cwd(), ...(env.BATON_URL ? { url: env.BATON_URL } : {}) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--root') out.root = value();
    else if (a === '--url') out.url = value();
    else if (a === '--facts') out.factsFile = value();
    else if (a === '--token') out.token = value();
    else throw new Error(`${a}: not a flag of baton repo sync`);
  }
  return out;
}

/** A station function's module, the repository's own `sync.mjs` or the default. */
type StationFn = (ctx: Record<string, unknown>) => Promise<StationsResult> | StationsResult;

/** Check a station function's return against R-BTN-74's shape: `stations` an object of ids,
 * `markers` a list, `course_data` anything. A bare map or a `Map` is refused, naming the file. */
function stationsResult(value: unknown, from: string): StationsResult {
  const v = value as Partial<StationsResult> | null;
  if (v == null || typeof v !== 'object' || v instanceof Map || v.stations == null || typeof v.stations !== 'object' || v.stations instanceof Map) {
    throw new Error(`${from}: stations(ctx) must return {stations, markers, course_data}, stations an object of ticket ids`);
  }
  if (v.markers !== undefined && !Array.isArray(v.markers)) throw new Error(`${from}: markers must be a list`);
  return { stations: v.stations, markers: v.markers ?? [], course_data: v.course_data ?? {} };
}

/** One sync (§7.1): the observation first, then the tickets and stations from the
 * repository's own code or the CLI's defaults, the registry from `baton.json`'s courses, then
 * the board post over the head. */
export async function syncMain(args: SyncArgs): Promise<number> {
  const log = args.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const root = args.root;
  const batonJsonPath = join(root, '.baton', 'baton.json');
  if (!existsSync(batonJsonPath)) throw new Error(`${root} has no .baton/baton.json — run \`baton repo init\` first`);
  const batonJson = JSON.parse(readFileSync(batonJsonPath, 'utf8')) as BatonJson;
  const url = args.url ?? batonJson.baton_url ?? DEFAULT_URL;
  const settings: MarkdownSettings = { items: batonJson.items, default_course: batonJson.default_course, repos: batonJson.repos };
  const ctx = { root, settings };

  // The ticket source: the repository's own, else the markdown default.
  let result: TicketsResult;
  const own = join(root, '.baton', 'tickets.mjs');
  if (existsSync(own)) {
    const mod = (await import(pathToFileURL(own).href)) as { default?: { tickets?: (ctx: unknown) => Promise<TicketsResult> } };
    if (typeof mod.default?.tickets !== 'function') throw new Error('.baton/tickets.mjs default-exports no tickets(ctx)');
    result = await mod.default.tickets(ctx);
  } else {
    result = ticketsMarkdown(readItems(root, settings.items), settings);
  }
  const closedIds = new Set(result.closed.map((c) => c.id));
  const doneIds = new Set(result.closed.filter((c) => c.as === 'done').map((c) => c.id));

  // Every live ticket's course must be one this repository lists (R-BTN-74: a ticket on a course
  // with no station function fails the sync — nothing is posted).
  const courses = batonJson.courses ?? [{ id: batonJson.default_course ?? 'pr', version: 1 }];
  const listed = new Set(courses.map((c) => c.id));
  const stray = result.tickets.find((t) => !closedIds.has(t.id) && !listed.has(t.course_id));
  if (stray) throw new Error(`ticket ${stray.id} is on course ${stray.course_id}, which .baton/baton.json's courses do not list`);

  // The PR facts: recorded (tests) or the forge's own, gathered through the adapter's seam.
  const facts: PrFact[] = args.factsFile ? (JSON.parse(readFileSync(args.factsFile, 'utf8')) as PrFact[]) : await githubFacts(root, log);

  // Each course's stations, markers and course data: its own sync.mjs, else the default only
  // `pr` has. The function sees its own course's tickets alone.
  const stations: StationsResult['stations'] = {};
  const markers: StationsResult['markers'] = [];
  const courseData: Record<string, unknown> = {};
  const registry: Record<string, unknown>[] = [];
  for (const c of courses) {
    const courseFile = join(root, '.baton', 'courses', c.id, 'course.json');
    if (!existsSync(courseFile)) throw new Error(`.baton/courses/${c.id}/course.json is missing — run \`baton repo init --course ${c.id}\``);
    const course = JSON.parse(readFileSync(courseFile, 'utf8')) as { legs?: Record<string, unknown> };
    const branchPatterns = [c.branch_pattern ?? DEFAULT_BRANCH_PATTERN, ...(c.previous_branch_pattern ? [c.previous_branch_pattern] : [])];
    const fnCtx = { ...ctx, course: c.id, tickets: result.tickets.filter((t) => t.course_id === c.id), closed: closedIds, done: doneIds, facts, branchPatterns };
    const syncMjs = join(root, '.baton', 'courses', c.id, 'sync.mjs');
    let fn: StationFn;
    if (existsSync(syncMjs)) {
      const mod = (await import(pathToFileURL(syncMjs).href)) as { default?: { stations?: StationFn } };
      if (typeof mod.default?.stations !== 'function') throw new Error(`.baton/courses/${c.id}/sync.mjs default-exports no stations(ctx)`);
      fn = mod.default.stations;
    } else if (c.id === 'pr') {
      fn = stationsPr as unknown as StationFn;
    } else {
      throw new Error(`course ${c.id} has no sync.mjs and the CLI's default serves only \`pr\` — add .baton/courses/${c.id}/sync.mjs`);
    }
    const out = stationsResult(await fn(fnCtx), existsSync(syncMjs) ? `.baton/courses/${c.id}/sync.mjs` : 'the pr default');
    Object.assign(stations, out.stations);
    markers.push(...out.markers);
    courseData[c.id] = out.course_data;
    registry.push({
      id: c.id, version: c.version, min_worker_version: c.min_worker_version ?? c.version, skill: c.skill ?? defaultSkill(c.id), course,
      step_kinds: c.step_kinds ?? Object.keys(course.legs ?? {}), ...(c.report_horizon_h != null ? { report_horizon_h: c.report_horizon_h } : {}),
      branch_pattern: branchPatterns[0], ...(c.previous_branch_pattern ? { previous_branch_pattern: c.previous_branch_pattern } : {}),
    });
  }

  // §7.1: the observation first, then the head, then the post over it.
  const auth = args.auth ?? bearerAuth(args.token ?? process.env.BATON_SYNC_TOKEN ?? (await actionsToken(url)));
  const api = new BatonApi({ url, transport: args.transport ?? ((req) => fetch(req)), auth }, log);
  const observation = await api.observation();
  const head = await api.head();
  const sha = git(root, 'rev-parse', 'HEAD');
  await api.board({ registry, sha, parent_sha: head.sha ?? null, tickets: result.tickets, closed: result.closed, stations, markers, course_data: courseData, observation: observation.observation });
  log(`baton: posted ${sha.slice(0, 10)} — ${result.tickets.length} tickets, ${result.closed.length} closed`);
  return 0;
}

/** The markdown source's files: every file directly under `items`. */
function readItems(root: string, items = 'tickets'): { path: string; text: string }[] {
  const dir = join(root, items);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => ({ path: e.name, text: readFileSync(join(dir, e.name), 'utf8') }));
}

/** This workflow run's GitHub Actions OIDC token for Baton (R-BTN-15), audience Baton's origin
 * (R-BTN-56); null outside Actions. The workflow grants `id-token: write`. */
async function actionsToken(audience: string): Promise<string | null> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return null;
  const res = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`the Actions OIDC token request answered ${res.status}`);
  return ((await res.json()) as { value: string }).value;
}

/** A bearer sync credential (the CI identity token, R-BTN-93's transition before the
 * repository's sync key signs). A missing token is an error, never a silent post. */
function bearerAuth(token: string | null): Auth {
  if (!token) throw new Error('no sync credential: run in the sync workflow (id-token: write), pass --token, or set BATON_SYNC_TOKEN');
  return (_m, _u, _b, secret) => ({ Authorization: `Bearer ${token}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) });
}

/** R-BTN-96's fact adapter, GitHub half: the repository's PRs with their head's checks, its
 * commit date, its reviews and its comments, mapped to PrFact. Live forge access — the tests
 * inject recorded facts instead. */
async function githubFacts(root: string, log: (l: string) => void): Promise<PrFact[]> {
  const slug = git(root, 'remote', 'get-url', 'origin').replace(/^git@github.com:/, '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN to read GitHub — pass --facts <file> for recorded facts');
  const call = async <T>(path: string): Promise<T> => {
    const res = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baton-sync' } });
    if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
    return (await res.json()) as T;
  };
  const out: PrFact[] = [];
  for (const pr of await call<any[]>(`/repos/${slug}/pulls?state=all&per_page=100`)) {
    const checks = (await call<{ check_runs: any[] }>(`/repos/${slug}/commits/${pr.head.sha}/check-runs?per_page=100`)).check_runs.map((c: any) => c.conclusion ?? null);
    // A push after a verdict is read from the head commit's own date, never `updated_at`.
    const headCommit = await call<any>(`/repos/${slug}/commits/${pr.head.sha}`);
    const reviews = (await call<any[]>(`/repos/${slug}/pulls/${pr.number}/reviews?per_page=100`))
      .map((r: any) => ({ author: r.user?.login ?? '?', state: r.state, submittedAt: Date.parse(r.submitted_at), body: r.body ?? '' }));
    const comments = (await call<any[]>(`/repos/${slug}/issues/${pr.number}/comments?per_page=100`))
      .map((c: any) => ({ author: c.user?.login ?? '?', state: 'COMMENTED' as const, submittedAt: Date.parse(c.created_at), body: c.body ?? '' }));
    out.push({
      number: pr.number, head: pr.head.ref, state: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
      pushedAt: Date.parse(headCommit.commit.committer.date), checks, reviews: [...reviews, ...comments],
    });
  }
  log(`baton: read ${out.length} PRs of ${slug} from GitHub`);
  return out;
}

/** Bundle `entrySource` (a module importing the defaults by absolute path) into one standalone
 * `.mjs` at `outfile`, with no imports outside Node: the file works with no package installed. */
async function bundleSource(entrySource: string, outfile: string): Promise<void> {
  const { build } = await import('esbuild');
  const dir = mkdtempSync(join(tmpdir(), 'baton-bundle-'));
  try {
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, entrySource);
    await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The wrappers an ejection bundles: a working file calling the CLI's default through the same
 * interface the sync calls a repository's own file with, ready to edit (the bundle's top is the
 * default's own source). */
const WRAPPERS: Record<'tickets' | 'stations', () => string> = {
  tickets: () => `import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ticketsMarkdown } from ${JSON.stringify(source('tickets-markdown.ts'))};
export default {
  // The same signature the sync calls a repository's own source with: edit freely.
  async tickets(ctx) {
    const dir = join(ctx.root, ctx.settings.items ?? 'tickets');
    let names = [];
    try { names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch {}
    const files = names.map((name) => ({ path: name, text: readFileSync(join(dir, name), 'utf8') }));
    return ticketsMarkdown(files, ctx.settings);
  },
};
`,
  stations: () => `import { stationsPr } from ${JSON.stringify(source('course-pr.ts'))};
export default {
  // The same signature the sync calls a repository's own function with: edit freely. Returns
  // {stations, markers, course_data} (R-BTN-74).
  async stations(ctx) {
    return stationsPr({ tickets: ctx.tickets, facts: ctx.facts, closed: ctx.closed, done: ctx.done, branchPatterns: ctx.branchPatterns });
  },
};
`,
};

/** Where each leg rests and the leg it queues when its run finishes (R-BTN-83), for the stubs. */
const STUB_POSITION: Record<string, string> = {
  implement: "{ reached: 'pr-open', next: 'review' }",
  // The verdict decides what the review queues: fix for changes, merge for approve.
  review: "{ reached: 'reviewed', next: verdict === 'approve' ? 'merge' : 'fix', verdict }",
  fix: "{ reached: 'fixed', next: 'review' }",
  merge: "{ reached: 'merged', next: null }",
};

/** One leg stub's source (R-BTN-74): run `agent_command` with the ticket, leg and checkout;
 * the review stub asks the agent for a verdict and returns it, and the bundled `close` writes
 * it as the verdict line. */
function stubSource(leg: string, agentCommand: string): string {
  const review = leg === 'review';
  return `import { execFile } from 'node:child_process';
import { prClose } from ${JSON.stringify(source('pr-close.ts'))};
// The \`${leg}\` leg of the \`pr\` course, written by \`baton repo init\`: it runs this repository's
// agent (\`agent_command\` in .baton/baton.json) with the ticket, the leg and the checkout.${review ? `
// The review: the agent's last line of output must be its verdict, \`approve\` or \`changes\`;
// \`close\` writes it on the PR as the verdict line (\`<!-- baton:verdict … -->\`).` : ''}
export async function run(ctx) {
  const out = await new Promise((resolve, reject) => execFile(${JSON.stringify(agentCommand)}, [ctx.ticket.id, ${JSON.stringify(leg)}, ctx.checkout], { cwd: ctx.checkout, env: { ...process.env, BATON_LEG: ${JSON.stringify(leg)}${review ? ", BATON_VERDICT: 'print approve or changes as your last line'" : ''} } }, (e, stdout) => (e ? reject(e) : resolve(String(stdout)))));${review ? `
  const verdict = out.trim().split('\\n').at(-1)?.trim();
  if (verdict !== 'approve' && verdict !== 'changes') throw new Error('the review agent printed no verdict (approve or changes) as its last line');` : `
  void out;`}
  return ${STUB_POSITION[leg]};
}
export const close = prClose;
export async function handoff() { return null; }
`;
}

/** The CLI's own version, for the workflow's pin: `owner/name@<commit>` of the checkout this
 * CLI runs from. Outside a git checkout, `--pin` must name one. */
function cliPin(): string {
  const root = packageRoot();
  try {
    const slug = git(root, 'remote', 'get-url', 'origin').replace(/^git@github.com:/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/^git\//, '').replace(/\.git$/, '');
    return `${slug}@${git(root, 'rev-parse', 'HEAD')}`;
  } catch {
    throw new Error('the CLI is not a git checkout, so it cannot pin itself — pass --pin owner/name@<commit>');
  }
}

/** `baton repo init [--course pr] [--eject tickets|stations] [--pin SPEC]`. */
export async function initMain(argv: string[], io: { root?: string; log?: (l: string) => void } = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let course = 'pr';
  let eject: 'tickets' | 'stations' | null = null;
  let pin: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--course') course = value();
    else if (a === '--pin') pin = value();
    else if (a === '--eject') {
      const v = value();
      if (v !== 'tickets' && v !== 'stations') throw new Error('--eject: tickets or stations');
      eject = v;
    } else throw new Error(`${a}: not a flag of baton repo init`);
  }
  if (course !== 'pr') throw new Error(`--course ${course}: the CLI scaffolds only the pr course; write .baton/courses/${course}/ yourself`);
  const root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  if (eject === 'tickets') {
    mkdirSync(join(root, '.baton'), { recursive: true });
    await bundleSource(WRAPPERS.tickets(), join(root, '.baton', 'tickets.mjs'));
    log('baton: .baton/tickets.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run');
    return 0;
  }
  if (eject === 'stations') {
    mkdirSync(join(root, '.baton', 'courses', course), { recursive: true });
    await bundleSource(WRAPPERS.stations(), join(root, '.baton', 'courses', course, 'sync.mjs'));
    log(`baton: .baton/courses/${course}/sync.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run`);
    return 0;
  }
  const workflow = syncWorkflow(pin ?? cliPin());
  // Scaffold: the settings, the course file (in git — the sync posts and `baton runner start`
  // load the same file, R-BTN-69/-72), the leg stubs, the pinned sync workflow, the tickets dir.
  mkdirSync(join(root, '.baton', 'courses', course, 'legs'), { recursive: true });
  const legs = Object.keys(PR_COURSE.legs);
  const settings: BatonJson = { baton_url: process.env.BATON_URL ?? DEFAULT_URL, items: 'tickets', default_course: course, repos: {}, agent_command: 'echo', courses: [courseEntry(course, legs)] };
  writeFileSync(join(root, '.baton', 'baton.json'), `${JSON.stringify(settings, null, 2)}\n`);
  writeFileSync(join(root, '.baton', 'courses', course, 'course.json'), `${JSON.stringify(PR_COURSE, null, 2)}\n`);
  // Each stub is bundled with `close`, so it imports nothing the runner's scratch copy lacks.
  for (const leg of legs) await bundleSource(stubSource(leg, settings.agent_command!), join(root, '.baton', 'courses', course, 'legs', `${leg}.mjs`));
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'baton-sync.yml'), workflow);
  mkdirSync(join(root, 'tickets'), { recursive: true });
  if (!existsSync(join(root, 'tickets', 'README.md'))) writeFileSync(join(root, 'tickets', 'README.md'), '# Tickets\n\nOne `*.md` file per ticket; `baton repo init` wrote this directory.\n');
  log(`baton: .baton/ scaffolded (course ${course}) — commit it, add tickets/*.md, and the workflow does the rest`);
  return 0;
}

/** The sync workflow `baton repo init` writes: pinned to the CLI's version — the baton
 * repository at one commit, `owner/name@commit` — so a release changes no repository's tickets
 * until that repository bumps the pin (R-BTN-74). The CLI is not published to a registry, so
 * the workflow checks the pinned commit out and installs it (its esbuild bundles the defaults).
 * The CLI mints the run's OIDC token itself (`id-token: write`, R-BTN-15). */
export function syncWorkflow(pin: string): string {
  const at = pin.lastIndexOf('@');
  if (at < 1 || !/^[\w.-]+\/[\w.-]+$/.test(pin.slice(0, at)) || !/^[0-9a-f]{7,40}$/.test(pin.slice(at + 1))) {
    throw new Error(`--pin ${pin}: must be owner/name@<commit sha>, the baton repository at one commit`);
  }
  return `name: baton sync
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  id-token: write
  contents: read
  pull-requests: read
  checks: read
jobs:
  sync:
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
          repository: ${pin.slice(0, at)}
          ref: ${pin.slice(at + 1)}
          path: .baton-cli
      - run: npm ci --prefix .baton-cli
      - run: node .baton-cli/cli/baton.mjs repo sync
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}
