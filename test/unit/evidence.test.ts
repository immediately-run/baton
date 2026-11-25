// The sync's `std:git.evidence@1` attestations (BATON_SPEC §9.6 R-BTN-10, S-BTN-18): which
// evidence the sync looks at, where it asks, and what it never says.
import { describe, it, expect } from 'vitest';
import { attestEvidence, evidencePath, EVIDENCE_REQUESTS_MAX, type EvidencePorts } from '../../src/defaults/evidence';

const SHA = 'a'.repeat(40);

function ports(over: Partial<EvidencePorts> & { statuses?: Record<string, number | null> } = {}) {
  const asked: string[] = [];
  const p: EvidencePorts = {
    hasCommit: () => false,
    home: { host: 'github.com', slug: 'o/r' },
    hosts: new Set(['github.com']),
    get: async (host, path) => {
      asked.push(`${host}${path}`);
      const key = `${host}${path}`;
      return over.statuses && key in over.statuses ? over.statuses[key] : 404;
    },
    log: () => {},
    ...over,
  };
  return { p, asked };
}

describe('evidencePath', () => {
  it('reads the GitHub URL forms a leg names, and nothing else', () => {
    const at = (u: string) => evidencePath(new URL(u));
    expect(at('https://github.com/o/r/pull/7#issuecomment-123')).toBe('/repos/o/r/issues/comments/123');
    expect(at('https://github.com/o/r/pull/7#pullrequestreview-9')).toBe('/repos/o/r/pulls/7/reviews/9');
    expect(at('https://github.com/o/r/pull/7#discussion_r55')).toBe('/repos/o/r/pulls/comments/55');
    expect(at('https://github.com/o/r/pull/7')).toBe('/repos/o/r/pulls/7');
    expect(at('https://github.com/o/r/issues/3#issuecomment-4')).toBe('/repos/o/r/issues/comments/4');
    expect(at(`https://github.com/o/r/commit/${SHA}`)).toBe(`/repos/o/r/commits/${SHA}`);
    expect(at('https://github.com/o/r/pull/7#something-else')).toBeNull();
    expect(at('https://github.com/o/r/pull/7/files')).toBeNull();
    expect(at('https://github.com/o/r/blob/main/x.md')).toBeNull();
  });
});

describe('attestEvidence', () => {
  it('attests a commit git has without asking the forge, and asks the home forge for one it lacks', async () => {
    const { p, asked } = ports({ hasCommit: (s) => s === SHA, statuses: { [`github.com/repos/o/r/commits/${'b'.repeat(40)}`]: 200 } });
    const out = await attestEvidence([{ ticket: 'T-1', claim: 1, evidence: SHA }, { ticket: 'T-2', claim: 2, evidence: 'b'.repeat(40) }, { ticket: 'T-3', claim: 3, evidence: 'c'.repeat(40) }], p);
    expect(out.map((a) => [a.value.claim, a.value.found])).toEqual([[1, true], [2, true], [3, false]]);
    expect(asked).toEqual([`github.com/repos/o/r/commits/${'b'.repeat(40)}`, `github.com/repos/o/r/commits/${'c'.repeat(40)}`]);
    expect(out[0]).toEqual({ type: 'std:git.evidence@1', ticket: 'T-1', ref: '1', value: { claim: 1, evidence: SHA, found: true } });
  });

  it('says found only on 200 and not found only on 404, 410 or 422; any other answer is no answer', async () => {
    const u = (n: number) => `https://github.com/o/r/pull/7#issuecomment-${n}`;
    const { p } = ports({ statuses: { 'github.com/repos/o/r/issues/comments/1': 200, 'github.com/repos/o/r/issues/comments/2': 404, 'github.com/repos/o/r/issues/comments/3': 500, 'github.com/repos/o/r/issues/comments/4': null, 'github.com/repos/o/r/issues/comments/5': 403 } });
    const out = await attestEvidence([1, 2, 3, 4, 5].map((n) => ({ ticket: 'T-1', claim: n, evidence: u(n) })), p);
    expect(out.map((a) => [a.value.claim, a.value.found])).toEqual([[1, true], [2, false]]);
  });

  it('never sends the token to a host it does not know, nor reads a URL form it cannot check', async () => {
    const { p, asked } = ports();
    const out = await attestEvidence([
      { ticket: 'T-1', claim: 1, evidence: 'https://evil.example/o/r/pull/7#issuecomment-1' },
      { ticket: 'T-1', claim: 2, evidence: 'http://github.com/o/r/pull/7#issuecomment-1' },
      { ticket: 'T-1', claim: 3, evidence: 'https://github.com/o/r/blob/main/README.md' },
      { ticket: 'T-1', claim: 4, evidence: 'not a url' },
    ], p);
    expect(out).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('without a token, looks only at git: a missing commit is not found, a URL is not looked at', async () => {
    const { p, asked } = ports({ home: null, hosts: new Set() });
    const out = await attestEvidence([{ ticket: 'T-1', claim: 1, evidence: SHA }, { ticket: 'T-1', claim: 2, evidence: 'https://github.com/o/r/pull/7' }], p);
    expect(out.map((a) => [a.value.claim, a.value.found])).toEqual([[1, false]]);
    expect(asked).toEqual([]);
  });

  it('spends at most its budget a run, oldest first, leaving the rest unanswered', async () => {
    const { p, asked } = ports({ statuses: {} });
    const list = Array.from({ length: EVIDENCE_REQUESTS_MAX + 5 }, (_, i) => ({ ticket: 'T-1', claim: i + 1, evidence: `https://github.com/o/r/pull/${i + 1}` }));
    const out = await attestEvidence(list, p);
    expect(asked).toHaveLength(EVIDENCE_REQUESTS_MAX);
    expect(out.map((a) => a.value.claim)).toEqual(list.slice(0, EVIDENCE_REQUESTS_MAX).map((u) => u.claim));
  });
});
