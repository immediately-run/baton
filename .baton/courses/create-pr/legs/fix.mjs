// ../../../../tmp/baton-bundle-HsxLz7/entry.ts
import { execFileSync as execFileSync2, spawn } from "node:child_process";
import { mkdtempSync, readFileSync as readFileSync2, rmSync as rmSync3, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";
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

// src/defaults/pr-close.ts
import { readFileSync, rmSync as rmSync2 } from "node:fs";
import { join as join2 } from "node:path";

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

// src/defaults/pr-close.ts
var REVIEWS_DIR = ".baton/reviews";
var ROUND_DRAFT = `${REVIEWS_DIR}/round.md`;
var ADDRESSED_DRAFT = `${REVIEWS_DIR}/addressed.md`;
var reviewFilesAt = (run2, checkout, ref) => run2("git", ["ls-tree", "-r", "--name-only", ref, "--", REVIEWS_DIR], checkout).split("\n").map((l) => l.trim()).filter((l) => l !== "");
var baseName = (path) => path.startsWith(`${REVIEWS_DIR}/`) ? path.slice(REVIEWS_DIR.length + 1) : path;
var roundOf = (path) => {
  const m = /^(\d+)(?:-addressed)?\.md$/.exec(baseName(path));
  return m ? Number(m[1]) : null;
};
var nextRound = (files) => 1 + Math.max(0, ...files.map(roundOf).filter((n) => n != null));
var latestRound = (files) => {
  let out = null;
  for (const f of files) {
    const m = /^(\d+)\.md$/.exec(baseName(f));
    if (m) out = Math.max(out ?? 0, Number(m[1]));
  }
  return out;
};
var ticketPatterns = (t, branchPatterns) => matchPatterns(branchPatterns).map((p) => p.replace(/\{ticket\}/g, bareTicketId(t)));
function reviewsBranch(ctx, run2 = exec) {
  const branch = run2("git", ["branch", "--show-current"], ctx.checkout).trim();
  if (branch === "") throw new Error("the checkout is on no branch (detached HEAD) \u2014 the review-rounds protocol is written on the PR's branch");
  const patterns = ticketPatterns(ctx.ticket, ctx.branch_patterns);
  if (!patterns.some((p) => branchMatches(p, branch))) {
    throw new Error(`the checkout's branch ${branch} matches none of ${patterns.join(" or ")} \u2014 the review-rounds protocol is written on the ticket's PR branch, so leave the checkout on it`);
  }
  return branch;
}
function protocolBranch(ctx, run2 = exec) {
  try {
    return reviewsBranch(ctx, run2);
  } catch {
    const patterns = ticketPatterns(ctx.ticket, ctx.branch_patterns);
    const elsewhere = run2("git", ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], ctx.checkout).split("\n").map((l) => l.trim().replace(/^origin\//, "")).filter((b) => b !== "" && patterns.some((p) => branchMatches(p, b)));
    if (elsewhere.length > 0) {
      throw new Error(`the checkout is on no branch of ${patterns.join(" or ")} (its origin holds ${elsewhere.join(", ")}) \u2014 the review-rounds protocol is written on the ticket's PR branch, so leave the checkout on it`);
    }
    return null;
  }
}
async function commitOnBranch(ctx, change, message, run2 = exec) {
  const branch = reviewsBranch(ctx, run2);
  const ref = `origin/${branch}`;
  const index = tmpIndex(ctx.checkout, run2);
  const git = (args, opts = {}) => run2("git", args, ctx.checkout, opts);
  try {
    for (let tries = 1; ; tries++) {
      git(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/${ref}`]);
      let parent;
      try {
        parent = git(["rev-parse", "--verify", `${ref}^{commit}`]);
      } catch {
        throw new Error(`origin holds no branch ${branch} \u2014 push the PR's branch before the review-rounds protocol is written on it`);
      }
      rmSync2(index, { force: true });
      git(["read-tree", parent], { env: { GIT_INDEX_FILE: index } });
      if (change.write != null) {
        const blob = git(["hash-object", "-w", "--stdin"], { input: change.write.text });
        git(["update-index", "--add", "--cacheinfo", `100644,${blob},${change.write.path}`], { env: { GIT_INDEX_FILE: index } });
      }
      for (const path of change.remove ?? []) git(["update-index", "--force-remove", path], { env: { GIT_INDEX_FILE: index } });
      const tree = git(["write-tree"], { env: { GIT_INDEX_FILE: index } });
      if (tree === git(["rev-parse", `${parent}^{tree}`])) return null;
      const commit = git(["commit-tree", tree, "-p", parent, "-m", message]);
      try {
        git(["push", "origin", `${commit}:refs/heads/${branch}`]);
        try {
          git(["update-ref", `refs/heads/${branch}`, commit, parent]);
        } catch {
        }
        return { branch, commit };
      } catch (e) {
        if (!movedOnRemote(e) || tries >= PUSH_TRIES) throw e;
      }
    }
  } finally {
    rmSync2(index, { force: true });
    rmSync2(`${index}.lock`, { force: true });
  }
}
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
function draftOf(path, checkout, leg) {
  let draft = "";
  try {
    draft = readFileSync(join2(checkout, path), "utf8");
  } catch {
    throw new Error(`the ${leg} leg left no ${path} in the checkout \u2014 the review-rounds protocol is written from that draft (B-101); the leg's instructions name the path`);
  }
  if (draft.trim() === "") throw new Error(`${path} is empty \u2014 the review-rounds protocol is written from that draft (B-101)`);
  return draft;
}
async function prClose(ctx, result, run2 = exec) {
  const comment = commentLine(ctx.leg, result);
  if (ctx.review_files === true && ctx.leg === "review") {
    const verdict = result.verdict;
    const branch = protocolBranch(ctx, run2);
    if (branch != null) {
      run2("git", ["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], ctx.checkout);
      const round = nextRound(reviewFilesAt(run2, ctx.checkout, `origin/${branch}`));
      const draft = draftOf(ROUND_DRAFT, ctx.checkout, ctx.leg);
      await commitOnBranch(
        { checkout: ctx.checkout, ticket: ctx.ticket, branch_patterns: ctx.branch_patterns },
        { write: { path: `${REVIEWS_DIR}/${round}.md`, text: `${comment}

# Round ${round} \u2014 ${verdict}

${draft.trim()}
` } },
        `baton:review ${bareTicketId(ctx.ticket)} round ${round}`,
        run2
      );
      rmSync2(join2(ctx.checkout, ROUND_DRAFT), { force: true });
    }
  }
  if (comment != null) {
    const body = `${comment}
baton: ${ctx.ticket.id} ${ctx.leg}, claim ${ctx.claim?.nonce ?? "?"}`;
    if (result?.pr != null && !(typeof result.pr === "string" && PR_URL.test(result.pr))) throw new Error(`the ${ctx.leg} leg named no PR URL to write on, got ${JSON.stringify(result.pr)}`);
    return run2("gh", ["pr", "comment", ...typeof result?.pr === "string" ? [result.pr] : [], "--body", body], ctx.checkout);
  }
  if (typeof result?.reached !== "string" || result.reached === "") throw new Error(`the ${ctx.leg} leg returned no station reached`);
  if (ctx.review_files === true && (ctx.leg === "fix" || ctx.leg === "address")) {
    const branch = protocolBranch(ctx, run2);
    if (branch != null) {
      run2("git", ["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], ctx.checkout);
      const round = latestRound(reviewFilesAt(run2, ctx.checkout, `origin/${branch}`));
      if (round == null) throw new Error(`no review round is on ${REVIEWS_DIR}/ of branch ${branch} to answer \u2014 the review close writes the round before its verdict is posted (B-101)`);
      const draft = draftOf(ADDRESSED_DRAFT, ctx.checkout, ctx.leg);
      const wrote = await commitOnBranch(
        { checkout: ctx.checkout, ticket: ctx.ticket, branch_patterns: ctx.branch_patterns },
        { write: { path: `${REVIEWS_DIR}/${round}-addressed.md`, text: `# Round ${round} \u2014 addressed

${draft.trim()}
` } },
        `baton:address ${bareTicketId(ctx.ticket)} round ${round}`,
        run2
      );
      rmSync2(join2(ctx.checkout, ADDRESSED_DRAFT), { force: true });
      if (ctx.leg === "fix" && wrote != null) return wrote.commit;
    }
  }
  if (!MARKER_LEGS.has(ctx.leg)) {
    if (ctx.review_files === true && ctx.leg === "merge") {
      const branch = ticketsBranch(ctx.checkout, ctx.default_branch ?? null, run2);
      run2("git", ["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], ctx.checkout);
      let carries = true;
      try {
        run2("git", ["cat-file", "-e", `origin/${branch}:${REVIEWS_DIR}`], ctx.checkout);
      } catch {
        carries = false;
      }
      if (carries) throw new Error(`the default branch still carries ${REVIEWS_DIR}/ after the merge \u2014 the squash landed the review protocol on it (B-101); remove the directory in a commit on the default branch and note it on the ticket`);
    }
    return run2("git", ["rev-parse", "HEAD"], ctx.checkout);
  }
  return closeTicket({ ...ctx, heading: false }, result, run2);
}

// ../../../../tmp/baton-bundle-HsxLz7/entry.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (cmd, args, opts = {}) => execFileSync2(cmd, args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], ...opts });
function advisedCommand(words, settings, adviceFile) {
  if (!adviceFile) return words;
  let advice;
  try {
    advice = JSON.parse(readFileSync2(adviceFile, "utf8"));
  } catch {
    return words;
  }
  const choices = advice && Array.isArray(advice.route_choices) ? advice.route_choices : [];
  const map = settings && settings.agent_models && typeof settings.agent_models === "object" ? settings.agent_models : {};
  const model = (rc) => Array.isArray(rc && rc.needs) ? rc.needs.find((n) => typeof n === "string" && n.startsWith("model:")) : void 0;
  for (const rc of choices) {
    if (!rc || typeof rc !== "object") continue;
    const alt = rc.alternative ?? (Array.isArray(rc.ranked) && rc.ranked[0] ? rc.ranked[0].alternative : null);
    if (alt == null) continue;
    const ranked = Array.isArray(rc.ranked) ? rc.ranked.find((r) => r && r.alternative === alt) : null;
    const mapped = map[rc.choice + "/" + alt] ?? map[model(ranked)];
    if (typeof mapped !== "string" || mapped === "") continue;
    const at = words.findIndex((w) => w === "--model");
    if (at >= 0 && at + 1 < words.length && words[at + 1] !== mapped) words[at + 1] = mapped;
    return words;
  }
  return words;
}
var snapshotPatterns = (ctx) => {
  try {
    const sha = ctx.snapshot?.sha;
    if (typeof sha !== "string" || sha === "") return [];
    const settings = JSON.parse(gitRun("git", ["-C", ctx.checkout, "show", sha + ":.baton/baton.json"], { maxBuffer: 67108864 }));
    const entry = (settings.courses ?? []).find((c) => c && c.id === "create-pr") ?? {};
    return [entry.branch_pattern, entry.previous_branch_pattern].filter((p) => typeof p === "string" && p !== "");
  } catch {
    return [];
  }
};
async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read its override at");
  for (const stale of [ROUND_DRAFT, ADDRESSED_DRAFT]) rmSync3(join3(ctx.checkout, stale), { force: true });
  const rel = ".baton/courses/create-pr/legs/fix.run.mjs";
  if (gitRun("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() === "") return standard(ctx);
  const dir = mkdtempSync(join3(tmpdir(), "baton-override-"));
  try {
    const file = join3(dir, "fix.run.mjs");
    writeFileSync(file, gitRun("git", ["-C", ctx.checkout, "show", sha + ":" + rel], { maxBuffer: 67108864 }));
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== "function") throw new Error(rel + " exports no run(ctx, standard)");
    return await mod.run(ctx, standard);
  } finally {
    rmSync3(dir, { recursive: true, force: true });
  }
}
async function standard(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read .baton/baton.json at");
  const show = (rel2) => gitRun("git", ["-C", ctx.checkout, "show", sha + ":" + rel2], { maxBuffer: 67108864 });
  const settings = JSON.parse(show(".baton/baton.json"));
  const settingsCommand = typeof settings.agent_command === "string" && settings.agent_command !== "" ? settings.agent_command : process.env.BATON_AGENT_COMMAND ?? "";
  if (settingsCommand === "") throw new Error(".baton/baton.json names no agent_command \u2014 run `baton repo init --agent opencode` (or --agent claude-code, or --agent-command <cmd>); baton run --harness <harness> runs its command when the settings name none");
  const agentWords = advisedCommand(splitWords(settingsCommand), settings, process.env.BATON_ADVICE);
  const agentCommand = agentWords.join(" ");
  const rel = ".baton/courses/create-pr/legs/fix.md";
  const present = gitRun("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() !== "";
  const text = present ? show(rel) : null;
  const dir = text == null ? null : mkdtempSync(join3(tmpdir(), "baton-leg-"));
  const instructions = dir == null ? "" : join3(dir, "fix.md");
  if (dir != null) writeFileSync(instructions, text);
  const [command, ...words] = agentWords;
  if (command === void 0) throw new Error(".baton/baton.json names no agent_command to run");
  const envWrapper = process.env.BATON_AGENT_WRAPPER;
  const wrapper = typeof envWrapper === "string" && envWrapper.trim() !== "" ? envWrapper : settings.agent_wrapper;
  if (wrapper != null && (typeof wrapper !== "string" || wrapper.trim() === "")) throw new Error(".baton/baton.json's agent_wrapper is not a command");
  const [wrapped, ...wrapping] = wrapper == null ? [] : splitWords(wrapper);
  const argv = wrapped === void 0 ? [command, ...words, ctx.ticket.id, "fix", ctx.checkout] : [wrapped, ...wrapping, command, ...words, ctx.ticket.id, "fix", ctx.checkout];
  if (process.env.BATON_VERBOSE) process.stderr.write("baton: create-pr/fix ticket " + ctx.ticket.id + ": agent_command: " + agentCommand + (wrapper != null ? "; wrapper: " + wrapper : "") + "; argv: " + argv.join(" ") + "\n");
  const out = await new Promise((resolve, reject) => {
    const echo = process.env.BATON_VERBOSE === "1";
    const child = spawn(argv[0], argv.slice(1), {
      cwd: ctx.checkout,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BATON_COURSE: "create-pr",
        BATON_LEG: "fix",
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
    if (dir != null) rmSync3(dir, { recursive: true, force: true });
  });
  void out;
  return { reached: "fixed", next: "review" };
}
var closeCtx2 = (ctx) => {
  const out = { ...ctx, review_files: true, ...ctx.default_branch == null && typeof process.env.BATON_DEFAULT_BRANCH === "string" && process.env.BATON_DEFAULT_BRANCH !== "" ? { default_branch: process.env.BATON_DEFAULT_BRANCH } : {} };
  const patterns = snapshotPatterns(ctx);
  if (patterns.length > 0) out.branch_patterns = patterns;
  return out;
};
var close = (ctx, result) => prClose(closeCtx2(ctx), result);
async function handoff() {
  return null;
}
export {
  close,
  handoff,
  run
};
