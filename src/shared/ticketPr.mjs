// ticketPr.mjs — the machine-computed view of what a change does to tickets (B-133, OWASP
// ASI09: an owner approves what an agent writes; the words beside the approval are the agent's,
// so the CHANGE is computed, never summarised by the PR's own description).
//
// Pure: the caller reads git and the files (the runners are scripts/check-ticket-pr.mjs in docs
// and `baton tickets check --pr` in the Baton repository, which vendors this file — R-BTN-37's
// one-algorithm rule; never edit the vendored copy). Three questions, computed:
//
//   which tickets change          the paths under the items directory that differ
//   what changed in each          frontmatter fields (old → new), and the body — the **Brief:**
//                                  block named separately — with a bounded diff
//   is it status-only             YES only when every changed field is a status field and no
//                                  body, brief or control field changed and no file was added
//                                  or removed; anything else is NO, with the reasons. The label
//                                  is this computation's, never the PR description's claim.
//
// Provenance (B-126's direction): the caller passes each path's commits since the base; authors
// and committers are git's reading — anyone sets an author, so the view names both, and each
// entry may carry the FORGE's reading of the same commit (the account behind the author and
// committer, its signature verification), the fact B-126 adds. A runner without forge access
// shows git's reading alone and must say so beside it, never present it as verified.
/** The fields a status-only change may touch: the ticket's own progress, nothing that steers
 *  work (the control fields are the opposite set, B-126 item 1). `updated` is the filing's
 *  bookkeeping date, `prs` the record of its delivering pull requests. */
export const STATUS_FIELDS = ["status", "prs", "updated"];
/** The ticket frontmatter fields that steer work (B-126 item 1): a change to one is never
 *  status-only, whatever the PR's description says. */
export const CONTROL_FIELDS = ["EXPEDITE", "tier", "requires", "depends_on"];

/** The frontmatter block and the body, split. A file with no leading `---` block is all body. */
export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: "", body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

/** The frontmatter's top-level fields as raw text: each key to its value lines (a block list's
 *  `- item` lines belong to the key above them, at ANY indent — YAML's canonical zero-indent
 *  sequence included — and a block scalar's indented continuation lines belong to their key).
 *  Line-wise, not YAML: the question is what a change altered, and a value that reflows is a
 *  change. Any other non-blank, non-comment line under a key is carried as part of its value
 *  rather than dropped: a shape dropped on both sides reads as UNCHANGED and hides the change
 *  (the computed view fails toward showing one); a line before any key is prose the tickets
 *  never carry. */
export function frontmatterFields(text) {
  const { fm } = splitFrontmatter(text);
  const out = {};
  let key = null;
  for (const line of fm.split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].trim();
    } else if (line.trim() === "" || /^\s*#/.test(line)) {
      continue;
    } else if (key != null) {
      const item = /^(\s*)-\s+(.*)$/.exec(line);
      const part = item ? `- ${item[2]}` : line.trim();
      out[key] = out[key] ? `${out[key]}\n${part}` : part;
    }
  }
  return out;
}

/** The `**Brief:**` block: from its first line outside a fenced code block to the next blank or
 *  `**Label:**` line — the same boundary `bodyDependencies` reads (BATON_SPEC §4), kept simple:
 *  a fence toggles, a label ends. */
export function briefOf(body) {
  const lines = body.split(/\r?\n/);
  let fenced = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:\x60\x60\x60|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
    if (!fenced && /^\*\*Brief:\*\*/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "" && !/^\*\*[^*]+:\*\*/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** A bounded unified diff of two texts: the first `max` changed line PAIRS, each as
 *  `− old` / `+ new`, the number of pairs SHOWN (capped at `max`) and the total pair count —
 *  `pairs > shown` is exactly when the diff was cut. */
export function diffPairs(aText, bText, max = 8) {
  const a = aText.split(/\r?\n/);
  const b = bText.split(/\r?\n/);
  // Longest common subsequence over line equality (ticket bodies are small); trim the common
  // head and tail first so the table stays tiny for one-line changes.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  // table[i][j]: LCS length of midA[i:] and midB[j:]
  const table = Array.from({ length: midA.length + 1 }, () => new Uint32Array(midB.length + 1));
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const minus = [];
  const plus = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) { i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) minus.push(midA[i++]);
    else plus.push(midB[j++]);
  }
  while (i < midA.length) minus.push(midA[i++]);
  while (j < midB.length) plus.push(midB[j++]);
  const pairs = Math.max(minus.length, plus.length);
  const shown = Math.min(pairs, max);
  const lines = [];
  for (let k = 0; k < shown; k++) {
    if (k < minus.length) lines.push(`− ${minus[k]}`);
    if (k < plus.length) lines.push(`+ ${plus[k]}`);
  }
  return { pairs, shown, lines };
}

/** The ticket-ish paths under an items directory (live or archive/): `.mdx` and `.md`, as both
 *  ticket sources read them (BATON_SPEC §4). */
export function ticketPathsUnder(items, paths) {
  const dir = items.replace(/\/$/, "");
  return paths.filter((p) => {
    if (!p.startsWith(`${dir}/`)) return false;
    const rest = p.slice(dir.length + 1);
    if (!/\.(mdx|md)$/.test(rest)) return false;
    return rest.split("/").every((seg) => seg !== "." && seg !== "..");
  });
}

/** The id a ticket file carries: its frontmatter `id:` when it has one, else the basename —
 *  the file-naming convention every items directory keeps (a file named for its id). */
export function ticketId(path, text) {
  const fmId = /^id:\s*(\S+)/m.exec(splitFrontmatter(text).fm)?.[1];
  return fmId ?? path.split("/").pop().replace(/\.(mdx|md)$/, "");
}

