// request.ts — `baton request "<one sentence>" --course <course>` (B-98, BATON_SPEC §5.8
// R-BTN-131, §2f R-BTN-74): a course whose product is tickets or specs — `create-spec`,
// `build-app` — is not started ticket-less. It is started by a **request ticket**: one sentence,
// `course:` naming the course, filed by this command instead of written by hand. Everything after
// it rides the machine that already exists: the push triggers the sync, the board places the
// ticket at the course's start station with its start leg ready, and the next claim starts the
// course.
//
// It is a REPOSITORY command, not an API call: the developer running it has the checkout, and git
// is the channel. One commit — the ticket file, and nothing else — is pushed straight to the
// default branch, exactly as this repository's `npm run ticket -- new` does (scripts/ticket.mjs):
// in a throwaway worktree at the freshly fetched head, so the caller's branch and working tree are
// never touched, and retried on a moved head, so two developers filing at once both land. The next
// free id is read again on every try, from the head the commit is about to sit on.
//
// The course opts in: only a course file carrying `starts_from: request` may be requested — an
// ordinary course keeps its hand-filed tickets. And the course must be one the checkout's
// `.baton/baton.json` lists, because the sync refuses a ticket on a course it does not know, and
// filing one would wedge the board.
// Course code in the CLI, never core (§2b).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The most tries one request makes when the default branch moves under it, as
 *  scripts/ticket.mjs's transact does: a lost race is refetched and re-committed on the new head. */
export const REQUEST_TRIES = 6;

/** The course file key that opts a course into requests, and the one value it takes. */
export const STARTS_FROM = 'starts_from';
export const REQUEST_ENTRY = 'request';

/** `.baton/baton.json`'s fields this command reads (cli.ts's BatonJson, narrowed). */
interface BatonJson {
  items?: string;
  default_course?: string;
  courses?: { id: string }[];
}

/** A request as `requestMain` plans it, before any git runs: what it files, on which course, and
 *  where the course starts — pure over the checkout and the sentence. */
export interface RequestPlan {
  /** The repository the request is filed in. */
  root: string;
  /** The sentence, as given (trimmed). */
  sentence: string;
  course: string;
  /** The repository's `items` setting: where the ticket file goes, relative to `root`. */
  items: string;
  /** The course file's start and start leg, for the command's line. */
  start: string;
  startLeg: string;
}

/** A request as the command writes the file: the id it took at the head it is filed on. */
export interface Filed {
  id: string;
  /** The file's content, as the markdown source reads it (tickets-markdown.ts §2f). */
  text: string;
  /** The commit's subject. */
  message: string;
}

const git = (root: string, ...a: string[]): string =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();

const gitQuiet = (root: string, ...a: string[]): boolean => {
  try {
    git(root, ...a);
    return true;
  } catch {
    return false;
  }
};

const today = (): string => new Date().toISOString().slice(0, 10);

/** The commit's subject: `<ID>: request — <first 60 characters of the sentence> — <course>`. */
export const requestMessage = (id: string, course: string, sentence: string): string =>
  `${id}: request — ${sentence.slice(0, 60).trim()} — ${course}`;

/** A frontmatter value as the markdown source reads it back: a double-quoted JSON string when it
 *  holds anything the one-line, unquoted form would lose (a `: `, a `#`, a leading quote), else
 *  bare. Both are read identically by `parseFrontmatter` (`unquote`), so the file stays a plain
 *  `key: value` page a person can edit. */
