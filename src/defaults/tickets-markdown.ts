// tickets-markdown.ts — the CLI's default ticket source (BATON_SPEC §2f R-BTN-74): every
// `*.md`/`*.mdx` file under the `items` setting whose frontmatter carries an `id` is a ticket.
// Pure over injected file texts, so the sync command reads the tree and this decides; the same
// function serves an ejected `.baton/tickets.mjs` through its default export (one interface
// for override and default, so `baton repo init --eject tickets` copies a working file).
import type { PostedTicket } from '../core/board';

export interface MarkdownSettings {
  /** Where ticket files live, relative to the repository root (default `tickets/`). */
  items?: string;
  /** The course a ticket names none for (default `pr`). */
  default_course?: string;
  /** Short repository names a ticket's `repos` may use, mapped to `owner/name`. */
  repos?: Record<string, string>;
}

export interface MarkdownFile {
  path: string;
  text: string;
}

/** A ticket as a ticket source posts it (§7.1): the generic fields core reads, plus the
 * fields core stores unread — the opaque `course` fields, `parent` (R-BTN-86) and `not_before`
 * (R-BTN-89). Typed here, in course code, so `src/core/` gains no line (S-BTN-43). */
export interface SourceTicket extends PostedTicket {
  course?: Record<string, unknown>;
  parent?: string;
  not_before?: unknown;
}

export interface TicketsResult {
  tickets: SourceTicket[];
  closed: { id: string; as: 'done' | 'withdrawn' }[];
}

/** Frontmatter: a `---`-fenced block of `key: value` lines, values scalar, `[a, b]` or a
 * `- item` block list. A file with no fence, or none carrying `id`, is not a ticket. */
export function parseFrontmatter(text: string): Record<string, unknown> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out: Record<string, unknown> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue; // prose or malformed lines are not fields
    const [, key, rest] = kv;
    if (rest.trim() === '') {
      // A block list: every following `- item` line.
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++;
        items.push(unquote(lines[i].replace(/^\s+-\s+/, '')));
      }
      out[key] = items;
    } else if (/^\[.*\]$/.test(rest.trim())) {
      out[key] = rest.trim().slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else if (/^-?\d+(\.\d+)?$/.test(rest.trim())) {
      out[key] = Number(rest.trim());
    } else {
      out[key] = unquote(rest);
    }
  }
  return out;
}

/** A value without its surrounding quotes, `"a"` or `'a'`. */
const unquote = (v: string): string => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) && t.length >= 2 ? t.slice(1, -1) : t;
};
/** A scalar field: a string, or a number read as its text (`id: 1042` is the id `1042`). */
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
/** A list field: a list, or one scalar standing for a list of one (`depends_on: S0`). */
const strList = (v: unknown): string[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(str).filter((x): x is string => x != null);

const CLOSED: Record<string, 'done' | 'withdrawn'> = { done: 'done', withdrawn: 'withdrawn', superseded: 'withdrawn', deferred: 'withdrawn' };

/** The markdown source over `files`: the board's `tickets` and `closed`. A duplicate `id`, or
 * a `repos` short name with no mapping, throws naming the file — the sync fails, nothing is
 * posted. Unknown frontmatter fields are ignored, so an existing wiki needs no rewrite. */
export function ticketsMarkdown(files: MarkdownFile[], settings: MarkdownSettings = {}): TicketsResult {
  const itemsDir = settings.items ?? 'tickets';
  const defaultCourse = settings.default_course ?? 'pr';
  const tickets: SourceTicket[] = [];
  const closed: { id: string; as: 'done' | 'withdrawn' }[] = [];
  const byId = new Map<string, string>(); // id → file, for duplicate detection
  const openChildren = new Map<string, string[]>(); // parent id → its live children (R-BTN-86)
  for (const f of files) {
    if (!/^\.?[A-Za-z0-9._-]+\.(md|mdx)$/.test(f.path.split('/').pop() ?? '')) continue;
    const fm = parseFrontmatter(f.text);
    const id = str(fm?.id);
    if (fm == null || id == null) continue; // a file without frontmatter or `id` is not a ticket
    // `order` is a number or nothing: anything else fails the sync naming the file, rather
    // than silently unranking the ticket.
    const order = fm.order == null || fm.order === '' ? null : typeof fm.order === 'number' ? fm.order
      : typeof fm.order === 'string' && /^-?\d+(\.\d+)?$/.test(fm.order) ? Number(fm.order) : Number.NaN;
    if (order != null && !Number.isFinite(order)) throw new Error(`${f.path}: order ${JSON.stringify(fm.order)} is not a number`);
    if (byId.has(id)) throw new Error(`${f.path}: id ${id} already appears in ${byId.get(id)}`);
    byId.set(id, f.path);
    const as = CLOSED[str(fm.status) ?? ''];
    if (as) {
      closed.push({ id, as });
      continue;
    }
    const tags = strList(fm.tags);
    const names = strList(fm.repos);
    const resolved = names.map((r) => (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) ? r : settings.repos?.[r] ?? null));
    const unknown = names[resolved.indexOf(null)];
    if (unknown != null || resolved.some((r) => r == null)) {
      throw new Error(`${f.path}: repos names ${unknown}, which the baton.json repos map does not resolve`);
    }
    const dep = strList(fm.depends_on);
    const parent = fm.parent != null ? String(fm.parent) : null;
    if (parent != null) openChildren.set(parent, [...(openChildren.get(parent) ?? []), id]);
    tickets.push({
      id,
      course_id: str(fm.course) ?? defaultCourse,
      path: `${itemsDir.replace(/\/$/, '')}/${f.path}`,
      title: str(fm.title) ?? id,
      ...(str(fm.tier) != null ? { tier: str(fm.tier) } : {}),
      requires: strList(fm.requires),
      operator_only: tags.includes('OP'),
      expedite: tags.includes('EXPEDITE'),
      depends_on: dep,
      blocked_by: [],
      repos: resolved as string[],
      rank: order != null ? Math.max(0, Math.round(order)) : null,
      // Opaque to Baton, read by the course's own code (§2b): the PR list the pr course reads.
      course: { ...(strList(fm.prs).length ? { prs: strList(fm.prs) } : {}) },
      ...(parent != null ? { parent } : {}),
      ...(fm.not_before != null ? { not_before: fm.not_before } : {}),
      ...(str(fm.status) != null ? { display: { status: str(fm.status)! } } : {}),
    });
  }
  // A live ticket's open children — the live tickets naming it as `parent` (R-BTN-86) — are
  // its `blocked_by` (R-BTN-74); a closed child is not open, so it never reaches the map. Its
  // dependencies' readiness is the course's to show: the pr course waits `implement` on them.
  for (const t of tickets) t.blocked_by = (openChildren.get(t.id) ?? []).slice().sort();
  // rank by `order`, then id (R-BTN-74); unranked tickets follow ranked ones, ids keeping order.
  tickets.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { tickets, closed };
}
