// ../../../../../private/var/folders/l5/khd_fnwx431d2p12lyvlqznr0000gn/T/baton-bundle-dhxeCV/entry.ts
import { execFile, execFileSync as execFileSync2 } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { pathToFileURL } from "node:url";

// src/defaults/course-markers.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
var MARKERS_FILE = join(".baton", "markers.jsonl");
var exec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();
function commitMarker(checkout, line, run2 = exec) {
  appendFileSync(join(checkout, MARKERS_FILE), `${JSON.stringify(line)}
`);
  run2("git", ["add", MARKERS_FILE], checkout);
  run2("git", ["commit", "--no-gpg-sign", "-m", `baton:close ${line.ticket} ${line.leg}`], checkout);
}
function bareTicketId(ticket) {
  if (ticket.home && ticket.id.startsWith(`${ticket.home}:`)) return ticket.id.slice(ticket.home.length + 1);
  const colon = ticket.id.indexOf(":");
  return colon < 0 ? ticket.id : ticket.id.slice(colon + 1);
}
var MARKERS_ATTRIBUTE = `/${MARKERS_FILE} merge=union`;

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
async function prClose(ctx, result, run2 = exec) {
  const line = commentLine(ctx.leg, result);
  if (line != null) {
    const body = `${line}
baton: ${ctx.ticket.id} ${ctx.leg}, claim ${ctx.claim?.nonce ?? "?"}`;
    if (result?.pr != null && !(typeof result.pr === "string" && PR_URL.test(result.pr))) throw new Error(`the ${ctx.leg} leg named no PR URL to write on, got ${JSON.stringify(result.pr)}`);
    return run2("gh", ["pr", "comment", ...typeof result?.pr === "string" ? [result.pr] : [], "--body", body], ctx.checkout);
  }
  if (typeof result?.reached !== "string" || result.reached === "") throw new Error(`the ${ctx.leg} leg returned no station reached`);
  commitMarker(ctx.checkout, { ticket: bareTicketId(ctx.ticket), leg: ctx.leg, reached: result.reached, next: result.next ?? null, claim: ctx.claim?.nonce ?? null }, run2);
  return run2("git", ["rev-parse", "HEAD"], ctx.checkout);
}

// ../../../../../private/var/folders/l5/khd_fnwx431d2p12lyvlqznr0000gn/T/baton-bundle-dhxeCV/entry.ts
async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read its override at");
  const rel = ".baton/courses/create-pr/legs/fix.run.mjs";
  if (execFileSync2("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel], { encoding: "utf8" }).trim() === "") return standard(ctx);
  const dir = mkdtempSync(join2(tmpdir(), "baton-override-"));
  try {
    const file = join2(dir, "fix.run.mjs");
    writeFileSync(file, execFileSync2("git", ["-C", ctx.checkout, "show", sha + ":" + rel], { encoding: "utf8", maxBuffer: 67108864 }));
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.run !== "function") throw new Error(rel + " exports no run(ctx, standard)");
    return await mod.run(ctx, standard);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function standard(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read .baton/baton.json at");
  const show = (rel2) => execFileSync2("git", ["-C", ctx.checkout, "show", sha + ":" + rel2], { encoding: "utf8", maxBuffer: 67108864 });
  const settings = JSON.parse(show(".baton/baton.json"));
  if (typeof settings.agent_command !== "string" || settings.agent_command === "") throw new Error(".baton/baton.json names no agent_command");
  const rel = ".baton/courses/create-pr/legs/fix.md";
  const present = execFileSync2("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel], { encoding: "utf8" }).trim() !== "";
  const text = present ? show(rel) : null;
  const dir = text == null ? null : mkdtempSync(join2(tmpdir(), "baton-leg-"));
  const instructions = dir == null ? "" : join2(dir, "fix.md");
  if (dir != null) writeFileSync(instructions, text);
  const out = await new Promise((resolve, reject) => execFile("sh", ["-c", settings.agent_command + ' "$@"', "agent", ctx.ticket.id, "fix", ctx.checkout], {
    cwd: ctx.checkout,
    maxBuffer: 67108864,
    env: {
      ...process.env,
      BATON_COURSE: "create-pr",
      BATON_LEG: "fix",
      BATON_INSTRUCTIONS: instructions,
      BATON_TICKET_FILE: ctx.ticket.path ?? ""
    }
  }, (e, stdout) => e ? reject(e) : resolve(String(stdout)))).finally(() => {
    if (dir != null) rmSync(dir, { recursive: true, force: true });
  });
  void out;
  return { reached: "fixed", next: "review" };
}
var close = prClose;
async function handoff() {
  return null;
}
export {
  close,
  handoff,
  run
};
