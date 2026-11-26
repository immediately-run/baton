// tickets.ts — `baton tickets next | check` (B-112, B-326; BATON_SPEC §4.2 R-BTN-74, §4.3
// R-BTN-199): the ticket commands the CLI keeps once Dibber writes every ticket file (the owner,
// 2026-11-24: "the baton cli should not write ticket files, thats dibber's job").
//
// `next` hands out Baton's numbers (sequences.ts) and is Dibber's coordinator command; `check`
// reads the source as a sync does; `check <id> --claimable` reads what a claim must know first —
// Baton's position (B-129), the holders, the dependencies and the rules re-read guard — and
// writes nothing: the claim itself is `dibber claim`. `new`, `claim`, `set` and `done` are
// refused, each naming its `dibber` command (RETIRED).
//
// A refusal is thrown, and the CLI prints it as one `baton: …` line, exit 2 — a finding keeps
// exit 1.
import { git as gitArgs, gitText } from './git.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkTicketsMain } from './tickets-check';
import { accepts, readSettingsJson, readTicketSettings, TAGS, type TicketSettings } from './tickets-config';
import { locate, prsOf } from './tickets-file';
import { PAGE_NAME, ticketsPage } from './tickets-page';
import { readItems } from './read-items';
import { filingDate, firstCommit, historyEntries, rulesConfig, staleIds, staleList, staleRules, unshallow } from './tickets-rules';
import { ticketsMarkdown } from './tickets-markdown';
import { claimMismatch, formatTicket, ticketPathsUnder, ticketPrView } from '../shared/ticketPr.mjs';
import { defaultBranch } from './request';
import { ownRepositoryId } from './remote-slug';
import { builtIn, DEFAULT_COURSE } from './courses';
import { holderRefusal, readDoneTickets, readTicketPosition, Undetermined, type BatonPosition } from './tickets-baton';
import { batonTarget, nextMain } from './sequences';

// B-280: every git call goes through the bounded, prompt-free seam (./git.mjs).
const git = (root: string, ...a: string[]): string => gitText(root, ...a);

const today = (): string => new Date().toISOString().slice(0, 10);

export interface TicketsIo {
  root?: string;
  log?: (line: string) => void;
  warn?: (line: string) => void;
  /** The day the rules guard judges against, for a test's fixed day. */
  date?: string;
  /** The remote (`origin`) and the branch (`origin/HEAD`, else `main`). */
  remote?: string;
  branch?: string;
  /** The key the Baton reads sign with (B-129): `-i KEY`, else `BATON_KEY_FILE`. */
  identity?: string;
  /** Where the Baton reads go (B-129): `--url`, else `BATON_URL`, else `.baton/baton.json`'s
   *  `baton_url`, else the default. */
  url?: string;
  /** `--offline` (B-129): skip the Baton reads — git's word alone, for an unreachable Baton. */
  offline?: boolean;
  /** The fetch the reads use, for a test's stand-in. */
  fetchImpl?: typeof fetch;
}

/** The verbs Dibber took over (B-326), each with the `dibber` command a refusal names. */
export const RETIRED: Readonly<Record<string, string>> = {
  new: 'dibber new --title … --body-file … [--field key=value]… (the number comes from Baton, through .dibber/config.json\'s coordinator)',
  claim: 'baton tickets check <id> --claimable, then dibber claim <id>',
  set: 'dibber set <id> <status> [--pr URL] [--note TEXT] [--field key=value]',
  done: 'dibber done <id> [--pr URL]',
};

/** The message a ticket command's commit lands with (B-16): the command's own message, then the
 *  provenance trailers `TICKET_TRAILERS` holds, after a blank line — the one shape git reads as
 *  trailers, the shape docs' `claim.sh` appends `CLAIM_TRAILERS` in, and the handoff's commit
 *  rule: the agent-provenance trailers, then `Claude-Session` and `Co-Authored-By`. The value is
 *  taken whole — baton computes no trailers of its own and calls nothing to default them
 *  (R3-1268: no `agent-provenance.mjs`, no docs dependency). With `TICKET_REQUIRE_TRAILERS=1` and
 *  the value empty, the message is refused: the agent workflow sets the variable, and a commit
 *  that cannot be attributed is not made. */
