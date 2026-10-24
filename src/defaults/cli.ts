// cli.ts — `baton repo sync` and `baton repo init` (BATON_SPEC §2f R-BTN-74, R-BTN-131, §7.1,
// R-BTN-127's names): the defaults a repository with no course code runs. `sync` builds the board
// post from `.baton/tickets.mjs` and each course's `sync.mjs`, falling back to the markdown ticket
// source and the standard courses' station functions (courses.ts); `init` scaffolds `.baton/`
// (the settings, a standard course's file, its leg stubs and instructions, the pinned sync
// workflow), and `--eject` copies a default out to edit.
// Course code in the CLI, never core (§2b). Reached through the esbuild bundle
// (scripts/baton-cli.mjs), the way `baton run` reaches src/runner.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BatonApi, BatonRefusal, type Auth, type Transport } from '../runner/api';
import { HARNESS_AGENTS, type Harness } from '../runner/harness';
import { syncOnce } from '../shared/batonSync.mjs';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { DEFAULT_BRANCH_PATTERN, matchPatterns, sameRepo as sameRepoName, ticketOwns, type PrFact, type StationsResult } from './course-pr';
import { COMMENTING_LEGS, PR_URL as PR_URL_RE } from './pr-close';
import { GIT_SHA } from '../core/validate';
import { parseSource, printSource } from './course-source';
import { CLOSE_TIMEOUT_MS, GIT_NONINTERACTIVE_ENV, MARKERS_FILE, parseMarkers, type Marker } from './course-markers';
import { BUILT_INS, DEFAULT_COURSE, builtIn, scaffoldable, type BuiltIn } from './courses';
import { readItems } from './read-items';
import { ticketsMarkdown, type MarkdownSettings, type TicketsResult } from './tickets-markdown';

const git = (root: string, ...a: string[]): string => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
/** `owner/name` of a checkout's `origin` remote (an SSH or HTTPS URL, or the proxy's
 * `…/git/owner/name` form), or null when it has none. */
export function remoteSlug(root: string): string | null {
  try {
    // The proxy's `…/git/owner/name` form drops its `git/` — only when `owner/name` follows, so an
    // owner named `git` keeps its name.
    return git(root, 'remote', 'get-url', 'origin').replace(/^git@[^:]+:/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').replace(/^git\/(?=[^/]+\/[^/]+$)/, '');
  } catch {
    return null;
  }
}

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

/** Whether the defaults run from their source — a checkout, with `src/` and esbuild — or from
 * the npm package, where `build:cli` prebuilt into `dist/` everything init writes: the leg
 * stubs, the eject wrappers, the leg instructions, and the commit the package was built from
 * (`dist/build.json`), which stands in for the checkout's HEAD as the courses' source. */
const fromSource = (): boolean => existsSync(join(packageRoot(), 'src', 'defaults', 'cli.ts'));
const prebuilt = (...path: string[]): string => join(packageRoot(), 'dist', 'defaults', ...path);

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
  /** Where the course comes from (B-33): `github/<owner>/<name>/<commit>/<course>`. The sync holds
   * the repository's course file to the source's, and places its tickets with the source's
   * station function. */
  source?: string;
}

/** `.baton/baton.json`'s shape (R-BTN-51): the settings these commands read. */
interface BatonJson {
  baton_url?: string;
  courses?: CourseEntry[];
  default_course?: string;
  items?: string;
  repos?: Record<string, string>;
  agent_command?: string;
  /** A command whose words precede `agent_command`'s in every leg's spawn (B-95);
   * `BATON_AGENT_WRAPPER` in the host's environment wins over it. */
  agent_wrapper?: string;
}

/** The skill a course entry names when its file names none: the course's own (`baton-create-pr`). */
const defaultSkill = (course: string): string => `baton-${course}`;

/** The `courses` entry `baton repo init` writes: every R-BTN-51 field, so a repository edits
 * them where the spec says rather than discovering them. */
function courseEntry(course: string, legs: string[]): Required<Omit<CourseEntry, 'previous_branch_pattern' | 'source'>> {
  return { id: course, version: 1, min_worker_version: 1, skill: defaultSkill(course), step_kinds: legs, report_horizon_h: 6, branch_pattern: DEFAULT_BRANCH_PATTERN, protocol_files: [] };
}

