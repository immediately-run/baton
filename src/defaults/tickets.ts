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
import { addPr, idOf, locate, nextNumber, prsOf, scalar, setKey } from './tickets-file';
import { PAGE_NAME, ticketsPage } from './tickets-page';
import { readItems } from './read-items';
import { appendStatus, filingDate, firstCommit, historyEntries, rereadMismatch, rereadNote, rulesConfig, sectionGaps, sectionHint, sectionsSince, staleIds, staleList, staleRules, unshallow } from './tickets-rules';
import { ticketsMarkdown, type MarkdownFile } from './tickets-markdown';
import { claimMismatch, formatTicket, ticketPathsUnder, ticketPrView } from '../shared/ticketPr.mjs';
import { defaultBranch } from './request';
import { DEFAULT_URL } from '../../cli/baton.mjs';
import { remoteSlug } from './cli';
import { builtIn, DEFAULT_COURSE } from './courses';
import { holderRefusal, readTicketPosition, Undetermined, type BatonPosition } from './tickets-baton';

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
  const branch = io.branch ?? defaultBranch(root);
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

/** `baton tickets claim <id>` (B-129: Baton first) — available → in-progress, refusing a ticket
 *  that is not available or whose `depends_on` are not all done (archived, or a live closed
 *  status); a ticket Baton holds past its course's start is claimed as a **takeover**: Baton's
 *  position overrides only a false `available` — the git lock (`in-progress`, `in-review`) and
 *  a parked or closed status still refuse, and so do undone dependencies — every `prs:` entry is
 *  kept and any Baton knows is written back, and the session starts from Baton's position — the
 *  station, the ready leg, the PRs, the branch and the hand-off. Another live claim refuses,
 *  naming its holder and its lease. `baton tickets set <id> <status> [--pr URL] [--note TEXT]` —
 *  any live status, as the session that left it; a release (`set <id> available`) keeps every
 *  `prs:` entry and its commit carries the hand-off (the PRs, Baton's station and next leg, the
 *  branch, and `--note`'s "what is left"). `baton tickets done <id> [--pr URL]` — done, and the
 *  file moved to `archive/`. `claim` is the one that refuses: it is the lock, and `set` is the
 *  session keeping its own ticket's word.
 *  `claim` also refuses a ticket that cites a rule the spec's history amended after the ticket
 *  answered for it (filed, or re-read), unless `--rules-reread` names exactly those ids, saying the
 *  claimer re-read them, which the claim's commit records as a dated Status line (tickets-rules.ts;
 *  the 2026-11-03 process guards). */
