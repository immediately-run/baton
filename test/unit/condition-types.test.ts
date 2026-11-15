// condition-types.test.ts — the pure halves of B-234 (BATON_SPEC §7.1 R-BTN-160, §7.1
// R-BTN-195): the standard table and its inheritance, the runner's raise check (answered on the
// channel, never reaching Baton), the course validator's `autonomous` rules and condition
// declarations, and the signature `baton course test` prints (R-BTN-111). The scenario halves —
// the report, the list, the Needs-you entry, the joinable session — are S-BTN-222.
import { describe, it, expect } from 'vitest';
import { validateCourse } from '../../src/core/course';
import { graphOf } from '../../src/core/graph';
import { STANDARD_CONDITION_TYPES, checkRaise, dispositionOf, declaredConditions, errorClassOf, signatureConditions } from '../../src/core/conditionTypes';

const declared = declaredConditions({
  conditions: {
    'ask.owner': { disposition: 'suspend', restarts: { retry: 'again', park: 'hold' }, default: 'retry' },
    'ask.owner.deep': { disposition: 'notify' },
    note: { disposition: 'notify', wait_s: 60, retryable: false, description: 'a note' },
    'error.db-down': { disposition: 'interrupt', retryable: true },
    'error.licence': { disposition: 'interrupt', retryable: false },
  },
});

describe('the standard condition types (R-BTN-160)', () => {
  it('hitl suspends, warning and interact notify, error interrupts; baton is core\'s alone', () => {
    expect(STANDARD_CONDITION_TYPES.get('hitl')).toMatchObject({ disposition: 'suspend' });
    expect(STANDARD_CONDITION_TYPES.get('interact')).toMatchObject({ disposition: 'notify' });
    expect(STANDARD_CONDITION_TYPES.get('warning')).toMatchObject({ disposition: 'notify' });
    expect(STANDARD_CONDITION_TYPES.get('error')).toMatchObject({ disposition: 'interrupt' });
    expect(STANDARD_CONDITION_TYPES.get('baton')?.coreOnly).toBe(true);
  });

  it('error.needs-person is a standard interrupt, not retryable (R-BTN-195)', () => {
    expect(STANDARD_CONDITION_TYPES.get('error.needs-person')).toEqual({ disposition: 'interrupt', retryable: false });
  });

  it('a declared subtype inherits unless it states its own; an unknown type carries none', () => {
    expect(dispositionOf('ask.owner', declared)).toBe('suspend');
    expect(dispositionOf('ask.owner.deep', declared)).toBe('notify');
    expect(dispositionOf('hitl.spec-contradiction', declared)).toBe('suspend');
    expect(dispositionOf('error.transient', declared)).toBe('interrupt');
    expect(dispositionOf('unheard-of', declared)).toBeNull();
    expect(dispositionOf('unheard-of.deep', declared)).toBeNull();
  });

  it('errorClassOf names core\'s classes by their type (§6.5: `cannot-finish` classes are the `error.<class>` types), never as `spec`', () => {
    expect(errorClassOf('error.capability', declared)).toBe('capability');
    expect(errorClassOf('error.contract-input', declared)).toBe('contract-input');
    expect(errorClassOf('error.contract-output', declared)).toBe('contract-output');
    expect(errorClassOf('error.spec', declared)).toBe('spec');
    expect(errorClassOf('error.needs-person', declared)).toBe('spec'); // non-retryable, no class of its own (R-BTN-195)
    expect(errorClassOf('error.transient', declared)).toBe('transient');
    expect(errorClassOf('error', declared)).toBe('transient'); // an untyped exception is error.transient (R-BTN-122)
  });

  it('errorClassOf: a subtype takes its ancestor\'s class; a course\'s own type follows its retryable; the end each forms is a §6.5 reason', () => {
    expect(errorClassOf('error.capability.gate', declared)).toBe('capability');
    expect(errorClassOf('error.spec.contradiction', declared)).toBe('spec');
    expect(errorClassOf('error.db-down', declared)).toBe('transient'); // the course's own, retryable
    expect(errorClassOf('error.licence', declared)).toBe('spec'); // the course's own, not retryable
    expect(errorClassOf('error.licence.seat', declared)).toBe('spec'); // the nearest declared ancestor's
    expect(errorClassOf('note', declared)).toBe('spec');
    expect(errorClassOf('unheard-of', declared)).toBe('spec');
  });

  it('every class errorClassOf can name forms a released:cannot-finish:<class> reason §6.5 admits', async () => {
    const { RELEASE_END_REASONS } = await import('../../src/core/validate');
    for (const type of ['error.transient', 'error.capability', 'error.spec', 'error.contract-output', 'error.contract-input', 'error.needs-person', 'error.db-down', 'error.licence']) {
      expect([type, RELEASE_END_REASONS.includes(`cannot-finish:${errorClassOf(type, declared)}` as never)]).toEqual([type, true]);
    }
  });
});

