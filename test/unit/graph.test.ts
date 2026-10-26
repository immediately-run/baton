// graph.test.ts — R-BTN-120, R-BTN-121 and §12.5: a leg's `requires.capabilities` as the one
// expansion every reader uses (`legCapabilities`), the view of it the registry derives for the
// candidate query (`legNeedsOf` / `expandedCourse`) — capabilities only, never a role name, and
// `human-operator` literal.
import { describe, it, expect } from 'vitest';
import { expandedCourse, graphOf, legCapabilities, legNeedsOf } from '../../src/core/graph';

const file = (legs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  start: 'a', start_leg: 'work', end: ['b'],
  stations: { a: {}, b: {} },
  legs, ...extra,
});

describe('legCapabilities: a leg\'s names as the capabilities rule 4 compares (R-BTN-120, R-BTN-121)', () => {
  it('expands a course role once, then the vocabulary; a namespaced name stands as itself', () => {
    const needs = legCapabilities({ capabilities: ['deployer', 'create-pr', 'vpn:corp'] }, { deployer: ['vpn:corp', 'credential:DEPLOY_TOKEN'] });
    expect([...needs].sort()).toEqual(['create-pr', 'credential:DEPLOY_TOKEN', 'vpn:corp']);
    // A vocabulary role is the capabilities it carries — never the role's own name.
    expect([...legCapabilities({ capabilities: ['agent-venue'] }, undefined)].sort()).toEqual(['authentication', 'create-pr', 'drivable-browser', 'llm-call']);
  });

  it('is empty for no requires or no list, and ignores non-names', () => {
    expect(legCapabilities(undefined, undefined)).toEqual([]);
    expect(legCapabilities({}, {})).toEqual([]);
    expect(legCapabilities({ capabilities: 'create-pr' }, {})).toEqual([]);
    expect(legCapabilities({ capabilities: ['create-pr', 7, null] }, {})).toEqual(['create-pr']);
  });

  // Review round 6, finding 0: `human-operator` is a built-in bare capability R-BTN-121 compares as a
  // string, never a role. The vocabulary gives it the agent venue's four, so expanding it here let an
  // autonomous `agent-venue` worker take a leg the course reserved for a person.
  it('keeps human-operator literal, beside — never instead of — what it expands to', () => {
    const needs = legCapabilities({ capabilities: ['human-operator', 'agent-venue'] }, undefined);
    expect(needs).toContain('human-operator');
    expect(needs.filter((n) => n !== 'human-operator').sort()).toEqual(['authentication', 'create-pr', 'drivable-browser', 'llm-call']);
    expect(legCapabilities({ capabilities: ['human-operator'] }, undefined)).toEqual(['human-operator']);
  });
});

describe('graphOf: a leg\'s requires is read expanded', () => {
  it('carries capabilities only, with the course\'s capability_roles applied — and human-operator literal', () => {
    const g = graphOf(file(
      { work: { from: ['a'], to: 'b', requires: { capabilities: ['deployer', 'agent-venue'] } }, hands: { from: ['b'], to: 'a', max_runs: 1, requires: { capabilities: ['human-operator'] } } },
      { capability_roles: { deployer: ['vpn:corp', 'credential:DEPLOY_TOKEN'] } },
    ));
    expect([...g.legs.get('work')!.requires].sort()).toEqual(['authentication', 'create-pr', 'credential:DEPLOY_TOKEN', 'drivable-browser', 'llm-call', 'vpn:corp']);
    expect(g.legs.get('hands')!.requires).toEqual(['human-operator']);
    // A leg naming no role is what it always was.
    const plain = graphOf(file({ work: { from: ['a'], to: 'b', requires: { capabilities: ['create-pr', 'vpn:corp'] } } }));
    expect(plain.legs.get('work')!.requires).toEqual(['create-pr', 'vpn:corp']);
  });
});

describe('legNeedsOf: the view the candidate query reads', () => {
  it('gives every leg\'s needs by leg id as graphOf reads them; a leg with none reads empty', () => {
    const needs = legNeedsOf(file(
      { work: { from: ['a'], to: 'b', requires: { capabilities: ['deployer', 'human-operator'] } }, idle: { from: ['b'], to: 'a', max_runs: 2 } },
      { capability_roles: { deployer: ['vpn:corp'] } },
    ));
    expect(needs).toEqual({ work: ['vpn:corp', 'human-operator'], idle: [] });
    expect(legNeedsOf(null)).toEqual({});
    expect(legNeedsOf({ legs: 'no' })).toEqual({});
  });
});

describe('expandedCourse: the review-round-6 view of a file (R-BTN-121, §12.5)', () => {
  it('writes each leg\'s expansion back and drops capability_roles; everything else is kept', () => {
    const src = file(
      { work: { from: ['a'], to: 'b', requires: { capabilities: ['deployer'] } }, idle: { from: ['a'], to: 'b', max_runs: 2 } },
      { capability_roles: { deployer: ['vpn:corp'] }, short_waits: ['ci'] },
    );
    const stored = expandedCourse(src) as Record<string, any>;
    expect(stored.capability_roles).toBeUndefined();
    expect(stored.legs.work.requires).toEqual({ capabilities: ['vpn:corp'] });
    expect(stored.legs.idle).toEqual({ from: ['a'], to: 'b', max_runs: 2 });
    expect(stored.short_waits).toEqual(['ci']);
    // The source is untouched: the registry keeps the file it validated.
    expect((src as Record<string, unknown>).capability_roles).toEqual({ deployer: ['vpn:corp'] });
    // And the stored file reads back as the same graph.
    expect(graphOf(stored).legs.get('work')!.requires).toEqual(['vpn:corp']);
  });
});
