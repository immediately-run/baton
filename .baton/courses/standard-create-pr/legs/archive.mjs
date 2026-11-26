// src/defaults/pr-archive.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync as readFileSync3, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join as join3 } from "node:path";

// src/defaults/agent-words.ts
function splitWords(command) {
  const words = [];
  const SHELL_SYNTAX = /* @__PURE__ */ new Set(["<", ">", ">>", "<<", "|", "||", "&&", ";", "&", "(", ")"]);
  let word = "";
  let started = false;
  let quoted = false;
  const take = () => {
    if (!quoted && SHELL_SYNTAX.has(word)) {
      throw new Error(
        `agent_command has '${word}' as a word: the stub runs it with no shell, so redirections, pipes and lists are not executed \u2014 drop it (stdin is already closed for the agent) or quote it if the agent should receive it literally`
      );
    }
    words.push(word);
    word = "";
    started = false;
    quoted = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === " " || c === "	" || c === "\n") {
      if (started) take();
      continue;
    }
    started = true;
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) throw new Error(`agent_command has an unterminated single quote (at character ${i})`);
      word += command.slice(i + 1, end);
      quoted = true;
      i = end;
    } else if (c === '"') {
      const open = i;
      quoted = true;
      for (i++; ; i++) {
        if (i >= command.length) throw new Error(`agent_command has an unterminated double quote (at character ${open})`);
        const d = command[i];
        if (d === '"') break;
        if (d === "\\" && i + 1 < command.length && '"\\$`'.includes(command[i + 1])) word += command[++i];
        else if (d === "\\" && command[i + 1] === "\n") i++;
        else word += d;
      }
    } else if (c === "\\") {
      if (i + 1 >= command.length) throw new Error("agent_command ends in a backslash with nothing to escape");
      word += command[++i];
      quoted = true;
    } else word += c;
  }
  if (started) take();
  return words;
}

// src/defaults/dibber.ts
var DIBBER_VERSION = "0.4.0";
var DIBBER_PACKAGE = "@immediately-run/dibber";
var VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]{1,32})?$/;
function dibberVersion(settings) {
  const v = settings.dibber;
  if (v == null) return DIBBER_VERSION;
  if (typeof v !== "string" || !VERSION.test(v)) throw new Error(`.baton/baton.json's dibber is ${JSON.stringify(v)}, not a release version (such as "${DIBBER_VERSION}") \u2014 it pins @immediately-run/dibber, it never names a command`);
  return v;
}
function dibberWords(settings, env = process.env) {
  const host = env.BATON_DIBBER?.trim();
  if (host) return splitWords(host);
  return ["npx", "--yes", `${DIBBER_PACKAGE}@${dibberVersion(settings)}`];
}

// src/defaults/git.mjs
import { execFile, execFileSync } from "node:child_process";

// src/client/git-env.mjs
var GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20"
};

