// baton-default.ts
import { execFileSync as execFileSync3 } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// src/core/forges.ts
var FORGE_SHAPES = {
  github: { depth: [2, 2], pr: "/pull/", blob: "/blob/", commit: "/commit/", dispatch: "github-app", dispatchOrigin: "https://api.github.com", dispatchInput: "workflow-path", defaultOrigin: "https://github.com", ci: "github-actions" },
  gitlab: { depth: [2, 4], pr: "/-/merge_requests/", blob: "/-/blob/", commit: "/-/commit/", dispatch: "gitlab-trigger", dispatchInput: "project-ref", defaultOrigin: null, ci: "gitlab-ci" },
  gitea: { depth: [2, 2], pr: "/pulls/", blob: "/src/branch/", commit: "/commit/", dispatch: "gitea", dispatchInput: "workflow-ref", defaultOrigin: null, ci: null },
  git: { depth: [2, 2], pr: null, blob: null, commit: null, dispatch: null, dispatchInput: null, defaultOrigin: null, ci: null }
};
var FORGES = Object.keys(FORGE_SHAPES);
var DEFAULT_FORGE = FORGES.find((f) => FORGE_SHAPES[f].defaultOrigin !== null);
var PR_FORGES = FORGES.filter((f) => FORGE_SHAPES[f].pr !== null);
var number = "(\\d{1,9})";
var suffix = (forge) => `${FORGE_SHAPES[forge].pr}${number}`;
var PR_URL = new RegExp(`^https?://[^/\\s?#]+(?:${PR_FORGES.map((forge) => {
  const [min, max] = FORGE_SHAPES[forge].depth;
  return `((?:/[A-Za-z0-9_.-]{1,100}){${min},${max}})${suffix(forge)}`;
}).join("|")})$`);

// src/core/links.ts
var SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;
function isForgePath(forge, path) {
  const segs = path.split("/");
  const [min, max] = FORGE_SHAPES[forge].depth;
  if (segs.length < min || segs.length > max) return false;
  return segs.every((s) => SEGMENT.test(s) && s !== "." && s !== ".." && !s.toLowerCase().endsWith(".git"));
}

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

