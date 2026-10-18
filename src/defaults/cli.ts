// cli.ts — `baton repo sync` and `baton repo init` (BATON_SPEC §2f R-BTN-74, R-BTN-131, §7.1,
// R-BTN-127's names): the defaults a repository with no course code runs. `sync` builds the board
// post from `.baton/tickets.mjs` and each course's `sync.mjs`, falling back to the markdown ticket
// source and the standard courses' station functions (courses.ts); `init` scaffolds `.baton/`
// (the settings, a standard course's file, its leg stubs and instructions, the pinned sync
// workflow), and `--eject` copies a default out to edit.
// Course code in the CLI, never core (§2b). Reached through the esbuild bundle
// (scripts/baton-cli.mjs), the way `baton run` reaches src/runner.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BatonApi, BatonRefusal, type Auth, type Transport } from '../runner/api';
import { syncOnce } from '../shared/batonSync.mjs';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { DEFAULT_BRANCH_PATTERN, matchPatterns, ticketOwns, type PrFact, type StationsResult } from './course-pr';
import { MARKERS_FILE, parseMarkers, type Marker } from './course-markers';
import { DEFAULT_COURSE, builtIn, scaffoldable, type BuiltIn } from './courses';
import { readItems } from './read-items';
import { ticketsMarkdown, type MarkdownSettings, type TicketsResult } from './tickets-markdown';

const git = (root: string, ...a: string[]): string => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
/** `owner/name` of a checkout's `origin` remote (an SSH or HTTPS URL, or the proxy's
 * `…/git/owner/name` form), or null when it has none. */
