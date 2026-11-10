// ../../../../../baton-bundle-T7S5h0/entry.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ../cli/src/defaults/ticket-state.ts
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

// ../cli/src/defaults/pr-close.ts
function testsClose(ctx, result, run2 = exec) {
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

// ../cli/src/defaults/course-pr.ts
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
  rounds: CREATE_SPEC_COURSE.legs.review.max_runs,
  adjudicates: true,
  gate: false
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

// ../../../../../baton-bundle-T7S5h0/entry.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (args, opts = {}) => execFileSync2("git", args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], ...opts });
var RUN_TESTS_TIMEOUT_MS = 24e4;
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
function verdictOf(cwd, script) {
  try {
    execFileSync2("npm", ["run", script], {
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
    if (e?.code === "ETIMEDOUT") return named("timed out after " + Math.round(RUN_TESTS_TIMEOUT_MS / 1e3) + " s");
    if (e?.code === "ENOBUFS") return named("printed more than " + OUTPUT_MAX + " bytes");
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
    const file = JSON.parse(show(".baton/courses/create-pr/course.json"));
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
    verdict = verdictOf(tree, script);
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
  run
};
