// `baton repo sync` (R-BTN-74, R-BTN-93): read, then post one repository observation.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BatonApi, BatonRefusal, envAuth, type Auth, type Transport } from '../runner/api';
import { syncOnce } from '../shared/batonSync.mjs';
import { DEFAULT_URL } from '../client/config.mjs';
import { API_KEY, signingKey } from '../client/sign.mjs';
import { DEFAULT_BRANCH_PATTERN, DEFAULT_CREATE_PR_REVIEW_ROUNDS, REVIEW_DEFAULTS_PATH, readReviewDefault, matchPatterns, sameRepo as sameRepoName, ticketOwns, type BatonRecord, type CodeRepoEntry, type PrFact, type StationsResult } from './course-pr';
import { commitsOf, type BranchCommit } from './pr-markers';
import { parseSource } from './course-source';
import { stampMarkdownVersions } from './ticket-versions';
import { closeTicket, closesByTicket, closesOfCommits, exec, machineOf, setMachineKeys, stationsTickets, ticketsBranch, CLOSE_TIMEOUT_MS } from './ticket-state';

import { DEFAULT_COURSE, builtIn } from './courses';
import { readItems } from './read-items';
import { parseFrontmatter, ticketsMarkdown, type MarkdownSettings, type TicketsResult } from './tickets-markdown';
import { clampUnsignedList, marksOf, signedControlOf, unsignedAgentConfig } from './signed-control';
import { nodeKeygen } from '../shared/commitSign.mjs';
import type { PostedControl, PostedAttestation } from '../core/board';
import { ownRepositoryId, remoteSlug } from './remote-slug';
import { githubFacts, githubConn, plainGitRemote, FETCH_TIMEOUT_MS } from './facts';
import { cliSelf, cliVersion, courseFileText, defaultSkill, sameRepo, type BatonJson, type CourseEntry } from './repo-source';
import { OVERRIDE_SUFFIX } from './stub-config';

/** The retired markers file's path (B-100): the sync no longer reads it — `baton repo
 *  migrate-markers` does, once, and deletes it. */
import { hostOf } from './forge';
import { git, gitText } from './git.mjs';
import { attestEvidence, type EvidenceAttestation, type UnconfirmedEnd } from './evidence';
import { outputAttestation, syncAttestationBatch } from './output-evidence';

const MARKERS_FILE_RETIRED = join('.baton', 'markers.jsonl');
/** The control walks' git (B-127): untrimmed — a commit object's bytes are what its SSHSIG
 *  signed, and `git` above trims, which would verify against a shortened payload (round 1:
 *  a `--cleanup=verbatim` message ending in a blank line failed to verify) — and bounded at
 *  16 MiB, because the walks' one `git log --name-status -n2000` runs through it (round 1:
 *  Node's 1 MiB default overflowed on busy repositories and failed every sync). Callers that
 *  need a single value trim it themselves. */
const gitRaw = (root: string, ...args: string[]): string => git(root, args);

