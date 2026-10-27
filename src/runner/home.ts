// home.ts — the home repository's git as the runner reads it (BATON_SPEC §6.13 trust, R-BTN-34):
// the course file and the leg scripts come from the claim's `snapshot_sha`, never the working
// tree (which may sit on a feature branch or carry a peer's edits). One bounded fetch when the
// sha is missing; then `git show` reads blobs straight from the object store. Leg scripts are
// extracted per claim into a scratch directory, so a course change between two claims needs no
// restart and the fresh `import()` the wrapper does is of the snapshot's bytes.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphOf, legCapabilities, type Graph } from '../core/graph';

/** B-94: the bound on every git the runner itself runs. The heartbeat path reads the snapshot
 * here (`ensureSha`, `courseOf`, `loadCourse`), and a state file lock, a hook or a stalled
 * filesystem must never hold the event loop past a beat — a runner that stops beating while its
 * process lives is a claim lost silently. */
export const GIT_TIMEOUT_MS = 30_000;

// B-94: git's non-interactive environment is defined once, beside the close's bound — the
// runner's git and the generated stubs import it from there.
import { GIT_NONINTERACTIVE_ENV } from '../defaults/course-markers';

/** One git command in the home checkout; throws with stderr when it fails, and is killed at
 * `timeoutMs` (default `GIT_TIMEOUT_MS`, under a beat) when it cannot answer (B-94). */
export function git(home: string, args: string[], timeoutMs: number = GIT_TIMEOUT_MS): string {
  return execFileSync('git', ['-C', home, ...args], {
    encoding: 'utf8', maxBuffer: 16 << 20, timeout: timeoutMs, killSignal: 'SIGKILL',
    env: { ...process.env, ...GIT_NONINTERACTIVE_ENV },
  });
}

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
 * `stale-board` if it is still missing. */
export function ensureSha(home: string, sha: string, fetch: () => void): boolean {
  try {
    git(home, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    fetch();
    try {
      git(home, ['cat-file', '-e', `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }
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

/** A stable secret for the runner's own worker: fresh per state file, kept across restarts —
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
