// reads/course.ts — `GET …/courses/{course}` (`course.show`, B-197): one course of a repository
// as src/core/courseView.ts joins it. `?since=` is the window (24 hours unless given, 7 days at
// most), `?cursor=` the next page of its tickets, `?summary=1` the list screen's poll — the
// course, its legs and stations with their counts and the window's stats, no tickets, no runs.
import { BatonError } from '../http';
import { COURSE_ID } from '../courses';
import { courseView, isCoursePosition, type CoursePosition } from '../courseView';
import { cursorOf, pageOf, queryOf, type ReadRoute } from './kit';
import { sinceOf } from './window';

export const COURSE_SHOW_READS: ReadRoute[] = [
  {
    // The window, the queues' and the runners' liveness are the clock's.
    action: 'course.show',
    clock: true,
    run(cx, call) {
      const q = queryOf(call);
      const since = sinceOf(q.since, cx.now());
      if (q.summary !== undefined && q.summary !== '1') throw new BatonError('invalid-params', 'summary: 1, or nothing');
      const summary = q.summary === '1';
      if (summary && q.cursor !== undefined) throw new BatonError('invalid-params', 'cursor: a summary has no page');
      const id = call.params.course ?? '';
      if (!COURSE_ID.test(id)) throw new BatonError('not-found', 'no such course');
      const after = summary ? null : cursorOf<CoursePosition>(cx, call);
      if (after !== null && !isCoursePosition(after)) throw new BatonError('invalid-params', 'cursor: not a page of this read');
      const view = courseView(cx, call.repository!, id, { since, summary, after });
      // A course the repository's registry does not hold is `not-found` (B-197).
      if (!view) throw new BatonError('not-found', 'no such course');
      if (!('next' in view)) return view;
      const { next, ...body } = view;
      // B-205's cursor, bound to this caller, action, path and query.
      const cursor = next ? pageOf(cx, call, [next, next], (last) => last, 1).next_cursor : undefined;
      return { ...body, ...(cursor ? { next_cursor: cursor } : {}) };
    },
  },
];