export interface SyncArgs {
  root: string;
  /** Baton's origin; absent, `baton.json`'s `baton_url`, then the CLI's default. */
  url?: string;
  /** Recorded PR facts (tests, R-BTN-96's adapter offline); absent, the forge is read live. */
  factsFile?: string;
  /** `--latest <branch>`: after the observation, fetch that branch and check it out detached, so
   * a slow run for an older push posts the newest board (§7.1 step 2). The workflow passes it. */
  latest?: string;
  /** A CI identity token's place. It serves only a sync with no `syncKey` (B-88): a registered
   * sync key signs, and a CI token beside it is never spent. */
  token?: string;
  /** `--busy-retry <seconds>` (B-89): how long to wait before the one retry a `busy` run gets —
   * another reading was in flight (R-BTN-62), not this run's to post. `0` takes no retry.
   * Defaults to `BUSY_RETRY_S`. */
  busyRetryS?: number;
  /** The repository's sync key (B-88, R-BTN-93): the key file the three calls are signed
   * with, as a runner's are. Set, it is the sync's credential — the no-CI path. */
  syncKey?: string;
  transport?: Transport;
  auth?: Auth;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** A `busy` run's wait before its one retry (B-89, `--busy-retry`): another run's number is
 * outstanding (R-BTN-62), and a minute is long enough for that run to post, while a reading that
 * lapses instead (ten idle minutes, `OBSERVATION_TTL_MS`) is still held `busy:again` — which the
 * run exits 1 on and the workflow annotates. The retry posts whenever the holder posted in the
 * meantime; it never waits out a lapse. */
export const BUSY_RETRY_S = 60;

/** The longest `--busy-retry` waits: a workflow step is minutes, not an hour. The sync step's
 * `timeout-minutes: 10` is this bound, not more than it: at `--busy-retry 600` the step is killed
 * exactly as the wait ends and the retry gets no time — so no workflow in this repository passes
 * the flag (round three, 4), and the 60-second default leaves nine minutes of the step for the
 * two runs. */
const BUSY_RETRY_MAX_S = 600;
/** `BATON_SYNC_KEY`'s environment form of `--sync-key` (B-88). */
const SYNC_KEY_ENV = 'BATON_SYNC_KEY';

export function parseSyncArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Omit<SyncArgs, 'log'> {
  const out: Omit<SyncArgs, 'log'> = {
    root: env.BATON_HOME ?? process.cwd(),
    ...(env.BATON_URL ? { url: env.BATON_URL } : {}),
    ...(env[SYNC_KEY_ENV] ? { syncKey: env[SYNC_KEY_ENV] } : {}),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--root') out.root = value();
    else if (a === '--url') out.url = value();
    else if (a === '--facts') out.factsFile = value();
    else if (a === '--latest') out.latest = value();
    else if (a === '--token') out.token = value();
    else if (a === '--busy-retry') {
      const v = value();
      const s = Number(v);
      if (!/^[0-9]+$/.test(v) || !Number.isSafeInteger(s) || s > BUSY_RETRY_MAX_S) throw new Error(`--busy-retry ${v}: a whole number of seconds, at most ${BUSY_RETRY_MAX_S} — the workflow step's own patience (B-89)`);
      out.busyRetryS = s;
    } else if (a === '--sync-key') out.syncKey = value();
    else throw new Error(`${a}: not a flag of baton repo sync`);
  }
  return out;
}

/** A station function's module, the repository's own `sync.mjs` or the default. */
type StationFn = (ctx: Record<string, unknown>) => Promise<StationsResult> | StationsResult;

/** Check a station function's return against R-BTN-74's shape: `stations` an object of ids,
 * `markers` a list, `course_data` anything. A bare map or a `Map` is refused, naming the file. */
function stationsResult(value: unknown, from: string): StationsResult {
  const v = value as Partial<StationsResult> | null;
  if (v == null || typeof v !== 'object' || v instanceof Map || v.stations == null || typeof v.stations !== 'object' || v.stations instanceof Map) {
    throw new Error(`${from}: stations(ctx) must return {stations, markers, course_data}, stations an object of ticket ids`);
  }
  if (v.markers !== undefined && !Array.isArray(v.markers)) throw new Error(`${from}: markers must be a list`);
  return { stations: v.stations, markers: v.markers ?? [], course_data: v.course_data ?? {} };
}

/** What one reading of the repository posts (§7.1): every field but the protocol's own. */
interface Board {
  payload: { registry: Record<string, unknown>[]; tickets: TicketsResult['tickets']; closed: TicketsResult['closed']; stations: StationsResult['stations']; markers: StationsResult['markers']; course_data: Record<string, unknown>;
    /** B-183 (§4.4): the ticket source's declaration. */
    source: { kind: 'markdown' | 'custom'; versions?: 'pinned' | 'current'; cli: string }; }
  outputEvidence: PostedAttestation[];
  /** A ticket's status at this reading for §6.7's confirmations: its file's, `live`, or null once closed. */
  statusOf: (id: string) => string | null;
}

/** One dependency the sync's dependencies read answered (B-113): the qualified id and whether it
 *  is done on its own board. */
export interface ResolvedDep {
  ticket: string;
  done: boolean;
}

/** Read the board from the checkout as it stands: the tickets and stations from the
 *  repository's own code or the CLI's defaults, the registry from `baton.json`'s courses.
 *  `resolveDeps` (B-113) resolves the qualified `depends_on` entries of other repositories the
 *  live tickets name against their boards — the read a sync makes after its number, as every
 *  input it posts is (§4.3); its doneness joins `done`, so each course's station function gates
 *  on a cross-repository dependency as on a local one (R-BTN-120). */
async function readBoard(root: string, batonJson: BatonJson, args: SyncArgs, log: (l: string) => void, record?: BatonRecord, resolveDeps?: (ids: readonly string[]) => Promise<readonly ResolvedDep[]>): Promise<Board> {
  const settings: MarkdownSettings = { items: batonJson.items, default_course: batonJson.default_course, repos: batonJson.repos };

  // The ticket source: the repository's own, else the markdown default. B-183 (R-BTN-74): a
  // source declares how it reads a ticket (`versions`: 'pinned' at a version, 'current' as it is
  // now) and may export `read(id, {version})`; the markdown default is pinned, each ticket's
  // version its file's blob id at the commit being posted, so an unrelated commit changes no
  // version. `ctx.versions` carries what the observation handed back (§4.3), for a source whose
  // store can tell a stale read to refuse one.
  let result: TicketsResult;
  let sourceKind: 'markdown' | 'custom' = 'markdown';
  let sourceVersions: 'pinned' | 'current' | null = 'pinned';
  const own = join(root, '.baton', 'tickets.mjs');
  const ctx = { root, settings, ...(record?.versions != null ? { versions: record.versions } : {}) };
  if (existsSync(own)) {
    const mod = (await import(`${pathToFileURL(own).href}?at=${gitText(root, 'rev-parse', 'HEAD')}`)) as { default?: { tickets?: (ctx: unknown) => Promise<TicketsResult>; versions?: unknown; read?: unknown } };
    if (typeof mod.default?.tickets !== 'function') throw new Error('.baton/tickets.mjs default-exports no tickets(ctx)');
    sourceKind = 'custom';
    const declared = mod.default.versions;
    if (declared !== undefined && declared !== null) {
      if (declared !== 'pinned' && declared !== 'current') throw new Error(`.baton/tickets.mjs exports versions ${JSON.stringify(declared)} — "pinned" or "current" (R-BTN-74)`);
      // A declaration exports `read` (round 1): a pinned source is read at its version, and a
      // current one read now — the read-now comparison is a current source's whole staleness
      // protection (§4.2), so a declaration without `read` is refused at load, not run with no
      // re-verification at all.
      if (typeof mod.default.read !== 'function') throw new Error(`.baton/tickets.mjs declares versions: ${JSON.stringify(declared)} but exports no read(id, {version}) — a declared source is read through its read (R-BTN-74)`);
      sourceVersions = declared;
    } else {
      sourceVersions = null;
    }
    result = await mod.default.tickets(ctx);
  } else {
    result = stampMarkdownVersions(root, ticketsMarkdown(readItems(root, settings.items), settings), settings.items);
  }
  const closedIds = new Set(result.closed.map((c) => c.id));
  const doneIds = new Set(result.closed.filter((c) => c.as === 'done').map((c) => c.id));

  // B-113: the qualified dependencies the live tickets name. Another repository's resolve
  // against its board — the dependencies read, after the number as everything this run posts is
  // (§4.3) — and one done there is done here, so the station functions gate on it as on a local
  // one (R-BTN-120). The posting repository's own id spelled qualified (`docs:R3-1` posted by
  // docs) is the local id's own dependency read as itself (§3.1): the repos map names this
  // checkout's registered id (the short name its forge path maps to, `.git` and case aside), and
  // a done local target marks its qualified spelling done. A read that refuses — an unregistered
  // repository, an unknown ticket, a less visible target without its owners' consent — fails the
  // run here, before the forge is read, with the same words the post would be refused with.
  const ownRepoId = ownRepositoryId(root, batonJson.repos ?? {});
  const qualified = [...new Set(result.tickets.filter((t) => !closedIds.has(t.id)).flatMap((t) => t.depends_on.filter((d) => d.includes(':'))))];
  if (ownRepoId != null && qualified.some((d) => d.startsWith(`${ownRepoId}:`))) {
    for (const d of qualified) {
      if (d.startsWith(`${ownRepoId}:`) && doneIds.has(d.slice(ownRepoId.length + 1))) doneIds.add(d);
    }
  }
  const foreign = qualified.filter((d) => ownRepoId == null || !d.startsWith(`${ownRepoId}:`));
  if (foreign.length) {
    if (!resolveDeps) throw new Error(`tickets name cross-repository dependencies (${foreign.join(', ')}) that this run cannot resolve — the sync's dependencies read was not given (B-113)`);
    for (const d of await resolveDeps(foreign)) if (d.done) doneIds.add(d.ticket);
  }

  // Every live ticket's course must be one this repository lists (R-BTN-74: a ticket on a course
  // with no station function fails the sync — nothing is posted).
  const courses = batonJson.courses ?? [{ id: batonJson.default_course ?? DEFAULT_COURSE, version: 1 }];
  const listed = new Set(courses.map((c) => c.id));
  const stray = result.tickets.find((t) => !closedIds.has(t.id) && !listed.has(t.course_id));
  if (stray) throw new Error(`ticket ${stray.id} is on course ${stray.course_id}, which .baton/baton.json's courses do not list`);

  // The PR facts: recorded (tests) or the forge's own, gathered through the adapter's seam.
  const repository = remoteSlug(root);
  // A PR is a live ticket's when its course's patterns or the ticket's `prs:` name it.
  const owners = courses.map((c) => ({
    patterns: matchPatterns([c.branch_pattern ?? DEFAULT_BRANCH_PATTERN, ...(c.previous_branch_pattern ? [c.previous_branch_pattern] : [])]),
    tickets: result.tickets.filter((t) => t.course_id === c.id && !closedIds.has(t.id)),
  }));
  const owns = (pr: { number: number; head: string; repository?: string }) => owners.some((o) => o.tickets.some((t) => ticketOwns(t, pr, o.patterns, repository)));
  const syncMjsOf = (id: string): string => join(root, '.baton', 'courses', id, 'sync.mjs');
  // The forge is read only when a course reads PRs: a repository on the marker courses alone
  // (bug-report, draft-ticket, decision) needs no forge token. A course's own sync.mjs may read
  // them, so it gets them too.
  const readsPrsOf = (c: CourseEntry): boolean => existsSync(syncMjsOf(c.id)) || builtIn(c.id)?.reads === 'prs';
  const readsPrs = courses.some(readsPrsOf);
  // The other repositories a live ticket on a PR-reading course names in `repos:` (B-29): its PRs
  // may be there, and a home with none (docs) is the usual case.
  // Each with the tickets naming it, so a repository the token cannot read is named with them.
  const siblings = new Map<string, { repository: string; tickets: string[] }>();
  for (const c of courses.filter(readsPrsOf)) {
    for (const t of result.tickets.filter((x) => x.course_id === c.id && !closedIds.has(x.id))) {
      for (const r of t.repos ?? []) {
        if (repository != null && sameRepoName(r, repository)) continue;
        const s = siblings.get(r.toLowerCase()) ?? { repository: r, tickets: [] };
        s.tickets.push(t.id);
        siblings.set(r.toLowerCase(), s);
      }
    }
  }
  const outputEvidence: PostedAttestation[] = [];
  const ticketOutputEvidence: PostedAttestation[] = [];
  // B-100: the ticket is the record. One traversal of the repository's history groups every
  // `baton:close <id> <leg>` commit by ticket; each live ticket's closes — oldest first — are
  // attached to its opaque `course` blob, which the station functions read, with its
  // frontmatter's machine state beside them (a migration's record, or a hand-edited file: git's
  // history is the authority, never the working tree). No second input, no shared file: a
  // checkout git cannot answer for has no close history, and its frontmatter state stands.
  const origin = repository != null ? gitText(root, 'remote', 'get-url', 'origin') : null;
  const plain = origin != null && plainGitRemote(origin);
  const githubHome = origin != null && hostOf(origin) === 'github.com';
  const closeCommits = closesByTicket((args) => gitText(root, ...args));
  for (const t of result.tickets) {
    if (closedIds.has(t.id) || t.path == null) continue; // a pathless ticket (a tracker's) has no file to close on
    const commits = closeCommits.get(t.id) ?? [];
    const fm = existsSync(join(root, t.path)) ? parseFrontmatter(readFileSync(join(root, t.path), 'utf8')) : null;
    if (!commits.length && fm?.station === undefined) continue;
    if (plain || githubHome) for (const { sha, leg } of commits) {
      const a = outputAttestation(gitText(root, 'show', '-s', '--format=%b', sha), sha);
      if (a?.ticket === t.id && (a.value as { leg: string }).leg === leg) (plain ? outputEvidence : ticketOutputEvidence).push(a);
    }
    const closes = closesOfCommits((args) => gitText(root, ...args), t.path, t.id, commits);
    t.course = { ...(t.course ?? {}), closes, ...machineOf(fm) };
  }

  const facts: PrFact[] = args.factsFile ? (JSON.parse(readFileSync(args.factsFile, 'utf8')) as PrFact[]) : readsPrs || ticketOutputEvidence.length ? await githubFacts(root, log, owns, [...siblings.values()], { codeRepos: record?.code_repos, pushers: record?.pushers, outputEvidence, ticketOutputEvidence, readPrs: readsPrs,
    ownsOutput: (ticket, pr, fork) => owners.some((o) => o.tickets.some((t) => t.id === ticket && ticketOwns(t, pr, fork ? [] : o.patterns, repository))),
  }) : [];
  // B-110: the plain-git half of the fact reading. A fact whose adapter read no commits (a facts
  // file, a forge with no adapter) gets its open branch's commits from the checkout's own git —
  // no forge, no `gh` — so the run-tests gate's markers are read the same way (`commitsOf`). Only
  // the home repository's branches are this checkout's to read; a branch git cannot fetch keeps
  // its fact as it is (its gate stays open).
  const boundedGit = (a: string[]): string => git(root, a, { timeoutMs: CLOSE_TIMEOUT_MS });
  for (const f of facts) {
    if (f.commits || f.state !== 'open' || (f.repository != null && repository != null && !sameRepoName(f.repository, repository)) || !owns(f)) continue;
    try {
      boundedGit(['fetch', '-q', '--no-tags', 'origin', `refs/heads/${f.head}`]);
      f.commits = commitsOf(boundedGit, ['FETCH_HEAD', '--not', 'HEAD']);
    } catch (e) {
      log(`baton: ${f.head}'s commits could not be read from git (${e instanceof Error ? e.message.split('\n')[0] : String(e)}) — its gate reads as open`);
    }
  }

  // Each course's stations, markers and course data: its own sync.mjs, else its standard
  // course's default (courses.ts). The function sees its own course's tickets alone.
  const stations: StationsResult['stations'] = {};
  const markers: StationsResult['markers'] = [];
  const courseData: Record<string, unknown> = {};
  const registry: Record<string, unknown>[] = [];
  for (const c of courses) {
    const courseFile = join(root, '.baton', 'courses', c.id, 'course.json');
    if (!existsSync(courseFile)) throw new Error(`.baton/courses/${c.id}/course.json is missing — run \`baton repo init --course ${c.id}\``);
    const text = readFileSync(courseFile, 'utf8');
    const course = JSON.parse(text) as { start_leg?: string; legs?: Record<string, { max_runs?: number }> };
    if (c.id === 'create-pr' && course.legs?.review && course.legs.review.max_runs == null) {
      const defaults = join(root, REVIEW_DEFAULTS_PATH);
      // Older scaffolds have no fallback file, and use the same legacy default in their stub.
      course.legs.review.max_runs = existsSync(defaults) ? readReviewDefault(readFileSync(defaults, 'utf8')) : DEFAULT_CREATE_PR_REVIEW_ROUNDS;
    }
    const tickets = result.tickets.filter((t) => t.course_id === c.id);
    const start = course.start_leg;
    if (sourceKind === 'markdown' && start) for (const t of tickets) {
      t.depends_at = [...new Set(t.depends_on)].filter((id) => !doneIds.has(id))
        .map((ticket) => ({ ticket, done: true, leg: start }));
    }
    const branchPatterns = [c.branch_pattern ?? DEFAULT_BRANCH_PATTERN, ...(c.previous_branch_pattern ? [c.previous_branch_pattern] : [])];
    const fnCtx = { ...ctx, course: c.id, repository, tickets, closed: closedIds, done: doneIds, facts, branchPatterns, graph: course, ...(record ? { baton: record } : {}) };
    const syncMjs = syncMjsOf(c.id);
    if (c.source) checkSource(c, text, existsSync(syncMjs));
    const standard = builtIn(c.id);
    let fn: StationFn;
    if (existsSync(syncMjs)) {
      const mod = (await import(`${pathToFileURL(syncMjs).href}?at=${gitText(root, 'rev-parse', 'HEAD')}`)) as { default?: { stations?: StationFn } };
      if (typeof mod.default?.stations !== 'function') throw new Error(`.baton/courses/${c.id}/sync.mjs default-exports no stations(ctx)`);
      fn = mod.default.stations;
    } else if (standard) {
      fn = standard.stations as unknown as StationFn;
    } else {
      throw new Error(`course ${c.id} has no sync.mjs and is not a standard course — add .baton/courses/${c.id}/sync.mjs`);
    }
    const out = stationsResult(await fn(fnCtx), existsSync(syncMjs) ? `.baton/courses/${c.id}/sync.mjs` : `the ${standard!.id} default`);
    Object.assign(stations, out.stations);
    markers.push(...out.markers);
    courseData[c.id] = out.course_data;
    registry.push({
      ...courseSchemas(root, c.id),
      // B-68's window: a file still carrying `min_worker_version` keeps its floor — the new
      // name wins when both are set — instead of silently falling back to `version`.
      id: c.id, version: c.version, min_runner_version: c.min_runner_version ?? c.min_worker_version ?? c.version, skill: c.skill ?? defaultSkill(c.id), course,
      step_kinds: c.step_kinds ?? Object.keys(course.legs ?? {}),
      branch_pattern: branchPatterns[0], ...(c.previous_branch_pattern ? { previous_branch_pattern: c.previous_branch_pattern } : {}),
      // B-182 (R-BTN-134): what the course's entry declares it reads — `prs` when this sync reads
      // PR facts for it, nothing when it does not — so R-BTN-190 can follow the PRs without a
      // policy knob, a `git` home's PR course among them.
      facts: readsPrsOf(c) ? ['prs'] : [],
    });
  }
  const status = new Map(result.tickets.map((t) => [t.id, t.display?.status ?? 'live']));
  // B-127 (R-BTN-66 as amended): what counts when a repository's control inputs must be
  // owner-signed. The owner keys come from Baton's observation — never the repository being
  // judged — and the walks read the checkout's git where the objects are. The marks post
  // whether or not the setting is on (item 7); an EXPEDITE whose last change is unsigned is
  // dropped only while it is (item 1), and named in the record either way; the record's groups
  // name the commits a runner loads `agent_command`, overrides and `rank.mjs` from, each runner
  // verifying them again before loading. A failure to read git is a failed sync, never a
  // half-marked board.
  let controlField: { control?: PostedControl } = {};
  const signingKeys = record?.signing_keys ?? [];
  if (signingKeys.length) {
    const gitOf = (...a: string[]): string => gitRaw(root, ...a);
    const head = gitOf('rev-parse', 'HEAD').trim();
    const found = signedControlOf(head, signingKeys, gitOf, nodeKeygen);
    // A ticket a `custom` source keeps in no tree (B-183: no `path`) has no file to mark — its
    // words and its EXPEDITE are the source's, not a commit's.
    const marks = marksOf(head, signingKeys, result.tickets.flatMap((t) => (t.path == null ? [] : [t.path])), gitOf, nodeKeygen);
    for (const t of result.tickets) {
      if (t.path == null) continue;
      const mark = marks.briefs.get(t.path);
      if (mark) t.brief = mark;
      // The EXPEDITE gate, both directions (round 1): the tag's last change unsigned means a
      // push alone moved it — added or removed — and the last signed state stays in force
      // while the setting is on: the notice names the commit either way.
      const gate = marks.expedite.get(t.path);
      if (gate) {
        found?.unsigned.push({ path: t.path, commits: [gate.commit], fields: ['EXPEDITE'] });
        if (record?.require_signed_control) t.expedite = gate.inForce;
      }
    }
    if (found) controlField = { control: { keys: signingKeys.map((k) => k.fingerprint), groups: found.groups, unsigned: clampUnsignedList(found.unsigned) } };
  }
  return {
    // B-183 (§4.4): the source's declaration — `kind`, how it reads (`versions`) and the CLI
    // that posts — beside its tickets, each stamped with its `version` and `key` above.
    payload: {
      source: { kind: sourceKind, ...(sourceVersions ? { versions: sourceVersions } : {}), cli: cliVersion() },
      // R-BTN-139: station functions report observations, not forge authorship. None of
      // their raw markers may be promoted to a std:git.output attestation here.
      registry, tickets: result.tickets.map((t) => sourceKind === 'markdown' && t.depends_at ? { ...t, depends_on: [] } : t),
      closed: result.closed, stations, markers, course_data: courseData, ...controlField,
    },
    outputEvidence,
    statusOf: (id) => (closedIds.has(id) ? null : status.get(id) ?? null),
  };
}

/** A sourced course (B-33, R-BTN-131) is the source's exactly, or the sync posts nothing: the
 * source names this CLI's repository at this CLI's commit (the workflow's pin) and a standard
 * course of the same id, the repository's course file is byte-equal to the one that commit
 * scaffolds, and no `sync.mjs` replaces the source's station function. Each refusal names what
 * to do. Other repositories' courses are not resolved yet: running their station code at sync
 * time needs its own design. */
function checkSource(c: CourseEntry, courseText: string, ownSyncMjs: boolean): void {
  const src = parseSource(c.source!);
  const self = cliSelf();
  const at = `.baton/baton.json: course ${c.id}'s source ${c.source}`;
  if (src.course !== c.id) throw new Error(`${at} names course ${src.course}; a source names the course of its own id`);
  if (!self) throw new Error(`${at}: this CLI is not a git checkout with an origin, so it cannot tell its own commit`);
  if (!sameRepo(src, self)) {
    throw new Error(`${at}: a course from ${src.namespace}/${src.repository} is not supported yet — only this CLI's repository, ${self.namespace}/${self.repository}`);
  }
  if (src.ref !== self.sha) {
    throw new Error(`${at} is at ${src.ref.slice(0, 10)}, and this CLI is at ${self.sha.slice(0, 10)} — re-run \`baton repo init\` with the CLI at the workflow's pin, which moves both`);
  }
  const b = builtIn(src.course);
  if (!b || b.id !== src.course) throw new Error(`${at}: ${src.course} is not a standard course of ${self.namespace}/${self.repository} at ${self.sha.slice(0, 10)}`);
  if (ownSyncMjs) throw new Error(`${at}: .baton/courses/${c.id}/sync.mjs would replace the source's station function — remove it, or remove \`source\` to own the course`);
  if (courseText !== courseFileText(b)) {
    throw new Error(`${at}: .baton/courses/${c.id}/course.json differs from the source's — a sourced course keeps its graph exactly; \`baton repo init --course ${c.id} --force\` restores it, and legs/<leg>${OVERRIDE_SUFFIX} changes a leg's run`);
  }
}

/** A Baton call through the vendored sync's `{ok, code}` shape: a refusal is its code, never a throw. */
async function asResult(call: () => Promise<Record<string, any>>): Promise<Record<string, any>> {
  try {
    return { ok: true, ...(await call()) };
  } catch (e) {
    if (e instanceof BatonRefusal) return { ok: false, code: e.code };
    throw e;
  }
}

/** `baton repo migrate-markers [--root DIR]` (B-100): the one-time migration that folds a
 * retired `.baton/markers.jsonl` into its tickets — the marker courses' state moved into the
 * ticket, and a board still holding in-flight lines is translated once, before the release that
 * stops reading the file. Each live ticket's lines are **replayed as closes**: one
 * `baton:close <ticket> <leg>` commit per line, writing the line's station, queued leg and
 * claim into the ticket's frontmatter, in order — so the ticket's history afterwards is what a
 * native close would have left (the fold, `create-spec`'s interactive-leg records, the rounds
 * counts all read it unchanged), and the final frontmatter is the last line's state. A
 * repository's own `create-spec` lines replay the same way (their tickets' state is not in the
 * forge); lines of closed tickets or PR-course tickets are dropped, named. The last commit
 * deletes the file. A push refused because the branch moved leaves the commits local, named,
 * for a pull and re-push. */
export async function migrateMarkersMain(argv: string[], io: { root?: string; log?: (l: string) => void } = {}): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const root = io.root ?? (argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : process.cwd());
  const batonJsonPath = join(root, '.baton', 'baton.json');
  if (!existsSync(batonJsonPath)) throw new Error(`${root} has no .baton/baton.json — run \`baton repo init\` first`);
  const batonJson = JSON.parse(readFileSync(batonJsonPath, 'utf8')) as BatonJson;
  const file = join(root, MARKERS_FILE_RETIRED);
  if (!existsSync(file)) {
    log('baton: no .baton/markers.jsonl — nothing to migrate');
    return 0;
  }
  // The retired file's reader, kept here alone: the sync no longer parses it, and this command
  // exists to read it once more and delete it.
  const lines: { ticket: string; leg: string; reached: string; next?: string | null; claim?: string | null }[] = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const text = raw.trim();
    if (text === '') return;
    let m: unknown;
    try {
      m = JSON.parse(text);
    } catch {
      log(`baton: .baton/markers.jsonl:${i + 1} skipped — not JSON`);
      return;
    }
    const v = m as { ticket?: unknown; leg?: unknown; reached?: unknown };
    if (typeof v.ticket !== 'string' || typeof v.leg !== 'string' || typeof v.reached !== 'string') {
      log(`baton: .baton/markers.jsonl:${i + 1} skipped — no ticket, leg and reached`);
      return;
    }
    lines.push(m as typeof lines[number]);
  });
  const gitRun = (args: string[]): string => exec('git', args, root);
  const branch = gitRun(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === 'HEAD') {
    log('baton: this checkout is detached — nothing was written. Check out the branch the board syncs, then run the migration there.');
    return 1;
  }
  const settings: MarkdownSettings = { items: batonJson.items, default_course: batonJson.default_course, repos: batonJson.repos };
  const result = existsSync(join(root, '.baton', 'tickets.mjs'))
    ? await ((await import(`${pathToFileURL(join(root, '.baton', 'tickets.mjs')).href}?at=${gitText(root, 'rev-parse', 'HEAD')}`)) as { default: { tickets: (ctx: unknown) => Promise<TicketsResult> } }).default.tickets({ root, settings })
    : ticketsMarkdown(readItems(root, settings.items), settings);
  const closedIds = new Set(result.closed.map((c) => c.id));
  const byTicket = new Map<string, typeof lines>();
  for (const l of lines) byTicket.set(l.ticket, [...(byTicket.get(l.ticket) ?? []), l]);
  const changed: string[] = [];
  const dropped: string[] = [];
  for (const t of result.tickets) {
    const mine = byTicket.get(t.id);
    if (mine == null || t.path == null) continue; // a pathless ticket holds no marker state to fold
    byTicket.delete(t.id);
    const standard = builtIn(t.course_id);
    const interactive = t.course_id === 'create-spec'; // its marker legs' state is not in the forge (round 1, finding 4)
    if (closedIds.has(t.id) || (standard == null && !interactive) || (standard != null && standard.reads === 'prs' && !interactive)) {
      dropped.push(t.id);
      continue;
    }
    const path = join(root, t.path);
    if (!existsSync(path)) {
      dropped.push(t.id);
      log(`baton: ${t.id}'s lines dropped — its file ${t.path} is not in this checkout`);
      continue;
    }
    let text = readFileSync(path, 'utf8');
    for (const line of mine) {
      text = setMachineKeys(text, { station: line.reached, next_leg: line.next ?? null, claim: line.claim ?? null });
      writeFileSync(path, text);
      gitRun(['add', '--', t.path]);
      gitRun(['commit', '--no-gpg-sign', '-qm', `baton:close ${t.id} ${line.leg}`, '--', t.path]);
    }
    changed.push(t.id);
    log(`baton: ${t.id} → ${mine.length} close(s) replayed, station ${mine.at(-1)!.reached}`);
  }
  for (const id of byTicket.keys()) dropped.push(id);
  for (const id of dropped) log(`baton: ${id}'s lines dropped — ${closedIds.has(id) ? 'the ticket is closed' : 'not a live ticket on a course this fold covers'}`);
  rmSync(file);
  // Only what the migration touched (round 1, finding 10) — never `-A`.
  const changedPaths = changed.map((id) => result.tickets.find((t) => t.id === id)!.path!);
  gitRun(['add', '--', MARKERS_FILE_RETIRED, ...changedPaths]);
  gitRun(['commit', '--no-gpg-sign', '-qm', 'baton: markers.jsonl folded into the tickets (B-100)', '--', MARKERS_FILE_RETIRED, ...changedPaths]);
  try {
    gitRun(['push', 'origin', `HEAD:${branch}`]);
  } catch {
    log(`baton: the push was refused — the branch moved. The migration commits are local on ${branch}: pull --rebase, push, and the board's next sync reads the tickets.`);
    return 1;
  }
  log(`baton: ${changed.length} ticket(s) folded, ${dropped.length} dropped — .baton/markers.jsonl is gone`);
  return 0;
}

