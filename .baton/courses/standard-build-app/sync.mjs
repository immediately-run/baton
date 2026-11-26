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
function parsePrUrl(url) {
  const groups = PR_URL.exec(url)?.slice(1).filter((v) => v !== void 0);
  return groups ? { path: groups[0].slice(1), number: groups[1] } : null;
}

// src/defaults/pr-markers.ts
function trailersOf(message) {
  const paragraphs = message.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter((p) => p !== "");
  const block = paragraphs.at(-1) ?? "";
  const out = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(\S.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
var SHA = /^[0-9a-f]{40}$/;
function markerOf(c) {
  if (typeof c.message !== "string" || !c.empty) return null;
  const t = trailersOf(c.message);
  const tests = t["Baton-Tests"];
  const tested = t["Baton-Tested"];
  const claim = t["Baton-Claim"];
  if (tests !== "green" && tests !== "red" || tested == null || !SHA.test(tested) || claim == null || claim === "") return null;
  if (c.parent !== tested) return null;
  return { sha: c.sha, at: c.at, tests, tested, claim };
}
function verifiedMarkers(commits, ticket, record, leg = "run-tests") {
  const ok = new Set(record.filter((r) => r.ticket === ticket && r.leg === leg).map((r) => `${r.claim_nonce}\0${r.evidence}`));
  return commits.map(markerOf).filter((m) => m != null && ok.has(`${m.claim}\0${m.sha}`));
}
function gateOfBranch(commits, counted) {
  const markers = new Set(counted.map((m) => m.sha));
  const content = [...commits].reverse().find((c) => !markers.has(c.sha));
  if (!content) return "open";
  const last = [...counted].reverse().find((m) => m.tested === content.sha);
  return last ? last.tests : "open";
}

// src/defaults/course-pr.ts
var DEFAULT_BRANCH_PATTERN = "claude/{ticket}-*";
var DEFAULT_CREATE_PR_REVIEW_ROUNDS = 3;
var CREATE_PR_ASK_DEADLINE_S = 3 * 60 * 60;
var CREATE_PR_COURSE = {
  start: "filed",
  start_leg: "implement",
  end: ["merged", "archived"],
  short_waits: ["ci"],
  // B-110: the deterministic gate's script — `npm run <test_script>` in the checkout.
  test_script: "test",
  stations: {
    filed: { label: "Filed, no PR yet" },
    "pr-open": { label: "PR open" },
    reviewed: { label: "Reviewed" },
    fixed: { label: "Findings addressed" },
    adjudicated: { label: "Open findings adjudicated" },
    merged: { label: "Merged" },
    delivered: { label: "Found already delivered" },
    confirmed: { label: "Already delivered, confirmed by a person" },
    archived: { label: "Confirmed ticket archived" }
  },
  legs: {
    implement: { from: ["filed"], to: ["pr-open", "delivered"], max_duration: CREATE_PR_ASK_DEADLINE_S, label: "Implement it and open the PR, or find it delivered" },
    "run-tests": { from: ["pr-open", "fixed"], to: ["pr-open", "fixed"], max_runs: 30, autonomous: true, label: "Run the deterministic tests" },
    // B-110: review also leaves `reviewed` — the owner's `round` answer grants exactly one more
    // round on the same head (the answer itself carries the run, §6.8; the round's verdict is
    // its marker, and a round still asking for changes comes straight back to the owner).
    // B-30's `no_chain_from: [implement, fix]` was lifted on 2026-11-25 (the owner: it does not
    // make sense now that legs are sandboxed and isolated); a deployment with one runner could
    // review nothing. The review instructions still ask for a different model when one is offered.
    review: { from: ["pr-open", "fixed", "reviewed"], to: "reviewed", max_runs: DEFAULT_CREATE_PR_REVIEW_ROUNDS, autonomous: true, label: "Review round" },
    fix: { from: ["reviewed", "pr-open", "fixed"], to: "fixed", max_runs: 30, max_duration: CREATE_PR_ASK_DEADLINE_S, label: "Fix or answer the findings" },
    adjudicate: { from: ["reviewed"], to: "adjudicated", autonomous: true, label: "The owner answers the third round" },
    merge: { from: ["reviewed", "adjudicated"], to: "merged", autonomous: true, label: "Merge and close the ticket" },
    // B-257: the person's confirmation — no runner is offered it (R-BTN-116); its options are
    // its outcomes, `confirmed` and `filed`.
    confirm: { from: ["delivered"], to: ["confirmed", "filed"], kind: "person", asks: "owner", answer_source: "person", max_runs: 3, label: "A person confirms it was already delivered" },
    archive: { from: ["confirmed"], to: "archived", requires: { capabilities: ["runner:claim-evidence"] }, label: "Archive the confirmed ticket" },
    "opened-by-hand": { from: ["filed"], to: "pr-open", arrives: { fact: "pr-opened", next: "run-tests" } },
    "reviewed-by-hand": { from: ["pr-open", "fixed", "reviewed"], to: "reviewed", max_runs: 3, arrives: { fact: "pr-verdict", next: { approve: "merge", changes: "fix" } } },
    "fixed-by-hand": { from: ["pr-open", "reviewed", "fixed"], to: "fixed", max_runs: 3, arrives: { fact: "pr-pushed", next: "run-tests" } },
    "merged-by-hand": { from: ["filed", "pr-open", "fixed", "reviewed", "adjudicated"], to: "merged", arrives: { fact: "pr-merged" } },
    reconcile: { from: ["filed", "pr-open", "fixed", "reviewed", "adjudicated"], max_runs: 3, reconciles: { to: { "pr-open": "run-tests", fixed: "run-tests", reviewed: "merge", merged: null, delivered: "confirm" } } }
  }
};
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
    merge: { from: ["reviewed", "adjudicated"], to: "merged", label: "Merge and close the ticket" },
    "opened-by-hand": { from: ["requested"], to: "spec-open", arrives: { fact: "pr-opened", next: "review" } },
    "pushed-by-hand": { from: ["reviewed"], to: "spec-open", max_runs: 3, arrives: { fact: "pr-pushed", next: "review" } },
    "merged-by-hand": { from: ["requested", "spec-open", "reviewed", "adjudicated"], to: "merged", arrives: { fact: "pr-merged" } },
    reconcile: { from: ["requested", "spec-open", "reviewed", "adjudicated"], max_runs: 3, reconciles: { to: { "spec-open": "review", reviewed: "merge", merged: null } } }
  }
};
var REVIEW_PR_COURSE = {
  start: "requested",
  start_leg: "review",
  end: ["approved", "concluded"],
  short_waits: ["ci"],
  stations: {
    requested: { label: "Review requested" },
    "changes-requested": { label: "Changes requested" },
    approved: { label: "Approved" },
    concluded: { label: "Review concluded" }
  },
  legs: {
    review: { from: ["requested", "changes-requested"], to: ["approved", "changes-requested"], max_runs: 3, label: "Review round" },
    conclude: { from: ["requested", "changes-requested"], to: "concluded", label: "Summarise and stop" },
    "approved-by-hand": { from: ["requested", "changes-requested"], to: "approved", arrives: { fact: "pr-verdict", verdict: "approve" } },
    reconcile: { from: ["requested", "changes-requested"], max_runs: 3, reconciles: { to: { "changes-requested": "review", approved: null, concluded: null } } }
  }
};
var VERDICT = /^<!--\s*baton:verdict\s+(approve|changes)\s*-->/;
var ADJUDICATED = /^<!--\s*baton:adjudicated\s+(merge|owner)\s*-->/;
var CONCLUDED = /^<!--\s*baton:concluded\s*-->/;
var markerOf2 = (r, re) => r.state === "COMMENTED" ? re.exec((r.body ?? "").trim()) : null;
function verdictOf(r) {
  if (r.state === "APPROVED") return "approve";
  if (r.state === "CHANGES_REQUESTED") return "changes";
  if (r.state === "COMMENTED") {
    const m = VERDICT.exec((r.body ?? "").trim());
    if (m) return m[1] === "approve" ? "approve" : "changes";
  }
  return null;
}
var checksDone = (f) => f.checks.every((c) => c != null);
var CI_GREEN = /* @__PURE__ */ new Set(["success", "neutral", "skipped"]);
function siblingCiOf(facts) {
  if (facts.some((f) => f.checks.some((c) => c != null && !CI_GREEN.has(c.toLowerCase())))) return "red";
  if (facts.some((f) => f.checks.length === 0 || f.checks.some((c) => c == null))) return "running";
  return "green";
}
var verdictsOf = (f) => [...f.reviews].filter((r) => verdictOf(r) != null).sort((a, b) => a.submittedAt - b.submittedAt);
var CREATE_PR_LEGS = { open: "implement", opened: "pr-open", back: "fix", backTo: "fixed" };
function timelineOf(f, legs = CREATE_PR_LEGS, gate = false, markers = [], rounds = []) {
  const path = [{ leg: legs.open, reached: legs.opened }];
  const pushes = f.pushes?.length ? f.pushes : [f.pushedAt];
  const verdicts = verdictsOf(f);
  if (!gate) {
    verdicts.forEach((v, i) => {
      if (path.at(-1).reached !== "reviewed") path.push({ leg: "review", reached: "reviewed" });
      const until = verdicts[i + 1]?.submittedAt ?? Number.POSITIVE_INFINITY;
      if (pushes.some((p) => p > v.submittedAt && p < until)) path.push({ leg: legs.back, reached: legs.backTo });
    });
    return path;
  }
  const events = [
    ...verdicts.map((v) => ({ t: v.submittedAt, kind: "verdict" })),
    ...pushes.map((p) => ({ t: p, kind: "push" })),
    ...markers.map((m) => ({ t: m.at, kind: "tests", m })),
    ...rounds.map((t) => ({ t, kind: "round" }))
  ].sort((a, b) => a.t - b.t);
  let granted = false;
  let red = false;
  let run = false;
  for (const ev of events) {
    const rest2 = path.at(-1).reached;
    if (ev.kind === "round") {
      granted = true;
    } else if (ev.kind === "verdict") {
      if (rest2 !== "reviewed" || granted) path.push({ leg: "review", reached: "reviewed" });
      granted = false;
      red = false;
      run = false;
    } else if (ev.kind === "push") {
      if (run) continue;
      if (rest2 === "reviewed" || (rest2 === legs.backTo || rest2 === legs.opened) && red) {
        path.push({ leg: legs.back, reached: legs.backTo });
        red = false;
        run = true;
      }
    } else if (rest2 === legs.opened || rest2 === legs.backTo) {
      red = ev.m.tests === "red";
      run = false;
      path.push({ leg: "run-tests", reached: rest2 });
    }
  }
  return path;
}
var backRunsOf = (path, legs = CREATE_PR_LEGS) => path.filter((s) => s.leg === legs.back).length;
var boundsOf = (graph) => ({
  legs: CREATE_PR_LEGS,
  back: "fix",
  rounds: graph.legs?.review?.max_runs ?? DEFAULT_CREATE_PR_REVIEW_ROUNDS,
  adjudicates: graph.legs?.adjudicate != null,
  gate: graph.legs?.["run-tests"] != null
});
var SPEC_LEGS = { open: "converse", opened: "spec-open", back: "address", backTo: "spec-open" };
var at = (station, path, next) => ({ station, path, next_leg: next[0]?.leg ?? null, next_source: "course", handoff_url: null, next, bars: {} });
var noMarkers = (stations) => ({ stations, markers: [], course_data: {} });
var closesOfTicket = (t) => {
  const c = t.course?.closes;
  if (!Array.isArray(c)) return [];
  const out = [];
  for (const x of c) {
    if (x != null && typeof x.leg === "string" && typeof x.reached === "string") out.push({ leg: x.leg, reached: x.reached });
  }
  return out;
};
var specMarkersOf = (tickets) => {
  const out = { conversed: /* @__PURE__ */ new Set(), addressed: /* @__PURE__ */ new Map() };
  for (const t of tickets) {
    for (const m of closesOfTicket(t)) {
      if (m.leg === "converse" && m.reached === "requested") out.conversed.add(t.id);
      if (m.leg === "address" && m.reached === "reviewed") out.addressed.set(t.id, (out.addressed.get(t.id) ?? 0) + 1);
    }
  }
  return out;
};
function adjudicationOf(fact) {
  const last = verdictsOf(fact).at(-1)?.submittedAt ?? Number.NEGATIVE_INFINITY;
  const marks = fact.reviews.filter((r) => r.submittedAt > last && markerOf2(r, ADJUDICATED)).sort((a, b) => a.submittedAt - b.submittedAt);
  const m = marks.length ? markerOf2(marks.at(-1), ADJUDICATED) : null;
  return m ? m[1] === "merge" ? "merge" : "owner" : null;
}
var NO_GATE = { gate: "green", markers: [], answers: /* @__PURE__ */ new Map(), rounds: [], url: null, unreachable: [] };
var ordinal = (n) => {
  const tens = n % 100;
  const suffix2 = tens >= 11 && tens <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix2}`;
};
var roundsDecision = (rounds, url) => ({
  id: `review-rounds-${rounds}`,
  leg: "adjudicate",
  asks: "owner",
  ...url ? { url } : {},
  question: `${rounds} failed reviews \u2014 manual review or start a ${ordinal(rounds + 1)} round?`,
  options: [{ id: "merge" }, { id: "owner" }, { id: "round", grants: { leg: "review", runs: 1 } }]
});
var UNREACHABLE = "run-tests-unreachable";
var unreachableDecision = (prs, url) => ({
  id: UNREACHABLE,
  leg: "run-tests",
  asks: "owner",
  ...url ? { url } : {},
  question: `The test gate cannot run on ${prs.slice(0, 3).join(", ")}${prs.length > 3 ? ", \u2026" : ""} \u2014 skip it for this ticket?`.slice(0, 200),
  options: [{ id: "skip" }]
});
function placeOf(fact, graph, bounds = boundsOf(graph), pending = false, input = NO_GATE) {
  const path = timelineOf(fact, bounds.legs, bounds.gate, input.markers, input.rounds);
  const last = path.at(-1).reached;
  const rounds = path.filter((s) => s.leg === "review").length;
  const spent = rounds >= bounds.rounds;
  const answer = bounds.gate ? input.answers.get(`review-rounds-${rounds}`) : void 0;
  const adjudication = !bounds.adjudicates || last !== "reviewed" ? null : bounds.gate ? spent && (answer === "merge" || answer === "owner" || answer === "round") ? answer : null : adjudicationOf(fact);
  if (fact.state === "merged") {
    if (adjudication && adjudication !== "round") path.push({ leg: "adjudicate", reached: "adjudicated" });
    const end = path.at(-1).reached;
    if (end !== "reviewed" && end !== "adjudicated") path.push({ leg: "review", reached: "reviewed" });
    return at("merged", [...path, { leg: "merge", reached: "merged" }], []);
  }
  if (adjudication === "round") {
    return at("reviewed", path, [{ leg: "review", state: "ready", waiting_on: null }]);
  }
  if (adjudication) path.push({ leg: "adjudicate", reached: "adjudicated" });
  if (adjudication) return at("adjudicated", path, [{ leg: "merge", state: adjudication === "merge" ? "ready" : "waiting", waiting_on: adjudication === "merge" ? null : "owner" }]);
  const wait = checksDone(fact) ? null : "ci";
  if (last === bounds.legs.opened || last === bounds.legs.backTo) {
    if (bounds.gate) {
      if (input.gate === "unreachable") {
        return { ...at(last, path, [{ leg: "run-tests", state: "waiting", waiting_on: "owner" }]), decisions: [unreachableDecision(input.unreachable, input.url ?? fact.url ?? null)] };
      }
      if (input.gate === "open") return at(last, path, [{ leg: "run-tests", state: "ready", waiting_on: null }]);
      if (input.gate === "red") return at(last, path, [{ leg: bounds.back, state: "ready", waiting_on: null }]);
      if (input.gate === "ci") return at(last, path, [{ leg: "review", state: "waiting", waiting_on: "ci" }]);
    }
    return at(last, path, [{ leg: "review", state: wait ? "waiting" : "ready", waiting_on: wait }]);
  }
  if (verdictOf(verdictsOf(fact).at(-1)) === "approve") return at("reviewed", path, [{ leg: "merge", state: "ready", waiting_on: null }]);
  if (spent) {
    if (!bounds.adjudicates) return at("reviewed", path, [{ leg: "merge", state: "waiting", waiting_on: "owner" }]);
    if (!bounds.gate) return at("reviewed", path, [{ leg: "adjudicate", state: "ready", waiting_on: null }]);
    return { ...at("reviewed", path, [{ leg: "adjudicate", state: "waiting", waiting_on: "owner" }]), decisions: [roundsDecision(rounds, input.url ?? fact.url ?? null)] };
  }
  if (pending) return at("reviewed", path, [{ leg: bounds.back, state: "waiting", waiting_on: "owner" }]);
  return at("reviewed", path, [{ leg: bounds.back, state: "ready", waiting_on: null }]);
}
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
var sameRepo = (a, b) => a.toLowerCase() === b.toLowerCase();
function prRefs(prs, home) {
  const out = [];
  for (const p of prs) {
    const text = String(p).trim();
    if (/^#?\d+$/.test(text)) out.push({ repository: home ?? null, number: text.replace(/^#/, "") });
    let url = text.replace(/[?#].*$/, "");
    for (let i = 0; i < 8 && url.startsWith("http"); i++) {
      const ref = parsePrUrl(url);
      if (ref) {
        out.push({ repository: ref.path, number: ref.number });
        break;
      }
      url = url.slice(0, url.lastIndexOf("/"));
    }
  }
  return out;
}
var refNames = (ref, f, home) => {
  if (ref.number !== String(f.number)) return false;
  const repo = f.repository ?? home ?? null;
  return ref.repository == null || repo == null || sameRepo(ref.repository, repo);
};
var matchPatterns = (branchPatterns) => (branchPatterns?.length ? branchPatterns : [DEFAULT_BRANCH_PATTERN]).map((p) => p.replace(/\{repository\}/g, "*"));
var readsRepo = (t, f, home) => {
  const repo = f.repository ?? home ?? null;
  return repo == null || home == null || sameRepo(repo, home) || (t.repos ?? []).some((r) => sameRepo(r, repo));
};
function ticketOwns(t, pr, patterns, repository) {
  if (!readsRepo(t, pr, repository)) return false;
  return prRefs(t.course?.prs ?? [], repository).some((r) => refNames(r, pr, repository)) || pr.sameRepository !== false && patterns.some((p) => branchMatches(p.replace(/\{ticket\}/g, t.id), pr.head));
}
function together(facts) {
  if (facts.length === 1) return facts[0];
  const open = facts.filter((f) => f.state === "open");
  const pushes = facts.flatMap((f) => f.pushes?.length ? f.pushes : [f.pushedAt]).sort((a, b) => a - b);
  return {
    number: Math.min(...facts.map((f) => f.number)),
    head: facts[0].head,
    repository: facts[0].repository,
    state: open.length ? "open" : "merged",
    pushedAt: Math.max(...pushes),
    pushes,
    checks: open.flatMap((f) => f.checks),
    reviews: facts.flatMap((f) => f.reviews)
  };
}
function stationsPr(ctx) {
  const graph = ctx.graph ?? {};
  const stations = {};
  const patterns = matchPatterns(ctx.branchPatterns);
  const markers = [];
  const bounds = boundsOf(graph);
  const record = ctx.baton?.legs ?? [];
  const done = ctx.done ?? ctx.closed;
  const delivers = graph.legs?.[CONFIRM_LEG]?.kind === "person";
  const prefixes = /* @__PURE__ */ new Map();
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    const mine = ctx.facts.filter((f) => f.state !== "closed" && ticketOwns(t, f, patterns, ctx.repository));
    const ran = delivers ? deliveredRuns(record, t.id) : { count: 0, pending: false };
    if (!mine.length && ran.pending) {
      stations[t.id] = at(DELIVERED_STATION, [...deliveredLoops(ran.count - 1), { leg: "implement", reached: DELIVERED_STATION }], [{ leg: CONFIRM_LEG, state: "ready", waiting_on: null }]);
      continue;
    }
    if (!mine.length) {
      const waiting = t.depends_at ? [] : t.depends_on.filter((d) => !done.has(d));
      const ready = waiting.length === 0 && t.blocked_by.length === 0;
      const waitingOn = waiting.length ? "dependencies" : t.blocked_by.length ? "children" : null;
      stations[t.id] = {
        station: "filed",
        path: deliveredLoops(ran.count),
        next_leg: "implement",
        next_source: "course",
        handoff_url: null,
        next: [{ leg: "implement", state: ready ? "ready" : "waiting", waiting_on: waitingOn }],
        bars: {}
      };
      continue;
    }
    if (ran.count > 0) prefixes.set(t.id, deliveredLoops(ran.count));
    if (!bounds.gate) {
      stations[t.id] = placeOf(together(mine), graph, bounds);
      continue;
    }
    const counted = new Map(mine.map((f) => [f, f.commits ? verifiedMarkers(f.commits, t.id, record) : []]));
    const facts = mine.map((f) => {
      if (!f.commits) return f;
      const skip = new Set(counted.get(f).map((m) => m.sha));
      const pushes = f.commits.filter((c) => !skip.has(c.sha)).map((c) => c.at);
      return { ...f, pushes, pushedAt: Math.max(0, ...pushes) };
    });
    const mineAnswers = (ctx.baton?.answers ?? []).filter((a) => a.ticket === t.id);
    const answers = new Map(mineAnswers.map((a) => [a.decision, a.answer]));
    const rounds = mineAnswers.filter((a) => /^review-rounds-\d+$/.test(a.decision) && a.answer === "round" && typeof a.answered_at === "number").map((a) => a.answered_at);
    const open = mine.filter((f) => f.state === "open");
    const isHome = (f) => f.repository == null || ctx.repository == null || sameRepo(f.repository, ctx.repository);
    const home = open.filter(isHome);
    const unreachable = home.length <= 1 ? [] : open.map((f) => `${f.repository ?? ctx.repository ?? "the home repository"}#${f.number}`);
    const homeGate = home.length === 0 ? "green" : home[0].commits ? gateOfBranch(home[0].commits, counted.get(home[0])) : "open";
    const ci = siblingCiOf(open.filter((f) => !isHome(f)));
    const gate = answers.get(UNREACHABLE) === "skip" ? "green" : unreachable.length ? "unreachable" : homeGate === "red" || ci === "red" ? "red" : homeGate === "open" ? "open" : ci === "running" ? "ci" : "green";
    const withChanges = open.filter((f) => f.reviews.some((r) => verdictOf(r) === "changes"));
    const url = (withChanges.at(-1) ?? open[0] ?? mine[0]).url ?? null;
    stations[t.id] = placeOf(together(facts), graph, bounds, false, {
      gate,
      markers: [...counted.values()].flat().sort((a, b) => a.at - b.at),
      answers,
      rounds,
      url,
      unreachable
    });
    for (const m of [...counted.values()].flat()) markers.push({ ticket: t.id, leg: "run-tests", ref: m.sha, claim_nonce: m.claim });
  }
  for (const [id, loops] of prefixes) stations[id] = { ...stations[id], path: [...loops, ...stations[id].path] };
  return { stations, markers, course_data: {} };
}
var DELIVERED_STATION = "delivered";
var CONFIRM_LEG = "confirm";
function deliveredRuns(record, ticket) {
  const runs = record.filter((r) => r.ticket === ticket && r.leg === "implement");
  return { count: runs.filter((r) => r.reached === DELIVERED_STATION).length, pending: runs[0]?.reached === DELIVERED_STATION };
}
var deliveredLoops = (n) => Array.from({ length: Math.max(0, n) }, () => [{ leg: "implement", reached: DELIVERED_STATION }, { leg: CONFIRM_LEG, reached: "filed" }]).flat();
function stationsSpec(ctx) {
  const graph = ctx.graph ?? {};
  const stations = {};
  const patterns = matchPatterns(ctx.branchPatterns);
  const done = ctx.done ?? ctx.closed;
  const bounds = {
    legs: SPEC_LEGS,
    back: SPEC_LEGS.back,
    rounds: graph.legs?.review?.max_runs ?? CREATE_SPEC_COURSE.legs.review.max_runs,
    adjudicates: graph.legs?.adjudicate != null,
    gate: false
  };
  const marks = specMarkersOf(ctx.tickets);
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    const mine = ctx.facts.filter((f) => f.state !== "closed" && ticketOwns(t, f, patterns, ctx.repository));
    if (!mine.length) {
      const waiting = t.depends_at ? [] : t.depends_on.filter((d) => !done.has(d));
      const blocked = waiting.length ? "dependencies" : t.blocked_by.length ? "children" : null;
      const wait = blocked ?? (marks.conversed.has(t.id) ? "owner" : null);
      stations[t.id] = at("requested", [], [{ leg: "converse", state: wait ? "waiting" : "ready", waiting_on: wait }]);
      continue;
    }
    const fact = together(mine);
    const path = timelineOf(fact, bounds.legs);
    const pending = (marks.addressed.get(t.id) ?? 0) > backRunsOf(path, bounds.legs);
    stations[t.id] = placeOf(fact, graph, bounds, pending);
  }
  return noMarkers(stations);
}
function stationsReviewPr(ctx) {
  const rounds = ctx.graph?.legs?.review?.max_runs ?? 3;
  const done = ctx.done ?? ctx.closed;
  const stations = {};
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    const refs = prRefs(t.course?.prs ?? [], ctx.repository);
    const fact = ctx.facts.find((f) => readsRepo(t, f, ctx.repository) && refs.some((r) => refNames(r, f, ctx.repository)));
    if (!fact) {
      stations[t.id] = at("requested", [], [{ leg: "review", state: "waiting", waiting_on: "pr" }]);
      continue;
    }
    const verdicts = verdictsOf(fact);
    const path = verdicts.map((v) => ({ leg: "review", reached: verdictOf(v) === "approve" ? "approved" : "changes-requested" }));
    const station = path.at(-1)?.reached ?? "requested";
    if (station === "approved") {
      stations[t.id] = at("approved", path, []);
      continue;
    }
    const lastVerdict = verdicts.at(-1)?.submittedAt ?? Number.NEGATIVE_INFINITY;
    if (fact.reviews.some((r) => r.submittedAt > lastVerdict && markerOf2(r, CONCLUDED))) {
      stations[t.id] = at("concluded", [...path, { leg: "conclude", reached: "concluded" }], []);
      continue;
    }
    if (fact.state !== "open" || path.length >= rounds) {
      stations[t.id] = at(station, path, [
        { leg: "conclude", state: "ready", waiting_on: null },
        ...ctx.graph?.legs?.reconcile ? [{ leg: "review", state: "waiting", waiting_on: "exhausted" }] : []
      ]);
      continue;
    }
    const pushes = fact.pushes?.length ? fact.pushes : [fact.pushedAt];
    const before = path.length ? null : !t.depends_at && t.depends_on.some((d) => !done.has(d)) ? "dependencies" : t.blocked_by.length ? "children" : null;
    const wait = before ?? (station === "changes-requested" && !pushes.some((p) => p > lastVerdict) ? "author" : checksDone(fact) ? null : "ci");
    stations[t.id] = at(station, path, [
      { leg: "review", state: wait ? "waiting" : "ready", waiting_on: wait },
      { leg: "conclude", state: "ready", waiting_on: null }
    ]);
  }
  return { stations, markers: [], course_data: {} };
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

