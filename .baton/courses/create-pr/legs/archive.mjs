// generated archive entry
import { execFileSync as execFileSync3 } from "node:child_process";
import { mkdtempSync as mkdtempSync2, readdirSync as readdirSync2, rmSync as rmSync2, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join4 } from "node:path";
import { pathToFileURL } from "node:url";

// src/defaults/tickets-transaction.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync3, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join as join3 } from "node:path";

// src/defaults/course-pr.ts
var CREATE_SPEC_COURSE = {
  start: "requested",
  start_leg: "converse",
  end: ["merged"],
  // B-98: a specification is requested, not found — `baton request "<one sentence>" --course
  // create-spec` files the ticket that starts it.
  starts_from: "request",
  short_waits: ["ci"],
  stations: {
    requested: { label: "Requested, no PR yet" },
    "spec-open": { label: "Spec PR open" },
    reviewed: { label: "Reviewed" },
    adjudicated: { label: "Open findings adjudicated" },
    merged: { label: "Merged" }
  },
  legs: {
    converse: { from: ["requested"], to: "spec-open", label: "Design the specification with the owner" },
    review: { from: ["spec-open"], to: "reviewed", max_runs: 4, label: "Adversarial review round" },
    address: { from: ["reviewed"], to: "spec-open", max_runs: 3, label: "Address the blocking findings with the owner" },
    adjudicate: { from: ["reviewed"], to: "adjudicated", label: "Reproduce the findings left open" },
    merge: { from: ["reviewed", "adjudicated"], to: "merged", label: "Merge and close the ticket" }
  }
};
var SPEC_BOUNDS = {
  legs: { open: "converse", opened: "spec-open", back: "address", backTo: "spec-open" },
  back: "address",
  rounds: CREATE_SPEC_COURSE.legs.review.max_runs,
  adjudicates: true,
  gate: false
};

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