// src/defaults/forges/rest.ts
var sha = (v) => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
var prNumber = (v) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 999999999;
var immutableId = (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
var sameRepository = (head, base) => immutableId(head) && head === base;
function openRef(number2, branch, oid) {
  if (!prNumber(number2) || typeof branch !== "string" || !branch || branch.length > 1024 || !sha(oid)) throw new Error("malformed PR head");
  return { number: number2, headRefName: branch, headRefOid: oid };
}

// src/defaults/forges/github-facts.ts
var COMMENT_FIELDS = "author { login ... on User { databaseId } ... on Bot { databaseId } ... on Organization { databaseId } ... on Mannequin { databaseId } } authorAssociation body lastEditedAt includesCreatedEdit";
var PR_COMMENTS = `pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} createdAt url }`;
var PR_DETAIL = `fragment D on PullRequest {
  head: commits(last: 1) { nodes { commit { oid checkSuites(first: 10) { pageInfo { hasNextPage } nodes { checkRuns(first: 100, filterBy: { checkType: LATEST }) { pageInfo { hasNextPage } nodes { status conclusion } } } } } } }
  commits(first: 100) { pageInfo { hasNextPage } nodes { commit { oid committedDate message tree { oid } parents(first: 1) { nodes { oid tree { oid } } } } } }
  reviews(first: 100) { pageInfo { hasNextPage } nodes { author { login } authorAssociation state submittedAt body url commit { oid } } }
  comments(first: 100) { ${PR_COMMENTS} }
}`;

// src/defaults/forges/index.ts
function githubEvidence(url) {
  const m = /^\/([^/]+)\/([^/]+)\/(pull|issues|commit)\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  const [, owner, name, kind, id] = m;
  const at = (api) => ({ repo: `${owner}/${name}`, api: `/repos/${owner}/${name}${api}` });
  const hash = url.hash.slice(1);
  if (kind === "commit") return /^[0-9a-f]{7,40}$/.test(id) ? at(`/commits/${id}`) : null;
  if (!/^\d+$/.test(id)) return null;
  let f;
  if (f = /^issuecomment-(\d+)$/.exec(hash)) return at(`/issues/comments/${f[1]}`);
  if (kind === "issues") return hash === "" ? at(`/issues/${id}`) : null;
  if (f = /^pullrequestreview-(\d+)$/.exec(hash)) return at(`/pulls/${id}/reviews/${f[1]}`);
  if (f = /^discussion_r(\d+)$/.exec(hash)) return at(`/pulls/comments/${f[1]}`);
  return hash === "" ? at(`/pulls/${id}`) : null;
}
var pulls = (path) => `/repos/${path}/pulls`;
var issues = (path, n) => `/repos/${path}/issues/${n}/comments`;
var pullHead = (p, branch = p?.head?.ref) => ({ ...openRef(p?.number, branch, p?.head?.sha), sameRepository: sameRepository(p?.head?.repo?.id, p?.base?.repo?.id) });
var pullBody = ({ title, head, base, body }) => ({ title, head, base, body });
var project = (path) => `/projects/${encodeURIComponent(path)}`;
var mergeRequests = (path) => `${project(path)}/merge_requests`;
var publicOrigin = FORGE_SHAPES[DEFAULT_FORGE].defaultOrigin;
var publicApi = FORGE_SHAPES[DEFAULT_FORGE].dispatchOrigin;
var ADAPTERS = {
  github: {
    publicHost: new URL(publicOrigin).host,
    api: (origin) => origin === publicOrigin ? publicApi : `${origin}/api/v3`,
    graphql: (origin) => origin === publicOrigin ? `${publicApi}/graphql` : `${origin}/api/graphql`,
    prs: pulls,
    comments: issues,
    openBody: pullBody,
    url: "html_url",
    head: (p) => pullHead(p),
    openQuery: "state=open",
    cli: true,
    attest: { commit: (path, sha2) => `/repos/${path}/commits/${sha2}`, evidence: githubEvidence, witness: (path, sha2) => `/repos/${path}/commits/${sha2}/comments` },
    protectedRefusal: (s) => /GH006/i.test(s) || /GH013/i.test(s) && !/secret|push protection/i.test(s) && /pull request|update rule|required status check/i.test(s)
  },
  gitlab: {
    publicHost: "gitlab.com",
    api: (origin) => `${origin}/api/v4`,
    prs: mergeRequests,
    comments: (path, n) => `${mergeRequests(path)}/${n}/notes`,
    openBody: ({ title, head, base, body }) => ({ title, source_branch: head, target_branch: base, description: body }),
    url: "web_url",
    head: (p) => ({ ...openRef(p?.iid, p?.source_branch, p?.sha), sameRepository: sameRepository(p?.source_project_id, p?.target_project_id) }),
    openQuery: "state=opened",
    protectedRefusal: (s) => /not allowed to push code to protected branches/i.test(s),
    restFacts: {
      state: (p) => p.state === "merged" ? "merged" : p.state === "opened" ? "open" : p.state === "closed" ? "closed" : null,
      identity: (path) => project(path),
      ownerId: (p) => p.namespace?.id,
      commits: (path, n) => `${mergeRequests(path)}/${n}/commits`,
      commit: (c) => ({ oid: c.id, date: c.committed_date, message: c.message, parent: c.parent_ids?.[0] }),
      checks: (path, oid) => `${project(path)}/repository/commits/${oid}/statuses`,
      conclusion: (c) => status(c.status),
      user: (note) => note.system === true ? null : note.author,
      author: (u) => u.username,
      reviewDate: (n) => n.created_at,
      permission: (path, id) => `${project(path)}/members/all/${id}`,
      canPush: (p, id) => p?.id === id && Number.isSafeInteger(p.access_level) && p.access_level >= 30,
      scopeRefusal: (msg) => /insufficient_scope/i.test(msg),
      gitTrees: true
    }
  },
  gitea: {
    publicHost: "gitea.com",
    api: (origin) => `${origin}/api/v1`,
    prs: pulls,
    comments: issues,
    openBody: pullBody,
    url: "html_url",
    // `label` is the source branch; `ref` may become the synthetic PR ref after deletion.
    head: (p) => ({ ...openRef(p?.number, p?.head?.label || p?.head?.ref, p?.head?.sha), sameRepository: sameRepository(p?.head?.repo_id, p?.base?.repo_id) }),
    openQuery: "state=open",
    allQuery: "state=all",
    auth: "token",
    pageSizeKey: "limit",
    protectedRefusal: (s) => /not allowed to push to protected branch/i.test(s),
    restFacts: {
      listQuery: "state=all",
      state: (p) => p.merged === true || p.merged_at ? "merged" : p.state === "open" || p.state === "closed" ? p.state : null,
      identity: (path) => `/repos/${path}`,
      ownerId: (p) => p.owner?.id,
      commits: (path, n) => `${pulls(path)}/${n}/commits`,
      commit: (c) => ({ oid: c.sha, date: c.commit?.committer?.date, message: c.commit?.message, parent: c.parents?.[0]?.sha, tree: c.commit?.tree?.sha }),
      newestCommitFirst: true,
      treeOf: (path, oid) => `/repos/${path}/git/commits/${oid}`,
      checks: (path, oid) => `/repos/${path}/commits/${oid}/status`,
      checkItems: (p) => p?.statuses ?? (p && (p.total_count === 0 || Object.keys(p).length === 0) ? [] : void 0),
      conclusion: (c) => status(c.status),
      user: (c) => c.user,
      author: (u) => u.login,
      reviewDate: (c) => c.submitted_at ?? c.created_at,
      reviews: (path, n) => `${pulls(path)}/${n}/reviews`,
      unpagedComments: true,
      permission: (path, _id, login) => `/repos/${path}/collaborators/${encodeURIComponent(login)}/permission`,
      canPush: (p, id) => p?.user?.id === id && ["write", "admin", "owner"].includes(p.permission),
      scopeRefusal: (msg) => /token.*scope|Only admins can query all permissions/i.test(msg)
    }
  }
};
function status(v) {
  if (v === "success" || v === "skipped" || v === "neutral") return v;
  if (v === "failed" || v === "failure" || v === "error" || v === "canceled" || v === "cancelled") return "failure";
  return null;
}

// src/defaults/ticket-state.ts
import { execFileSync as execFileSync2 } from "node:child_process";

// src/client/git-env.mjs
var GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20"
};