export interface SyncArgs {
  root: string;
  /** Baton's origin; absent, `baton.json`'s `baton_url`, then the CLI's default. */
  url?: string;
  /** Recorded PR facts (tests, R-BTN-96's adapter offline); absent, the forge is read live. */
  factsFile?: string;
  /** `--latest <branch>`: after the observation, fetch that branch and check it out detached, so
   * a slow run for an older push posts the newest board (§7.1 step 2). The workflow passes it. */
  latest?: string;
  token?: string;
  /** `--busy-retry <seconds>` (B-89): how long to wait before the one retry a `busy` run gets —
   * another reading was in flight (R-BTN-62), not this run's to post. `0` takes no retry.
   * Defaults to `BUSY_RETRY_S`. */
  busyRetryS?: number;
  transport?: Transport;
  auth?: Auth;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** A `busy` run's wait before its one retry (B-89, `--busy-retry`): another run's number is
 * outstanding (R-BTN-62), and a minute is long enough for that run to post, while a reading that
 * lapses instead (ten idle minutes, `OBSERVATION_TTL_MS`) is still held `busy:again` — which the
 * run exits 1 on and the workflow annotates. The retry posts whenever the holder posted in the
 * meantime; it never waits out a lapse. */
export const BUSY_RETRY_S = 60;

/** The longest `--busy-retry` waits: a workflow step is minutes, not an hour. The sync step's
 * `timeout-minutes: 10` is this bound, not more than it: at `--busy-retry 600` the step is killed
 * exactly as the wait ends and the retry gets no time — so no workflow in this repository passes
 * the flag (round three, 4), and the 60-second default leaves nine minutes of the step for the
 * two runs. */
const BUSY_RETRY_MAX_S = 600;

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
    else if (a === '--latest') out.latest = value();
    else if (a === '--token') out.token = value();
    else if (a === '--busy-retry') {
      const v = value();
      const s = Number(v);
      if (!/^[0-9]+$/.test(v) || !Number.isSafeInteger(s) || s > BUSY_RETRY_MAX_S) throw new Error(`--busy-retry ${v}: a whole number of seconds, at most ${BUSY_RETRY_MAX_S} — the workflow step's own patience (B-89)`);
      out.busyRetryS = s;
    } else throw new Error(`${a}: not a flag of baton repo sync`);
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

/** What one reading of the repository posts (§7.1): every field but the protocol's own. */
interface Board {
  payload: { registry: Record<string, unknown>[]; tickets: TicketsResult['tickets']; closed: TicketsResult['closed']; stations: StationsResult['stations']; markers: StationsResult['markers']; course_data: Record<string, unknown> };
  /** A ticket's status at this reading for §6.7's confirmations: its file's, `live`, or null once closed. */
  statusOf: (id: string) => string | null;
}

/** Read the board from the checkout as it stands: the tickets and stations from the
 * repository's own code or the CLI's defaults, the registry from `baton.json`'s courses. */
async function readBoard(root: string, batonJson: BatonJson, args: SyncArgs, log: (l: string) => void): Promise<Board> {
  const settings: MarkdownSettings = { items: batonJson.items, default_course: batonJson.default_course, repos: batonJson.repos };
  const ctx = { root, settings };

  // The ticket source: the repository's own, else the markdown default.
  let result: TicketsResult;
  const own = join(root, '.baton', 'tickets.mjs');
  if (existsSync(own)) {
    const mod = (await import(`${pathToFileURL(own).href}?at=${git(root, 'rev-parse', 'HEAD')}`)) as { default?: { tickets?: (ctx: unknown) => Promise<TicketsResult> } };
    if (typeof mod.default?.tickets !== 'function') throw new Error('.baton/tickets.mjs default-exports no tickets(ctx)');
    result = await mod.default.tickets(ctx);
  } else {
    result = ticketsMarkdown(readItems(root, settings.items), settings);
  }
  const closedIds = new Set(result.closed.map((c) => c.id));
  const doneIds = new Set(result.closed.filter((c) => c.as === 'done').map((c) => c.id));

  // Every live ticket's course must be one this repository lists (R-BTN-74: a ticket on a course
  // with no station function fails the sync — nothing is posted).
  const courses = batonJson.courses ?? [{ id: batonJson.default_course ?? DEFAULT_COURSE, version: 1 }];
  const listed = new Set(courses.map((c) => c.id));
  const stray = result.tickets.find((t) => !closedIds.has(t.id) && !listed.has(t.course_id));
  if (stray) throw new Error(`ticket ${stray.id} is on course ${stray.course_id}, which .baton/baton.json's courses do not list`);

  // The PR facts: recorded (tests) or the forge's own, gathered through the adapter's seam.
  const repository = remoteSlug(root);
  // A PR is a live ticket's when its course's patterns or the ticket's `prs:` name it.
  const owners = courses.map((c) => ({
    patterns: matchPatterns([c.branch_pattern ?? DEFAULT_BRANCH_PATTERN, ...(c.previous_branch_pattern ? [c.previous_branch_pattern] : [])]),
    tickets: result.tickets.filter((t) => t.course_id === c.id && !closedIds.has(t.id)),
  }));
  const owns = (pr: { number: number; head: string; repository?: string }) => owners.some((o) => o.tickets.some((t) => ticketOwns(t, pr, o.patterns, repository)));
  const syncMjsOf = (id: string): string => join(root, '.baton', 'courses', id, 'sync.mjs');
  // The forge is read only when a course reads PRs: a repository on the marker courses alone
  // (bug-report, draft-ticket, decision) needs no forge token. A course's own sync.mjs may read
  // them, so it gets them too.
  const readsPrsOf = (c: CourseEntry): boolean => existsSync(syncMjsOf(c.id)) || builtIn(c.id)?.reads === 'prs';
  const readsPrs = courses.some(readsPrsOf);
  // The other repositories a live ticket on a PR-reading course names in `repos:` (B-29): its PRs
  // may be there, and a home with none (docs) is the usual case.
  // Each with the tickets naming it, so a repository the token cannot read is named with them.
  const siblings = new Map<string, { repository: string; tickets: string[] }>();
  for (const c of courses.filter(readsPrsOf)) {
    for (const t of result.tickets.filter((x) => x.course_id === c.id && !closedIds.has(x.id))) {
      for (const r of t.repos ?? []) {
        if (repository != null && sameRepoName(r, repository)) continue;
        const s = siblings.get(r.toLowerCase()) ?? { repository: r, tickets: [] };
        s.tickets.push(t.id);
        siblings.set(r.toLowerCase(), s);
      }
    }
  }
  const facts: PrFact[] = args.factsFile ? (JSON.parse(readFileSync(args.factsFile, 'utf8')) as PrFact[]) : readsPrs ? await githubFacts(root, log, owns, [...siblings.values()]) : [];
  // The closing markers the marker courses' legs committed (R-BTN-83), as the checkout has them.
  const markersFile = join(root, MARKERS_FILE);
  const markerLines: Marker[] = existsSync(markersFile)
    ? parseMarkers(readFileSync(markersFile, 'utf8'), (line, why) => log(`baton: ${MARKERS_FILE}:${line} skipped — ${why}`))
    : [];

  // Each course's stations, markers and course data: its own sync.mjs, else its standard
  // course's default (courses.ts). The function sees its own course's tickets alone.
  const stations: StationsResult['stations'] = {};
  const markers: StationsResult['markers'] = [];
  const courseData: Record<string, unknown> = {};
  const registry: Record<string, unknown>[] = [];
  for (const c of courses) {
    const courseFile = join(root, '.baton', 'courses', c.id, 'course.json');
    if (!existsSync(courseFile)) throw new Error(`.baton/courses/${c.id}/course.json is missing — run \`baton repo init --course ${c.id}\``);
    const course = JSON.parse(readFileSync(courseFile, 'utf8')) as { legs?: Record<string, unknown> };
    const branchPatterns = [c.branch_pattern ?? DEFAULT_BRANCH_PATTERN, ...(c.previous_branch_pattern ? [c.previous_branch_pattern] : [])];
    const fnCtx = { ...ctx, course: c.id, repository, tickets: result.tickets.filter((t) => t.course_id === c.id), closed: closedIds, done: doneIds, facts, markers: markerLines, branchPatterns, graph: course };
    const syncMjs = syncMjsOf(c.id);
    if (c.source) checkSource(c, readFileSync(courseFile, 'utf8'), existsSync(syncMjs));
    const standard = builtIn(c.id);
    let fn: StationFn;
    if (existsSync(syncMjs)) {
      const mod = (await import(`${pathToFileURL(syncMjs).href}?at=${git(root, 'rev-parse', 'HEAD')}`)) as { default?: { stations?: StationFn } };
      if (typeof mod.default?.stations !== 'function') throw new Error(`.baton/courses/${c.id}/sync.mjs default-exports no stations(ctx)`);
      fn = mod.default.stations;
    } else if (standard) {
      fn = standard.stations as unknown as StationFn;
    } else {
      throw new Error(`course ${c.id} has no sync.mjs and is not a standard course — add .baton/courses/${c.id}/sync.mjs`);
    }
    const out = stationsResult(await fn(fnCtx), existsSync(syncMjs) ? `.baton/courses/${c.id}/sync.mjs` : `the ${standard!.id} default`);
    Object.assign(stations, out.stations);
    markers.push(...out.markers);
    courseData[c.id] = out.course_data;
    registry.push({
      ...courseSchemas(root, c.id),
      id: c.id, version: c.version, min_worker_version: c.min_worker_version ?? c.version, skill: c.skill ?? defaultSkill(c.id), course,
      step_kinds: c.step_kinds ?? Object.keys(course.legs ?? {}), ...(c.report_horizon_h != null ? { report_horizon_h: c.report_horizon_h } : {}),
      branch_pattern: branchPatterns[0], ...(c.previous_branch_pattern ? { previous_branch_pattern: c.previous_branch_pattern } : {}),
    });
  }
  const status = new Map(result.tickets.map((t) => [t.id, t.display?.status ?? 'live']));
  return {
    payload: { registry, tickets: result.tickets, closed: result.closed, stations, markers, course_data: courseData },
    statusOf: (id) => (closedIds.has(id) ? null : status.get(id) ?? null),
  };
}

/** A sourced course (B-33, R-BTN-131) is the source's exactly, or the sync posts nothing: the
 * source names this CLI's repository at this CLI's commit (the workflow's pin) and a standard
 * course of the same id, the repository's course file is byte-equal to the one that commit
 * scaffolds, and no `sync.mjs` replaces the source's station function. Each refusal names what
 * to do. Other repositories' courses are not resolved yet: running their station code at sync
 * time needs its own design. */
function checkSource(c: CourseEntry, courseText: string, ownSyncMjs: boolean): void {
  const src = parseSource(c.source!);
  const self = cliSelf();
  const at = `.baton/baton.json: course ${c.id}'s source ${c.source}`;
  if (src.course !== c.id) throw new Error(`${at} names course ${src.course}; a source names the course of its own id`);
  if (!self) throw new Error(`${at}: this CLI is not a git checkout with an origin, so it cannot tell its own commit`);
  if (!sameRepo(src, self)) {
    throw new Error(`${at}: a course from ${src.namespace}/${src.repository} is not supported yet — only this CLI's repository, ${self.namespace}/${self.repository}`);
  }
  if (src.ref !== self.sha) {
    throw new Error(`${at} is at ${src.ref.slice(0, 10)}, and this CLI is at ${self.sha.slice(0, 10)} — re-run \`baton repo init\` with the CLI at the workflow's pin, which moves both`);
  }
  const b = builtIn(src.course);
  if (!b || b.id !== src.course) throw new Error(`${at}: ${src.course} is not a standard course of ${self.namespace}/${self.repository} at ${self.sha.slice(0, 10)}`);
  if (ownSyncMjs) throw new Error(`${at}: .baton/courses/${c.id}/sync.mjs would replace the source's station function — remove it, or remove \`source\` to own the course`);
  if (courseText !== courseFileText(b)) {
    throw new Error(`${at}: .baton/courses/${c.id}/course.json differs from the source's — a sourced course keeps its graph exactly; \`baton repo init --course ${c.id} --force\` restores it, and legs/<leg>${OVERRIDE_SUFFIX} changes a leg's run`);
  }
}

/** A Baton call through the vendored sync's `{ok, code}` shape: a refusal is its code, never a throw. */
async function asResult(call: () => Promise<Record<string, any>>): Promise<Record<string, any>> {
  try {
    return { ok: true, ...(await call()) };
  } catch (e) {
    if (e instanceof BatonRefusal) return { ok: false, code: e.code };
    throw e;
  }
}

/** One sync (§7.1), its decisions the vendored `syncOnce` (R-BTN-37: the code S-BTN-12 and
 * S-BTN-13 drive): the observation number first, then — with `--latest` — the current default
 * branch fetched and checked out, then the board read from the checkout, the head read and the
 * ancestry decided; a lost race takes a new number and reads again, once. */
export async function syncMain(args: SyncArgs): Promise<number> {
  const log = args.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const root = args.root;
  const batonJsonPath = join(root, '.baton', 'baton.json');
  if (!existsSync(batonJsonPath)) throw new Error(`${root} has no .baton/baton.json — run \`baton repo init\` first`);
  const url = args.url ?? (JSON.parse(readFileSync(batonJsonPath, 'utf8')) as BatonJson).baton_url ?? DEFAULT_URL;
  const auth = args.auth ?? bearerAuth(args.token ?? process.env.BATON_SYNC_TOKEN ?? (await actionsToken(url)));
  const api = new BatonApi({ url, transport: args.transport ?? ((req) => fetch(req)), auth }, log);
  let board: Board | null = null;
  // B-89: `busy` is another run's reading, not this run's post, and R-BTN-62 lets no number this
  // run takes be used while that one is out. So the wait comes before the first `observe`, and
  // the retry is a whole second sync from a fresh number.
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const once = () => syncOnce(git(root, 'rev-parse', 'HEAD'), {
    observe: () => asResult(() => api.observation()),
    // Everything posted under a number is read after it (§7.1 steps 1–2): the commit and the board.
    fetchNext: async () => {
      if (args.latest) {
        git(root, 'fetch', '-q', 'origin', args.latest);
        git(root, 'checkout', '-q', '--detach', 'FETCH_HEAD');
      }
      // baton.json too is read at the commit posted.
      board = await readBoard(root, JSON.parse(readFileSync(batonJsonPath, 'utf8')) as BatonJson, args, log);
      return git(root, 'rev-parse', 'HEAD');
    },
    readHead: () => asResult(() => api.head()),
    post: (body: Record<string, unknown>) => asResult(() => api.board(body)),
    isAncestor: async (a: string, b: string) => {
      try {
        execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
        return true;
      } catch {
        return false; // not an ancestor, or a commit this clone lacks: never "descends"
      }
    },
    buildPayload: async () => board!.payload,
    statusOf: (id: string) => board!.statusOf(id),
    sleep,
  });
  const retryS = args.busyRetryS ?? BUSY_RETRY_S;
  let { outcome, steps, next } = await once();
  // `busy` alone is still `busy` (a run with the retry turned off, whose log says one was never
  // tried); `busy:again` is the one retry holding too — both exit non-zero below. The wait is the
  // retry's alone: a run's own `unavailable` backoff inside `syncOnce` is unchanged.
  if (outcome === 'busy' && retryS > 0) {
    log(`baton: busy — another run's reading is in flight (R-BTN-62); retrying once in ${retryS}s, with a fresh number`);
    await sleep(retryS * 1000);
    const retried = await once();
    ({ steps, next } = retried);
    outcome = retried.outcome === 'busy' ? 'busy:again' : retried.outcome;
  }
  log(`baton: ${outcome} at ${String(next).slice(0, 10)} — ${steps.join('; ')}`);
  // B-89: a run that posted nothing says so in its exit code too — `busy` used to be exit 0 with
  // nothing posted, a green check for a held board. The workflow step reads the outcome line as
  // well: it is what the retry and the annotation are for.
  return outcome === 'advanced' || outcome === 'confirmed' || outcome === 'held' ? 0 : 1;
}

/** This workflow run's GitHub Actions OIDC token for Baton (R-BTN-15), audience Baton's origin
 * (R-BTN-56); null outside Actions. The workflow grants `id-token: write`. */
async function actionsToken(audience: string): Promise<string | null> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return null;
  const res = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`the Actions OIDC token request answered ${res.status}`);
  return ((await res.json()) as { value: string }).value;
}