export function moveTicket(root: string, io: TicketsIo, id: string, status: Status, pr?: string, claim = false, baton: BatonPosition | null = null, note?: string, rulesReread?: readonly string[]): void {
  if (pr != null && !GITHUB_PR.test(pr)) throw new Error(`--pr ${pr} is not a GitHub pull request URL`);
  const date = io.date ?? today();
  const remote = io.remote ?? 'origin';
  const branch = io.branch ?? defaultBranch(root);
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  // What the takeover prints once the commit is pushed: the PRs the written file carries and
  // where its file is, set inside the change and read here (the cast keeps the narrowable type —
  // the change sets it inside the worktree callback).
  let pushed = null as { prs: string[]; path: string } | null;
  // The lock Baton holds (B-129): a live claim belongs to its holder until it is released or
  // reaped, whatever the frontmatter says — the takeover and the fresh claim alike.
  if (claim && baton != null) {
    const holder = baton.holders.find((h) => h.ticket_id.endsWith(`:${id}`));
    if (holder) throw new Error(holderRefusal(id, holder, baton.serverTime));
    if (baton.branch && 'held_by_other' in baton.branch) {
      if (baton.branch.held_by_other) throw new Error(`${id}'s branch ${baton.branch.branch} is held by another live claim (Baton's branch-holder query) — the branch maps to ${baton.branch.tickets.join(', ')}`);
      if (baton.branch.fence_pending) throw new Error(`${id}'s branch ${baton.branch.branch} has a reaped claim still fence-pending (Baton's branch-holder query)`);
    }
  }
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
    // A takeover continues the ticket where Baton holds it (B-129). Baton's position overrides
    // only a false `available` — the hurried release's word, the case this exists for; it never
    // overrides the git lock (a session holding the ticket through git, which Baton cannot see)
    // nor a parked or closed status (an owner's or a filer's deliberate word).
    const takeover = claim && baton?.pastStart === true;
    if (status === 'in-progress' && current !== 'available') {
      if (takeover && (current === 'in-progress' || current === 'in-review')) {
        throw new Error(`${id} is ${current} in git — a git-lock holder may hold it; Baton's position (${baton!.station ?? 'past its start'}) overrides only a false available, never the git lock`);
      }
      if (takeover) throw new Error(`${id} is ${current} in git — parked or closed; Baton's position (${baton!.station ?? 'past its start'}) overrides only a false available`);
      throw new Error(`${id} is ${current}, not available — someone may hold it${baton == null ? ' (claimed with --offline: Baton was not asked)' : ''}`);
    }
    // The dependencies are judged for a takeover too: a dependency reopened since the first
    // claim is still open work the ticket waits on.
    if (status === 'in-progress') {
      const open = (read.tickets.find((t) => t.id === id)?.depends_on ?? []).filter((dep) => !isDone(dir, settings, dep));
      if (open.length) throw new Error(`${id} depends on ${open.join(', ')}, not done yet`);
    }
    // The rules the ticket cites that were amended after it answered for them: read at the head
    // the claim lands on, the ticket dated by its `_filed` line, else its file's first commit there
    // — a shallow clone is deepened first, since its boundary commit would date every file.
    let rereadLine: string | null = null;
    if (status === 'in-progress') {
      const rules = rulesConfig((readSettingsJson(dir) as { check?: { rules?: unknown } }).check);
      const history = join(dir, rules.history);
      if (existsSync(history)) {
        let filed = filingDate(text, firstCommit(dir, found.path), date);
        if ('undetermined' in filed) {
          const why = unshallow(dir, remote);
          if (why) throw new Error(`${id}: this clone is shallow, so the day ${found.path} was filed cannot be read, and \`git fetch --unshallow ${remote}\` failed (${why}) — deepen the clone (\`git fetch --unshallow\`, or clone without --depth), then claim again`);
          filed = filingDate(text, firstCommit(dir, found.path), date);
        }
        const since = 'date' in filed ? filed.date : date;
        const stale = staleRules(text, since, historyEntries(readFileSync(history, 'utf8')), rules.prefix);
        if (stale.length && !rulesReread) {
          throw new Error([
            `${id} cites rules that ${rules.history} amended after the ticket answered for them (filed ${since}, or a later rules re-read note naming the rule):`,
            staleList(stale),
            `Re-read each rule and entry, rewrite or strike what in the ticket they contradict, then claim with --rules-reread ${staleIds(stale).join(',')}.`,
          ].join('\n'));
        }
        // The re-read names exactly the stale ids: a claimer who re-read them can list them, and
        // one passing the flag by reflex is told which they did not.
        const mismatch = rulesReread ? rereadMismatch(rulesReread, stale) : null;
        if (mismatch) throw new Error(`${id}: ${mismatch}${stale.length ? `\n${staleList(stale)}` : ''}`);
        if (stale.length) rereadLine = rereadNote(date, stale);
      } else if (rulesReread) throw new Error(`${id}: --rules-reread ${rulesReread.join(',')}, but ${rules.history} does not exist here, so no rule is amended`);
    } else if (rulesReread) throw new Error(`--rules-reread is a claim's (claim, or set <id> in-progress), not set ${status}'s`);
    // Every PR the head named is kept, and a takeover writes back any Baton knows and the
    // frontmatter lost (B-129: `baton ticket history`'s `resume` is Baton's record of them).
    const had = prsOf(text);
    if (takeover) for (const known of baton!.resume?.prs ?? []) if (!had.includes(known)) text = addPr(text, known);
    text = setKey(setKey(text, 'status', status), 'updated', date);
    if (rereadLine) text = appendStatus(text, rereadLine);
    if (pr) text = addPr(text, pr);
    // A write cannot drop a PR Baton's record holds (B-129, item 2) while Baton offers the
    // ticket ready past its start: the write refuses, naming what it would drop. `done` is never
    // refused — the ticket's work is finished, whatever its PR list says.
    if (status !== 'done' && baton?.pastStart && baton.ready != null) {
      const lost = [...new Set([...had, ...(baton.resume?.prs ?? [])])].filter((p) => !prsOf(text).includes(p));
      if (lost.length) {
        throw new Error(`${id}: this write would drop ${lost.join(', ')} — Baton's record holds ${lost.length > 1 ? 'those PRs' : 'that PR'} for a ticket it offers ready at ${baton.ready.station} (${baton.ready.leg}), past its start; take it over instead (\`baton tickets claim ${id}\` writes what Baton knows back), or pass --offline to write git's word alone`);
      }
    }
    const from = `${items}/${id}.mdx`;
    const to = `${items}/archive/${id}.mdx`;
    // A release is a hand-off to the next claimant (B-129, item 2): the commit carries the PRs,
    // Baton's station, the next leg from Baton's ready row, the branch and what is left
    // (`--note`), so the next session reads it at `git log -1 tickets/<id>.mdx`; a takeover's
    // commit carries Baton's position the same way.
    // Every release carries its subject and its `PR` lines; Baton's lines only past the start.
    const release = status === 'available' && !claim;
    const lines = release || baton?.pastStart ? handoffLines({ id, prs: prsOf(text), baton, note: release ? note : undefined }) : [];
    const handoff = lines.length ? `\n\n${lines.join('\n')}` : '';
    const message = status === 'done'
      ? `tickets: ${id} done (archived)${pr ? `\n\n${pr}` : ''}`
      : claim
        ? takeover
          ? `tickets: claim ${id} (in progress — continuing where Baton holds it${baton?.ready ? `: ${baton.ready.station}, ${baton.ready.leg} ready` : ''})${handoff}`
          : `tickets: claim ${id} (in progress)`
        : release
          ? `tickets: release ${id} → available${handoff}`
          : `tickets: ${id} → ${status}${pr ? `\n\n${pr}` : ''}`;
    // A done ticket is written at its archive path, and the live file moved there: the move
    // alone would commit the file as it was, without the status and the PR.
    if (takeover) pushed = { prs: prsOf(text), path: found.path };
    if (status === 'done') return { message, write: [{ path: to, text }], move: [{ from, to }] };
    return { message, write: [{ path: from, text }], move: [] };
  });
  // The takeover hands the session Baton's position (B-129): the station, the ready leg, each
  // PR, the branch to check out — never `checkout -b` a new one — and where the hand-off is.
  if (claim && baton != null && baton.pastStart) {
    const at = baton;
    log(`${id}: Baton holds it${at.ready ? ` at ${at.ready.station}, ${at.ready.leg} ready` : at.station ? ` at ${at.station}` : ' past its course\'s start'} — you are taking it over, not starting it`);
    for (const p of pushed?.prs ?? at.resume?.prs ?? []) log(`  PR: ${p}`);
    for (const b of at.resume?.branches ?? []) log(`  branch: ${b} — continue on it, never \`checkout -b\` a new one`);
    if (at.resume) log(`  hand-off: ${at.resume.end_reason} ${new Date(at.resume.ended_at).toISOString()} — read it: git log -1 ${pushed?.path ?? `tickets/${id}.mdx`}`);
  }
}