export function ticketCommitMessage(message: string, trailers: string, requireTrailers = false): string {
  const lines = trailers.trim();
  if (!lines) {
    if (requireTrailers) throw new Error("TICKET_REQUIRE_TRAILERS=1, but TICKET_TRAILERS is empty — set it to the session's provenance lines (the agent-provenance trailers, then Claude-Session and Co-Authored-By), or unset TICKET_REQUIRE_TRAILERS to commit without them");
    return message;
  }
  return `${message}\n\n${lines}`;
}

/** A ticket's file in a checkout, in the items folder and in its `archive/`: `locate`'s two
 *  names, asked of that checkout's filesystem. */
const fileAt = (dir: string): ((path: string) => boolean) => (path) => existsSync(join(dir, path));

/** The repository's tickets at `dir`, read as the sync reads them: the markdown source over the
 *  items folder, its `repos` short names resolved through `.baton/baton.json`'s map. */
const sourceAt = (dir: string, settings: TicketSettings) =>
  ticketsMarkdown(readItems(dir, settings.items ?? 'tickets'), { items: settings.items, repos: readSettingsJson(dir).repos });

const acceptedList = (settings: TicketSettings): string => Object.keys(settings.prefixes).sort().map((p) => `${p}…`).join(', ');

/* ------------------------------------------------------------------------------------------
 * check <id> --claimable
 * ---------------------------------------------------------------------------------------- */

/** What `check <id> --claimable` found: the reason the ticket is not claimable, or the claim to
 *  make and, for a takeover, Baton's position. */
export type Claimable = { claimable: false; why: string } | { claimable: true; lines: string[] };

/** Judge, at checkout `dir` (the fetched default head), whether `id` may be claimed — what
 *  `baton tickets claim` refused before it wrote, read-only now (B-326; B-129 *Ask Baton first*).
 *  Another live claim on the ticket or its branch refuses; a ticket not `available` in git
 *  refuses, Baton's position past its course's start overriding only a false `available` —
 *  never the git lock (`in-progress`, `in-review`) nor a parked or closed status; an undone
 *  dependency refuses, a takeover included; and a ticket citing a rule the spec's history
 *  amended after the ticket answered for it refuses until a `rules re-read` note names the ids.
 *  Claimable, the lines say what to run: `dibber claim <id>`, and for a takeover the station,
 *  the ready leg, each PR Baton's record holds (with the `dibber set` that writes one the file
 *  lacks) and each branch to continue on. */
