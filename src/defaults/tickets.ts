// tickets.ts — `baton tickets new | claim | set | done | check` (B-112, BATON_SPEC §2f R-BTN-74,
// §4.2 R-BTN-74, R-BTN-31's scenarios): the ticket commands, once, in the CLI every ticket
// repository already depends on — where `scripts/ticket.mjs` (this repository and fieldhouse) and
// docs' `claim.sh` each had a copy, and each read its own idea of an id.
//
// Behaviour is the stopgap's, behaviour for behaviour: each command is one commit pushed straight
// to the default branch from a throwaway worktree at the freshly fetched head, so the caller's
// branch and working tree are never touched; a push refused because the branch moved is fetched
// again and retried; `claim` refuses a ticket that is not available or whose dependencies are not
// done; `new` takes the next free id on the head it pushes to. What is new is that all of it is
// CONFIGURED — the items folder, the id prefix, the legacy patterns still accepted, the default
// project and the tags come from `.baton/baton.json` (tickets-config.ts) — that `new` writes the
// conventional body rather than a placeholder, that it judges what it wrote before pushing, and
// that `check` reports the generated "How tickets work" page (tickets-page.ts) when it has drifted.
//
// A refusal is thrown, and the CLI prints it as one `baton: …` line, exit 2 — B-111's check keeps
// its own exit 1 for a finding.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkPayload, dependsCycles } from '../core/board';
import { checkTicketsMain, dependsLine } from './tickets-check';
import { accepts, accepting, allocates, allocatingPrefix, GITHUB_PR, LIVE_STATUSES, readSettingsJson, readTicketSettings, requiresFrom, TAGS, type Status, type TicketSettings } from './tickets-config';
import { addPr, idOf, locate, nextNumber, scalar, setKey } from './tickets-file';
import { PAGE_NAME, ticketsPage } from './tickets-page';
import { readItems } from './read-items';
import { ticketsMarkdown, type MarkdownFile } from './tickets-markdown';

/** The most tries one command makes when the default branch moves under it: the stopgap's. */
export const TICKET_TRIES = 6;

const git = (root: string, ...a: string[]): string =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();

const today = (): string => new Date().toISOString().slice(0, 10);

/** git's own words for a push refused because the branch moved — the one refusal a re-read fixes;
 *  a hook's or a protected branch's says `[remote rejected]`, and no re-read fixes that. */
const movedOnPush = (detail: string): boolean => /non-fast-forward|fetch first|stale info/.test(detail);

const detailOf = (e: unknown): string => {
  const err = e as { status?: unknown; stderr?: string | Uint8Array; message?: string };
  return typeof err?.stderr === 'string' ? err.stderr : err?.stderr ? new TextDecoder().decode(err.stderr) : (err?.message ?? String(e));
};

