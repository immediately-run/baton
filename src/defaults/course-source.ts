// course-source.ts — a course's qualified name (BATON_SPEC R-BTN-131, R-BTN-51; B-33): where its
// course file and station function come from, in immediately.run's URL grammar
// (`/<mode>/<provider>/<namespace>/<repository>/<ref>/<path>`) with the course id in the path
// slot — `github/immediately-run/baton/<commit>/create-pr`. The ref is a full commit, so a name
// means one graph forever. `.baton/baton.json`'s `courses[].source` carries it; the short `id`
// beside it stays the name tickets, core's rows and branch patterns use. Pure: parsing and
// printing only; what a source may name is the sync's check (cli.ts).
import { COURSE_ID } from '../core/course';

export interface CourseSource {
  provider: string;
  namespace: string;
  repository: string;
  /** A full 40-hex commit. */
  ref: string;
  course: string;
}

/** The providers a source may name. The grammar is general; another provider is refused by name. */
export const SOURCE_PROVIDERS = ['github'] as const;

/** An owner or repository name as GitHub allows it; `.` and `..` are never a name. */
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** `s` parsed, or an error naming what is wrong — never a guess. */
export function parseSource(s: string): CourseSource {
  const parts = s.split('/');
  if (parts.length !== 5) throw new Error(`${s}: a course source is <provider>/<namespace>/<repository>/<commit>/<course>`);
  const [provider, namespace, repository, ref, course] = parts;
  if (!(SOURCE_PROVIDERS as readonly string[]).includes(provider)) throw new Error(`${s}: provider ${provider || '(none)'} — a source names ${SOURCE_PROVIDERS.join(', ')}`);
  for (const [what, v] of [['namespace', namespace], ['repository', repository]] as const) {
    if (!NAME.test(v) || v === '.' || v === '..') throw new Error(`${s}: ${what} ${v || '(none)'} is not a repository name`);
  }
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error(`${s}: ${ref || '(none)'} is not a full commit — a source names all 40 hex characters`);
  if (!COURSE_ID.test(course)) throw new Error(`${s}: ${course || '(none)'} is not a course id`);
  return { provider, namespace, repository, ref, course };
}

export const printSource = (s: CourseSource): string => [s.provider, s.namespace, s.repository, s.ref, s.course].join('/');