export function judgeClaim(dir: string, o: { id: string; baton: BatonPosition | null; date: string; remote: string }): Claimable {
  const { id, baton, date, remote } = o;
  const no = (why: string): Claimable => ({ claimable: false, why });
  // The lock Baton holds (B-129): a live claim belongs to its holder until it is released or
  // reaped, whatever the frontmatter says — the takeover and the fresh claim alike.
  if (baton != null) {
    const holder = baton.holders.find((h) => h.ticket_id.endsWith(`:${id}`));
    if (holder) return no(holderRefusal(id, holder, baton.serverTime));
    if (baton.branch && 'held_by_other' in baton.branch) {
      if (baton.branch.held_by_other) return no(`${id}'s branch ${baton.branch.branch} is held by another live claim (Baton's branch-holder query) — the branch maps to ${baton.branch.tickets.join(', ')}`);
      if (baton.branch.fence_pending) return no(`${id}'s branch ${baton.branch.branch} has a reaped claim still fence-pending (Baton's branch-holder query)`);
    }
  }
  const settings = readTicketSettings(dir);
  if (!accepts(settings, id)) throw new Error(`${id} is not a ticket id of this repository — its ids are ${acceptedList(settings)}`);
  const items = (settings.items ?? 'tickets').replace(/\/$/, '');
  const found = locate(items, id, fileAt(dir));
  if (!found) throw new Error(`${id}: no ${items}/${id}.mdx on the default branch`);
  if (found.archived) return no(`${id} is archived (done)`);
  const text = readFileSync(join(dir, found.path), 'utf8');
  const read = sourceAt(dir, settings);
  const current = read.tickets.find((t) => t.id === id)?.display?.status ?? 'closed';
  // A takeover continues the ticket where Baton holds it (B-129). Baton's position overrides
  // only a false `available` — the hurried release's word, the case this exists for; it never
  // overrides the git lock (a session holding the ticket through git, which Baton cannot see)
  // nor a parked or closed status (an owner's or a filer's deliberate word).
  const takeover = baton?.pastStart === true;
  if (current !== 'available') {
    if (takeover && (current === 'in-progress' || current === 'in-review')) {
      return no(`${id} is ${current} in git — a git-lock holder may hold it; Baton's position (${baton!.station ?? 'past its start'}) overrides only a false available, never the git lock`);
    }
    if (takeover) return no(`${id} is ${current} in git — parked or closed; Baton's position (${baton!.station ?? 'past its start'}) overrides only a false available`);
    return no(`${id} is ${current}, not available — someone may hold it${baton == null ? ' (--offline: Baton was not asked)' : ''}`);
  }
  // The dependencies are judged for a takeover too: a dependency reopened since the first
  // claim is still open work the ticket waits on.
  const open = (read.tickets.find((t) => t.id === id)?.depends_on ?? []).filter((dep) => !isDone(dir, settings, dep));
  if (open.length) return no(`${id} depends on ${open.join(', ')}, not done yet`);
  // The rules the ticket cites that were amended after it answered for them: read at the head,
  // the ticket dated by its `_filed` line, else its file's first commit there — a shallow clone
  // is deepened first, since its boundary commit would date every file.
  const rules = rulesConfig((readSettingsJson(dir) as { check?: { rules?: unknown } }).check);
  const history = join(dir, rules.history);
  if (existsSync(history)) {
    let filed = filingDate(text, firstCommit(dir, found.path), date);
    if ('undetermined' in filed) {
      const why = unshallow(dir, remote);
      if (why) throw new Error(`${id}: this clone is shallow, so the day ${found.path} was filed cannot be read, and \`git fetch --unshallow ${remote}\` failed (${why}) — deepen the clone (\`git fetch --unshallow\`, or clone without --depth), then check again`);
      filed = filingDate(text, firstCommit(dir, found.path), date);
    }
    const since = 'date' in filed ? filed.date : date;
    const stale = staleRules(text, since, historyEntries(readFileSync(history, 'utf8')), rules.prefix);
    if (stale.length) {
      return no([
        `${id} cites rules that ${rules.history} amended after the ticket answered for them (filed ${since}, or a later rules re-read note naming the rule):`,
        staleList(stale),
        `Re-read each rule and entry, rewrite or strike what in the ticket they contradict, then record it — dibber set ${id} --note "rules re-read: ${staleIds(stale).join(', ')}" — and check again.`,
      ].join('\n'));
    }
  }
  const lines: string[] = [];
  if (takeover) {
    const at = baton!;
    lines.push(`${id}: Baton holds it${at.ready ? ` at ${at.ready.station}, ${at.ready.leg} ready` : at.station ? ` at ${at.station}` : ' past its course\'s start'} — you are taking it over, not starting it`);
    const had = prsOf(text);
    for (const p of [...new Set([...had, ...(at.resume?.prs ?? [])])]) lines.push(`  PR: ${p}${had.includes(p) ? '' : ` — Baton's record holds it and the file does not: dibber set ${id} --pr ${p}`}`);
    for (const b of at.resume?.branches ?? []) lines.push(`  branch: ${b} — continue on it, never \`checkout -b\` a new one`);
    if (at.resume) lines.push(`  hand-off: ${at.resume.end_reason} ${new Date(at.resume.ended_at).toISOString()} — read it: git log -1 ${found.path}`);
  }
  lines.push(`${id}: claimable${baton == null ? ' on git\'s word alone (--offline: Baton\'s position is unknown, not refuted)' : ''} — claim it with: dibber claim ${id}`);
  return { claimable: true, lines };
}

/** `baton tickets check <id> --claimable [-i KEY] [--url URL] [--offline]` (B-326): Baton's
 *  position read first (B-129) — an unanswered read refuses (exit 2) unless `--offline` — then
 *  `judgeClaim` at the freshly fetched default head, in a throwaway worktree: the caller's
 *  branch and tree are never read for it, nor anything written. Exit 0 claimable, 1 not. */
export async function claimableMain(root: string, id: string, io: TicketsIo): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let baton: BatonPosition | null = null;
  if (!io.offline) {
    const target = batonTarget(root, io);
    if (target.keyFile == null) throw new Error(`${id}: the check reads Baton's record of the ticket first (B-129) — pass -i KEY (or set BATON_KEY_FILE), or --offline to judge git's word alone`);
    if (target.repository == null) throw new Error(`${id}: this checkout's origin names no Baton repository (no repos entry in .baton/baton.json matches it, and it has no owner/name) — pass --offline to judge git's word alone`);
    try {
      baton = await readTicketPosition({ url: target.url, keyFile: target.keyFile, repository: target.repository, ticket: id, forgePath: target.forgePath, start: courseStart(root, id), ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}) });
    } catch (e) {
      // Undetermined, not "no record" (B-129): the frontmatter is never the fallback. A key
      // problem is the key's, named as such — Baton was never asked.
      if (e instanceof Undetermined && e.which === 'the key') throw new Error(`${id}: ${e.why} — the reads cannot be signed, so Baton was not asked; pass -i KEY (or BATON_KEY_FILE) naming a readable key, or --offline to judge git's word alone`);
      throw new Error(`${id}: ${(e as Error).message} — Baton's answer is undetermined; pass --offline to judge git's word alone`);
    }
  }
  const remote = io.remote ?? 'origin';
  const branch = io.branch ?? defaultBranch(root);
  git(root, 'fetch', '-q', remote, branch);
  const dir = mkdtempSync(join(tmpdir(), 'baton-claimable-'));
  try {
    git(root, 'worktree', 'add', '-q', '--detach', dir, 'FETCH_HEAD');
    const verdict = judgeClaim(dir, { id, baton, date: io.date ?? today(), remote });
    if (!verdict.claimable) {
      log(`${id}: not claimable — ${verdict.why}`);
      return 1;
    }
    for (const l of verdict.lines) log(l);
    return 0;
  } finally {
    try {
      git(root, 'worktree', 'remove', '--force', dir);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Whether `id` is done, for a claim's dependency (`judgeClaim`): archived, or a live file whose `status:` is
 * `done` or `superseded` — the ticket's rule. `deferred` and `withdrawn` are closed but not
 * done: a deferred dependency keeps the claim waiting.
 *
 * B-113: a qualified id (`baton:B-111`) names another repository's ticket, resolved through the
 * `repos` map of the head the claim lands on — the short name's forge path is the git remote to
 * read (`owner/name` stands for `https://github.com/<owner/name>`; a value that already names a
 * remote — a URL or a path — is used as written). The target's default branch is read at depth
 * 1 in a throwaway clone, its own `.baton/baton.json` naming its items folder, and the same
 * rule decides there: archived, or live `done`/`superseded`. The claim is git-only here — no
 * forge, no Baton — so what git holds is what there is; a dependency the target does not hold
 * refuses the claim naming it, as the board post would (§4.4).
 *
 * The posting repository's own id spelled qualified (`baton:B-1` in baton's own checkout,
 * §3.1) is the local id's own dependency read as itself: this checkout's archive and status
 * answer it, never a depth-1 clone of the repository's own remote — so an `--offline` claim
 * carrying one stays offline (round 1). */
function isDone(dir: string, settings: TicketSettings, id: string): boolean {
  const own = id.includes(':') ? ownRepositoryId(dir, readSettingsJson(dir).repos ?? {}) : null;
  if (own != null && id.startsWith(`${own}:`)) return isDoneLocal(dir, settings, id.slice(own.length + 1));
  if (id.includes(':')) return isDoneElsewhere(dir, id);
  return isDoneLocal(dir, settings, id);
}

/** `isDone`'s local half: this checkout's items folder, its archive and its live statuses. */
function isDoneLocal(dir: string, settings: TicketSettings, id: string): boolean {
  const items = (settings.items ?? 'tickets').replace(/\/$/, '');
  const found = locate(items, id, fileAt(dir));
  if (!found) return false;
  if (found.archived) return true;
  const status = /^status:[ \t]*["']?([A-Za-z-]+)["']?[ \t]*$/m.exec(readFileSync(join(dir, found.path), 'utf8'))?.[1];
  return status === 'done' || status === 'superseded';
}

/** The remote a `repos` map entry names: a forge path `owner/name` is GitHub's, as the map has
 *  always read it (tickets-markdown resolves `repos:` the same way); anything that already names
 *  a remote — `https://…`, `ssh://…`, `git@…`, `file://…`, an absolute or relative path — is the
 *  remote as written, so a test (or an off-forges setup) points the name at a repository it
 *  holds. */
export function dependencyRemote(map: Record<string, string>, repository: string): string {
  const path = map[repository];
  if (path == null) throw new Error(`${repository}: the baton.json repos map does not resolve it — a qualified dependency names a repository the map knows (B-113)`);
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|git@|[.\\/])/.test(path) ? path : `https://github.com/${path}`;
}

/** A qualified dependency's own half, read from the target repository's default branch at
 *  depth 1: its `.baton/baton.json` names the items folder; the ticket is done when archived
 *  there or live `done`/`superseded` (the same rule `isDone` holds here). */
function isDoneElsewhere(dir: string, id: string): boolean {
  const at = id.indexOf(':');
  const repository = id.slice(0, at);
  const local = id.slice(at + 1);
  const remote = dependencyRemote(readSettingsJson(dir).repos ?? {}, repository);
  const clone = mkdtempSync(join(tmpdir(), 'baton-dep-'));
  try {
    gitArgs(null, ['clone', '-q', '--depth', '1', '--', remote, clone], { stdio: ['ignore', 'ignore', 'pipe'] });
    const items = ((JSON.parse(readFileSync(join(clone, '.baton', 'baton.json'), 'utf8')) as { items?: string }).items ?? 'tickets').replace(/\/$/, '');
    const found = locate(items, local, (path) => existsSync(join(clone, path)));
    if (!found) throw new Error(`depends_on names ${id}, which is neither live nor archived on ${remote} (B-113)`);
    if (found.archived) return true;
    const status = /^status:[ \t]*["']?([A-Za-z-]+)["']?[ \t]*$/m.exec(readFileSync(join(clone, found.path), 'utf8'))?.[1];
    return status === 'done' || status === 'superseded';
  } catch (e) {
    // git's own words for an unreachable remote ride along (a clone that cannot answer names
    // the remote, never the map's reading of it).
    if (e instanceof Error && e.message.includes('(B-113)')) throw e;
    const err = e as { stderr?: string | Uint8Array; message?: string };
    const why = typeof err.stderr === 'string' ? err.stderr : err.stderr ? new TextDecoder().decode(err.stderr) : (err.message ?? String(e));
    throw new Error(`${id}: the dependency's repository ${remote} could not be read (${why.split('\n').filter(Boolean).at(-1) ?? 'git failed'}) — the claim waits on the dependency, and git is the claim's only word here (B-113)`);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

/** Where the ticket commands' Baton reads go (B-129): moved to sequences.ts, beside the
 *  sequence reads that share it — re-exported for the tests that import it from here. */
export { batonTarget } from './sequences';

/** The course's `start` station (B-129): the ticket's `course:`, else the repository's
 *  `default_course`, else `create-pr` — from the checkout's own `.baton/courses/<course>/course.json`, else, with no such
 *  file (a sourced course, a repository with no course code), the standard course's file in
 *  `courses.ts`. Null only for a course that is neither, whose takeover is then undetermined. */
export function courseStart(root: string, id: string): string | null {
  try {
    const settings = readTicketSettings(root);
    const items = (settings.items ?? 'tickets').replace(/\/$/, '');
    const found = locate(items, id, (path) => existsSync(join(root, path)));
    const text = found ? readFileSync(join(root, found.path), 'utf8') : null;
    const json = readSettingsJson(root);
    const course = text ? ticketsMarkdown([{ path: found!.path, text }], { items, repos: json.repos, default_course: json.default_course }).tickets[0]?.course_id : undefined;
    const name = String(course ?? json.default_course ?? DEFAULT_COURSE);
    const file = join(root, '.baton', 'courses', name, 'course.json');
    const start = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { start?: unknown }).start : builtIn(name)?.course.start;
    return typeof start === 'string' ? start : null;
  } catch {
    return null;
  }
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

/** `baton tickets check [--repo DIR] [--pr BASE [--claimed-status-only] [--forge FILE]]
 *  [--quiet]` (B-111, B-112, B-133): B-111's findings, then the generated page's when it has
 *  drifted, then — with `--pr` — the machine-computed view of what this checkout changes in the
 *  tickets against `BASE` (the merge-base): which tickets change, which frontmatter fields
 *  (control fields named), whether a body or brief changed (with a bounded diff), each path's
 *  commits, and the computed status-only label. `--claimed-status-only` — set by CI when the
 *  PR's own description says "status-only" — CHECKS that claim against the computation, and a
 *  mismatch is a finding: the label is the check's, never the description's (B-133).
 *  `--forge FILE` — built by CI from the forge API — adds the forge's reading of each commit
 *  (the accounts the commit's author and committer emails map to — email-derived, steered by
 *  the commit's writer exactly as git's own names are, and labelled as such — and the signature
 *  verification) beside git's, which is labelled as git's: anyone sets an author or committer
 *  (B-126). One `path: message` line each, then the count; exit 1 with a finding, 0 without;
 *  `--quiet` keeps stdout for the exit code alone. */
export async function ticketsCheckMain(argv: string[], io: TicketsIo = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  let quiet = false;
  let prBase: string | null = null;
  let claimedStatusOnly = false;
  let forgePath: string | null = null;
  let offline = io.offline;
  let identity = io.identity;
  let url = io.url;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--repo') root = resolve(value());
    else if (a === '--quiet') quiet = true;
    else if (a === '--pr') prBase = value();
    else if (a === '--claimed-status-only') claimedStatusOnly = true;
    else if (a === '--forge') forgePath = value();
    else if (a === '--offline') offline = true;
    else if (a === '-i') identity = value();
    else if (a === '--url') url = value();
    else throw new Error(`${a}: not a flag of baton tickets check`);
  }
  // The settings first: a repository with none has no page to judge, and the check says so.
  const settings = readTicketSettings(root);
  const lines: string[] = [];
  const target = quiet || offline ? null : batonTarget(root, { identity, url });
  const { keyFile, repository, url: boardUrl } = target ?? {};
  const code = await checkTicketsMain(['--repo', root], {
    log: (l) => lines.push(l),
    ...(keyFile && repository && boardUrl ? { boardDone: () => readDoneTickets({ url: boardUrl, keyFile, repository, fetchImpl: io.fetchImpl }) } : {}),
  });
  const page = pageFinding(root, settings);
  const last = lines.pop() ?? '';
  const tickets = Number(/(\d+) ticket\(s\)/.exec(last)?.[1] ?? 0);
  const before = Number(/(\d+) finding\(s\)/.exec(last)?.[1] ?? 0);
  if (page) lines.push(`${page.path}: ${page.message}`);
  const findings = before + (page ? 1 : 0) + ticketPrFindings(root, settings, prBase, claimedStatusOnly, forgePath, lines);
  if (!quiet) {
    for (const l of lines) log(l);
    log(findings ? `baton tickets check: ${tickets} ticket(s), ${findings} finding(s)` : `baton tickets check: ${tickets} ticket(s), ✓ no findings`);
  }
  return findings ? 1 : code;
}

/** B-133: the ticket-PR view against `base`, as `baton tickets check --pr` prints it, and the
 *  finding when a PR's own description claims what the computation contradicts. The view is the
 *  shared library's (src/shared/ticketPr.mjs, R-BTN-37);
 *  git is read here. Returns how many findings it added; every line it prints goes to `lines`. */
function ticketPrFindings(root: string, settings: TicketSettings, base: string | null, claimedStatusOnly: boolean, forgePath: string | null, lines: string[]): number {
  if (base == null) return 0;
  // Trimmed stdout for shas, paths and logs; RAW for `show` — a file's bytes are the view's
  // input, and a trimmed trailing newline would read as a body change.
  const run = (...a: string[]): string => gitText(root, ...a);
  const raw = (...a: string[]): string => gitArgs(root, a);
  let mergeBase: string;
  try {
    mergeBase = run('merge-base', base, 'HEAD');
  } catch (e) {
    lines.push(`ticket-pr: cannot resolve a merge-base with ${base} — is it fetched? (git fetch origin) (${gitStderr(e)})`);
    return 1;
  }
  // NUL-separated with quoting off: a path with a non-ASCII byte, `"` or `\` is emitted QUOTED
  // by git's default settings, fails the prefix test and so hides from the computed view — the
  // exact failure B-133 exists to prevent.
  const paths = ticketPathsUnder(settings.items ?? 'tickets', gitArgs(root, ['-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', '-z', mergeBase]).split('\0').filter(Boolean));
  const read = (rev: string, path: string): string | undefined => {
    try {
      return raw('show', `${rev}:${path}`);
    } catch {
      return undefined; // not there at that revision
    }
  };
  const baseFiles: Record<string, string | undefined> = {};
  const headFiles: Record<string, string | undefined> = {};
  // The forge's reading of the PR's commits (B-126), when CI built it. A malformed file is a
  // loud one-line refusal naming --forge, never a silent fallthrough that would show git's
  // reading as the only one over a file the caller did pass (round two's finding — docs'
  // readForge shape).
  type ForgeFile = { pr_author: string; commits: Record<string, import('../shared/ticketPr.mjs').TicketForge> };
  let forge: ForgeFile | null = null;
  if (forgePath != null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(forgePath, 'utf8'));
    } catch (e) {
      throw new Error(`--forge ${forgePath} does not parse (${(e as Error).message})`);
    }
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { pr_author?: unknown }).pr_author !== 'string' || typeof (parsed as { commits?: unknown }).commits !== 'object') {
      throw new Error(`--forge ${forgePath} is not {"pr_author": "…", "commits": {"<sha>": {author, committer}}}`);
    }
    forge = parsed as ForgeFile;
  }
  const provenance: Record<string, import('../shared/ticketPr.mjs').TicketProvenance[]> = {};
  for (const p of paths) {
    baseFiles[p] = read(mergeBase, p);
    headFiles[p] = existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined;
    // B-126's direction: git's reading — authors AND committers, since anyone sets an author —
    // labelled as git's, with the forge's reading of each commit beside it when CI passed one:
    // the account the commit's author and committer EMAILS map to (email-derived, printed as
    // such) and its signature verification.
    provenance[p] = run('log', `${mergeBase}..HEAD`, '--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%aI', '--', p)
      .split('\n').filter(Boolean).map((row) => {
        const [sha, author, committer, date] = row.split('\x1f');
        return { sha, author, committer, date, ...(forge?.commits?.[sha] ? { forge: forge.commits[sha] } : {}) };
      });
  }
  const view = ticketPrView({ items: settings.items ?? 'tickets', base: baseFiles, head: headFiles, provenance });
  lines.push(`ticket-pr (B-133): ${view.changed.length} ticket file(s) changed against ${base} (${mergeBase.slice(0, 10)})`);
  if (!view.changed.length) lines.push('  no ticket changes — the status-only label does not apply');
  else {
    // "Beside the forge's" is keyed on the forge's reading EXISTING — at least one commit: a
    // passed file naming no commit (a failed API call) degrades to git's reading alone; the
    // forge's name is never printed over nothing (round two's finding).
    const forgeRead = forge != null && Object.keys(forge.commits).length > 0 ? forge : null;
    lines.push(forgeRead
      ? `  provenance: git's reading beside the forge's — the PR is opened by ${forgeRead.pr_author} (B-126)`
      : "  provenance: git's reading — anyone sets an author or committer; the forge's reading is not read here (B-126)");
    for (const c of view.changed) for (const l of formatTicket(c)) lines.push(l);
    lines.push(`status-only: ${view.statusOnly ? 'yes — only status fields changed; no body, brief or control field' : `no — ${view.reasons.join('; ')}`}`);
  }
  const mismatch = claimMismatch(view, claimedStatusOnly);
  if (mismatch) lines.push(`ticket-pr: the PR is ${mismatch} — the label is this check's computation (B-133), never the PR's own description`);
  return mismatch ? 1 : 0;
}