/** The branch commands land on: the checkout's `origin/HEAD`, else `main` (request.ts's own). */
export function ticketsBranchOf(root: string): string {
  try {
    const ref = git(root, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
    if (ref.startsWith('origin/') && ref.length > 'origin/'.length) return ref.slice('origin/'.length);
  } catch {
    // no origin/HEAD: main
  }
  return 'main';
}

export interface TicketsIo {
  root?: string;
  log?: (line: string) => void;
  warn?: (line: string) => void;
  /** The day `updated:` and `## Status` carry, for a test's fixed day. */
  date?: string;
  /** The remote (`origin`) and the branch (`origin/HEAD`, else `main`). */
  remote?: string;
  branch?: string;
  /** `new`'s own line, printed by the command rather than `transact`'s. */
  quiet?: boolean;
}

/** What one try of a command does in the worktree, and the commit's subject it lands with. */
interface Change {
  /** The commit's message; its first line is printed on success. */
  message: string;
  /** The files to write, relative to the worktree root. */
  write: { path: string; text: string }[];
  /** Files to move, relative to the worktree root: committed as one delete and one add. */
  move: { from: string; to: string }[];
}

/** Run `change(worktree)` on a fresh head and push its commit, retrying on a lost race. The
 *  worktree is the mechanism request.ts's `fileRequest` uses, for the reason it uses it: the
 *  caller's branch, HEAD and working tree are never written, a command that fails leaves the
 *  repository exactly as it was, and the commit is made by git, so the repository's own hooks and
 *  signing settings apply to it as to any other. */
function transact(root: string, io: TicketsIo, describe: string, change: (dir: string) => Change): void {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warn = io.warn ?? ((l: string) => process.stderr.write(`${l}\n`));
  const remote = io.remote ?? 'origin';
  const branch = io.branch ?? ticketsBranchOf(root);
  for (let attempt = 1; attempt <= TICKET_TRIES; attempt++) {
    git(root, 'fetch', '-q', remote, branch);
    const dir = mkdtempSync(join(tmpdir(), 'baton-tickets-'));
    try {
      // The head the push must extend: the commit the fetch just brought, never a stale
      // remote-tracking ref that would be refused as no fast-forward on every try.
      git(root, 'worktree', 'add', '-q', '--detach', dir, 'FETCH_HEAD');
      const { message, write, move } = change(dir);
      const written = new Set(write.map((w) => w.path));
      for (const m of move) {
        mkdirSync(dirname(join(dir, m.to)), { recursive: true });
        // A move into a path this command also wrote has its content there already: the old file
        // is the delete, and the write the add.
        if (written.has(m.to)) rmSync(join(dir, m.from), { force: true });
        else renameSync(join(dir, m.from), join(dir, m.to));
      }
      for (const w of write) {
        mkdirSync(dirname(join(dir, w.path)), { recursive: true });
        writeFileSync(join(dir, w.path), w.text);
      }
      // The paths this command touched, and nothing else: the worktree is a fresh checkout of
      // the fetched head, so nothing else in it is this command's to commit.
      git(dir, 'add', '-A', '--', ...new Set([...write.map((w) => w.path), ...move.map((m) => m.from)]));
      // Nothing to record is a lost race too — a peer pushed this same change first — so it is
      // the next try's, not a failure.
      // Asked, not parsed from a failure: `git diff --cached --quiet` exits 0 when the index
      // matches HEAD, which is the lost race this command's change losing to a peer's identical one
      // looks like — a rewrite that lands the same bytes.
      const staged = (() => {
        try {
          git(dir, 'diff', '--cached', '--quiet');
          return false;
        } catch {
          return true;
        }
      })();
      if (!staged) {
        if (attempt === TICKET_TRIES) throw new Error(`${describe}: nothing to commit after ${TICKET_TRIES} tries`);
        warn(`… ${describe}: nothing to commit — a peer landed the same change; retrying (${attempt}/${TICKET_TRIES})`);
        continue;
      }
      git(dir, 'commit', '-q', '-m', message);
      try {
        git(dir, 'push', '-q', remote, `HEAD:refs/heads/${branch}`);
        if (!io.quiet) log(`✓ ${message.split('\n')[0]} — pushed as ${git(dir, 'rev-parse', '--short', 'HEAD')}`);
        return;
      } catch (e) {
        const detail = detailOf(e);
        if (!movedOnPush(detail)) {
          const why = detail.trim().split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^To /.test(l) && !/failed to push some refs/.test(l));
          throw new Error(`${describe}: the push was refused: ${why.join('; ') || 'no reason given'}`);
        }
        if (attempt === TICKET_TRIES) throw new Error(`${describe}: push refused ${TICKET_TRIES} times: ${detail.trim().split('\n').at(-1)}`);
        warn(`… ${describe}: ${remote}/${branch} moved; retrying on the new head (${attempt}/${TICKET_TRIES})`);
      }
    } finally {
      try {
        git(root, 'worktree', 'remove', '--force', dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}

/** The settings of the head a command is about to write: read in the worktree, never in the
 *  caller's checkout, so a branch the caller stands on cannot change what lands (B-98's lesson). */
const settingsAt = (dir: string, remote: string, branch: string): TicketSettings => readTicketSettings(dir, `${remote}/${branch}`);

/** A ticket's file in the worktree, in the items folder and in its `archive/`: `locate`'s two
 *  names, asked of the filesystem the worktree is, never the process's checkout. */
const fileAt = (dir: string): ((path: string) => boolean) => (path) => existsSync(join(dir, path));

/** The repository's tickets at `dir`, read as the sync reads them: the markdown source over the
 *  items folder, its `repos` short names resolved through `.baton/baton.json`'s map. */
const sourceAt = (dir: string, settings: TicketSettings) =>
  ticketsMarkdown(readItems(dir, settings.items ?? 'tickets'), { items: settings.items, repos: readSettingsJson(dir).repos });

const acceptedList = (settings: TicketSettings): string => Object.keys(settings.prefixes).sort().map((p) => `${p}…`).join(', ');

/* ------------------------------------------------------------------------------------------
 * claim | set | done
 * ---------------------------------------------------------------------------------------- */

/** `baton tickets claim <id>` — available → in-progress, refusing a ticket that is not available
 *  or whose `depends_on` are not all done (archived, or a live closed status); `baton tickets
 *  set <id> <status> [--pr URL]` — any live status, as the session that left it; `baton tickets
 *  done <id> [--pr URL]` — done, and the file moved to `archive/`. `claim` is the one that
 *  refuses: it is the lock, and `set` is the session keeping its own ticket's word. */
export function moveTicket(root: string, io: TicketsIo, id: string, status: Status, pr?: string, claim = false): void {
  if (pr != null && !GITHUB_PR.test(pr)) throw new Error(`--pr ${pr} is not a GitHub pull request URL`);
  const date = io.date ?? today();
  const remote = io.remote ?? 'origin';
  const branch = io.branch ?? ticketsBranchOf(root);
  transact(root, io, `${id} → ${status}`, (dir) => {
    const settings = settingsAt(dir, remote, branch);
    if (!accepts(settings, id)) throw new Error(`${id} is not a ticket id of this repository — its ids are ${acceptedList(settings)}`);
    const items = (settings.items ?? 'tickets').replace(/\/$/, '');
    const found = locate(items, id, fileAt(dir));
    if (!found) throw new Error(`${id}: no ${items}/${id}.mdx on ${remote}/${branch}`);
    if (found.archived) throw new Error(`${id} is archived (done)`);
    let text = readFileSync(join(dir, found.path), 'utf8');
    const read = sourceAt(dir, settings);
    const current = read.tickets.find((t) => t.id === id)?.display?.status ?? 'closed';
    // A claim is available → in-progress alone, the stopgap's rule that keeps two sessions off one
    // ticket; `set` moves a status wherever the caller's own session left it.
    if (status === 'in-progress' && claim && current !== 'available') throw new Error(`${id} is ${current}, not available — someone may hold it`);
    if (status === 'in-progress' && claim) {
      const open = (read.tickets.find((t) => t.id === id)?.depends_on ?? []).filter((dep) => !isDone(dir, settings, dep));
      if (open.length) throw new Error(`${id} depends on ${open.join(', ')}, not done yet`);
    }
    text = setKey(setKey(text, 'status', status), 'updated', date);
    if (pr) text = addPr(text, pr);
    const from = `${items}/${id}.mdx`;
    const to = `${items}/archive/${id}.mdx`;
    const message = status === 'done'
      ? `tickets: ${id} done (archived)${pr ? `\n\n${pr}` : ''}`
      : status === 'in-progress' ? `tickets: claim ${id} (in progress)` : `tickets: ${id} → ${status}${pr ? `\n\n${pr}` : ''}`;
    // A done ticket is written at its archive path, and the live file moved there: the move
    // alone would commit the file as it was, without the status and the PR.
    if (status === 'done') return { message, write: [{ path: to, text }], move: [{ from, to }] };
    return { message, write: [{ path: from, text }], move: [] };
  });
}

/** Whether `id` is done, for a claim's dependency: archived, or a live file carrying any of the
 *  markdown source's closed statuses (`done`, `superseded`, `deferred`, `withdrawn`). */
function isDone(dir: string, settings: TicketSettings, id: string): boolean {
  const items = (settings.items ?? 'tickets').replace(/\/$/, '');
  const found = locate(items, id, fileAt(dir));
  if (!found) return false;
  if (found.archived) return true;
  return !sourceAt(dir, settings).tickets.some((t) => t.id === id);
}

/* ------------------------------------------------------------------------------------------
 * new
 * ---------------------------------------------------------------------------------------- */

export interface NewTicket {
  title: string;
  description?: string;
  tier?: string;
  order?: number;
  repos?: string[];
  tags?: string[];
  project?: string;
  dependsOn?: string[];
  course?: string;
  /** `--body-file`'s text: kept as given, judged with the flags. */
  body?: string;
}

/** The order a ticket ranks at when `--order` names none: after every order a filer writes. */
export const ORDER_AFTER_LAST = 1_000_000;

/** The body's `**Depends on:**` line: the ids, or `none.` (the markdown source's own spelling). */
export const dependsLineOf = (deps: readonly string[]): string => `**Depends on:** ${deps.length ? `${deps.join(', ')}.` : 'none.'}`;

/** The conventional body `new` writes: `**Brief:**` (the description), `**Spec:**`, `**Depends
 *  on:**` (from `--depends-on`), `**Used by:**`, the three headings a filer fills, `**Requires:**`
 *  and `## Status`. A description that ends with a `Requires:` clause is written on the requires
 *  line; the others say the line is the filer's to write. */
export function skeletonBody(o: { description: string; deps: readonly string[]; course?: string; date: string }): string {
  const requires = requiresFrom(o.description);
  return [
    `**Brief:** ${o.description.replace(/\s+/g, ' ').trim()}`,
    '',
    '**Spec:** _(the spec section this implements — a `BATON_SPEC` rule, a design doc — or “none: this ticket says it all”.)_',
    '',
    dependsLineOf(o.deps),
    '',
    '**Used by:** nothing yet.',
    '',
    '### What to build',
    '',
    '_(the change, and the architecture it prescribes: name the code it follows.)_',
    '',
    '### Tests',
    '',
    '_(the tests that would fail without the change, by name.)_',
    '',
    '### Exit criteria',
    '',
    '- [ ] _(each, with how it is checked.)_',
    '',
    requires.length
      ? `**Requires:** ${requires.map((c) => `\`${c}\``).join(', ')}.`
      : "_A description that ends with a `Requires:` clause — “… Requires: human-operator.” — has the capabilities it names written here; otherwise the filer writes this line._",
    '',
    '## Status',
    '',
    o.course ? `_filed ${o.date}; the \`${o.course}\` course._` : `_filed ${o.date}._`,
    '',
  ].join('\n');
}

/** `baton tickets new …` (B-112): file one ticket — the next free id under `.baton/baton.json`'s
 *  prefix, its conventional body, `roadmap-item` unless `--tags` says otherwise — as one commit
 *  pushed straight to the default branch. Before the push the filing is judged as `baton tickets
 *  check` judges the same files: its `**Depends on:**` line against `depends_on`, and the board
 *  post's own validation — every id a live or closed ticket, no cycle — over the files the commit
 *  would leave. One that fails is written to no branch at all. Returns the id it took. */
export function newTicket(root: string, io: TicketsIo, t: NewTicket): string {
  const title = t.title.trim();
  if (!title) throw new Error('new needs --title');
  const deps = t.dependsOn ?? [];
  const date = io.date ?? today();
  const remote = io.remote ?? 'origin';
  const branch = io.branch ?? ticketsBranchOf(root);
  let filed: string | null = null;
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  transact(root, { ...io, quiet: true }, 'new ticket', (dir) => {
    const settings = settingsAt(dir, remote, branch);
    const items = (settings.items ?? 'tickets').replace(/\/$/, '');
    // The project: the flag, else the repository's default, else a refusal — there is no
    // hard-coded default, so `project:` says what the filer meant or nothing at all.
    const project = t.project ?? settings.project;
    if (project == null) throw new Error(`--project is required: this repository names no default project, so name one, or set "project" in .baton/baton.json`);
    projectPage(dir, settings, project);
    const files = readItems(dir, items);
    const read = sourceAt(dir, settings);
    const prefix = `${allocatingPrefix(settings)}-`;
    const id = `${prefix}${nextNumber(files, settings, prefix)}`;
    // The prefix's pattern may name ids `new` cannot allocate (a fixed count, `\d{7}`): it says so
    // rather than write a wrong one.
    if (!allocates(settings, id)) throw new Error(`new allocates ${prefix}<n>, but ${prefix}'s pattern in .baton/baton.json is \`${settings.prefixes[prefix]}\` — write the pattern's number as \\d+, or name another ticket_prefix`);
    for (const dep of deps) {
      if (!accepting(settings, dep)) throw new Error(`--depends-on ${dep} is not a ticket id of this repository — its ids are ${acceptedList(settings)}`);
      if (!read.tickets.some((x) => x.id === dep) && !read.closed.some((x) => x.id === dep)) throw new Error(`--depends-on ${dep}: no such ticket on ${remote}/${branch}`);
    }
    const text = ticketText({ id, title, project, settings, deps, t, date });
    judgeFiling({ id, text, deps, settings });
    // The reverse mentions: each dependency's `**Used by:**` line gains this id, so a file says
    // who waits on it without a search (the generated page's rule).
    const updates = reverseMentions(files, id, deps);
    const after = [...files.filter((f) => !updates.some((u) => u.path === f.path)), ...updates, { path: `${id}.mdx`, text }];
    // The board's own reading of what the commit would leave: one post, validated here rather
    // than by a sync that a broken filing would wedge.
    const posted = ticketsMarkdown(after, { items, repos: readSettingsJson(dir).repos });
    const cycle = dependsCycles(posted.tickets.map((x) => ({ id: x.id, depends_on: x.depends_on ?? [] })))[0];
    if (cycle) throw new Error(`${id}: a dependency cycle: ${cycle.join(' → ')}`);
    try {
      checkPayload({ sha: '0'.repeat(40), parent_sha: null, observation: 1, tickets: posted.tickets, closed: posted.closed });
    } catch (e) {
      throw new Error(`${id}: the board would refuse the filing: ${(e as Error).message}`);
    }
    filed = id;
    return {
      message: `tickets: file ${id} — ${title}`,
      write: [{ path: `${items}/${id}.mdx`, text }, ...updates.map((u) => ({ path: `${items}/${u.path}`, text: u.text }))],
      move: [],
    };
  });
  log(`✓ tickets: file ${filed} — ${title}`);
  return filed!;
}

/** The new ticket's file: frontmatter in the repository's own shape, then the body — `--body-file`
 *  as given, else the skeleton. */
function ticketText(o: { id: string; title: string; project: string; settings: TicketSettings; deps: string[]; t: NewTicket; date: string }): string {
  const { id, title, project, settings, deps, t, date } = o;
  const description = (t.description ?? t.title).replace(/\s+/g, ' ').trim();
  const tags = t.tags ?? settings.tags;
  const body = t.body?.trim() ? t.body.trim() : skeletonBody({ description, deps, ...(t.course ? { course: t.course } : {}), date });
  return [
    '---',
    `title: ${scalar(`${id} — ${title}`)}`,
    `id: ${id}`,
    `project: ${scalar(project)}`,
    'status: available',
    `updated: ${date}`,
    ...(t.repos?.length ? ['repos:', ...t.repos.map((r) => `  - ${scalar(r)}`)] : []),
    'tags:',
    ...tags.map((x) => `  - ${scalar(x)}`),
    `order: ${t.order ?? ORDER_AFTER_LAST}`,
    ...(t.tier ? [`tier: ${scalar(t.tier)}`] : []),
    ...(t.course ? [`course: ${scalar(t.course)}`] : []),
    `description: ${scalar(description)}`,
    'topics:',
    '  - baton',
    'owns: {}',
    'prs: []',
    ...(deps.length ? ['depends_on:', ...deps.map((d) => `  - ${scalar(d)}`)] : ['depends_on: []']),
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** `baton tickets check`'s reading of a filing, before it is pushed: its `**Depends on:**` line
 *  against `depends_on`, both ways, for the ids this repository's — the check's own comparison,
 *  so a filing can never introduce the disagreement the check would report. */
function judgeFiling(o: { id: string; text: string; deps: string[]; settings: TicketSettings }): void {
  const { id, text, deps, settings } = o;
  const named = (dependsLine(text) ?? []).filter((x) => accepts(settings, x));
  const said = deps.length ? deps.join(', ') : 'none';
  for (const dep of named) if (!deps.includes(dep)) throw new Error(`${id}: **Depends on:** names ${dep}, which --depends-on does not (--depends-on names ${said})`);
  for (const dep of deps) if (!named.includes(dep)) throw new Error(`${id}: --body-file's **Depends on:** line does not name ${dep}, which --depends-on names — the two must agree (${said})`);
}

/** The `**Used by:**` lines the filing changes: each dependency's file, with the new id added
 *  once — the reverse mention written at the moment the forward one is. */
function reverseMentions(files: readonly MarkdownFile[], id: string, deps: readonly string[]): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const dep of deps) {
    const file = files.find((f) => idOf(f.text) === dep);
    if (!file) continue;
    const text = reverseMention(file.text, id);
    if (text !== file.text) out.push({ path: file.path, text });
  }
  return out;
}

/** A ticket's text with `id` named on its `**Used by:**` line — added to the names there, or the
 *  line written after the header block when it has none. The skeleton's `nothing yet` gives way
 *  to the first name. */
export function reverseMention(text: string, id: string): string {
  const lines = text.split('\n');
  const at = headerLine(lines, '**Used by:**');
  if (at >= 0) {
    const named = (lines[at].match(/(?<![A-Za-z0-9._-])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-\d+[a-z]?\d*/g) ?? [])
      .filter((n) => n !== id && !/^nothing$/i.test(n) && !/^yet$/i.test(n));
    lines[at] = `**Used by:** ${[...named, id].join(', ')}.`;
    return lines.join('\n');
  }
  // No line: after the other header lines of the opening block — before its first heading or
  // the description that follows it, which is where a reader looks for a header.
  const block = lines.indexOf('');
  const end = block < 0 ? lines.length : block;
  return [...lines.slice(0, end), `**Used by:** ${id}.`, ...lines.slice(end)].join('\n');
}

/** The line index of a `**Label:**` header outside a fenced block, or -1. */
function headerLine(lines: readonly string[], label: string): number {
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && lines[i].startsWith(label)) return i;
  }
  return -1;
}

