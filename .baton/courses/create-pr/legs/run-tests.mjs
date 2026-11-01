// ../../baton-bundle-CLjoHe/entry.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

// src/defaults/pr-close.ts
function testsClose(ctx, result, run2 = exec) {
  if (result?.tests !== "green" && result?.tests !== "red") {
    throw new Error(`the run-tests gate returned neither green nor red, got ${JSON.stringify(result?.tests)}`);
  }
  if (typeof result?.reached !== "string" || result.reached === "") throw new Error("the run-tests gate returned no station reached");
  const branch = run2("git", ["branch", "--show-current"], ctx.checkout).trim();
  if (branch === "") throw new Error("the checkout is on no branch \u2014 the run-tests marker has nowhere to go");
  const id = bareTicketId(ctx.ticket);
  const tail = typeof result.tail === "string" && result.tail.trim() !== "" ? result.tail.trim() : "(no output)";
  const trailers = [`Baton-Tests: ${result.tests}`, ...ctx.claim?.nonce ? [`Baton-Claim: ${ctx.claim.nonce}`] : []].join("\n");
  const args = result.tests === "red" ? ["-m", `baton: tests red for ${id}`, "-m", `npm run <the course's test_script> failed \u2014 its last lines:
${tail}`, "-m", trailers] : ["-m", `baton: tests green for ${id}`, "-m", trailers];
  run2("git", ["commit", "--allow-empty", ...args], ctx.checkout);
  run2("git", ["push", "origin", `HEAD:refs/heads/${branch}`], ctx.checkout);
  return run2("git", ["rev-parse", "HEAD"], ctx.checkout);
}

// ../../baton-bundle-CLjoHe/entry.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (args, opts = {}) => execFileSync2("git", args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], ...opts });
var RUN_TESTS_TIMEOUT_MS = 24e4;
async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read its override at");
  const rel = ".baton/courses/create-pr/legs/run-tests.run.mjs";
  if (gitRun(["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() === "") return standard(ctx);
  const dir = mkdtempSync(join(tmpdir(), "baton-override-"));
  try {
    const file = join(dir, "run-tests.run.mjs");
    writeFileSync(file, gitRun(["-C", ctx.checkout, "show", sha + ":" + rel], { maxBuffer: 67108864 }));
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== "function") throw new Error(rel + " exports no run(ctx, standard)");
    return await mod.run(ctx, standard);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function standard(ctx) {
  const station = ctx.claim?.station;
  if (station !== "pr-open" && station !== "fixed") {
    throw new Error("the run-tests gate runs at pr-open or fixed, not " + JSON.stringify(station ?? null));
  }
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read the course file at");
  let script = "test";
  try {
    const file = JSON.parse(gitRun(["-C", ctx.checkout, "show", sha + ":.baton/courses/create-pr/course.json"], { maxBuffer: 1024 * 1024 }));
    if (file && typeof file.test_script === "string" && file.test_script !== "") script = file.test_script;
  } catch {
  }
  if (process.env.BATON_VERBOSE) process.stderr.write("baton: create-pr/run-tests ticket " + ctx.ticket.id + ": npm run " + script + " at " + station + "\n");
  const out = { so: "", se: "" };
  try {
    out.so = execFileSync2("npm", ["run", script], {
      cwd: ctx.checkout,
      encoding: "utf8",
      timeout: RUN_TESTS_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 67108864,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...GIT_ENV }
    });
  } catch (e) {
    const c = e && typeof e.code === "number" ? e.code : null;
    const tail = [String(e?.stdout ?? ""), String(e?.stderr ?? "")].join("\n").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "").slice(-20).join("\n");
    return { reached: station, next: "fix", tests: "red", tail: "npm run " + script + (c != null ? " exited " + c : " failed") + "; its last lines:\n" + tail };
  }
  return { reached: station, next: "review", tests: "green" };
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
