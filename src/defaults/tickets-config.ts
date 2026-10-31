// tickets-config.ts — `.baton/baton.json`'s ticket settings as the ticket commands read them
// (B-112, BATON_SPEC §2f R-BTN-74, §4.2 R-BTN-74): where tickets live, the id prefix `new`
// allocates under, the patterns a repository still accepts but no longer allocates, the project a
// filing names, and the tags Baton reads — each taught by `baton tickets --help` and written into
// the generated "How tickets work" page (tickets-page.ts), so one file is both the parser and the
// documentation of what it parses. Course code in the CLI, never core (§2b).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `.baton/baton.json`'s fields the ticket commands read (cli.ts's BatonJson, narrowed; the
 *  fields are §2f R-BTN-74's). */
export interface TicketSettings {
  /** The ticket folder, relative to the repository root (`tickets`). */
  items?: string;
  /** The prefix `baton tickets new` allocates under — `B` unless `.baton/baton.json`'s
   *  `ticket_prefix` names one. */
  ticket_prefix?: string;
  /** The id patterns the repository still accepts but never allocates (this repository's
   *  `R3-\d+`), from `legacy_ids`. */
  legacy_ids: string[];
  /** The `project:` a filing takes when `--project` names none — a `kind: project` page in the
   *  items folder's `projects/`. No default at all when it names none. */
  project?: string;
  /** The accepted ids, as a prefix (`B-`) to its pattern source (`\d+`). */
  prefixes: Record<string, string>;
  /** The tags `new` writes without `--tags`: the file's own, else `roadmap-item`. */
  tags: string[];
  /** The `kind: project` pages' folder under `items` (`projects`). */
  projects: string;
}

/** The number every id pattern ends in (R-BTN-74's `B-\d+`): `new` substitutes its next number
 *  for these, and the allocating prefix's own pattern is exactly them when the file names none. */
const NUMBER = '\\d+';

/** The tags Baton reads on a ticket, and what each does — the markdown source's reading
 *  (tickets-markdown.ts) and `baton tickets --help`'s table: `EXPEDITE` is R-BTN-12's, `OP` is
 *  `human-operator` in the ticket's `requires`. A tag not here is the repository's own ranking
 *  word, unread by Baton. */
export const TAGS: { tag: string; means: string }[] = [
  { tag: 'EXPEDITE', means: 'expedited: first in every claim’s order (BATON_SPEC §6, R-BTN-12)' },
  { tag: 'OP', means: '`human-operator` in the ticket’s `requires`, so a runner must hold that capability to be offered it' },
];

/** The `**Label:**` clause a description may end with, naming the capabilities its ticket needs
 *  (BATON_SPEC §4, R-BTN-120): `Requires: human-operator, drivable-browser.` `new` writes them on
 *  the filing's `**Requires:**` line, so the clause is a way of saying what the ticket needs, not
 *  a second field the body states anyway. */
export const REQUIRES_MARKER = 'Requires:';

/** The statuses a ticket file's `status:` takes, as the markdown source reads them (§4.2,
 *  tickets-markdown.ts's `CLOSED`). */
export const STATUSES = ['available', 'in-progress', 'in-review', 'deferred', 'deprioritized', 'superseded', 'done'] as const;
export type Status = (typeof STATUSES)[number];

/** The live statuses `baton tickets set` writes: every one but `done` (which `done` writes,
 *  moving the file to `archive/`) — the stopgap's own LIVE list, `deferred` and `superseded`
 *  included, so withdrawing a ticket without archiving keeps a writer. */
export const LIVE_STATUSES: readonly Status[] = ['available', 'in-progress', 'in-review', 'deferred', 'deprioritized', 'superseded'];

/** Whether `id` may be named — the ticket, `claim`'s dependency, `new`'s: under the allocating
 *  prefix, or under a legacy pattern the repository still accepts but never allocates. */
export const accepting = (settings: TicketSettings, id: string): boolean => accepts(settings, id);

export const GITHUB_PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

/** Read `.baton/baton.json`'s ticket settings in `root`. A missing file throws naming the fix,
 *  as `baton request` does; a malformed one names its first line. */
export function readTicketSettings(root: string, where = root): TicketSettings {
  const path = join(root, '.baton', 'baton.json');
  if (!existsSync(path)) throw new Error(`${where} has no .baton/baton.json — the ticket commands write the tickets a sync reads; run \`baton repo init\` there first`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`.baton/baton.json is not JSON: ${(e as Error).message.split('\n')[0]}`);
  }
  const texts = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v !== '' ? [v] : [])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const project = str(json.project);
  if (json.project != null && project === undefined) throw new Error('.baton/baton.json: project is a project id, not an empty value');
  const legacy_ids = texts(json.legacy_ids);
  return {
    items: str(json.items),
    ticket_prefix: str(json.ticket_prefix),
    legacy_ids,
    project,
    prefixes: prefixesOf(json.prefixes, legacy_ids, str(json.ticket_prefix)),    tags: tagsOf(json),
    projects: str(json.projects) ?? 'projects',
  };
}

/** The tags `new` writes without `--tags`: the file's own, else `roadmap-item`. */
function tagsOf(json: Record<string, unknown>): string[] {
  const v = json.tags;
  const tags = (Array.isArray(v) ? v : typeof v === 'string' && v !== '' ? [v] : [])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  return tags.length ? tags : ['roadmap-item'];
}