/** The project page `--project` names: a file anywhere in the items folder's projects/ folder
 *  whose frontmatter carries that `id` and `kind: project`. */
function projectPage(dir: string, settings: TicketSettings, project: string): void {
  const folder = `${(settings.items ?? 'tickets').replace(/\/$/, '')}/${settings.projects}`;
  const abs = join(dir, folder);
  const found = existsSync(abs)
    ? (readdirSync(abs, { recursive: true, withFileTypes: true }) as unknown as { isFile: () => boolean; parentPath: string; name: string }[])
      .filter((e) => e.isFile() && /\.mdx?$/i.test(e.name))
      .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
      .find((text) => idOf(text) === project && /^kind:\s*project\s*$/m.test(text.replace(/\r/g, '')))
    : undefined;
  if (!found) throw new Error(`--project ${project}: no \`kind: project\` page in ${folder}/ — write ${folder}/${project}.mdx (frontmatter \`id: ${project}\`, \`kind: project\`) first, or name a project that is there`);
}

/* ------------------------------------------------------------------------------------------
 * check — B-111's, and the generated page
 * ---------------------------------------------------------------------------------------- */

/** The page's divergence from this release's text, or null when the page is absent (a repository
 *  that has not run `baton repo init` since) or agrees. */
export function pageFinding(root: string, settings: TicketSettings): { path: string; message: string } | null {
  const rel = `${(settings.items ?? 'tickets').replace(/\/$/, '')}/${PAGE_NAME}`;
  if (!existsSync(join(root, rel))) return null;
  return readFileSync(join(root, rel), 'utf8') === ticketsPage(settings)
    ? null
    : { path: rel, message: 'differs from the "How tickets work" page this release generates — `baton repo init --force` writes it again' };
}