/** One sync (§7.1), its decisions the shared `syncOnce` (R-BTN-37: the code S-BTN-12 and
 * S-BTN-13 drive): the observation number first, then — with `--latest` — the current default
 * branch fetched and checked out, then the board read from the checkout, the head read and the
 * ancestry decided; a lost race takes a new number and reads again, once. */
/** `baton owner -i KEY verify-config REPO [--checkout DIR]` (B-127 item 1): the verifier for
 *  the agent-configuration half — the paths Baton cannot gate, because a harness loads them
 *  wherever they sit and a check kept in the repository is rewritten by the push it guards. The
 *  owner installs it outside the repository (a user-level SessionStart hook, or the environment's
 *  setup script; the runbook shows both), so it reads the repository's owner signing keys from
 *  Baton with the key `-i` names and refuses — exit 1, naming every path and commit — when the
 *  checkout's agent configuration was last changed in a commit no owner key signed. A privileged
 *  session that refuses to open is this command's exit code in the owner's settings; Baton's own
 *  part is the notice, which names the same paths for every reader of the board. */
export async function verifyConfigMain(argv: string[], io: { keys: { public_key: string; fingerprint: string }[]; repository?: string; log?: (l: string) => void }): Promise<number> {
  const log = io.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const positional: string[] = [];
  let checkout = '.';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--checkout') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--checkout needs a value');
      checkout = v;
    } else if (a.startsWith('--')) throw new Error(`${a}: not a flag of this command`);
    else positional.push(a);
  }
  // B-121: the repository may be the home in force's, passed by the CLI when the REPOSITORY
  // position was omitted — a named one (the positional) always wins over it.
  const repository = positional[0] ?? io.repository;
  if (repository == null) throw new Error('baton owner -i KEY verify-config REPOSITORY [--checkout DIR]');
  if (!io.keys.length) {
    log(`baton: ${repository} has no owner signing keys registered as human-only (BATON_HUMAN_KEYS or /v1/human-keys, then \`baton owner owners\`) — nothing can be owner-signed, and the check cannot pass (B-127)`);
    return 1;
  }
  const gitOf = (...a: string[]): string => gitRaw(checkout, ...a);
  const head = gitOf('rev-parse', 'HEAD').trim();
  const unsigned = unsignedAgentConfig(head, io.keys, gitOf, nodeKeygen);
  if (!unsigned.length) {
    log(`baton: ${checkout}'s agent configuration at ${head.slice(0, 10)} was last changed in owner-signed commits (B-127)`);
    return 0;
  }
  for (const u of unsigned) log(`baton: ${u.path} was last changed by unsigned commit ${u.commit.slice(0, 10)} (B-127)`);
  log(`baton: ${unsigned.length} agent-configuration ${unsigned.length === 1 ? 'path' : 'paths'} of ${checkout} last changed in commits no owner key signed — refusing to open a privileged session on it`);
  return 1;
}