/** A bearer sync credential (the CI identity token, R-BTN-93's transition before the
 * repository's sync key signs). A missing token is an error, never a silent post. */
function bearerAuth(token: string | null): Auth {
  if (!token) throw new Error('no sync credential: run in the sync workflow (id-token: write), pass --token, or set BATON_SYNC_TOKEN');
  return (_m, _u, _b, secret) => ({ Authorization: `Bearer ${token}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) });
}

/** GitHub's API origin, REST and GraphQL alike. */
const GITHUB_API = 'https://api.github.com';
/** How long one GitHub or token call may take before the sync fails (§6.3's bound). */
const FETCH_TIMEOUT_MS = 30_000;
/** The most pages of 100 one list may span; beyond it the sync fails rather than truncate. */
const MAX_PAGES = 50;
/** The most GitHub requests one sync run may make. An Actions `GITHUB_TOKEN` has 1,000 an
 * hour and the workflow runs at least four times an hour, so a run stays well inside a quarter;
 * one that would need more fails before it is spent rather than starve the next runs. */
const MAX_REQUESTS = 200;
/** The `author_association` values whose reviews and comments carry a verdict. */
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
/** The most PRs one GraphQL query reads (B-35). One PR asks for up to 10 check suites of 100 runs
 * and 100 each of commits, reviews and comments — 15 connection requests, so a full batch is 375,
 * about 4 of the token's GraphQL points an hour, and some 32,500 nodes, far inside GitHub's
 * 500,000 a query; 25 keeps a query's cost and answer small while one query serves most
 * repositories' owned PRs. */
const GRAPHQL_BATCH = 25;

/** The detail of one PR that a GraphQL batch asks for (B-35): the head commit's check runs, the
 * commits' dates, the reviews and the issue comments — the four REST lists it replaces, each a
 * first page (10 check suites of 100 runs; 100 commits, reviews, comments) with `hasNextPage`,
 * so an overflowing one is read over REST in full. The
 * check runs come through the head's check suites (the latest run of each check, as REST's
 * check-runs list gives them), never `statusCheckRollup`, which takes in commit statuses too and
 * so may need a permission the sync workflow does not grant: `checks: read` covers this, as it
 * covered the REST read. */
const PR_DETAIL = `fragment D on PullRequest {
  head: commits(last: 1) { nodes { commit { oid checkSuites(first: 10) { pageInfo { hasNextPage } nodes { checkRuns(first: 100, filterBy: { checkType: LATEST }) { pageInfo { hasNextPage } nodes { status conclusion } } } } } } }
  commits(first: 100) { pageInfo { hasNextPage } nodes { commit { committedDate } } }
  reviews(first: 100) { pageInfo { hasNextPage } nodes { author { login } authorAssociation state submittedAt body } }
  comments(first: 100) { pageInfo { hasNextPage } nodes { author { login } authorAssociation createdAt body } }
}`;

/** The GraphQL query reading `numbers`' detail in one repository, each PR under alias `p<n>`. */
const detailQuery = (numbers: number[]): string =>
  `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${numbers.map((n) => `p${n}: pullRequest(number: ${n}) { ...D }`).join(' ')} } }\n${PR_DETAIL}`;

/** R-BTN-96's fact adapter, GitHub half: the repository's PRs with their head's checks, their
 * commits' dates, their reviews and their comments, mapped to PrFact. The PR lists are read over
 * REST, each to its end (GitHub's `Link: rel="next"`); the PRs a live ticket owns are read over
 * GraphQL, GRAPHQL_BATCH to a query (B-35), with any connection that overflows its first page read
 * over REST in full, so a long-lived repository or a long thread is never cut off. Live forge
 * access — the tests inject recorded facts instead. */
export async function githubFacts(root: string, log: (l: string) => void, owns: (pr: { number: number; head: string; repository: string }) => boolean, siblings: { repository: string; tickets: string[] }[] = []): Promise<PrFact[]> {
  const slug = remoteSlug(root);
  if (slug == null) throw new Error(`${root} has no origin remote to read PRs from — pass --facts <file> for recorded facts`);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN to read GitHub — pass --facts <file> for recorded facts');
  let requests = 0;
  /** One request of the budget, REST or GraphQL alike: past it the sync refuses. */
  const spend = (): void => {
    if (++requests > MAX_REQUESTS) throw new Error(`GitHub: this sync would need more than ${MAX_REQUESTS} requests — refusing before the token's hourly budget is spent`);
  };
  /** `res`, or the error a failed one is: its status, and whether it is a rate limit — GitHub's
   * 403 or 429 with no requests left, or a secondary limit's retry-after — which `list` reads. */
  const checked = (res: Response, what: string): Response => {
    const limited = res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after');
    if (!res.ok) throw Object.assign(new Error(`GitHub ${what}: ${res.status}${limited ? ' (rate limited)' : ''}`), { status: res.status, limited });
    return res;
  };
  const get = async (url: string): Promise<Response> => {
    spend();
    return checked(await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baton-sync' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), url);
  };
  /** One GraphQL query, one request of the budget (B-35). An answer carrying `errors` fails the
   * sync, as a failed REST read does: no partial reading is posted. */
  const graphql = async (query: string, variables: Record<string, unknown>): Promise<any> => {
    spend();
    const url = `${GITHUB_API}/graphql`;
    const res = checked(await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'baton-sync' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), `${url} (${String(variables.owner)}/${String(variables.name)})`);
    const body = (await res.json()) as { data?: any; errors?: { message?: string }[] };
    if (body.errors?.length) throw new Error(`GitHub GraphQL (${String(variables.owner)}/${String(variables.name)}): ${body.errors.map((e) => e.message ?? '?').join('; ')}`);
    return body.data;
  };
  /** Every item of a paged list; `pick` takes a page's items from its body. */
  const all = async <T>(path: string, pick: (body: any) => T[] = (b) => b as T[]): Promise<T[]> => {
    const out: T[] = [];
    let url: string | null = `${GITHUB_API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    for (let page = 0; url != null; page++) {
      if (page === MAX_PAGES) throw new Error(`GitHub ${path}: more than ${MAX_PAGES * 100} items — the sync will not post a truncated reading`);
      const res = await get(url);
      out.push(...pick(await res.json()));
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
    }
    return out;
  };
  const out: PrFact[] = [];
  // The home, then each other repository a live ticket names in `repos:` (B-29), under the one
  // budget: a sync that would exceed it refuses rather than post a partial reading.
  for (const { repository: repo, tickets } of [{ repository: slug, tickets: [] as string[] }, ...siblings.filter((s) => !sameRepoName(s.repository, slug))]) {
    const before = out.length;
    out.push(...(await repoFacts(repo, tickets)));
    log(`baton: read ${out.length - before} PRs of ${repo} from GitHub`);
  }
  log(`baton: ${requests} requests in all`);
  return out;

  async function repoFacts(repo: string, tickets: string[]): Promise<PrFact[]> {
    const listed = await list(repo, tickets);
    // Only a PR a live ticket owns needs its detail read; any other PR places no ticket and is
    // recorded from the list alone, so the requests a run makes grow with the live tickets, not
    // with the repository's history. A closed unmerged PR a live ticket owns is read too:
    // `create-pr` counts it as none (R-BTN-74), but `review-pr` concludes on it, and reads its
    // conclusion line from its comments.
    const owned = listed.filter((pr) => owns({ number: pr.number, head: pr.head.ref, repository: repo }));
    const detail = new Map<number, Omit<PrFact, 'number' | 'head' | 'state' | 'repository'>>();
    // The owned PRs' detail, GRAPHQL_BATCH to a query (B-35): one request where REST took four a PR.
    for (let i = 0; i < owned.length; i += GRAPHQL_BATCH) {
      const batch = owned.slice(i, i + GRAPHQL_BATCH);
      const [owner, name] = repo.split('/');
      const data = await graphql(detailQuery(batch.map((pr) => pr.number)), { owner, name });
      for (const pr of batch) detail.set(pr.number, await detailOf(repo, pr, data?.repository?.[`p${pr.number}`]));
    }
    return listed.map((pr) => {
      const state: PrFact['state'] = pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
      return { number: pr.number, head: pr.head.ref, state, ...(detail.get(pr.number) ?? { pushedAt: 0, checks: [], reviews: [] }), repository: repo };
    });
  }

  /** One PR's facts from its GraphQL node, mapped exactly as the REST lists are; a connection
   * whose first page overflows, or a head the batch read at another commit, is read over REST. */
  async function detailOf(repo: string, pr: any, node: any): Promise<Omit<PrFact, 'number' | 'head' | 'state' | 'repository'>> {
    if (node == null) throw new Error(`GitHub GraphQL (${repo}): no pull request #${pr.number}, though the list has it`);
    const head = node.head?.nodes?.[0]?.commit;
    const suites = head?.checkSuites;
    const overflow = suites?.pageInfo?.hasNextPage || (suites?.nodes ?? []).some((cs: any) => cs?.checkRuns?.pageInfo?.hasNextPage);
    const checks = head?.oid !== pr.head.sha || overflow
      ? (await all<any>(`/repos/${repo}/commits/${pr.head.sha}/check-runs`, (b) => b.check_runs)).map((c) => c.conclusion ?? null)
      // A run not yet completed has no conclusion: null, as the REST list gives it.
      : (suites?.nodes ?? []).flatMap((cs: any) => cs?.checkRuns?.nodes ?? []).map((c: any) => (c.status === 'COMPLETED' && c.conclusion ? String(c.conclusion).toLowerCase() : null));
    // A push is read from its commits' own dates, never `updated_at`, which a comment moves.
    const pushes = node.commits.pageInfo.hasNextPage
      ? (await all<any>(`/repos/${repo}/pulls/${pr.number}/commits`)).map((c) => Date.parse(c.commit.committer.date))
      : node.commits.nodes.map((c: any) => Date.parse(c.commit.committedDate));
    // A verdict counts only from someone with a say over the repository — its owner, a member
    // or a collaborator (GitHub's author_association) — never a drive-by comment on a public PR.
    const reviews = (node.reviews.pageInfo.hasNextPage
      ? (await all<any>(`/repos/${repo}/pulls/${pr.number}/reviews`)).map((r) => ({ login: r.user?.login, association: r.author_association, state: r.state, at: r.submitted_at, body: r.body }))
      : node.reviews.nodes.map((r: any) => ({ login: r.author?.login, association: r.authorAssociation, state: r.state, at: r.submittedAt, body: r.body })))
      .filter((r: any) => TRUSTED.has(r.association))
      .map((r: any) => ({ author: r.login ?? '?', state: r.state, submittedAt: Date.parse(r.at), body: r.body ?? '' }));
    const comments = (node.comments.pageInfo.hasNextPage
      ? (await all<any>(`/repos/${repo}/issues/${pr.number}/comments`)).map((c) => ({ login: c.user?.login, association: c.author_association, at: c.created_at, body: c.body }))
      : node.comments.nodes.map((c: any) => ({ login: c.author?.login, association: c.authorAssociation, at: c.createdAt, body: c.body })))
      .filter((c: any) => TRUSTED.has(c.association))
      .map((c: any) => ({ author: c.login ?? '?', state: 'COMMENTED' as const, submittedAt: Date.parse(c.at), body: c.body ?? '' }));
    return { pushedAt: Math.max(0, ...pushes), pushes, checks, reviews: [...reviews, ...comments] };
  }

  /** A repository's PRs. A named repository whose list GitHub refuses (403) or does not find
   * (404) fails the whole sync — no partial reading — naming the tickets whose `repos:` name it;
   * any other failure, as a timeout, a 5xx, a rate limit or the budget, is passed through as it is. */
  async function list(repo: string, tickets: string[]): Promise<any[]> {
    try {
      return await all<any>(`/repos/${repo}/pulls?state=all`);
    } catch (e) {
      const { status, limited } = e as { status?: number; limited?: boolean };
      if (!tickets.length || limited || (status !== 403 && status !== 404)) throw e;
      throw new Error(`${(e as Error).message} — ${repo} is named in repos: by ${tickets.join(', ')}; the sync's token cannot read it, or it does not exist`);
    }
  }
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
 * default's own source). The stations wrapper is the course's own standard course's. */