/** A pattern source this module can read: `\d`, then `+`, a `{n}` count, `[a-z]?\d*`, or nothing
 *  (`\d+` is B's, `\d{7}` fieldhouse's, `\d+[a-z]?\d*` this repository's `R3-`). */
const SOURCE_FORM = /^\\d(\+|(\{\d+\}|\[a-z\]\?\d\*)?)$/;

/** The accepted id patterns: `prefixes` when the file maps a prefix to its source, and
 *  `legacy_ids` (`R3-\d+`) as the pattern of the prefix before their first dash. The allocating
 *  prefix is one of them, `\d+` unless the file maps it. */
function prefixesOf(prefixes: unknown, legacy: string[], allocating: string | undefined): Record<string, string> {
  if (prefixes != null && (typeof prefixes !== 'object' || Array.isArray(prefixes))) throw new Error('.baton/baton.json: prefixes maps an id prefix to its pattern source');
  const map: Record<string, string> = {};
  for (const [prefix, source] of Object.entries((prefixes ?? {}) as Record<string, unknown>)) {
    // A pattern this module can read: `\d`, then `+`, a `{n}` count, `[a-z]?\d*`, or nothing
    // (`\d+` is B's, `\d{7}` fieldhouse's, `\d+[a-z]?\d*` this repository's `R3-`).
    if (!/^[A-Za-z][A-Za-z0-9]*-$/.test(prefix) || typeof source !== 'string' || !SOURCE_FORM.test(source)) {
      throw new Error(`.baton/baton.json: prefixes.${prefix} is an id prefix (\`B-\`) whose pattern this release cannot read — write its number as \\d+ or \\d{7}, not ${JSON.stringify(source)}`);
    }
    map[prefix] = source;
  }
  for (const id of legacy) {
    const m = /^([A-Za-z][A-Za-z0-9]*)-([^()^$|]*\\d[^()^$|]*)$/.exec(id);
    if (!m) throw new Error(`.baton/baton.json: legacy_ids names ${id}, which is not an id pattern (\`R3-\\d+\`)`);
    map[`${m[1]}-`] = m[2];
  }
  const allocatingPrefix = allocating && /^[A-Za-z][A-Za-z0-9]*$/.test(allocating) ? `${allocating}-` : 'B-';
  if (map[allocatingPrefix] == null) map[allocatingPrefix] = NUMBER;
  return map;
}

/** The allocating prefix, `B` unless configured — `/^[A-Za-z][A-Za-z0-9]*-$/`, without its dash. */
export function allocatingPrefix(settings: TicketSettings, fallback = 'B'): string {
  return (settings.ticket_prefix ?? fallback).replace(/-$/, '');
}

/** The pattern for one prefix — `B-`, `R3-` — as a whole-id expression, `B-\\d+` when neither the
 *  file nor a legacy id names it. */
export function idPattern(settings: TicketSettings, prefix: string): RegExp {
  const source = settings.prefixes[prefix] ?? NUMBER;
  return new RegExp(`^${prefix}${source.includes('\\d') ? source : `${source}${NUMBER}`}$`);
}

/** Whether `id` is an id the repository accepts: under its allocating prefix, or under a legacy
 *  pattern it still accepts but never allocates. */
export function accepts(settings: TicketSettings, id: string): boolean {
  const prefix = Object.keys(settings.prefixes).filter((p) => id.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  return prefix != null && idPattern(settings, prefix).test(id);
}

/** Whether `new` can allocate `id`: it carries the allocating prefix and the prefix's pattern
 *  ends in `\\d+`, the number `nextNumber` substitutes. A pattern with a fixed count (`\\d{7}`)
 *  names ids a repository accepts but never allocates — `new` says so rather than write one. */
export const allocates = (settings: TicketSettings, id: string): boolean => {
  const prefix = `${allocatingPrefix(settings)}-`;
  return id.startsWith(prefix) && (settings.prefixes[prefix] ?? NUMBER) === NUMBER && idPattern(settings, prefix).test(id);
};

/** The capabilities a description's trailing `Requires:` clause names, when it ends with one —
 *  `… Requires: human-operator, drivable-browser.` — each a capability name, or nothing. */
export function requiresFrom(description: string): string[] {
  const one = description.replace(/\s+/g, ' ').trim();
  // The clause is the sentence's last — `Requires:` … to a full stop, at the very end — so a
  // sentence that merely says the word is not a requirement.
  const clause = new RegExp(`(?:^|[.:;] )${REQUIRES_MARKER} ([^.]*)\\.?$`).exec(one);
  if (!clause) return [];
  return clause[1].split(/,\s*/).map((c) => c.trim()).filter((c) => /^[A-Za-z][A-Za-z0-9-]*$/.test(c));
}

/** `.baton/baton.json` as JSON, for the fields outside the ticket settings — the `repos` map the
 *  markdown source resolves a short name through. `{}` for a file that is missing or unreadable:
 *  the caller read the same file as settings and has already refused it if it must. */
export function readSettingsJson(root: string): { repos?: Record<string, string> } {
  try {
    return JSON.parse(readFileSync(join(root, '.baton', 'baton.json'), 'utf8')) as { repos?: Record<string, string> };
  } catch {
    return {};
  }
}
