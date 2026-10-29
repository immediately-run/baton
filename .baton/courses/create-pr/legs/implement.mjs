// ../../../../tmp/baton-bundle-bkskTT/entry.ts
import { execFileSync as execFileSync2, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync as rmSync2, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { pathToFileURL } from "node:url";

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

// src/defaults/ticket-state.ts
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

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

// src/defaults/ticket-state.ts
var MACHINE_KEYS = ["station", "next_leg", "claim"];
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
var PUSH_TRIES = 3;
var movedOnRemote = (e) => {
  const err = e;
  return /! \[rejected\]|non-fast-forward|\(fetch first\)/.test(`${String(err?.stderr ?? "")}
${String(err?.message ?? "")}`);
};
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
var tmpIndexName = "baton-ticket-index";
function tmpIndex(checkout, run2 = exec) {
  const rel = run2("git", ["rev-parse", "--git-path", tmpIndexName], checkout).trim();
  return /^\//.test(rel) ? rel : join(checkout, rel);
}
function itemSchemaPath(ticketPath) {
  const dir = ticketPath.split("/").slice(0, -1).join("/");
  return dir === "" ? "item.schema.json" : `${dir}/item.schema.json`;
}
var COURSE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
function setMachineKeys(text, state) {
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!fm) throw new Error("the ticket file has no frontmatter block");
  const block = fm[0];
  const eol = block.includes("\r\n") ? "\r\n" : "\n";
  const kept = [];
  let dropping = false;
  for (const line of block.split(/\r?\n/)) {
    if (/^(station|next_leg|claim):/.test(line)) {
      dropping = true;
      continue;
    }
    if (dropping && /^\s+-\s+/.test(line)) continue;
    dropping = false;
    kept.push(line);
  }
  const entries = [`station: ${state.station}`];
  if (state.next_leg != null) entries.push(`next_leg: ${state.next_leg}`);
  if (state.claim != null) entries.push(`claim: ${state.claim}`);
  const closing = kept.pop();
  const next = [...kept, ...entries, closing].join(eol);
  return next + text.slice(block.length);
}
function legHeadingPresent(text, leg) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
  return new RegExp(`^##[ \\t]+${leg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "im").test(body);
}
function checkFrontmatter(schema, fm, ignore = []) {
  const out = [];
  const fail = (why) => out.push(why);
  const skipped = new Set(ignore);
  if (schema == null || typeof schema !== "object" || Array.isArray(schema)) return ["item.schema.json is not a schema object"];
  const s = schema;
  const defs = typeof s.definitions === "object" && s.definitions != null && !Array.isArray(s.definitions) ? s.definitions : {};
  const shapeOf = (key, p) => {
    if (p == null || typeof p !== "object" || Array.isArray(p)) return null;
    const prop = { ...p };
    if (typeof prop.$ref === "string") {
      const m = /^#\/definitions\/([A-Za-z0-9_-]+)$/.exec(prop.$ref);
      if (!m) {
        fail(`${key}: a $ref other than #/definitions/<name> (${prop.$ref})`);
        return null;
      }
      const target = defs[m[1]];
      if (target == null || typeof target !== "object" || Array.isArray(target)) {
        fail(`${key}: $ref ${prop.$ref} names no definition`);
        return null;
      }
      delete prop.$ref;
      return { ...target, ...prop };
    }
    return prop;
  };
  const checked = /* @__PURE__ */ new Set([`$schema`, `$id`, `title`, `description`, `type`, `required`, `properties`, `propertyNames`, `definitions`, "additionalProperties"]);
  for (const k of Object.keys(s)) if (!checked.has(k)) fail(`the schema uses "${k}", which the boundary check does not implement`);
  if (Array.isArray(s.required)) {
    for (const key of s.required) if (typeof key === "string" && !(key in fm) && !skipped.has(key)) fail(`the ticket has no ${key}`);
  } else if (s.required !== void 0) fail("required is not a list");
  if (s.properties != null) {
    if (typeof s.properties !== "object" || Array.isArray(s.properties)) fail("properties is not an object");
    else {
      for (const [key, p] of Object.entries(s.properties)) {
        if (!(key in fm) || skipped.has(key)) continue;
        const prop = shapeOf(key, p);
        if (prop == null) continue;
        for (const k of Object.keys(prop)) if (!["type", "enum", "pattern", "description", "title"].includes(k)) fail(`${key}: the property uses "${k}", which the boundary check does not implement`);
        const v = fm[key];
        if (prop.type === "string" && typeof v !== "string") fail(`${key} is not a string`);
        if (Array.isArray(prop.enum) && !prop.enum.some((e) => e === v)) fail(`${key} ${JSON.stringify(v)} is not one of ${prop.enum.map((e) => String(e)).join(", ")}`);
        if (typeof prop.pattern === "string" && (typeof v !== "string" || !new RegExp(prop.pattern).test(v))) fail(`${key} ${JSON.stringify(v)} does not match ${prop.pattern}`);
      }
    }
  }
  if (s.propertyNames != null) {
    const names = s.propertyNames;
    if (typeof names !== "object" || !Array.isArray(names.enum)) fail("propertyNames.enum is not a list");
    else for (const key of Object.keys(fm)) if (!names.enum.includes(key) && !skipped.has(key)) fail(`the ticket has an unknown key ${key}`);
  }
  return out;
}
function checkMachine(state) {
  const out = [];
  if (!COURSE_NAME.test(state.station)) out.push(`station ${JSON.stringify(state.station)} is not a station id`);
  if (state.next_leg != null && !COURSE_NAME.test(state.next_leg)) out.push(`next_leg ${JSON.stringify(state.next_leg)} is not a leg id`);
  if (state.claim != null && (state.claim === "" || state.claim.length > 64 || !/^[A-Za-z0-9._-]+$/.test(state.claim))) out.push("claim is not a nonce");
  return out;
}
async function closeTicket(ctx, result, run2 = exec) {
  if (typeof result?.reached !== "string" || result.reached === "") throw new Error(`the ${ctx.leg} leg returned no station reached`);
  if (ctx.ticket.path == null || ctx.ticket.path === "") throw new Error(`the ${ctx.leg} leg's ticket has no file path to write`);
  const id = bareTicketId(ctx.ticket);
  const state = { station: result.reached, next_leg: result.next ?? null, claim: ctx.claim?.nonce ?? null };
  const branch = ticketsBranch(ctx.checkout, ctx.default_branch ?? null, run2);
  const git = (args, opts = {}) => run2("git", args, ctx.checkout, opts);
  const ref = `origin/${branch}`;
  const index = tmpIndex(ctx.checkout, run2);
  const env = { GIT_INDEX_FILE: index };
  try {
    for (let tries = 1; ; tries++) {
      git(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/${ref}`]);
      const parent = git(["rev-parse", "--verify", `${ref}^{commit}`]);
      let text;
      try {
        text = git(["show", `${ref}:${ctx.ticket.path}`]);
      } catch {
        throw new Error(`the ticket file ${ctx.ticket.path} is not on ${branch} \u2014 the leg cannot write it`);
      }
      const fm = parseFrontmatter(text);
      if (fm == null) throw new Error(`the ticket file ${ctx.ticket.path} has no frontmatter block`);
      let schema = null;
      let schemaPresent = false;
      try {
        schema = JSON.parse(git(["show", `${ref}:${itemSchemaPath(ctx.ticket.path)}`]));
        schemaPresent = true;
      } catch (e) {
        const missing = /does not exist|exists on disk|ambiguous argument/i.test(`${String(e.stderr ?? "")}`);
        if (!missing) throw new Error(`the repository's ${itemSchemaPath(ctx.ticket.path)} is not a schema the close can check: ${e.message}`);
      }
      const violations = [...checkMachine(state), ...schemaPresent && schema != null ? checkFrontmatter(schema, fm, MACHINE_KEYS) : []];
      for (const v of violations) throw new Error(`the ticket does not validate: ${v}`);
      if (ctx.heading !== false && !legHeadingPresent(text, ctx.leg)) throw new Error(`the ticket has no '## ${ctx.leg}' heading \u2014 the leg's work belongs under its own heading`);
      const next = text.endsWith("\n") ? setMachineKeys(text, state) : `${setMachineKeys(text, state)}
`;
      const blob = git(["hash-object", "-w", "--stdin"], { input: next });
      rmSync(index, { force: true });
      git(["read-tree", parent], { env });
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${ctx.ticket.path}`], { env });
      const tree = git(["write-tree"], { env });
      const commit = git(["commit-tree", tree, "-p", parent, "-m", `baton:close ${id} ${ctx.leg}`]);
      try {
        git(["push", "origin", `${commit}:refs/heads/${branch}`]);
        return commit;
      } catch (e) {
        if (!movedOnRemote(e) || tries >= PUSH_TRIES) throw e;
      }
    }
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

// src/defaults/pr-close.ts
var PR_URL = /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+$/;
var verdictLine = (verdict) => `<!-- baton:verdict ${verdict} -->`;
function commentLine(leg, result) {
  if (leg === "review") {
    if (result?.verdict !== "approve" && result?.verdict !== "changes") {
      throw new Error(`the review returned no verdict (approve or changes), got ${JSON.stringify(result?.verdict)}`);
    }
    return verdictLine(result.verdict);
  }
  if (leg === "adjudicate") {
    if (result?.adjudication !== "merge" && result?.adjudication !== "owner") {
      throw new Error(`the adjudication returned neither merge nor owner, got ${JSON.stringify(result?.adjudication)}`);
    }
    return `<!-- baton:adjudicated ${result.adjudication} -->`;
  }
  if (leg === "conclude") return "<!-- baton:concluded -->";
  return null;
}
var MARKER_LEGS = /* @__PURE__ */ new Set(["converse", "address"]);
async function prClose(ctx, result, run2 = exec) {
  const comment = commentLine(ctx.leg, result);
  if (comment != null) {
    const body = `${comment}
baton: ${ctx.ticket.id} ${ctx.leg}, claim ${ctx.claim?.nonce ?? "?"}`;
    if (result?.pr != null && !(typeof result.pr === "string" && PR_URL.test(result.pr))) throw new Error(`the ${ctx.leg} leg named no PR URL to write on, got ${JSON.stringify(result.pr)}`);
    return run2("gh", ["pr", "comment", ...typeof result?.pr === "string" ? [result.pr] : [], "--body", body], ctx.checkout);
  }
  if (typeof result?.reached !== "string" || result.reached === "") throw new Error(`the ${ctx.leg} leg returned no station reached`);
  if (!MARKER_LEGS.has(ctx.leg)) return run2("git", ["rev-parse", "HEAD"], ctx.checkout);
  return closeTicket({ ...ctx, heading: false }, result, run2);
}

// src/defaults/course-pr.ts
var DEFAULT_BRANCH_PATTERN = "claude/{ticket}-*";
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
  rounds: CREATE_SPEC_COURSE.legs.address.max_runs,
  adjudicates: true
};
function branchMatches(pattern, branch) {
  const p = pattern.toLowerCase();
  const b = branch.toLowerCase();
  let i = 0;
  let j = 0;
  let star = -1;
  let mark = 0;
  while (i < b.length) {
    if (j < p.length && (p[j] === b[i] || p[j] === "*")) {
      if (p[j] === "*") {
        star = j++;
        mark = i;
      } else {
        i++;
        j++;
      }
    } else if (star >= 0) {
      i = ++mark;
      j = star + 1;
    } else {
      return false;
    }
  }
  while (j < p.length && p[j] === "*") j++;
  return j === p.length;
}
var matchPatterns = (branchPatterns) => (branchPatterns?.length ? branchPatterns : [DEFAULT_BRANCH_PATTERN]).map((p) => p.replace(/\{repository\}/g, "*"));

// src/defaults/pr-verify.ts
var bareId = (t) => {
  if (t.home && t.id.startsWith(`${t.home}:`)) return t.id.slice(t.home.length + 1);
  const colon = t.id.indexOf(":");
  return colon < 0 ? t.id : t.id.slice(colon + 1);
};
var msg = (e) => e instanceof Error ? e.message : String(e);
function ticketRepositories(text, reposMap) {
  const fm = text == null ? null : parseFrontmatter(text);
  const names = Array.isArray(fm?.repos) ? fm.repos : fm?.repos == null || fm.repos === "" ? [] : [fm.repos];
  return names.map((r) => typeof r === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) ? r : reposMap?.[r]).filter((r) => typeof r === "string" && r !== "");
}
function originSlug(run2, checkout) {
  try {
    const url = run2("git", ["remote", "get-url", "origin"], checkout);
    return /[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\s*$/.exec(url)?.[1] ?? null;
  } catch {
    return null;
  }
}
var known = (oid, run2, checkout) => {
  try {
    run2("git", ["cat-file", "-e", oid], checkout);
    return true;
  } catch {
    return false;
  }
};
var ancestor = (a, b, run2, checkout) => {
  try {
    run2("git", ["merge-base", "--is-ancestor", a, b], checkout);
    return true;
  } catch {
    return false;
  }
};
function verifyPrOpen(ask, run2) {
  const id = bareId(ask.ticket);
  const patterns = matchPatterns(ask.branchPatterns).map((p) => p.replace(/\{ticket\}/g, id));
  const siblings = ask.repositories ?? [];
  const slug = originSlug(run2, ask.checkout);
  const label = (repo) => repo ?? slug ?? "the checkout\u2019s repository";
  const of = (repo) => {
    const args = ["pr", "list", "--state", "open", "--limit", "300", "--json", "number,headRefName,headRefOid", ...repo ? ["--repo", repo] : []];
    let text;
    try {
      text = run2("gh", args, ask.checkout);
    } catch (e) {
      throw new Error(msg(e));
    }
    let prs;
    try {
      prs = JSON.parse(text);
    } catch {
      prs = null;
    }
    if (!Array.isArray(prs)) throw new Error(`gh pr list${repo ? ` --repo ${repo}` : ""} answered no PR list: ${text.slice(0, 200)}`);
    return prs.filter((p) => p != null && typeof p === "object" && typeof p.headRefName === "string" && patterns.some((pat) => branchMatches(pat, p.headRefName)));
  };
  const found = [null, ...siblings].map((repo) => {
    try {
      return { repo, prs: of(repo), error: null };
    } catch (e) {
      return { repo, prs: null, error: msg(e) };
    }
  });
  let branch = "";
  try {
    branch = run2("git", ["branch", "--show-current"], ask.checkout);
  } catch {
    branch = "";
  }
  if (branch !== "") {
    let head = null;
    try {
      head = run2("git", ["rev-parse", "HEAD"], ask.checkout);
    } catch {
      head = null;
    }
    for (const pr of found[0].prs ?? []) {
      if (pr.headRefName !== branch || typeof pr.headRefOid !== "string" || pr.headRefOid === "" || head == null) continue;
      if (head === pr.headRefOid) continue;
      if (!known(pr.headRefOid, run2, ask.checkout)) continue;
      if (!ancestor(head, pr.headRefOid, run2, ask.checkout)) {
        throw new Error(`the checkout\u2019s branch ${branch} is at ${head.slice(0, 10)}, but its open PR #${String(pr.number)} is at ${pr.headRefOid.slice(0, 10)} \u2014 push the branch: the review reads what is pushed`);
      }
    }
  }
  if (found.some((f) => (f.prs ?? []).length > 0)) return;
  const unread = found.filter((f) => f.error != null);
  const read = found.filter((f) => f.prs != null).map((f) => label(f.repo));
  if (read.length === 0) {
    throw new Error(`cannot verify ${id}\u2019s PR \u2014 no repository the ticket reads could be read: ${unread.map((f) => `${label(f.repo)} (${f.error})`).join("; ")}`);
  }
  throw new Error(`the implement agent exited 0, but no open PR on a branch matching ${patterns.join(" or ")} for ticket ${id} exists in ${read.join(" or ")}${unread.length ? ` \u2014 ${unread.map((f) => label(f.repo)).join(" or ")} could not be read` : ""} \u2014 open one from a matching branch with its head pushed, or the leg fails here`);
}