const scalar = (v: string): string => (/^[A-Za-z0-9][^"'\n]*$/.test(v) && !/: |\s#|^\s|\s$/.test(v) ? v : JSON.stringify(v));

/** The request ticket's file (§2f): the sentence as title and description, the course, `available`,
 *  `tags: [request]`; the body names the course and the command that filed it. */
export function requestFile(id: string, course: string, sentence: string, tier?: string, date = today()): string {
  return [
    '---',
    `title: ${JSON.stringify(`${id} — ${sentence}`)}`,
    `id: ${id}`,
    'project: baton',
    'status: available',
    `updated: ${date}`,
    'tags:',
    '  - request',
    ...(tier ? [`tier: ${scalar(tier)}`] : []),
    `course: ${scalar(course)}`,
    `description: ${JSON.stringify(sentence)}`,
    'topics:',
    '  - baton',
    'owns: {}',
    'prs: []',
    'depends_on: []',
    '---',
    '',
    `${sentence}`,
    '',
    `A request on the \`${course}\` course, filed with \`baton request\`. The board places it at the`,
    `course's start, and the next claim starts it: nothing else is needed to begin.`,
    '',
  ].join('\n');
}

/** The next free `B-<n>` under a checkout's `<items>/` and `<items>/archive/` — scripts/ticket.mjs's
 *  scan, so a request and `npm run ticket -- new` never take the same id. */
export function nextId(root: string, items: string): string {
  const taken = [items, join(items, 'archive')]
    .filter((sub) => existsSync(join(root, sub)))
    .flatMap((sub) => readdirSync(join(root, sub)))
    .map((f) => /^B-(\d+)\.mdx$/.exec(f)?.[1])
    .filter((n): n is string => n != null)
    .map(Number);
  return `B-${Math.max(0, ...taken) + 1}`;
}

/** Read and judge the checkout before any git runs: the `.baton/baton.json` the request must be
 *  listed in, the course file that must opt in. Each refusal names what to do. */
export function readRequestPlan(root: string, course: string, sentence: string): RequestPlan {
  const at = resolve(root);
  const settingsPath = join(at, '.baton', 'baton.json');
  if (!existsSync(settingsPath)) throw new Error(`${at} has no .baton/baton.json — \`baton request\` files a ticket into a repository the sync reads; run \`baton repo init\` there first`);
  let settings: BatonJson;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as BatonJson;
  } catch (e) {
    throw new Error(`.baton/baton.json is not JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  const listed = (settings.courses ?? []).map((c) => c.id);
  if (!listed.includes(course)) {
    throw new Error(`course ${course} is not one .baton/baton.json lists (${listed.length ? listed.join(', ') : 'none'}) — add it to \`courses\` with \`baton repo init --course ${course}\``);
  }
  const courseFile = join(at, '.baton', 'courses', course, 'course.json');
  if (!existsSync(courseFile)) throw new Error(`.baton/courses/${course}/course.json is missing — run \`baton repo init --course ${course}\``);
  let graph: { starts_from?: unknown; start?: unknown; start_leg?: unknown };
  try {
    graph = JSON.parse(readFileSync(courseFile, 'utf8')) as typeof graph;
  } catch (e) {
    throw new Error(`.baton/courses/${course}/course.json is not JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  // R-BTN-131 (B-98): the course opts in. An ordinary course keeps its hand-filed tickets — its
  // start leg is written by whoever knows the work, not by one sentence.
  if (graph.starts_from !== REQUEST_ENTRY) {
    throw new Error(`course ${course} does not start from a request — its course.json carries no starts_from: request; an ordinary course keeps its hand-filed tickets`);
  }
  if (typeof graph.start !== 'string' || typeof graph.start_leg !== 'string') {
    throw new Error(`.baton/courses/${course}/course.json names no start and start_leg`);
  }
  return { root: at, sentence, course, items: settings.items ?? 'tickets', start: graph.start, startLeg: graph.start_leg };
}

/** The branch a request lands on: `--branch`, else the checkout's `origin/HEAD`, else `main`. */
export function defaultBranch(root: string, branch?: string): string {
  if (branch) return branch;
  try {
    const ref = git(root, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
    if (ref.startsWith('origin/') && ref.length > 'origin/'.length) return ref.slice('origin/'.length);
  } catch {
    // no origin/HEAD: main, below
  }
  return 'main';
}

export interface RequestOptions {
  /** A branch to push to, over the resolution above. Exported for the tests. */
  branch?: string;
  /** The remote name (`origin`), or its path. */
  remote?: string;
  tier?: string;
  /** A log for the retry notices; silent by default. */
  warn?: (line: string) => void;
  /** The clock's date for `updated:`, for a test's fixed day. */
  date?: string;
}

/** File the plan's request: fetch, take the next free id at the fetched head, commit the one file
 *  in a throwaway worktree, push, and retry the whole thing on a moved head. Returns what landed.
 *  The worktree is the mechanism scripts/ticket.mjs's transact uses, for the reason it uses it:
 *  the caller's branch, HEAD and working tree (its index and untracked files included) are never
 *  written, a half-finished request leaves the repository exactly as it was, and the commit is made
 *  by git itself, so a pre-commit hook or `commit.gpgsign` the repository sets applies to it as to
 *  any other. Git plumbing (a temp index and `commit-tree`) would skip those; a real worktree does
 *  not. */
export function fileRequest(plan: RequestPlan, opts: RequestOptions = {}): Filed {
  const remote = opts.remote ?? 'origin';
  // The branch is resolved again on every try: a fetch may bring `origin/HEAD` the first pass lacked.
  const branch = () => defaultBranch(plan.root, opts.branch);
  const warn = opts.warn ?? (() => {});
  for (let attempt = 1; attempt <= REQUEST_TRIES; attempt++) {
    git(plan.root, 'fetch', '-q', remote, branch());
    const dir = mkdtempSync(join(tmpdir(), 'baton-request-'));
    try {
      // The worktree starts from the commit the fetch just brought (`FETCH_HEAD`), never from a
      // remote-tracking ref: a stale `origin/main` would have the commit refused as no fast-forward
      // every try, while this is the head the push must extend.
      git(plan.root, 'worktree', 'add', '-q', '--detach', dir, 'FETCH_HEAD');
      const id = nextId(dir, plan.items);
      const text = requestFile(id, plan.course, plan.sentence, opts.tier, opts.date);
      const message = requestMessage(id, plan.course, plan.sentence);
      const file = join(dir, plan.items, `${id}.mdx`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      // The ticket file alone: the worktree is a fresh checkout of the fetched head, so nothing
      // else in it is this request's to commit.
      git(dir, 'add', '--', `${plan.items}/${id}.mdx`);
      git(dir, 'commit', '-q', '-m', message);
      try {
        git(dir, 'push', '-q', remote, `HEAD:refs/heads/${branch()}`);
        return { id, text, message };
      } catch (e) {
        const said = (e as { status?: unknown; stderr?: string | Uint8Array }).stderr;
        const detail = typeof said === 'string' ? said : said ? new TextDecoder().decode(said) : (e as Error).message;
        // Only a push refused because the branch moved is retried: git's `stderr` on a
        // non-fast-forward is its own words for it (`rejected`, `fetch first`). Any other failure
        // (no remote, no permission, a missing branch) is the operator's to fix, and passes up.
        if (!/non-fast-forward|fetch first|stale info|\[rejected\]/.test(detail)) throw new Error(`the push was refused: ${detail.trim().split('\n').filter((l) => /^(fatal|error):/.test(l)).join('; ') || 'no reason given'}`);
        if (attempt === REQUEST_TRIES) throw new Error(`push refused ${REQUEST_TRIES} times: ${detail.trim().split('\n').at(-1)}`);
        warn(`baton request: ${remote}/${branch()} moved; retrying on the new head (${attempt}/${REQUEST_TRIES})`);
      }
    } finally {
      try {
        git(plan.root, 'worktree', 'remove', '--force', dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  // Unreachable: the loop returns or throws on its last try.
  throw new Error('baton request: no try ran');
}

/** Whether a path is inside a git checkout at all (`git rev-parse` names its top level). */
const topOf = (root: string): string | null => {
  try {
    return git(root, 'rev-parse', '--show-toplevel');
  } catch {
    return null;
  }
};

/**
 * `baton request "<one sentence>" --course <course> [--repo DIR] [--tier T] [--branch B]
 * [--remote R]` (B-98): files ONE request ticket on a course that opts in, as one commit pushed
 * straight to the repository's default branch — the push triggers the sync, the board places the
 * ticket, the next claim starts the course. Prints the id and the course's first station.
 *
 * A refusal — no `--course`, an empty sentence, no `.baton/baton.json`, a course it does not list,
 * a course not `starts_from: request` — throws, which the CLI prints as one `baton: …` line and
 * exits 2 on.
 */
export function requestMain(
  argv: string[],
  io: { root?: string; log?: (line: string) => void; warn?: (line: string) => void; date?: string } = {},
): number {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warn = io.warn ?? ((l: string) => process.stderr.write(`${l}\n`));
  let root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  let course: string | undefined;
  let tier: string | undefined;
  let branch: string | undefined;
  let remote: string | undefined;
  const sentence: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--course') course = value();
    else if (a === '--repo') root = value();
    else if (a === '--tier') tier = value();
    else if (a === '--branch') branch = value();
    else if (a === '--remote') remote = value();
    else if (a.startsWith('-')) throw new Error(`${a}: not a flag of baton request`);
    else sentence.push(a);
  }
  if (course == null || course === '') throw new Error('--course is required: the course the request starts (a course whose course.json says starts_from: request)');
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(course)) throw new Error(`--course ${course}: not a course id`);
  const said = sentence.join(' ').replace(/\s+/g, ' ').trim();
  if (!said) throw new Error('the request is one sentence, in quotes: baton request "<what to do>" --course <id>');
  if (!existsSync(root)) throw new Error(`--repo ${root}: no such directory`);
  if (topOf(root) == null) throw new Error(`${resolve(root)} is not a git checkout — \`baton request\` commits the ticket and pushes it, so it needs the repository's checkout`);
  const plan = readRequestPlan(root, course, said);
  let filed: Filed;
  try {
    filed = fileRequest(plan, { ...(branch ? { branch } : {}), ...(remote ? { remote } : {}), ...(tier ? { tier } : {}), ...(io.date ? { date: io.date } : {}), warn });
  } catch (e) {
    // A failure the git call itself raised carries git's stderr; a refusal of this command's does
    // not. A git one becomes the CLI's one `baton: …` line naming the repository and git's own
    // words, never a bare `Command failed` with the arguments in it. The caller's refusals pass
    // through as the sentence they are.
    if (!(e as { status?: unknown }).status) throw e;
    const said2 = (e as { stderr?: string | Uint8Array }).stderr;
    const detail = typeof said2 === 'string' ? said2 : said2 ? new TextDecoder().decode(said2) : (e as Error).message;
    const lines = detail.trim().split('\n').filter(Boolean);
    // git's own `fatal: …`/`error: …` lines first — the cause — then the advice after them.
    const cause = lines.filter((l) => /^(fatal|error):/.test(l));
    throw new Error(`git in ${resolve(root)}: ${(cause.length ? cause : lines).join('; ') || 'failed'}`);
  }
  log(`baton request: filed ${filed.id} (course ${plan.course}) — the next claim starts ${plan.startLeg} at ${plan.start}`);
  return 0;
}
