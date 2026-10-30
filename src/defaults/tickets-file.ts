// tickets-file.ts — one ticket file, read and written (B-112, BATON_SPEC §2f R-BTN-74, §4.2):
// its frontmatter as the markdown source reads it (tickets-markdown.ts's parseFrontmatter, the one
// reader), the line edits `baton tickets set|done` make, and the body's `**Depends on:**` line —
// read by the check's own `dependsLine` (tickets-check.ts, B-111), never a second parser. Pure
// over the text it is given, so the commands' decisions are tested without a repository.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dependsLine } from './tickets-check';
import type { TicketSettings } from './tickets-config';
import { parseFrontmatter, type MarkdownFile } from './tickets-markdown';

/** A filed ticket as the checkout holds it: its path under the root, its id and text. */
export interface TicketFile {
  /** `<items>/<id>.mdx`, or `<items>/archive/<id>.mdx` once done — relative to the root. */
  path: string;
  id: string;
  text: string;
  archived: boolean;
}

/** Where a ticket's file is, live first: `<items>/<id>.mdx`, then `<items>/archive/<id>.mdx`. */
export function locate(items: string, id: string, has: (path: string) => boolean = (p) => existsSync(p)): { path: string; archived: boolean } | null {
  for (const [sub, archived] of [[items, false], [join(items, 'archive'), true]] as const) {
    const path = join(sub, `${id}.mdx`);
    if (has(path)) return { path, archived };
  }
  return null;
}

/** The `---`-fenced frontmatter as one piece: its lines between the fences, and the text after. */
const fenceOf = (text: string): { lines: string[]; rest: string } | null => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  return m ? { lines: m[1].split(/\r?\n/), rest: text.slice(m[0].length) } : null;
};

/** Replace one top-level frontmatter key's line (a scalar), or add it before the closing fence. */
export function setKey(text: string, key: string, value: string): string {
  const fence = fenceOf(text);
  if (!fence) throw new Error(`${key}: the file has no frontmatter`);
  const line = `${key}: ${value}`;
  const i = fence.lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  const lines = i < 0 ? [...fence.lines, line] : fence.lines.map((l, j) => (j === i ? line : l));
  return `---\n${lines.join('\n')}\n---${fence.rest}`;
}

/** Add a PR URL to the frontmatter's `prs` list, once: `prs: []` becomes a block list, an
 *  existing block gains the entry at its end. */
export function addPr(text: string, url: string): string {
  const fence = fenceOf(text);
  if (!fence) throw new Error('the ticket has no frontmatter to add a pull request to');
  if (fence.lines.some((l) => l.includes(url))) return text;
  const i = fence.lines.findIndex((l) => /^prs:(?:\s*\[\])?\s*$/.test(l));
  if (i < 0) throw new Error('the ticket has no prs list to add to');
  let end = i + 1;
  while (end < fence.lines.length && /^\s+-\s+/.test(fence.lines[end])) end++;
  // A block list already there gains the entry at its end; an empty one (`[]` or none at all)
  // takes a list of its own.
  const lines = end > i + 1
    ? [...fence.lines.slice(0, end), `  - ${url}`, ...fence.lines.slice(end)]
    : [...fence.lines.slice(0, i), 'prs:', `  - ${url}`, ...fence.lines.slice(i + 1)];
  return `---\n${lines.join('\n')}\n---${fence.rest}`;
}

/** A frontmatter scalar, quoted as the markdown source reads it back: a value with a colon, a
 *  `#`, a leading space or brackets is written in one pair of quotes; one holding both kinds of
 *  quote has its double quotes curled, as request.ts's `scalar` does, rather than a backslash a
 *  person would have to read (the source unescapes nothing). */
export const scalar = (v: string): string => {
  const one = v.replace(/\s+/g, ' ').trim();
  const quoted = (t: string) => '"' + t + '"';
  if (!/["']/.test(one)) return /^[:#\s]/.test(one) || /^\[.*\]$/.test(one) || one === '' ? quoted(one) : one;
  if (!one.includes('"')) return '"' + one + '"';
  if (!one.includes("'")) return "'" + one + "'";
  return '"' + one.replace(/"/g, '\u201d') + '"';
};

/** The id a file declares, or null when it is not a ticket (`items.ts`'s reading: frontmatter
 *  carrying an `id`). */
export const idOf = (text: string): string | null => {
  const id = parseFrontmatter(text)?.id;
  return typeof id === 'string' && id !== '' ? id : null;
};

/** The text with one top-level key's line dropped (the frontmatter's block list of it included),
 *  for a field written elsewhere. */
export function dropKey(text: string, key: string): string {
  const fence = fenceOf(text);
  if (!fence) return text;
  const i = fence.lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (i < 0) return text;
  let end = i + 1;
  while (end < fence.lines.length && /^\s+-\s+/.test(fence.lines[end])) end++;
  return `---\n${[...fence.lines.slice(0, i), ...fence.lines.slice(end)].join('\n')}\n---${fence.rest}`;
}

/** The next free number under `prefix` (`B-`), across the items folder at any depth — the archive
 *  included — among files the markdown source would read as tickets: the files whose names match
 *  the prefix's pattern and whose frontmatter carries an `id`. A file whose name matches but is no
 *  ticket (`README-2.mdx`) takes no number. */
export function nextNumber(files: readonly MarkdownFile[], settings: TicketSettings, prefix = `${allocatingOf(settings)}-`): number {
  const numberGroup = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\.mdx?$`);
  const names = files.map((f) => ({ n: numberGroup.exec(f.path.split('/').at(-1) ?? '')?.[1], text: f.text }))
    .filter((f): f is { n: string; text: string } => f.n != null && idOf(f.text) != null)
    .map((f) => Number(f.n));
  return Math.max(0, ...names) + 1;
}

const allocatingOf = (settings: TicketSettings): string => (settings.ticket_prefix ?? 'B').replace(/-$/, '');

/** The ids a `**Depends on:**` line names (B-111's reading: to the next blank or `**Label:**`
 *  line, `none` being the empty list), or null when the body has no such line. */
export const dependsOf = (text: string): string[] | null => dependsLine(text);

/** `baton tickets check`'s finding on one ticket writing a `**Depends on:**` line that disagrees
 *  with its `depends_on`, or null when they agree (or the ticket has no such line). The check's
 *  own comparison, made at filing time so a filing never writes the disagreement it would report. */
export function dependsDisagreement(text: string, deps: readonly string[], isMine: (id: string) => boolean): string | null {
  const named = dependsOf(text);
  if (named == null) return null;
  const mine = named.filter(isMine);
  for (const id of mine) if (!deps.includes(id)) return `**Depends on:** names ${id}, which depends_on does not`;
  for (const id of deps) if (!named.includes(id)) return `depends_on names ${id}, which **Depends on:** does not`;
  return null;
}