function remoteSlug(root: string): string | null {
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

/** The skill a course entry names when its file names none: the course's own (`baton-create-pr`). */
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
  /** `--latest <branch>`: after the observation, fetch that branch and check it out detached, so
   * a slow run for an older push posts the newest board (§7.1 step 2). The workflow passes it. */
  latest?: string;
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
    else if (a === '--latest') out.latest = value();
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
  const owns = (pr: { number: number; head: string }) => owners.some((o) => o.tickets.some((t) => ticketOwns(t, pr, o.patterns, repository)));
  const syncMjsOf = (id: string): string => join(root, '.baton', 'courses', id, 'sync.mjs');
  // The forge is read only when a course reads PRs: a repository on the marker courses alone
  // (bug-report, draft-ticket, decision) needs no forge token. A course's own sync.mjs may read
  // them, so it gets them too.
  const readsPrs = courses.some((c) => existsSync(syncMjsOf(c.id)) || builtIn(c.id)?.reads === 'prs');
  const facts: PrFact[] = args.factsFile ? (JSON.parse(readFileSync(args.factsFile, 'utf8')) as PrFact[]) : readsPrs ? await githubFacts(root, log, owns) : [];
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
  const { outcome, steps, next } = await syncOnce(git(root, 'rev-parse', 'HEAD'), {
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
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  });
  log(`baton: ${outcome} at ${String(next).slice(0, 10)} — ${steps.join('; ')}`);
  return outcome === 'advanced' || outcome === 'confirmed' || outcome === 'held' || outcome === 'busy' ? 0 : 1;
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

/** R-BTN-96's fact adapter, GitHub half: the repository's PRs with their head's checks, their
 * commits' dates, their reviews and their comments, mapped to PrFact. Every list is read to its
 * end (GitHub's `Link: rel="next"`), so a long-lived repository or a long thread is never cut
 * off. Live forge access — the tests inject recorded facts instead. */
export async function githubFacts(root: string, log: (l: string) => void, owns: (pr: { number: number; head: string }) => boolean): Promise<PrFact[]> {
  const slug = remoteSlug(root);
  if (slug == null) throw new Error(`${root} has no origin remote to read PRs from — pass --facts <file> for recorded facts`);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN to read GitHub — pass --facts <file> for recorded facts');
  let requests = 0;
  const get = async (url: string): Promise<Response> => {
    if (++requests > MAX_REQUESTS) throw new Error(`GitHub: this sync would need more than ${MAX_REQUESTS} requests — refusing before the token's hourly budget is spent`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baton-sync' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`GitHub ${url}: ${res.status}`);
    return res;
  };
  /** Every item of a paged list; `pick` takes a page's items from its body. */
  const all = async <T>(path: string, pick: (body: any) => T[] = (b) => b as T[]): Promise<T[]> => {
    const out: T[] = [];
    let url: string | null = `https://api.github.com${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    for (let page = 0; url != null; page++) {
      if (page === MAX_PAGES) throw new Error(`GitHub ${path}: more than ${MAX_PAGES * 100} items — the sync will not post a truncated reading`);
      const res = await get(url);
      out.push(...pick(await res.json()));
      url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
    }
    return out;
  };
  const out: PrFact[] = [];
  for (const pr of await all<any>(`/repos/${slug}/pulls?state=all`)) {
    const state: PrFact['state'] = pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open';
    // Only a PR a live ticket owns needs its detail read: a closed unmerged PR counts as none
    // (R-BTN-74), and any other PR places no ticket. Those are recorded from the list alone,
    // so the requests a run makes grow with the live tickets, not with the repository's history.
    if (state === 'closed' || !owns({ number: pr.number, head: pr.head.ref })) {
      out.push({ number: pr.number, head: pr.head.ref, state, pushedAt: 0, checks: [], reviews: [] });
      continue;
    }
    const checks = (await all<any>(`/repos/${slug}/commits/${pr.head.sha}/check-runs`, (b) => b.check_runs)).map((c) => c.conclusion ?? null);
    // A push is read from its commits' own dates, never `updated_at`, which a comment moves.
    const pushes = (await all<any>(`/repos/${slug}/pulls/${pr.number}/commits`)).map((c) => Date.parse(c.commit.committer.date));
    // A verdict counts only from someone with a say over the repository — its owner, a member
    // or a collaborator (GitHub's author_association) — never a drive-by comment on a public PR.
    const reviews = (await all<any>(`/repos/${slug}/pulls/${pr.number}/reviews`))
      .filter((r) => TRUSTED.has(r.author_association))
      .map((r) => ({ author: r.user?.login ?? '?', state: r.state, submittedAt: Date.parse(r.submitted_at), body: r.body ?? '' }));
    const comments = (await all<any>(`/repos/${slug}/issues/${pr.number}/comments`))
      .filter((c) => TRUSTED.has(c.author_association))
      .map((c) => ({ author: c.user?.login ?? '?', state: 'COMMENTED' as const, submittedAt: Date.parse(c.created_at), body: c.body ?? '' }));
    out.push({
      number: pr.number, head: pr.head.ref, state,
      pushedAt: Math.max(0, ...pushes), pushes, checks, reviews: [...reviews, ...comments],
    });
  }
  log(`baton: read ${out.length} PRs of ${slug} from GitHub in ${requests} requests`);
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

/** One leg stub's source (R-BTN-74, R-BTN-131): run the `agent_command` that
 * `.baton/baton.json` names at the claim's snapshot (`ctx.snapshot.sha`, the commit the runner
 * loads the leg scripts from), through the shell (so it may carry arguments), with the ticket,
 * the leg and the checkout as its arguments, and the leg's instructions — its
 * `.baton/courses/<id>/legs/<leg>.md`, read at the same snapshot — as a file named in
 * `BATON_INSTRUCTIONS`. A leg whose result depends on the agent (a verdict, an adjudication, an
 * outcome) asks for it as the agent's last line and checks it; the bundled `close` writes the
 * closing marker where the course's convention puts it. */
function stubSource(b: BuiltIn, course: string, leg: string): string {
  const { ask, position } = b.legs[leg];
  const closeFrom = b.reads === 'prs' ? ['prClose', 'pr-close.ts'] : ['markerClose', 'course-markers.ts'];
  const values = ask ? ask.values.join(' or ') : '';
  return `import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ${closeFrom[0]} } from ${JSON.stringify(source(closeFrom[1]))};
// The \`${leg}\` leg of the \`${b.id}\` course, written by \`baton repo init\`: it runs this
// repository's agent — \`agent_command\` in .baton/baton.json — with the ticket, the leg and the
// checkout as its arguments and the leg's instructions in the file BATON_INSTRUCTIONS names. Both
// are read when the leg runs at the claim's snapshot, the commit the runner loaded this script
// from, never the working tree an agent may have changed (so a branch under review cannot pick
// its reviewer or rewrite the reviewer's instructions).${ask ? `
// The agent's last line of output must be its ${ask.name}: ${values}.` : ''}
export async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== 'string' || sha === '') throw new Error('the leg has no snapshot to read .baton/baton.json at');
  const show = (rel) => execFileSync('git', ['-C', ctx.checkout, 'show', sha + ':' + rel], { encoding: 'utf8', maxBuffer: ${AGENT_OUTPUT_MAX} });
  const settings = JSON.parse(show('.baton/baton.json'));
  if (typeof settings.agent_command !== 'string' || settings.agent_command === '') throw new Error('.baton/baton.json names no agent_command');
  // The instructions, when the repository still has them; it owns them and may delete them.
  let instructions = '';
  try {
    const text = show(${JSON.stringify(`.baton/courses/${course}/legs/${leg}.md`)});
    instructions = join(mkdtempSync(join(tmpdir(), 'baton-leg-')), ${JSON.stringify(`${leg}.md`)});
    writeFileSync(instructions, text);
  } catch {
    instructions = '';
  }
  const out = await new Promise((resolve, reject) => execFile('sh', ['-c', settings.agent_command + ' "$@"', 'agent', ctx.ticket.id, ${JSON.stringify(leg)}, ctx.checkout], {
    cwd: ctx.checkout, maxBuffer: ${AGENT_OUTPUT_MAX},
    env: {
      ...process.env, BATON_COURSE: ${JSON.stringify(b.id)}, BATON_LEG: ${JSON.stringify(leg)}, BATON_INSTRUCTIONS: instructions, BATON_TICKET_FILE: ctx.ticket.path ?? '',${ask ? `
      BATON_ANSWER: ${JSON.stringify(`print ${values} as your last line`)},${ask.name === 'verdict' ? ` BATON_VERDICT: ${JSON.stringify(`print ${values} as your last line`)},` : ''}` : ''}
    },
  }, (e, stdout) => (e ? reject(e) : resolve(String(stdout)))));${ask ? `
  const answer = out.trim().split('\\n').at(-1)?.trim();
  if (!${JSON.stringify(ask.values)}.includes(answer)) throw new Error(${JSON.stringify(`the ${leg} agent printed no ${ask.name} (${values}) as its last line`)});` : `
  void out;`}
  return ${position};
}
export const close = ${closeFrom[0]};
export async function handoff() { return null; }
`;
}

/** The instructions shipped for one leg of a standard course (R-BTN-131), the Markdown `init`
 * copies into the repository, which owns them from then on. */
const instructionsOf = (course: string, leg: string): string => readFileSync(join(packageRoot(), 'src', 'defaults', 'courses', course, `${leg}.md`), 'utf8');

/** The CLI's own version, for the workflow's pin: `owner/name@<commit>` of the checkout this
 * CLI runs from. Outside a git checkout, `--pin` must name one. */
function cliPin(): string {
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

/** `baton repo init [--course <standard course>] [--eject tickets|stations] [--pin owner/name@commit] [--force]`
 * (R-BTN-74, R-BTN-131). A file the repository already has is kept — re-running init to move the
 * pin rewrites only the workflow — unless `--force`. Run again with another `--course`, it adds
 * that course beside the first: its files, and its entry in `.baton/baton.json`'s `courses`. With
 * no `--course` it takes the repository's `default_course`, else `create-pr`; a repository still
 * on `pr`, the name `create-pr` replaced, keeps its files and gets the new pin only. */
export async function initMain(argv: string[], io: { root?: string; log?: (l: string) => void } = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let named: string | null = null;
  let eject: 'tickets' | 'stations' | null = null;
  let pin: string | null = null;
  let force = false;
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
    await bundleSource(WRAPPERS.tickets(course), to);
    log('baton: .baton/tickets.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run');
    return 0;
  }
  if (eject === 'stations') {
    if (!standard) throw new Error(`--eject stations: ${course} is not a standard course, so there is no default to copy`);
    const to = join(root, '.baton', 'courses', course, 'sync.mjs');
    if (existsSync(to) && !force) throw new Error(`${relative(root, to)} already exists — it may hold your edits; --force overwrites it`);
    mkdirSync(dirname(to), { recursive: true });
    await bundleSource(WRAPPERS.stations(course), to);
    log(`baton: .baton/courses/${course}/sync.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run`);
    return 0;
  }
  const workflow = syncWorkflow(pin ?? cliPin());
  const writeWorkflow = (): void => {
    // The workflow carries the pin: always written, so re-running init is how the pin moves.
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'baton-sync.yml'), workflow);
  };
  if (named == null && standard && standard.id !== course) {
    writeWorkflow();
    log(`baton: the workflow's pin moved; course ${course} is now ${standard.id} — its files are kept, and \`baton repo init --course ${standard.id}\` scaffolds the new one`);
    return 0;
  }
  const b = scaffoldable(course);
  // Scaffold: the settings, the course file (in git — the sync posts and `baton runner start`
  // load the same file, R-BTN-69/-72), the leg stubs and their instructions, the pinned sync
  // workflow, the tickets dir.
  const kept: string[] = [];
  /** Write `rel` unless the repository already has it (and `--force` is not given). */
  const put = async (rel: string, write: (abs: string) => void | Promise<void>): Promise<void> => {
    const abs = join(root, rel);
    if (existsSync(abs) && !force) {
      kept.push(rel);
      return;
    }
    mkdirSync(dirname(abs), { recursive: true });
    await write(abs);
  };
  const legs = Object.keys(b.course.legs);
  const entry = { ...courseEntry(b.id, legs), skill: b.skill };
  if (existing && !force) {
    // A second course joins the first: its entry is added, everything else in the file kept.
    if (!(existing.courses ?? []).some((c) => c.id === b.id)) {
      const courses = existing.courses ?? [{ id: existing.default_course ?? DEFAULT_COURSE, version: 1 }];
      writeFileSync(settingsPath, `${JSON.stringify({ ...existing, courses: [...courses, entry] }, null, 2)}\n`);
      log(`baton: .baton/baton.json lists course ${b.id} now`);
    } else kept.push('.baton/baton.json');
  } else {
    const settings: BatonJson = { baton_url: process.env.BATON_URL ?? DEFAULT_URL, items: 'tickets', default_course: b.id, repos: {}, agent_command: 'echo', courses: [entry] };
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  }
  await put(`.baton/courses/${b.id}/course.json`, (abs) => writeFileSync(abs, `${JSON.stringify(b.course, null, 2)}\n`));
  for (const leg of legs) {
    // Each stub is bundled with its `close`, so it imports nothing the runner's scratch copy lacks.
    await put(`.baton/courses/${b.id}/legs/${leg}.mjs`, (abs) => bundleSource(stubSource(b, b.id, leg), abs));
    // The leg's instructions: shipped with the CLI, the repository's to edit from here on.
    await put(`.baton/courses/${b.id}/legs/${leg}.md`, (abs) => writeFileSync(abs, instructionsOf(b.id, leg)));
  }
  writeWorkflow();
  await put('tickets/README.md', (abs) => writeFileSync(abs, '# Tickets\n\nOne `*.md` file per ticket; `baton repo init` wrote this directory.\n'));
  if (kept.length) log(`baton: kept ${kept.join(', ')} (already there; --force overwrites)`);
  log(`baton: .baton/ scaffolded (course ${b.id}: ${b.summary}) — commit it, add tickets/*.md, and the workflow does the rest`);
  return 0;
}