export async function syncMain(args: SyncArgs): Promise<number> {
  const log = args.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const root = args.root;
  const batonJsonPath = join(root, '.baton', 'baton.json');
  if (!existsSync(batonJsonPath)) throw new Error(`${root} has no .baton/baton.json — run \`baton repo init\` first`);
  const url = args.url ?? (JSON.parse(readFileSync(batonJsonPath, 'utf8')) as BatonJson).baton_url ?? DEFAULT_URL;
  const auth = args.auth ?? (args.syncKey ? syncKeyAuth(args.syncKey) : bearerAuth(args.token ?? process.env.BATON_SYNC_TOKEN ?? (await actionsToken(url))));
  // R-BTN-197 (B-254): the sync is a client of the API in its own right (the rule lists a
  // person's command, a runner and a sync), so its calls say their version and its warning
  // names it a sync, never a runner.
  const api = new BatonApi({ url, transport: args.transport ?? ((req) => fetch(req)), auth, kind: 'sync' }, log);
  let board: Board | null = null;
  let record: BatonRecord | undefined;
  // R-BTN-10 (§4.3): the unconfirmed ends that named evidence, as the observation listed them, and
  // this run's answers for them — read after the number, posted with the board.
  let unconfirmed: UnconfirmedEnd[] = [];
  let observation = 1;
  let evidence: EvidenceAttestation[] = [];
  // B-89: `busy` is another run's reading, not this run's post, and R-BTN-62 lets no number this
  // run takes be used while that one is out. So the wait comes before the first `observe`, and
  // the retry is a whole second sync from a fresh number.
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // R-BTN-62 (Release): a run that will not post — it ends without posting, or throws after its
  // number, as a failing ticket source, forge read or course check does — gives its number back,
  // so the next run is not held `sync-busy` for ten minutes. A post uses the number, accepted or
  // refused, so only an unposted one is given back. Kept here, not in the vendored syncOnce.
  let held: number | null = null;
  const giveBack = async (): Promise<void> => {
    if (held == null) return;
    const n = held;
    held = null;
    await api.releaseObservation(n).catch(() => {}); // best effort: it lapses in ten minutes anyway
  };
  const once = async () => {
    try {
      const r = await syncOnceRun();
      await giveBack();
      return r;
    } catch (e) {
      await giveBack();
      throw e;
    }
  };
  const syncOnceRun = () => syncOnce(gitText(root, 'rev-parse', 'HEAD'), {
    // B-110: the observation also carries Baton's own record a station function judges git
    // against — the owner's answers to posted decisions and the legs claims finished with an
    // evidence pointer — read after the number like everything else this run posts. B-183: and
    // each live ticket's last accepted version (§4.3), for the ticket source's own code to
    // judge its store's read against.
    observe: async () => {
      const o = await asResult(async () => {
        const got = await api.observation();
        unconfirmed = Array.isArray(got.unconfirmed) ? (got.unconfirmed as UnconfirmedEnd[]) : [];
        record = {
          answers: Array.isArray(got.answers) ? got.answers : [],
          legs: Array.isArray(got.legs) ? got.legs : [],
          ...(got.versions && typeof got.versions === 'object' ? { versions: got.versions as Record<string, string> } : {}),
          // B-182 (R-BTN-140): the effective `code_repos` and `pushers` the observation hands
          // back — what the fact adapter reads each named repository by, and whose words count
          // there (R-BTN-139).
          ...(Array.isArray(got.code_repos) ? { code_repos: got.code_repos as BatonRecord['code_repos'] } : {}),
          ...(Array.isArray(got.pushers) ? { pushers: got.pushers as BatonRecord['pushers'] } : {}),
          // B-127: the repository's owner signing keys and whether it requires signed control —
          // Baton's own facts, never the repository's word.
          signing_keys: Array.isArray(got.signing_keys) ? got.signing_keys : [],
          require_signed_control: got.require_signed_control === true,
        };
        return got;
      });
      if (o.ok !== false && Number.isSafeInteger(o.observation)) held = observation = o.observation;
      return o;
    },
    // Everything posted under a number is read after it (§7.1 steps 1–2): the commit and the board.
    fetchNext: async () => {
      if (args.latest) {
        gitText(root, 'fetch', '-q', 'origin', args.latest);
        gitText(root, 'checkout', '-q', '--detach', 'FETCH_HEAD');
      }
      // baton.json too is read at the commit posted.
      // B-113: the qualified dependencies of other repositories resolve against their boards —
      // one read after the number, its doneness joining the `done` the station functions gate on.
      board = await readBoard(root, JSON.parse(readFileSync(batonJsonPath, 'utf8')) as BatonJson, args, log, record, async (ids) => {
        const answer = await api.dependencies([...ids]);
        return (Array.isArray(answer.dependencies) ? answer.dependencies : []).map((d) => ({ ticket: String(d.ticket), done: d.done === true }));
      });
      evidence = unconfirmed.length ? await attestEvidence(unconfirmed, evidencePorts(root, record?.code_repos ?? [], log)) : [];
      return gitText(root, 'rev-parse', 'HEAD');
    },
    readHead: () => asResult(() => api.head()),
    post: (body: Record<string, unknown>) => {
      held = null;
      return asResult(() => api.board(body));
    },
    isAncestor: async (a: string, b: string) => {
      try {
        git(root, ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' });
        return true;
      } catch {
        return false; // not an ancestor, or a commit this clone lacks: never "descends"
      }
    },
    buildPayload: async () => {
      const outputs = board!.outputEvidence.toSorted((a, b) => a.ticket.localeCompare(b.ticket) || a.ref!.localeCompare(b.ref!));
      const attestations = syncAttestationBatch(evidence, outputs, observation);
      return attestations.length ? { ...board!.payload, attestations } : board!.payload;
    },
    statusOf: (id: string) => board!.statusOf(id),
    sleep,
  });
  const retryS = args.busyRetryS ?? BUSY_RETRY_S;
  let { outcome, steps, next } = await once();
  // `busy` alone is still `busy` (a run with the retry turned off, whose log says one was never
  // tried); `busy:again` is the one retry holding too — both exit non-zero below. The wait is the
  // retry's alone: a run's own `unavailable` backoff inside `syncOnce` is unchanged.
  if (outcome === 'busy' && retryS > 0) {
    log(`baton: busy — another run's reading is in flight (R-BTN-62); retrying once in ${retryS}s, with a fresh number`);
    await sleep(retryS * 1000);
    const retried = await once();
    ({ steps, next } = retried);
    outcome = retried.outcome === 'busy' ? 'busy:again' : retried.outcome;
  }
  log(`baton: ${outcome} at ${String(next).slice(0, 10)} — ${steps.join('; ')}`);
  // B-89: a run that posted nothing says so in its exit code too — `busy` used to be exit 0 with
  // nothing posted, a green check for a held board. The workflow step reads the outcome line as
  // well: it is what the retry and the annotation are for.
  return outcome === 'advanced' || outcome === 'confirmed' || outcome === 'held' ? 0 : 1;
}

/** This workflow run's GitHub Actions OIDC token for Baton (R-BTN-15), audience Baton's origin
 * (R-BTN-56); null outside Actions. The workflow grants `id-token: write`. */
async function actionsToken(audience: string): Promise<string | null> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) return null;
  const res = await fetch(`${url}&audience=${encodeURIComponent(audience)}`, { headers: { Authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`the Actions OIDC token request answered ${res.status}`);
  return ((await res.json()) as { value: string }).value;
}

/** A bearer sync credential (the CI identity token, R-BTN-93's transition before the
 * repository's sync key signs). A missing token is an error, never a silent post; the laptop
 * with no CI reaches this one, so it names the flag that serves it. */
function bearerAuth(token: string | null): Auth {
  if (!token) {
    throw new Error(`no sync credential: run in the sync workflow (id-token: write), pass --sync-key FILE (or set ${SYNC_KEY_ENV}), pass --token, or set BATON_SYNC_TOKEN`);
  }
  return (_m, _u, _b, secret) => ({ Authorization: `Bearer ${token}`, ...(secret ? { 'X-Runner-Secret': secret } : {}) });
}

/** A sync key (B-88, R-BTN-93): the file's key signs the three sync calls, through the runner's
 * own helper (`envAuth`, imported and not copied), so a sync signs exactly as a runner does. The
 * file is an SSH key — a private key, or a `.pub` whose private half an `ssh-agent` holds; an API
 * key — a runner's credential, never a sync's — is refused by name here instead of being spent as
 * a bearer the server would deny. */
function syncKeyAuth(file: string): Auth {
  // R-BTN-159's API key (`src/client/sign.mjs`): a runner's credential, never a sync's — `envAuth` would
  // spend it as a bearer the sync routes deny, so it is refused by name.
  if (existsSync(file) && API_KEY.test(readFileSync(file, 'utf8').trim())) {
    throw new Error(`--sync-key ${file}: an API key is a runner's credential, not a sync key — register an SSH key (\`baton admin repo add --sync-key <key.pub>\`) and pass its private file`);
  }
  let auth: Auth;
  try {
    auth = envAuth({ BATON_KEY_FILE: file });
  } catch (e) {
    throw new Error(`--sync-key ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // The key's readability is answered now, before the first call signs with it: half a sync is
  // never posted under one credential and half under none.
  signingKey(file);
  return auth;
}

/** R-BTN-10: what the evidence check reads through — the home checkout's git, and the REST API
 *  of the GitHub hosts this repository is on (github.com, its home's host, its `code_repos`
 *  entries'), with the sync's `GITHUB_TOKEN`. Without a token only commits are looked at. */
function evidencePorts(root: string, codeRepos: readonly CodeRepoEntry[], log: (l: string) => void): Parameters<typeof attestEvidence>[1] {
  const token = process.env.GITHUB_TOKEN;
  const slug = remoteSlug(root);
  let originHost: string | null = null;
  try {
    const u = gitText(root, 'remote', 'get-url', 'origin');
    originHost = /^https:\/\//.test(u) ? new URL(u).host : (/^[^@]+@([^:]+):/.exec(u)?.[1] ?? null);
  } catch {
    originHost = null;
  }
  const hosts = new Set<string>(['github.com', ...codeRepos.filter((e) => e.forge === 'github').map((e) => e.host)]);
  const homeHost = originHost === 'github.com' || (originHost != null && hosts.has(originHost)) ? originHost : null;
  const hasObject = (sha: string) => {
    try {
      git(root, ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  return {
    hasCommit: (sha) => {
      if (hasObject(sha)) return true;
      try {
        git(root, ['fetch', '-q', 'origin', sha], { stdio: 'ignore', timeoutMs: FETCH_TIMEOUT_MS });
      } catch {
        return false;
      }
      return hasObject(sha);
    },
    home: token && slug && homeHost ? { host: homeHost, slug } : null,
    hosts: token ? hosts : new Set(),
    get: async (host, path) => {
      try {
        const res = await fetch(`${githubConn(host).rest}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'baton-sync' }, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        return res.status;
      } catch {
        return null;
      }
    },
    log,
  };
}