const WRAPPERS: Record<'tickets' | 'stations', (course: string) => string> = {
  tickets: () => `import { readItems } from ${JSON.stringify(source('read-items.ts'))};
import { ticketsMarkdown } from ${JSON.stringify(source('tickets-markdown.ts'))};
export default {
  // The same signature the sync calls a repository's own source with: edit freely.
  async tickets(ctx) {
    const files = readItems(ctx.root, ctx.settings.items);
    return ticketsMarkdown(files, ctx.settings);
  },
};
`,
  stations: (course) => `import { builtIn } from ${JSON.stringify(source('courses.ts'))};
export default {
  // The same signature the sync calls a repository's own function with: edit freely. ctx carries
  // the course's tickets, the PR facts, the closing markers and the course file. Returns
  // {stations, markers, course_data} (R-BTN-74).
  async stations(ctx) {
    return builtIn(${JSON.stringify(course)}).stations(ctx);
  },
};
`,
};

/** The most output a stub keeps from its agent (the review reads only the last line). */
const AGENT_OUTPUT_MAX = 64 * 1024 * 1024;

/** The environment variable that overrides `.baton/baton.json`'s `agent_wrapper` for one host
 * (B-95): the runner's environment reaches the stub, so a host wraps its legs without the
 * repository file naming one. */
