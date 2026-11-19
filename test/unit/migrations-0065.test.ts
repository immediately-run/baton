// B-287 / S-BTN-243: 0022's empty derived view must not hide a deployed course's legs.
import { describe, expect, it } from 'vitest';
import { rows } from '../helpers';

describe('0065 course-leg compatibility', () => {
  it('keeps canonical leg names when an old course has no derived capability view', async () => {
    await rows(`INSERT INTO courses(repository_id,id,version,skill,course_json,step_kinds,min_runner_version)
      VALUES ('docs','old',1,'run','{"legs":{"implement":{}}}','[]',1)`);
    expect(await rows("SELECT leg FROM course_legs WHERE course_id='old'")).toEqual([{ leg: 'implement' }]);
    await rows(`UPDATE courses SET course_json='{"legs":{"review":{}}}' WHERE id='old'`);
    expect(await rows("SELECT leg FROM course_legs WHERE course_id='old'")).toEqual([{ leg: 'review' }]);
    expect(await rows("SELECT * FROM course_leg_capabilities WHERE course_id='old'")).toEqual([]);
  });
});
