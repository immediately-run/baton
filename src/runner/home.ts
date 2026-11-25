// home.ts — the home repository's git as the runner reads it (BATON_SPEC §6.13 trust, R-BTN-34):
// the course file and the leg scripts come from the claim's `snapshot_sha`, never the working
// tree (which may sit on a feature branch or carry a peer's edits). One bounded fetch when the
// sha is missing; then `git show` reads blobs straight from the object store. Leg scripts are
// extracted per claim into a scratch directory, so a course change between two claims needs no
// restart and the fresh `import()` the wrapper does is of the snapshot's bytes.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { graphOf, legCapabilities, type Graph } from '../core/graph';
import { git, gitAsync } from '../defaults/git.mjs';

export interface CourseLoad {
  course: string;
  graph: Graph;
  /** The extracted `legs/<leg>.mjs` of the snapshot, by leg name — file paths on disk. */
  scripts: Map<string, string>;
  scratch: string;
}

/** The course id the home repository runs, from the snapshot's `.baton/baton.json`: the spec's
 * `courses: [{id, …}]` (§2c/R-BTN-51) when it lists one; docs' interim `{course}` key; else —
 * no baton.json at all yet — the one course under `.baton/courses/`. `want` is the course the
 * runner serves (R-BTN-131) — since B-103, the claim answer's `course_id`, which the snapshot
 * must still carry; with no `want`, several courses are refused loudly, never guessed at. */
export function courseOf(home: string, sha: string, want?: string): string {
  const at = sha.slice(0, 10);
  const pick = (ids: string[], where: string): string => {
    if (want != null) {
      if (!ids.includes(want)) throw new Error(`${where} at ${at} carries no course ${want}: ${ids.join(', ') || '(none)'}`);
      return want;
    }
    if (ids.length !== 1) throw new Error(`${where} at ${at} names ${ids.length} courses: ${ids.join(', ') || '(none)'} — the runner takes exactly one`);
    return ids[0];
  };
  const batonJson = readAt(home, sha, '.baton/baton.json');
  if (batonJson != null) {
    const parsed = JSON.parse(batonJson) as { courses?: { id?: unknown }[]; course?: unknown };
    if (Array.isArray(parsed.courses) && parsed.courses.length) {
      const ids = parsed.courses.map((c) => c.id).filter((id): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(id));
      if (ids.length !== parsed.courses.length) throw new Error(`.baton/baton.json at ${at} names a course that is not an id: ${JSON.stringify(parsed.courses.map((c) => c.id))}`);
      return pick(ids, '.baton/baton.json');
    }
    if (typeof parsed.course === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(parsed.course)) return pick([parsed.course], '.baton/baton.json');
    throw new Error(`.baton/baton.json at ${at} names no course`);
  }
  // The same test the startup declaration uses: a course is a directory carrying course.json
  // (a README beside them is not a course). `-d` lists trees only — `--name-only` prints their
  // names bare, with no trailing slash to filter on.
  const names = git(home, ['ls-tree', '-d', '--name-only', `${sha}:.baton/courses/`]).split('\n').filter(Boolean);
  return pick(names.filter((n) => readAt(home, sha, `.baton/courses/${n}/course.json`) != null), '.baton/courses/');
}

/** A file's bytes at `sha`, or null when the snapshot does not have it. */
function readAt(home: string, sha: string, path: string): string | null {
  try {
    return git(home, ['show', `${sha}:${path}`]);
  } catch {
    return null;
  }
}

/** R-BTN-34: make sure the home checkout has `sha` — one fetch, then the caller releases
 * `stale-board` if it is still missing. The probes are `rev-parse --verify --quiet`, never
 * `cat-file -e`: a miss here is the designed path (2026-11-05, run-20261105-142428: a fresh
 * claim's snapshot lived on origin/main the checkout had not fetched), and `git()` leaves the
 * child's stderr on the parent's — a miss must not print a raw `fatal:` into the log an
 * operator tails as a crash. */