// src/defaults/pr-verify.ts
var ancestor = (a, b, run2, checkout) => {
  try {
    run2("git", ["merge-base", "--is-ancestor", a, b], checkout);
    return true;
  } catch {
    return false;
  }
};
function resolveDelivered(shas, ref, checkout, run2) {
  return shas.map((sha) => {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error("invalid delivered commit id");
    let full;
    try {
      full = run2("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], checkout).trim();
    } catch {
      throw new Error(`the implement agent answered delivered at ${sha}, which names no commit this checkout knows \u2014 refused`);
    }
    if (!/^[0-9a-f]{40}$/.test(full) || !full.startsWith(sha)) throw new Error(`the implement agent answered delivered at ${sha}, which names no commit this checkout knows \u2014 refused`);
    if (!ancestor(full, ref, run2, checkout)) {
      const branch = ref.replace(/^refs\/remotes\/origin\//, "");
      throw new Error(`the implement agent answered delivered at ${sha}, which is not on ${branch} \u2014 refused: the commit a delivered answer names is on the default branch`);
    }
    return full;
  });
}

// src/defaults/ticket-state.ts
import { execFileSync } from "node:child_process";
var CLOSE_TIMEOUT_MS = 12e4;
var GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20"
};
var exec = (cmd, args, cwd, opts = {}) => execFileSync(cmd, args, {
  cwd,
  encoding: "utf8",
  timeout: opts.timeoutMs ?? CLOSE_TIMEOUT_MS,
  killSignal: "SIGKILL",
  ...opts.input != null ? { input: opts.input } : { stdio: ["ignore", "pipe", "pipe"] },
  env: { ...process.env, ...GIT_NONINTERACTIVE_ENV, ...opts.env }
}).trim();
function bareTicketId(ticket) {
  if (ticket.home && ticket.id.startsWith(`${ticket.home}:`)) return ticket.id.slice(ticket.home.length + 1);
  const colon = ticket.id.indexOf(":");
  return colon < 0 ? ticket.id : ticket.id.slice(colon + 1);
}
var DEFAULT_TICKETS_BRANCH = "main";
function ticketsBranch(checkout, named, run2 = exec) {
  const plain = (b) => typeof b === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(b) && !b.includes("..") && !b.endsWith("/") ? b : null;
  const given = plain(named);
  if (given) return given;
  try {
    const head = run2("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], checkout).trim().replace(/^origin\//, "");
    return plain(head) ?? DEFAULT_TICKETS_BRANCH;
  } catch {
    return DEFAULT_TICKETS_BRANCH;
  }
}

// src/defaults/tickets-config.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var NUMBER = "\\d+";
var GITHUB_PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
function readTicketSettings(root, where = root) {
  const path = join(root, ".baton", "baton.json");
  if (!existsSync(path)) throw new Error(`${where} has no .baton/baton.json \u2014 the ticket commands write the tickets a sync reads; run \`baton repo init\` there first`);
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`.baton/baton.json is not JSON: ${e.message.split("\n")[0]}`);
  }
  const texts = (v) => (Array.isArray(v) ? v : typeof v === "string" && v !== "" ? [v] : []).filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  const str = (v) => typeof v === "string" && v.trim() !== "" ? v.trim() : void 0;
  const project = str(json.project);
  if (json.project != null && project === void 0) throw new Error(".baton/baton.json: project is a project id, not an empty value");
  const legacy_ids = texts(json.legacy_ids);
  return {
    items: str(json.items),
    ticket_prefix: str(json.ticket_prefix),
    legacy_ids,
    project,
    prefixes: prefixesOf(json.prefixes, legacy_ids, str(json.ticket_prefix)),
    tags: tagsOf(json),
    projects: str(json.projects) ?? "projects"
  };
}
function tagsOf(json) {
  const v = json.tags;
  const tags = (Array.isArray(v) ? v : typeof v === "string" && v !== "" ? [v] : []).filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
  return tags.length ? tags : ["roadmap-item"];
}
var SOURCE_FORM = /^\\d(\+|(\{\d+\}|\[a-z\]\?\d\*)?)$/;
function prefixesOf(prefixes, legacy, allocating) {
  if (prefixes != null && (typeof prefixes !== "object" || Array.isArray(prefixes))) throw new Error(".baton/baton.json: prefixes maps an id prefix to its pattern source");
  const map = {};
  for (const [prefix, source] of Object.entries(prefixes ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9]*-$/.test(prefix) || typeof source !== "string" || !SOURCE_FORM.test(source)) {
      throw new Error(`.baton/baton.json: prefixes.${prefix} is an id prefix (\`B-\`) whose pattern this release cannot read \u2014 write its number as \\d+ or \\d{7}, not ${JSON.stringify(source)}`);
    }
    map[prefix] = source;
  }
  for (const id of legacy) {
    const m = /^([A-Za-z][A-Za-z0-9]*)-([^()^$|]*\\d[^()^$|]*)$/.exec(id);
    if (!m) throw new Error(`.baton/baton.json: legacy_ids names ${id}, which is not an id pattern (\`R3-\\d+\`)`);
    map[`${m[1]}-`] = m[2];
  }
  const allocatingPrefix = allocating && /^[A-Za-z][A-Za-z0-9]*$/.test(allocating) ? `${allocating}-` : "B-";
  if (map[allocatingPrefix] == null) map[allocatingPrefix] = NUMBER;
  return map;
}
function idPattern(settings, prefix) {
  const source = settings.prefixes[prefix] ?? NUMBER;
  return new RegExp(`^${prefix}${source.includes("\\d") ? source : `${source}${NUMBER}`}$`);
}
function accepts(settings, id) {
  const prefix = Object.keys(settings.prefixes).filter((p) => id.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  return prefix != null && idPattern(settings, prefix).test(id);
}

// src/defaults/tickets-file.ts
var fenceOf = (text) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  return m ? { lines: m[1].split(/\r?\n/), rest: text.slice(m[0].length) } : null;
};
function setKey(text, key, value) {
  const fence = fenceOf(text);
  if (!fence) throw new Error(`${key}: the file has no frontmatter`);
  const line = `${key}: ${value}`;
  const i = fence.lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  const lines = i < 0 ? [...fence.lines, line] : fence.lines.map((l, j) => j === i ? line : l);
  return `---
${lines.join("\n")}
---${fence.rest}`;
}
function addPr(text, url) {
  const fence = fenceOf(text);
  if (!fence) throw new Error("the ticket has no frontmatter to add a pull request to");
  if (fence.lines.some((l) => l.includes(url))) return text;
  const i = fence.lines.findIndex((l) => /^prs:(?:\s*\[\])?\s*$/.test(l));
  if (i < 0) throw new Error("the ticket has no prs list to add to");
  let end = i + 1;
  while (end < fence.lines.length && /^\s+-\s+/.test(fence.lines[end])) end++;
  const lines = end > i + 1 ? [...fence.lines.slice(0, end), `  - ${url}`, ...fence.lines.slice(end)] : [...fence.lines.slice(0, i), "prs:", `  - ${url}`, ...fence.lines.slice(i + 1)];
  return `---
${lines.join("\n")}
---${fence.rest}`;
}