// src/defaults/forges/rest.ts
var sha = (v) => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
var prNumber = (v) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 999999999;
var immutableId = (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
var sameRepository = (head, base) => immutableId(head) && head === base;
function field(v, ...keys) {
  let at2 = v;
  for (const key of keys) {
    if (typeof at2 !== "object" || at2 === null) return void 0;
    at2 = at2[key];
  }
  return at2;
}
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
  const at2 = (api) => ({ repo: `${owner}/${name}`, api: `/repos/${owner}/${name}${api}` });
  const hash = url.hash.slice(1);
  if (kind === "commit") return /^[0-9a-f]{7,40}$/.test(id) ? at2(`/commits/${id}`) : null;
  if (!/^\d+$/.test(id)) return null;
  let f;
  if (f = /^issuecomment-(\d+)$/.exec(hash)) return at2(`/issues/comments/${f[1]}`);
  if (kind === "issues") return hash === "" ? at2(`/issues/${id}`) : null;
  if (f = /^pullrequestreview-(\d+)$/.exec(hash)) return at2(`/pulls/${id}/reviews/${f[1]}`);
  if (f = /^discussion_r(\d+)$/.exec(hash)) return at2(`/pulls/comments/${f[1]}`);
  return hash === "" ? at2(`/pulls/${id}`) : null;
}
var pulls = (path) => `/repos/${path}/pulls`;
var issues = (path, n) => `/repos/${path}/issues/${n}/comments`;
var pullHead = (p, branch = field(p, "head", "ref")) => ({ ...openRef(field(p, "number"), branch, field(p, "head", "sha")), sameRepository: sameRepository(field(p, "head", "repo", "id"), field(p, "base", "repo", "id")) });
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
    head: (p) => ({ ...openRef(field(p, "iid"), field(p, "source_branch"), field(p, "sha")), sameRepository: sameRepository(field(p, "source_project_id"), field(p, "target_project_id")) }),
    openQuery: "state=opened",
    protectedRefusal: (s) => /not allowed to push code to protected branches/i.test(s),
    restFacts: {
      state: (p) => {
        const s = field(p, "state");
        return s === "merged" ? "merged" : s === "opened" ? "open" : s === "closed" ? "closed" : null;
      },
      identity: (path) => project(path),
      ownerId: (p) => field(p, "namespace", "id"),
      commits: (path, n) => `${mergeRequests(path)}/${n}/commits`,
      commit: (c) => ({ oid: field(c, "id"), date: field(c, "committed_date"), message: field(c, "message"), parent: field(c, "parent_ids", 0) }),
      checks: (path, oid) => `${project(path)}/repository/commits/${oid}/statuses`,
      conclusion: (c) => status(field(c, "status")),
      user: (note) => field(note, "system") === true ? null : field(note, "author"),
      author: (u) => field(u, "username"),
      reviewDate: (n) => field(n, "created_at"),
      permission: (path, id) => `${project(path)}/members/all/${id}`,
      canPush: (p, id) => {
        const level = field(p, "access_level");
        return field(p, "id") === id && typeof level === "number" && Number.isSafeInteger(level) && level >= 30;
      },
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
    head: (p) => ({ ...openRef(field(p, "number"), field(p, "head", "label") || field(p, "head", "ref"), field(p, "head", "sha")), sameRepository: sameRepository(field(p, "head", "repo_id"), field(p, "base", "repo_id")) }),
    openQuery: "state=open",
    allQuery: "state=all",
    auth: "token",
    pageSizeKey: "limit",
    protectedRefusal: (s) => /not allowed to push to protected branch/i.test(s),
    restFacts: {
      listQuery: "state=all",
      state: (p) => {
        const s = field(p, "state");
        return field(p, "merged") === true || field(p, "merged_at") ? "merged" : s === "open" || s === "closed" ? s : null;
      },
      identity: (path) => `/repos/${path}`,
      ownerId: (p) => field(p, "owner", "id"),
      commits: (path, n) => `${pulls(path)}/${n}/commits`,
      commit: (c) => ({ oid: field(c, "sha"), date: field(c, "commit", "committer", "date"), message: field(c, "commit", "message"), parent: field(c, "parents", 0, "sha"), tree: field(c, "commit", "tree", "sha") }),
      newestCommitFirst: true,
      treeOf: (path, oid) => `/repos/${path}/git/commits/${oid}`,
      checks: (path, oid) => `/repos/${path}/commits/${oid}/status`,
      checkItems: (p) => field(p, "statuses") ?? (p && (field(p, "total_count") === 0 || Object.keys(p).length === 0) ? [] : void 0),
      conclusion: (c) => status(field(c, "status")),
      user: (c) => field(c, "user"),
      author: (u) => field(u, "login"),
      reviewDate: (c) => field(c, "submitted_at") ?? field(c, "created_at"),
      reviews: (path, n) => `${pulls(path)}/${n}/reviews`,
      unpagedComments: true,
      permission: (path, _id, login) => `/repos/${path}/collaborators/${encodeURIComponent(login)}/permission`,
      canPush: (p, id) => {
        const permission = field(p, "permission");
        return field(p, "user", "id") === id && typeof permission === "string" && ["write", "admin", "owner"].includes(permission);
      },
      scopeRefusal: (msg) => /token.*scope|Only admins can query all permissions/i.test(msg)
    }
  }
};
function status(v) {
  if (v === "success" || v === "skipped" || v === "neutral") return v;
  if (v === "failed" || v === "failure" || v === "error" || v === "canceled" || v === "cancelled") return "failure";
  return null;
}