const AGENT_WRAPPER_ENV = 'BATON_AGENT_WRAPPER';

/** One leg stub's source (R-BTN-74, R-BTN-131): run the `agent_command` that
 * `.baton/baton.json` names at the claim's snapshot (`ctx.snapshot.sha`, the commit the runner
 * loads the leg scripts from) — or, the settings naming none, the `BATON_AGENT_COMMAND` the
 * runner passed down (`--harness`'s choice: a fill for an absence, never an override — B-83) —
 * with no shell between the stub and the agent and stdin never an
 * open pipe (B-84: an open stdin pipe under the old spawn hung real harness CLIs — `opencode
 * run`, deterministically, zero output until the claim was reaped) — the command string splits
 * into words as `sh` would, quotes and no substitutions (`agent-words.ts`), and runs as
 * `execFile(command, args)` with the ticket, the leg and the checkout as its trailing
 * arguments, its stdin pipe closed at spawn, and the leg's instructions — its
 * `.baton/courses/<id>/legs/<leg>.md`, read at the same snapshot — as a file named in
 * `BATON_INSTRUCTIONS`. A leg whose result depends on the agent (a verdict, an adjudication, an
 * outcome) asks for it as the agent's last line and checks it; a leg whose stub `verify`es its
 * outcome (B-81) reads it from the forge before returning its position — the agent's exit 0 is
 * not the leg's outcome. The bundled `close` writes the closing marker where the course's
 * convention puts it. */
