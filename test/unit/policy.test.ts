// policy.test.ts — the repository policy's pure side (BATON_SPEC §12.8 R-BTN-188/R-BTN-189,
// B-145): the canonical JSON and the synchronous SHA-256, every knob's schema (the presets
// validate, the refusals refuse), `diff`, each guarantee's condition against the presets, and
// the git-repository folds of `plain-git`. Runs on both hosts' shared unit set (cloudflare).
import { describe, it, expect } from 'vitest';
import {
  canonicalJson, sha256HexSync, validatePolicyDocument, diffPolicies, guaranteesOf, policyForPreset,
  legStateOf, humanOnlyList, COOPERATIVE, PROTECTED, PROTECTED_SIGNED, PLAIN_GIT, PRESETS, GUARANTEE_NAMES, KNOBS,
} from '../../src/core/policy';
import { BatonError } from '../../src/core/http';

const sha256Async = async (text: string) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

describe('the repository policy (R-BTN-188, R-BTN-189)', () => {
  it('canonicalJson sorts keys and drops whitespace, recursively', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalJson({ z: { d: 2, c: 1 }, a: {} })).toBe('{"a":{},"z":{"c":1,"d":2}}');
    // Key order alone is not a different document.
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('sha256HexSync agrees with WebCrypto, over strings longer than a block too', async () => {
    for (const text of ['', 'x', 'baton-policy@1\n{"a":1}', JSON.stringify(COOPERATIVE), `${'k'.repeat(1000)}\n${'v'.repeat(55)}`]) {
      expect(sha256HexSync(text)).toBe(await sha256Async(text));
    }
  });

  it('every preset validates against the knob schemas, on a forge', () => {
    for (const [name, doc] of Object.entries(PRESETS)) {
      if (name === 'plain-git') continue; // a git repository's, below
      expect(() => validatePolicyDocument(doc, { forge: 'github' })).not.toThrow();
    }
  });

  it('an unknown knob, a value outside its schema, and a bad writer are refused', () => {
    const refuse = (doc: unknown, forge: 'github' | 'git' = 'github') => {
      try {
        validatePolicyDocument(doc, { forge });
        return 'accepted';
      } catch (e) {
        expect(e).toBeInstanceOf(BatonError);
        return (e as BatonError).message;
      }
    };
    expect(refuse({ ...COOPERATIVE, landing: 'cooperative' })).toContain('landing');
    expect(refuse({ ...COOPERATIVE, human_key: 'software' })).toContain('human_key');
    expect(refuse({ ...COOPERATIVE, approvers: { ...COOPERATIVE.approvers, policy: [] } })).toContain('approvers.policy');
    expect(refuse({ ...COOPERATIVE, approvers: { ...COOPERATIVE.approvers, policy: ['delegated'] } })).toContain('approvers.policy');
    expect(refuse({ ...COOPERATIVE, merge: { ...COOPERATIVE.merge, reviews: { count: 2, distinct: ['hostname'] } } })).toContain('distinct');
    expect(refuse({ ...COOPERATIVE, attestations: { ...COOPERATIVE.attestations, 'std:review@1': ['runner'] } })).toContain('std:review@1');
    expect(refuse({ ...COOPERATIVE, readings: { '*': { writers: ['owner'], signed: false } } })).toContain('readings.*');
  });

  it("R-BTN-180: a policy whose writes could never land is refused — the three cases", () => {
    const refuse = (doc: unknown) => {
      try {
        validatePolicyDocument(doc, { forge: 'github' });
        return null;
      } catch (e) {
        return (e as BatonError).message;
      }
    };
    // outbox.git admits a class that refs.default_branch excludes under tickets.created: filed.
    expect(refuse({ ...COOPERATIVE, refs: { ...COOPERATIVE.refs, default_branch: ['human'] }, outbox: { ...COOPERATIVE.outbox, git: { deliverers: ['trusted-runner'], trust: 'any' } } })).toContain('could never land');
    // outbox.git admits a class that refs.other excludes under tickets.created: proposed.
    expect(refuse({ ...COOPERATIVE, tickets: { created: 'proposed' }, refs: { ...COOPERATIVE.refs, other: ['runner', 'human'] }, outbox: { ...COOPERATIVE.outbox, git: { deliverers: ['trusted-runner'], trust: 'any' } } })).toContain('could never land');
    // refs.default_branch excludes runner while tickets.created is filed.
    expect(refuse({ ...COOPERATIVE, refs: { ...COOPERATIVE.refs, default_branch: ['trusted-runner', 'human'] } })).toContain('file tickets nowhere');
  });

  it('a git repository refuses leg_state: forge, ci-identity and a forge-check deliverer; plain-git folds them', () => {
    const refuse = (doc: unknown) => {
      try {
        validatePolicyDocument(doc, { forge: 'git' });
        return null;
      } catch (e) {
        return (e as BatonError).message;
      }
    };
    expect(refuse(PLAIN_GIT)).toBeNull();
    expect(refuse({ ...PLAIN_GIT, leg_state: 'forge' })).toContain('git repository has no forge conversation');
    expect(refuse({ ...PLAIN_GIT, inputs: { ...PLAIN_GIT.inputs, board: ['sync-key', 'ci-identity'] } })).toContain('ci-identity');
    expect(refuse({ ...PLAIN_GIT, outbox: { ...PLAIN_GIT.outbox, 'forge-check': { deliverers: ['courier'], trust: 'any' } } })).toContain('forge-check deliverer');
    // `protected` applied to a git repository writes plain-git's three values with it.
    const folded = policyForPreset('protected', 'git');
    expect(() => validatePolicyDocument(folded, { forge: 'git' })).not.toThrow();
    expect(folded.leg_state).toBe('branch');
    expect(folded.inputs.board).toEqual(['sync-key']);
    expect(folded.outbox['forge-check'].deliverers).toEqual([]);
  });

  it('leg_state: unset means forge on a forge and branch on git; plain-git says branch', () => {
    expect(legStateOf(COOPERATIVE, 'github')).toBe('forge');
    expect(legStateOf(COOPERATIVE, 'git')).toBe('branch');
    expect(legStateOf(PLAIN_GIT, 'git')).toBe('branch');
    expect(legStateOf({ ...COOPERATIVE, leg_state: 'forge' }, 'github')).toBe('forge');
  });

  it('diff lists the knobs a change touches, in the table order, and nothing on a no-op', () => {
    const changed = diffPolicies(COOPERATIVE, PROTECTED);
    // In the table's order, and symmetric.
    expect([...changed].sort((a, b) => KNOBS.indexOf(a) - KNOBS.indexOf(b))).toEqual(changed);
    expect(diffPolicies(PROTECTED, COOPERATIVE).slice().sort()).toEqual([...changed].sort());
    expect(changed).toContain('approvers.policy');
    expect(changed).toContain('refs.default_branch');
    expect(changed).not.toContain('paths.protected'); // both []
    expect(changed).not.toContain('leg_state'); // both unset
    expect(diffPolicies(PROTECTED, { ...PROTECTED })).toEqual([]);
    expect(diffPolicies(COOPERATIVE, { ...COOPERATIVE, human_key: 'hardware' })).toEqual(['human_key']);
  });

  it('each guarantee holds or breaks as its row says, against the presets', () => {
    const humans = new Set(['SHA256:' + 'A'.repeat(43)]);
    const of = (doc: typeof COOPERATIVE, opts: { protection?: boolean } = {}) => guaranteesOf(doc, { humanKeys: humans, ...opts });
    // cooperative: every guarantee but trusted-domain-separate is broken (no-runner-lands first).
    const coop = of(COOPERATIVE);
    expect(coop['no-runner-lands']).toBe(false);
    expect(coop['trusted-domain-separate']).toBe(false);
    expect(coop['human-gates']).toBe(false);
    // protected: all but signed-authorship and human-gates-hardware, judged on the policy alone.
    const prot = of(PROTECTED);
    for (const g of GUARANTEE_NAMES) {
      const expectHeld = g !== 'signed-authorship' && g !== 'human-gates-hardware';
      if (g === 'human-gates' || g === 'human-gates-hardware') continue; // covered below with marks
      expect(prot[g], g).toBe(expectHeld);
    }
    expect(prot['human-gates']).toBe(true); // [human] lists are human-only whatever the marks
    // protected-signed holds all nine, judged on the policy alone.
    const signed = of(PROTECTED_SIGNED);
    for (const g of GUARANTEE_NAMES) expect(signed[g], g).toBe(true);
    // no-runner-lands needs the protection report when one is applied (R-BTN-189).
    expect(of(PROTECTED, { protection: false })['no-runner-lands']).toBe(false);
    expect(of(PROTECTED, { protection: true })['no-runner-lands']).toBe(true);
    // A single loosened knob breaks what rests on it.
    expect(of({ ...PROTECTED, tickets: { created: 'filed' } })['tickets-approved']).toBe(false);
    expect(of({ ...PROTECTED, merge: { ...PROTECTED.merge, reviews: { count: 1, distinct: ['trust_domain', 'model_family'] } } })['independent-review']).toBe(false);
    expect(of({ ...PROTECTED, inputs: { ...PROTECTED.inputs, board: ['sync-key', 'ci-identity', 'machine'] } })['board-from-trusted']).toBe(false);
    expect(of({ ...PROTECTED, attestations: { ...PROTECTED.attestations, 'std:approval@1': ['baton'] } })['tickets-approved']).toBe(false);
  });

  it('a human-only list is every entry human or naming a human_only key', () => {
    const key = `key:SHA256:${'B'.repeat(43)}` as const;
    const list = (...entries: ('human' | typeof key)[]) => entries;
    expect(humanOnlyList(list('human'), new Set())).toBe(true);
    expect(humanOnlyList(list('owner' as 'human'), new Set())).toBe(false);
    expect(humanOnlyList(list(key), new Set())).toBe(false);
    expect(humanOnlyList(list(key), new Set([key.slice(4)]))).toBe(true);
    expect(humanOnlyList(list('human', 'owner' as 'human'), new Set())).toBe(false);
  });
});