describe('the runner\'s raise check (R-BTN-160, R-BTN-195)', () => {
  const at = (over: Partial<Parameters<typeof checkRaise>[2]> = {}) => ({
    conditions: null, autonomous: false, deadlineS: 3600, sessionUrl: 'https://claude.ai/s/1', ...over,
  });

  it('a well-formed standard type passes; baton and unknown types are refused', () => {
    expect(checkRaise('interact', declared, at())).toEqual({ ok: true });
    expect(checkRaise('hitl', declared, at())).toEqual({ ok: true });
    expect(checkRaise('ask.owner', declared, at())).toEqual({ ok: true });
    expect(checkRaise('baton.retries', declared, at()).ok).toBe(false);
    expect(checkRaise('NotAType', declared, at()).ok).toBe(false);
    expect(checkRaise('unheard-of', declared, at()).ok).toBe(false);
  });

  it('a leg\'s conditions narrow what it may raise, a listed type covering its subtypes', () => {
    expect(checkRaise('warning', declared, at({ conditions: ['warning'] }))).toEqual({ ok: true });
    expect(checkRaise('hitl.x', declared, at({ conditions: ['hitl'] }))).toEqual({ ok: true });
    expect(checkRaise('interact', declared, at({ conditions: [] })).ok).toBe(false);
    expect(checkRaise('interact', declared, at({ conditions: ['warning'] })).ok).toBe(false);
  });

  it('an autonomous leg asks for no person: no interact, no suspend type, hitl\'s subtypes included (R-BTN-195)', () => {
    expect(checkRaise('interact', declared, at({ autonomous: true })).ok).toBe(false);
    expect(checkRaise('hitl', declared, at({ autonomous: true })).ok).toBe(false);
    expect(checkRaise('hitl.x', declared, at({ autonomous: true })).ok).toBe(false);
    expect(checkRaise('ask.owner', declared, at({ autonomous: true })).ok).toBe(false);
    expect(checkRaise('ask.owner.deep', declared, at({ autonomous: true })).ok).toBe(true); // narrowed to notify
    expect(checkRaise('error.needs-person', declared, at({ autonomous: true }))).toEqual({ ok: true });
    expect(checkRaise('warning', declared, at({ autonomous: true }))).toEqual({ ok: true });
  });

  it('interact needs its leg\'s deadline and its run\'s session link (R-BTN-195, R-BTN-167, R-BTN-113)', () => {
    expect(checkRaise('interact', declared, at({ deadlineS: null })).ok).toBe(false);
    expect(checkRaise('interact', declared, at({ sessionUrl: null })).ok).toBe(false);
    expect(checkRaise('hitl', declared, at({ deadlineS: null, sessionUrl: null }))).toEqual({ ok: true });
  });
});