function stubSource(b: BuiltIn, course: string, leg: string): string {
  const { ask, position, verify } = b.legs[leg];
  // A leg whose close writes a line on a PR may name that PR after its answer (B-29): a ticket's
  // PRs may sit in other repositories, and its home may have none.
  const names = b.reads === 'prs' && COMMENTING_LEGS.has(leg);
  const closeFrom = b.reads === 'prs' ? ['prClose', 'pr-close.ts'] : ['markerClose', 'course-markers.ts'];
  const values = ask ? ask.values.join(' or ') : '';
  return `import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, ${verify ? 'readFileSync, ' : ''}rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitWords } from ${JSON.stringify(source('agent-words.ts'))};
// B-94: every git and gh call this stub makes — the snapshot probes, the override and
// instructions reads, the forge verification — is bounded and non-interactive, the same bound
// and environment the close uses, so a wedged call fails the leg within the bound instead of
// burning the claim to its lease.
const GIT_BOUND_MS = ${CLOSE_TIMEOUT_MS}, GIT_ENV = ${JSON.stringify(GIT_NONINTERACTIVE_ENV)};
const gitRun = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: GIT_BOUND_MS, killSignal: 'SIGKILL', env: { ...process.env, ...GIT_ENV }, ...opts });${ask ? `
import { requireAnswer } from ${JSON.stringify(source('answer.ts'))};` : ''}
import { ${closeFrom[0]} } from ${JSON.stringify(source(closeFrom[1]))};${verify ? `
import { verifyPrOpen, ticketRepositories } from ${JSON.stringify(source('pr-verify.ts'))};` : ''}
// The \`${leg}\` leg of the \`${b.id}\` course, written by \`baton repo init\`: it runs this
// repository's agent — \`agent_command\` in .baton/baton.json — with the ticket, the leg and the
// checkout as its arguments and the leg's instructions in the file BATON_INSTRUCTIONS names. The
// command runs with no shell between the stub and the agent (B-84), so no substitution or
// redirection it may carry is executed; its own contract is the header of the leg's .md. Where
// the repository sets \`agent_wrapper\` (B-95) — or the host sets BATON_AGENT_WRAPPER, which wins
// — that command's words go in front of the agent's argv, and the rest is the wrapper's. Both are
// read when the leg runs at the claim's snapshot, the commit the runner loaded this script
// from, never the working tree an agent may have changed (so a branch under review cannot pick
// its reviewer or rewrite the reviewer's instructions).${ask ? `
// The agent's last line of output must be its ${ask.name}: ${values}. A line that opens with
// one of them is read as the answer wherever it sits — prose before or after it is the agent's,
// not a lost round (B-85) — and that line may name one PR URL after the word. A missing or
// misspelled ${ask.name} still fails the leg, naming what the agent's output ended with.` : ''}${verify ? `
// Before returning its position the stub verifies the leg's outcome on the forge (B-81): an
// open PR on a branch this course's branch patterns map to the ticket, its head pushed; where
// it cannot verify, the leg fails naming what it looked for.` : ''}
// The repository may replace this leg's run, never its close: \`${leg}.run.mjs\` beside this file
// (\`baton repo init --override ${leg}\`), read at the same snapshot (R-BTN-131).
export async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== 'string' || sha === '') throw new Error('the leg has no snapshot to read its override at');
  const rel = ${JSON.stringify(`.baton/courses/${course}/legs/${leg}${OVERRIDE_SUFFIX}`)};
  // As with the instructions below: only an empty listing means there is no override.
  if (gitRun('git', ['-C', ctx.checkout, 'ls-tree', '--name-only', sha, '--', rel]).trim() === '') return standard(ctx);
  const dir = mkdtempSync(join(tmpdir(), 'baton-override-'));
  try {
    const file = join(dir, ${JSON.stringify(`${leg}${OVERRIDE_SUFFIX}`)});
    writeFileSync(file, gitRun('git', ['-C', ctx.checkout, 'show', sha + ':' + rel], { maxBuffer: ${AGENT_OUTPUT_MAX} }));
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== 'function') throw new Error(rel + ' exports no run(ctx, standard)');
    return await mod.run(ctx, standard);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** The course's own run of this leg: what \`run\` does with no override, and what an override may call. */
