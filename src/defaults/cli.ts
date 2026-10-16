// cli.ts — `baton sync` and `baton init` (BATON_SPEC §2f R-BTN-74, §7.1): the defaults a
// repository with no course code runs. `sync` builds the board post from `.baton/tickets.mjs`
// and each course's `sync.mjs`, falling back to the markdown ticket source and the `pr`
// course's station function; `init` scaffolds `.baton/` (the settings, the course file, the
// leg stubs, the pinned sync workflow), and `--eject` copies a default out to edit. Course
// code in the CLI, never core (§2b). Reached through the esbuild bundle (scripts/baton-cli.mjs),
// the way `baton run` reaches src/runner.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BatonApi, type Auth, type Transport } from '../runner/api';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { PR_COURSE, stationsPr, type PrFact } from './course-pr';
import { ticketsMarkdown, type MarkdownSettings, type TicketsResult } from './tickets-markdown';

const DEFAULTS = dirname(fileURLToPath(import.meta.url));
const git = (root: string, ...a: string[]): string => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();

/** `.baton/baton.json`'s shape (§2a): the settings these commands read. */
interface BatonJson {
  baton_url?: string;
  courses?: { id: string; version: number }[];
  default_course?: string;
  items?: string;
  repos?: Record<string, string>;
  agent_command?: string;
}

export interface SyncArgs {
  root: string;
  url: string;
  /** Recorded PR facts (tests, R-BTN-96's adapter offline); absent, the forge is read live. */
  factsFile?: string;
  token?: string;
  transport?: Transport;
  auth?: Auth;
  log?: (line: string) => void;
}

export function parseSyncArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Omit<SyncArgs, 'log'> {
  const out: Omit<SyncArgs, 'log'> = { root: env.BATON_HOME ?? process.cwd(), url: env.BATON_URL ?? DEFAULT_URL };
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
    else throw new Error(`${a}: not a flag of baton sync`);
  }
  return out;
}

/** One sync (§7.1): the observation first, then the tickets and stations from the
 * repository's own code or the CLI's defaults, the registry from `baton.json`'s courses, then
 * the board post over the head. */
export async function syncMain(args: SyncArgs): Promise<number> {
  const log = args.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const root = args.root;
  const batonJsonPath = join(root, '.baton', 'baton.json');
  if (!existsSync(batonJsonPath)) throw new Error(`${root} has no .baton/baton.json — run \`baton init\` first`);
  const batonJson = JSON.parse(readFileSync(batonJsonPath, 'utf8')) as BatonJson;
  const settings: MarkdownSettings = { items: batonJson.items, default_course: batonJson.default_course, repos: batonJson.repos };
  const ctx = { root, settings };

  // The ticket source: the repository's own, else the markdown default.
  let result: TicketsResult;
  const own = join(root, '.baton', 'tickets.mjs');
  if (existsSync(own)) {
    const mod = (await import(own)) as { default?: { tickets?: (ctx: unknown) => Promise<TicketsResult> } };
    if (typeof mod.default?.tickets !== 'function') throw new Error('.baton/tickets.mjs default-exports no tickets(ctx)');
    result = await mod.default.tickets(ctx);
  } else {
    const itemsDir = join(root, settings.items ?? 'tickets');
    const files = existsSync(itemsDir) ? readdirSync(itemsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => ({ path: e.name, text: readFileSync(join(itemsDir, e.name), 'utf8') })) : [];
    result = ticketsMarkdown(files, settings);
  }
  const closedIds = new Set(result.closed.map((c) => c.id));

  // The PR facts: recorded (tests) or the forge's own, gathered through the adapter's seam.
  const facts: PrFact[] = args.factsFile ? (JSON.parse(readFileSync(args.factsFile, 'utf8')) as PrFact[]) : await githubFacts(root, log);

  // Each course's stations: its own sync.mjs, else the default only `pr` has.
  const stations: Record<string, unknown> = {};
  const registry: Record<string, unknown>[] = [];
  const courses = batonJson.courses ?? [{ id: batonJson.default_course ?? 'pr', version: 1 }];
  for (const c of courses) {
    const courseFile = join(root, '.baton', 'courses', c.id, 'course.json');
    if (!existsSync(courseFile)) throw new Error(`.baton/courses/${c.id}/course.json is missing — run \`baton init --course ${c.id}\``);
    const course = JSON.parse(readFileSync(courseFile, 'utf8')) as Record<string, unknown>;
    const syncMjs = join(root, '.baton', 'courses', c.id, 'sync.mjs');
    if (existsSync(syncMjs)) {
      const mod = (await import(syncMjs)) as { default?: { stations?: (ctx: unknown) => Promise<Record<string, unknown>> } };
      if (typeof mod.default?.stations !== 'function') throw new Error(`.baton/courses/${c.id}/sync.mjs default-exports no stations(ctx)`);
      Object.assign(stations, await mod.default.stations({ ...ctx, tickets: result.tickets, closed: closedIds, facts }));
    } else if (c.id === 'pr') {
      for (const [id, st] of stationsPr({ tickets: result.tickets, facts, closed: closedIds })) stations[id] = st;
    } else {
      throw new Error(`course ${c.id} has no sync.mjs and the CLI's default serves only \`pr\` — add .baton/courses/${c.id}/sync.mjs`);
    }
    registry.push({
      id: c.id, version: c.version, min_worker_version: c.version, skill: 'next-roadmap-item', course,
      step_kinds: ['implement', 'review', 'fix', 'merge'], branch_pattern: (course.branch_pattern as string) ?? 'claude/{ticket}-*',
    });
  }

  // §7.1: the observation first, then the head, then the post over it.
  const auth = args.auth ?? bearerAuth(args.token ?? process.env.BATON_SYNC_TOKEN ?? null);
  const api = new BatonApi({ url: args.url, transport: args.transport ?? ((req) => fetch(req)), auth }, log);
  const observation = await api.observation();
  const head = await api.head();
  const sha = git(root, 'rev-parse', 'HEAD');
  await api.board({ registry, sha, parent_sha: head.sha ?? null, tickets: result.tickets, closed: result.closed, stations, observation: observation.observation });
  log(`baton: posted ${sha.slice(0, 10)} — ${result.tickets.length} tickets, ${result.closed.length} closed`);
  return 0;
}

