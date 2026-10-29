// testCourse.ts — `baton test-course <repository root> <course>` (BATON_SPEC §2d "A test kit, not a
// deploy", R-BTN-64, R-BTN-65; R3-1248): what a home repository's CI runs on a PR that changes
// `.baton/`. It is the local host, not a second implementation: the course file is checked by
// `validateCourse` and accepted or refused by the core exactly as a sync's post would be, every
// live ticket's path is replayed under the proposed file, and a generic run — claim, every leg of
// the shortest route, done, confirmed — goes through the core's own claim, advance and end.
// It needs no access to production. A violation names its rule; none is a pass.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCourse } from '../core/course';
import { graphOf, onGraph, resolvePath, type Graph, type Step } from '../core/graph';
import { checkPayload, DEFAULT_COURSE } from '../core/board';
import { builtIn } from '../defaults/courses';
import { parseSource } from '../defaults/course-source';
import { LocalHost } from './host';
import { openStore } from './store';

export type KitRule = 'course' | 'accepted' | 'legs-scripts' | 'min-worker-version' | 'moves-back' | 'generic-run' | 'no-op';
export interface KitViolation {
  rule: KitRule;
  message: string;
}

/** The versions a course is posted under (`.baton/baton.json`, R-BTN-51); null where unknown. */
export interface Versions {
  version: number;
  min_worker_version: number;
}

export interface KitInput {
  course: string;
  /** The proposed course file, and the one in force (the PR's base), if any. */
  proposed: unknown;
  base: unknown | null;
  proposedVersions: Versions | null;
  baseVersions: Versions | null;
  /** The repository root the kit read (readInputs); null over constructed inputs. The no-op run
   * (B-81) needs it to import the working tree's leg scripts. */
  root?: string | null;
  /** The course entry's `source` (B-33), when .baton/baton.json names one: the standard course
   * whose files the repository scaffolds — how the kit tells a PR course filed under another id
   * (docs' `roadmap-pr`, sourced from `create-pr`) from the marker courses. */
  source?: string | null;
  /** The leg scripts in `legs/` — each name without `.mjs`, and which of §6.13's `run`, `handoff`
   *  and `close` it exports — or null when the course has no `legs/`. */
  legScripts: { name: string; exports: string[]; error?: string }[] | null;
  /** The repository's leg overrides, `legs/<leg>.run.mjs` (R-BTN-131, B-33): each leg name and
   *  whether its module exports `run`, and whether `legs/<leg>.mjs` loads it (`loaded`; a leg
   *  script from before overrides does not). Absent or empty when there are none. */
  overrides?: { name: string; exports: string[]; error?: string; loaded?: boolean }[];
  /** Live tickets and where the sync placed them under the course in force; null when none were
   *  given (no board), so the replay did not run. */
  live: { id: string; path: Step[] }[] | null;
}

const asRecord = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const names = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : []);

/** §6.13's three exports of a leg script, each a function (default-exported or named, as `baton run` reads them). */
export const LEG_EXPORTS = ['run', 'handoff', 'close'] as const;

/** Which of `LEG_EXPORTS` a loaded leg module provides. */
export function legExports(mod: Record<string, unknown>): string[] {
  const d = mod.default;
  const of = (name: string) => mod[name] ?? (d != null && typeof d === 'object' ? (d as Record<string, unknown>)[name] : undefined) ?? (name === 'run' && typeof d === 'function' ? d : undefined);
  return LEG_EXPORTS.filter((n) => typeof of(n) === 'function');
}

/** The stations and legs of `base` the proposed file has neither under the same name nor through a
 *  `renamed_from` (R-BTN-64: a removal, which older workers would misbehave on). */
export function removed(base: unknown, proposed: unknown): { stations: string[]; legs: string[] } {
  const b = asRecord(base);
  const p = asRecord(proposed);
  const kept = (kind: 'stations' | 'legs', name: string) =>
    Object.hasOwn(asRecord(p[kind]), name) || Object.values(asRecord(p[kind])).some((x) => names(asRecord(x).renamed_from).includes(name));
  return {
    stations: Object.keys(asRecord(b.stations)).filter((s) => !kept('stations', s)).sort(),
    legs: Object.keys(asRecord(b.legs)).filter((l) => !kept('legs', l)).sort(),
  };
}

