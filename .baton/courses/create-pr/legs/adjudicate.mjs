// ../../baton-bundle-0WctLN/entry.ts
import { execFile, execFileSync as execFileSync2 } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// src/defaults/answer.ts
var PR_URL = /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+$/;
function answerOn(line, values) {
  const words = line.split(/\s+/);
  const answer = words[0];
  if (answer === void 0 || !values.includes(answer)) return null;
  const rest = words.slice(1);
  if (rest.length === 0) return { answer, pr: null, line };
  if (rest.length === 1 && PR_URL.test(rest[0])) return { answer, pr: rest[0], line };
  return null;
}
function findAnswer(out, values, opts = {}) {
  const lines = out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (opts.strict ?? false) {
    const last = lines.at(-1);
    return last === void 0 ? null : answerOn(last, values);
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = answerOn(lines[i], values);
    if (found != null) return found;
  }
  return null;
}
function lastLine(out) {
  return out.split("\n").map((l) => l.trim()).filter((l) => l !== "").at(-1) ?? "";
}
function requireAnswer(out, ask, leg, opts = {}) {
  const values = ask.values.join(" or ");
  const found = findAnswer(out, ask.values, opts);
  if (found != null) return found;
  const last = lastLine(out);
  const opened = answerOn(last, ask.values) === null && ask.values.includes(last.split(/\s+/)[0] ?? "");
  if (opened) throw new Error(`the ${leg} agent's last line names no PR URL after its ${ask.name}`);
  throw new Error(`the ${leg} agent printed no ${ask.name} (${values}) as its last line${last === "" ? " \u2014 its output was empty" : ` \u2014 its last line was ${JSON.stringify(last)}`}`);
}

// src/defaults/course-markers.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
var MARKERS_FILE = join(".baton", "markers.jsonl");
var CLOSE_TIMEOUT_MS = 12e4;
var GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20"
};
var exec = (cmd, args, cwd, timeoutMs = CLOSE_TIMEOUT_MS) => execFileSync(cmd, args, {
  cwd,
  encoding: "utf8",
  timeout: timeoutMs,
  killSignal: "SIGKILL",
  env: { ...process.env, ...GIT_NONINTERACTIVE_ENV }
}).trim();
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
var PR_URL2 = /^https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+$/;
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
    if (result?.pr != null && !(typeof result.pr === "string" && PR_URL2.test(result.pr))) throw new Error(`the ${ctx.leg} leg named no PR URL to write on, got ${JSON.stringify(result.pr)}`);
    return run2("gh", ["pr", "comment", ...typeof result?.pr === "string" ? [result.pr] : [], "--body", body], ctx.checkout);
  }
  if (typeof result?.reached !== "string" || result.reached === "") throw new Error(`the ${ctx.leg} leg returned no station reached`);
  commitMarker(ctx.checkout, { ticket: bareTicketId(ctx.ticket), leg: ctx.leg, reached: result.reached, next: result.next ?? null, claim: ctx.claim?.nonce ?? null }, run2);
  return run2("git", ["rev-parse", "HEAD"], ctx.checkout);
}

// ../../baton-bundle-0WctLN/entry.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (cmd, args, opts = {}) => execFileSync2(cmd, args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, ...opts });
async function run(ctx) {
  const sha = ctx.snapshot?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("the leg has no snapshot to read its override at");
  const rel = ".baton/courses/create-pr/legs/adjudicate.run.mjs";
  if (gitRun("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() === "") return standard(ctx);
  const dir = mkdtempSync(join2(tmpdir(), "baton-override-"));
  try {
    const file = join2(dir, "adjudicate.run.mjs");
    writeFileSync(file, gitRun("git", ["-C", ctx.checkout, "show", sha + ":" + rel], { maxBuffer: 67108864 }));
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
  const show = (rel2) => gitRun("git", ["-C", ctx.checkout, "show", sha + ":" + rel2], { maxBuffer: 67108864 });
  const settings = JSON.parse(show(".baton/baton.json"));
  const agentCommand = typeof settings.agent_command === "string" && settings.agent_command !== "" ? settings.agent_command : process.env.BATON_AGENT_COMMAND ?? "";
  if (agentCommand === "") throw new Error(".baton/baton.json names no agent_command \u2014 run `baton repo init --agent opencode` (or --agent claude-code, or --agent-command <cmd>); baton run --harness <harness> runs its command when the settings name none");
  const rel = ".baton/courses/create-pr/legs/adjudicate.md";
  const present = gitRun("git", ["-C", ctx.checkout, "ls-tree", "--name-only", sha, "--", rel]).trim() !== "";
  const text = present ? show(rel) : null;
  const dir = text == null ? null : mkdtempSync(join2(tmpdir(), "baton-leg-"));
  const instructions = dir == null ? "" : join2(dir, "adjudicate.md");
  if (dir != null) writeFileSync(instructions, text);
  const [command, ...words] = splitWords(agentCommand);
  if (command === void 0) throw new Error(".baton/baton.json names no agent_command to run");
  const envWrapper = process.env.BATON_AGENT_WRAPPER;
  const wrapper = typeof envWrapper === "string" && envWrapper.trim() !== "" ? envWrapper : settings.agent_wrapper;
  if (wrapper != null && (typeof wrapper !== "string" || wrapper.trim() === "")) throw new Error(".baton/baton.json's agent_wrapper is not a command");
  const [wrapped, ...wrapping] = wrapper == null ? [] : splitWords(wrapper);
  const argv = wrapped === void 0 ? [command, ...words, ctx.ticket.id, "adjudicate", ctx.checkout] : [wrapped, ...wrapping, command, ...words, ctx.ticket.id, "adjudicate", ctx.checkout];
  if (process.env.BATON_VERBOSE) console.error("baton: create-pr/adjudicate ticket " + ctx.ticket.id + ": agent_command: " + agentCommand + (wrapper != null ? "; wrapper: " + wrapper : "") + "; argv: " + argv.join(" "));
  const out = await new Promise((resolve, reject) => {
    const child = execFile(argv[0], argv.slice(1), {
      cwd: ctx.checkout,
      maxBuffer: 67108864,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BATON_COURSE: "create-pr",
        BATON_LEG: "adjudicate",
        BATON_INSTRUCTIONS: instructions,
        BATON_TICKET_FILE: ctx.ticket.path ?? "",
        BATON_ANSWER: "print merge or owner as your last line, then the URL of the PR to write it on when it is not the checkout branch's"
      }
    }, (e, stdout) => e ? reject(e) : resolve(String(stdout)));
    child.stdin?.end();
  }).finally(() => {
    if (dir != null) rmSync(dir, { recursive: true, force: true });
  });
  const { answer, pr } = requireAnswer(out, { "name": "adjudication", "values": ["merge", "owner"] }, "adjudicate");
  const on = pr;
  return { ...{ ...answer === "owner" ? { suspend: true } : {}, reached: "adjudicated", next: "merge", adjudication: answer }, ...on ? { pr: on } : {} };
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