/** git's own complaint from a failed execFileSync, for the one-line refusal the check prints. */
function gitStderr(e: unknown): string {
  const stderr = (e as { stderr?: Buffer })?.stderr;
  return (stderr ? String(stderr) : String(e)).trim();
}

/** `baton tickets --help` (B-112): the commands, the tags Baton reads and what each means, and
 *  the `Requires:` clause a description may end with. Printed by `--help`, and by no command. */
export function ticketsHelp(): string[] {
  return [
    'baton tickets next <kind> [--for <ticket>] [-i KEY] [--url URL] [--remote R] [--offline | --coordinator]',
    '                   rule | scenario | gate | migration | ticket[-<prefix>]: the next number of',
    '                   that sequence, taken from Baton (R-BTN-199) — what a PR takes a migration',
    '                   number or a scenario id from; --offline prints the next free by the scan;',
    '                   --coordinator prints Baton\'s number alone or refuses, never scanning: the',
    '                   command .dibber/config.json\'s coordinator names (B-326)',
    'baton tickets check [--repo DIR] [--quiet]    check the tickets without posting them',
    '  With -i KEY or BATON_KEY_FILE, report live files for board-done tickets; --offline skips this read.',
    '                   --pr BASE [--claimed-status-only] [--forge FILE]',
    '                                                  also print the computed ticket-PR view',
    '                   against BASE (fields, body and brief diffs, provenance, the status-only',
    '                   label); with the claim flag — set by CI when the PR body claims it on a',
    '                   line of its own — a PR whose diff contradicts the claim is a finding',
    '                   (B-133: the label is the check\'s, never the description\'s); --forge,',
    '                   built by CI from the forge API, adds the forge\'s reading of each commit',
    '                   beside git\'s (B-126)',
    'baton tickets check <id> --claimable [-i KEY] [--url URL] [--offline]',
    '                   what a claim must know first, writing nothing (B-326): exit 0 and the',
    '                   claim to make (dibber claim <id>), 1 and why not',
    '',
    'Ticket files are Dibber\'s to write (B-326): file a ticket with `dibber new` — its number',
    'comes from Baton through .dibber/config.json\'s coordinator, which `baton repo init` writes —',
    'and write a status with `dibber claim | set | done`. `baton tickets new | claim | set | done`',
    'are refused, each naming its dibber command.',
    '',
    'check --claimable asks Baton first (B-129): it reads the ticket from Baton with the key -i',
    'names (or BATON_KEY_FILE) — the board for the station and ready leg, the history for the path,',
    'the branch-holder query for the branch — and judges the ticket at the freshly fetched default',
    'head. A ticket past its course\'s start that git says available is a takeover: it prints the',
    'station, the ready leg, every PR Baton\'s record holds and each branch to continue on. Baton',
    'overrides only a false available: in-progress or in-review in git (the git lock) and a parked',
    'or closed status are not claimable, nor are undone dependencies, another live claim, or a',
    'ticket citing a rule amended since it answered for it until a rules re-read note names the ids',
    '(dibber set <id> --note "rules re-read: <ids>"). An unanswered read exits 2; --offline judges',
    'git\'s word alone.',
    '',
    'Settings are .baton/baton.json\'s: items (tickets/), ticket_prefix (B), legacy_ids (id patterns',
    'still accepted, never allocated), check.depends_line, check.sections_since (the day from which a',
    'filed ticket must carry ### Trust and ### Invariants, filled), check.sections_from_id (the first id',
    'that must carry a _filed line, so a shallow clone judges it) and check.rules ({history, prefix}: where the',
    'amendments the check reads are; spec/BATON_SPEC_HISTORY.md and R-BTN unless set).',
    '',
    'The tags Baton reads:',
    ...TAGS.map((t) => `  ${t.tag.padEnd(9)} ${t.means}.`),
    '',
    'The Requires: clause — a description that ends with one, “… Requires: human-operator,',
    "drivable-browser.”, has the capabilities it names written on the new ticket's **Requires:**",
    'line, which is where a runner\'s capability requirement lives.',
    '',
    'statuses: available, in-progress, in-review, deprioritized (set); done (done, archived);',
    '          deferred, superseded (set, and closed as withdrawn)',
  ];
}