/** `baton tickets check [--repo DIR] [--quiet]` (B-111, B-112): B-111's findings, then the
 *  generated page's when it has drifted. One `path: message` line each, then the count; exit 1
 *  with a finding, 0 without; `--quiet` keeps stdout for the exit code alone. */
export async function ticketsCheckMain(argv: string[], io: TicketsIo = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--repo') root = resolve(value());
    else if (a === '--quiet') quiet = true;
    else throw new Error(`${a}: not a flag of baton tickets check`);
  }
  // The settings first: a repository with none has no page to judge, and the check says so.
  const settings = readTicketSettings(root);
  const lines: string[] = [];
  const code = await checkTicketsMain(['--repo', root], { log: (l) => lines.push(l) });
  const page = pageFinding(root, settings);
  const last = lines.pop() ?? '';
  const tickets = Number(/(\d+) ticket\(s\)/.exec(last)?.[1] ?? 0);
  const before = Number(/(\d+) finding\(s\)/.exec(last)?.[1] ?? 0);
  if (page) lines.push(`${page.path}: ${page.message}`);
  const findings = before + (page ? 1 : 0);
  if (!quiet) {
    for (const l of lines) log(l);
    log(findings ? `baton tickets check: ${tickets} ticket(s), ${findings} finding(s)` : `baton tickets check: ${tickets} ticket(s), ✓ no findings`);
  }
  return findings ? 1 : code;
}