/** R-BTN-134, R-BTN-108 (B-52): a course's schemas, `schemas/<name>@<n>.json` in its course
 *  directory, each posted as `<course>:<name>@<n>` with the SHA-256 of its file — the digest
 *  that makes a version immutable. A repository's own course keeps them at
 *  `.baton/courses/<course>/schemas/`; a sourced course's sit in its source's directory, which
 *  B-43 wires to the reader. The sync's post and the course test kit read through this one
 *  function, so no two parts of Baton disagree on where a schema is. Absent directory, no
 *  schemas; nothing reads `.baton/schemas/<course>/`, the window the move closed. */
export function courseSchemas(root: string, course: string): { schemas?: { id: string; digest: string; schema: unknown }[] } {
  const dir = join(root, '.baton', 'courses', course, 'schemas');
  if (!existsSync(dir)) return {};
  const schemas = readdirSync(dir).filter((f) => /^[A-Za-z][A-Za-z0-9._-]{0,63}@(0|[1-9][0-9]{0,5})\.json$/.test(f)).sort().map((f) => {
    const bytes = readFileSync(join(dir, f));
    let schema: unknown;
    try { schema = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new Error(`.baton/courses/${course}/schemas/${f} is not JSON: ${(e as Error).message}`); }
    return { id: `${course}:${f.slice(0, -5)}`, digest: createHash('sha256').update(bytes).digest('hex'), schema };
  });
  return schemas.length ? { schemas } : {};
}