/** `baton tickets …` (B-112, B-326): `next` and `check`, and the retired verbs' refusals. Exit 0
 *  when the command did what it says, 1 when `check` found something; a refusal throws, which
 *  the CLI prints as one `baton: …` line and exits 2 on. */
export async function ticketsMain(argv: string[], io: TicketsIo = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    for (const line of ticketsHelp()) log(line);
    return 0;
  }
  const [command, ...rest] = argv;
  if (RETIRED[command]) throw new Error(`baton tickets ${command} is retired — ticket files are Dibber's to write (B-326): ${RETIRED[command]}`);
  if (command === 'check') {
    const at = rest.indexOf('--claimable');
    if (at < 0) return ticketsCheckMain(rest, io);
    return claimableArgs(rest.filter((_, i) => i !== at), io);
  }
  // B-176 (R-BTN-199): the sequence numbers, for a PR author, an agent and Dibber's coordinator.
  if (command === 'next') return nextMain(rest, io);
  throw new Error(`${command}: baton tickets next|check (baton tickets --help)`);
}

/** `check <id> --claimable`'s own flags: `-i KEY`, `--url`, `--offline`, `--repo`, `--branch`,
 *  `--remote`. */
async function claimableArgs(argv: string[], io: TicketsIo): Promise<number> {
  const positional: string[] = [];
  const at: TicketsIo = { ...io };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '-i') at.identity = value();
    else if (a === '--url') at.url = value();
    else if (a === '--offline') at.offline = true;
    else if (a === '--repo') at.root = resolve(value());
    else if (a === '--branch') at.branch = value();
    else if (a === '--remote') at.remote = value();
    else if (a.startsWith('-')) throw new Error(`${a}: not a flag of baton tickets check --claimable`);
    else positional.push(a);
  }
  if (positional.length !== 1) throw new Error('baton tickets check <id> --claimable [-i KEY] [--url URL] [--offline]');
  const root = resolve(at.root ?? process.env.BATON_HOME ?? process.cwd());
  return claimableMain(root, positional[0], at);
}