export function ensureSha(home: string, sha: string, fetch: () => void): boolean {
  try {
    git(home, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    return true;
  } catch {
    fetch();
    try {
      git(home, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }
}

/** B-228 (R-BTN-34: the tree is prepared at the claim's sha): bring the home checkout to the
 *  claim's snapshot before a leg runs, so the leg — and an executor that copies the checkout —
 *  starts from the code the claim was decided on, never from wherever the home last stood. Only
 *  a fast-forward, and only on `defaultBranch` with no tracked change: a home that is ahead of the
 *  snapshot, diverged, on another branch or edited is left exactly as it is, and the reason is
 *  returned for the log. Null: the home is at the snapshot now. */
export function advanceHome(home: string, sha: string, defaultBranch: string | null): string | null {
  const head = git(home, ['rev-parse', 'HEAD']).trim();
  const target = git(home, ['rev-parse', `${sha}^{commit}`]).trim();
  const branch = (() => { try { return git(home, ['symbolic-ref', '-q', 'HEAD']).trim().replace(/^refs\/heads\//, ''); } catch { return ''; } })();
  if (branch !== defaultBranch && (defaultBranch !== null || head !== target)) return `the home is on ${branch || 'a detached HEAD'}, not ${defaultBranch ?? 'the default branch'}`;
  if (git(home, ['status', '--porcelain', '--untracked-files=no']).trim() !== '') return 'the home has tracked changes';
  if (head === target) return null;
  try {
    git(home, ['merge-base', '--is-ancestor', head, target]);
  } catch {
    return `the home's ${head.slice(0, 10)} is not behind the snapshot`;
  }
  git(home, ['merge', '--ff-only', '-q', target]);
  return null;
}

/** B-188: the bound on a clone's own git (the first `clone` of a large home, a fetch of it) — run
 *  asynchronously, so the event loop, and with it the beat, never waits on it. */
export const CLONE_TIMEOUT_MS = 10 * 60_000;

/** R-BTN-72, R-BTN-4 (B-188): a claim's own checkout when the runner holds several — a separate
 *  `git clone` of the home with its own git directory (never a worktree sharing refs), kept at
 *  `dir` and reused by the next claim there. Its `origin` is the home's (so its pushes go where
 *  the home's would, and the scope audit reads its own remote-tracking reflog); the home's
 *  objects arrive under `refs/baton/home/`, outside `refs/remotes/`, which the audit reads. The
 *  tree is then put at the claim's snapshot on `branch` (the default branch, as B-228 puts the
 *  home), forced and cleaned of untracked files: the clone is the runner's, and what an earlier
 *  claim left in it was that claim's to push. */
export async function prepareClone(home: string, dir: string, sha: string, branch: string | null): Promise<void> {
  if (!existsSync(join(dir, '.git'))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    await gitAsync(null, ['clone', '-q', '--no-checkout', home, dir], CLONE_TIMEOUT_MS);
  }
  let origin = '';
  try {
    origin = (await gitAsync(home, ['remote', 'get-url', 'origin'], CLONE_TIMEOUT_MS)).trim();
  } catch {
    origin = ''; // a home with no origin: the clone's origin stays the home
  }
  await gitAsync(dir, ['remote', 'set-url', 'origin', origin || home], CLONE_TIMEOUT_MS);
  await gitAsync(dir, ['fetch', '-q', '--no-tags', home, '+refs/heads/*:refs/baton/home/heads/*', '+refs/remotes/*:refs/baton/home/remotes/*'], CLONE_TIMEOUT_MS);
  try {
    await gitAsync(dir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], CLONE_TIMEOUT_MS);
  } catch {
    // The snapshot is in the home's objects but on no ref there (a fetched FETCH_HEAD): by id.
    await gitAsync(dir, ['fetch', '-q', '--no-tags', home, sha], CLONE_TIMEOUT_MS);
  }
  await gitAsync(dir, ['checkout', '-q', '-f', '-B', branch ?? 'baton-claim', sha], CLONE_TIMEOUT_MS);
  await gitAsync(dir, ['clean', '-fdq'], CLONE_TIMEOUT_MS);
}

/** Load a claim's course from the snapshot: the graph, and every leg script the snapshot's
 * `legs/` holds, extracted to a scratch directory (deleted by the runner when the claim ends). */
export function loadCourse(home: string, sha: string, course: string): CourseLoad {
  const file = readAt(home, sha, `.baton/courses/${course}/course.json`);
  if (file == null) throw new Error(`the snapshot ${sha.slice(0, 10)} has no .baton/courses/${course}/course.json`);
  const graph = graphOf(JSON.parse(file));
  const scratch = mkdtempSync(join(tmpdir(), 'baton-legs-'));
  const scripts = new Map<string, string>();
  let listing: string[];
  try {
    // ls-tree of a subtree lists names relative to it.
    listing = git(home, ['ls-tree', '-r', '--name-only', `${sha}:.baton/courses/${course}/legs/`]).split('\n').filter(Boolean);
  } catch {
    listing = [];
  }
  for (const name of listing) {
    // A leg's script only: `<leg>.run.mjs` is a repository's override, which the script loads itself.
    if (!name.endsWith('.mjs') || name.endsWith('.run.mjs')) continue;
    const leg = name.split('/').pop()!.slice(0, -4);
    const bytes = readAt(home, sha, `.baton/courses/${course}/legs/${name}`);
    if (bytes == null) continue;
    const to = join(scratch, `${leg}.mjs`);
    writeFileSync(to, bytes, { mode: 0o600 });
    scripts.set(leg, to);
  }
  return { course, graph, scripts, scratch };
}

/** B-183 (§4.5, R-BTN-74): the repository's ticket source at the claim's snapshot — its
 *  `.baton/tickets.mjs` extracted into the claim's scratch like a leg script — or null when the
 *  snapshot has none (the CLI's markdown default serves then). Returns the file's path: the
 *  runner never imports it, it runs it through its executor (R-BTN-107, B-184). */
export function extractTicketSource(home: string, sha: string, scratch: string): string | null {
  const bytes = readAt(home, sha, '.baton/tickets.mjs');
  if (bytes == null) return null;
  const to = join(scratch, 'baton-tickets-source.mjs');
  writeFileSync(to, bytes, { mode: 0o600 });
  return to;
}

/** B-86: the home checkout's head — the snapshot the next claim is most likely to be at, whose
 *  course lists the legs' needs. Empty when the checkout cannot answer. */
export function readHead(home: string): string {
  try {
    return git(home, ['rev-parse', 'HEAD']).trim();
  } catch {
    return '';
  }
}

/** B-86: the capabilities every leg of `course` in the snapshot requires — rule 4's names, each
 *  course leg's `requires.capabilities` read as `graphOf` reads it: `legCapabilities` replaces the
 *  course's `capability_roles` names with their capabilities and a vocabulary role (`agent-venue`)
 *  with the capabilities it carries, so a leg naming a role asks for what the role carries — never
 *  for a literal capability of the role's name (review round 5, finding 3). `human-operator` is the
 *  one name that stands literal (review round 6, finding 0): rule 4 compares it as a string, so a
 *  leg needing it is this runner's never-eligible reason unless it declares it by that name — and
 *  the line's held set adds the literal exactly when the declaration carries it (review round 7,
 *  finding 1). One file that will not parse, or one the file does not describe, adds nothing: this
 *  is only the never-eligible runner's why, never a gate. An empty `sha` reads the working tree. */
export function legNeeds(home: string, sha: string, course: string): string[] {
  const path = `.baton/courses/${course}/course.json`;
  const file = sha ? readAt(home, sha, path) : (() => {
    try {
      return readFileSync(join(home, path), 'utf8');
    } catch {
      return null;
    }
  })();
  if (file == null) return [];
  let parsed: { capability_roles?: unknown; legs?: Record<string, { requires?: { capabilities?: unknown } }> };
  try {
    parsed = JSON.parse(file) as typeof parsed;
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const leg of Object.values(parsed.legs ?? {})) out.push(...legCapabilities(leg?.requires, parsed.capability_roles));
  return out;
}

/** Drop a claim's scratch directory. */
export function dropCourse(scratch: string): void {
  rmSync(scratch, { recursive: true, force: true });
}

/** The scratch directory the runner itself uses for a claim's ctx and result files. */
export function claimScratch(): string {
  return mkdtempSync(join(tmpdir(), 'baton-claim-'));
}

/** A stable secret for the runner's own runner: fresh per state file, kept across restarts —
 * R-BTN-14's random 256-bit value. */
export function freshSecret(): string {
  return randomBytes(32).toString('hex');
}

/** Whether a process is alive: signal 0 checks without sending; EPERM means it is, under another user. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** One runner per home checkout (R-BTN-131): every leg runs in its working tree, so a second
 * runner there would switch branches and push under the first. The holder's pid goes in
 * `baton-runner.lock` in the checkout's git dir — never the tree. A lock whose pid is dead is
 * stale and taken over. Returns the release, which removes the lock only while it is still this
 * process's. */
export function holdHome(home: string, pid: number = process.pid): () => void {
  const file = join(git(home, ['rev-parse', '--absolute-git-dir']).trim(), 'baton-runner.lock');
  try {
    writeFileSync(file, `${pid}\n`, { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const holder = Number(readFileSync(file, 'utf8').trim());
    if (Number.isInteger(holder) && holder > 0 && holder !== pid && alive(holder)) {
      throw new Error(`${home} is held by another runner (pid ${holder}): each runner needs its own clone — pass --home <another clone>; if no runner is running there, remove ${file}`);
    }
    writeFileSync(file, `${pid}\n`);
  }
  return () => {
    try {
      if (readFileSync(file, 'utf8').trim() === String(pid)) rmSync(file);
    } catch {
      // Already gone.
    }
  };
}