describe('the course file\'s new fields (R-BTN-69, R-BTN-160, R-BTN-195)', () => {
  const file = (legs: Record<string, unknown>, conditions?: Record<string, unknown>) => ({
    start: 'filed', start_leg: 'implement', end: ['done'], stations: { filed: {}, done: {} },
    ...(conditions ? { conditions } : {}),
    legs: { implement: { from: ['filed'], to: 'done' }, ...legs },
  });
  const faults = (f: unknown) => validateCourse(f).map((v) => `${v.path}: ${v.rule}`);

  it('a leg may declare autonomous; the graph carries it, its deadline and its narrowing', () => {
    const f = file({ asker: { from: ['filed'], to: 'done', autonomous: true, max_duration: 600, conditions: ['error'] } });
    expect(faults(f)).toEqual([]);
    const g = graphOf(f);
    expect(g.legs.get('asker')).toMatchObject({ autonomous: true, maxDuration: 600, conditionTypes: ['error'] });
    expect(g.legs.get('implement')).toMatchObject({ autonomous: false, maxDuration: null, conditionTypes: null });
    expect(g.conditionTypes.get('ask.owner')?.disposition).toBe(undefined);
  });

  it('the course\'s declarations are validated, baton refused, and carried by the graph', () => {
    expect(faults(file({}, { 'ask.owner': { disposition: 'suspend', restarts: { retry: 'again' }, default: 'retry', wait_s: 120 } }))).toEqual([]);
    const g = graphOf(file({}, { 'ask.owner': { disposition: 'suspend' } }));
    expect(g.conditionTypes.get('ask.owner')).toMatchObject({ disposition: 'suspend' });
    expect(faults(file({}, { 'baton.retries': { disposition: 'notify' } }))).toContain('conditions.baton.retries: conditions');
    expect(faults(file({}, { 'ask.owner': {} }))).toContain('conditions.ask.owner.disposition: shape');
    expect(faults(file({}, { 'ask.owner': { disposition: 'wait' } }))).toContain('conditions.ask.owner.disposition: shape');
    expect(faults(file({}, { 'ask.owner': { disposition: 'suspend', default: 'nope' } }))).toContain('conditions.ask.owner.default: shape');
    expect(faults(file({}, { 'ask.owner': { disposition: 'suspend', wait_s: 901 } }))).toContain('conditions.ask.owner.wait_s: bound');
  });

  it('autonomous sits on no kind: person leg, and never beside a conditions list naming what it bars', () => {
    expect(faults(file({ person: { from: ['filed'], to: 'done', kind: 'person', asks: 'owner', autonomous: true } })))
      .toContain('legs.person.autonomous: autonomous');
    expect(faults(file({ a: { from: ['filed'], to: 'done', autonomous: true, conditions: ['hitl.x'] } })))
      .toContain('legs.a.autonomous: autonomous');
    expect(faults(file({ a: { from: ['filed'], to: 'done', autonomous: true, conditions: ['interact'] } })))
      .toContain('legs.a.autonomous: autonomous');
    expect(faults(file({ a: { from: ['filed'], to: 'done', autonomous: true, conditions: ['error.needs-person', 'warning'] } }))).toEqual([]);
  });

  it('R-BTN-69\'s clause reads on the field\'s presence: autonomous: false is refused the same beside a barred type or on a person leg', () => {
    expect(faults(file({ a: { from: ['filed'], to: 'done', autonomous: false, conditions: ['hitl'] } })))
      .toContain('legs.a.autonomous: autonomous');
    expect(faults(file({ a: { from: ['filed'], to: 'done', autonomous: false, conditions: ['interact.x', 'warning'] } })))
      .toContain('legs.a.autonomous: autonomous');
    expect(faults(file({ person: { from: ['filed'], to: 'done', kind: 'person', asks: 'owner', autonomous: false } })))
      .toContain('legs.person.autonomous: autonomous');
    // A leg that is not autonomous says nothing: `false` alone, or beside what asks nothing, is
    // the same silence, and the graph reads it as not autonomous.
    expect(faults(file({ a: { from: ['filed'], to: 'done', autonomous: false } }))).toEqual([]);
    expect(faults(file({ a: { from: ['filed'], to: 'done', autonomous: false, conditions: ['warning', 'error.needs-person'] } }))).toEqual([]);
    expect(graphOf(file({ a: { from: ['filed'], to: 'done', autonomous: false } })).legs.get('a')).toMatchObject({ autonomous: false });
  });

  it('a leg\'s conditions name standard or declared types only', () => {
    expect(faults(file({ a: { from: ['filed'], to: 'done', conditions: ['hitl', 'interact'] } }, { 'ask.owner': { disposition: 'suspend' } }))).toEqual([]);
    expect(faults(file({ a: { from: ['filed'], to: 'done', conditions: ['hitl', 'ask.owner', 'interact'] } }))).toContain('legs.a.conditions.1: conditions');
    expect(faults(file({ a: { from: ['filed'], to: 'done', conditions: ['unheard-of'] } }))).toContain('legs.a.conditions.0: conditions');
    expect(faults(file({ a: { from: ['filed'], to: 'done', conditions: ['baton.retries'] } }))).toContain('legs.a.conditions.0: conditions');
  });

  it('the signature lists the standard types and the course\'s own (R-BTN-111)', () => {
    const s = signatureConditions(file({ a: { from: ['filed'], to: 'done', conditions: ['warning'] } }, { 'ask.owner': { disposition: 'suspend' } }));
    expect(s.declared).toEqual(['ask.owner']);
    expect(s.standard).toContain('interact');
    expect(s.standard).toContain('error.needs-person');
    expect(s.standard).not.toContain('baton');
    expect(s.narrowed).toEqual([{ leg: 'a', types: ['warning'] }]);
  });
});
