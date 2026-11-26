// baton-default.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

// src/defaults/output-evidence.ts
var MAX = 256 * 1024;

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

// src/defaults/ticket-state.ts
import { execFileSync as execFileSync2 } from "node:child_process";

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

// src/defaults/pr-close.ts
function testsClose(ctx, result, run2 = exec) {
  if (result?.tests === "ci") {
    if (result.next !== "review" || typeof result.reached !== "string" || result.reached === "") throw new Error("the run-tests gate deferred to CI without suspending at its station");
    return null;
  }
  if (result?.tests !== "green" && result?.tests !== "red") {
    throw new Error(`the run-tests gate returned neither green nor red, got ${JSON.stringify(result?.tests)}`);
  }
  if (typeof result?.reached !== "string" || result.reached === "") throw new Error("the run-tests gate returned no station reached");
  const sha = /^[0-9a-f]{40}$/;
  if (typeof result.branch !== "string" || result.branch === "" || result.branch.startsWith("-")) throw new Error("the run-tests gate returned no PR branch it tested");
  if (typeof result.tested !== "string" || !sha.test(result.tested)) throw new Error("the run-tests gate returned no tested head");
  if (typeof result.marker !== "string" || !sha.test(result.marker)) throw new Error("the run-tests gate returned no marker commit");
  run2("git", ["push", "origin", `${result.marker}:refs/heads/${result.branch}`], ctx.checkout);
  return result.marker;
}

// src/defaults/course-pr.ts
var DEFAULT_BRANCH_PATTERN = "claude/{ticket}-*";
var CREATE_PR_ASK_DEADLINE_S = 3 * 60 * 60;
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
function ticketRepositories(text, reposMap) {
  const fm = text == null ? null : parseFrontmatter(text);
  const names = Array.isArray(fm?.repos) ? fm.repos : fm?.repos == null || fm.repos === "" ? [] : [fm.repos];
  return names.map((r) => typeof r === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r) ? r : reposMap?.[r]).filter((r) => typeof r === "string" && r !== "");
}

