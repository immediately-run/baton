// ../../baton-bundle-gFwnBA/entry.ts
import { execFileSync as execFileSync2, spawn } from "node:child_process";
import { mkdtempSync, readFileSync as readFileSync2, rmSync, writeFileSync } from "node:fs";
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

// src/defaults/course-pr.ts
var DEFAULT_BRANCH_PATTERN = "claude/{ticket}-*";
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

// ../../baton-bundle-gFwnBA/entry.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (cmd, args, opts = {}) => execFileSync2(cmd, args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, ...opts });
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
  const entry = (settings.courses ?? []).find((c) => c && c.id === "create-pr") ?? {};
  const patterns = [entry.branch_pattern, entry.previous_branch_pattern].filter((p) => typeof p === "string" && p !== "");
  const ticketText = (() => {
    try {
      return ctx.ticket?.path ? readFileSync2(join2(ctx.checkout, ctx.ticket.path), "utf8") : null;
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
      const why = se.split("\n").filter((l) => l.trim() !== "").at(-1);
      reject(new Error("the agent exited " + (code != null ? "with code " + code : "on signal " + sig) + (why != null ? ": " + why : "")));
    });
    child.stdin?.end();
  }).finally(() => {
    if (dir != null) rmSync(dir, { recursive: true, force: true });
  });
  void out;
  await verifyPrOpen({ checkout: ctx.checkout, ticket: ctx.ticket, branchPatterns: patterns, repositories: ticketRepositories(ticketText, settings.repos) }, legRun);
  return { reached: "pr-open", next: "review" };
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
