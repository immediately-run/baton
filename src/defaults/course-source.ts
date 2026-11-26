// course-source.ts — a course's qualified name (BATON_SPEC R-BTN-131, R-BTN-51; B-33): where its
// course file and station function come from, in immediately.run's URL grammar
// (`/<mode>/<provider>/<namespace>/<repository>/<ref>/<path>`) with the course id in the path
// slot — `github/immediately-run/baton/<ref>/create-pr`. The ref is a full commit or a branch.
// `.baton/baton.json`'s `courses[].source` carries it; the short `id`
// beside it stays the name tickets, core's rows and branch patterns use. Pure: parsing and
// printing only; what a source may name is the sync's check (cli.ts).
import { COURSE_ID } from '../core/course';
import { GIT_SHA, isSourceBranch } from '../core/validate';
import { unpinnedSourceWarning } from '../core/board';

export interface CourseSource {
  provider: string;
  namespace: string;
  repository: string;
  /** A full 40-hex commit or a branch name. */
  ref: string;
  pinned: boolean;
  course: string;
}

/** The providers a source may name. The grammar is general; another provider is refused by name. */
export const SOURCE_PROVIDERS = ['github'] as const;

/** An owner or repository name as GitHub allows it; `.` and `..` are never a name. */
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** `s` parsed, or an error naming what is wrong — never a guess. */
export function parseSource(s: string): CourseSource {
  const parts = s.split('/');
  if (parts.length < 5) throw new Error(`${s}: a course source is <provider>/<namespace>/<repository>/<ref>/<course>`);
  const [provider, namespace, repository] = parts;
  const course = parts[parts.length - 1];
  const ref = parts.slice(3, -1).join('/');
  if (!(SOURCE_PROVIDERS as readonly string[]).includes(provider)) throw new Error(`${s}: provider ${provider || '(none)'} — a source names ${SOURCE_PROVIDERS.join(', ')}`);
  for (const [what, v] of [['namespace', namespace], ['repository', repository]] as const) {
    if (!NAME.test(v) || v === '.' || v === '..') throw new Error(`${s}: ${what} ${v || '(none)'} is not a repository name`);
  }
  const pinned = GIT_SHA.test(ref);
  if (!pinned && !isSourceBranch(ref)) throw new Error(`${s}: ${ref || '(none)'} is not a full commit or a valid branch name`);
  if (!COURSE_ID.test(course)) throw new Error(`${s}: ${course || '(none)'} is not a course id`);
  return { provider, namespace, repository, ref, pinned, course };
}

/** The line every reader of a branch source prints (B-315, R-BTN-134; the owner, 2026-11-26):
 * it follows whatever the branch holds, with no trust check. `sha` is the commit read, if any. */
export const unpinnedWarning = (id: string, src: CourseSource, sha?: string): string =>
  `baton: warning: ${unpinnedSourceWarning(id, { branch: src.ref, sha, repository: `${src.namespace}/${src.repository}` })}`;

export const printSource = (s: Omit<CourseSource, 'pinned'>): string => [s.provider, s.namespace, s.repository, s.ref, s.course].join('/');
