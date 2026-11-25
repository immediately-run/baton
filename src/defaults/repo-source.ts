// The identity of this CLI, shared by scaffolding and the sourced-course checks.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_SHA } from '../core/validate';
import type { BuiltIn } from './courses';
import { remoteSlug } from './remote-slug';
import { gitText } from './git.mjs';

/** The baton package's root: the nearest directory above this module whose package.json is
 * `@immediately-run/baton`. Found by walking up, because this module runs both as source
 * (`src/defaults/`) and inside the bundle (`.local/`), where `import.meta.url` differs. */
export function packageRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === '@immediately-run/baton') return dir;
    if (dirname(dir) === dir) throw new Error(`no @immediately-run/baton package above ${from}`);
  }
}

/** Whether the defaults run from their source — a checkout, with `src/` and esbuild — or from
 * the npm package, where `build:cli` prebuilt into `dist/` everything init writes: the leg
 * stubs, the eject wrappers, the leg instructions, and the commit the package was built from
 * (`dist/build.json`), which stands in for the checkout's HEAD as the courses' source. */
export const fromSource = (): boolean => existsSync(join(packageRoot(), 'src', 'defaults', 'cli.ts'));
export const prebuilt = (...path: string[]): string => join(packageRoot(), 'dist', 'defaults', ...path);

/** One `courses` entry of `.baton/baton.json` (R-BTN-51). An older file's `{id, version}` takes
 * the defaults below. */
export interface CourseEntry {
  id: string;
  version: number;
  min_runner_version?: number;
  /** B-68's dual-read window: an older file spells the floor `min_worker_version` — this
   *  repository's own still does — read beside the new name until B-69 retires it. */
  min_worker_version?: number;
  skill?: string;
  step_kinds?: string[];
  branch_pattern?: string;
  previous_branch_pattern?: string;
  protocol_files?: string[];
  /** Where the course comes from (B-33): `github/<owner>/<name>/<commit>/<course>`. The sync holds
   * the repository's course file to the source's, and places its tickets with the source's
   * station function. */
  source?: string;
}

/** `.baton/baton.json`'s shape (R-BTN-51): the settings these commands read. */
export interface BatonJson {
  baton_url?: string;
  courses?: CourseEntry[];
  default_course?: string;
  items?: string;
  repos?: Record<string, string>;
  agent_command?: string;
  /** A command whose words precede `agent_command`'s in every leg's spawn (B-95);
   * `BATON_AGENT_WRAPPER` in the host's environment wins over it. */
  agent_wrapper?: string;
  /** The `dibber` release a leg runs (B-326, dibber.ts): a version, never a command. */
  dibber?: string;
  /** The ticket check's settings (B-111); every one is off. Read by `baton tickets check` alone,
   * never by a sync. */
  check?: { depends_line?: boolean };
  /** The ticket settings (B-112, tickets-config.ts): the prefix Baton's `ticket-<prefix>`
   * sequence allocates under (and `.dibber/config.json`'s `prefix`), the ids it still accepts,
   * and the "How tickets work" page's defaults. */
  ticket_prefix?: string;
  legacy_ids?: string[];
  prefixes?: Record<string, string>;
  project?: string;
  tags?: string[];
  projects?: string;
}

/** The skill a course entry names when its file names none: the course's own (`baton-create-pr`). */
export const defaultSkill = (course: string): string => `baton-${course}`;

/** The CLI's own version, for the workflow's pin: `owner/name@<commit>` of the checkout this
 * CLI runs from, or, in the npm package, of the commit `build:cli` built it from. Outside both,
 * `--pin` must name one. */
export function cliPin(): string {
  if (!fromSource()) {
    const file = join(packageRoot(), 'dist', 'build.json');
    if (!existsSync(file)) throw new Error('this CLI package names no commit it was built from (dist/build.json) — pass --pin owner/name@<commit>');
    const { repository, commit, dirty } = JSON.parse(readFileSync(file, 'utf8')) as { repository: string; commit: string; dirty?: boolean };
    if (dirty) throw new Error(`this CLI package was built from a modified tree at ${repository}@${commit.slice(0, 10)} — use a clean build of the pinned commit`);
    return `${repository}@${commit}`;
  }
  const root = packageRoot();
  const slug = remoteSlug(root);
  let sha: string | null = null;
  try {
    sha = gitText(root, 'rev-parse', 'HEAD');
  } catch {
    sha = null;
  }
  if (slug == null || sha == null) throw new Error('the CLI is not a git checkout with an origin, so it cannot pin itself — pass --pin owner/name@<commit>');
  return `${slug}@${sha}`;
}


/** A standard course's file as init writes it, and as the sync holds a sourced course to. */
export const courseFileText = (b: BuiltIn): string => `${JSON.stringify(b.course, null, 2)}\n`;

/** This CLI's repository and commit, or null outside a git checkout with a GitHub origin and
 * outside a package that names its build's commit. */
export function cliSelf(): { namespace: string; repository: string; sha: string } | null {
  try {
    return parsePin(cliPin());
  } catch {
    return null;
  }
}

/** Whether a source names this CLI's repository: GitHub's owner and repository names ignore case. */
export const sameRepo = (src: { namespace: string; repository: string }, self: { namespace: string; repository: string }): boolean =>
  `${src.namespace}/${src.repository}`.toLowerCase() === `${self.namespace}/${self.repository}`.toLowerCase();

/** A pin, `owner/name@<commit>` — the workflow's and a source's parts — or null when it is not one. */
export function parsePin(at: string): { namespace: string; repository: string; sha: string } | null {
  const m = /^([\w.-]+)\/([\w.-]+)@(.*)$/.exec(at);
  return m && GIT_SHA.test(m[3]) ? { namespace: m[1], repository: m[2], sha: m[3] } : null;
}

/** The CLI's own package version, for the board post's `source.cli` (§4.4, B-183): what the
 *  repository's pinned CLI is, beside the ticket source's declaration. */
export function cliVersion(): string {
  return (JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version?: string }).version ?? '';
}
