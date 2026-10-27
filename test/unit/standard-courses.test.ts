// standard-courses.test.ts — B-28 (BATON_SPEC R-BTN-131): the registry of standard courses. Every
// course file passes R-BTN-69's acceptance; every leg has a stub and shipped instructions; every
// stub's position is an edge of its course for every answer its agent may give; the instructions
// carry none of the docs repository's own machinery; `pr` names `create-pr`.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCourse } from '../../src/core/course';
import { APPROVAL_STAGES, BUILT_INS, DEFAULT_COURSE, buildAppWaits, builtIn, scaffoldable } from '../../src/defaults/courses';
import type { SourceTicket } from '../../src/defaults/tickets-markdown';

const instructionsDir = (id: string) => join(__dirname, '..', '..', 'src', 'defaults', 'courses', id);
const tosOf = (to: string | string[]): string[] => (Array.isArray(to) ? to : [to]);

describe('the standard courses (R-BTN-131)', () => {
  it('are create-pr, review-pr, bug-report, draft-ticket, decision, build-app and create-spec; create-pr is the default', () => {
    expect(BUILT_INS.map((b) => b.id)).toEqual(['create-pr', 'review-pr', 'bug-report', 'draft-ticket', 'decision', 'build-app', 'create-spec']);
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
            // A suspension may rest where the leg started (R-BTN-71: a give-up), which the file's
            // `to` does not list; every other reached station is an outcome. S-BTN-174 drives
            // create-spec's such stubs end to end.
            expect([...tosOf(b.course.legs[leg].to), ...(pos.suspend === true ? tosOf(b.course.legs[leg].from) : [])], `${leg} → ${pos.reached}`).toContain(pos.reached);
            if (b.course.end.includes(pos.reached)) expect(pos.next, `${leg} at an end`).toBeNull();
            else expect(b.course.legs[pos.next as string]?.from, `${leg} queues ${pos.next}`).toContain(pos.reached);
            // The answer reaches close under the name close reads.
            if (stub.ask) expect(stub.ask.name === 'outcome' ? pos.reached : pos[stub.ask.name]).toBe(answer);
          }
        }
      });

      it('every leg that can reach an end tells its agent to close the ticket: the sync reads only status: done (R-BTN-74)', () => {
        for (const [leg, stub] of Object.entries(b.legs)) {
          const ends = (stub.ask?.values ?? [undefined]).some((answer) => {
            const pos = new Function('answer', `return (${stub.position});`)(answer) as { reached: string };
            return b.course.end.includes(pos.reached);
          });
          if (ends) expect(readFileSync(join(instructionsDir(b.id), `${leg}.md`), 'utf8'), `${b.id}/${leg}`).toMatch(/`?status:`? to `?done`?/);
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

  it('a leg whose next waits on someone outside the claim suspends it; every other leg goes on', () => {
    const waits = new Set([
      'create-pr adjudicate owner', 'review-pr review changes', 'decision prepare',
      'build-app define', 'build-app design', 'build-app architect', 'build-app plan', 'build-app file', 'build-app verify building',
      // create-spec's two interactive legs: the owner's session is run by the owner, so the claim
      // ends where the leg starts and the ticket waits for the work it produces.
      'create-spec converse', 'create-spec address', 'create-spec adjudicate owner',
    ]);
    for (const b of BUILT_INS) {
      for (const [leg, stub] of Object.entries(b.legs)) {
        for (const answer of stub.ask?.values ?? [undefined]) {
          const pos = new Function('answer', `return (${stub.position});`)(answer) as { suspend?: boolean };
          const key = [b.id, leg, answer].filter(Boolean).join(' ');
          expect(pos.suspend === true, key).toBe(waits.has(key));
        }
      }
    }
  });

  it('the instruction directories hold exactly the registered courses', () => {
    const root = join(__dirname, '..', '..', 'src', 'defaults', 'courses');
    expect(readdirSync(root).filter((d) => existsSync(join(root, d, '.'))).sort()).toEqual(BUILT_INS.map((b) => b.id).sort());
  });

  it('pr names create-pr for a repository scaffolded before, and is no longer scaffolded', () => {
    expect(builtIn('pr')?.id).toBe('create-pr');
    expect(() => scaffoldable('pr')).toThrow('--course pr: renamed create-pr');
    expect(() => scaffoldable('epic')).toThrow('the CLI scaffolds create-pr, review-pr, bug-report, draft-ticket, decision, build-app, create-spec');
    expect(builtIn('epic')).toBeUndefined();
  });

  it('create-pr\'s implement stub verifies its PR on the forge before claiming it, and no other leg or course does (B-81)', () => {
    for (const b of BUILT_INS) {
      for (const [leg, stub] of Object.entries(b.legs)) {
        expect(stub.verify, `${b.id}/${leg}`).toBe(b.id === 'create-pr' && leg === 'implement' ? 'pr' : undefined);
      }
    }
  });

  describe('build-app waits (B-40)', () => {
    const ticket = (answer?: string, blocked_by: string[] = []): SourceTicket =>
      ({ id: 'A-1', course_id: 'build-app', blocked_by, depends_on: [], course: answer == null ? {} : { answer } }) as unknown as SourceTicket;

    it('each drafting leg after define waits on the owner until answer: approves the document it builds on', () => {
      const gates: [string, string][] = [['design', 'define'], ['architect', 'design'], ['plan', 'architect'], ['file', 'plan']];
      for (const [leg, gate] of gates) {
        expect(buildAppWaits(ticket(), leg), `${leg} unanswered`).toBe('owner');
        expect(buildAppWaits(ticket('open'), leg), `${leg} open`).toBe('owner');
        for (const a of APPROVAL_STAGES) {
          const ready = APPROVAL_STAGES.indexOf(a) >= APPROVAL_STAGES.indexOf(gate);
          expect(buildAppWaits(ticket(a), leg), `${leg} at answer ${a}`).toBe(ready ? null : 'owner');
        }
      }
      expect(buildAppWaits(ticket(' Design '), 'architect')).toBeNull();
    });

    it('define waits on nothing of its own; verify waits on open children, and on nothing else', () => {
      expect(buildAppWaits(ticket(), 'define')).toBeNull();
      expect(buildAppWaits(ticket(), 'verify')).toBeNull();
      expect(buildAppWaits(ticket('plan', ['A-1-1']), 'verify')).toBe('children');
    });
  });
});
