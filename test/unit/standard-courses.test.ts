// standard-courses.test.ts — B-28 (BATON_SPEC R-BTN-131): the registry of standard courses. Every
// course file passes R-BTN-69's acceptance; every leg has a stub and shipped instructions; every
// stub's position is an edge of its course for every answer its agent may give; the instructions
// carry none of the docs repository's own machinery; `pr` names `create-pr`.
//
// B-96's kit (this ticket's Tests): create-spec's shortest route runs green through the real
// claim, advance and end, and a `changes` verdict routes to `address` — three rounds of it, then
// `adjudicate`, which the kit's shortest route never reaches: only a fourth `review` after three
// `address` rounds does (B-96 review round 1, 1-A-1: `review` at 3 refused that fourth
// `max-runs` and left `adjudicate` unreachable).
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCourse } from '../../src/core/course';
import { graphOf, onGraph, type Step } from '../../src/core/graph';
import { checkCourse, shortestRoute, type KitInput } from '../../src/local/testCourse';
import { APPROVAL_STAGES, BUILT_INS, DEFAULT_COURSE, buildAppWaits, builtIn, scaffoldable } from '../../src/defaults/courses';
import { CREATE_SPEC_COURSE, stationsSpec, type PrFact, type PrGraph } from '../../src/defaults/course-pr';
import { ticketsMarkdown, type SourceTicket } from '../../src/defaults/tickets-markdown';

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

  it('create-spec and build-app carry starts_from: request, and no other course does (B-98)', () => {
    expect(BUILT_INS.filter((b) => b.course.starts_from !== undefined).map((b) => [b.id, b.course.starts_from])).toEqual([['build-app', 'request'], ['create-spec', 'request']]);
    for (const b of BUILT_INS) if (b.id !== 'build-app' && b.id !== 'create-spec') expect(b.course).not.toHaveProperty('starts_from');
    // The course file a repository scaffolds is the built-in's own JSON, so the key is in the file
    // `baton request` reads from the checkout.
    expect(JSON.parse(JSON.stringify(CREATE_SPEC_COURSE))).toMatchObject({ starts_from: 'request', start: 'requested', start_leg: 'converse' });
  });

  it('the core accepts starts_from: request and refuses any other value (B-98, R-BTN-131)', () => {
    const base = { start: 'a', start_leg: 'b', end: ['z'], stations: { a: { label: 'A' }, z: { label: 'Z' } }, legs: { b: { from: ['a'], to: 'z', label: 'B' } } };
    expect(validateCourse(base)).toEqual([]);
    expect(validateCourse({ ...base, starts_from: 'request' })).toEqual([]);
    for (const bad of ['hand', 'Request', '', 1, null, ['request'], { request: true }]) {
      expect(validateCourse({ ...base, starts_from: bad }), JSON.stringify(bad)).toEqual([{ rule: 'starts-from', path: 'starts_from', message: 'starts_from, when given, is one of request' }]);
    }
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

  describe('create-spec’s kit (B-96)', () => {
    const KIT: KitInput = {
      course: 'create-spec', proposed: CREATE_SPEC_COURSE, base: null,
      proposedVersions: { version: 1, min_worker_version: 1 }, baseVersions: null,
      legScripts: null, live: null,
    };
    /** Where the course's own station function puts a ticket, from the facts and markers it reads
     *  (the same call the sync and an ejected `sync.mjs` make). */
    const placed = (fact: PrFact | null, markers: { ticket: string; leg: string; reached: string }[], id = 'A-1') =>
      stationsSpec({
        tickets: [ticketOf(id)], facts: fact ? [fact] : [], closed: new Set(), done: new Set(), branchPatterns: ['claude/{ticket}-*'],
        repository: null, graph: CREATE_SPEC_COURSE as unknown as PrGraph, markers,
      }).stations[id];

    it('its shortest route is converse → review → merge, and the route runs green through the core’s claim, advance and end', async () => {
      expect(shortestRoute(graphOf(CREATE_SPEC_COURSE))!.map((s) => `${s.leg}→${s.reached}`)).toEqual(['converse→spec-open', 'review→reviewed', 'merge→merged']);
      // The kit's whole run: the file accepted by the core, the route claimed leg by leg, ended
      // done and confirmed by the next post — no violation.
      expect(await checkCourse(KIT)).toEqual([]);
    }, 60_000);

    it('a changes verdict routes to address — three rounds of it, then adjudicate, each an edge the core accepts', () => {
      // The longest path the course allows before adjudicating: the design conversation, then an
      // address round after each of four changes verdicts — the fourth review is the one that finds
      // the rounds spent. Every step is an edge, and neither cap is exceeded: the arithmetic that
      // makes `adjudicate` reachable (B-96 review round 1, 1-A-1).
      const steps: Step[] = ['converse→spec-open', 'review→reviewed',
        'address→spec-open', 'review→reviewed', 'address→spec-open', 'review→reviewed',
        'address→spec-open', 'review→reviewed', 'adjudicate→adjudicated', 'merge→merged']
        .map((s) => { const [leg, reached] = s.split('→'); return { leg, reached }; });
      expect(onGraph(graphOf(CREATE_SPEC_COURSE), steps)).toBe(true);
      const runs = (leg: string) => steps.filter((s) => s.leg === leg).length;
      expect(runs('review')).toBe(CREATE_SPEC_COURSE.legs.review.max_runs);
      expect(runs('address')).toBe(CREATE_SPEC_COURSE.legs.address.max_runs);
      // And the board, given the same rounds as PR facts (four verdicts, a push after each of the
      // first three, three address markers), places the ticket where the fourth verdict leaves it:
      // `adjudicate` ready, never a fourth `address`.
      const reviews = [verdict('changes', 100), verdict('changes', 200), verdict('changes', 300), verdict('changes', 400)];
      const markers = ['address', 'address', 'address'].map(() => ({ ticket: 'A-1', leg: 'address', reached: 'reviewed' }));
      expect(placed(factOf(reviews, [150, 250, 350]), markers)).toMatchObject({
        station: 'reviewed', path: steps.slice(0, 8), next_leg: 'adjudicate', next: [{ leg: 'adjudicate', state: 'ready', waiting_on: null }],
      });
    });

    it('a suspended address round is not re-offered: the board holds it waiting on the owner until its push lands', () => {
      // One changes verdict, one address round claimed and suspended: the leg's close wrote its
      // marker and no push has landed, so `address` waits on the owner rather than being ready.
      const changes = factOf([verdict('changes', 100)], []);
      const marker = [{ ticket: 'A-1', leg: 'address', reached: 'reviewed' }];
      expect(placed(changes, marker)).toMatchObject({ station: 'reviewed', next: [{ leg: 'address', state: 'waiting', waiting_on: 'owner' }] });
      // A round whose push landed but whose next verdict has not been posted yet: the ticket is
      // at `spec-open`, `review` ready — the round is not offered again, and no marker is needed,
      // because the push itself is the signal the timeline reads.
      expect(placed(factOf([verdict('changes', 100)], [150]), marker)).toMatchObject({ next: [{ leg: 'review', state: 'ready', waiting_on: null }] });
    });

    it('the design conversation’s marker is no step: the posted path stays empty, and the ticket waits on the owner', () => {
      // `converse`'s only outcome is `spec-open`; a marker at `requested` is a signal, so the path
      // posted with it must be one the graph accepts (`[]`), or every sync logs `off-graph` (B-96
      // review round 1, 1-A-3).
      const placedAtRequest = placed(null, [{ ticket: 'A-1', leg: 'converse', reached: 'requested' }]);
      expect(placedAtRequest).toMatchObject({ station: 'requested', path: [], next_leg: 'converse', next: [{ leg: 'converse', state: 'waiting', waiting_on: 'owner' }] });
      expect(onGraph(graphOf(CREATE_SPEC_COURSE), placedAtRequest.path)).toBe(true);
      // No marker: ready for the first claim.
      expect(placed(null, [])).toMatchObject({ path: [], next: [{ leg: 'converse', state: 'ready', waiting_on: null }] });
      // The conversation's PR landing moves it, the marker still standing.
      expect(placed(factOf([], []), [{ ticket: 'A-1', leg: 'converse', reached: 'requested' }])).toMatchObject({ station: 'spec-open', path: [{ leg: 'converse', reached: 'spec-open' }] });
    });
  });
});

const ticketOf = (id: string): SourceTicket => ticketsMarkdown([{ path: `tickets/${id.toLowerCase()}.md`, text: `---\nid: ${id}\ntitle: A\ncourse: create-spec\n---\n` }]).tickets[0];

const verdict = (v: 'approve' | 'changes', at: number): PrFact['reviews'][number] => ({ author: 'r1', state: 'COMMENTED', submittedAt: at, body: `<!-- baton:verdict ${v} -->` });

/** One open PR on the course's branch pattern, its checks green, `pushes` its commits' dates. */
const factOf = (reviews: PrFact['reviews'], pushes: number[]): PrFact => ({
  number: 7, head: 'claude/A-1-spec', state: 'open', pushedAt: pushes.at(-1) ?? reviews.at(-1)?.submittedAt ?? 0,
  ...(pushes.length ? { pushes } : {}), checks: ['success'], reviews,
});