async function standard(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== 'string' || sha === '') throw new Error('the leg has no snapshot to read .baton/baton.json at');
  const show = (rel) => gitRun('git', ['-C', ctx.checkout, 'show', sha + ':' + rel], { maxBuffer: ${AGENT_OUTPUT_MAX} });
  const settings = JSON.parse(show('.baton/baton.json'));
  // B-83: the snapshot's settings stay authoritative; BATON_AGENT_COMMAND — the harness command
  // \`baton run --harness\` chose — fills their absence, never overrides their choice.
  const agentCommand = typeof settings.agent_command === 'string' && settings.agent_command !== '' ? settings.agent_command : process.env.BATON_AGENT_COMMAND ?? '';
  if (agentCommand === '') throw new Error('.baton/baton.json names no agent_command — run \`baton repo init --agent opencode\` (or --agent claude-code, or --agent-command <cmd>); baton run --harness <harness> runs its command when the settings name none');${verify ? `
  // What this leg's verification looks for (B-81): the course's branch patterns, as the
  // snapshot's settings carry them, and the repositories the ticket's repos: names — the
  // ticket file is the checkout's own copy, the one the agent may have just added its PR to.
  const entry = (settings.courses ?? []).find((c) => c && c.id === ${JSON.stringify(b.id)}) ?? {};
  const patterns = [entry.branch_pattern, entry.previous_branch_pattern].filter((p) => typeof p === 'string' && p !== '');
  const ticketText = (() => { try { return ctx.ticket?.path ? readFileSync(join(ctx.checkout, ctx.ticket.path), 'utf8') : null; } catch { return null; } })();
  const legRun = (cmd, args, cwd) => { try { return gitRun(cmd, args, { cwd, maxBuffer: ${AGENT_OUTPUT_MAX} }).trim(); } catch (e) { const why = e && typeof e.stderr === 'string' && e.stderr.trim() !== '' ? e.stderr.trim().split('\\n')[0] : e && e.message ? e.message : String(e); throw new Error(\`\${cmd} \${args.join(' ')} failed: \${why}\`); } };` : ''}
  // The instructions, when the repository still has them; it owns them and may delete them. Only
  // a path the snapshot lacks means deleted: \`ls-tree\` lists nothing for it and succeeds (git
  // translates its messages, and \`cat-file -e\` exits 128 for every failure alike), so any
  // failure of the probe itself stops the leg.
  const rel = ${JSON.stringify(`.baton/courses/${course}/legs/${leg}.md`)};
  const present = gitRun('git', ['-C', ctx.checkout, 'ls-tree', '--name-only', sha, '--', rel]).trim() !== '';
  const text = present ? show(rel) : null;
  const dir = text == null ? null : mkdtempSync(join(tmpdir(), 'baton-leg-'));
  const instructions = dir == null ? '' : join(dir, ${JSON.stringify(`${leg}.md`)});
  if (dir != null) writeFileSync(instructions, text);
  // B-84: no shell stands between the stub and the agent, and stdin is never an open pipe — the
  // two halves of the hang that burned claims to reap. The command string splits into words as
  // sh would (quotes; no substitutions) and runs as argv, the ticket, the leg and the checkout
  // appended last; stdin closes at spawn (below), and stdout and stderr are captured pipes — and
  // the command's exit is the agent's completion, which its own contract (the leg .md's header)
  // requires it to mean.
  const [command, ...words] = splitWords(agentCommand);
  if (command === undefined) throw new Error('.baton/baton.json names no agent_command to run');
  // B-95: the repository's \`agent_wrapper\` — a host's BATON_AGENT_WRAPPER first, else the
  // snapshot's setting — is one more command, split the same way, whose words go in front of the
  // agent's argv. Baton only composes it; what it does with stdio, time or the log is its own.
  const envWrapper = process.env.${AGENT_WRAPPER_ENV};
  const wrapper = typeof envWrapper === 'string' && envWrapper.trim() !== '' ? envWrapper : settings.agent_wrapper;
  if (wrapper != null && (typeof wrapper !== 'string' || wrapper.trim() === '')) throw new Error('.baton/baton.json\\'s agent_wrapper is not a command');
  const [wrapped, ...wrapping] = wrapper == null ? [] : splitWords(wrapper);
  const argv = wrapped === undefined
    ? [command, ...words, ctx.ticket.id, ${JSON.stringify(leg)}, ctx.checkout]
    : [wrapped, ...wrapping, command, ...words, ctx.ticket.id, ${JSON.stringify(leg)}, ctx.checkout];
  // Verbose (B-23's slice): the runner asked, so say on stderr — which it drains into its log —
  // the one line an operator needs: the local command actually completing this leg, resolved
  // here at the claim's snapshot, and the wrapper in front of it when one is named.
  if (process.env.BATON_VERBOSE) process.stderr.write('baton: ' + ${JSON.stringify(`${b.id}/${leg}`)} + ' ticket ' + ctx.ticket.id + ': agent_command: ' + agentCommand + (wrapper != null ? '; wrapper: ' + wrapper : '') + '; argv: ' + argv.join(' ') + '\\n');
  // B-108's streaming half (2026-10-24): the agent runs under spawn — its stdout accumulated
  // here for the answer protocol, and when the runner asked (BATON_VERBOSE) both streams
  // mirrored to this stub's stderr, which the runner pipes and drains into its log: a live
  // leg is watchable line by line instead of silence until the exit. The bound execFile kept
  // is kept too: an agent whose output outgrows the cap is killed and refused.
  const out = await new Promise((resolve, reject) => {
    const echo = process.env.BATON_VERBOSE === '1';
    const child = spawn(argv[0], argv.slice(1), {
      cwd: ctx.checkout, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, BATON_COURSE: ${JSON.stringify(b.id)}, BATON_LEG: ${JSON.stringify(leg)}, BATON_INSTRUCTIONS: instructions, BATON_TICKET_FILE: ctx.ticket.path ?? '',${ask ? `
        BATON_ANSWER: ${JSON.stringify(`print ${values} as your last line${names ? ', then the URL of the PR to write it on when it is not the checkout branch\'s' : ''}`)},${ask.name === 'verdict' ? ` BATON_VERDICT: ${JSON.stringify(`print ${values} as your last line${names ? ', then the URL of the PR to write it on when it is not the checkout branch\'s' : ''}`)},` : ''}` : ''}
      },
    });
    let so = '', se = '';
    child.stdout.on('data', (c) => {
      so += c;
      if (so.length > ${AGENT_OUTPUT_MAX}) { child.kill('SIGKILL'); reject(new Error('the agent printed more than ${AGENT_OUTPUT_MAX} bytes')); return; }
      if (echo) process.stderr.write(c);
    });
    child.stderr.on('data', (c) => { if (se.length < 2048) se = (se + String(c)).slice(-2048); if (echo) process.stderr.write(c); });
    child.on('error', (e) => reject(e));
    child.on('close', (code, sig) => {
      if (code === 0) { resolve(so); return; }
      const why = se.split('\\n').filter((l) => l.trim() !== '').at(-1);
      reject(new Error('the agent exited ' + (code != null ? 'with code ' + code : 'on signal ' + sig) + (why != null ? ': ' + why : '')));
    });
    // B-84's root cause, closed here: an open stdin pipe is one no agent can wait on — the pipe
    // is closed the moment it exists, so a reader sees EOF at once, never a wait (stdin is
    // therefore never an open pipe for the agent, whatever spawn makes of the stdio option).
    child.stdin?.end();
  }).finally(() => {
    if (dir != null) rmSync(dir, { recursive: true, force: true });
  });${names ? `
  // The answer (B-85): the last line that opens with the leg's value word, wherever it sits —
  // prose before or after it is the agent's, not a lost round — and, on that line, the PR its
  // line goes on. A leg with no answer names its PR by a last line that is a PR URL alone; any
  // other last line names none. A missing or misspelled verdict still fails, naming what was read.${ask ? `
  const { answer, pr } = requireAnswer(out, ${JSON.stringify({ name: ask.name, values: ask.values })}, ${JSON.stringify(leg)});
  const on = pr;` : `
  const last = (out.trim().split('\\n').at(-1) ?? '').trim();
  const on = ${PR_URL}.test(last) ? last : null;`}
${verify ? `  await verifyPrOpen({ checkout: ctx.checkout, ticket: ctx.ticket, branchPatterns: patterns, repositories: ticketRepositories(ticketText, settings.repos) }, legRun);
` : ''}  return { ...(${position}), ...(on ? { pr: on } : {}) };` : `${ask ? `
  // The answer (B-85): the last line that opens with the leg's value word, backwards past any
  // prose after it; a missing or misspelled verdict still fails, naming what it read.
  const { answer } = requireAnswer(out, ${JSON.stringify({ name: ask.name, values: ask.values })}, ${JSON.stringify(leg)});` : `
  void out;`}
${verify ? `  await verifyPrOpen({ checkout: ctx.checkout, ticket: ctx.ticket, branchPatterns: patterns, repositories: ticketRepositories(ticketText, settings.repos) }, legRun);
` : ''}  return ${position};`}
}
export const close = ${closeFrom[0]};
export async function handoff() { return null; }
`;
}

/** pr-close.ts's PR URL, as a regular-expression literal for the stubs (B-29). */
const PR_URL = `/${PR_URL_RE.source}/`;

/** A repository's replacement for one leg's `run` (R-BTN-131): `legs/<leg>.run.mjs`. */
const OVERRIDE_SUFFIX = '.run.mjs';

/** The file `init --override <leg>` seeds: a `run` that calls the course's own, which the
 * repository then edits. It owns the file; init never rewrites it. */
function overrideSource(b: BuiltIn, leg: string): string {
  const { ask, position } = b.legs[leg];
  return `// The \`${leg}\` leg of the \`${b.id}\` course as this repository implements it (BATON_SPEC R-BTN-131).