/** The hand-off a release's (or a takeover's) commit carries (B-129, R-BTN-74), one line each:
 *  `PR <url>` for every PR the written file names; `Station: <s> (Baton)` — where Baton holds
 *  the ticket; `Next: <leg> from <station> (Baton's ready row) — baton tickets claim <id>
 *  continues there`, or, when the board does not offer it ready, that Baton's board names no
 *  next leg; `Branch: <b>` for each branch Baton's record names; and `Left: <note>` — `--note`'s
 *  "what is left", in the releasing session's own words. Lines Baton cannot answer (offline, or
 *  a ticket at its start) are left out, never guessed. */
function handoffLines(o: { id: string; prs: string[]; baton: BatonPosition | null; note?: string | undefined }): string[] {
  const { id, prs, baton, note } = o;
  const past = baton?.pastStart === true;
  return [
    ...prs.map((p) => `PR ${p}`),
    ...(past && baton!.station ? [`Station: ${baton!.station} (Baton)`] : []),
    ...(past
      ? [baton!.ready
        ? `Next: ${baton!.ready.leg} from ${baton!.ready.station} (Baton's ready row) — baton tickets claim ${id} continues there`
        : `Next: Baton's board offers no leg ready — read baton ticket history ${id} before claiming`]
      : []),
    ...(past ? (baton!.resume?.branches ?? []).map((b) => `Branch: ${b}`) : []),
    ...(note?.trim() ? [`Left: ${note.replace(/\s+/g, ' ').trim()}`] : []),
  ];
}