/** The sync workflow `baton repo init` writes: pinned to the CLI's version — the baton
 * repository at one commit, `owner/name@commit` — so a release changes no repository's tickets
 * until that repository bumps the pin (R-BTN-74). The CLI is not published to a registry, so
 * the workflow checks the pinned commit out and installs it (its esbuild bundles the defaults).
 * The CLI mints the run's OIDC token itself (`id-token: write`, R-BTN-15). */
export function syncWorkflow(pin: string): string {
  const at = pin.lastIndexOf('@');
  if (at < 1 || !/^[\w.-]+\/[\w.-]+$/.test(pin.slice(0, at)) || !/^[0-9a-f]{40}$/.test(pin.slice(at + 1))) {
    // A full sha: actions/checkout fetches a 40-hex ref as a commit, never a short one.
    throw new Error(`--pin ${pin}: must be owner/name@<commit sha>, all 40 hex characters — the baton repository at one commit`);
  }
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
          repository: ${pin.slice(0, at)}
          ref: ${pin.slice(at + 1)}
          path: .baton-cli
      - run: npm ci --prefix .baton-cli
      # --latest main: after its observation number the run reads the newest main, so a slow
      # run for an older push still posts the newest board (§7.1 step 2).
      - run: node .baton-cli/cli/baton.mjs repo sync --latest main
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}
