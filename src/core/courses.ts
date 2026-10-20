// courses.ts — the course registry each repository's sync posts with its board (BATON_SPEC §2a
// R-BTN-48, §2e R-BTN-69, §7.1, R-BTN-22, R-BTN-65). Baton keeps one row per (repository,
// course): its version, the version a worker must declare (rule 9), its skill and its course
// file. A posted file that fails `validateCourse` keeps the previous one in force and is listed
// under Needs you; with no previous one there is nothing to keep, so the post is refused.
import { validateCourse, type CourseViolation } from './course';
import { graphOf, resolveLeg } from './graph';
import { BatonError } from './http';
import { FREE_TEXT_MAX } from './text';
import type { Store } from './ports';
import { COURSE_ID, COURSE_VERSION_MAX, COURSES_MAX } from './validate';
import { checkSchema, checkSchemaSet, parseSchemaId, POST_STATES_MAX, SCHEMA_MAX_BYTES, type Schema } from '../shared/schema.mjs';
import { stdSchema } from '../shared/std.mjs';

export { COURSE_ID };

/** A skill's name (`next-ticket`), as a directory under `.claude/skills/`. */
const SKILL = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A branch pattern (R-BTN-51): `{ticket}` and `{repository}` placeholders and `*`. */
const BRANCH_PATTERN = /^[A-Za-z0-9._/{}*-]{1,200}$/;
/** The size of one course file (spec-silent, recorded on R3-1231): a whole registry of them
 *  stays well inside either host's 8 MiB body. docs' roadmap-pr is under 1 KiB. */
export const COURSE_FILE_MAX_BYTES = 64 * 1024;
export const REGISTRY_MAX = COURSES_MAX;
/** Step kinds per course. */
const STEP_KINDS_MAX = 64;
/** R-BTN-108: the schemas one course posts, and the bytes a whole registry's schemas may hold
 *  (spec-silent, recorded on B-3): with 64 course files at 64 KiB, the body stays inside either
 *  host's 8 MiB. */
const SCHEMAS_PER_COURSE = 32;
const REGISTRY_SCHEMA_BYTES_MAX = 2 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;

/** A schema as the sync posts it with its course (R-BTN-108): `<course>:<name>@<n>`, the
 *  SHA-256 of its file, and the schema. Its content is judged when the post is applied. */
export interface PostedSchema {
  id: string;
  digest: string;
  schema: unknown;
  /** Over SCHEMA_MAX_BYTES: refused with its course, never stored or walked. */
  oversized: boolean;
}

/** Violations kept per refused file: the dashboard shows the first, the owner fixes the file. */
export const REFUSAL_VIOLATIONS_MAX = 20;

/** A violation as stored and shown (§10.4): its path and message repeat the file's own keys, so
 *  each is cut to free-text length with every control, bidi, `<`, `>`, `{` and `}` replaced. */
function safeText(v: string): string {
  return [...v].slice(0, FREE_TEXT_MAX).map((ch) => (/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069<>{}]/.test(ch) ? '?' : ch)).join('');
}
export const storedViolations = (vs: CourseViolation[]) =>
  vs.slice(0, REFUSAL_VIOLATIONS_MAX).map((v) => ({ rule: v.rule, path: safeText(v.path), message: safeText(v.message) }));

export interface RegistryEntry {
  id: string;
  /** Over COURSE_FILE_MAX_BYTES: refused as a course, its file set aside unread. */
  oversized: boolean;
  version: number;
  min_worker_version: number;
  skill: string;
  course: unknown;
  step_kinds: string[];
  report_horizon_h: number;
  branch_pattern: string;
  previous_branch_pattern: string | null;
  /** R-BTN-108: the course's schemas, posted with its file at every sync. */
  schemas: PostedSchema[];
}