/** `baton tickets --help` (B-112): the commands, the tags Baton reads and what each means, and
 *  the `Requires:` clause a description may end with. Printed by `--help`, and by no command. */
export function ticketsHelp(): string[] {
  return [
    'baton tickets new --title T [--description D] [--project ID] [--depends-on A,B] [--tags X,Y]',
    '                   [--tier T] [--order N] [--repos a,b] [--course C] [--body-file F]',
    'baton tickets claim <id>                      available → in-progress',
    'baton tickets set <id> <status> [--pr URL]    any live status; --pr adds a pull request',
    'baton tickets done <id> [--pr URL]            done, moved to archive/',
    'baton tickets check [--repo DIR] [--quiet]    check the tickets without posting them',
    '',
    'Each command is one commit pushed straight to the default branch, made in a throwaway worktree',
    'at the freshly fetched head: your own branch and working tree are never touched, and a push',
    'refused because the branch moved is retried on the new head.',
    '',
    'Settings are .baton/baton.json\'s: items (tickets/), ticket_prefix (B), legacy_ids (id patterns',
    'still accepted, never allocated), project (the default --project), tags (the default --tags,',
    'roadmap-item when it names none) and check.depends_line.',
    '',
    'new writes the conventional body unless --body-file names one — **Brief:**, **Spec:**,',
    '**Depends on:** (from --depends-on; none. when empty), **Used by:**, ### What to build,',
    '### Tests, ### Exit criteria, **Requires:**, ## Status — and judges it as `baton tickets',
    'check` would before pushing, so a filing introduces no cycle and no undeclared dependency.',
    '',
    'The tags Baton reads:',
    ...TAGS.map((t) => `  ${t.tag.padEnd(9)} ${t.means}.`),
    '',
    'The Requires: clause — a description that ends with one, “… Requires: human-operator,',
    "drivable-browser.”, has the capabilities it names written on the new ticket's **Requires:**",
    'line, which is where a runner’s capability requirement lives.',
    '',
    'statuses: available, in-progress, in-review, deprioritized (set); done (done, archived);',
    '          deferred, superseded (set, and closed as withdrawn)',
  ];
}