// src/defaults/git.mjs
import { execFile, execFileSync } from "node:child_process";
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
    const [, key, rest2] = kv;
    if (rest2.trim() === "") {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        i++;
        items.push(unquote(lines[i].replace(/^\s+-\s+/, "")));
      }
      out[key] = items;
    } else if (/^\[.*\]$/.test(rest2.trim())) {
      out[key] = rest2.trim().slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      out[key] = unquote(rest2);
    }
  }
  return out;
}
var unquote = (v) => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) && t.length >= 2 ? t.slice(1, -1) : t;
};
var str = (v) => typeof v === "string" && v !== "" ? v : null;
var strList = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(str).filter((x) => x != null);
function resolveTicketRepo(name, aliases) {
  const valid = (path2) => FORGES.some((f) => isForgePath(f, path2));
  const path = valid(name) ? name : aliases && Object.hasOwn(aliases, name) ? aliases[name] : void 0;
  return typeof path === "string" && valid(path) ? path : null;
}

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
  const sha2 = /^[0-9a-f]{40}$/;
  if (typeof result.branch !== "string" || result.branch === "" || result.branch.startsWith("-")) throw new Error("the run-tests gate returned no PR branch it tested");
  if (typeof result.tested !== "string" || !sha2.test(result.tested)) throw new Error("the run-tests gate returned no tested head");
  if (typeof result.marker !== "string" || !sha2.test(result.marker)) throw new Error("the run-tests gate returned no marker commit");
  run2("git", ["push", "origin", `${result.marker}:refs/heads/${result.branch}`], ctx.checkout);
  return result.marker;
}

// src/defaults/pr-verify.ts
function ticketRepositories(text, reposMap) {
  const fm = text == null ? null : parseFrontmatter(text);
  return strList(fm?.repos).map((r) => resolveTicketRepo(r, reposMap)).filter((r) => r !== null);
}

// baton-default.ts
var GIT_BOUND_MS = 12e4;
var GIT_ENV = { "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "", "SSH_ASKPASS": "", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes -o ConnectTimeout=20" };
var gitRun = (args, opts = {}) => execFileSync3("git", args, { encoding: "utf8", timeout: GIT_BOUND_MS, killSignal: "SIGKILL", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"], ...opts });
var RUN_TESTS_TIMEOUT_MS = 18e5;
var OUTPUT_MAX = 67108864;
async function run(ctx) {
  const sha2 = ctx.snapshot?.sha;
  if (typeof sha2 !== "string" || sha2 === "") throw new Error("the leg has no snapshot to read its override at");
  const rel = ".baton/courses/create-pr/legs/run-tests.run.mjs";
  if (gitRun(["-C", ctx.checkout, "ls-tree", "--name-only", sha2, "--", rel]).trim() === "") return standard(ctx);
  const dir = mkdtempSync(join(tmpdir(), "baton-override-"));
  try {
    const file = join(dir, "run-tests.run.mjs");
    writeFileSync(file, gitRun(["-C", ctx.checkout, "show", sha2 + ":" + rel], { maxBuffer: OUTPUT_MAX }));
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
  const sha2 = ctx.snapshot?.sha;
  if (typeof sha2 !== "string" || sha2 === "") throw new Error("the leg has no snapshot to read the course file at");
  const show = (rel) => gitRun(["-C", ctx.checkout, "show", sha2 + ":" + rel], { maxBuffer: 1024 * 1024 });
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