// \`baton repo init --override ${leg}\` wrote it; it is yours, and init never rewrites it. The standard
// leg script beside it (${leg}.mjs) loads this file from the claim's snapshot and calls its \`run\` in
// place of its own, keeping its own \`close\`, so the closing marker the course reads is always the
// standard one.
//
// run(ctx, standard): \`ctx\` is the leg's context (ticket, checkout, snapshot, leg, claim, …);
// \`standard\` is the course's own run — the repository's agent_command with the leg's instructions.
// Return a position that is an edge of the course, the shape \`standard\` returns:
//   ${position}${ask ? `
// where \`answer\` is the ${ask.name}: ${ask.values.join(' or ')}.` : ''}
// This file is loaded alone, from the snapshot: import only node: built-ins.
export async function run(ctx, standard) {
  return standard(ctx);
}
`;
}

/** The worked example of `agent_wrapper` (B-95): a `tee` to `.baton/logs/<ticket>-<leg>.log`,
 * shipped but never used until the repository names it in `baton.json`. */
const WRAPPER_EXAMPLE = 'leg-wrapper.example';
const wrapperExample = (): string =>
  readFileSync(fromSource() ? join(packageRoot(), '.baton', WRAPPER_EXAMPLE) : prebuilt(WRAPPER_EXAMPLE), 'utf8');

/** The instructions shipped for one leg of a standard course (R-BTN-131), the Markdown `init`
 * copies into the repository, which owns them from then on. */
const instructionsOf = (course: string, leg: string): string =>
  readFileSync(fromSource() ? join(packageRoot(), 'src', 'defaults', 'courses', course, `${leg}.md`) : prebuilt('courses', course, `${leg}.md`), 'utf8');

/** A leg stub, bundled with its `close`: from source in a checkout, else build:cli's copy. */
async function writeStub(b: BuiltIn, leg: string, abs: string): Promise<void> {
  if (fromSource()) await bundleSource(stubSource(b, b.id, leg), abs);
  else copyFileSync(prebuilt('stubs', b.id, `${leg}.mjs`), abs);
}

/** An ejected default (`--eject`): from source in a checkout, else build:cli's copy. */
async function writeWrapper(kind: 'tickets' | 'stations', course: string, abs: string): Promise<void> {
  if (fromSource()) await bundleSource(WRAPPERS[kind](course), abs);
  else copyFileSync(kind === 'tickets' ? prebuilt('tickets.mjs') : prebuilt('stations', `${course}.mjs`), abs);
}

/** What build:cli writes into `dist/` for an installed package: every standard course's leg
 * stubs and instructions, the eject wrappers, and `build.json` naming the commit built. The
 * files are the ones init would write from this checkout at `commit`. */
export async function prebuildDefaults(dist: string, build: { repository: string; commit: string; dirty?: boolean }): Promise<number> {
  const out = join(dist, 'defaults');
  rmSync(out, { recursive: true, force: true });
  let files = 0;
  for (const b of BUILT_INS) {
    mkdirSync(join(out, 'stubs', b.id), { recursive: true });
    for (const leg of Object.keys(b.course.legs)) {
      await bundleSource(stubSource(b, b.id, leg), join(out, 'stubs', b.id, `${leg}.mjs`));
      files++;
      const md = join(packageRoot(), 'src', 'defaults', 'courses', b.id, `${leg}.md`);
      if (existsSync(md)) {
        mkdirSync(join(out, 'courses', b.id), { recursive: true });
        copyFileSync(md, join(out, 'courses', b.id, `${leg}.md`));
        files++;
      }
    }
    mkdirSync(join(out, 'stations'), { recursive: true });
    await bundleSource(WRAPPERS.stations(b.id), join(out, 'stations', `${b.id}.mjs`));
    files++;
  }
  await bundleSource(WRAPPERS.tickets(DEFAULT_COURSE), join(out, 'tickets.mjs'));
  // B-95's worked example, beside the stubs: init writes it into .baton/ as leg-wrapper.example.
  copyFileSync(join(packageRoot(), '.baton', WRAPPER_EXAMPLE), join(out, WRAPPER_EXAMPLE));
  writeFileSync(join(dist, 'build.json'), `${JSON.stringify(build, null, 2)}\n`);
  return files + 3;
}

/** The CLI's own version, for the workflow's pin: `owner/name@<commit>` of the checkout this
 * CLI runs from, or, in the npm package, of the commit `build:cli` built it from. Outside both,
 * `--pin` must name one. */
function cliPin(): string {
  if (!fromSource()) {
    const file = join(packageRoot(), 'dist', 'build.json');
    if (!existsSync(file)) throw new Error('this CLI package names no commit it was built from (dist/build.json) — pass --pin owner/name@<commit>');
    const { repository, commit, dirty } = JSON.parse(readFileSync(file, 'utf8')) as { repository: string; commit: string; dirty?: boolean };
    if (dirty) throw new Error(`this CLI package was built from a modified tree at ${repository}@${commit.slice(0, 10)}, so no commit holds its files — pass --pin owner/name@<commit>`);
    return `${repository}@${commit}`;
  }
  const root = packageRoot();
  const slug = remoteSlug(root);
  let sha: string | null = null;
  try {
    sha = git(root, 'rev-parse', 'HEAD');
  } catch {
    sha = null;
  }
  if (slug == null || sha == null) throw new Error('the CLI is not a git checkout with an origin, so it cannot pin itself — pass --pin owner/name@<commit>');
  return `${slug}@${sha}`;
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
    for (const leg of Object.keys(bi.course.legs)) {
      // Each stub is bundled with its `close`, so it imports nothing the runner's scratch copy lacks.
      await put(`.baton/courses/${bi.id}/legs/${leg}.mjs`, (abs) => writeStub(bi, leg, abs), rewrite);
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
    if (!Object.hasOwn(b.course.legs, leg)) throw new Error(`--override ${leg}: ${b.id} has no such leg — its legs are ${Object.keys(b.course.legs).join(', ')}`);
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
    await put(`.baton/courses/${b.id}/legs/${leg}.mjs`, (abs) => writeStub(b, leg, abs), true);
    await put(`.baton/courses/${b.id}/legs/${leg}${OVERRIDE_SUFFIX}`, (abs) => writeFileSync(abs, overrideSource(b, leg)));
    log(`baton: .baton/courses/${b.id}/legs/${leg}${OVERRIDE_SUFFIX} — this repository's run of ${leg}; edit it, and the leg script runs it in place of its own`);
  }
  writeWorkflow();
  await put('tickets/README.md', (abs) => writeFileSync(abs, '# Tickets\n\nOne `*.md` file per ticket; `baton repo init` wrote this directory.\n'));
  // B-95: the worked example of a leg wrapper, there to be copied and named; a repository already
  // has one once it is.
  await put(`.baton/${WRAPPER_EXAMPLE}`, (abs) => writeFileSync(abs, wrapperExample()));
  if (kept.length) log(`baton: kept ${kept.join(', ')} (already there; --force rewrites Baton's files, never your instructions or overrides)`);
  log(`baton: .baton/ scaffolded (course ${b.id}: ${b.summary}) — commit it, add tickets/*.md, and the workflow does the rest`);
  return 0;
}

/** A standard course's file as init writes it, and as the sync holds a sourced course to. */
const courseFileText = (b: BuiltIn): string => `${JSON.stringify(b.course, null, 2)}\n`;

/** This CLI's repository and commit, or null outside a git checkout with a GitHub origin and
 * outside a package that names its build's commit. */
function cliSelf(): { namespace: string; repository: string; sha: string } | null {
  try {
    return parsePin(cliPin());
  } catch {
    return null;
  }
}

/** Whether a source names this CLI's repository: GitHub's owner and repository names ignore case. */
const sameRepo = (src: { namespace: string; repository: string }, self: { namespace: string; repository: string }): boolean =>
  `${src.namespace}/${src.repository}`.toLowerCase() === `${self.namespace}/${self.repository}`.toLowerCase();

/** A pin, `owner/name@<commit>` — the workflow's and a source's parts — or null when it is not one. */
function parsePin(at: string): { namespace: string; repository: string; sha: string } | null {
  const m = /^([\w.-]+)\/([\w.-]+)@(.*)$/.exec(at);
  return m && GIT_SHA.test(m[3]) ? { namespace: m[1], repository: m[2], sha: m[3] } : null;
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

/** R-BTN-108: a course's schemas, `.baton/schemas/<course>/<name>@<n>.json`, each posted as
 *  `<course>:<name>@<n>` with the SHA-256 of its file — the digest that makes a version
 *  immutable. Absent directory, no schemas. */
export function courseSchemas(root: string, course: string): { schemas?: { id: string; digest: string; schema: unknown }[] } {
  const dir = join(root, '.baton', 'schemas', course);
  if (!existsSync(dir)) return {};
  const schemas = readdirSync(dir).filter((f) => /^[A-Za-z][A-Za-z0-9._-]{0,63}@(0|[1-9][0-9]{0,5})\.json$/.test(f)).sort().map((f) => {
    const bytes = readFileSync(join(dir, f));
    let schema: unknown;
    try { schema = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new Error(`.baton/schemas/${course}/${f} is not JSON: ${(e as Error).message}`); }
    return { id: `${course}:${f.slice(0, -5)}`, digest: createHash('sha256').update(bytes).digest('hex'), schema };
  });
  return schemas.length ? { schemas } : {};
}