/** The static rules: the file's own (R-BTN-69), the leg scripts, and a removal's version raise. */
export function staticViolations(k: KitInput): KitViolation[] {
  const out: KitViolation[] = validateCourse(k.proposed).map((v) => ({ rule: 'course', message: `${v.path}: ${v.message} (${v.rule})` }));
  if (out.length) return out;
  if (k.legScripts) {
    const legs = Object.keys(asRecord(asRecord(k.proposed).legs));
    const scripts = k.legScripts.map((x) => x.name);
    for (const l of legs.filter((x) => !scripts.includes(x))) out.push({ rule: 'legs-scripts', message: `leg ${l} has no legs/${l}.mjs` });
    for (const s of scripts.filter((x) => !legs.includes(x))) out.push({ rule: 'legs-scripts', message: `legs/${s}.mjs is no leg of the course` });
    // §6.13: "The test kit fails a script without all three" (round 1, 1-A-9).
    for (const x of k.legScripts) {
      // a script that does not load is its own failure, with its error (round 2, 2-r2-3)
      if (x.error) { out.push({ rule: 'legs-scripts', message: `legs/${x.name}.mjs does not load: ${x.error}` }); continue; }
      const missing = LEG_EXPORTS.filter((e) => !x.exports.includes(e));
      if (missing.length) out.push({ rule: 'legs-scripts', message: `legs/${x.name}.mjs exports no ${missing.join(', ')} (§6.13: run, handoff and close)` });
    }
  }
  // An override replaces one leg's run, never its close: it must name a leg and export run.
  for (const o of k.overrides ?? []) {
    const file = `legs/${o.name}.run.mjs`;
    if (!Object.hasOwn(asRecord(asRecord(k.proposed).legs), o.name)) out.push({ rule: 'legs-scripts', message: `${file} overrides no leg of the course` });
    else if (o.error) out.push({ rule: 'legs-scripts', message: `${file} does not load: ${o.error}` });
    else if (!o.exports.includes('run')) out.push({ rule: 'legs-scripts', message: `${file} exports no run(ctx, standard)` });
    else if (o.loaded === false) out.push({ rule: 'legs-scripts', message: `legs/${o.name}.mjs does not load ${file}, so the override never runs — \`baton repo init --course ${k.course} --override ${o.name}\` rewrites it` });
  }
  if (k.base) {
    const r = removed(k.base, k.proposed);
    if (r.stations.length || r.legs.length) {
      const what = [...r.stations.map((s) => `station ${s}`), ...r.legs.map((l) => `leg ${l}`)].join(', ');
      if (!k.proposedVersions || !k.baseVersions) {
        out.push({ rule: 'min-worker-version', message: `removes ${what}, and .baton/baton.json gives no min_worker_version to show it raised (R-BTN-64, R-BTN-65)` });
      } else if (k.proposedVersions.min_worker_version <= k.baseVersions.min_worker_version) {
        out.push({ rule: 'min-worker-version', message: `removes ${what} but leaves min_worker_version at ${k.proposedVersions.min_worker_version}: older workers would misbehave (R-BTN-64, R-BTN-65)` });
      }
    }
  }
  return out;
}

/** Every live ticket's path replayed under the proposed file: one that is no longer a path of it
 *  would be placed back without its evidence changing (R-BTN-64). */
export function replayViolations(proposed: unknown, live: KitInput['live']): KitViolation[] {
  const g = graphOf(proposed);
  return (live ?? []).filter((t) => !onGraph(g, t.path)).map((t) => ({
    rule: 'moves-back',
    message: `${t.id}: its path ${t.path.map((s) => `${s.leg}→${s.reached}`).join(', ') || '(none)'} is not a path of the proposed course${
      resolvePath(g, t.path).some((s) => !g.legs.has(s.leg) || !g.stations.has(s.reached)) ? ' (a leg or station it ran is gone)' : ''}: the ticket would move back with the same evidence`,
  }));
}

