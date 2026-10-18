// standard-courses.test.ts — B-28 (BATON_SPEC R-BTN-131): the registry of standard courses. Every
// course file passes R-BTN-69's acceptance; every leg has a stub and shipped instructions; every
// stub's position is an edge of its course for every answer its agent may give; the instructions
// carry none of the docs repository's own machinery; `pr` names `create-pr`.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCourse } from '../../src/core/course';
import { BUILT_INS, DEFAULT_COURSE, builtIn, scaffoldable } from '../../src/defaults/courses';

const instructionsDir = (id: string) => join(__dirname, '..', '..', 'src', 'defaults', 'courses', id);
const tosOf = (to: string | string[]): string[] => (Array.isArray(to) ? to : [to]);

describe('the standard courses (R-BTN-131)', () => {
  it('are create-pr, review-pr, bug-report, draft-ticket and decision; create-pr is the default', () => {
    expect(BUILT_INS.map((b) => b.id)).toEqual(['create-pr', 'review-pr', 'bug-report', 'draft-ticket', 'decision']);
    expect(DEFAULT_COURSE).toBe('create-pr');
  });

  for (const b of BUILT_INS) {
    describe(b.id, () => {
      it('its course file passes R-BTN-69: one start, terminal ends, every station reachable and reaching an end', () => {
        expect(validateCourse(b.course)).toEqual([]);
      });

      it('every leg has a stub and shipped instructions, and nothing else is shipped', () => {
        const legs = Object.keys(b.course.legs).sort();
        expect(Object.keys(b.legs).sort()).toEqual(legs);
        expect(readdirSync(instructionsDir(b.id)).sort()).toEqual(legs.map((l) => `${l}.md`));
        for (const l of legs) expect(readFileSync(join(instructionsDir(b.id), `${l}.md`), 'utf8')).toMatch(new RegExp(`^# ${b.id} · ${l} — `));
      });

      it('every stub returns an edge for every answer: reached is one of the leg\'s outcomes, next leaves it, null only at an end', () => {
        for (const [leg, stub] of Object.entries(b.legs)) {
          const answers = stub.ask?.values ?? [undefined];
          for (const answer of answers) {
            const pos = new Function('answer', `return (${stub.position});`)(answer) as { reached: string; next: string | null; [k: string]: unknown };
            expect(tosOf(b.course.legs[leg].to), `${leg} → ${pos.reached}`).toContain(pos.reached);
            if (b.course.end.includes(pos.reached)) expect(pos.next, `${leg} at an end`).toBeNull();
            else expect(b.course.legs[pos.next as string]?.from, `${leg} queues ${pos.next}`).toContain(pos.reached);
            // The answer reaches close under the name close reads.
            if (stub.ask) expect(stub.ask.name === 'outcome' ? pos.reached : pos[stub.ask.name]).toBe(answer);
          }
        }
      });

      it('its instructions carry none of the docs repository\'s machinery (§2a, R-BTN-50)', () => {
        for (const f of readdirSync(instructionsDir(b.id))) {
          const text = readFileSync(join(instructionsDir(b.id), f), 'utf8');
          for (const word of ['claim.sh', 'docs/main', 'content/roadmap', 'pr-findings', 'R3-', 'immediately.run', 'next-roadmap-item']) {
            expect(text.includes(word), `${b.id}/${f} names ${word}`).toBe(false);
          }
        }
      });
    });
  }

  it('the instruction directories hold exactly the registered courses', () => {
    const root = join(__dirname, '..', '..', 'src', 'defaults', 'courses');
    expect(readdirSync(root).filter((d) => existsSync(join(root, d, '.'))).sort()).toEqual(BUILT_INS.map((b) => b.id).sort());
  });

  it('pr names create-pr for a repository scaffolded before, and is no longer scaffolded', () => {
    expect(builtIn('pr')?.id).toBe('create-pr');
    expect(() => scaffoldable('pr')).toThrow('--course pr: renamed create-pr');
    expect(() => scaffoldable('epic')).toThrow('the CLI scaffolds create-pr, review-pr, bug-report, draft-ticket, decision');
    expect(builtIn('epic')).toBeUndefined();
  });
});