const bad = (field: string, why: string): never => {
  throw new BatonError('invalid-params', `${field}: ${why}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Stars per branch pattern (spec-silent, recorded on R3-1231): a pattern is a name, not a glob. */
const PATTERN_STARS_MAX = 4;

function pattern(v: unknown, field: string): string {
  if (typeof v !== 'string' || !BRANCH_PATTERN.test(v) || !v.includes('{ticket}')) bad(field, 'must be a branch pattern containing {ticket}');
  if ((v as string).split('*').length - 1 > PATTERN_STARS_MAX) bad(field, `must have at most ${PATTERN_STARS_MAX} *`);
  return v as string;
}

/** The registry's shape, checked before anything is written (§10.4). The course files
 *  themselves are judged by `validateCourse` when the post is applied: a file that fails it is a
 *  refusal of that course, not of the shape. */
export function checkRegistry(v: unknown): RegistryEntry[] {
  if (!Array.isArray(v) || v.length > REGISTRY_MAX) bad('registry', `must be a list of at most ${REGISTRY_MAX} courses`);
  const seen = new Set<string>();
  let schemaBytes = 0;
  return (v as unknown[]).map((e, i) => {
    const at = `registry[${i}]`;
    if (!isObj(e)) bad(at, 'must be an object');
    const r = e as Record<string, unknown>;
    if (typeof r.id !== 'string' || !COURSE_ID.test(r.id)) bad(`${at}.id`, 'must be a course id');
    const id = r.id as string;
    if (seen.has(id)) bad(`${at}.id`, `repeats ${id}`);
    seen.add(id);
    if (!int(r.version, 0, COURSE_VERSION_MAX)) bad(`${at}.version`, 'must be a non-negative integer');
    // R-BTN-65: a worker is never asked for a version the course has not reached.
    if (!int(r.min_worker_version, 0, r.version as number)) bad(`${at}.min_worker_version`, 'must be an integer from 0 to version');
    if (typeof r.skill !== 'string' || !SKILL.test(r.skill)) bad(`${at}.skill`, 'must be a skill name');
    if (!Array.isArray(r.step_kinds) || r.step_kinds.length > STEP_KINDS_MAX || !r.step_kinds.every((k) => typeof k === 'string' && COURSE_ID.test(k))
      || new Set(r.step_kinds).size !== r.step_kinds.length) {
      bad(`${at}.step_kinds`, `must be at most ${STEP_KINDS_MAX} distinct step kinds`);
    }
    if (r.report_horizon_h !== undefined && !int(r.report_horizon_h, 1, 168)) bad(`${at}.report_horizon_h`, 'must be an integer from 1 to 168');
    // An oversized file is a refusal of that course, as any file failing R-BTN-69 is: the previous
    // one stays in force and the board still advances. It is never stored or walked.
    let size = Infinity;
    try {
      size = new TextEncoder().encode(JSON.stringify(r.course ?? null)).length;
    } catch {
      // A value JSON cannot hold is no course file.
    }
    // R-BTN-108: the schemas' shape here; their content, prefix and immutability at apply, so a
    // bad schema refuses its course and not the board.
    const schemas: PostedSchema[] = [];
    if (r.schemas !== undefined) {
      if (!Array.isArray(r.schemas) || r.schemas.length > SCHEMAS_PER_COURSE) bad(`${at}.schemas`, `must be a list of at most ${SCHEMAS_PER_COURSE} schemas`);
      const ids = new Set<string>();
      for (const [j, x] of (r.schemas as unknown[]).entries()) {
        const sp = `${at}.schemas[${j}]`;
        if (!isObj(x)) bad(sp, 'must be {id, digest, schema}');
        const o = x as Record<string, unknown>;
        if (!parseSchemaId(o.id)) bad(`${sp}.id`, 'must be a schema id, <id>@<version>');
        if (ids.has(o.id as string)) bad(`${sp}.id`, `repeats ${o.id}`);
        ids.add(o.id as string);
        if (typeof o.digest !== 'string' || !DIGEST.test(o.digest)) bad(`${sp}.digest`, 'must be a SHA-256 in hex');
        let n = Infinity;
        try { n = new TextEncoder().encode(JSON.stringify(o.schema ?? null)).length; } catch { /* no JSON */ }
        schemaBytes += Math.min(n, SCHEMA_MAX_BYTES + 1);
        if (schemaBytes > REGISTRY_SCHEMA_BYTES_MAX) bad('registry', `its schemas must total at most ${REGISTRY_SCHEMA_BYTES_MAX} bytes`);
        schemas.push({ id: o.id as string, digest: o.digest as string, schema: n > SCHEMA_MAX_BYTES ? null : o.schema, oversized: n > SCHEMA_MAX_BYTES });
      }
    }
    return {
      schemas,
      oversized: size > COURSE_FILE_MAX_BYTES,
      id,
      version: r.version as number,
      min_worker_version: r.min_worker_version as number,
      skill: r.skill as string,
      course: r.course,
      step_kinds: r.step_kinds as string[],
      report_horizon_h: (r.report_horizon_h as number | undefined) ?? 6,
      branch_pattern: pattern(r.branch_pattern, `${at}.branch_pattern`),
      previous_branch_pattern: r.previous_branch_pattern == null ? null : pattern(r.previous_branch_pattern, `${at}.previous_branch_pattern`),
    };
  });
}

export interface CourseRow {
  repository_id: string;
  id: string;
  version: number;
  min_worker_version: number;
  skill: string;
}

export class Courses {
  constructor(private readonly c: { store: Store; requiredBars?: (repo: string) => { course: string; leg: string }[] }) {}

  private rows<T>(q: string, ...p: unknown[]): T[] {
    return this.c.store.exec<T>(q, ...p).toArray();
  }

  /** Apply a posted registry inside the board's transaction. It is the repository's whole
   *  registry (its `.baton/baton.json`), so a course it no longer lists leaves, with any refusal
   *  of it; the caller then refuses the post if a ticket still names one. Each course whose file
   *  passes is written whole and its refusal cleared; each whose file fails keeps the row it had
   *  and is recorded under Needs you. A failing course with no row in force refuses the post:
   *  its tickets would have no course. Returns the refused course ids. */
  apply(repo: string, registry: RegistryEntry[], sha: string, now: number): string[] {
    const listed = JSON.stringify(registry.map((e) => e.id));
    this.c.store.exec('DELETE FROM courses WHERE repository_id = ? AND id NOT IN (SELECT value FROM json_each(?))', repo, listed);
    this.c.store.exec('DELETE FROM course_refusals WHERE repository_id = ? AND course_id NOT IN (SELECT value FROM json_each(?))', repo, listed);
    const refused: string[] = [];
    // Each course's own faults first: its file, the owners' required bars, its schemas' prefix,
    // size and immutability.
    const faults = new Map<string, CourseViolation[]>();
    // One compile budget for the whole post's patterns (2-r2-1).
    const meter = { steps: POST_STATES_MAX };
    for (const e of registry) {
      const violations: CourseViolation[] = e.oversized
        ? [{ rule: 'bound', path: '', message: `the course file is over ${COURSE_FILE_MAX_BYTES} bytes` }]
        : validateCourse(e.course);
      if (!violations.length) violations.push(...this.ownSchemaViolations(repo, e, meter));
      // R-BTN-67: a file that no longer has a leg an owner's required bar names — by its name or a
      // `renamed_from` — is held until an owner updates or drops the bar.
      if (!violations.length) {
        const g = graphOf(e.course);
        for (const bar of this.c.requiredBars?.(repo) ?? []) {
          if (bar.course === e.id && bar.leg !== '*' && !resolveLeg(g, bar.leg)) {
            violations.push({ rule: 'required-bar', path: `legs.${bar.leg}`, message: `an owner's required bar names the leg ${bar.leg}, which this file no longer has` });
          }
        }
      }
      faults.set(e.id, violations);
    }
    // Then references (R-BTN-108): a `$ref` or base resolves among the repository's schemas —
    // those held and those this very post carries for a course it is accepting — so one
    // course's schemas may name another's posted beside them, in any registry order (1-A-3). A
    // course refused for any reason takes its schemas out of the pool, which may refuse a course
    // naming them, until nothing changes: nothing accepted names a schema that is not stored.
    for (let changed = true; changed; ) {
      changed = false;
      const pool = new Map<string, unknown>();
      for (const e of registry) if (!faults.get(e.id)!.length) for (const x of e.schemas) pool.set(x.id, x.schema);
      const resolve = (id: string) => (pool.has(id) ? (pool.get(id) as Schema) : this.schema(repo, id));
      for (const e of registry) {
        if (faults.get(e.id)!.length) continue;
        const v = this.refViolations(e, resolve);
        if (v.length) { faults.set(e.id, v); changed = true; }
      }
    }
    for (const e of registry) {
      const violations = faults.get(e.id)!;
      if (violations.length) {
        if (!this.get(repo, e.id)) {
          throw new BatonError('invalid-params', `registry: ${e.id}'s course file fails R-BTN-69 and no earlier one is in force — ${storedViolations(violations).slice(0, 3).map((v) => `${v.path || '(file)'}: ${v.message}`).join('; ')}`);
        }
        this.c.store.exec(
          `INSERT INTO course_refusals (repository_id, course_id, version, snapshot_sha, refused_at, violations) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (repository_id, course_id) DO UPDATE SET version = excluded.version, snapshot_sha = excluded.snapshot_sha,
             refused_at = excluded.refused_at, violations = excluded.violations`,
          repo, e.id, e.version, sha, now, JSON.stringify(storedViolations(violations)));
        refused.push(e.id);
        continue;
      }
      this.c.store.exec(
        `INSERT INTO courses (repository_id, id, version, skill, course_json, step_kinds, min_worker_version, report_horizon_h, branch_pattern, previous_branch_pattern)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (repository_id, id) DO UPDATE SET version = excluded.version, skill = excluded.skill, course_json = excluded.course_json,
           step_kinds = excluded.step_kinds, min_worker_version = excluded.min_worker_version, report_horizon_h = excluded.report_horizon_h,
           branch_pattern = excluded.branch_pattern, previous_branch_pattern = excluded.previous_branch_pattern`,
        repo, e.id, e.version, e.skill, JSON.stringify(e.course), JSON.stringify(e.step_kinds), e.min_worker_version, e.report_horizon_h,
        e.branch_pattern, e.previous_branch_pattern);
      this.c.store.exec('DELETE FROM course_refusals WHERE repository_id = ? AND course_id = ?', repo, e.id);
      // Immutable: a schema already held has the same digest (schemaViolations), so it is kept.
      for (const x of e.schemas) {
        this.c.store.exec(`INSERT OR IGNORE INTO course_schemas (repository_id, id, course_id, digest, schema_json, posted_at, snapshot_sha) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          repo, x.id, e.id, x.digest, JSON.stringify(x.schema), now, sha);
      }
    }
    return refused;
  }

  /**
   * R-BTN-108's rules for one course's own schemas, as course-file violations (rule `schema`):
   * each named `<course>:` for this course, never `std:`; within its size; the same digest as
   * any version Baton holds.
   */
  private ownSchemaViolations(repo: string, e: RegistryEntry, meter: { steps: number }): CourseViolation[] {
    const out: CourseViolation[] = [];
    const v = (path: string, message: string) => out.push({ rule: 'schema', path, message });
    for (const x of e.schemas) {
      const p = parseSchemaId(x.id)!;
      if (p.prefix === 'std') { v(`schemas.${x.id}`, `${x.id}: std: schemas come only from Baton's library`); continue; }
      if (p.prefix !== e.id) { v(`schemas.${x.id}`, `${x.id}: a course posts only its own schemas, ${e.id}:<name>@<n>`); continue; }
      if (x.oversized) { v(`schemas.${x.id}`, `${x.id}: a schema is at most ${SCHEMA_MAX_BYTES} bytes`); continue; }
      const held = this.rows<{ digest: string }>('SELECT digest FROM course_schemas WHERE repository_id = ? AND id = ?', repo, x.id)[0];
      if (held && held.digest !== x.digest) { v(`schemas.${x.id}`, `${x.id}: a schema version is immutable; this digest differs from the one held — post a new version`); continue; }
      // The subset, once per post: the reference fixpoint below never re-checks it (2-r2-1).
      for (const f of checkSchema(x.schema, meter)) v(`schemas.${x.id}${f.path ? `.${f.path}` : ''}`, `${x.id}: ${f.message}`);
    }
    return out;
  }

  /**
   * The rest of R-BTN-108 for a course whose own schemas passed: each inside the subset; every
   * `$ref` and `x-baton-base` resolving through `resolve` (the repository's held schemas, the
   * schemas this post carries for courses it accepts, and the library), with no cycle; and every
   * schema the file's outputs and entries name, resolvable the same way.
   */
  private refViolations(e: RegistryEntry, resolve: (id: string) => Schema | null): CourseViolation[] {
    const out: CourseViolation[] = [];
    const v = (path: string, message: string) => out.push({ rule: 'schema', path, message });
    const posted = Object.fromEntries(e.schemas.map((x) => [x.id, x.schema]));
    for (const f of checkSchemaSet(posted, resolve, { subset: false })) v(`schemas.${f.id}${f.path ? `.${f.path}` : ''}`, `${f.id}: ${f.message}`);
    // The schemas the file itself names.
    const c = e.course as { stations?: Record<string, { entry?: { schema: string }[] }>; legs?: Record<string, { outputs?: Record<string, { schema?: string }> }> };
    for (const [sid, st] of Object.entries(c.stations ?? {})) {
      for (const [i, r] of (st.entry ?? []).entries()) if (!resolve(r.schema)) v(`stations.${sid}.entry.${i}.schema`, `${r.schema} is not posted, held or in the std: library`);
    }
    for (const [lid, l] of Object.entries(c.legs ?? {})) {
      for (const [name, o] of Object.entries(l.outputs ?? {})) {
        if (o.schema && parseSchemaId(o.schema) && !resolve(o.schema)) v(`legs.${lid}.outputs.${name}.schema`, `${o.schema} is not posted, held or in the std: library`);
      }
    }
    return out;
  }

  /** A schema by id for `repo`: the `std:` library's, or the repository's stored one; null when
   *  neither. Core's one resolver (R-BTN-108): to core an id is a string with a digest. */
  schema(repo: string, id: string): Schema | null {
    const std = stdSchema(id);
    if (std) return std;
    const row = this.rows<{ schema_json: string }>('SELECT schema_json FROM course_schemas WHERE repository_id = ? AND id = ?', repo, id)[0];
    return row ? (JSON.parse(row.schema_json) as Schema) : null;
  }

  get(repo: string, id: string): CourseRow | null {
    return this.rows<CourseRow>('SELECT repository_id, id, version, min_worker_version, skill FROM courses WHERE repository_id = ? AND id = ?', repo, id)[0] ?? null;
  }

  /** Every course in force, by repository then id: the dashboard's and rule 9's view. */
  all(): CourseRow[] {
    return this.rows<CourseRow>('SELECT repository_id, id, version, min_worker_version, skill FROM courses ORDER BY repository_id, id');
  }

  /** Needs you (R-BTN-69): each refused course file, the one in force staying. */
  refusals() {
    return this.rows<{ repository_id: string; course_id: string; version: number; snapshot_sha: string; refused_at: number; violations: string }>(
      'SELECT repository_id, course_id, version, snapshot_sha, refused_at, violations FROM course_refusals ORDER BY repository_id, course_id')
      .map((r) => ({ ...r, violations: JSON.parse(r.violations) as CourseViolation[] }));
  }
}