// src/client/git-env.mjs
var GIT_NONINTERACTIVE_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20"
};

// src/defaults/git.mjs
var { GIT_SSH_COMMAND: defaultSsh, ...noPrompts } = GIT_NONINTERACTIVE_ENV;

// src/defaults/ticket-state.ts
function machineOf(fm) {
  if (fm == null) return {};
  const out = {};
  if (typeof fm.station === "string") out.station = fm.station;
  if (typeof fm.next_leg === "string") out.next_leg = fm.next_leg;
  else if (fm.next_leg === null) out.next_leg = null;
  if (typeof fm.claim === "string") out.claim = fm.claim;
  return out;
}
var closesOf = (t) => {
  const c = t.course ?? {};
  return Array.isArray(c.closes) ? c.closes.filter((x) => x != null && typeof x.leg === "string" && typeof x.reached === "string") : [];
};
var tosOf = (to) => Array.isArray(to) ? to : [to];
function legsOut(graph, station, runs) {
  return Object.entries(graph.legs).filter(([id, l]) => l.from.includes(station) && (l.max_runs == null || (runs.get(id) ?? 0) < l.max_runs)).map(([id]) => id);
}
function stationsTickets(ctx) {
  const done = ctx.done ?? ctx.closed;
  const stations = {};
  for (const t of ctx.tickets) {
    if (ctx.closed.has(t.id)) continue;
    let station = null;
    let queued = null;
    const path = [];
    const runs = /* @__PURE__ */ new Map();
    const closes = closesOf(t);
    const fm = machineOf(t.course ?? {});
    if (closes.length === 0) {
      const stations2 = /* @__PURE__ */ new Set([ctx.graph.start, ...ctx.graph.end, ...Object.values(ctx.graph.legs).flatMap((l) => [...l.from, ...tosOf(l.to)])]);
      if (typeof fm.station === "string" && fm.claim != null && stations2.has(fm.station)) station = fm.station;
      queued = fm.next_leg ?? null;
    }
    for (const m of closes) {
      const leg = Object.hasOwn(ctx.graph.legs, m.leg) ? ctx.graph.legs[m.leg] : void 0;
      if (station == null) {
        station = ctx.graph.start;
      }
      if (leg == null || !leg.from.includes(station) || !tosOf(leg.to).includes(m.reached)) continue;
      if (leg.max_runs != null && (runs.get(m.leg) ?? 0) >= leg.max_runs) continue;
      runs.set(m.leg, (runs.get(m.leg) ?? 0) + 1);
      path.push({ leg: m.leg, reached: m.reached });
      station = m.reached;
      queued = m.next ?? null;
    }
    if (station == null) station = ctx.graph.start;
    const atEnd = ctx.graph.end.includes(station);
    const out = atEnd ? [] : legsOut(ctx.graph, station, runs);
    const fromMarker = queued != null && out.includes(queued);
    const nextLeg = atEnd ? null : fromMarker ? queued : out[0] ?? null;
    const waitOf = (leg) => {
      if (path.length === 0 && leg === ctx.graph.start_leg) {
        if (t.depends_on.some((d) => !done.has(d))) return "dependencies";
        if (t.blocked_by.length) return "children";
      }
      return ctx.waits?.(t, leg) ?? null;
    };
    stations[t.id] = {
      station,
      path,
      next_leg: nextLeg,
      next_source: fromMarker ? "marker" : "course",
      handoff_url: null,
      next: out.map((leg) => {
        const w = waitOf(leg);
        return { leg, state: w ? "waiting" : "ready", waiting_on: w };
      }),
      bars: {}
    };
  }
  return { stations, markers: [], course_data: {} };
}

