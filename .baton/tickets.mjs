// src/defaults/read-items.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
function readItems(root, items = "tickets") {
  const dir = join(root, items);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/")).sort().map((path) => ({ path, text: readFileSync(join(dir, path), "utf8") }));
}

// src/defaults/tickets-markdown.ts
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest.trim() === "") {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++;
        items.push(unquote(lines[i].replace(/^\s+-\s+/, "")));
      }
      out[key] = items;
    } else if (/^\[.*\]$/.test(rest.trim())) {
      out[key] = rest.trim().slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      out[key] = unquote(rest);
    }
  }
  return out;
}
var unquote = (v) => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) && t.length >= 2 ? t.slice(1, -1) : t;
};
var str = (v) => typeof v === "string" && v !== "" ? v : null;
var strList = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(str).filter((x) => x != null);
var CLOSED = { done: "done", withdrawn: "withdrawn", superseded: "withdrawn", deferred: "withdrawn" };
function ticketsMarkdown(files, settings = {}) {
  const itemsDir = settings.items ?? "tickets";
  const defaultCourse = settings.default_course ?? "create-pr";
  const tickets = [];
  const closed = [];
  const byId = /* @__PURE__ */ new Map();
  const openChildren = /* @__PURE__ */ new Map();
  for (const f of files) {
    if (!/\.mdx?$/i.test(f.path)) continue;
    const fm = parseFrontmatter(f.text);
    const id = str(fm?.id);
    if (fm == null || id == null) continue;
    const order = fm.order == null || fm.order === "" ? null : typeof fm.order === "string" && /^-?\d+(\.\d+)?$/.test(fm.order) ? Number(fm.order) : Number.NaN;
    if (order != null && !Number.isFinite(order)) throw new Error(`${f.path}: order ${JSON.stringify(fm.order)} is not a number`);
    if (byId.has(id)) throw new Error(`${f.path}: id ${id} already appears in ${byId.get(id)}`);
    byId.set(id, f.path);
    const as = CLOSED[str(fm.status) ?? ""];
    if (as) {
      closed.push({ id, as });
      continue;
    }
    const tags = strList(fm.tags);
    const names = strList(fm.repos);
    const resolved = names.map((r) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) ? r : settings.repos?.[r] ?? null);
    const unknown = names[resolved.indexOf(null)];
    if (unknown != null || resolved.some((r) => r == null)) {
      throw new Error(`${f.path}: repos names ${unknown}, which the baton.json repos map does not resolve`);
    }
    const dep = strList(fm.depends_on);
    const parent = fm.parent != null ? String(fm.parent) : null;
    if (parent != null) openChildren.set(parent, [...openChildren.get(parent) ?? [], id]);
    tickets.push({
      id,
      course_id: str(fm.course) ?? defaultCourse,
      path: `${itemsDir.replace(/\/$/, "")}/${f.path}`,
      title: str(fm.title) ?? id,
      ...str(fm.tier) != null ? { tier: str(fm.tier) } : {},
      requires: strList(fm.requires),
      operator_only: tags.includes("OP"),
      expedite: tags.includes("EXPEDITE"),
      depends_on: dep,
      blocked_by: [],
      repos: resolved,
      rank: order != null ? Math.max(0, Math.round(order)) : null,
      // Opaque to Baton, read by the course's own code (§2b): the PR list the PR courses read,
      // and the owner's `answer:` the decision course waits on (R-BTN-131).
      course: { ...strList(fm.prs).length ? { prs: strList(fm.prs) } : {}, ...str(fm.answer) != null ? { answer: str(fm.answer) } : {} },
      ...parent != null ? { parent } : {},
      ...fm.not_before != null ? { not_before: fm.not_before } : {},
      ...str(fm.status) != null ? { display: { status: str(fm.status) } } : {}
    });
  }
  for (const t of tickets) t.blocked_by = (openChildren.get(t.id) ?? []).slice().sort();
  tickets.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { tickets, closed };
}

// ../../../../../private/var/folders/l5/khd_fnwx431d2p12lyvlqznr0000gn/T/baton-bundle-EOjAr3/entry.ts
var entry_default = {
  // The same signature the sync calls a repository's own source with: edit freely.
  // This repository's tickets wiki holds more than tickets: `projects/` (Grove project
  // pages) and `home.mdx` are pages, not work items — every file under them with an
  // `id` would otherwise board as a claimable ticket. Tickets are the `*.mdx` files at
  // the top of `tickets/` plus `tickets/archive/` (closed, kept for history).
  //
  // `repos:` stops naming docs. The tickets that moved here from the docs roadmap keep
  // it as heritage of where they came from, but their PRs live in this repository now —
  // and the sync reads every repository a live ticket names, while this repository's
  // CI token cannot read the private docs repository (R-BTN-74 fails the whole board
  // for exactly that). A ticket that genuinely needs a docs PR names it again the day
  // the sync's token can read it; the sync will say so loudly.
  async tickets(ctx) {
    const files = readItems(ctx.root, ctx.settings.items).filter((f) => /^(\w[\w-]*\.mdx|archive\/\w[\w-]*\.mdx)$/.test(f.path));
    const result = ticketsMarkdown(files, ctx.settings);
    for (const t of result.tickets) t.repos = (t.repos ?? []).filter((r) => !/^immediately-run\/docs$/i.test(r));
    return result;
  }
};
export {
  entry_default as default
};