/** A bearer sync credential (the CI identity token the workflow mints; R-BTN-93's transition
 * before the repository's sync key signs). A missing token is an error, never a silent post. */
function bearerAuth(token: string | null): Auth {
  if (!token) throw new Error('no sync credential: pass --token, or set BATON_SYNC_TOKEN (the workflow provides the CI identity token)');
  return (_m, _u, _b, secret) => ({ Authorization: `Bearer ${token}`, ...(secret ? { 'X-Worker-Secret': secret } : {}) });
}

/** R-BTN-96's fact adapter, GitHub half: the repository's PRs with their head checks and
 * reviews, mapped to PrFact. Live forge access — the tests inject recorded facts instead. */
async function githubFacts(root: string, log: (l: string) => void): Promise<PrFact[]> {
  const slug = git(root, 'remote', 'get-url', 'origin').replace(/^git@github.com:/, '').replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN to read GitHub — pass --facts <file> for recorded facts');
  const call = async (path: string): Promise<any[]> => {
    const res = await fetch(`https://api.github.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baton-sync' } });
    if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
    return (await res.json()) as any[];
  };
  const out: PrFact[] = [];
  for (const pr of await call(`/repos/${slug}/pulls?state=all&per_page=100`)) {
    const checks = (await call(`/repos/${slug}/commits/${pr.head.sha}/check-runs?per_page=100`)).map((c: any) => c.conclusion ?? null);
    const reviews = (await call(`/repos/${slug}/pulls/${pr.number}/reviews?per_page=100`)).map((r: any) => ({ author: r.user?.login ?? '?', state: r.state, submittedAt: Date.parse(r.submitted_at), body: r.body ?? '' }));
    out.push({ number: pr.number, head: pr.head.ref, state: pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : 'open', pushedAt: Date.parse(pr.updated_at), checks, reviews });
  }
  log(`baton: read ${out.length} PRs of ${slug} from GitHub`);
  return out;
}

/** Build a standalone default an ejected file can run without the package: esbuild bundles
 * the wrapper (which imports the default's module) into one .mjs with no external imports. */
async function bundleDefault(entry: string, outfile: string): Promise<void> {
  const { build } = await import('esbuild');
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', logLevel: 'warning' });
}

/** The wrappers an ejection bundles: a working file calling the CLI's default through the same
 * interface, ready to edit (the bundle's top is the default's own source). */
const WRAPPERS: Record<'tickets' | 'stations', string> = {
  tickets: `import { ticketsMarkdown } from ${JSON.stringify(join(DEFAULTS, 'tickets-markdown.ts'))};
export default {
  // The same signature the sync calls a repository's own source with: edit freely.
  async tickets(ctx) {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const items = ctx.settings.items ?? 'tickets';
    const dir = join(ctx.root, items);
    const files = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => ({ path: e.name, text: readFileSync(join(dir, e.name), 'utf8') }));
    return ticketsMarkdown(files, ctx.settings);
  },
};
`,
  stations: `import { stationsPr } from ${JSON.stringify(join(DEFAULTS, 'course-pr.ts'))};
export default {
  // The same signature the sync calls a repository's own function with: edit freely.
  async stations(ctx) {
    return stationsPr({ tickets: ctx.tickets, facts: ctx.facts, closed: ctx.closed });
  },
};
`,
};

/** `baton init [--course pr] [--eject tickets|stations]`. The io seam lets the test write
 * through memory; production writes the tree. */
export async function initMain(argv: string[], io: { root?: string; write?: (p: string, text: string) => void; mkdir?: (p: string) => void; read?: (p: string) => string; exists?: (p: string) => boolean; log?: (l: string) => void; bundle?: (kind: 'tickets' | 'stations', outfile: string) => Promise<void> } = {}): Promise<number> {
  const write = io.write ?? ((p, text) => writeFileSync(p, text));
  const mkdir = io.mkdir ?? ((p) => mkdirSync(p, { recursive: true }));
  const read = io.read ?? ((p) => readFileSync(p, 'utf8'));
  const exists = io.exists ?? existsSync;
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let course = 'pr';
  let eject: 'tickets' | 'stations' | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--course') course = value();
    else if (a === '--eject') {
      const v = value();
      if (v !== 'tickets' && v !== 'stations') throw new Error('--eject: tickets or stations');
      eject = v as 'tickets' | 'stations';
    } else throw new Error(`${a}: not a flag of baton init`);
  }
  const root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  const bundle = io.bundle ?? ((kind, outfile) => (async () => {
    const wrapper = join(outfile + '.wrapper.mjs');
    write(wrapper, WRAPPERS[kind]);
    try {
      await bundleDefault(wrapper, outfile);
    } finally {
      rmSync(wrapper, { force: true });
    }
  })());
  if (eject === 'tickets') {
    mkdir(join(root, '.baton'));
    await bundle('tickets', join(root, '.baton', 'tickets.mjs'));
    log('baton: .baton/tickets.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run');
    return 0;
  }
  if (eject === 'stations') {
    mkdir(join(root, '.baton', 'courses', course));
    await bundle('stations', join(root, '.baton', 'courses', course, 'sync.mjs'));
    log(`baton: .baton/courses/${course}/sync.mjs — a standalone bundle of the default; edit it; the sync uses it from the next run`);
    return 0;
  }
  // Scaffold: the settings, the course file (in git — the sync posts and baton run load the
  // same file, R-BTN-69/-72), the leg stubs, the pinned sync workflow, the tickets directory.
  mkdir(join(root, '.baton', 'courses', course, 'legs'));
  const settings: BatonJson = { baton_url: process.env.BATON_URL ?? DEFAULT_URL, items: 'tickets', default_course: course, repos: {}, agent_command: 'echo', courses: [{ id: course, version: 1 }] };
  write(join(root, '.baton', 'baton.json'), `${JSON.stringify(settings, null, 2)}\n`);
  write(join(root, '.baton', 'courses', course, 'course.json'), `${JSON.stringify(PR_COURSE, null, 2)}\n`);
  for (const leg of Object.keys(PR_COURSE.legs)) {
    const reached = leg === 'implement' ? 'pr-open' : leg === 'fix' ? 'fixed' : leg === 'merge' ? 'merged' : 'reviewed';
    const reviewNote = leg === 'review' ? '\n// The review stub: the agent returns a verdict, which close writes as the verdict line.' : '';
    write(join(root, '.baton', 'courses', course, 'legs', `${leg}.mjs`), `import { prClose } from '@immediately-run/baton/defaults/pr-close.ts';${reviewNote}
export async function run(ctx) {
  const { execFile } = await import('node:child_process');
  await new Promise((resolve, reject) => execFile(${JSON.stringify(settings.agent_command)}, [ctx.ticket.id, ${JSON.stringify(leg)}, ctx.checkout], (e) => (e ? reject(e) : resolve(undefined))));
  return { reached: '${reached}'${leg === 'implement' ? ", next: 'review'" : leg === 'review' || leg === 'fix' ? ", next: 'merge'" : ''} };
}
export const close = prClose;
export async function handoff(ctx) { return null; }
`);
  }
  mkdir(join(root, '.github', 'workflows'));
  write(join(root, '.github', 'workflows', 'baton-sync.yml'), SYNC_WORKFLOW);
  mkdir(join(root, 'tickets'));
  if (!exists(join(root, 'tickets', 'README.md'))) write(join(root, 'tickets', 'README.md'), '# Tickets\n\nOne `*.md` file per ticket; `baton init` wrote this directory.\n');
  log(`baton: .baton/ scaffolded (course ${course}) — commit it, add tickets/*.md, and the workflow does the rest`);
  return 0;
}

/** The sync workflow `baton init` writes: pinned to the CLI's version, so a release changes
 * no repository's tickets until that repository bumps the pin (R-BTN-74). */
export const SYNC_WORKFLOW = `name: baton sync
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  id-token: write
  contents: read
  pull-requests: read
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
      # Pin the CLI version: a release changes nothing here until this moves.
      - run: npx --yes @immediately-run/baton@pinned sync
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          BATON_SYNC_TOKEN: \${{ steps.oidc.outputs.token }}
`;