// src/defaults/git.mjs
var GIT_TIMEOUT_MS = 3e4;
var argv = (root, args) => root == null ? args : ["-C", root, ...args];
var { GIT_SSH_COMMAND: defaultSsh, ...noPrompts } = GIT_NONINTERACTIVE_ENV;
var limits = ({ timeoutMs = GIT_TIMEOUT_MS, cwd, env, maxBuffer = 16 << 20 }) => ({
  cwd,
  timeout: timeoutMs,
  killSignal: "SIGKILL",
  maxBuffer,
  env: { ...process.env, LC_ALL: "C", ...noPrompts, ...env }
});
function sshProbe(root, args) {
  let i = 0;
  while (args[i] === "-c" || args[i] === "--config-env" || args[i] === "-C" || args[i]?.startsWith("--config-env=")) {
    i += args[i].startsWith("--config-env=") ? 1 : 2;
  }
  return argv(root, [...args.slice(0, i), "config", "--get", "core.sshCommand"]);
}
function gitSync(root, args, limitsOpts, output) {
  const opts = limits(limitsOpts);
  const start = performance.now();
  if (opts.env.GIT_SSH_COMMAND == null && opts.env.GIT_SSH == null) {
    try {
      execFileSync("git", sshProbe(root, args), { ...opts, stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      if (e.status !== 1) throw e;
      opts.env.GIT_SSH_COMMAND = defaultSsh;
    }
  }
  opts.timeout -= Math.ceil(performance.now() - start);
  if (opts.timeout <= 0) throw Object.assign(new Error("git timed out before dispatch"), { code: "ETIMEDOUT" });
  return execFileSync("git", argv(root, args), { ...opts, ...output });
}
function git(root, args, options = {}) {
  const { input, stdio = [input == null ? "ignore" : "pipe", "pipe", "pipe"] } = options;
  return gitSync(root, args, options, { encoding: "utf8", stdio, input });
}
var gitText = (root, ...args) => git(root, args).trim();

// src/defaults/course-pr.ts
var CREATE_PR_ASK_DEADLINE_S = 3 * 60 * 60;

// src/shared/schema.mjs
var SCHEMA_MAX_BYTES = 32 * 1024;

// src/shared/vocabulary.mjs
var CAPABILITIES = [
  "authentication",
  // a signed-in product session (the OAuth round-trip is done)
  "llm-call",
  // a working provider round (key + transport, relayed or browser-direct)
  "create-pr",
  // a GitHub write identity (fork/branch/PR)
  "drivable-browser"
  // an agent-driven Chromium with network/console observation
];
var ROLES = {
  "agent-venue": ["authentication", "llm-call", "create-pr", "drivable-browser"]
};
var RESOURCES = [
  "none",
  "terraform",
  "npm-publish",
  // A NEW package's first publish: the trusted-publisher binding on npmjs.com is set by a
  // scope admin by hand. A version bump of an existing package is `npm-publish`, which the
  // agent line holds (bump + merge; CI publishes through OIDC after the release approval).
  "npm-scope-admin",
  "mcp-chrome",
  "local-host",
  "real-iphone",
  "gcloud-admin",
  "github-admin",
  // BATON_SPEC (2026-10-13): authority on the Cloudflare account behind
  // baton.immediately.run — Workers, Durable Objects, DNS routes, Access, the plan.
  "cloudflare-admin",
  // BATON_SPEC: a session registered with Baton — a runner token for its host and a
  // running sidecar. Agent-held once the fleet is provisioned (AGENT_HOLDS).
  "baton-worker",
  "human-operator",
  // R3-671/672: the standing venue — a ROLE per the 2026-09-22 model; clause-valid
  // during the sweep (items still naming it translate to capabilities).
  "agent-venue"
];
var CLAUSE_NAMES = [.../* @__PURE__ */ new Set([...CAPABILITIES, ...Object.keys(ROLES), ...RESOURCES])];
var AGENT_HOLDS = /* @__PURE__ */ new Set([...CAPABILITIES, "agent-venue", "mcp-chrome", "local-host", "npm-publish", "baton-worker", "none"]);

// src/core/course.ts
var VOCABULARY = /* @__PURE__ */ new Set([...Object.keys(ROLES), ...Object.values(ROLES).flat(), "human-operator", "none"]);
var EXPIRES_AFTER_MAX = 30 * 86400;

// src/core/validate.ts
var REPOSITORY_SRC = "[a-z][a-z0-9-]{0,39}";
var LOCAL_SRC = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}";
var REPOSITORY_ID = new RegExp(`^${REPOSITORY_SRC}$`);
var LOCAL_ID = new RegExp(`^${LOCAL_SRC}$`);
var TICKET_ID = new RegExp(`^(${REPOSITORY_SRC}):(${LOCAL_SRC})$`);
var DEPENDENCY_ID = new RegExp(`^(?:${REPOSITORY_SRC}:${LOCAL_SRC}|${LOCAL_SRC})$`);
var NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
var HOLDING_TYPE = "[a-z][a-z0-9-]{0,31}";
var HOLDING_VALUE = "[A-Za-z0-9:._/@-]{1,128}";
var HOLDING = new RegExp(`^${HOLDING_TYPE}:${HOLDING_VALUE}$`);
var REPORT_HORIZON_MS = 6 * 36e5;
var NUM = "number";
var BOOL = "boolean";
var PR = "pr";
var TEXT = "text";
var COMMON = { pr: PR, exit_code: NUM, note: TEXT };
var DETAIL_SCHEMAS = {
  orient: { ...COMMON },
  implement: { ...COMMON },
  "local-verify": { ...COMMON, passed: BOOL },
  "open-pr": { ...COMMON },
  push: { ...COMMON, branch: TEXT, sha: TEXT },
  "ci-wait": { ...COMMON, conclusion: TEXT },
  "review-round": { ...COMMON, findings: NUM, blocking: NUM, should_fix: NUM, nit: NUM },
  reviewer: { ...COMMON, agent: TEXT, model: TEXT, substituted_for: TEXT, findings: NUM, blocking: NUM },
  "fix-findings": { ...COMMON, fixed: NUM, argued: NUM },
  adjudicate: { ...COMMON, reproduced: BOOL },
  merge: { ...COMMON, sha: TEXT },
  reconcile: { ...COMMON, archived: NUM },
  "status-write": { ...COMMON, status: TEXT, item: TEXT },
  "decision-packet": { ...COMMON, item: TEXT },
  other: { ...COMMON }
};
var CAPABILITY_NAME = new RegExp(`^(?:${NAME.source}|${HOLDING.source.slice(1, -1)})$`);
var VALID_FOR = { default_s: 3600, state_s: 24 * 3600, measure_s: 31 * 24 * 3600 };

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

// src/defaults/read-items.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
function readItems(root, items = "tickets") {
  const dir = join(root, items);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/")).sort().map((path) => ({ path, text: readFileSync(join(dir, path), "utf8") }));
}

// src/defaults/output-evidence.ts
var MAX = 256 * 1024;

// src/defaults/ticket-state.ts
import { execFileSync as execFileSync2 } from "node:child_process";
var CLOSE_TIMEOUT_MS = 12e4;
var exec = (cmd, args, cwd, opts = {}) => cmd === "git" ? git(null, args, { ...opts, cwd, timeoutMs: opts.timeoutMs ?? CLOSE_TIMEOUT_MS }).trim() : execFileSync2(cmd, args, {
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
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var NUMBER = "\\d+";
function readTicketSettings(root, where = root) {
  const path = join2(root, ".baton", "baton.json");
  if (!existsSync2(path)) throw new Error(`${where} has no .baton/baton.json \u2014 the ticket commands write the tickets a sync reads; run \`baton repo init\` there first`);
  let json;
  try {
    json = JSON.parse(readFileSync2(path, "utf8"));
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

// src/defaults/pr-archive.ts
function archiveClose(ctx, result) {
  const answer = ctx.person_answer;
  if (ctx.leg !== "archive" || ctx.claim?.station !== "confirmed" || result?.reached !== "archived" || answer?.leg !== "confirm" || answer.option !== "confirmed" || !/^(owner|human):/.test(answer.answered_by)) {
    throw new Error("archive requires the owner's applied confirmed answer");
  }
  const end = ctx.previous_attempts?.find((p) => p.end_reason === "suspended:delivered" && p.legs.some((l) => l.reached === "delivered" && l.outcome === "finished"));
  const first = end?.ended_at_sha;
  const detail = end?.detail ?? "";
  const legacy = /^delivered at ((?:[0-9a-f]{10}, ){14}[0-9a-f]{10}), [0-9a-f]{6}…$/.exec(detail);
  const commits = (legacy?.[1] ?? /^delivered at ([0-9a-f]{10}(?:, [0-9a-f]{10})*)(?:: |$)/.exec(detail)?.[1])?.split(", ");
  if (!end || end.ended_at == null || end.ended_at > answer.answered_at || !first || !/^[0-9a-f]{40}$/.test(first) || commits?.[0] !== first.slice(0, 10)) {
    throw new Error("archive requires the confirmed delivery's end evidence");
  }
  if (!ctx.ticket.path) throw new Error("archive requires a ticket file in git");
  const branch = ticketsBranch(ctx.checkout, ctx.default_branch);
  const pin = ctx.signed_control?.agent_command ?? ctx.snapshot?.sha;
  if (!pin || !/^[0-9a-f]{40}$/.test(pin)) throw new Error("archive requires its snapshot to read the Dibber pin");
  const settings = JSON.parse(gitText(ctx.checkout, "show", `${pin}:.baton/baton.json`));
  return archiveTicket(ctx.checkout, branch, bareTicketId(ctx.ticket), {
    path: ctx.ticket.path,
    shas: [first, ...commits.slice(1)],
    truncated: legacy != null,
    dibber: dibberWords(settings)
  });
}
var TRIES = 6;
var movedOnPush = (detail) => /non-fast-forward|fetch first|stale info/.test(detail);
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
function archiveTicket(root, branch, id, delivered) {
  if (!/^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(id)) throw new Error(`${id}: invalid archive ticket id`);
  const describe = `${id} \u2192 done`;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    gitText(root, "fetch", "-q", "origin", branch);
    const dir = mkdtempSync(join3(tmpdir(), "baton-archive-"));
    try {
      gitText(root, "worktree", "add", "-q", "--detach", dir, "FETCH_HEAD");
      const done = archiveIn(dir, branch, id, delivered);
      if ("existing" in done) return done.existing;
      const trailers = (process.env.TICKET_TRAILERS ?? "").trim();
      if (!trailers && process.env.TICKET_REQUIRE_TRAILERS === "1") throw new Error(`${describe}: TICKET_REQUIRE_TRAILERS=1, but TICKET_TRAILERS is empty`);
      gitText(dir, "commit", "-q", "-m", trailers ? `${done.message}

${trailers}` : done.message);
      try {
        gitText(dir, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
        return gitText(dir, "rev-parse", "HEAD");
      } catch (e) {
        const detail = String(e.stderr || e.message);
        if (!movedOnPush(detail)) {
          const why = detail.trim().split("\n").map((l) => l.trim()).filter((l) => l !== "" && !/^To /.test(l) && !/failed to push some refs/.test(l));
          throw new Error(`${describe}: the push was refused: ${why.join("; ") || "no reason given"}`);
        }
        if (attempt === TRIES) throw new Error(`${describe}: push refused ${TRIES} times: ${detail.trim().split("\n").at(-1)}`);
      }
    } finally {
      try {
        gitText(root, "worktree", "remove", "--force", dir);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  throw new Error(`${describe}: no archive attempt completed`);
}
function archiveIn(dir, branch, id, delivered) {
  const settings = readTicketSettings(dir, dir);
  const items = (settings.items ?? "tickets").replace(/\/$/, "");
  regularDirs(dir, items, true);
  const matches = readItems(dir, items).filter((f) => /\.mdx?$/i.test(f.path) && parseFrontmatter(f.text)?.id === id);
  if (!matches.length) throw new Error(`${id}: no ${items}/${id}.mdx on origin/${branch}`);
  if (matches.length !== 1) throw new Error(`${id}: archive cannot identify a single ticket file`);
  const { path, text } = matches[0];
  const archived = path.startsWith("archive/");
  const from = `${items}/${path}`;
  const to = `${items}/archive/${path}`;
  if (delivered.path !== (archived ? `${items}/${path.slice("archive/".length)}` : from)) {
    throw new Error(`${id}: archive requires the markdown source's current ticket path`);
  }
  const shas = resolveDelivered(delivered.shas, "HEAD", dir, (_cmd, args2, cwd) => gitText(cwd, ...args2));
  const subject = `tickets: ${id} done (archived)`;
  const delivery = `Delivered by: ${shas.join(", ")}`;
  const limitation = "Delivery evidence incomplete: the legacy end record was truncated; unrecorded commits are not listed.";
  if (archived) {
    if (parseFrontmatter(text)?.status !== "done") throw new Error(`${id} is archived (done)`);
    const existing = gitText(dir, "--literal-pathspecs", "log", "-1", "--first-parent", "--no-renames", "--diff-filter=A", "--format=%H", "--", from);
    if (existing) {
      const [first, , third, , note] = gitText(dir, "show", "-s", "--format=%B", existing).split("\n");
      if (first === subject && third === delivery && note === limitation === delivered.truncated) return { existing };
    }
    throw new Error(`${id}: the archive does not record this delivery`);
  }
  if (!new RegExp(`^${id}\\.mdx?$`).test(basename(path))) {
    throw new Error(`${id}: ${from} is not named ${id}.md or ${id}.mdx, so Dibber cannot write it \u2014 rename it, then archive again`);
  }
  regularDirs(dir, dirname(to), true);
  if (lstatSync(join3(dir, to), { throwIfNoEntry: false })) throw new Error(`${id}: archive destination already exists`);
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  if ((frontmatter.match(/^status:/gm) ?? []).length > 1) throw new Error(`${id}: duplicate status fields; archive refused`);
  const [cmd, ...args] = delivered.dibber;
  let said;
  try {
    said = JSON.parse(execFileSync3(cmd, [...args, "done", id, "--root", dir, "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 12e4,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_ignore_scripts: "true" }
    }));
  } catch (e) {
    const why = String(e.stderr || e.message).trim().split("\n").at(-1);
    throw new Error(`${id}: dibber done failed: ${why}`);
  }
  if (said?.id !== id || said.file !== from || said.status !== "done" || parseFrontmatter(readFileSync3(join3(dir, from), "utf8"))?.status !== "done") {
    throw new Error(`${id}: Dibber did not mark ${from} done`);
  }
  mkdirSync(dirname(join3(dir, to)), { recursive: true });
  gitText(dir, "--literal-pathspecs", "mv", from, to);
  gitText(dir, "--literal-pathspecs", "add", "--", to);
  return { message: `${subject}

${delivery}${delivered.truncated ? `

${limitation}` : ""}` };
}

// baton-default.ts
var run = () => ({ reached: "archived", next: null });
var close = archiveClose;
async function handoff() {
  return null;
}
export {
  close,
  handoff,
  run
};
