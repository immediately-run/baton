// reads/courses.ts — two of B-217's three small reads (the third, a ticket's children, was
// already served: ./repository.ts): `GET …/courses` (`repo.courses`), each course of the
// repository as last accepted, and `GET …/schemas` (`repo.schemas`), the registry's schemas by
// id for the dashboard's `View` (R-BTN-112's `ui` renderer needs the schema to draw a value).
import { BatonError } from '../http';
import type { CourseViolation } from '../course';
import type { ReadRoute } from './kit';

/** At most this many ids a `repo.schemas` call (B-217). */
export const SCHEMA_IDS_MAX = 50;

type CourseFile = { capability_types?: unknown; capability_roles?: unknown } & Record<string, unknown>;

export const COURSE_READS: ReadRoute[] = [
  {
    // R-BTN-69, R-BTN-121: the file as last accepted — an opaque blob to core (§12.3), validated
    // at its post — with the capability types and roles it declares, what the Courses view
    // already drew of it (its skill, the runner version it needs, its intake and each leg's
    // queue, R-BTN-79), and the newer version Baton refused, the accepted one staying in force.
    // A course whose only file was refused is listed with `version` and `file` null.
    action: 'repo.courses',
    run(cx, call) {
      const repo = call.repository!;
      const rows = cx.sql<{ id: string; version: number; min_runner_version: number; skill: string; course_json: string }>(
        'SELECT id, version, min_runner_version, skill, course_json FROM courses WHERE repository_id = ? ORDER BY id', repo);
      const refusals = new Map(cx.sql<{ course_id: string; version: number; snapshot_sha: string; refused_at: number; violations: string }>(
        'SELECT course_id, version, snapshot_sha, refused_at, violations FROM course_refusals WHERE repository_id = ? ORDER BY course_id', repo).map((r) => {
        const violations = JSON.parse(r.violations) as CourseViolation[];
        return [r.course_id, { version: r.version, reason: violations[0]?.message ?? 'refused', violations, snapshot_sha: r.snapshot_sha, refused_at: r.refused_at }];
      }));
      const courses = rows.map((c) => {
        const file = JSON.parse(c.course_json) as CourseFile;
        return {
          id: c.id, version: c.version as number | null, file: file as CourseFile | null,
          capability_types: file.capability_types ?? {}, roles: file.capability_roles ?? {},
          skill: c.skill as string | null, min_runner_version: c.min_runner_version as number | null,
          intake: cx.core.queues.intake(repo, c.id) as unknown,
          queues: cx.core.queues.legs(repo, c.id).map(({ leg, depth, max_queue }) => ({ leg, depth, max_queue })),
          refused: refusals.get(c.id) ?? null,
        };
      });
      for (const [id, refused] of refusals) {
        if (rows.some((c) => c.id === id)) continue;
        courses.push({ id, version: null, file: null, capability_types: {}, roles: {}, skill: null, min_runner_version: null, intake: null, queues: [], refused });
      }
      courses.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { courses };
    },
  },
  {
    // R-BTN-108: the shared registry — the `std:` library and the repository's posted course
    // schemas — each as the validator holds it, its `x-baton-view` with it. An id the registry
    // does not hold is absent from the map, never an error; the answer depends on the
    // repository and the ids alone.
    action: 'repo.schemas',
    run(cx, call) {
      const raw = call.url.searchParams.get('ids');
      if (raw == null || raw === '') throw new BatonError('invalid-params', 'ids: the schema ids to read, comma-separated');
      const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
      if (ids.length > SCHEMA_IDS_MAX) throw new BatonError('invalid-params', `ids: at most ${SCHEMA_IDS_MAX} a call`);
      const schemas: Record<string, unknown> = {};
      for (const id of ids) {
        if (id.length > 256) continue;
        const schema = cx.core.courses.schema(call.repository!, id);
        if (schema) schemas[id] = schema;
      }
      return { schemas };
    },
  },
];