// baton-default.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "", "SSH_ASKPASS": "", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (args, opts = {}) => execFileSync3("git", args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], ...opts });
var RUN_TESTS_TIMEOUT_MS = 18e5;
var OUTPUT_MAX = 67108864;
async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read its override at");
  const rel = ".baton/courses/create-pr/legs/run-tests.run.mjs";
  if (gitRun(["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() === "") return standard(ctx);
  const dir = mkdtempSync(join(tmpdir(), "baton-override-"));
  try {
    const file = join(dir, "run-tests.run.mjs");
    writeFileSync(file, gitRun(["-C", ctx.checkout, "show", sha + ":" + rel], { maxBuffer: OUTPUT_MAX }));
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== "function") throw new Error(rel + " exports no run(ctx, standard)");
    return await mod.run(ctx, standard);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function verdictOf2(cwd, script) {
  try {
    execFileSync3("npm", ["run", script], {
      cwd,
      encoding: "utf8",
      timeout: RUN_TESTS_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: OUTPUT_MAX,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...GIT_ENV }
    });
    return { tests: "green" };
  } catch (e) {
    const tail = [String(e?.stdout ?? ""), String(e?.stderr ?? "")].join("\n").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "").slice(-20).join("\n");
    const named = (why) => ({ tests: "red", tail: "npm run " + script + " " + why + (tail ? "; its last lines:\n" + tail : "; it printed nothing") });
    const setup = (why) => new Error("npm run " + script + " " + why + " \u2014 the tests never ran: no verdict, no marker" + (tail ? "; its last lines:\n" + tail : ""));
    if (e?.code === "ETIMEDOUT") throw setup("outlived the gate\u2019s bound of " + Math.round(RUN_TESTS_TIMEOUT_MS / 1e3) + " s (a suite that needs longer raises it in its own copy of this leg)");
    if (e?.code === "ENOBUFS") return named("printed more than " + OUTPUT_MAX + " bytes");
    if (e?.status === 126 || e?.status === 127) throw setup("exited " + e.status + ", a command its script names could not be run (not found, or not executable)");
    if (/\bMissing script:/.test(String(e?.stderr ?? ""))) throw setup("has no such script in package.json");
    if (typeof e?.status === "number") return named("exited " + e.status);
    if (e?.signal) throw new Error("npm run " + script + " was killed by " + e.signal + ", which the gate did not send \u2014 no verdict, no marker");
    throw new Error("npm run " + script + " could not run (" + (e?.code ?? e?.message ?? String(e)) + ") \u2014 no verdict, no marker");
  }
}
async function standard(ctx) {
  const station = ctx.claim?.station;
  if (station !== "pr-open" && station !== "fixed") {
    throw new Error("the run-tests gate runs at pr-open or fixed, not " + JSON.stringify(station ?? null));
  }
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read the course file at");
  const show = (rel) => gitRun(["-C", ctx.checkout, "show", sha + ":" + rel], { maxBuffer: 1024 * 1024 });
  let script = "test";
  try {
    const file = ctx.sourced_course === true ? { "test_script": "test" } : JSON.parse(show(".baton/courses/create-pr/course.json"));
    if (file && typeof file.test_script === "string" && /^[\w:.+-]{1,64}$/.test(file.test_script)) script = file.test_script;
  } catch {
  }
  let settings = {};
  try {
    settings = JSON.parse(show(".baton/baton.json"));
  } catch {
  }
  const entry = (Array.isArray(settings.courses) ? settings.courses : []).find((c) => c && c.id === "create-pr") ?? {};
  const id = bareTicketId(ctx.ticket);
  const wanted = matchPatterns([entry.branch_pattern ?? DEFAULT_BRANCH_PATTERN, entry.previous_branch_pattern].filter((p) => typeof p === "string" && p !== "")).map((p) => p.replace(/\{ticket\}/g, id));
  const branches = gitRun(["-C", ctx.checkout, "ls-remote", "--heads", "origin"]).split("\n").map((l) => l.split("	")[1] ?? "").filter((r) => r.startsWith("refs/heads/")).map((r) => r.slice("refs/heads/".length)).filter((br) => wanted.some((p) => branchMatches(p, br)));
  if (branches.length === 0) {
    let ticketText = null;
    try {
      ticketText = ctx.ticket?.file ? readFileSync(ctx.ticket.file, "utf8") : ctx.ticket?.path ? readFileSync(join(ctx.checkout, ctx.ticket.path), "utf8") : null;
    } catch {
    }
    const siblings = ticketRepositories(ticketText, settings.repos);
    if (siblings.length) {
      if (process.env.BATON_VERBOSE) process.stderr.write("baton: create-pr/run-tests ticket " + ctx.ticket.id + ": no PR branch at home; the gate is the CI of " + siblings.join(", ") + "\n");
      return { reached: station, next: "review", suspend: true, tests: "ci", repositories: siblings };
    }
  }
  if (branches.length !== 1) {
    throw new Error(branches.length ? "the run-tests gate tests one PR branch; " + id + " has " + branches.join(", ") + " in the home repository" : "no branch matching " + wanted.join(" or ") + " in the home repository for " + id + " \u2014 the gate tests the PR branch it can reach");
  }
  const branch = branches[0];
  gitRun(["-C", ctx.checkout, "fetch", "-q", "--no-tags", "origin", "refs/heads/" + branch]);
  const tested = gitRun(["-C", ctx.checkout, "rev-parse", "FETCH_HEAD"]).trim();
  if (process.env.BATON_VERBOSE) process.stderr.write("baton: create-pr/run-tests ticket " + ctx.ticket.id + ": npm run " + script + " on " + branch + " at " + tested.slice(0, 10) + " (" + station + ")\n");
  const dir = mkdtempSync(join(tmpdir(), "baton-run-tests-"));
  const tree = join(dir, "tree");
  let verdict;
  try {
    gitRun(["-C", ctx.checkout, "worktree", "add", "-q", "--detach", tree, tested]);
    const modules = join(ctx.checkout, "node_modules");
    if (existsSync(modules) && !existsSync(join(tree, "node_modules"))) symlinkSync(modules, join(tree, "node_modules"), "dir");
    let pkg = {};
    try {
      pkg = JSON.parse(readFileSync(join(tree, "package.json"), "utf8"));
    } catch {
    }
    const declared = ["dependencies", "devDependencies"].some((k) => pkg && typeof pkg[k] === "object" && pkg[k] !== null && Object.keys(pkg[k]).length > 0);
    if (declared && !existsSync(join(tree, "node_modules"))) {
      throw new Error("npm run " + script + " cannot run: " + branch + " declares dependencies and neither the tested tree nor the home checkout has node_modules \u2014 install them where the leg runs (npm ci); the tests never ran: no verdict, no marker");
    }
    verdict = verdictOf2(tree, script);
  } finally {
    try {
      unlinkSync(join(tree, "node_modules"));
    } catch {
    }
    try {
      gitRun(["-C", ctx.checkout, "worktree", "remove", "--force", tree]);
    } catch {
    }
    try {
      gitRun(["-C", ctx.checkout, "worktree", "prune"]);
    } catch {
    }
    rmSync(dir, { recursive: true, force: true });
  }
  const trailers = ["Baton-Tests: " + verdict.tests, "Baton-Tested: " + tested, ...ctx.claim?.nonce ? ["Baton-Claim: " + ctx.claim.nonce] : []].join("\n");
  const paragraphs = ["baton: tests " + verdict.tests + " for " + id, ...verdict.tests === "red" ? [verdict.tail] : [], trailers];
  const marker = gitRun(["-C", ctx.checkout, "commit-tree", tested + "^{tree}", "-p", tested, ...paragraphs.flatMap((m) => ["-m", m])]).trim();
  return { reached: station, next: verdict.tests === "green" ? "review" : "fix", tests: verdict.tests, script, branch, tested, marker, ...verdict.tests === "red" ? { tail: verdict.tail } : {} };
}
var closeCtx2 = (ctx) => ({ ...ctx, ...ctx.default_branch == null && typeof process.env.BATON_DEFAULT_BRANCH === "string" && process.env.BATON_DEFAULT_BRANCH !== "" ? { default_branch: process.env.BATON_DEFAULT_BRANCH } : {} });
var close = (ctx, result) => testsClose(closeCtx2(ctx), result);
async function handoff() {
  return null;
}
export {
  close,
  handoff,
  run,
  standard
};