/** Whether `id` is done, for a claim's dependency: archived, or a live file whose `status:` is
 * `done` or `superseded` — the ticket's rule. `deferred` and `withdrawn` are closed but not
 * done: a deferred dependency keeps the claim waiting. */
function isDone(dir: string, settings: TicketSettings, id: string): boolean {
  const items = (settings.items ?? 'tickets').replace(/\/$/, '');
  const found = locate(items, id, fileAt(dir));
  if (!found) return false;
  if (found.archived) return true;
  const status = /^status:[ \t]*["']?([A-Za-z-]+)["']?[ \t]*$/m.exec(readFileSync(join(dir, found.path), 'utf8'))?.[1];
  return status === 'done' || status === 'superseded';
}

/** Where the ticket commands' Baton reads go (B-129): the URL — `--url`, else `BATON_URL`, else
 *  the repository's own `baton_url`, else the default — the key (`-i`, else `BATON_KEY_FILE`),
 *  and this checkout's Baton repository: the `repos` short name whose forge path is the
 *  checkout's origin, else the origin path's last segment, `admin repo add`'s own default id. */
export function batonTarget(root: string, io: TicketsIo): { url: string; keyFile: string | null; repository: string | null; forgePath: string | null } {
  const json = readSettingsJson(root);
  const forgePath = remoteSlug(root);
  const slug = forgePath?.toLowerCase() ?? null;
  const short = slug != null ? Object.entries(json.repos ?? {}).find(([, path]) => path.toLowerCase() === slug)?.[0] : undefined;
  return {
    url: io.url ?? process.env.BATON_URL ?? json.baton_url ?? DEFAULT_URL,
    keyFile: io.identity?.trim() || process.env.BATON_KEY_FILE?.trim() || null,
    repository: short ?? (slug != null ? (slug.split('/').at(-1) ?? null)?.toLowerCase() ?? null : null),
    forgePath,
  };
}

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
  /** `--trust` / `--invariants`: the skeleton's two sections, written in place of their
   *  placeholders (ignored with `--body-file`, whose body carries its own). */
  trust?: string;
  invariants?: string;
}

/** The order a ticket ranks at when `--order` names none: after every order a filer writes. */
export const ORDER_AFTER_LAST = 1_000_000;

/** The body's `**Depends on:**` line: the ids, or `none.` (the markdown source's own spelling). */
export const dependsLineOf = (deps: readonly string[]): string => `**Depends on:** ${deps.length ? `${deps.join(', ')}.` : 'none.'}`;

/** The conventional body `new` writes: `**Brief:**` (the description), `**Spec:**`, `**Depends
 *  on:**` (from `--depends-on`), `**Used by:**`, the five headings a filer fills — `### Trust` and
 *  `### Invariants` among them, which `baton tickets check` requires of a ticket filed on or after
 *  `check.sections_since` — `**Requires:**` and `## Status`. A description that ends with a
 *  `Requires:` clause is written on the requires line; the others say the line is the filer's to
 *  write. */
