// course-source.test.ts — B-33 (BATON_SPEC R-BTN-131, R-BTN-51): a course's qualified name,
// `<provider>/<namespace>/<repository>/<commit>/<course>`, in immediately.run's URL grammar —
// parsed and printed round trip, and every malformed name refused by what is wrong.
import { describe, it, expect } from 'vitest';
import { parseSource, printSource } from '../../src/defaults/course-source';

const SHA = 'ab'.repeat(20);

describe('course sources (B-33)', () => {
  it('parses a qualified name into its parts and prints it back', () => {
    const name = `github/immediately-run/baton/${SHA}/create-pr`;
    expect(parseSource(name)).toEqual({ provider: 'github', namespace: 'immediately-run', repository: 'baton', ref: SHA, course: 'create-pr' });
    expect(printSource(parseSource(name))).toBe(name);
    expect(parseSource(`github/o.rg/re_po-1/${SHA}/bug-report`).repository).toBe('re_po-1');
  });

  it('refuses what is not one, naming the part', () => {
    expect(() => parseSource(`github/immediately-run/baton/${SHA}`)).toThrow('a course source is <provider>/<namespace>/<repository>/<commit>/<course>');
    expect(() => parseSource(`github/immediately-run/baton/${SHA}/create-pr/extra`)).toThrow('a course source is');
    expect(() => parseSource(`gitlab/immediately-run/baton/${SHA}/create-pr`)).toThrow('provider gitlab — a source names github');
    expect(() => parseSource(`github/../baton/${SHA}/create-pr`)).toThrow('namespace .. is not a repository name');
    expect(() => parseSource(`github/immediately-run/a b/${SHA}/create-pr`)).toThrow('repository a b is not a repository name');
    expect(() => parseSource('github/immediately-run/baton/main/create-pr')).toThrow('main is not a full commit');
    expect(() => parseSource(`github/immediately-run/baton/${SHA.slice(0, 12)}/create-pr`)).toThrow('is not a full commit');
    expect(() => parseSource(`github/immediately-run/baton/${SHA}/Create-PR`)).toThrow('Create-PR is not a course id');
    expect(() => parseSource(`github/immediately-run/baton/${SHA}/`)).toThrow('(none) is not a course id');
  });
});