// src/defaults/courses.ts
var BUG_REPORT_COURSE = {
  start: "reported",
  start_leg: "trace",
  end: ["closed"],
  stations: {
    reported: { label: "Reported" },
    traced: { label: "Cause found" },
    explained: { label: "Origin traced" },
    "new-cause": { label: "Not a duplicate" },
    duplicate: { label: "Duplicate of an open ticket" },
    ticketed: { label: "Fix ticket filed" },
    folded: { label: "Folded into the existing ticket" },
    closed: { label: "Prevention weighed" }
  },
  legs: {
    trace: { from: ["reported"], to: "traced", label: "Trace the symptom to a cause" },
    origin: { from: ["traced"], to: "explained", label: "Trace the cause to its origin" },
    dedupe: { from: ["explained"], to: ["new-cause", "duplicate"], label: "Dedupe by cause" },
    file: { from: ["new-cause"], to: "ticketed", label: "File the fix ticket" },
    fold: { from: ["duplicate"], to: "folded", label: "Fold into the existing ticket" },
    prevent: { from: ["ticketed", "folded"], to: "closed", label: "Weigh prevention" }
  }
};
var DRAFT_TICKET_COURSE = {
  start: "requested",
  start_leg: "research",
  end: ["filed"],
  stations: { requested: { label: "Requested" }, researched: { label: "Researched" }, drafted: { label: "Drafted" }, filed: { label: "Filed" } },
  legs: {
    research: { from: ["requested"], to: "researched", label: "Read the code and the sources" },
    draft: { from: ["researched"], to: "drafted", label: "Write the ticket" },
    check: { from: ["drafted"], to: "filed", label: "Check it, split it, file it" }
  }
};
var SPEC_TO_TICKETS_COURSE = {
  start: "reading",
  start_leg: "decompose",
  end: ["filed"],
  // B-98: entered by `baton request "<one sentence naming the spec>"`, like create-spec and build-app.
  starts_from: "request",
  stations: {
    reading: { label: "Reading the spec" },
    drafted: { label: "Child tickets drafted" },
    checked: { label: "Set checked against the spec" },
    filed: { label: "Children filed" }
  },
  legs: {
    decompose: { from: ["reading"], to: "drafted", label: "Draft one child ticket per spec section" },
    check: { from: ["drafted"], to: "checked", label: "Check the set against the spec" },
    file: { from: ["checked"], to: "filed", label: "File the children, close the request" }
  }
};
var DECISION_COURSE = {
  start: "raised",
  start_leg: "prepare",
  end: ["decided"],
  stations: { raised: { label: "Raised" }, asked: { label: "Waiting on the owner" }, decided: { label: "Answer carried out" } },
  legs: {
    prepare: { from: ["raised"], to: "asked", label: "Write the decision packet" },
    "carry-out": { from: ["asked"], to: "decided", label: "Carry the answer out" }
  }
};
var BUILD_APP_COURSE = {
  start: "requested",
  start_leg: "define",
  end: ["shipped"],
  // B-98: its request pattern, made a command's.
  starts_from: "request",
  stations: {
    requested: { label: "Requested" },
    defined: { label: "Product definition drafted" },
    designed: { label: "Interface designed" },
    architected: { label: "Architecture drafted" },
    planned: { label: "Plan drafted" },
    building: { label: "Tickets filed, being built" },
    shipped: { label: "Verified against the definition" }
  },
  legs: {
    define: { from: ["requested"], to: "defined", label: "Draft the product definition" },
    design: { from: ["defined"], to: "designed", label: "Design the interface and mock it up" },
    architect: { from: ["designed"], to: "architected", label: "Decide the architecture and operations" },
    plan: { from: ["architected"], to: "planned", label: "Plan the tickets" },
    file: { from: ["planned"], to: "building", label: "File the planned tickets" },
    verify: { from: ["building"], to: ["shipped", "building"], max_runs: 3, label: "Verify the build, file fixes" }
  }
};
var APPROVAL_STAGES = ["define", "design", "architect", "plan"];
var BUILD_APP_GATES = { design: "define", architect: "design", plan: "architect", file: "plan" };
var buildAppWaits = (t, leg) => {
  if (leg === "verify") return t.blocked_by.length ? "children" : null;
  const gate = BUILD_APP_GATES[leg];
  if (gate == null) return null;
  const a = t.course?.answer;
  const approved = typeof a === "string" ? APPROVAL_STAGES.indexOf(a.trim().toLowerCase()) : -1;
  return approved >= APPROVAL_STAGES.indexOf(gate) ? null : "owner";
};
var answered = (t) => {
  const a = t.course?.answer;
  return typeof a === "string" && a.trim() !== "" && a.trim().toLowerCase() !== "open";
};
var ticketStations = (waits) => (ctx) => stationsTickets({ tickets: ctx.tickets, closed: ctx.closed, done: ctx.done, graph: ctx.graph, waits });
var VERDICT2 = { name: "verdict", values: ["approve", "changes"] };
var CREATE_PR = {
  id: "create-pr",
  // 5: B-311's reconcile leg (min_runner_version 3).
  version: 5,
  summary: "implement a ticket in a PR, gate every review round behind its tests, review it in up to three blind rounds, fix, hand the third round's blockers to the owner, merge",
  course: CREATE_PR_COURSE,
  reads: "prs",
  stations: (ctx) => stationsPr({ tickets: ctx.tickets, facts: ctx.facts, closed: ctx.closed, done: ctx.done, branchPatterns: ctx.branchPatterns, repository: ctx.repository, graph: ctx.graph, ...ctx.baton ? { baton: ctx.baton } : {} }),
  legs: {
    // B-81: the stub verifies its PR on the forge (open, on a branch the patterns map to this
    // ticket, its head pushed) before returning pr-open — never the agent's exit code alone.
    // B-110: what follows implement is the gate, not the round — the claim's walk runs
    // run-tests before any review, green advancing and red routing back to a fix.
    // B-257: an agent that finds the ticket already on the default branch answers `delivered
    // <sha> <evidence>`; the stub checks the commit is there and returns `delivered`, where the
    // person leg `confirm` waits — no PR, no note branch, no failed attempt.
    implement: { position: "{ reached: 'pr-open', next: 'run-tests' }", verify: "pr", delivered: true },
    // B-110: the deterministic gate — no agent. The stub runs `npm run <test_script>` itself on
    // the PR branch's fetched head, bounded, and returns the station it ran from (the claim's,
    // pr-open or fixed): green advances to review, red routes to fix — never back to implement —
    // wherever the push came from, naming the failing script's last lines in the marker it
    // makes on the tested head and the close pushes.
    "run-tests": { position: "station", tests: true },
    // The verdict decides what the review queues: merge for approve, fix for changes — until the
    // rounds run out (B-110: the run that reaches the file's `max_runs`, or one the owner granted
    // past it): then changes queue `adjudicate`, waiting on the owner, so the claim suspends
    // there rather than spend a fix the owner has not asked for (round 1, finding 6).
    review: { ask: VERDICT2, reviewBound: true, position: "{ ...(answer !== 'approve' && roundsSpent ? { suspend: true } : {}), reached: 'reviewed', next: answer === 'approve' ? 'merge' : roundsSpent ? 'adjudicate' : 'fix', verdict: answer }" },
    // B-110: a fix's push re-opens the gate, so what follows fix is run-tests again — the next
    // round waits on a green head, never on the fix's own word for it.
    // B-231: from the gate's red (pr-open, fixed) a fix that pushed nothing is no fix — the stub
    // fails the leg rather than send the unchanged tree back to the gate, up to 30 times.
    fix: { position: "{ reached: 'fixed', next: 'run-tests' }", pushes: "after-red" },
    // B-110: the third round's blockers are the owner's — the leg waits on them (the sync posts
    // the `review-rounds-<n>` decision carrying their question) until they answer through Baton
    // (`baton owner resolve … merge|owner|round`). No agent reproduces anything, so no runner is
    // offered the leg: the position below is what a holder would report if one ever ran it by hand.
    adjudicate: { ask: { name: "adjudication", values: ["merge", "owner"] }, position: "{ ...(answer === 'owner' ? { suspend: true } : {}), reached: 'adjudicated', next: 'merge', adjudication: answer }" },
    // R-BTN-131: the stub reads the forge before it reports `merged`.
    merge: { position: "{ reached: 'merged', next: null }", verify: "merged" },
    archive: { position: "{ reached: 'archived', next: null }", archive: true },
    reconcile: { position: "null" }
  },
  skill: "baton-create-pr"
};
var BUILT_INS = [
  CREATE_PR,
  {
    id: "review-pr",
    version: 2,
    summary: "review a PR someone else opened, in rounds, and conclude with a summary",
    course: REVIEW_PR_COURSE,
    reads: "prs",
    stations: (ctx) => stationsReviewPr({ tickets: ctx.tickets, facts: ctx.facts, closed: ctx.closed, done: ctx.done, repository: ctx.repository, graph: ctx.graph }),
    legs: {
      // Changes: the next round waits on the author's push, so the claim suspends.
      review: { ask: VERDICT2, position: "{ ...(answer === 'approve' ? {} : { suspend: true }), reached: answer === 'approve' ? 'approved' : 'changes-requested', next: answer === 'approve' ? null : 'review', verdict: answer }" },
      reconcile: { position: "null" },
      conclude: { position: "{ reached: 'concluded', next: null }" }
    },
    skill: "baton-review-pr"
  },
  {
    id: "bug-report",
    summary: "trace a reported bug to its cause and origin, dedupe it by cause, file the fix ticket, weigh prevention",
    course: BUG_REPORT_COURSE,
    reads: "markers",
    stations: ticketStations(),
    legs: {
      trace: { position: "{ reached: 'traced', next: 'origin' }" },
      origin: { position: "{ reached: 'explained', next: 'dedupe' }" },
      dedupe: { ask: { name: "outcome", values: ["new-cause", "duplicate"] }, position: "{ reached: answer, next: answer === 'duplicate' ? 'fold' : 'file' }" },
      file: { position: "{ reached: 'ticketed', next: 'prevent' }" },
      fold: { position: "{ reached: 'folded', next: 'prevent' }" },
      prevent: { position: "{ reached: 'closed', next: null }" }
    },
    skill: "baton-bug-report"
  },
  {
    id: "draft-ticket",
    summary: "research, draft and file a ticket that prescribes its architecture, tests and requirements",
    course: DRAFT_TICKET_COURSE,
    reads: "markers",
    stations: ticketStations(),
    legs: {
      research: { position: "{ reached: 'researched', next: 'draft' }" },
      draft: { position: "{ reached: 'drafted', next: 'check' }" },
      check: { position: "{ reached: 'filed', next: null }" }
    },
    skill: "baton-draft-ticket"
  },
  {
    id: "decision",
    summary: "turn a question only the owner can settle into a one-letter packet, then carry the answer out",
    course: DECISION_COURSE,
    reads: "markers",
    // `carry-out` waits on the owner until the ticket's `answer:` is set.
    stations: ticketStations((t, leg) => leg === "carry-out" && !answered(t) ? "owner" : null),
    legs: {
      // The packet is written; carry-out waits on the owner's answer, so the claim suspends.
      prepare: { position: "{ suspend: true, reached: 'asked', next: 'carry-out' }" },
      "carry-out": { position: "{ reached: 'decided', next: null }" }
    },
    skill: "baton-decision"
  },
  {
    id: "build-app",
    summary: "define a product, design it, decide its architecture and plan it with the owner, file the tickets, verify the build",
    course: BUILD_APP_COURSE,
    reads: "markers",
    stations: ticketStations(buildAppWaits),
    legs: {
      // Each drafted document waits on the owner's approval, so the claim suspends.
      define: { position: "{ suspend: true, reached: 'defined', next: 'design' }" },
      design: { position: "{ suspend: true, reached: 'designed', next: 'architect' }" },
      architect: { position: "{ suspend: true, reached: 'architected', next: 'plan' }" },
      plan: { position: "{ suspend: true, reached: 'planned', next: 'file' }" },
      // The filed tickets are children: verify waits on them.
      file: { position: "{ suspend: true, reached: 'building', next: 'verify' }" },
      // `building`: fix tickets were filed, and the next verification waits on them.
      verify: { ask: { name: "outcome", values: ["shipped", "building"] }, position: "{ ...(answer === 'building' ? { suspend: true } : {}), reached: answer, next: answer === 'shipped' ? null : 'verify' }" }
    },
    skill: "baton-build-app"
  },
  {
    id: "create-spec",
    version: 2,
    summary: "design a specification in conversation with the owner, review it adversarially, address blocking findings in conversation, merge",
    course: CREATE_SPEC_COURSE,
    reads: "prs",
    stations: (ctx) => stationsSpec({ tickets: ctx.tickets, facts: ctx.facts, branchPatterns: ctx.branchPatterns, closed: ctx.closed, done: ctx.done, repository: ctx.repository, graph: ctx.graph }),
    legs: {
      // The design conversation is the owner's session, which Baton neither runs nor waits for:
      // the leg writes its marker at `requested`, ends the claim, and the ticket waits there —
      // on the owner, the sync reading the marker — until the conversation's work lands as a PR.
      converse: { position: "{ suspend: true, reached: 'requested', next: 'converse' }" },
      // The verdict decides what the review queues: merge for approve, address for changes (once
      // the address rounds run out the sync queues adjudicate instead, and a refused fix suspends).
      review: { ask: VERDICT2, position: "{ reached: 'reviewed', next: answer === 'approve' ? 'merge' : 'address', verdict: answer }" },
      // The owner's second conversation: the findings are answered, suspended like `converse`.
      address: { position: "{ suspend: true, reached: 'reviewed', next: 'address' }" },
      // `merge`: no open blocking finding reproduced; `owner`: one did, and the owner decides —
      // the claim suspends until they do.
      adjudicate: { ask: { name: "adjudication", values: ["merge", "owner"] }, position: "{ ...(answer === 'owner' ? { suspend: true } : {}), reached: 'adjudicated', next: 'merge', adjudication: answer }" },
      merge: { position: "{ reached: 'merged', next: null }" },
      reconcile: { position: "null" }
    },
    skill: "baton-create-spec"
  },
  {
    id: "spec-to-tickets",
    summary: "decompose a merged specification into child tickets, check the set against the spec, and file them",
    course: SPEC_TO_TICKETS_COURSE,
    reads: "markers",
    stations: ticketStations(),
    legs: {
      decompose: { position: "{ reached: 'drafted', next: 'check' }" },
      check: { position: "{ reached: 'checked', next: 'file' }" },
      file: { position: "{ reached: 'filed', next: null }" }
    },
    skill: "baton-spec-to-tickets"
  }
];
var REPLACED = { pr: "create-pr" };
function builtIn(id) {
  const name = REPLACED[id] ?? id;
  return BUILT_INS.find((b) => b.id === name);
}
var DEFAULT_COURSE = CREATE_PR.id;

// baton-default.ts
var baton_default_default = {
  // The same signature the sync calls a repository's own function with: edit freely. ctx carries
  // the course's tickets, the PR facts, the closing markers and the course file. Returns
  // {stations, markers, course_data} (R-BTN-74).
  async stations(ctx) {
    return builtIn("build-app").stations(ctx);
  }
};
export {
  baton_default_default as default
};