// ../../../../tmp/baton-bundle-bkskTT/entry.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (cmd, args, opts = {}) => execFileSync2(cmd, args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], ...opts });
function advisedCommand(command, settings, adviceFile) {
  if (!adviceFile) return command;
  let advice;
  try {
    advice = JSON.parse(readFileSync(adviceFile, "utf8"));
  } catch {
    return command;
  }
  const choices = advice && Array.isArray(advice.route_choices) ? advice.route_choices : [];
  const models = /* @__PURE__ */ new Set();
  for (const rc of choices) {
    const alt = rc && typeof rc === "object" ? rc.alternative ?? (Array.isArray(rc.ranked) && rc.ranked[0] ? rc.ranked[0].alternative : null) : null;
    const ranked = rc && typeof rc === "object" && Array.isArray(rc.ranked) ? rc.ranked.find((r) => r && r.alternative === alt) : null;
    for (const need of ranked && Array.isArray(ranked.needs) ? ranked.needs : []) if (typeof need === "string" && need.startsWith("model:")) models.add(need);
  }
  if (models.size !== 1) return command;
  const model = [...models][0];
  const mapped = settings && settings.agent_models && typeof settings.agent_models === "object" ? settings.agent_models[model] : void 0;
  if (typeof mapped !== "string" || mapped === "") return command;
  const words = splitWords(command);
  const at = words.findIndex((w) => w === "--model");
  if (at < 0 || at + 1 >= words.length) return command;
  if (words[at + 1] === mapped) return command;
  words[at + 1] = mapped;
  return words.join(" ");
}
async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read its override at");
  const rel = ".baton/courses/create-pr/legs/implement.run.mjs";
  if (gitRun("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() === "") return standard(ctx);
  const dir = mkdtempSync(join2(tmpdir(), "baton-override-"));
  try {
    const file = join2(dir, "implement.run.mjs");
    writeFileSync(file, gitRun("git", ["-C", ctx.checkout, "show", sha + ":" + rel], { maxBuffer: 67108864 }));
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== "function") throw new Error(rel + " exports no run(ctx, standard)");
    return await mod.run(ctx, standard);
  } finally {
    rmSync2(dir, { recursive: true, force: true });
  }
}
async function standard(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read .baton/baton.json at");
  const show = (rel2) => gitRun("git", ["-C", ctx.checkout, "show", sha + ":" + rel2], { maxBuffer: 67108864 });
  const settings = JSON.parse(show(".baton/baton.json"));
  const settingsCommand = typeof settings.agent_command === "string" && settings.agent_command !== "" ? settings.agent_command : process.env.BATON_AGENT_COMMAND ?? "";
  if (settingsCommand === "") throw new Error(".baton/baton.json names no agent_command \u2014 run `baton repo init --agent opencode` (or --agent claude-code, or --agent-command <cmd>); baton run --harness <harness> runs its command when the settings name none");
  const agentCommand = advisedCommand(settingsCommand, settings, process.env.BATON_ADVICE);
  const entry = (settings.courses ?? []).find((c) => c && c.id === "create-pr") ?? {};
  const patterns = [entry.branch_pattern, entry.previous_branch_pattern].filter((p) => typeof p === "string" && p !== "");
  const ticketText = (() => {
    try {
      return ctx.ticket?.path ? readFileSync(join2(ctx.checkout, ctx.ticket.path), "utf8") : null;
    } catch {
      return null;
    }
  })();
  const legRun = (cmd, args, cwd) => {
    try {
      return gitRun(cmd, args, { cwd, maxBuffer: 67108864 }).trim();
    } catch (e) {
      const why = e && typeof e.stderr === "string" && e.stderr.trim() !== "" ? e.stderr.trim().split("\n")[0] : e && e.message ? e.message : String(e);
      throw new Error(`${cmd} ${args.join(" ")} failed: ${why}`);
    }
  };
  const rel = ".baton/courses/create-pr/legs/implement.md";
  const present = gitRun("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() !== "";
  const text = present ? show(rel) : null;
  const dir = text == null ? null : mkdtempSync(join2(tmpdir(), "baton-leg-"));
  const instructions = dir == null ? "" : join2(dir, "implement.md");
  if (dir != null) writeFileSync(instructions, text);
  const [command, ...words] = splitWords(agentCommand);
  if (command === void 0) throw new Error(".baton/baton.json names no agent_command to run");
  const envWrapper = process.env.BATON_AGENT_WRAPPER;
  const wrapper = typeof envWrapper === "string" && envWrapper.trim() !== "" ? envWrapper : settings.agent_wrapper;
  if (wrapper != null && (typeof wrapper !== "string" || wrapper.trim() === "")) throw new Error(".baton/baton.json's agent_wrapper is not a command");
  const [wrapped, ...wrapping] = wrapper == null ? [] : splitWords(wrapper);
  const argv = wrapped === void 0 ? [command, ...words, ctx.ticket.id, "implement", ctx.checkout] : [wrapped, ...wrapping, command, ...words, ctx.ticket.id, "implement", ctx.checkout];
  if (process.env.BATON_VERBOSE) process.stderr.write("baton: create-pr/implement ticket " + ctx.ticket.id + ": agent_command: " + agentCommand + (wrapper != null ? "; wrapper: " + wrapper : "") + "; argv: " + argv.join(" ") + "\n");
  const out = await new Promise((resolve, reject) => {
    const echo = process.env.BATON_VERBOSE === "1";
    const child = spawn(argv[0], argv.slice(1), {
      cwd: ctx.checkout,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BATON_COURSE: "create-pr",
        BATON_LEG: "implement",
        BATON_INSTRUCTIONS: instructions,
        BATON_TICKET_FILE: ctx.ticket.path ?? ""
      }
    });
    let so = "", se = "";
    child.stdout.on("data", (c) => {
      so += c;
      if (so.length > 67108864) {
        child.kill("SIGKILL");
        reject(new Error("the agent printed more than 67108864 bytes"));
        return;
      }
      if (echo) process.stderr.write(c);
    });
    child.stderr.on("data", (c) => {
      if (se.length < 2048) se = (se + String(c)).slice(-2048);
      if (echo) process.stderr.write(c);
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code, sig) => {
      if (code === 0) {
        resolve(so);
        return;
      }
      const tail = (so + "\n" + se).split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "").slice(-20).join("\n  ");
      reject(new Error("the agent exited " + (code != null ? "with code " + code : "on signal " + sig) + "; its last output:\n  " + tail));
    });
    child.stdin?.end();
  }).finally(() => {
    if (dir != null) rmSync2(dir, { recursive: true, force: true });
  });
  void out;
  await verifyPrOpen({ checkout: ctx.checkout, ticket: ctx.ticket, branchPatterns: patterns, repositories: ticketRepositories(ticketText, settings.repos) }, legRun);
  if (process.env.BATON_VERBOSE) process.stderr.write("baton: create-pr/implement ticket " + ctx.ticket.id + ": the forge verified an open PR on a branch matching " + patterns.join(" or ") + "\n");
  return { reached: "pr-open", next: "review" };
}
var closeCtx2 = (ctx) => ({ ...ctx, ...ctx.default_branch == null && typeof process.env.BATON_DEFAULT_BRANCH === "string" && process.env.BATON_DEFAULT_BRANCH !== "" ? { default_branch: process.env.BATON_DEFAULT_BRANCH } : {} });
var close = (ctx, result) => prClose(closeCtx2(ctx), result);
async function handoff() {
  return null;
}
export {
  close,
  handoff,
  run
};