export function skeletonBody(o: { description: string; deps: readonly string[]; course?: string; date: string; trust?: string; invariants?: string }): string {
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
    '### Trust',
    '',
    o.trust?.trim() ? o.trust.trim() : '_(every new input this adds — a field, a file, a commit trailer, a request — who may write it and how it is verified; or “no new input”.)_',
    '',
    '### Invariants',
    '',
    o.invariants?.trim() ? o.invariants.trim() : '_(the rules this must not break, by id, and how the design keeps each.)_',
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
  const branch = io.branch ?? defaultBranch(root);
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
    // A filing after `check.sections_since` carries Trust and Invariants, filled — `--body-file`'s
    // or the skeleton's (`--trust`, `--invariants`): refused here, before the push. A placeholder
    // landed on the default branch would fail every open PR's check until someone filled it.
    const since = sectionsSince((readSettingsJson(dir) as { check?: { sections_since?: unknown } }).check);
    if (since && date >= since) {
      const { absent, unfilled: gaps } = sectionGaps(text);
      if (absent.length) throw new Error(`${id}: filed on or after check.sections_since (${since}), so the body needs ${absent.map((m) => `### ${m} (${sectionHint(m)})`).join(' and ')}`);
      if (gaps.length) throw new Error(`${id}: filed on or after check.sections_since (${since}), so ${gaps.map((m) => `### ${m} (${sectionHint(m)})`).join(' and ')} must be filled — pass ${gaps.map((m) => `--${m.toLowerCase()} "<text>"`).join(' and ')}, or a --body-file that fills them`);
    }
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
  const tags = t.tags?.length ? t.tags : settings.tags;
  // `--body-file`'s body gains the skeleton's `_filed` Status line when it has none, so the
  // sections check sees every filing, not only the skeleton's.
  const given = t.body?.trim();
  const filedLine = t.course ? `_filed ${date}; the \`${t.course}\` course._` : `_filed ${date}._`;
  const body = given
    ? (/^_filed \d{4}-\d{2}-\d{2}/m.test(given) ? given : appendStatus(given, filedLine).trim())
    : skeletonBody({ description, deps, ...(t.course ? { course: t.course } : {}), date, ...(t.trust ? { trust: t.trust } : {}), ...(t.invariants ? { invariants: t.invariants } : {}) });
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
    ...(t.order != null ? [`order: ${t.order}`] : []),
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

/** A ticket's text with `id` named on its `**Used by:**` line — appended to what the line
 * already says (its prose and names are kept: the line may name a repository or a plan, not
 * only ids), or the line written after the header block when it has none. The skeleton's
 * `nothing yet` gives way to the first name. */
export function reverseMention(text: string, id: string): string {
  const lines = text.split('\n');
  const at = headerLine(lines, '**Used by:**');
  const namesId = new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`);
  if (at >= 0) {
    const existing = lines[at].replace(/^\*\*Used by:\*\*[ \t]*/i, '').trim();
    if (existing === '' || /^nothing yet\.?$/i.test(existing)) {
      lines[at] = `**Used by:** ${id}.`;
    } else if (!namesId.test(lines[at])) {
      lines[at] = `${lines[at].replace(/\s*\.?$/, '')}, ${id}.`;
    }
    return lines.join('\n');
  }
  // No line: after the frontmatter's closing fence, before the body's first blank line and the
  // heading or description that follows it — where a reader looks for a header. Searching past
  // the closing `---` keeps a blank line inside the frontmatter from taking the insert.
  const fmEnd = lines[0]?.trim() === '---' ? lines.indexOf('---', 1) : -1;
  const body = fmEnd >= 0 ? fmEnd + 1 : 0;
  const block = lines.indexOf('', body);
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

/** `baton tickets check [--repo DIR] [--pr BASE [--claimed-status-only]] [--quiet]` (B-111,
 *  B-112, B-133): B-111's findings, then the generated page's when it has drifted, then — with
 *  `--pr` — the machine-computed view of what this checkout changes in the tickets against
 *  `BASE` (the merge-base): which tickets change, which frontmatter fields (control fields
 *  named), whether a body or brief changed (with a bounded diff), each path's commits, and the
 *  computed status-only label. `--claimed-status-only` — set by CI when the PR's own
 *  description says "status-only" — CHECKS that claim against the computation, and a mismatch
 *  is a finding: the label is the check's, never the description's (B-133). One `path:
 *  message` line each, then the count; exit 1 with a finding, 0 without; `--quiet` keeps
 *  stdout for the exit code alone. */
export async function ticketsCheckMain(argv: string[], io: TicketsIo = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let root = io.root ?? process.env.BATON_HOME ?? process.cwd();
  let quiet = false;
  let prBase: string | null = null;
  let claimedStatusOnly = false;
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
  const findings = before + (page ? 1 : 0) + ticketPrFindings(root, settings, prBase, claimedStatusOnly, lines);
  if (!quiet) {
    for (const l of lines) log(l);
    log(findings ? `baton tickets check: ${tickets} ticket(s), ${findings} finding(s)` : `baton tickets check: ${tickets} ticket(s), ✓ no findings`);
  }
  return findings ? 1 : code;
}

/** B-133: the ticket-PR view against `base`, as `baton tickets check --pr` prints it, and the
 *  finding when a PR's own description claims what the computation contradicts. The view is the
 *  vendored library's (src/shared/ticketPr.mjs, R-BTN-37 — docs' scripts/lib is the source);
 *  git is read here. Returns how many findings it added; every line it prints goes to `lines`. */
function ticketPrFindings(root: string, settings: TicketSettings, base: string | null, claimedStatusOnly: boolean, lines: string[]): number {
  if (base == null) return 0;
  // Trimmed stdout for shas, paths and logs; RAW for `show` — a file's bytes are the view's
  // input, and a trimmed trailing newline would read as a body change.
  const run = (...a: string[]): string => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim();
  const raw = (...a: string[]): string => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  const mergeBase = run('merge-base', base, 'HEAD');
  const paths = ticketPathsUnder(settings.items ?? 'tickets', run('diff', '--name-only', '--no-renames', mergeBase).split('\n'));
  const read = (rev: string, path: string): string | undefined => {
    try {
      return raw('show', `${rev}:${path}`);
    } catch {
      return undefined; // not there at that revision
    }
  };
  const baseFiles: Record<string, string | undefined> = {};
  const headFiles: Record<string, string | undefined> = {};
  const provenance: Record<string, import('../shared/ticketPr.mjs').TicketProvenance[]> = {};
  for (const p of paths) {
    baseFiles[p] = read(mergeBase, p);
    headFiles[p] = existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined;
    // B-126's direction: git's reading — authors AND committers, since anyone sets an author;
    // the forge's pusher is the fact B-126 adds, and is not readable here.
    provenance[p] = run('log', `${mergeBase}..HEAD`, '--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%aI', '--', p)
      .split('\n').filter(Boolean).map((row) => {
        const [sha, author, committer, date] = row.split('\x1f');
        return { sha, author, committer, date };
      });
  }
  const view = ticketPrView({ items: settings.items ?? 'tickets', base: baseFiles, head: headFiles, provenance });
  lines.push(`ticket-pr (B-133): ${view.changed.length} ticket file(s) changed against ${base} (${mergeBase.slice(0, 10)})`);
  if (!view.changed.length) lines.push('  no ticket changes — the status-only label does not apply');
  else {
    for (const c of view.changed) for (const l of formatTicket(c)) lines.push(l);
    lines.push(`status-only: ${view.statusOnly ? 'yes — only status fields changed; no body, brief or control field' : `no — ${view.reasons.join('; ')}`}`);
  }
  const mismatch = claimMismatch(view, claimedStatusOnly);
  if (mismatch) lines.push(`ticket-pr: the PR is ${mismatch} — the label is this check's computation (B-133), never the PR's own description`);
  return mismatch ? 1 : 0;
}

/** `baton tickets --help` (B-112): the commands, the tags Baton reads and what each means, and
 *  the `Requires:` clause a description may end with. Printed by `--help`, and by no command. */
export function ticketsHelp(): string[] {
  return [
    'baton tickets new --title T [--description D] [--project ID] [--depends-on A,B] [--tags X,Y]',
    '                   [--tier T] [--order N] [--repos a,b] [--course C] [--body-file F]',
    '                   [--trust T] [--invariants I]',
    'baton tickets claim <id> [-i KEY] [--url URL] [--offline] [--rules-reread <ids>]   available → in-progress;',
    '                   a ticket Baton holds past its start is taken over where Baton holds it;',
    '                   refused while the ticket cites a rule amended since it was filed, until',
    '                   --rules-reread names exactly those ids (A,B)',
    'baton tickets set <id> <status> [--pr URL] [--note TEXT] [-i KEY] [--url URL] [--offline] [--rules-reread <ids>]',
    '                   any live status; --pr adds a pull request; --note is a release\'s "what is left"',
    'baton tickets done <id> [--pr URL]            done, moved to archive/',
    'baton tickets check [--repo DIR] [--quiet]    check the tickets without posting them',
    '                   --pr BASE [--claimed-status-only]  also print the computed ticket-PR view',
    '                   against BASE (fields, body and brief diffs, provenance, the status-only',
    '                   label); with the claim flag — set by CI when the PR body claims it on a',
    '                   line of its own — a PR whose diff contradicts the claim is a finding',
    '                   (B-133: the label is the check\'s, never the description\'s)',
    '',
    'Each command is one commit pushed straight to the default branch, made in a throwaway worktree',
    'at the freshly fetched head: your own branch and working tree are never touched, and a push',
    'refused because the branch moved is retried on the new head.',
    '',
    'claim asks Baton first (B-129): before it writes, it reads the ticket from Baton with the',
    'key -i names (or BATON_KEY_FILE) — the board for the station and ready leg, the history for',
    'the path, the branch-holder query for the branch — and continues the ticket where Baton',
    'holds it: a ticket past its course\'s start that git says available is a takeover (the PRs',
    'are written back, the position printed), never a fresh start. Baton overrides only a false',
    'available: in-progress or in-review in git (the git lock) and a parked or closed status still',
    'refuse, as do undone dependencies. Another live claim refuses, naming its holder and its',
    'lease. An unanswered read — Baton unreachable, no key, an unreadable key, forbidden — refuses',
    'rather than trust the frontmatter; --offline claims on git\'s word alone (Baton\'s position',
    'is then unknown, not refuted). A release (set <id> available) keeps every prs: entry, refuses',
    'to drop a PR Baton\'s record holds while Baton offers the ticket ready past its start, and its',
    'commit carries the hand-off, one line each: PR <url>, Station: <s> (Baton), Next: <leg> from',
    '<station> (Baton\'s ready row), Branch: <b>, and Left: <--note TEXT>. done is never refused.',
    '',
    'Settings are .baton/baton.json\'s: items (tickets/), ticket_prefix (B), legacy_ids (id patterns',
    'still accepted, never allocated), project (the default --project), tags (the default --tags,',
    'roadmap-item when it names none), check.depends_line, check.sections_since (the day from which a',
    'filed ticket must carry ### Trust and ### Invariants, filled), check.sections_from_id (the first id',
    'that must carry a _filed line, so a shallow clone judges it) and check.rules ({history, prefix}: where the',
    'amendments claim and check read are; spec/BATON_SPEC_HISTORY.md and R-BTN unless set).',
    '',
    'new writes the conventional body unless --body-file names one — **Brief:**, **Spec:**,',
    '**Depends on:** (from --depends-on; none. when empty), **Used by:**, ### What to build,',
    '### Trust, ### Invariants, ### Tests, ### Exit criteria, **Requires:**, ## Status — and judges it as `baton tickets',
    'check` would before pushing, so a filing introduces no cycle and no undeclared dependency.',
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

/** `baton tickets …` (B-112): new, claim, set, done and check. Exit 0 when the command did what
 *  it says, 1 when `check` found something; a refusal throws, which the CLI prints as one
 *  `baton: …` line and exits 2 on. */
export async function ticketsMain(argv: string[], io: TicketsIo = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const warn = io.warn ?? ((l: string) => process.stderr.write(`${l}\n`));
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    for (const line of ticketsHelp()) log(line);
    return 0;
  }
  const [command, ...rest] = argv;
  if (command === 'check') return ticketsCheckMain(rest, io);
  const COMMON = ['repo', 'branch', 'remote'];
  const allowed: Record<string, string[]> = {
    new: ['title', 'description', 'project', 'depends-on', 'tags', 'tier', 'order', 'repos', 'course', 'body-file', 'trust', 'invariants', ...COMMON],
    claim: ['url', 'offline', 'rules-reread', ...COMMON],
    set: ['url', 'offline', 'pr', 'note', 'rules-reread', ...COMMON],
    done: ['url', 'offline', 'pr', ...COMMON],
  };
  if (!allowed[command]) throw new Error(`${command}: baton tickets new|claim|set|done|check (baton tickets --help)`);
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-i') {
      const value = rest[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      flags.identity = value;
    } else if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!allowed[command].includes(name) && name !== 'identity') throw new Error(`${a}: not a flag of baton tickets ${command}`);
      if (name === 'offline') {
        flags.offline = '1';
        continue;
      }
      const value = rest[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      flags[name] = value;
    } else positional.push(a);
  }
  const at: TicketsIo = {
    ...io, ...(flags.repo ? { root: resolve(flags.repo) } : {}), ...(flags.branch ? { branch: flags.branch } : {}), ...(flags.remote ? { remote: flags.remote } : {}),
    ...(flags.identity != null ? { identity: flags.identity } : {}), ...(flags.url ? { url: flags.url } : {}), ...(flags.offline ? { offline: true } : {}), log,
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
      ...(flags.trust != null ? { trust: flags.trust } : {}),
      ...(flags.invariants != null ? { invariants: flags.invariants } : {}),
    });
    return 0;
  }
  if (command === 'set' ? positional.length !== 2 : positional.length !== 1) throw new Error(`baton tickets ${command} ${command === 'set' ? '<id> <status>' : '<id>'} [--pr URL]`);
  const status = command === 'claim' ? 'in-progress' : command === 'done' ? 'done' : positional[1];
  if (command === 'set' && status === 'done') throw new Error('done archives a ticket — `baton tickets done <id>`, past this push');
  if (status !== 'done' && !LIVE_STATUSES.includes(status as Status)) throw new Error(`${status} is not a status \`set\` writes — the live ones are ${LIVE_STATUSES.join(', ')}; \`baton tickets done\` archives a ticket`);
  const reread = flags['rules-reread']?.split(',').map((x) => x.trim()).filter(Boolean);
  if (flags['rules-reread'] != null && !reread?.length) throw new Error('--rules-reread takes the re-read rule ids, comma-separated: --rules-reread <id>,<id>');
  if (flags.note != null && status !== 'available') throw new Error(`--note is a release's hand-off ("what is left") — \`baton tickets set <id> available --note …\`, not ${status}`);
  // B-129: the ticket commands ask Baton first. A claim refuses on any read it cannot answer —
  // the frontmatter is not a fallback, it is the failure this exists to end; a set or done only
  // warn, for a release must be possible while Baton is down (it keeps git's own word, and the
  // open-PR guard then has nothing to compare against).
  const id = positional[0];
  let baton: BatonPosition | null = null;
  if (!at.offline && command !== 'new') {
    const target = batonTarget(root, at);
    if (command === 'claim') {
      if (target.keyFile == null) throw new Error(`${id}: claim reads Baton's record of the ticket first (B-129) — pass -i KEY (or set BATON_KEY_FILE), or --offline to claim on git's word alone`);
      if (target.repository == null) throw new Error(`${id}: this checkout's origin names no Baton repository (no repos entry in .baton/baton.json matches it, and it has no owner/name) — pass --offline to claim on git's word alone`);
      try {
        baton = await readTicketPosition({ url: target.url, keyFile: target.keyFile, repository: target.repository, ticket: id, forgePath: target.forgePath, start: courseStart(root, id), ...(at.fetchImpl ? { fetchImpl: at.fetchImpl } : {}) });
      } catch (e) {
        // Undetermined, not "no record" (B-129): the frontmatter is never the fallback. A key
        // problem is the key's, named as such — Baton was never asked.
        if (e instanceof Undetermined && e.which === 'the key') throw new Error(`${id}: ${e.why} — the reads cannot be signed, so Baton was not asked; pass -i KEY (or BATON_KEY_FILE) naming a readable key, or --offline to claim on git's word alone`);
        throw new Error(`${id}: ${(e as Error).message} — Baton's answer is undetermined; pass --offline to claim on git's word alone`);
      }
    } else {
      if (target.keyFile != null && target.repository != null) {
        try {
          baton = await readTicketPosition({ url: target.url, keyFile: target.keyFile, repository: target.repository, ticket: id, forgePath: target.forgePath, start: courseStart(root, id), ...(at.fetchImpl ? { fetchImpl: at.fetchImpl } : {}) });
        } catch (e) {
          warn(`… ${id}: ${(e as Error).message} — continuing on git's own record; the write keeps every prs: entry it has`);
        }
      }
    }
  }
  moveTicket(root, at, id, status as Status, flags.pr, command === 'claim', baton, flags.note, reread);
  if (at.offline && command === 'claim') warn(`… ${id}: claimed on git's word alone (--offline) — Baton's position is unknown, not refuted; the frontmatter may say available of work Baton still holds`);
  return 0;
}
