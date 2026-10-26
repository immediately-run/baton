// graph.test.ts — R-BTN-120, R-BTN-121 and §12.5: a leg's `requires.capabilities` as the one
// expansion every reader uses (`legCapabilities`), and the stored form it is written in
// (`expandedCourse`) — capabilities only, never a role name.
import { describe, it, expect } from 'vitest';
import { expandedCourse, graphOf, legCapabilities } from '../../src/core/graph';

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
});

describe('graphOf: a leg\'s requires is stored expanded', () => {
  it('carries capabilities only, with the course\'s capability_roles applied', () => {
    const g = graphOf(file(
      { work: { from: ['a'], to: 'b', requires: { capabilities: ['deployer', 'agent-venue'] } } },
      { capability_roles: { deployer: ['vpn:corp', 'credential:DEPLOY_TOKEN'] } },
    ));
    expect([...g.legs.get('work')!.requires].sort()).toEqual(['authentication', 'create-pr', 'credential:DEPLOY_TOKEN', 'drivable-browser', 'llm-call', 'vpn:corp']);
    // A leg naming no role is what it always was.
    const plain = graphOf(file({ work: { from: ['a'], to: 'b', requires: { capabilities: ['create-pr', 'vpn:corp'] } } }));
    expect(plain.legs.get('work')!.requires).toEqual(['create-pr', 'vpn:corp']);
  });
});

describe('expandedCourse: the form the registry stores (R-BTN-121, §12.5)', () => {
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
