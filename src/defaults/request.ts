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
  /** The id prefix the landing tree's tickets use, from `ticketPrefix`. */
  prefix: string;
  /** The course file's start and start leg, for the command's line. */
  start: string;
  startLeg: string;
}

/** A request as the command writes the file: the id it took at the head it is filed on. */
export interface Filed {
  /** The course, and its start station and leg, as the LANDING tree's course file names them. */
  course: string;
  start: string;
  startLeg: string;
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

/** A frontmatter value as the markdown source reads it back. `parseFrontmatter`'s `unquote` strips
 *  ONE surrounding pair of quotes and unescapes nothing, so a JSON-escaped value would come back
 *  with its backslashes in it (B-98's review round 1). A value with no quote of its own and no
 *  newline is written bare when that is safe, else in double quotes; a `"`-bearing value goes in
 *  single quotes; two kinds of quote in one value cannot round-trip this format, so its double
 *  quotes become curly ones rather than a backslash a person would have to read. */
const scalar = (v: string): string => {
  const one = v.replace(/\s+/g, ' ').trim();
  // One quote pair and nothing else: a JSON escape puts backslashes in, which the source keeps
  // (round 3, 3-r1-3: a quoted Windows path came back doubled).
  // No quote of its own reaches here (checked above), so one pair of double quotes is enough.
  const quoted = (t: string) => '"' + t + '"';
  if (!/["']/.test(one)) return /^[:#\s]/.test(one) || /^\[.*\]$/.test(one) || one === '' ? quoted(one) : one;
  if (!one.includes('"')) return '"' + one + '"';
  if (!one.includes("'")) return "'" + one + "'";
  return '"' + one.replace(/"/g, '\u201d') + '"';
};

/** The request ticket's file (§2f): the sentence as title and description, the course, `available`,
 *  `tags: [request]`; the body names the course and the command that filed it. */
export function requestFile(id: string, course: string, sentence: string, tier?: string, date = today()): string {
  return [
    '---',
    `title: ${scalar(`${id} — ${sentence}`)}`,
    `id: ${id}`,
    'status: available',
    `updated: ${date}`,
    'tags:',
    '  - request',
    ...(tier ? [`tier: ${scalar(tier)}`] : []),
    `course: ${scalar(course)}`,
    `description: ${scalar(sentence)}`,
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

/** The id prefix a repository's own tickets use: the commonest among the files the markdown
 *  source would read as tickets (frontmatter carrying an `id:` — a page like `README-2.mdx` is
 *  not one), else `B` (B-98's review round 2). */
export function ticketPrefix(root: string, items: string): string {
  const counts = new Map<string, number>();
  for (const sub of [items, join(items, 'archive')]) {
    const dir = join(root, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const m = /^([A-Za-z][A-Za-z0-9]*-)\d+\.mdx$/.exec(f);
      if (!m) continue;
      let text: string;
      try {
        text = readFileSync(join(dir, f), 'utf8');
      } catch {
        continue;
      }
      if (!/^---\r?\n[\s\S]*?^id:\s*\S/m.test(text)) continue;
      const key = m[1].replace(/-$/, '');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'B';
}

/** The next free `<prefix>-<n>` across `<items>/` and `<items>/archive/` — the next free NUMBER
 *  under that prefix only, as scripts/ticket.mjs numbers `B-`, so two id series in one repository
 *  each keep their own count (round 2, 2-r0-2). */
export function nextId(root: string, items: string, prefix = ticketPrefix(root, items)): string {
  const re = new RegExp('^' + prefix + '-(\\d+)\\.mdx$');
  const taken = [items, join(items, 'archive')]
    .filter((sub) => existsSync(join(root, sub)))
    .flatMap((sub) => readdirSync(join(root, sub)))
    .map((f) => re.exec(f)?.[1])
    .filter((n) => n != null)
    .map(Number);
  return prefix + '-' + (Math.max(0, ...taken) + 1);
}

/** Read and judge the checkout before any git runs: the `.baton/baton.json` the request must be
 *  listed in, the course file that must opt in. Each refusal names what to do. */
export function readRequestPlan(root: string, course: string, sentence: string, at = resolve(root), where?: string): RequestPlan {
  // `where` names the tree in a refusal: a landing read's `at` is a throwaway worktree, useless
  // to an operator — the branch is what they can act on (round 3, 3-r1-1).
  const site = where ?? at;
  // `at` is the tree judged: the caller's checkout, or the fetched worktree a request is
  // committed in (B-98's review round 1: the course must be listed and opted in on the branch
  // the ticket LANDS on, never only on a branch the caller happens to be standing on).
  const settingsPath = join(at, '.baton', 'baton.json');
  if (!existsSync(settingsPath)) throw new Error(`${site} has no .baton/baton.json — \`baton request\` files a ticket into a repository the sync reads; run \`baton repo init\` there first`);
  let settings: BatonJson;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as BatonJson;
  } catch (e) {
    throw new Error(`.baton/baton.json is not JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  const listed = (settings.courses ?? []).map((c) => c.id);
  if (!listed.includes(course)) {
    throw new Error(`${site}: course ${course} is not one .baton/baton.json lists (${listed.length ? listed.join(', ') : 'none'}) — add it to \`courses\` with \`baton repo init --course ${course}\``);
  }
  const courseFile = join(at, '.baton', 'courses', course, 'course.json');
  if (!existsSync(courseFile)) throw new Error(`${site}: .baton/courses/${course}/course.json is missing — run \`baton repo init --course ${course}\``);
  let graph: { starts_from?: unknown; start?: unknown; start_leg?: unknown };
  try {
    graph = JSON.parse(readFileSync(courseFile, 'utf8')) as typeof graph;
  } catch (e) {
    throw new Error(`.baton/courses/${course}/course.json is not JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  // R-BTN-131 (B-98): the course opts in. An ordinary course keeps its hand-filed tickets — its
  // start leg is written by whoever knows the work, not by one sentence.
  if (graph.starts_from !== REQUEST_ENTRY) {
    throw new Error(`${site}: course ${course} does not start from a request — its course.json carries no starts_from: request. An ordinary course keeps its hand-filed tickets; a course that has gained one (create-spec, build-app) refreshes it with \`baton repo init --course ${course} --force\``);
  }
  if (typeof graph.start !== 'string' || typeof graph.start_leg !== 'string') {
    throw new Error(`.baton/courses/${course}/course.json names no start and start_leg`);
  }
  const items = settings.items ?? 'tickets';
  return { root: at, sentence, course, items, prefix: ticketPrefix(at, items), start: graph.start, startLeg: graph.start_leg };
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
      // The landing tree's own word (round 1, 1-A-2): the course must be listed and opted in on
      // the branch this ticket will be read from, never only on one the caller stands on. The
      // plan's root is swapped for the worktree for this try.
      const atHead = readRequestPlan(plan.root, plan.course, plan.sentence, dir, `${remote}/${branch()}`);
      const id = nextId(dir, atHead.items, atHead.prefix);
      const text = requestFile(id, atHead.course, plan.sentence, opts.tier, opts.date);
      const message = requestMessage(id, plan.course, plan.sentence);
      const file = join(dir, atHead.items, `${id}.mdx`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      // The ticket file alone: the worktree is a fresh checkout of the fetched head, so nothing
      // else in it is this request's to commit.
      git(dir, 'add', '--', `${atHead.items}/${id}.mdx`);
      git(dir, 'commit', '-q', '-m', message);
      try {
        git(dir, 'push', '-q', remote, `HEAD:refs/heads/${branch()}`);
        return { id, text, message, course: atHead.course, start: atHead.start, startLeg: atHead.startLeg };
      } catch (e) {
        const said = (e as { status?: unknown; stderr?: string | Uint8Array }).stderr;
        const detail = typeof said === 'string' ? said : said ? new TextDecoder().decode(said) : (e as Error).message;
        // Only a push refused because the branch moved is retried: git's `stderr` on a
        // non-fast-forward is its own words for it (`rejected`, `fetch first`). Any other failure
        // (no remote, no permission, a missing branch) is the operator's to fix, and passes up.
        // A hook or a protected branch: git says why in its `remote:` / ` ! [remote rejected]`
        // lines, and those are what the operator needs — not only `failed to push some refs`.
        if (!/non-fast-forward|fetch first|stale info/.test(detail)) {
          const why = detail.trim().split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^To /.test(l) && !/failed to push some refs/.test(l));
          throw new Error(`the push was refused: ${why.join('; ') || 'no reason given'}`);
        }
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
    // A sentence may start with a dash: everything after `--` is words, never flags — flags
    // BEFORE it still apply (round 4, 3-r1-2: `--` used to swallow a later --course).
    if (a === '--') {
      sentence.push(...argv.slice(i + 1));
      break;
    }
    if (a === '--help' || a === '-h') {
      log('baton request "<one sentence>" --course <id> [--repo DIR] [--tier T] [--branch B] [--remote R]');
      log('  files one request ticket on a course whose course.json says starts_from: request, commits');
      log('  it to the default branch and pushes it: the push starts the sync, the board places the');
      log('  ticket, the next claim starts the course. -- ends the flags: a sentence may start with -.');
      return 0;
    }
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
  const top = topOf(root);
  if (top == null) throw new Error(`${resolve(root)} is not a git checkout — \`baton request\` commits the ticket and pushes it, so it needs the repository's checkout`);
  // A subdirectory of a checkout is that checkout (round 2, 2-r0-6): git resolves -C to the top
  // level itself, and this is the root the worktree and the push run in.
  root = top;
  // The caller's checkout answers only what the caller can know (it is a git checkout — above).
  // The course, its `items` and the id prefix are the LANDING tree's word, read in the worktree
  // (round 1, 1-A-2; round 2, 2-r0-1: judging them here both duplicated the check and refused
  // requests the target would have accepted).
  const plan = { root: top, sentence: said, course, items: 'tickets', prefix: 'B', start: '', startLeg: '' };
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
  log(`baton request: filed ${filed.id} (course ${filed.course}) — the next claim starts ${filed.startLeg} at ${filed.start}`);
  return 0;
}
