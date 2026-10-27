// tickets-check.ts — `baton tickets check` (BATON_SPEC R-BTN-74, §4.4; B-111): runs a
// repository's ticket source — an ejected `.baton/tickets.mjs`, else the CLI's markdown default —
// exactly as `baton repo sync` reads it, and checks what it would post, without posting: the
// source's own refusals, the board post's validation (the core's `checkPayload`, so a pull
// request fails on what the sync would refuse), every `depends_on` naming a live or closed
// ticket, and the dependencies forming no cycle. For the markdown source, behind
// `.baton/baton.json`'s `check.depends_line`, each body's `**Depends on:**` line against its
// `depends_on` — a dependency written only in prose hides a loop the cycle check cannot see.
// Course code in the CLI, never core (§2b): defaults import core, never the reverse.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bodyDependencies, checkPayload, dependsCycle, dependsCycles } from '../core/board';
import { LOCAL_ID } from '../core/validate'; // the board's own grammar, cited below (§4.4)
import { readItems } from './read-items';
import { ticketsMarkdown, type MarkdownFile, type MarkdownSettings, type TicketsResult } from './tickets-markdown';

/** The ids a `**Depends on:**` line may name, as prose writes them (B-111, round 1): an
 *  id-shaped token — a prefix and a number, `B-2`, `R3-1205`, `R-BTN-83` — which the board
 *  would admit once its prefix is whole. The board's own `LOCAL_ID`
 *  (`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`) is right for `depends_on`'s list and wrong for prose: read
 *  over a sentence it takes `none.`, `the` and `and` for ids (round 1, 1-A-0). The prefix's own
 *  dashes are part of it (`R-BTN-83` is never `BTN-83`), so the pattern refuses a token that
 *  starts mid-id: a `-` or an alphanumeric directly before the match, or a letter, digit or
 *  underscore directly after the number, means the token is something else (round 2, 2-r0-1).
 *  A full stop after it is usually the sentence's (`… see B-2.`), so only a stop followed by
 *  more token (`B-4.1`) is part of the id (round 3, 3-r1-1) — except a wiki link's `.md`/`.mdx`
 *  (`[[R3-1128.mdx]]`, docs' form: 117 of its 218 lines, round 4, 4-r2-0). */