/**
 * The computed view. `items` is the items directory ("tickets", "content/roadmap"); `base` and
 * `head` map repo-relative paths to file text (a path absent from a map was not there);
 * `provenance` maps a path to the commits that changed it since the base, each
 * `{sha, author, committer, date, forge?}` — git's reading, named as such where it is shown,
 * with the forge's reading of the same commit (B-126) beside it when the caller could reach it.
 *
 * Returns `{ changed: [...], statusOnly, reasons }` — `changed` one row per ticket file that
 * differs (added, removed or modified), each `{path, id, kind, fields, body, brief, statusOnly,
 * reasons, provenance}`; the top-level `statusOnly` is true only when tickets changed and every
 * one of them is status-only. Never throws on a strange file: a file that is not ticket-shaped
 * still gets a row, its fields read as far as they parse.
 */
export function ticketPrView({ items, base, head, provenance = {} }) {
  const paths = ticketPathsUnder(items, [...new Set([...Object.keys(base), ...Object.keys(head)])]);
  const changed = [];
  for (const path of paths.sort()) {
    const before = base[path];
    const after = head[path];
    const kind = before === undefined ? "added" : after === undefined ? "removed" : before === after ? null : "changed";
    if (kind == null) continue;
    const text = after ?? before ?? "";
    const fields = kind === "changed"
      ? fieldChanges(frontmatterFields(before), frontmatterFields(after))
      : Object.entries(frontmatterFields(text)).map(([field, value]) => ({
        field, ...(kind === "added" ? { to: value } : { from: value }), control: CONTROL_FIELDS.includes(field),
      }));
    const bodyBefore = before === undefined ? "" : splitFrontmatter(before).body;
    const bodyAfter = after === undefined ? "" : splitFrontmatter(after).body;
    const body = bodyBefore === bodyAfter ? { changed: false } : { changed: true, ...diffPairs(bodyBefore, bodyAfter) };
    const briefBefore = briefOf(bodyBefore);
    const briefAfter = briefOf(bodyAfter);
    const brief = briefBefore === briefAfter ? { changed: false } : { changed: true };
    const reasons = [];
    if (kind !== "changed") reasons.push(`file ${kind}`);
    for (const f of fields) {
      if (f.control) reasons.push(`control field ${f.field} changed (${shorten(f.from)} → ${shorten(f.to)})`);
      else if (!STATUS_FIELDS.includes(f.field)) reasons.push(`field ${f.field} changed`);
    }
    if (body.changed) reasons.push("body changed");
    if (brief.changed) reasons.push("brief changed");
    const statusOnly = kind === "changed" && !body.changed && fields.length > 0 && fields.every((f) => STATUS_FIELDS.includes(f.field));
    changed.push({ path, id: ticketId(path, text), kind, fields, body, brief, statusOnly, reasons, provenance: provenance[path] ?? [] });
  }
  const statusOnly = changed.length > 0 && changed.every((c) => c.statusOnly);
  const reasons = statusOnly ? [] : [...new Set(changed.flatMap((c) => c.reasons))];
  return { changed, statusOnly, reasons };
}

/** Which fields moved, old → new, each marked whether it is a control field (B-126 item 1:
 *  `EXPEDITE`, `tier`, `requires`, `depends_on` — the fields that steer work). */
function fieldChanges(before, after) {
  const out = [];
  for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const from = before[field];
    const to = after[field];
    if (from === to) continue;
    out.push({ field, from: from ?? null, to: to ?? null, control: CONTROL_FIELDS.includes(field) });
  }
  return out;
}

const shorten = (v) => (v == null ? "nothing" : v.length > 40 ? `${v.slice(0, 39)}…` : v.replace(/\n/g, " "));

/** The forge's reading of one commit (B-126), when the caller could reach it: the account
 *  behind the git author and committer (null when none is associated) and the commit's
 *  signature verification. */
const forgeLine = (f) =>
  ` · forge: author ${f.author ?? "no forge account"}, committer ${f.committer ?? "no forge account"}, signature ${f.verified ? "verified" : "unverified"}`;

/** One row as the lines a check prints; the caller prefixes and orders them. */
export function formatTicket(c) {
  const lines = [`${c.path} (${c.id}): ${c.kind}`];
  for (const f of c.fields) {
    lines.push(`  ${f.field}: ${shorten(f.from)} → ${shorten(f.to)}${f.control ? "  [control]" : ""}`);
  }
  if (c.brief.changed) lines.push("  **Brief:** changed");
  if (c.body.changed) {
    lines.push(`  body changed (${c.body.pairs} line pair${c.body.pairs === 1 ? "" : "s"}${c.body.pairs > (c.body.shown ?? c.body.lines.length) ? ", diff cut" : ""}):`);
    for (const l of c.body.lines) lines.push(`    ${l}`);
  }
  for (const p of c.provenance) lines.push(`  ${p.sha.slice(0, 10)} ${p.author} (committed by ${p.committer}) ${p.date}${p.forge ? forgeLine(p.forge) : ""}`);
  if (!c.provenance.length) lines.push("  no commit carries this change (working tree)");
  lines.push(`  status-only: ${c.statusOnly ? "yes" : `no — ${c.reasons.join("; ")}`}`);
  return lines;
}

/** The finding when a PR's own description claims what the computation contradicts (B-133: the
 *  label is the check's, never the description's), or null when the claim stands or none was
 *  made. */
export function claimMismatch(view, claimedStatusOnly) {
  if (!claimedStatusOnly) return null;
  if (view.statusOnly) return null;
  const what = view.changed.length
    ? view.reasons.join("; ")
    : "the change touches no ticket";
  return `described status-only, but the computed view says otherwise: ${what}`;
}