/** The shortest route from the start to an end, as steps (breadth-first over every leg's outcomes),
 * its first step the course's `start_leg`: a new ticket's queued leg, the only one its first
 * advance may take (R-BTN-83, `not-queued`). Found by B-28's `review-pr`, whose shortest route
 * from `requested` was its other leg. */
export function shortestRoute(g: Graph): Step[] | null {
  if (g.ends.has(g.start)) return [];
  const first = g.legs.get(g.startLeg);
  if (!first) return null;
  const prev = new Map<string, { from: string; step: Step } | null>([[g.start, null]]);
  let frontier: string[] = [];
  for (const to of first.to) if (!prev.has(to)) { prev.set(to, { from: g.start, step: { leg: g.startLeg, reached: to } }); frontier.push(to); }
  while (frontier.length) {
    const next: string[] = [];
    for (const s of frontier) {
      if (g.ends.has(s)) {
        const route: Step[] = [];
        for (let at = s; prev.get(at); at = prev.get(at)!.from) route.unshift(prev.get(at)!.step);
        return route;
      }
      for (const [leg, l] of [...g.legs].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (!l.from.includes(s)) continue;
        for (const to of l.to) if (!prev.has(to)) { prev.set(to, { from: s, step: { leg, reached: to } }); next.push(to); }
      }
    }
    frontier = next;
  }
  return null;
}

const REPO = 'kit'; // the repository under test, as the kit's own local host registers it
const CRED = 'test-course';
const SHA = (n: number) => n.toString(16).padStart(40, '0');

/** The core's verdict, on a fresh in-memory local host: the base file then the proposed one posted
 *  as a sync would post them (accepted, not refused — R-BTN-69), and one generic run of a ticket
 *  along the proposed course's shortest route: claim, each leg, done, confirmed by the next post. */