// src/defaults/read-items.ts
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2 } from "node:fs";
import { join as join2, relative, sep } from "node:path";
function readItems(root, items = "tickets") {
  const dir = join2(root, items);
  if (!existsSync2(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join2(e.parentPath, e.name)).split(sep).join("/")).sort().map((path) => ({ path, text: readFileSync2(join2(dir, path), "utf8") }));
}

// src/defaults/tickets-transaction.ts
var TICKET_TRIES = 6;
var git = (root, ...a) => execFileSync2("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } }).trim();
var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
var movedOnPush = (detail) => /non-fast-forward|fetch first|stale info/.test(detail);
var detailOf = (e) => {
  const err = e;
  return typeof err?.stderr === "string" ? err.stderr : err?.stderr ? new TextDecoder().decode(err.stderr) : err?.message ?? String(e);
};
function ticketCommitMessage(message, trailers, requireTrailers = false) {
  const lines = trailers.trim();
  if (!lines) {
    if (requireTrailers) throw new Error("TICKET_REQUIRE_TRAILERS=1, but TICKET_TRAILERS is empty \u2014 set it to the session's provenance lines (the agent-provenance trailers, then Claude-Session and Co-Authored-By), or unset TICKET_REQUIRE_TRAILERS to commit without them");
    return message;
  }
  return `${message}

${lines}`;
}
function transact(root, io, describe, change) {
  const log = io.log ?? ((l) => process.stdout.write(`${l}
`));
  const warn = io.warn ?? ((l) => process.stderr.write(`${l}
`));
  const remote = io.remote ?? "origin";
  const branch = io.branch ?? ticketsBranch(root, null);
  const trailers = (io.trailers ?? process.env.TICKET_TRAILERS ?? "").trim();
  const requireTrailers = io.requireTrailers ?? process.env.TICKET_REQUIRE_TRAILERS === "1";
  for (let attempt = 1; attempt <= TICKET_TRIES; attempt++) {
    git(root, "fetch", "-q", remote, branch);
    const dir = mkdtempSync(join3(tmpdir(), "baton-tickets-"));
    try {
      git(root, "worktree", "add", "-q", "--detach", dir, "FETCH_HEAD");
      const changed = change(dir);
      if ("existing" in changed) return changed.existing;
      const { message, write, move } = changed;
      const written = new Set(write.map((w) => w.path));
      for (const m of move) {
        mkdirSync(dirname(join3(dir, m.to)), { recursive: true });
        if (written.has(m.to)) rmSync(join3(dir, m.from), { force: true });
        else renameSync(join3(dir, m.from), join3(dir, m.to));
      }
      for (const w of write) {
        mkdirSync(dirname(join3(dir, w.path)), { recursive: true });
        writeFileSync(join3(dir, w.path), w.text);
      }
      git(dir, "--literal-pathspecs", "add", "-A", "--", .../* @__PURE__ */ new Set([...write.map((w) => w.path), ...move.map((m) => m.from)]));
      const staged = (() => {
        try {
          git(dir, "diff", "--cached", "--quiet");
          return false;
        } catch {
          return true;
        }
      })();
      if (!staged) {
        if (attempt === TICKET_TRIES) throw new Error(`${describe}: nothing to commit after ${TICKET_TRIES} tries`);
        warn(`\u2026 ${describe}: nothing to commit \u2014 a peer landed the same change; retrying (${attempt}/${TICKET_TRIES})`);
        continue;
      }
      git(dir, "commit", "-q", "-m", ticketCommitMessage(message, trailers, requireTrailers));
      try {
        git(dir, "push", "-q", remote, `HEAD:refs/heads/${branch}`);
        if (!io.quiet) log(`\u2713 ${message.split("\n")[0]} \u2014 pushed as ${git(dir, "rev-parse", "--short", "HEAD")}`);
        return git(dir, "rev-parse", "HEAD");
      } catch (e) {
        const detail = detailOf(e);
        if (!movedOnPush(detail)) {
          const why = detail.trim().split("\n").map((l) => l.trim()).filter((l) => l !== "" && !/^To /.test(l) && !/failed to push some refs/.test(l));
          const refusal = new Error(`${describe}: the push was refused: ${why.join("; ") || "no reason given"}`);
          refusal.detail = detail;
          throw refusal;
        }
        if (attempt === TICKET_TRIES) throw new Error(`${describe}: push refused ${TICKET_TRIES} times: ${detail.trim().split("\n").at(-1)}`);
        warn(`\u2026 ${describe}: ${remote}/${branch} moved; retrying on the new head (${attempt}/${TICKET_TRIES})`);
      }
    } finally {
      try {
        git(root, "worktree", "remove", "--force", dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  throw new Error(`${describe}: no transaction attempt completed`);
}
var settingsAt = (dir, remote, branch) => readTicketSettings(dir, `${remote}/${branch}`);
var acceptedList = (settings) => Object.keys(settings.prefixes).sort().map((p) => `${p}\u2026`).join(", ");
function regularDirs(root, path, missingOk = false) {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw new Error(`invalid ticket directory: ${path}`);
  for (const part of parts) {
    root = join3(root, part);
    const stat = lstatSync(root, { throwIfNoEntry: false });
    if (!stat && missingOk) return;
    if (!stat?.isDirectory()) throw new Error(`not a regular ticket directory: ${path}`);
  }
}
function archiveTicket(root, io, id, evidence) {
  const { pr, delivered } = evidence;
  if (pr != null && !GITHUB_PR.test(pr)) throw new Error(`--pr ${pr} is not a GitHub pull request URL`);
  const date = io.date ?? today();
  const remote = io.remote ?? "origin";
  const branch = io.branch ?? ticketsBranch(root, null);
  return transact(root, io, `${id} \u2192 done`, (dir) => {
    const settings = settingsAt(dir, remote, branch);
    if (!delivered && !accepts(settings, id)) throw new Error(`${id} is not a ticket id of this repository \u2014 its ids are ${acceptedList(settings)}`);
    const items = (settings.items ?? "tickets").replace(/\/$/, "");
    regularDirs(dir, items, true);
    const matches = readItems(dir, items).filter((f) => /\.mdx?$/i.test(f.path) && parseFrontmatter(f.text)?.id === id);
    if (!matches.length) throw new Error(`${id}: no ${items}/${id}.mdx on ${remote}/${branch}`);
    if (matches.length !== 1) throw new Error(`${id}: archive cannot identify a single ticket file`);
    let { path, text } = matches[0];
    const archived = path.startsWith("archive/");
    const from = `${items}/${path}`;
    const to = `${items}/archive/${path}`;
    if (delivered && delivered.path !== (archived ? `${items}/${path.slice("archive/".length)}` : from)) {
      throw new Error(`${id}: archive requires the markdown source's current ticket path`);
    }
    const shas = delivered ? resolveDelivered(delivered.shas, "HEAD", dir, (_cmd, args, cwd) => git(cwd, ...args)) : [];
    const subject = `tickets: ${id} done (archived)`;
    const delivery = `Delivered by: ${shas.join(", ")}`;
    if (archived) {
      if (!delivered || parseFrontmatter(text)?.status !== "done") throw new Error(`${id} is archived (done)`);
      const existing = git(dir, "--literal-pathspecs", "log", "-1", "--first-parent", "--no-renames", "--diff-filter=A", "--format=%H", "--", from);
      if (existing) {
        const [first, , third] = git(dir, "show", "-s", "--format=%B", existing).split("\n");
        if (first === subject && third === delivery) return { existing };
      }
      throw new Error(`${id}: the archive does not record this delivery`);
    }
    regularDirs(dir, dirname(to), true);
    if (lstatSync(join3(dir, to), { throwIfNoEntry: false })) throw new Error(`${id}: archive destination already exists`);
    text = setKey(setKey(text, "status", "done"), "updated", date);
    if (pr) text = addPr(text, pr);
    const body = shas.length ? `

${delivery}` : pr ? `

${pr}` : "";
    return { message: `${subject}${body}`, write: [{ path: to, text: deepenRelativeLinks(text) }], move: [{ from, to }] };
  });
}
function deepenRelativeLinks(text) {
  return text.replace(/\]\((\.\.?\/)/g, (_m, lead) => `](${lead === "./" ? "../" : "../../"}`);
}

// src/defaults/pr-archive.ts
function archiveClose(ctx, result) {
  const answer = ctx.person_answer;
  if (ctx.leg !== "archive" || ctx.claim?.station !== "confirmed" || result?.reached !== "archived" || answer?.leg !== "confirm" || answer.option !== "confirmed" || !/^(owner|human):/.test(answer.answered_by)) {
    throw new Error("archive requires the owner's applied confirmed answer");
  }
  const end = ctx.previous_attempts?.find((p) => p.end_reason === "suspended:delivered" && p.legs.some((l) => l.reached === "delivered" && l.outcome === "finished"));
  const first = end?.ended_at_sha;
  const commits = /^delivered at ([0-9a-f]{10}(?:, [0-9a-f]{10})*)(?:: |$)/.exec(end?.detail ?? "")?.[1]?.split(", ");
  if (!end || end.ended_at == null || end.ended_at > answer.answered_at || !first || !/^[0-9a-f]{40}$/.test(first) || commits?.[0] !== first.slice(0, 10)) {
    throw new Error("archive requires the confirmed delivery's end evidence");
  }
  if (!ctx.ticket.path) throw new Error("archive requires a ticket file in git");
  const branch = ticketsBranch(ctx.checkout, ctx.default_branch);
  return archiveTicket(ctx.checkout, { branch }, bareTicketId(ctx.ticket), {
    delivered: { path: ctx.ticket.path, shas: [first, ...commits.slice(1)] }
  });
}

// generated archive entry
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (cmd, args, opts = {}) => execFileSync3(cmd, args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], ...opts });
async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read its override at");
  const readSha = typeof ctx.signed_control?.overrides === "string" && ctx.signed_control.overrides !== "" ? ctx.signed_control.overrides : sha;
  const rel = ".baton/courses/create-pr/legs/archive.run.mjs";
  if (gitRun("git", ["-C", ctx.checkout, "ls-tree", "--name-only", readSha, "--", rel]).trim() === "") return standard(ctx);
  const dir = mkdtempSync2(join4(tmpdir2(), "baton-override-"));
  try {
    const file = join4(dir, "archive.run.mjs");
    writeFileSync2(file, gitRun("git", ["-C", ctx.checkout, "show", readSha + ":" + rel], { maxBuffer: 67108864 }));
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== "function") throw new Error(rel + " exports no run(ctx, standard)");
    return await mod.run(ctx, standard);
  } finally {
    rmSync2(dir, { recursive: true, force: true });
  }
}
async function standard(ctx) {
  return { reached: "archived", next: null };
}
var closeCtx2 = (ctx) => ({ ...ctx, ...ctx.default_branch == null && typeof process.env.BATON_DEFAULT_BRANCH === "string" && process.env.BATON_DEFAULT_BRANCH !== "" ? { default_branch: process.env.BATON_DEFAULT_BRANCH } : {} });
var close = (ctx, result) => archiveClose(closeCtx2(ctx), result);
async function handoff() {
  return null;
}
export {
  close,
  handoff,
  run
};