/** `baton tickets …` (B-112): new, claim, set, done and check. Exit 0 when the command did what
 *  it says, 1 when `check` found something; a refusal throws, which the CLI prints as one
 *  `baton: …` line and exits 2 on. */
export async function ticketsMain(argv: string[], io: TicketsIo = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    for (const line of ticketsHelp()) log(line);
    return 0;
  }
  const [command, ...rest] = argv;
  if (command === 'check') return ticketsCheckMain(rest, io);
  const COMMON = ['repo', 'branch', 'remote'];
  const allowed: Record<string, string[]> = {
    new: ['title', 'description', 'project', 'depends-on', 'tags', 'tier', 'order', 'repos', 'course', 'body-file', ...COMMON],
    claim: COMMON,
    set: ['pr', ...COMMON],
    done: ['pr', ...COMMON],
  };
  if (!allowed[command]) throw new Error(`${command}: baton tickets new|claim|set|done|check (baton tickets --help)`);
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!allowed[command].includes(name)) throw new Error(`${a}: not a flag of baton tickets ${command}`);
      const value = rest[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      flags[name] = value;
    } else positional.push(a);
  }
  const at: TicketsIo = {
    ...io, ...(flags.repo ? { root: resolve(flags.repo) } : {}), ...(flags.branch ? { branch: flags.branch } : {}), ...(flags.remote ? { remote: flags.remote } : {}), log,
  };
  const root = resolve(at.root ?? process.env.BATON_HOME ?? process.cwd());
  if (command === 'new') {
    const deps = (flags['depends-on'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const tags = flags.tags == null ? undefined : flags.tags.split(',').map((x) => x.trim()).filter(Boolean);
    let body: string | undefined;
    if (flags['body-file'] != null) {
      if (!existsSync(flags['body-file'])) throw new Error(`--body-file ${flags['body-file']}: no such file`);
      body = readFileSync(flags['body-file'], 'utf8');
    }
    const order = flags.order == null ? undefined : Number(flags.order);
    if (order != null && !Number.isFinite(order)) throw new Error(`--order ${flags.order} is not a number`);
    const id = newTicket(root, at, {
      title: flags.title ?? '',
      ...(flags.description != null ? { description: flags.description } : {}),
      ...(flags.tier ? { tier: flags.tier } : {}),
      ...(order != null ? { order } : {}),
      ...(flags.repos ? { repos: flags.repos.split(',').map((r) => r.trim()).filter(Boolean) } : {}),
      ...(tags ? { tags } : {}),
      ...(flags.project ? { project: flags.project } : {}),
      ...(deps.length ? { dependsOn: deps } : {}),
      ...(flags.course ? { course: flags.course } : {}),
      ...(body != null ? { body } : {}),
    });
    return 0;
  }
  if (command === 'set' ? positional.length !== 2 : positional.length !== 1) throw new Error(`baton tickets ${command} ${command === 'set' ? '<id> <status>' : '<id>'} [--pr URL]`);
  const status = command === 'claim' ? 'in-progress' : command === 'done' ? 'done' : positional[1];
  if (command === 'set' && status === 'done') throw new Error('done archives a ticket — `baton tickets done <id>`, past this push');
  if (status !== 'done' && !LIVE_STATUSES.includes(status as Status)) throw new Error(`${status} is not a status \`set\` writes — the live ones are ${LIVE_STATUSES.join(', ')}; \`baton tickets done\` archives a ticket`);
  moveTicket(root, at, positional[0], status as Status, flags.pr, command === 'claim');
  return 0;
}