export async function coreViolations(k: KitInput): Promise<KitViolation[]> {
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const { store } = openStore(':memory:');
  const host = new LocalHost({
    store, alarm: 'manual',
    config: {
      BATON_ORIGIN: 'http://127.0.0.1', OIDC_ISSUER: '', OIDC_JWKS_URL: '', ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', OWNER_EMAILS: '',
      CREDENTIALS: JSON.stringify({ [CRED]: { hostname: 'test-course', allowed_capabilities: ['agent-venue'] } }),
      TOKEN_HASHES: JSON.stringify({ [CRED]: 'unused' }),
      BATON_REPOSITORIES: JSON.stringify([{ id: REPO, github: 'local/kit', default_branch: 'main', sync_workflow: '.github/workflows/baton-sync.yml' }]),
    },
  });
  const core = host.core;
  core.now = () => clock; // R-BTN-32: the kit's own clock, so the run is the same every time
  await host.start();
  const out: KitViolation[] = [];
  const version = k.proposedVersions ?? { version: 1, min_worker_version: 1 };
  const entry = (course: unknown, v: Versions) => ({ id: k.course, version: v.version, min_worker_version: v.min_worker_version, skill: k.course,
    course, step_kinds: ['other'], branch_pattern: 'claude/{ticket}-*' });
  const ticket = (id: string) => ({ id, course_id: k.course, path: `tickets/${id}.md`, title: id, tier: 'routine', requires: [], operator_only: false,
    expedite: false, depends_on: [], blocked_by: [], repos: [], rank: 1 });
  let n = 0;
  const post = async (registry: unknown[], stations: Record<string, unknown>, closed: { id: string; as: 'done' }[] = []) => {
    const repo = core.registry.get(REPO)!;
    // R-BTN-62: a number first, as the sync takes it; any refusal is the kit's failure (round 1, 1-A-8).
    const observation = core.observations.observe(REPO).observation;
    const tickets = Object.keys(stations).map(ticket);
    // checked as the sync route checks a post, then judged by the core's own board()
    const p = checkPayload({ registry, sha: SHA(++n), parent_sha: n === 1 ? null : SHA(n - 1), tickets, closed, stations, observation });
    return (await core.board(repo, p)) as Record<string, unknown>;
  };
  const placedAt = (g: Graph, path: Step[]) => {
    const at = path.length ? path[path.length - 1].reached : g.start;
    const next = [...g.legs].filter(([, l]) => l.from.includes(at)).map(([leg]) => ({ leg, state: 'ready' }));
    return { station: at, path, next_leg: next[0]?.leg ?? null, next_source: 'marker', next, bars: {} };
  };
  try {
    const proposed = graphOf(k.proposed);
    // The base file first, with the live tickets where it placed them; then the proposed one.
    if (k.base) await post([entry(k.base, k.baseVersions ?? version)], Object.fromEntries((k.live ?? []).filter((t) => onGraph(graphOf(k.base), t.path)).map((t) => [t.id, placedAt(graphOf(k.base), t.path)])));
    const route = shortestRoute(proposed) ?? [];
    await post([entry(k.proposed, version)], { 'KIT-1': placedAt(proposed, []) });
    const refused = core.courses.refusals().filter((r) => r.course_id === k.course);
    for (const r of refused) for (const v of r.violations) out.push({ rule: 'accepted', message: `the core refuses the file: ${v.path}: ${v.message} (${v.rule})` });
    if (refused.length) return out;
    if (!route.length) return [{ rule: 'generic-run', message: `no route from ${proposed.start} to an end` }];

    // One generic run (S-BTN-17 in the course's terms): claim, run the route, end done, confirmed.
    core.store.transaction(() => core.cutover.cutover('test-course', { repository: REPO, confirm: true }));
    const secret = 'test-course-secret';
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const hb = await core.workers.heartbeat(CRED, null, { hostname: 'test-course', session_name: 'test-course', harness: 'claude-code', kind: 'vm', capabilities: ['agent-venue'],
      model_id: 'anthropic/kit', model_provider_id: 'anthropic', billing: { anthropic: 'kit' },
      tier_ceiling: 'critical', lease_timeout_s: 3600, secret_hash: hash, courses: [{ repository: REPO, course: k.course, version: version.version }] }) as { worker_id: number };
    const tx = <T>(f: () => T) => core.store.transaction(f);
    const claim = tx(() => core.claims.claim(hb.worker_id, { request_id: 'test-course-1', ticket_id: `${REPO}:KIT-1` })) as { claim_id?: number; code?: string; message?: string };
    if (!claim.claim_id) return [{ rule: 'generic-run', message: `the claim at ${proposed.start} was refused: ${claim.code ?? ''} ${claim.message ?? ''}`.trim() }];
    let at = proposed.start;
    for (const step of route) {
      clock += 60_000;
      const r = tx(() => core.claims.advance(hb.worker_id, claim.claim_id!, { leg: step.leg, ...(at === proposed.start ? {} : { reached: at }) })) as { ok?: boolean; code?: string; rule_code?: string };
      if (!r.ok) return [{ rule: 'generic-run', message: `advance into ${step.leg} from ${at} was refused: ${r.code ?? ''} ${r.rule_code ?? ''}`.trim() }];
      at = step.reached;
    }
    clock += 60_000;
    const end = tx(() => core.claims.end(hb.worker_id, claim.claim_id!, { end_reason: 'done', reached: at, ended_at_sha: SHA(999) })) as { ok?: boolean; code?: string };
    if (!end.ok) return [{ rule: 'generic-run', message: `the done end at ${at} was refused: ${end.code ?? ''}` }];
    const posted = await post([entry(k.proposed, version)], { 'KIT-1': placedAt(proposed, route) });
    if (!posted.confirmed) out.push({ rule: 'generic-run', message: `the done end at ${at} was not confirmed by a snapshot placing the ticket there` });
  } catch (e) {
    out.push({ rule: 'generic-run', message: `the local host failed: ${(e as Error).message}` });
  } finally {
    await host.stop();
  }
  return out;
}