const ID_TOKEN = /(?<![A-Za-z0-9._-])([A-Za-z](?:[A-Za-z0-9]*|[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)-\d+)(?![A-Za-z0-9_]|\.(?!mdx?(?![A-Za-z0-9]))[A-Za-z0-9])/g;

/** The ticket ids a markdown ticket's body names on its `**Depends on:**` line, or null when it
 *  has no such line (B-111). The body is the file's text with its frontmatter blanked; the line
 *  itself — the first marker outside a fenced block, running to the next blank or `**Label:**`
 *  line — is core's `bodyDependencies` (`src/core/board.ts`), the one algorithm, so this and the
 *  board's own reading cannot disagree (rounds 1-2). `none` is the empty list, as `depends_on:
 *  []` is (§4.4's own spelling). */
export function dependsLine(text: string, idPattern: RegExp = ID_TOKEN): string[] | null {
  // The body, its frontmatter blanked.
  const fence = /^---\r?\n[\s\S]*?\r?\n---/.exec(text);
  const body = fence ? '\n'.repeat(fence[0].split('\n').length - 1) + text.slice(fence[0].length) : text;
  // A pattern without the token boundary would read prose words; the boundary is this module's.
  const cited = bodyDependencies(body, new RegExp(idPattern.source, idPattern.flags.includes('g') ? idPattern.flags : `${idPattern.flags}g`));
  return cited == null ? null : cited.filter((id) => id.toLowerCase() !== 'none');
}

/** One finding, as `baton tickets check` prints it: `path: message`. */
export interface TicketFinding {
  path: string;
  message: string;
}

export interface TicketsCheckResult {
  findings: TicketFinding[];
  /** What was checked: the tickets the source posted, and the closed list it built. */
  counts: { tickets: number; closed: number };
}

/** `.baton/baton.json`'s `check` settings (B-111): the ticket check's, all off by default. */
export interface CheckSettings {
  /** Compare each markdown ticket's `**Depends on:**` body line with its `depends_on`
   *  (`check: {depends_line: true}`). Off, no line is read. */
  depends_line?: boolean;
}

/** Check a repository's ticket source without posting it, as `baton tickets check` does (B-111):
 *  loads the source exactly as the sync's `readBoard` does — `.baton/tickets.mjs` when the
 *  repository has one, else the markdown default over `items` — and reports, as one string each:
 *  - the source's own refusals (a duplicate id, an unknown `repos` short name, an `order` that is
 *    not a number), which the sync throws and a pull request must fail on instead;
 *  - the board post's validation, run locally (`checkPayload`, §4.4): ids, courses, paths, lists,
 *    and the dependency cycle the board refuses — once, against the first ticket's file;
 *  - a `depends_on` naming no live or closed ticket of this repository;
 *  - with `check.depends_line` (the markdown source only), each body's `**Depends on:**` line
 *    against its `depends_on`, both ways.
 *  The `parent` edge is not read as a dependency: the markdown source turns a parent into its
 *  children's `blocked_by`, never into a `depends_on` a rule order could wait on, so a parent
 *  cycle is not one the board holds. A cycle finding names the first ticket's file. The check
 *  reads; it never writes. `settings` overrides the file's, as `readBoard`'s caller does. */
export async function checkTickets(root: string, settings: MarkdownSettings = {}, check: CheckSettings = {}): Promise<TicketsCheckResult> {
  const findings: TicketFinding[] = [];
  const settingsPath = join(root, '.baton', 'baton.json');
  if (!existsSync(settingsPath)) throw new Error(`${root} has no .baton/baton.json — run \`baton repo init\` first`);
  let batonJson: { items?: string; default_course?: string; repos?: Record<string, string> };
  try {
    batonJson = JSON.parse(readFileSync(settingsPath, 'utf8')) as typeof batonJson;
  } catch (e) {
    throw new Error(`.baton/baton.json is not JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  // The settings as the sync reads them (cli.ts readBoard): the caller's, else the file's.
  const used: MarkdownSettings = {
    items: settings.items ?? batonJson.items ?? 'tickets',
    default_course: settings.default_course ?? batonJson.default_course,
    repos: settings.repos ?? batonJson.repos,
  };
  const ctx = { root, settings: used };

  // The ticket source: the repository's own, else the markdown default — readBoard's order. A
  // source that throws is itself the finding: its message already opens with the file to fix.
  const own = join(root, '.baton', 'tickets.mjs');
  // Whether the repository has its own source: asked by reading it, never by a truthiness test,
  // so no optimisation of this module can turn the path into `false` (it did once, in esbuild).
  const ownSource = existsSync(own);
  const markdown = !ownSource;
  let result: TicketsResult;
  let files: MarkdownFile[] = [];
  try {
    if (ownSource) {
      const mod = (await import(`${pathToFileURL(own).href}?at=${headOf(root)}`)) as { default?: { tickets?: (ctx: unknown) => Promise<TicketsResult> } };
      if (typeof mod.default?.tickets !== 'function') throw new Error('.baton/tickets.mjs default-exports no tickets(ctx)');
      result = await mod.default.tickets(ctx);
    } else {
      files = readItems(root, used.items);
      result = ticketsMarkdown(files, used);
    }
  } catch (e) {
    // The source's own message, passed through as it came — the markdown source names the file
    // to fix (`tickets/B-4.mdx: id B-4 already appears in …`), so the finding's path is the
    // folder it was read from; a source that fails without naming one is `.baton/tickets.mjs`'s
    // (`default-exports no tickets(ctx)`), and its own path is the finding's.
    const message = (e as Error)?.message ?? String(e);
    const path = message.startsWith('.baton/tickets.mjs') ? '.baton/tickets.mjs' : (used.items ?? 'tickets');
    return { findings: [{ path, message }], counts: { tickets: 0, closed: 0 } };
  }
  if (!result || !Array.isArray(result.tickets) || !Array.isArray(result.closed)) {
    return { findings: [{ path: '.baton/tickets.mjs', message: '.baton/tickets.mjs tickets(ctx) returned no {tickets, closed}' }], counts: { tickets: 0, closed: 0 } };
  }
  const counts = { tickets: result.tickets.length, closed: result.closed.length };

  // The board post's validation, run here so a pull request fails instead of the sync: the one
  // throw it makes is one finding — the validator names its field (`tickets[3].tier: …`) — at
  // `board`, or, a cycle, at the first ticket's file, which the author opens.
  const liveIds = new Set(result.tickets.map((t) => t.id));
  for (const c of result.closed) liveIds.delete(c.id);
  const live = result.tickets.filter((t) => liveIds.has(t.id));
  const fileOf = new Map(result.tickets.map((t) => [t.id, t.path]));
  const loops = dependsCycles(live.map((t) => ({ id: t.id, depends_on: t.depends_on ?? [] })));
  const cycles = loops.map((loop) => `a dependency cycle: ${loop.join(' → ')}`);
  // Each cycle is checked first so that its finding takes a file, and the board's own answer for
  // it — the same sentence, after `tickets.depends_on:` — is then not printed a second time (the
  // board names the first, so a second loop is the check's alone: round 1, 1-A-2). A cycle does
  // not stop the rest: the validator is one throw, and the findings after it are the same post's.
  for (const [i, message] of cycles.entries()) findings.push({ path: fileOf.get(loops[i][0]) ?? 'board', message });
  try {
    checkPayload({ sha: '0'.repeat(40), parent_sha: null, observation: 1, tickets: result.tickets, closed: result.closed });
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    if (!cycles.some((cycle) => message.includes(`: ${cycle}`))) findings.push({ path: 'board', message });
  }

  // 1-A-6: a repository with its own source has no markdown body to compare — the setting does
  // nothing there, and saying so once beats a silent no-op for the operator who set it.
  if (check?.depends_line && ownSource) findings.push({ path: '.baton/tickets.mjs', message: 'check.depends_line is on, but this repository\'s tickets come from its own source — there is no markdown **Depends on:** line to compare' });

  // Every dependency names a live or a closed ticket of this repository (all of these are). A
  // source may post an id twice (the board says so), so the same sentence on the same file is
  // printed once, never once per posting.
  const known = new Set([...liveIds, ...result.closed.map((c) => c.id)]);
  const said = new Set(findings.map((f) => `${f.path}\u0000${f.message}`));
  const add = (f: TicketFinding): void => {
    const key = `${f.path}\u0000${f.message}`;
    if (!said.has(key)) findings.push(f);
    said.add(key);
  };
  for (const t of live) {
    for (const dep of t.depends_on ?? []) if (!known.has(dep)) add({ path: t.path, message: `depends_on names ${dep}, which is neither live nor closed` });
  }

  // The markdown source's body line (B-111): `**Depends on:**` names exactly `depends_on`.
  if (markdown && check.depends_line === true) {
    // 4-r2-1: only this repository's own ticket ids count. A line cites requirement and scenario
    // ids too (`R-FH-40/41/42`, `S-BTN-62`) — fieldhouse's check reads ids of its own prefix
    // (`^FLDH-\d+$`, `.baton/baton.json`'s ticket_prefix), so those are prose there and here.
    const own = new Set([...result.tickets.map((t) => t.id), ...result.closed.map((c) => c.id)]);
    const prefixes = new Set([...own].map((id) => id.replace(/\d+$/, '')));
    const isMine = (id: string): boolean => own.has(id) || prefixes.has(id.replace(/\d+$/, ''));
    const texts = new Map(files.map((f) => [`${(used.items ?? 'tickets').replace(/\/$/, '')}/${f.path}`, f.text]));
    for (const t of result.tickets) {
      const text = texts.get(t.path);
      if (text == null) continue;
      const named = dependsLine(text);
      if (named == null) continue; // a ticket with no such line is not compared
      const deps = t.depends_on ?? [];
      for (const id of named.filter(isMine)) if (!deps.includes(id)) add({ path: t.path, message: `**Depends on:** names ${id}, which depends_on does not` });
      for (const id of deps) if (!named.includes(id)) add({ path: t.path, message: `depends_on names ${id}, which **Depends on:** does not` });
    }
  }
  return { findings, counts };
}

/** The root's commit, the cachebuster `baton repo sync` imports a ticket source at (cli.ts
 *  readBoard's `?at=`): the clock alone where the directory is no git checkout. */
function headOf(root: string): string {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return String(Date.now());
  }
}

/** `baton tickets check [--repo DIR] [--quiet]` (B-111): one `path: message` line per finding on
 *  stdout, then a count, so a CI log holds both; exit 1 with findings, 0 without. `--quiet` keeps
 *  stdout for the exit code alone. An unreadable root or a `.baton/baton.json` that is not JSON
 *  throws, which the CLI prints as `baton: …` and exits 2 on. */
export async function checkTicketsMain(argv: string[], io: { log?: (l: string) => void } = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  let root = process.env.BATON_HOME ?? process.cwd();
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--repo') root = value();
    else if (a === '--quiet') quiet = true;
    else throw new Error(`${a}: not a flag of baton tickets check`);
  }
  if (!existsSync(root)) throw new Error(`--repo ${root}: no such directory`);
  const settingsPath = join(root, '.baton', 'baton.json');
  let check: CheckSettings = {};
  if (existsSync(settingsPath)) {
    try {
      check = ((JSON.parse(readFileSync(settingsPath, 'utf8')) as { check?: CheckSettings }).check ?? {}) as CheckSettings;
    } catch (e) {
      throw new Error(`.baton/baton.json is not JSON: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  const { findings, counts } = await checkTickets(root, {}, check);
  if (!quiet) for (const f of findings) log(`${f.path}: ${f.message}`);
  if (findings.length) {
    log(`baton tickets check: ${counts.tickets} ticket(s), ${findings.length} finding(s)`);
    return 1;
  }
  if (!quiet) log(`baton tickets check: ${counts.tickets} ticket(s), ✓ no findings`);
  return 0;
}