/** B-81: a stub whose leg opens a PR verifies it on the forge before claiming it — an agent
 * that exits 0 without one is not the leg's outcome. The kit runs the course's start leg in a
 * scratch checkout whose `agent_command` is a no-op (`true`, exit 0) and whose origin no forge
 * answers, so nothing can be verified: the leg script must fail its leg (naming what it looked
 * for), and one that returns a position anyway is the violation the first acceptance run hit —
 * the claim advanced to a review of nothing. Marker courses are exempt: their stubs report the
 * agent's `reached`, and the core checks that against the course graph before the marker is
 * closed — the weaker form the ticket leaves alone. */
export async function noopViolations(k: KitInput): Promise<KitViolation[]> {
  if (!k.root) return [];
  let standard: ReturnType<typeof builtIn> = undefined;
  try {
    standard = builtIn(k.source != null ? parseSource(k.source).course : k.course);
  } catch {
    standard = undefined; // a source that is not a name: the sync's to refuse, not the kit's
  }
  if (standard?.reads !== 'prs') return [];
  const startLeg = graphOf(k.proposed).startLeg;
  const script = join(k.root, '.baton', 'courses', k.course, 'legs', `${startLeg}.mjs`);
  if (!existsSync(script)) return []; // a missing script is the legs-scripts rule's own failure
  const dir = mkdtempSync(join(tmpdir(), 'baton-kit-noop-'));
  try {
    // The scratch checkout: a no-op agent_command at the snapshot, and an origin no forge
    // answers, so the verification cannot succeed and must say so.
    const git = (out: boolean, ...args: string[]) =>
      String(execFileSync('git', ['-C', dir, '-c', 'user.name=kit', '-c', 'user.email=kit@baton.test', ...args], { stdio: ['ignore', out ? 'pipe' : 'ignore', 'ignore'], ...(out ? { encoding: 'utf8' } : {}) }));
    git(false, 'init', '-q', '-b', 'main');
    git(false, 'remote', 'add', 'origin', 'https://127.0.0.1:1/kit/no-forge.git');
    mkdirSync(join(dir, '.baton'), { recursive: true });
    writeFileSync(join(dir, '.baton', 'baton.json'), JSON.stringify({ agent_command: 'true', courses: [{ id: k.course, version: 1, min_worker_version: 1 }] }));
    git(false, 'add', '-A');
    git(false, 'commit', '-qm', 'kit');
    const sha = git(true, 'rev-parse', 'HEAD').trim();
    const mod = (await import(`${pathToFileURL(script).href}?t=${Math.random()}`)) as Record<string, unknown>;
    const run = mod.run ?? (mod.default != null && typeof mod.default === 'object' ? (mod.default as Record<string, unknown>).run : undefined) ?? (typeof mod.default === 'function' ? mod.default : undefined);
    if (typeof run !== 'function') return []; // a script that exports no run is the legs-scripts rule's
    try {
      const result = await (run as (ctx: unknown) => Promise<unknown>)({ ticket: { id: `${REPO}:KIT-1`, home: REPO }, leg: startLeg, checkout: dir, snapshot: { sha } });
      return [{ rule: 'no-op', message: `legs/${startLeg}.mjs returned ${JSON.stringify(result)} for an agent_command that exits 0 with no PR — the course opens PRs, so its start leg must verify one on the forge before returning its position, failing the leg naming what it looked for (B-81)` }];
    } catch {
      return []; // the leg refused the no-op: what B-81 asks
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** B-100: a marker course's close writes the ticket — and the boundary check is the leg's
 *  outcome, not the agent's exit. The kit runs the course's start leg's `close` in a scratch
 *  checkout whose ticket file is valid frontmatter but carries no `## <start leg>` heading (a
 *  no-op agent wrote nothing): the close must fail the leg naming the heading. One that pushes
 *  a state change anyway is the violation — the ticket is the record, and nothing the agent
 *  touched is trusted unchecked. */
export async function ticketViolations(k: KitInput): Promise<KitViolation[]> {
  if (!k.root) return [];
  let standard: ReturnType<typeof builtIn> = undefined;
  try {
    standard = builtIn(k.source != null ? parseSource(k.source).course : k.course);
  } catch {
    standard = undefined; // a source that is not a name: the sync's to refuse, not the kit's
  }
  if (standard?.reads !== 'markers') return [];
  const startLeg = graphOf(k.proposed).startLeg;
  const script = join(k.root, '.baton', 'courses', k.course, 'legs', `${startLeg}.mjs`);
  if (!existsSync(script)) return []; // a missing script is the legs-scripts rule's own failure
  const dir = mkdtempSync(join(tmpdir(), 'baton-kit-ticket-'));
  try {
    // A local bare origin the close can really fetch (round 1, finding 5): the rule must reach
    // the close's own checks, not pass on a fetch that cannot connect.
    const origin = mkdtempSync(join(tmpdir(), 'baton-kit-ticket-origin-'));
    execFileSync('git', ['-C', origin, 'init', '-q', '--bare', '-b', 'main'], { stdio: 'ignore' });
    const git = (out: boolean, ...args: string[]) =>
      String(execFileSync('git', ['-C', dir, '-c', 'user.name=kit', '-c', 'user.email=kit@baton.test', ...args], { stdio: ['ignore', out ? 'pipe' : 'ignore', 'ignore'], ...(out ? { encoding: 'utf8' } : {}) }));
    git(false, 'init', '-q', '-b', 'main');
    git(false, 'remote', 'add', 'origin', origin);
    mkdirSync(join(dir, 'tickets'), { recursive: true });
    writeFileSync(join(dir, 'tickets', 'kit-1.md'), `---\nid: KIT-1\ntitle: A ticket\n---\n\nA body with no ${startLeg} heading.\n`);
    git(false, 'add', '-A');
    git(false, 'commit', '-qm', 'kit');
    git(false, 'push', '-q', 'origin', 'main');
    const sha = git(true, 'rev-parse', 'HEAD').trim();
    const mod = (await import(`${pathToFileURL(script).href}?t=${Math.random()}`)) as Record<string, unknown>;
    const close = mod.close ?? (mod.default != null && typeof mod.default === 'object' ? (mod.default as Record<string, unknown>).close : undefined);
    if (typeof close !== 'function') return []; // a script that exports no close is the legs-scripts rule's
    try {
      await (close as (ctx: unknown, result: unknown) => Promise<unknown>)(
        { ticket: { id: `${REPO}:KIT-1`, path: 'tickets/kit-1.md', home: REPO }, leg: startLeg, checkout: dir, snapshot: { sha }, claim: { nonce: 'kit' }, default_branch: 'main' },
        { reached: graphOf(k.proposed).legs.get(startLeg)!.to[0], next: null },
      );
      return [{ rule: 'no-op', message: `legs/${startLeg}.mjs's close accepted a ticket with no '## ${startLeg}' heading — the marker courses' state is the ticket itself, so the close must validate it (the item schema, the machine fields, its own heading) and fail the leg naming what broke (B-100)` }];
    } catch {
      return []; // the close refused the mangled ticket: what B-100 asks
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The whole kit over in-memory inputs. */
export async function checkCourse(k: KitInput): Promise<KitViolation[]> {
  const s = staticViolations(k);
  if (s.some((v) => v.rule === 'course')) return s;
  return [...s, ...replayViolations(k.proposed, k.live), ...(await coreViolations(k)), ...(await noopViolations(k)), ...(await ticketViolations(k))];
}

/** The kit's inputs from a repository checkout: the proposed `.baton/` in the working tree, the
 *  base at git `base` (a commit that must resolve; the course absent there is a new course), the
 *  live tickets from a board payload file, and each leg script's exports (imported: the kit runs
 *  in the repository's own CI, on its own code). */
export async function readInputs(root: string, course: string, opts: { base?: string | null; board?: string | null } = {}): Promise<KitInput> {
  const dir = join(root, '.baton', 'courses', course);
  const file = join(dir, 'course.json');
  if (!existsSync(file)) throw new Error(`${file}: no such course file`);
  const proposed = JSON.parse(readFileSync(file, 'utf8'));
  const versionsOf = (json: unknown): Versions | null => {
    const c = (asRecord(json).courses as unknown[] | undefined)?.map(asRecord).find((x) => x.id === course);
    return c && Number.isInteger(c.version) && Number.isInteger(c.min_worker_version) ? { version: c.version, min_worker_version: c.min_worker_version } : null;
  };
  const batonJson = join(root, '.baton', 'baton.json');
  const settings = existsSync(batonJson) ? asRecord(JSON.parse(readFileSync(batonJson, 'utf8'))) : {};
  const proposedVersions = versionsOf(settings);
  // The course entry's source (B-33), where it names one: the standard course whose files the
  // repository scaffolds, however the course is filed here.
  const entry = (settings.courses as unknown[] | undefined)?.map(asRecord).find((x) => x.id === course);
  const courseSource = typeof entry?.source === 'string' ? entry.source : null;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 << 20 });
  let base: unknown = null;
  let baseVersions: Versions | null = null;
  if (opts.base) {
    // A base that does not resolve is an error, never "a new course" (round 1, 1-A-2/1-B-0).
    try {
      git('rev-parse', '--verify', '--quiet', `${opts.base}^{commit}`);
    } catch {
      throw new Error(`--base ${opts.base}: not a commit in ${root} (fetch it, or pass --base none to skip the removal rule)`);
    }
    // Only a path the base does not have reads as absent; a file that is there must parse.
    const show = (path: string) => {
      try {
        git('cat-file', '-e', `${opts.base}:${path}`);
      } catch {
        return null;
      }
      return JSON.parse(git('show', `${opts.base}:${path}`));
    };
    base = show(`.baton/courses/${course}/course.json`);
    baseVersions = versionsOf(show('.baton/baton.json'));
  }
  const legsDir = join(dir, 'legs');
  let legScripts: KitInput['legScripts'] = null;
  const overrides: NonNullable<KitInput['overrides']> = [];
  if (existsSync(legsDir)) {
    legScripts = [];
    for (const f of readdirSync(legsDir).filter((x) => x.endsWith('.mjs')).sort()) {
      const override = f.endsWith('.run.mjs');
      const name = f.slice(0, override ? -'.run.mjs'.length : -'.mjs'.length);
      const into = override ? overrides : legScripts;
      try {
        // An override runs only through a leg script that looks it up: one from before overrides does not.
        // The script must name this course's own override path: a copy of another course's reads that one's.
        const loaded = override ? (existsSync(join(legsDir, `${name}.mjs`)) && readFileSync(join(legsDir, `${name}.mjs`), 'utf8').includes(`.baton/courses/${course}/legs/${name}.run.mjs`)) : undefined;
        into.push({ name, exports: legExports(await import(pathToFileURL(join(legsDir, f)).href)), ...(override ? { loaded } : {}) });
      } catch (e) {
        into.push({ name, exports: [], error: (e as Error).message.split('\n')[0] });
      }
    }
  }
  let live: KitInput['live'] = null;
  if (opts.board) {
    const b = asRecord(JSON.parse(readFileSync(opts.board, 'utf8')));
    const courseOf = new Map((b.tickets as unknown[] ?? []).map(asRecord).map((t) => [String(t.id), String(t.course_id ?? DEFAULT_COURSE)]));
    live = Object.entries(asRecord(b.stations)).filter(([id]) => (courseOf.get(id) ?? course) === course)
      .map(([id, st]) => ({ id, path: (asRecord(st).path as Step[] | undefined) ?? [] }));
  }
  return { course, proposed, base, proposedVersions, baseVersions, root, source: courseSource, legScripts, overrides, live };
}
